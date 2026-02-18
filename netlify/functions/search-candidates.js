// Deterministic 1-mile grid coverage with full pagination
// Two-tier filtering: Elite (4.6+) and More Options (4.4+)
// Global chain exclusion for both tiers
function filterRestaurantsByTier(candidates) {
  const KNOWN_CHAINS = [
    'chopt', 'just salad', 'dos toros', 'sweetgreen', 'shake shack', 'chipotle',
    'dig', 'cava', 'five guys', 'mcdonald', 'starbucks', 'dunkin', 'panera',
    'subway', 'taco bell', 'kfc', 'wendy', 'popeyes', 'panda express',
    'little caesars', 'domino', 'pizza hut', 'burger king', 'arbys'
  ];

  const HARD_JUNK_TYPES = [
    'food_truck', 'convenience_store', 'grocery_or_supermarket', 
    'market', 'vending_machine', 'store'
  ];

  const NAME_KEYWORDS_EXCLUDE = [
    'food truck', 'cart', 'truck', 'kiosk', 'deli'
  ];

  // Chain detection (hybrid approach)
  function isChain(place) {
    const nameLower = (place.name || '').toLowerCase();
    const types = Array.isArray(place.types) ? place.types : [];
    const price = place.price_level ?? null;
    const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;

    // 1) Known chain keyword list
    for (const chain of KNOWN_CHAINS) {
      if (nameLower.includes(chain)) return true;
    }

    // 2) Heuristic chain detection (for unlisted chains)
    if (price !== null && price <= 1 && reviews >= 150) {
      if (types.includes('meal_takeaway') || types.includes('fast_food_restaurant')) {
        return true;
      }
    }

    return false;
  }

  const elite = [];
  const moreOptions = [];
  const excluded = [];

  candidates.forEach(place => {
    try {
      const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;
      const rating = place.googleRating ?? place.rating ?? 0;
      const nameLower = (place.name || '').toLowerCase();
      const types = Array.isArray(place.types) ? place.types : [];
      let excludeReason = null;

      // Check hard junk (always exclude)
      for (const junkType of HARD_JUNK_TYPES) {
        if (types.includes(junkType)) { 
          excludeReason = `hard_junk: ${junkType}`; 
          break; 
        }
      }

      // Meal takeaway-only (unless also restaurant)
      if (!excludeReason && types.includes('meal_takeaway') && !types.includes('restaurant')) {
        excludeReason = 'meal_takeaway-only';
      }

      // Name keyword exclusions (deli, cart, etc)
      if (!excludeReason) {
        for (const kw of NAME_KEYWORDS_EXCLUDE) {
          if (nameLower.includes(kw)) { 
            excludeReason = `name_keyword: "${kw}"`; 
            break; 
          }
        }
      }

      // Global chain filter (both tiers)
      if (!excludeReason && isChain(place)) {
        excludeReason = 'chain_restaurant';
      }

      if (excludeReason) {
        excluded.push({ 
          place_id: place.place_id, 
          name: place.name, 
          rating, 
          reviews, 
          reason: excludeReason 
        });
        return;
      }

      // ELITE (4.6+) - Strict filtering
      if (rating >= 4.6) {
        const isMichelinListed = false; // Placeholder for Michelin API
        let passElite = false;

        if (isMichelinListed) {
          passElite = true;
        } else if (reviews >= 30) {
          passElite = true;
        } else if (rating >= 4.8 && reviews >= 20) {
          passElite = true;
        }

        if (passElite) {
          elite.push(place);
        } else {
          excluded.push({ 
            place_id: place.place_id, 
            name: place.name, 
            rating, 
            reviews, 
            reason: `elite_low_reviews (${reviews}, need 30+)` 
          });
        }
      }
      // MORE OPTIONS (4.4-4.59) - Lighter filtering
      else if (rating >= 4.4) {
        let passMoreOptions = false;

        if (reviews >= 10) {
          passMoreOptions = true;
        } else if (rating >= 4.7 && reviews >= 5) {
          passMoreOptions = true;
        }

        if (passMoreOptions) {
          moreOptions.push(place);
        } else {
          excluded.push({ 
            place_id: place.place_id, 
            name: place.name, 
            rating, 
            reviews, 
            reason: `more_options_low_reviews (${reviews}, need 10+)` 
          });
        }
      }
      // Below 4.4 - exclude
      else {
        excluded.push({ 
          place_id: place.place_id, 
          name: place.name, 
          rating, 
          reviews, 
          reason: 'rating_below_4.4' 
        });
      }
    } catch (err) {
      console.error('Error filtering place:', place.name, err);
      excluded.push({
        place_id: place.place_id,
        name: place.name,
        rating: 0,
        reviews: 0,
        reason: `filter_error: ${err.message}`
      });
    }
  });

  return { elite, moreOptions, excluded };
}

