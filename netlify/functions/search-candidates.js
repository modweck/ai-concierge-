// Deterministic 1-mile grid coverage with full pagination
// Two-tier filtering: Elite (4.6+) and More Options (4.4+)
// Global chain exclusion for both tiers
// Michelin overlay (badge only - does not change candidate pool)

const fs = require('fs');
const path = require('path');

// Load Michelin data once at startup
let MICHELIN_DATA = [];
try {
  const michelinPath = path.join(__dirname, 'michelin_nyc.json');
  MICHELIN_DATA = JSON.parse(fs.readFileSync(michelinPath, 'utf8'));
  console.log(`Loaded ${MICHELIN_DATA.length} Michelin entries`);
} catch (err) {
  console.warn('Michelin data not found or invalid, continuing without:', err.message);
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match Michelin data to candidates (badge overlay only)
function attachMichelinData(candidates) {
  if (!MICHELIN_DATA.length) return;
  if (!Array.isArray(candidates)) return;

  candidates.forEach(place => {
    const placeName = normalizeName(place.name);

    for (const michelin of MICHELIN_DATA) {
      const michelinName = normalizeName(michelin.name);

      // 1) Exact normalized name match
      if (placeName === michelinName) {
        place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
        return;
      }

      // 2) Contains match with length guard
      if (placeName.includes(michelinName) || michelinName.includes(placeName)) {
        if (Math.abs(placeName.length - michelinName.length) <= 5) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }

      // 3) Coordinate proximity (within 50 meters)
      if (michelin.lat && michelin.lng && place.geometry?.location) {
        const R = 6371000;
        const dLat = (place.geometry.location.lat - michelin.lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - michelin.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(michelin.lat * Math.PI / 180) *
          Math.cos(place.geometry.location.lat * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;

        if (distance <= 50) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }
    }
  });
}

// In-memory cache with 10-minute TTL
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey({ location, cuisine, openNow }) {
  // include key inputs so caching isn't lying
  return `loc=${location}|cuisine=${cuisine || 'any'}|openNow=${openNow ? '1' : '0'}`;
}

function getFromCache(key) {
  const cached = resultCache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }

  console.log(`Cache HIT (age: ${Math.round(age/1000)}s)`);
  return cached.data;
}

function setCache(key, data) {
  resultCache.set(key, { data, timestamp: Date.now() });

  if (resultCache.size > 100) {
    const oldest = Array.from(resultCache.entries())
      .sort((a,b)=>a[1].timestamp - b[1].timestamp)[0];
    resultCache.delete(oldest[0]);
  }
}

function filterRestaurantsByTier(candidates) {
  const KNOWN_CHAINS = [
    'chopt','just salad','dos toros','sweetgreen','shake shack','chipotle',
    'dig','cava','five guys','mcdonald','starbucks','dunkin','panera',
    'subway','taco bell','kfc','wendy','popeyes','panda express',
    'domino','pizza hut','burger king','arbys','white castle','sonic'
  ];

  const HARD_JUNK_TYPES = [
    'food_truck','convenience_store','grocery_or_supermarket',
    'market','vending_machine','store'
  ];

  const NAME_KEYWORDS_EXCLUDE = ['food truck','cart','truck','kiosk','deli'];
  const FAST_CASUAL_NAMES = ['wrap-n-run','dumpling shop'];

  function isChain(place) {
    const nameLower = String(place.name || '').toLowerCase();
    const types = Array.isArray(place.types) ? place.types : [];
    const price = place.price_level ?? null;
    const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;

    for (const chain of KNOWN_CHAINS) {
      if (nameLower.includes(chain)) return { isChain: true, reason: `known_chain: ${chain}` };
    }

    if (price !== null && price <= 1 && reviews >= 150) {
      if (types.includes('meal_takeaway') || types.includes('fast_food_restaurant')) {
        return { isChain: true, reason: 'heuristic_chain (low_price + high_reviews + takeaway/fast_food)' };
      }
    }

    return { isChain: false, reason: null };
  }

  const elite = [];
  const moreOptions = [];
  const excluded = [];

  candidates.forEach(place => {
    try {
      const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;
      const rating = place.googleRating ?? place.rating ?? 0;
      const nameLower = String(place.name || '').toLowerCase();
      const types = Array.isArray(place.types) ? place.types : [];
      const isMichelinListed = false; // overlay-only for now
      let excludeReason = null;

      if (!isMichelinListed) {
        if (rating >= 4.9 && reviews < 50) {
          excludeReason = `fake_5.0_prevention (${rating}⭐ with only ${reviews} reviews, need 50+)`;
        } else if (rating >= 4.6 && rating < 4.9 && reviews < 30) {
          excludeReason = `low_review_count (${rating}⭐ with ${reviews} reviews, need 30+)`;
        }
      }

      if (!excludeReason) {
        for (const junkType of HARD_JUNK_TYPES) {
          if (types.includes(junkType)) {
            excludeReason = `hard_junk: ${junkType}`;
            break;
          }
        }
      }

      if (!excludeReason) {
        if (types.includes('street_food')) excludeReason = 'street_food';
        else if (types.includes('meal_takeaway') && !types.includes('restaurant')) excludeReason = 'meal_takeaway-only';
      }

      if (!excludeReason) {
        if (nameLower.includes('halal') && reviews < 200) excludeReason = 'halal_cart (low_reviews)';
      }

      if (!excludeReason) {
        for (const kw of NAME_KEYWORDS_EXCLUDE) {
          if (nameLower.includes(kw)) {
            excludeReason = `name_keyword: "${kw}"`;
            break;
          }
        }
      }

      if (!excludeReason) {
        for (const name of FAST_CASUAL_NAMES) {
          if (nameLower.includes(name)) {
            excludeReason = `fast_casual_name: "${name}"`;
            break;
          }
        }
      }

      if (!excludeReason) {
        const price = place.price_level ?? null;
        if (price !== null && price <= 1 && types.includes('meal_takeaway')) {
          excludeReason = 'takeout_grill (low_price + meal_takeaway)';
        }
      }

      if (!excludeReason) {
        const chainCheck = isChain(place);
        if (chainCheck.isChain) excludeReason = chainCheck.reason;
      }

      if (excludeReason) {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: types.join(', '),
          reason: excludeReason
        });
        return;
      }

      if (rating >= 4.6) {
        elite.push(place);
      } else if (rating >= 4.4) {
        let passMoreOptions = false;
        if (reviews >= 10) passMoreOptions = true;
        else if (rating >= 4.7 && reviews >= 5) passMoreOptions = true;

        if (passMoreOptions) {
          moreOptions.push(place);
        } else {
          excluded.push({
            place_id: place.place_id,
            name: place.name,
            rating,
            reviews,
            types: types.join(', '),
            reason: `more_options_low_reviews (${reviews}, need 10+)`
          });
        }
      } else {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: types.join(', '),
          reason: 'rating_below_4.4'
        });
      }
    } catch (err) {
      console.error('Error filtering place:', place?.name, err);
      excluded.push({
        place_id: place?.place_id,
        name: place?.name,
        rating: 0,
        reviews: 0,
        types: '',
        reason: `filter_error: ${err.message}`
      });
    }
  });

  return { elite, moreOptions, excluded };
}

