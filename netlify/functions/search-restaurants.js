// Netlify Function: Search Restaurants (Simplified - Google Only)
// Path: /netlify/functions/search-restaurants.js

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, radius, cuisine, openNow } = body;

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    // Step 1: Geocode the location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress: null })
      };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Step 2: Search Google Places
    let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius || 1600}&type=restaurant&key=${GOOGLE_API_KEY}`;
    
    if (cuisine) {
      placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
    }
    if (openNow) {
      placesUrl += `&opennow=true`;
    }

    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress })
      };
    }

    if (!placesData.results || placesData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress })
      };
    }

    // Get ALL restaurants (Google returns max 20)
    const restaurants = placesData.results;
    
    // Step 3: Get travel times
    const destinations = restaurants.map(place => 
      `${place.geometry.location.lat},${place.geometry.location.lng}`
    ).join('|');
    const origin = `${lat},${lng}`;

    const [walkResponse, driveResponse, transitResponse] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`)
    ]);

    const [walkData, driveData, transitData] = await Promise.all([
      walkResponse.json(),
      driveResponse.json(),
      transitResponse.json()
    ]);

    // Step 4: Enrich with travel times (NO YELP CALLS)
    const enrichedRestaurants = restaurants.map((place, index) => {
      let walkMinutes = null;
      let driveMinutes = null;
      let transitMinutes = null;
      let distanceMiles = null;

      // Get travel times
      if (walkData.rows && walkData.rows[0] && walkData.rows[0].elements[index]) {
        const walkElement = walkData.rows[0].elements[index];
        if (walkElement.status === 'OK') {
          walkMinutes = Math.round(walkElement.duration.value / 60);
          distanceMiles = Math.round((walkElement.distance.value / 1609.34) * 10) / 10;
        }
      }

      if (driveData.rows && driveData.rows[0] && driveData.rows[0].elements[index]) {
        const driveElement = driveData.rows[0].elements[index];
        if (driveElement.status === 'OK') {
          driveMinutes = Math.round(driveElement.duration.value / 60);
        }
      }

      if (transitData.rows && transitData.rows[0] && transitData.rows[0].elements[index]) {
        const transitElement = transitData.rows[0].elements[index];
        if (transitElement.status === 'OK') {
          transitMinutes = Math.round(transitElement.duration.value / 60);
        }
      }

      // Use ONLY Google data
      const googleRating = place.rating || 0;
      const googleReviewCount = place.user_ratings_total || 0;

      return {
        name: place.name,
        vicinity: place.vicinity,
        formatted_address: place.formatted_address,
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        place_id: place.place_id,
        distanceMiles,
        walkMinutes,
        driveMinutes,
        transitMinutes,
        googleRating,
        googleReviewCount,
        yelpRating: 0,
        yelpReviewCount: 0,
        michelinStars: null,
        isBibGourmand: false,
        isMichelinRecommended: false
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        restaurants: enrichedRestaurants,
        confirmedAddress
      })
    };

  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Search failed',
        message: error.message
      })
    };
  }
};
