// Netlify Function: Search Restaurants (DEBUG VERSION)
// Path: /netlify/functions/search-restaurants.js

exports.handler = async (event, context) => {
  console.log('=== FUNCTION STARTED ===');
  
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
    
    console.log('Search params:', { location, radius, cuisine, openNow });

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      console.error('NO GOOGLE API KEY FOUND');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    // Step 1: Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    console.log('Geocoding:', location);
    
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();
    
    console.log('Geocode status:', geocodeData.status);

    if (geocodeData.status !== 'OK' || !geocodeData.results || geocodeData.results.length === 0) {
      console.error('Geocode failed');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress: null })
      };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;
    
    console.log('Location found:', { lat, lng, confirmedAddress });

    // Step 2: Search Google Places
    let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius || 1600}&type=restaurant&key=${GOOGLE_API_KEY}`;
    
    if (cuisine) {
      placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
    }
    if (openNow) {
      placesUrl += `&opennow=true`;
    }
    
    console.log('Searching places with radius:', radius);

    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();
    
    console.log('Places API status:', placesData.status);
    console.log('Number of results:', placesData.results ? placesData.results.length : 0);

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      console.error('Places search failed:', placesData.status);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress })
      };
    }

    if (!placesData.results || placesData.results.length === 0) {
      console.log('No restaurants found');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurants: [], confirmedAddress })
      };
    }

    const restaurants = placesData.results;
    console.log('Restaurant names:', restaurants.map(r => r.name));
    
    // Return WITHOUT distance matrix for faster debugging
    const simpleRestaurants = restaurants.map(place => ({
      name: place.name,
      vicinity: place.vicinity,
      formatted_address: place.formatted_address,
      price_level: place.price_level,
      opening_hours: place.opening_hours,
      geometry: place.geometry,
      place_id: place.place_id,
      distanceMiles: null,
      walkMinutes: null,
      driveMinutes: null,
      transitMinutes: null,
      googleRating: place.rating || 0,
      googleReviewCount: place.user_ratings_total || 0,
      yelpRating: 0,
      yelpReviewCount: 0,
      michelinStars: null,
      isBibGourmand: false,
      isMichelinRecommended: false
    }));

    console.log('Returning', simpleRestaurants.length, 'restaurants');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        restaurants: simpleRestaurants,
        confirmedAddress
      })
    };

  } catch (error) {
    console.error('CRITICAL ERROR:', error);
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
