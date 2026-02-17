// Clean Backend - Google Only, No Yelp
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

    // Search - use LARGE radius to get lots of results
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
    }

    // Calculate distances for first 25
    const first25 = allRestaurants.slice(0, 25);
    const destinations = first25.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
    const origin = `${lat},${lng}`;

    const [walkResp, driveResp, transitResp] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`)
    ]);

    const [walkData, driveData, transitData] = await Promise.all([walkResp.json(), driveResp.json(), transitResp.json()]);

    const enriched = first25.map((place, idx) => {
      let walkMin = null, driveMin = null, transitMin = null, distMiles = null;

      if (walkData.rows?.[0]?.elements?.[idx]?.status === 'OK') {
        walkMin = Math.round(walkData.rows[0].elements[idx].duration.value / 60);
        distMiles = Math.round((walkData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
      }
      if (driveData.rows?.[0]?.elements?.[idx]?.status === 'OK') {
        driveMin = Math.round(driveData.rows[0].elements[idx].duration.value / 60);
      }
      if (transitData.rows?.[0]?.elements?.[idx]?.status === 'OK') {
        transitMin = Math.round(transitData.rows[0].elements[idx].duration.value / 60);
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