exports.handler = async (event) => {
  const stableResponse = (elite = [], moreOptions = [], stats = {}, error = null) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elite: Array.isArray(elite) ? elite : [],
      moreOptions: Array.isArray(moreOptions) ? moreOptions : [],
      confirmedAddress: stats.confirmedAddress || null,
      userLocation: stats.userLocation || null,
      stats,
      error
    })
  });

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const t0 = Date.now();
    const timings = { places_fetch_ms: 0, filtering_ms: 0, total_ms: 0 };

    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow } = body;

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) {
      return stableResponse([], [], { performance: { ...timings, total_ms: Date.now() - t0 } }, 'API key not configured (GOOGLE_PLACES_API_KEY)');
    }

    const cacheKey = getCacheKey({ location, cuisine, openNow }) + '|v5';
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) {
      timings.total_ms = Date.now() - t0;
      return stableResponse(
        cachedResult.elite,
        cachedResult.moreOptions,
        { ...cachedResult.stats, cached: true, performance: { ...timings, cache_hit: true } },
        null
      );
    }

    console.log('=== DETERMINISTIC 1-MILE GRID SEARCH ===');

    // 1) Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      console.log('GEOCODE FAILED:', {
        status: geocodeData.status,
        error_message: geocodeData.error_message,
        input: location
      });

      timings.total_ms = Date.now() - t0;
      return stableResponse(
        [],
        [],
        {
          confirmedAddress: null,
          userLocation: null,
          geocode: {
            status: geocodeData.status,
            error_message: geocodeData.error_message || null,
            input: location
          },
          performance: { ...timings, total_ms: timings.total_ms, cache_hit: false }
        },
        `Geocode failed: ${geocodeData.status}${geocodeData.error_message ? ' - ' + geocodeData.error_message : ''}`
      );
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;
    const locationType = geocodeData.results[0].geometry.location_type;

    console.log('Initial geocode:', { lat, lng, locationType, confirmedAddress });

    // 2) Normalize raw GPS if user types "lat,lng"
    const isRawGPS = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(String(location || '').trim());
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

        console.log('GPS normalized via reverse-geocode:', {
          oldCoords: { lat: oldLat, lng: oldLng },
          newCoords: { lat, lng },
          rooftopAddress: rooftopResult.formatted_address
        });
      }
    }

    // 3) Deterministic origin rounding
    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;

    console.log('Normalized origin:', { gridLat, gridLng });

    // Grid configuration
    const gridRadius = 750; // meters per node
    const spacingMiles = 0.37;
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

    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`${label}: Places API error ${data.status}`, data.error_message || '');
        return [];
      }

      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;
      let pageCount = 1;

      const MAX_PAGES = 3;
      while (nextPageToken && pageCount < MAX_PAGES) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        let retries = 0;
        let pageData = null;

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

        if (pageData?.results) {
          allResults = allResults.concat(pageData.results);
          pageCount++;
        }

        nextPageToken = pageData?.next_page_token;
      }

      console.log(`${label}: ${allResults.length} results (${pageCount} pages)`);
      return allResults;
    }

    // 4) Fetch all grid points
    const placesStart = Date.now();
    const gridFetches = gridPoints.map(p => fetchWithFullPagination(p.lat, p.lng, p.label));
    const gridResults = await Promise.all(gridFetches);
    timings.places_fetch_ms = Date.now() - placesStart;

    // 5) Dedupe deterministically
    const seenIds = new Set();
    const allCandidates = [];
    let totalRaw = 0;

    gridResults.forEach(results => {
      totalRaw += results.length;
      results.forEach(place => {
        if (place?.place_id && !seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    });

    allCandidates.sort((a,b)=>String(a.place_id).localeCompare(String(b.place_id)));

    // 6) Add distance estimates + core fields
    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959;
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
        types: place.types || [],
        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        distanceMiles: Math.round(distMiles * 10) / 10,
        walkMinEstimate: Math.round(distMiles * 20),
        driveMinEstimate: Math.round(distMiles * 4),
        transitMinEstimate: Math.round(distMiles * 6)
      };
    });

    const within1Mile = candidatesWithDistance.filter(r => r.distanceMiles <= 1.3);

    // 7) Tier filter
    const filterStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within1Mile);
    attachMichelinData([...elite, ...moreOptions]);

    const sortByWalkTime = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };
    elite.sort(sortByWalkTime);
    moreOptions.sort(sortByWalkTime);

    timings.filtering_ms = Date.now() - filterStart;
    timings.total_ms = Date.now() - t0;

    const stats = {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      within1Mile: within1Mile.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: excluded.length,
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      performance: {
        ...timings,
        cache_hit: false,
        cache_key: cacheKey,
        candidates_before_dm: elite.length + moreOptions.length
      }
    };

    setCache(cacheKey, { elite, moreOptions, stats });

    return stableResponse(elite, moreOptions, stats, null);

  } catch (err) {
    console.error('ERROR in search-candidates:', err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elite: [],
        moreOptions: [],
        confirmedAddress: null,
        userLocation: null,
        stats: {},
        error: err.message || 'Unknown error'
      })
    };
  }
};