exports.handler = async (event, context) => {
  // Stable response shape - always return this structure
  const stableResponse = (elite = [], moreOptions = [], stats = {}, error = null) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elite: Array.isArray(elite) ? elite : [],
      moreOptions: Array.isArray(moreOptions) ? moreOptions : [],
      confirmedAddress: stats.confirmedAddress || null,
      userLocation: stats.userLocation || null,
      stats: stats,
      error: error
    })
  });

  try {
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

    console.log('=== DETERMINISTIC 1-MILE GRID SEARCH ===');

    // Geocode the input location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidates: [], confirmedAddress: null }) };
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;
    const locationType = geocodeData.results[0].geometry.location_type;

    console.log('Initial geocode:', { lat, lng, locationType, address: confirmedAddress });

    // If input looks like raw GPS coordinates (lat,lng format), apply reverse-geocoding normalization
    const isRawGPS = location.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
    
    if (isRawGPS) {
      console.log('Detected raw GPS input - applying reverse-geocode normalization');
      const reverseUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=street_address|premise&key=${GOOGLE_API_KEY}`;
      const reverseResponse = await fetch(reverseUrl);
      const reverseData = await reverseResponse.json();
      
      if (reverseData.status === 'OK' && reverseData.results[0]) {
        const rooftopResult = reverseData.results[0];
        const oldLat = lat;
        const oldLng = lng;
        lat = rooftopResult.geometry.location.lat;
        lng = rooftopResult.geometry.location.lng;
        
        // Calculate delta distance
        const R = 3959 * 5280; // Earth radius in feet
        const dLat = (lat - oldLat) * Math.PI / 180;
        const dLon = (lng - oldLng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(oldLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const deltaFeet = R * c;
        
        console.log('GPS normalized via reverse-geocode:', { 
          oldCoords: { lat: oldLat, lng: oldLng },
          newCoords: { lat, lng },
          deltaFeet: Math.round(deltaFeet),
          rooftopAddress: rooftopResult.formatted_address
        });
      }
    }

    // Normalize coordinates to 4 decimal places (~11 meters precision)
    // Maintains correctness while preventing micro-GPS drift from creating new grids
    const normalizedLat = Math.round(lat * 10000) / 10000;
    const normalizedLng = Math.round(lng * 10000) / 10000;
    
    console.log('=== COORDINATE DEBUG ===');
    console.log('1) RAW ORIGIN:', { lat, lng });
    console.log('2) NORMALIZED ORIGIN (4-decimal):', { lat: normalizedLat, lng: normalizedLng });
    console.log('Address:', confirmedAddress);
    
    // Calculate how far apart the raw coords are from normalized
    const normDeltaLat = Math.abs(lat - normalizedLat);
    const normDeltaLng = Math.abs(lng - normalizedLng);
    const normDeltaFeet = Math.sqrt(normDeltaLat * normDeltaLat + normDeltaLng * normDeltaLng) * 69 * 5280;
    console.log('Normalization delta:', Math.round(normDeltaFeet), 'feet');
    console.log('========================');

    // Use normalized coords for grid generation
    const gridLat = normalizedLat;
    const gridLng = normalizedLng;

    // Generate optimized 9-node grid for NYC coverage
    // Node radius: 750m, spacing: 600m (~0.37 miles)
    const gridRadius = 750; // meters per search node
    const spacingMiles = 0.37; // 600 meters
    const spacingDegrees = spacingMiles / 69;
    
    const gridPoints = [
      { lat: gridLat, lng: gridLng, label: 'Center' },
      { lat: gridLat + spacingDegrees, lng: gridLng, label: 'North' },
      { lat: gridLat - spacingDegrees, lng: gridLng, label: 'South' },
      { lat: gridLat, lng: gridLng + spacingDegrees, label: 'East' },
      { lat: gridLat, lng: gridLng - spacingDegrees, label: 'West' },
      { lat: gridLat + spacingDegrees, lng: gridLng + spacingDegrees, label: 'NE' },
      { lat: gridLat + spacingDegrees, lng: gridLng - spacingDegrees, label: 'NW' },
      { lat: gridLat - spacingDegrees, lng: gridLng + spacingDegrees, label: 'SE' },
      { lat: gridLat - spacingDegrees, lng: gridLng - spacingDegrees, label: 'SW' }
    ];

    console.log('Grid: 9 nodes, 750m radius per node, 600m spacing');

    // Fetch with FULL pagination and retry logic
    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`${label}: API error ${data.status}`);
        return [];
      }
      
      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;
      let pageCount = 1;

      // Paginate until no more pages
      while (nextPageToken) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Required delay
        
        let retries = 0;
        let pageData = null;
        
        // Retry logic for INVALID_REQUEST
        while (retries < 5) {
          const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
          const pageResponse = await fetch(pageUrl);
          pageData = await pageResponse.json();
          
          if (pageData.status === 'INVALID_REQUEST') {
            retries++;
            console.log(`${label}: INVALID_REQUEST retry ${retries}/5`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          break;
        }
        
        if (pageData && pageData.results) {
          allResults = allResults.concat(pageData.results);
          pageCount++;
        }
        
        nextPageToken = pageData?.next_page_token;
        
        // Safety: max 3 pages per node
        if (pageCount >= 3) break;
      }

      console.log(`${label}: ${allResults.length} results (${pageCount} pages)`);
      return allResults;
    }

    // Fetch from all grid points in parallel
    const gridFetches = gridPoints.map(point => 
      fetchWithFullPagination(point.lat, point.lng, point.label)
    );
    const gridResults = await Promise.all(gridFetches);

    // Merge and dedupe by place_id ONLY
    const seenIds = new Set();
    const allCandidates = [];
    let totalRaw = 0;

    gridResults.forEach(results => {
      totalRaw += results.length;
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    });

    console.log('Total raw results:', totalRaw);
    console.log('3) UNIQUE PLACES (after dedupe, BEFORE filters):', allCandidates.length);
    
    // Log first 10 place_ids for comparison
    console.log('Sample place_ids:', allCandidates.slice(0, 10).map(p => p.place_id).join(', '));

    // Calculate straight-line distance for sorting (using normalized origin)
    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959; // miles
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(gridLat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distMiles = R * c;

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
        walkMinEstimate: Math.round(distMiles * 20),
        driveMinEstimate: Math.round(distMiles * 4),
        transitMinEstimate: Math.round(distMiles * 6)
      };
    });

    // Filter: within 1 mile
    const within1Mile = candidatesWithDistance.filter(r => r.distanceMiles <= 1.0);
    console.log('Within 1 mile:', within1Mile.length);
    
    // Apply Two-Tier filtering: Elite (4.6+) and More Options (4.4+)
    const { elite, moreOptions, excluded: tierExcluded } = filterRestaurantsByTier(within1Mile);
    
    console.log('=== TWO-TIER FILTERING ===');
    console.log('Within 1 mile:', within1Mile.length);
    console.log('Elite (4.6+):', elite.length);
    console.log('More Options (4.4+):', moreOptions.length);
    console.log('Excluded:', tierExcluded.length);
    
    if (tierExcluded.length > 0) {
      console.log('Excluded items:');
      tierExcluded.slice(0, 10).forEach(item => {
        console.log(`  - ${item.name} (${item.rating}⭐, ${item.reviews} reviews) - ${item.reason}`);
      });
    }
    console.log('===========================');
    
    // Sort both tiers: walk_time ASC, rating DESC, review_count DESC
    const sortByWalkTime = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return a.name.localeCompare(b.name);
    };
    
    elite.sort(sortByWalkTime);
    moreOptions.sort(sortByWalkTime);
    
    console.log('Returning Elite:', elite.length, 'More Options:', moreOptions.length);

    return stableResponse(elite, moreOptions, {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      within1Mile: within1Mile.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: tierExcluded.length,
      normalizedCoords: { lat: gridLat, lng: gridLng },
      rawCoords: { lat, lng },
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng }
    }, null);

  } catch (error) {
    console.error('ERROR in search-candidates:', error);
    return stableResponse([], [], {}, error.message);
  }
  } catch (outerError) {
    console.error('FATAL ERROR:', outerError);
    return stableResponse([], [], {}, outerError.message);
  }
};
