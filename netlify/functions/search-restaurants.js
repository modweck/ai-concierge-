// Netlify Function: Search Restaurants with Distance Matrix (Walk/Drive/Transit)
// Path: /netlify/functions/search-restaurants.js

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, radius, cuisine, priceLevel, openNow } = body;

    // Check API keys
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    const YELP_API_KEY = process.env.YELP_API_KEY;

    if (!GOOGLE_API_KEY || !YELP_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'API keys not configured' })
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
        body: JSON.stringify({ 
          restaurants: [],
          confirmedAddress: null
        })
      };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Step 2: Search for restaurants
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
        body: JSON.stringify({ 
          restaurants: [],
          confirmedAddress
        })
      };
    }

    if (!placesData.results || placesData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          restaurants: [],
          confirmedAddress
        })
      };
    }

    // Step 3: Get real travel times using Distance Matrix API
    // Limit to first 10 restaurants to avoid API quota issues
    const restaurants = placesData.results.slice(0, 10);
    
    // Build destination string for Distance Matrix
    const destinations = restaurants.map(place => 
      `${place.geometry.location.lat},${place.geometry.location.lng}`
    ).join('|');

    const origin = `${lat},${lng}`;

    // Get walking times
    const walkUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`;
    const walkResponse = await fetch(walkUrl);
    const walkData = await walkResponse.json();

    // Get driving times
    const driveUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`;
    const driveResponse = await fetch(driveUrl);
    const driveData = await driveResponse.json();

    // Get transit times
    const transitUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`;
    const transitResponse = await fetch(transitUrl);
    const transitData = await transitResponse.json();

    // Combine restaurant data with travel times
    const enrichedRestaurants = restaurants.map((place, index) => {
      let walkMinutes = null;
      let driveMinutes = null;
      let transitMinutes = null;
      let distanceMiles = null;

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

      return {
        name: place.name,
        vicinity: place.vicinity,
        formatted_address: place.formatted_address,
        rating: place.rating,
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        place_id: place.place_id,
        distanceMiles,
        walkMinutes,
        driveMinutes,
        transitMinutes
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
