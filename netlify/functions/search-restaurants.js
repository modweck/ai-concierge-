// Multi-query Text Search for better coverage
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

    // STEP 1: Run multiple text search queries for comprehensive coverage
    const baseQueries = [
      'top rated restaurants',
      'best restaurants',
      'highly rated restaurants',
      'popular restaurants',
      '4.5 star restaurants'
    ];
    
    if (cuisine) {
      baseQueries.push(`top rated ${cuisine} restaurants`);
      baseQueries.push(`best ${cuisine} restaurants`);
    }
    
    console.log('Running', baseQueries.length, 'text search queries');
    
    const allCandidates = [];
    const seenIds = new Set();
    
    for (const query of baseQueries) {
      let searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=3000&key=${GOOGLE_API_KEY}`;
      if (openNow) searchUrl += `&opennow=true`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.status === 'OK' && data.results) {
        data.results.forEach(place => {
          if (!seenIds.has(place.place_id)) {
            seenIds.add(place.place_id);
            allCandidates.push(place);
          }
        });
      }
    }
    
    console.log('Found', allCandidates.length, 'unique candidates from text search');

    // DIAGNOSTIC: Check raw rating data from Google
    console.log('=== RAW RATING DIAGNOSTICS ===');
    const missingRating = allCandidates.filter(p => !p.rating && p.rating !== 0).length;
    const missingReviewCount = allCandidates.filter(p => !p.user_ratings_total && p.user_ratings_total !== 0).length;
    console.log('Candidates missing rating field:', missingRating, '/', allCandidates.length);
    console.log('Candidates missing user_ratings_total field:', missingReviewCount, '/', allCandidates.length);
    
    // Print first 20 raw
    console.log('First 20 candidates (raw from Google):');
    allCandidates.slice(0, 20).forEach((p, idx) => {
      console.log(`  ${idx + 1}. "${p.name}" | rating=${p.rating} (type: ${typeof p.rating}) | reviews=${p.user_ratings_total} (type: ${typeof p.user_ratings_total})`);
    });
    
    // Count by rating tier BEFORE any filtering
    const rating40 = allCandidates.filter(p => p.rating >= 4.0).length;
    const rating42 = allCandidates.filter(p => p.rating >= 4.2).length;
    const rating44 = allCandidates.filter(p => p.rating >= 4.4).length;
    const rating46 = allCandidates.filter(p => p.rating >= 4.6).length;
    console.log('Rating distribution (BEFORE filters):');
    console.log('  ≥4.0:', rating40);
    console.log('  ≥4.2:', rating42);
    console.log('  ≥4.4:', rating44);
    console.log('  ≥4.6:', rating46);
    console.log('=== END DIAGNOSTICS ===');

    // STEP 2: Calculate distances (batches of 25)
    const origin = `${lat},${lng}`;
    const batchSize = 25;
    const enrichedCandidates = [];
    
    for (let i = 0; i < allCandidates.length; i += batchSize) {
      const batch = allCandidates.slice(i, i + batchSize);
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

        // Fallback distance
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

    // STEP 3: Filter by travel time
    let timeFiltered = enrichedCandidates;
    
    if (transportMode === 'walk' && maxWalkMinutes) {
      timeFiltered = timeFiltered.filter(r => r.walkMinutes && r.walkMinutes <= maxWalkMinutes);
    } else if (transportMode === 'drive' && maxDriveMinutes) {
      timeFiltered = timeFiltered.filter(r => r.driveMinutes && r.driveMinutes <= maxDriveMinutes);
    } else if (transportMode === 'transit' && maxTransitMinutes) {
      timeFiltered = timeFiltered.filter(r => r.transitMinutes && r.transitMinutes <= maxTransitMinutes);
    }

    console.log('After time filter:', timeFiltered.length, 'restaurants');

    // DIAGNOSTIC
    const rating46Plus = timeFiltered.filter(r => r.googleRating >= 4.6).length;
    const rating46Plus50Reviews = timeFiltered.filter(r => r.googleRating >= 4.6 && r.googleReviewCount >= 50).length;
    const rating46Plus25Reviews = timeFiltered.filter(r => r.googleRating >= 4.6 && r.googleReviewCount >= 25).length;
    console.log('DIAGNOSTIC: Rating ≥4.6 (any reviews):', rating46Plus);
    console.log('DIAGNOSTIC: Rating ≥4.6 AND ≥50 reviews:', rating46Plus50Reviews);
    console.log('DIAGNOSTIC: Rating ≥4.6 AND ≥25 reviews:', rating46Plus25Reviews);

    // STEP 4: Apply quality filter (NO REVIEW COUNT REQUIREMENT)
    let finalResults = timeFiltered;

    if (qualityFilter === 'five_star') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.6);
    } else if (qualityFilter === 'top_rated_and_above') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4);
    } else if (qualityFilter === 'top_rated') {
      finalResults = finalResults.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6);
    }

    console.log('After quality filter:', finalResults.length, 'restaurants');

    // Sort by rating
    finalResults.sort((a, b) => b.googleRating - a.googleRating);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurants: finalResults, confirmedAddress, totalFound: finalResults.length })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
