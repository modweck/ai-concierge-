// Comprehensive debugging version
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

    console.log('=== SEARCH START ===');
    console.log('Location:', confirmedAddress);
    console.log('Transport:', transportMode, 'Max time:', maxWalkMinutes || maxDriveMinutes || maxTransitMinutes);

    // STEP 1: Fetch candidates with LARGE radius (2000m for 20-min walk)
    const searchRadius = 2000; // Over-fetch, then filter by real time
    const baseQueries = [
      'restaurants',
      'top rated restaurants',
      'best restaurants'
    ];
    
    if (cuisine) {
      baseQueries.push(`${cuisine} restaurants`);
    }
    
    console.log('Running', baseQueries.length, 'queries with radius:', searchRadius, 'm');
    
    const allCandidates = [];
    const seenIds = new Set();
    
    for (const query of baseQueries) {
      let searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${searchRadius}&key=${GOOGLE_API_KEY}`;
      if (openNow) searchUrl += `&opennow=true`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.status === 'OK' && data.results) {
        // Get all pages
        let allResults = data.results;
        let nextPageToken = data.next_page_token;
        let pageCount = 1;
        
        while (nextPageToken && pageCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const pageUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
          const pageResponse = await fetch(pageUrl);
          const pageData = await pageResponse.json();
          
          if (pageData.results) allResults = allResults.concat(pageData.results);
          nextPageToken = pageData.next_page_token;
          pageCount++;
        }
        
        console.log(`Query "${query}": ${allResults.length} results (${pageCount} pages)`);
        
        allResults.forEach(place => {
          if (!seenIds.has(place.place_id)) {
            seenIds.add(place.place_id);
            allCandidates.push(place);
          }
        });
      }
    }
    
    console.log('candidatesFound (unique place_id):', allCandidates.length);
    
    // Check for lat/lng
    const candidatesWithLatLng = allCandidates.filter(p => p.geometry?.location?.lat && p.geometry?.location?.lng);
    console.log('candidatesWithLatLng:', candidatesWithLatLng.length);
    
    // STEP 2: Calculate distances (keep ALL candidates, estimate if Distance Matrix fails)
    const origin = `${lat},${lng}`;
    const batchSize = 25;
    const enrichedCandidates = [];
    let distanceMatrixSuccessCount = 0;
    let distanceMatrixFailureCount = 0;
    const failureReasons = {};
    
    console.log('candidatesSentToDistanceMatrix:', candidatesWithLatLng.length);
    
    for (let i = 0; i < candidatesWithLatLng.length; i += batchSize) {
      const batch = candidatesWithLatLng.slice(i, i + batchSize);
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      
      const [walkData, driveData, transitData] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
      ]);

      batch.forEach((place, idx) => {
        let walkMin = null, driveMin = null, transitMin = null, distMiles = null;
        let distanceSuccess = false;

        // Try to get real distance
        if (walkData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          walkMin = Math.round(walkData.rows[0].elements[idx].duration.value / 60);
          distMiles = Math.round((walkData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
          distanceSuccess = true;
          distanceMatrixSuccessCount++;
        } else {
          // Log failure reason
          const status = walkData?.rows?.[0]?.elements?.[idx]?.status || 'UNKNOWN';
          failureReasons[status] = (failureReasons[status] || 0) + 1;
          distanceMatrixFailureCount++;
        }
        
        if (driveData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          driveMin = Math.round(driveData.rows[0].elements[idx].duration.value / 60);
        }
        if (transitData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          transitMin = Math.round(transitData.rows[0].elements[idx].duration.value / 60);
        }

        // ALWAYS calculate fallback distance - NEVER drop candidates
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

        // Estimate walk time if missing
        if (!walkMin && distMiles) {
          walkMin = Math.round(distMiles * 20); // 3 mph = 20 min/mile
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

    console.log('distanceMatrixSuccessCount:', distanceMatrixSuccessCount);
    console.log('distanceMatrixFailureCount:', distanceMatrixFailureCount);
    console.log('Failure reasons:', JSON.stringify(failureReasons));
    console.log('Total enriched candidates:', enrichedCandidates.length);

    // STEP 3: Filter by travel time
    let timeFiltered = enrichedCandidates;
    
    if (transportMode === 'walk' && maxWalkMinutes) {
      timeFiltered = timeFiltered.filter(r => r.walkMinutes && r.walkMinutes <= maxWalkMinutes);
    } else if (transportMode === 'drive' && maxDriveMinutes) {
      timeFiltered = timeFiltered.filter(r => r.driveMinutes && r.driveMinutes <= maxDriveMinutes);
    } else if (transportMode === 'transit' && maxTransitMinutes) {
      timeFiltered = timeFiltered.filter(r => r.transitMinutes && r.transitMinutes <= maxTransitMinutes);
    }

    console.log('restaurantsAfterTimeFilter:', timeFiltered.length);

    // Rating diagnostics
    const rating40 = timeFiltered.filter(r => r.googleRating >= 4.0).length;
    const rating44 = timeFiltered.filter(r => r.googleRating >= 4.4).length;
    const rating46 = timeFiltered.filter(r => r.googleRating >= 4.6).length;
    console.log('Rating distribution after time filter:');
    console.log('  ≥4.0:', rating40);
    console.log('  ≥4.4:', rating44);
    console.log('  ≥4.6:', rating46);

    // STEP 4: Apply quality filter
    let finalResults = timeFiltered;

    if (qualityFilter === 'five_star') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.6);
    } else if (qualityFilter === 'top_rated_and_above') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4);
    } else if (qualityFilter === 'top_rated') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6);
    }

    console.log('After quality filter:', finalResults.length, 'restaurants');
    console.log('=== SEARCH END ===');

    // Sort by rating
    finalResults.sort((a, b) => b.googleRating - a.googleRating);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurants: finalResults, confirmedAddress, totalFound: finalResults.length })
    };

  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
