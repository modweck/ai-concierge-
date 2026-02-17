// Netlify Function: Search Restaurants
// Path: /netlify/functions/search-restaurants.js

const fetch = require('node-fetch');

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
      radius, // in meters
      cuisine,
      priceLevel, // 1-4 (Google Places format)
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

    // Step 1: Geocode the location if it's an address
    let lat, lng;
    if (typeof location === 'string') {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
      const geocodeResponse = await fetch(geocodeUrl);
      const geocodeData = await geocodeResponse.json();
      
      if (geocodeData.status === 'OK' && geocodeData.results.length > 0) {
        lat = geocodeData.results[0].geometry.location.lat;
        lng = geocodeData.results[0].geometry.location.lng;
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Could not geocode location' })
        };
      }
    } else {
      lat = location.lat;
      lng = location.lng;
    }

    // Step 2: Search Google Places for restaurants
    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${GOOGLE_API_KEY}`;
    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Google Places API error', 
          details: placesData.status 
        })
      };
    }

    // Step 3: Enrich each restaurant with Yelp data
    const enrichedRestaurants = await Promise.all(
      (placesData.results || []).slice(0, 20).map(async (place) => {
        try {
          // Search Yelp for this restaurant
          const yelpSearchUrl = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(place.name)}&latitude=${lat}&longitude=${lng}&limit=1`;
          const yelpResponse = await fetch(yelpSearchUrl, {
            headers: {
              'Authorization': `Bearer ${YELP_API_KEY}`
            }
          });
          const yelpData = await yelpResponse.json();

          let yelpBusiness = null;
          if (yelpData.businesses && yelpData.businesses.length > 0) {
            yelpBusiness = yelpData.businesses[0];

            // Get detailed Yelp info including reviews
            const yelpDetailsUrl = `https://api.yelp.com/v3/businesses/${yelpBusiness.id}`;
            const yelpDetailsResponse = await fetch(yelpDetailsUrl, {
              headers: {
                'Authorization': `Bearer ${YELP_API_KEY}`
              }
            });
            const yelpDetails = await yelpDetailsResponse.json();

            // Get reviews to determine vibe
            const yelpReviewsUrl = `https://api.yelp.com/v3/businesses/${yelpBusiness.id}/reviews`;
            const yelpReviewsResponse = await fetch(yelpReviewsUrl, {
              headers: {
                'Authorization': `Bearer ${YELP_API_KEY}`
              }
            });
            const yelpReviews = await yelpReviewsResponse.json();

            yelpBusiness = { ...yelpDetails, reviews: yelpReviews.reviews || [] };
          }

          // Calculate vibe from Yelp reviews
          const vibe = calculateVibe(yelpBusiness?.reviews || []);

          // Determine cuisine type
          const cuisine = determineCuisine(
            yelpBusiness?.categories || place.types || []
          );

          // Calculate estimated wait/walk time based on distance
          const distance = place.geometry?.location ? 
            calculateDistance(lat, lng, place.geometry.location.lat, place.geometry.location.lng) : 
            null;
          
          const walkMinutes = distance ? Math.round((distance * 1000 / 80)) : null; // ~80m/min walking
          const driveMinutes = distance ? Math.round((distance / 0.5)) : null; // ~30mph average city driving

          return {
            id: place.place_id,
            name: place.name,
            cuisine: cuisine,
            rating: yelpBusiness?.rating || place.rating || 0,
            ratingCount: yelpBusiness?.review_count || place.user_ratings_total || 0,
            priceLevel: yelpBusiness?.price?.length || place.price_level || 2,
            address: place.vicinity || yelpBusiness?.location?.address1,
            location: {
              lat: place.geometry?.location?.lat,
              lng: place.geometry?.location?.lng
            },
            distance: distance,
            walkMinutes: walkMinutes,
            driveMinutes: driveMinutes,
            radiusMiles: distance,
            vibe: vibe,
            photos: place.photos?.slice(0, 3).map(photo => ({
              reference: photo.photo_reference,
              url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
            })) || [],
            isOpenNow: place.opening_hours?.open_now,
            yelpUrl: yelpBusiness?.url,
            googleUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
            // Additional Yelp data
            transactions: yelpBusiness?.transactions || [],
            categories: yelpBusiness?.categories || [],
            phone: yelpBusiness?.phone || place.formatted_phone_number,
            // Quality indicators
            isMichelin: checkMichelin(yelpBusiness?.categories || []),
            isBibGourmand: checkBibGourmand(yelpBusiness?.categories || []),
            qualityLevel: determineQualityLevel(
              yelpBusiness?.rating || place.rating,
              yelpBusiness?.review_count || place.user_ratings_total
            )
          };
        } catch (error) {
          console.error(`Error enriching restaurant ${place.name}:`, error);
          // Return basic data if Yelp enrichment fails
          return {
            id: place.place_id,
            name: place.name,
            rating: place.rating || 0,
            address: place.vicinity,
            location: place.geometry?.location,
            error: 'Limited data available'
          };
        }
      })
    );

    // Filter out any null results
    const validRestaurants = enrichedRestaurants.filter(r => r && r.name);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        restaurants: validRestaurants,
        totalResults: validRestaurants.length,
        searchLocation: { lat, lng }
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        message: error.message 
      })
    };
  }
};

