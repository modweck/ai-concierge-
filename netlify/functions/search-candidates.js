// Step 1: Large candidate pool - NO rating filter (moved to frontend)
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, cuisine, openNow } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    console.log('=== STEP 1: BUILD LARGE CANDIDATE POOL ===');

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

    // Multiple search strategies
    const allFetches = [];

    // Strategy 1: Nearby Search from all grid points (2 pages each)
    async function fetchNearby(searchLat, searchLng) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${searchRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      
      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;

      // Get page 2 if available
      if (nextPageToken) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
        const pageData = await fetch(pageUrl).then(r=>r.json());
        if (pageData.results) allResults = allResults.concat(pageData.results);
      }

      return allResults;
    }

    gridPoints.forEach(point => {
      allFetches.push(fetchNearby(point.lat, point.lng));
    });

    // Strategy 2: Text Search queries (only when cuisine is "any")
    async function fetchTextSearch(query) {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${searchRadius}&key=${GOOGLE_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      return data.results || [];
    }

    if (!cuisine) {
      const textQueries = [
        'restaurant',
        'best restaurants',
        'top rated restaurants',
        'fine dining'
      ];
      textQueries.forEach(query => {
        allFetches.push(fetchTextSearch(query));
      });
    }

    console.log('Running', allFetches.length, 'parallel queries');
    const allResults = await Promise.all(allFetches);

    // Dedupe by place_id
    const seenIds = new Set();
    const allCandidates = [];
    allResults.forEach(results => {
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    });

    console.log('Total unique candidates:', allCandidates.length);

    // Calculate estimates - NO RATING FILTER
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

    console.log('Returning', candidatesWithEstimates.length, 'candidates (NO rating filter)');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: candidatesWithEstimates,
        confirmedAddress,
        userLocation: { lat, lng },
        totalCandidates: candidatesWithEstimates.length
      })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message, stack: error.stack }) };
  }
};
