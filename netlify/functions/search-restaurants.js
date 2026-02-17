// Netlify Function: Search Restaurants
// Path: /netlify/functions/search-restaurants.js

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { 
      location, 
      radius, 
      cuisine, 
      priceLevel, 
      openNow 
    } = JSON.parse(event.body);

    // API Keys from environment variables
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    const YELP_API_KEY = process.env.YELP_API_KEY;

    if (!GOOGLE_API_KEY || !YELP_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'API keys not configured. Please add GOOGLE_PLACES_API_KEY and YELP_API_KEY to environment variables.' 
        })
      };
    }

    // Step 1: Geocode the location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (!geocodeData.results || geocodeData.results.length === 0) {
      return {
        statusCode: 200,
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

    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (!placesData.results || placesData.results.length === 0) {
      return {
        statusCode: 200,
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ restaurants })
    };

  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Search failed', 
        message: error.message 
      })
    };
  }
};
