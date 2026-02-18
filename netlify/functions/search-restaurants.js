// Clean Backend - Returns all restaurants with distances
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, radius, cuisine, openNow } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurants: [], confirmedAddress: null }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Search - remove rankby, just use radius
    let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=restaurant&key=${GOOGLE_API_KEY}`;
    if (cuisine) placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
    if (openNow) placesUrl += `&opennow=true`;

    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurants: [], confirmedAddress }) };
    }

    let allRestaurants = placesData.results || [];

    // Get page 2
    if (placesData.next_page_token) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const page2Response = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${placesData.next_page_token}&key=${GOOGLE_API_KEY}`);
      const page2Data = await page2Response.json();
      if (page2Data.results) allRestaurants = allRestaurants.concat(page2Data.results);
      
      // Get page 3
      if (page2Data.next_page_token) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const page3Response = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${page2Data.next_page_token}&key=${GOOGLE_API_KEY}`);
        const page3Data = await page3Response.json();
        if (page3Data.results) allRestaurants = allRestaurants.concat(page3Data.results);
      }
    }

    // Calculate distances for first 30 only (to save API calls)
    const first30 = allRestaurants.slice(0, 30);
    
    const origin = `${lat},${lng}`;
    
    // Process first 25
    const batch1 = first30.slice(0, 25);
    const destinations1 = batch1.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
    const [walk1, drive1, transit1] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
    ]);

    // Process remaining 5 (26-30)
    let walk2, drive2, transit2;
    const batch2 = first30.slice(25, 30);
    if (batch2.length > 0) {
      const destinations2 = batch2.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      [walk2, drive2, transit2] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
      ]);
    }

    const enriched = allRestaurants.map((place, idx) => {
      let walkMin = null, driveMin = null, transitMin = null, distMiles = null;
      
      // Determine which batch this is in
      const batchIdx = idx < 25 ? idx : idx - 25;
      const walkData = idx < 25 ? walk1 : walk2;
      const driveData = idx < 25 ? drive1 : drive2;
      const transitData = idx < 25 ? transit1 : transit2;

      if (walkData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
        walkMin = Math.round(walkData.rows[0].elements[batchIdx].duration.value / 60);
        distMiles = Math.round((walkData.rows[0].elements[batchIdx].distance.value / 1609.34) * 10) / 10;
      }
      if (driveData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
        driveMin = Math.round(driveData.rows[0].elements[batchIdx].duration.value / 60);
      }
      if (transitData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
        transitMin = Math.round(transitData.rows[0].elements[batchIdx].duration.value / 60);
      }

      // Calculate straight-line distance as fallback using Haversine formula
      if (!distMiles) {
        const R = 3959; // Earth radius in miles
        const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        distMiles = Math.round(R * c * 10) / 10;
      }

      // Estimate walk time if not available (3 mph walking speed)
      if (!walkMin && distMiles) {
        walkMin = Math.round(distMiles * 20); // 20 min per mile
      }

      return {
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
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurants: enriched, confirmedAddress })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
