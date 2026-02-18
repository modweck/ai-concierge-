// Step 1: Ultra-fast candidate search - NO pagination, parallel fetches (<5s)
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

    console.log('=== STEP 1: FAST CANDIDATE SEARCH ===');

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidates: [], confirmedAddress: null }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // 9-point grid
    const offsetMiles = 0.8;
    const offsetDegrees = offsetMiles / 69;
    const searchRadius = 2000;
    
    const gridPoints = [
      { lat, lng },
      { lat: lat + offsetDegrees, lng },
      { lat: lat - offsetDegrees, lng },
      { lat, lng: lng + offsetDegrees },
      { lat, lng: lng - offsetDegrees },
      { lat: lat + offsetDegrees, lng: lng + offsetDegrees },
      { lat: lat + offsetDegrees, lng: lng - offsetDegrees },
      { lat: lat - offsetDegrees, lng: lng + offsetDegrees },
      { lat: lat - offsetDegrees, lng: lng - offsetDegrees }
    ];

    // Fetch ONLY first page from each grid point (NO pagination)
    async function fetchFirstPage(searchLat, searchLng) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${searchRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      return data.results || [];
    }

    // Parallel fetch all grid points
    console.log('Fetching 9 grid points in parallel (first page only)');
    const gridFetches = gridPoints.map(point => fetchFirstPage(point.lat, point.lng));
    const gridResults = await Promise.all(gridFetches);

    // Dedupe
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

    console.log('Total unique candidates:', allCandidates.length);

    // Calculate straight-line distance and estimate times
    const candidatesWithEstimates = allCandidates.map(place => {
      const R = 3959;
      const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distMiles = R * c;
      
      const walkMinEstimate = Math.round(distMiles * 20);
      const driveMinEstimate = Math.round(distMiles * 4);
      const transitMinEstimate = Math.round(distMiles * 6);

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
        transitMinEstimate
      };
    });

    console.log('totalCandidatesBeforeRating:', candidatesWithEstimates.length);

    // Apply rating filter
    let filtered = candidatesWithEstimates;
    if (qualityFilter === 'five_star') {
      filtered = filtered.filter(r => r.googleRating >= 4.6);
    } else if (qualityFilter === 'top_rated_and_above') {
      filtered = filtered.filter(r => r.googleRating >= 4.4);
    } else if (qualityFilter === 'top_rated') {
      filtered = filtered.filter(r => r.googleRating >= 4.4 && r.googleRating < 4.6);
    }

    console.log('afterRating:', filtered.length);

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
