// Step 1: Fast candidate search with estimated times (<8s)
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, cuisine, openNow, qualityFilter } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    console.log('=== STEP 1: CANDIDATE SEARCH START ===');
    console.log('Location:', location);

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidates: [], confirmedAddress: null }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // 9-point grid for maximum coverage
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

    console.log('9-point grid for maximum coverage');

    // Fetch with pagination
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

      console.log(`${label}: ${allResults.length} results`);
      return allResults;
    }

    const allCandidates = [];
    const seenIds = new Set();

    // Fetch from all grid points
    for (const point of gridPoints) {
      const results = await fetchNearby(point.lat, point.lng, point.label);
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    }

    console.log('Total candidates:', allCandidates.length);

    // Calculate straight-line distance and estimate times
    const candidatesWithEstimates = allCandidates.map(place => {
      const R = 3959; // miles
      const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distMiles = R * c;
      
      // Estimate times (conservative)
      const walkMinEstimate = Math.round(distMiles * 20); // 3 mph
      const driveMinEstimate = Math.round(distMiles * 4); // 15 mph city average
      const transitMinEstimate = Math.round(distMiles * 6); // 10 mph with stops

      return {
        place_id: place.place_id,
        name: place.name,
        vicinity: place.vicinity,
        formatted_address: place.formatted_address,
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        distanceMiles: Math.round(distMiles * 10) / 10,
        walkMinEstimate,
        driveMinEstimate,
        transitMinEstimate,
        needsEnrichment: true
      };
    });

    // Apply rating filter
    let filtered = candidatesWithEstimates;
    if (qualityFilter === 'five_star') {
      filtered = filtered.filter(r => r.googleRating >= 4.6);
    } else if (qualityFilter === 'top_rated_and_above') {
      filtered = filtered.filter(r => r.googleRating >= 4.4);
    } else if (qualityFilter === 'top_rated') {
      filtered = filtered.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6);
    }

    console.log('After rating filter:', filtered.length);
    console.log('=== STEP 1 COMPLETE ===');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: filtered,
        confirmedAddress,
        userLocation: { lat, lng },
        totalCandidates: filtered.length
      })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
