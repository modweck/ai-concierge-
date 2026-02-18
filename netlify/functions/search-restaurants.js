// Comprehensive search backend - gets close to "all restaurants" matching filters
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, cuisine, openNow, maxWalkMinutes, maxDriveMinutes, maxTransitMinutes, transportMode, qualityFilter } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurants: [], confirmedAddress: null, totalFound: 0 }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Helper: Fetch all pages from a single search location
    async function fetchAllPages(searchLat, searchLng) {
      let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=2400&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) placesUrl += `&opennow=true`;

      const response = await fetch(placesUrl);
      const data = await response.json();
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      
      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;

      // Get all pages (up to 3)
      let pageCount = 1;
      while (nextPageToken && pageCount < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const pageResponse = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`);
        const pageData = await pageResponse.json();
        
        if (pageData.results) allResults = allResults.concat(pageData.results);
        nextPageToken = pageData.next_page_token;
        pageCount++;
      }

      return allResults;
    }

    // STEP 1: Build comprehensive candidate pool with grid search
    const offsetMiles = 1.0; // Increased from 0.7 to 1.0 miles
    const offsetDegrees = offsetMiles / 69;
    
    console.log('Grid search parameters: offset =', offsetMiles, 'miles, radius = 2400m per point');
    
    // 13-point grid for better coverage
    const searchGrid = [
      { lat, lng }, // Center
      { lat: lat + offsetDegrees, lng }, // North
      { lat: lat - offsetDegrees, lng }, // South
      { lat, lng: lng + offsetDegrees }, // East
      { lat, lng: lng - offsetDegrees }, // West
      { lat: lat + offsetDegrees, lng: lng + offsetDegrees }, // NE
      { lat: lat + offsetDegrees, lng: lng - offsetDegrees }, // NW
      { lat: lat - offsetDegrees, lng: lng + offsetDegrees }, // SE
      { lat: lat - offsetDegrees, lng: lng - offsetDegrees }, // SW
      // Additional intermediate points
      { lat: lat + (offsetDegrees * 0.5), lng }, // N-mid
      { lat: lat - (offsetDegrees * 0.5), lng }, // S-mid
      { lat, lng: lng + (offsetDegrees * 0.5) }, // E-mid
      { lat, lng: lng - (offsetDegrees * 0.5) }  // W-mid
    ];

    console.log('Starting grid search with', searchGrid.length, 'locations');
    const gridSearchPromises = searchGrid.map(loc => fetchAllPages(loc.lat, loc.lng));
    const gridResults = await Promise.all(gridSearchPromises);

    // Deduplicate by place_id
    const seenIds = new Set();
    const allCandidates = [];
    gridResults.forEach(results => {
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    });

    console.log('Found', allCandidates.length, 'unique candidates');

    // STEP 2: Calculate real distance/times for ALL candidates (in batches of 25)
    const origin = `${lat},${lng}`;
    const batchSize = 25;
    const batches = [];
    
    for (let i = 0; i < allCandidates.length; i += batchSize) {
      batches.push(allCandidates.slice(i, i + batchSize));
    }

    console.log('Processing', batches.length, 'batches for distance calculation');

    const enrichedCandidates = [];
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      
      const [walkData, driveData, transitData] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
      ]);

      batch.forEach((place, idx) => {
        let walkMin = null, driveMin = null, transitMin = null, distMiles = null;

        if (walkData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          walkMin = Math.round(walkData.rows[0].elements[idx].duration.value / 60);
          distMiles = Math.round((walkData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
        }
        if (driveData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          driveMin = Math.round(driveData.rows[0].elements[idx].duration.value / 60);
        }
        if (transitData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          transitMin = Math.round(transitData.rows[0].elements[idx].duration.value / 60);
        }

        // Fallback distance calculation
        if (!distMiles) {
          const R = 3959;
          const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
          const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                    Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          distMiles = Math.round(R * c * 10) / 10;
        }

        if (!walkMin && distMiles) {
          walkMin = Math.round(distMiles * 20);
        }

        enrichedCandidates.push({
          name: place.name,
          vicinity: place.vicinity,
          formatted_address: place.formatted_address,
          price_level: place.price_level,
          opening_hours: place.opening_hours,
          geometry: place.geometry,
          place_id: place.place_id,
          distanceMiles: distMiles,
          walkMinutes: walkMin,
          driveMinutes: driveMin,
          transitMinutes: transitMin,
          googleRating: place.rating || 0,
          googleReviewCount: place.user_ratings_total || 0
        });
      });
    }

    console.log('Enriched', enrichedCandidates.length, 'candidates with distance data');

    // STEP 3: Hard filter by travel time based on transport mode
    let timeFiltered = enrichedCandidates;
    
    if (transportMode === 'walk' && maxWalkMinutes) {
      timeFiltered = timeFiltered.filter(r => r.walkMinutes && r.walkMinutes <= maxWalkMinutes);
    } else if (transportMode === 'drive' && maxDriveMinutes) {
      timeFiltered = timeFiltered.filter(r => r.driveMinutes && r.driveMinutes <= maxDriveMinutes);
    } else if (transportMode === 'transit' && maxTransitMinutes) {
      timeFiltered = timeFiltered.filter(r => r.transitMinutes && r.transitMinutes <= maxTransitMinutes);
    }

    console.log('After time filter:', timeFiltered.length, 'restaurants');

    // DIAGNOSTIC LOGGING - Check what we have before quality filter
    const rating46Plus = timeFiltered.filter(r => r.googleRating >= 4.6).length;
    const rating46Plus50Reviews = timeFiltered.filter(r => r.googleRating >= 4.6 && r.googleReviewCount >= 50).length;
    const rating46Plus25Reviews = timeFiltered.filter(r => r.googleRating >= 4.6 && r.googleReviewCount >= 25).length;
    console.log('DIAGNOSTIC: Rating ≥4.6 (any reviews):', rating46Plus);
    console.log('DIAGNOSTIC: Rating ≥4.6 AND ≥50 reviews:', rating46Plus50Reviews);
    console.log('DIAGNOSTIC: Rating ≥4.6 AND ≥25 reviews:', rating46Plus25Reviews);

    // STEP 4: Apply quality filter
    const MIN_REVIEW_COUNT = 25;
    let finalResults = timeFiltered;

    if (qualityFilter === 'five_star') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.6 && r.googleReviewCount >= MIN_REVIEW_COUNT);
    } else if (qualityFilter === 'top_rated_and_above') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4 && r.googleReviewCount >= MIN_REVIEW_COUNT);
    } else if (qualityFilter === 'top_rated') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6 && r.googleReviewCount >= MIN_REVIEW_COUNT);
    }

    console.log('After quality filter:', finalResults.length, 'restaurants');

    // Sort by rating desc
    finalResults.sort((a, b) => b.googleRating - a.googleRating);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        restaurants: finalResults,
        confirmedAddress,
        totalFound: finalResults.length
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