// Helper: Calculate vibe from Yelp reviews
function calculateVibe(reviews) {
  if (!reviews || reviews.length === 0) return 'BALANCED';

  const reviewText = reviews.map(r => r.text.toLowerCase()).join(' ');

  const loudKeywords = ['loud', 'noisy', 'busy', 'energetic', 'lively', 'buzzing', 'vibrant', 'crowded', 'party', 'music'];
  const quietKeywords = ['quiet', 'calm', 'peaceful', 'intimate', 'cozy', 'romantic', 'relaxed', 'chill', 'serene'];

  const loudScore = loudKeywords.reduce((score, keyword) => {
    const matches = (reviewText.match(new RegExp(keyword, 'g')) || []).length;
    return score + matches;
  }, 0);

  const quietScore = quietKeywords.reduce((score, keyword) => {
    const matches = (reviewText.match(new RegExp(keyword, 'g')) || []).length;
    return score + matches;
  }, 0);

  if (loudScore > quietScore * 1.5) return 'LIVELY';
  if (quietScore > loudScore * 1.5) return 'QUIET';
  return 'BALANCED';
}

// Helper: Determine cuisine from categories
function determineCuisine(categories) {
  const categoryList = Array.isArray(categories) 
    ? categories.map(c => (c.alias || c).toLowerCase())
    : categories.toString().toLowerCase();

  if (categoryList.includes('italian')) return 'italian';
  if (categoryList.includes('japanese') || categoryList.includes('sushi')) return 'japanese';
  if (categoryList.includes('korean')) return 'korean';
  if (categoryList.includes('french')) return 'french';
  if (categoryList.includes('mexican')) return 'mexican';
  if (categoryList.includes('chinese')) return 'chinese';
  if (categoryList.includes('thai')) return 'thai';
  if (categoryList.includes('indian')) return 'indian';
  if (categoryList.includes('steakhouse') || categoryList.includes('steak')) return 'steakhouse';
  if (categoryList.includes('seafood')) return 'seafood';
  
  return 'american';
}

// Helper: Calculate distance between two coordinates (in miles)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Check if restaurant has Michelin recognition
function checkMichelin(categories) {
  const categoryStr = categories.map(c => c.alias || c).join(',').toLowerCase();
  return categoryStr.includes('michelin');
}

// Helper: Check if restaurant has Bib Gourmand
function checkBibGourmand(categories) {
  const categoryStr = categories.map(c => c.alias || c).join(',').toLowerCase();
  return categoryStr.includes('bib') || categoryStr.includes('gourmand');
}

// Helper: Determine quality level
function determineQualityLevel(rating, reviewCount) {
  if (!rating) return 'yelp45';
  if (rating >= 4.6) return 'yelp46';
  if (rating >= 4.0) return 'yelp45';
  return 'yelp45';
}
