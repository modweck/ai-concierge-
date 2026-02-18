// Hybrid: Nearby Search (coverage) + Text Search (quality) + distance shortlisting
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

    console.log('=== HYBRID SEARCH START ===');
    console.log('Location:', confirmedAddress);

    const allCandidates = [];
    const seenIds = new Set();
    
    // Grid setup - ALL 9 POINTS
    const offsetMiles = 0.8;
    const offsetDegrees = offsetMiles / 69;
    const searchRadius = 2000;
    
    const gridPoints = [
      { lat, lng, label: 'Center' },
      { lat: lat + offsetDegrees, lng, label: 'North' },
      { lat: lat - offsetDegrees, lng, label: 'South' },
      { lat, lng: lng + offsetDegrees, label: 'East' },
      { lat, lng: lng - offsetDegrees, label: 'West' },
      { lat: lat + offsetDegrees, lng: lng + offsetDegrees, label: 'NE' },
      { lat: lat + offsetDegrees, lng: lng - offsetDegrees, label: 'NW' },
      { lat: lat - offsetDegrees, lng: lng + offsetDegrees, label: 'SE' },
      { lat: lat - offsetDegrees, lng: lng - offsetDegrees, label: 'SW' }
    ];

    console.log('Using 9-point grid for comprehensive coverage');

    // Helper: Nearby Search with pagination
    async function fetchNearby(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${searchRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      
      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;
      let pageCount = 1;

      while (nextPageToken && pageCount < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
        const pageData = await fetch(pageUrl).then(r=>r.json());
        if (pageData.results) allResults = allResults.concat(pageData.results);
        nextPageToken = pageData.next_page_token;
        pageCount++;
      }

      console.log(`Nearby ${label}: ${allResults.length} results`);
      return allResults;
    }

    // Helper: Text Search (no pagination - just first page for speed)
    async function fetchTextSearch(query, searchLat, searchLng) {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${searchLat},${searchLng}&radius=${searchRadius}&key=${GOOGLE_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      return data.results || [];
    }

    // STEP 1: Coverage pool (Nearby Search on ALL 9 grid points)
    console.log('Running Nearby Search on all 9 grid points...');
    for (const point of gridPoints) {
      const nearbyResults = await fetchNearby(point.lat, point.lng, point.label);
      nearbyResults.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    }

    console.log('After coverage pool (Nearby):', allCandidates.length);

    // STEP 2: Quality pool (REDUCED - only 2 queries from center point for speed)
    const qualityQueries = [
      'best restaurants near me',
      'top rated restaurants near me'
    ];
    
    if (cuisine) {
      qualityQueries.push(`best ${cuisine} near me`);
    }

    console.log('Running', qualityQueries.length, 'quality queries from center point');

    for (const query of qualityQueries) {
      const results = await fetchTextSearch(query, lat, lng);
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    }

    console.log('After quality pool (Text):', allCandidates.length);

    // STEP 3: Reduced shortlist for faster Distance Matrix
    let shortlistSize = 80; // Reduced from 150 for 20-min walk
    if (transportMode === 'walk' && maxWalkMinutes >= 30) {
      shortlistSize = 100; // Reduced from 250
    } else if (transportMode === 'drive' || transportMode === 'transit') {
      shortlistSize = 120; // Reduced from 200-350
    }
    
    console.log('Shortlisting top', shortlistSize, 'by straight-line distance');
    allCandidates.forEach(place => {
      const R = 3959;
      const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      place._straightLineDistance = R * c;
    });

    allCandidates.sort((a, b) => a._straightLineDistance - b._straightLineDistance);
    const shortlist = allCandidates.slice(0, shortlistSize);
    
    console.log('Collected', allCandidates.length, 'candidates → Shortlisted', shortlist.length, 'for Distance Matrix');

    // STEP 4: Distance Matrix only on shortlist
    const origin = `${lat},${lng}`;
    const batchSize = 25;
    const enrichedCandidates = [];

    for (let i = 0; i < shortlist.length; i += batchSize) {
      const batch = shortlist.slice(i, i + batchSize);
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

        if (!distMiles) {
          distMiles = Math.round(place._straightLineDistance * 10) / 10;
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

    // STEP 5: Filter by travel time
    let timeFiltered = enrichedCandidates;
    
    if (transportMode === 'walk' && maxWalkMinutes) {
      timeFiltered = timeFiltered.filter(r => r.walkMinutes && r.walkMinutes <= maxWalkMinutes);
    } else if (transportMode === 'drive' && maxDriveMinutes) {
      timeFiltered = timeFiltered.filter(r => r.driveMinutes && r.driveMinutes <= maxDriveMinutes);
    } else if (transportMode === 'transit' && maxTransitMinutes) {
      timeFiltered = timeFiltered.filter(r => r.transitMinutes && r.transitMinutes <= maxTransitMinutes);
    }

    console.log('afterWalkFilter:', timeFiltered.length);

    const rating40 = timeFiltered.filter(r => r.googleRating >= 4.0).length;
    const rating44 = timeFiltered.filter(r => r.googleRating >= 4.4).length;
    const rating46 = timeFiltered.filter(r => r.googleRating >= 4.6).length;
    console.log('Rating ≥4.0:', rating40);
    console.log('Rating ≥4.4:', rating44);
    console.log('Rating ≥4.6:', rating46);
    console.log('SUMMARY: Collected', allCandidates.length, '→', timeFiltered.length, 'within time →', rating46, 'rated ≥4.6');

    // STEP 6: Apply quality filter
    let finalResults = timeFiltered;

    if (qualityFilter === 'five_star') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.6);
    } else if (qualityFilter === 'top_rated_and_above') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4);
    } else if (qualityFilter === 'top_rated') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6);
    }

    console.log('After quality filter:', finalResults.length);
    console.log('=== SEARCH END ===');

    finalResults.sort((a, b) => b.googleRating - a.googleRating);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurants: finalResults, confirmedAddress, totalFound: finalResults.length })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
