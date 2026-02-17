// Netlify Function: Search Restaurants (Debug Version)
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
    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { location, radius, cuisine, priceLevel, openNow } = body;

    // Check API keys
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    const YELP_API_KEY = process.env.YELP_API_KEY;

    if (!GOOGLE_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'GOOGLE_PLACES_API_KEY not configured',
          debug: 'Environment variable is missing'
        })
      };
    }

    if (!YELP_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'YELP_API_KEY not configured',
          debug: 'Environment variable is missing'
        })
      };
    }

    // Step 1: Geocode the location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    
    let geocodeResponse;
    try {
      geocodeResponse = await fetch(geocodeUrl);
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Failed to call Geocoding API',
          debug: e.message
        })
      };
    }

    let geocodeData;
    try {
      geocodeData = await geocodeResponse.json();
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Failed to parse Geocoding API response',
          debug: e.message
        })
      };
    }

    if (geocodeData.status !== 'OK') {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Geocoding failed',
          debug: {
            status: geocodeData.status,
            error_message: geocodeData.error_message
          }
        })
      };
    }

    if (!geocodeData.results || geocodeData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [] })
      };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;

    // Step 2: Search for restaurants using Google Places
    let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius || 1600}&type=restaurant&key=${GOOGLE_API_KEY}`;
    
    if (cuisine) {
      placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
    }
    if (openNow) {
      placesUrl += `&opennow=true`;
    }

    let placesResponse;
    try {
      placesResponse = await fetch(placesUrl);
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Failed to call Places API',
          debug: e.message
        })
      };
    }

    let placesData;
    try {
      placesData = await placesResponse.json();
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Failed to parse Places API response',
          debug: e.message
        })
      };
    }

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Places API error',
          debug: {
            status: placesData.status,
            error_message: placesData.error_message
          }
        })
      };
    }

    if (!placesData.results || placesData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [] })
      };
    }

    // Step 3: Return the restaurants
    const restaurants = placesData.results.map(place => ({
      name: place.name,
      vicinity: place.vicinity,
      formatted_address: place.formatted_address,
      rating: place.rating,
      price_level: place.price_level,
      opening_hours: place.opening_hours,
      geometry: place.geometry,
      place_id: place.place_id
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        restaurants,
        debug: {
          location_found: `${lat}, ${lng}`,
          results_count: restaurants.length
        }
      })
    };

  } catch (error) {
    console.error('Unexpected error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Unexpected error',
        debug: {
          message: error.message,
          stack: error.stack
        }
      })
    };
  }
};
