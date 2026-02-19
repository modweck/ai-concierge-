// netlify/functions/search-candidates.js
// Deterministic 1-mile grid coverage with full pagination
// Two-tier filtering: Elite (4.6+) and More Options (4.4+)
// Global chain exclusion for both tiers
// Michelin overlay (badge only - does not change candidate pool)

const fs = require('fs');
const path = require('path');

// --------------------
// MICHELIN LOADING (robust + debug)
// --------------------
let MICHELIN_DATA = [];

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[Michelin] Failed to read/parse ${filePath}:`, e.message);
    return null;
  }
}

function loadMichelinOnce() {
  console.log('[Michelin] __dirname:', __dirname);
  try {
    console.log('[Michelin] Files in __dirname:', fs.readdirSync(__dirname));
  } catch (e) {
    console.log('[Michelin] Could not read __dirname:', e.message);
  }

  // Try a few common places (Netlify bundling can be quirky)
  const candidates = [
    path.join(__dirname, 'michelin_nyc.json'),                // same folder as function
    path.join(process.cwd(), 'michelin_nyc.json'),            // repo root
    path.join(process.cwd(), 'data', 'michelin_nyc.json'),    // /data folder
    path.join(__dirname, '..', '..', 'data', 'michelin_nyc.json') // relative fallback
  ];

  for (const p of candidates) {
    const json = safeReadJson(p);
    if (Array.isArray(json)) {
      MICHELIN_DATA = json;
      console.log(`[Michelin] ✅ Loaded ${MICHELIN_DATA.length} entries from: ${p}`);
      return;
    }
  }

  console.warn('[Michelin] ⚠️ Michelin data not found in any expected path. Continuing without Michelin.');
}

loadMichelinOnce();

// Normalize name for matching
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match Michelin data to candidates (badge overlay only)
function attachMichelinData(candidates) {
  if (!MICHELIN_DATA.length) return candidates;

  candidates.forEach(place => {
    if (!place || !place.name) return;

    const placeName = normalizeName(place.name);

    for (const michelin of MICHELIN_DATA) {
      const michelinName = normalizeName(michelin.name);

      // 1) Exact normalized name match
      if (placeName === michelinName) {
        place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
        return;
      }

      // 2) Contains match (avoid obvious false positives)
      if (placeName.includes(michelinName) || michelinName.includes(placeName)) {
        if (Math.abs(placeName.length - michelinName.length) <= 5) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }

      // 3) Coordinate proximity (within 50 meters)
      if (michelin.lat && michelin.lng && place.geometry?.location) {
        const R = 6371000; // meters
        const dLat = (place.geometry.location.lat - michelin.lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - michelin.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(michelin.lat * Math.PI / 180) *
          Math.cos(place.geometry.location.lat * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance <= 50) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }
    }
  });

  return candidates;
}

// --------------------
// In-memory cache with 10-minute TTL
// --------------------
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

// IMPORTANT: include cuisine/openNow in cache key, and bump version to bust old cache
function getCacheKey(location, qualityMode, walkMinutes, cuisine, openNow) {
  const c = cuisine ? cuisine.toLowerCase().trim() : '';
  const o = openNow ? '1' : '0';
  return `${location}_${qualityMode}_${walkMinutes}_${c}_${o}`;
}

function getFromCache(key) {
  const cached = resultCache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }

  console.log(`Cache HIT (age: ${Math.round(age / 1000)}s)`);
  return cached.data;
}

function setCache(key, data) {
  resultCache.set(key, { data, timestamp: Date.now() });

  if (resultCache.size > 100) {
    const oldest = Array.from(resultCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    resultCache.delete(oldest[0]);
  }
}

// --------------------
// Filtering
// --------------------
function filterRestaurantsByTier(candidates) {
  const KNOWN_CHAINS = [
    'chopt', 'just salad', 'dos toros', 'sweetgreen', 'shake shack', 'chipotle',
    'dig', 'cava', 'five guys', 'mcdonald', 'starbucks', 'dunkin', 'panera',
    'subway', 'taco bell', 'kfc', 'wendy', 'popeyes', 'panda express',
    'domino', 'pizza hut', 'burger king', 'arbys', 'white castle', 'sonic'
  ];

  const HARD_JUNK_TYPES = [
    'food_truck', 'convenience_store', 'grocery_or_supermarket',
    'market', 'vending_machine', 'store'
  ];

  const NAME_KEYWORDS_EXCLUDE = ['food truck', 'cart', 'truck', 'kiosk'];

  const FAST_CASUAL_NAMES = ['wrap-n-run', 'dumpling shop'];

  function isChain(place) {
    const nameLower = (place.name || '').toLowerCase();
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
      const nameLower = (place.name || '').toLowerCase();
      const types = Array.isArray(place.types) ? place.types : [];
      const isMichelinListed = false; // you can set this true if you want Michelin to bypass review-count checks
      let excludeReason = null;

      if (!isMichelinListed) {
        if (rating >= 4.9 && reviews < 50) {
          excludeReason = `fake_5.0_prevention (${rating}⭐ with only ${reviews} reviews, need 50+)`;
        } else if (rating >= 4.6 && rating < 4.9 && reviews < 10) {
          excludeReason = `low_review_count (${rating}⭐ with ${reviews} reviews, need 10+)`;
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
        if (types.includes('street_food')) {
          excludeReason = 'street_food';
        } else if (types.includes('meal_takeaway') && !types.includes('restaurant')) {
          excludeReason = 'meal_takeaway-only';
        }
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
        for (const n of FAST_CASUAL_NAMES) {
          if (nameLower.includes(n)) {
            excludeReason = `fast_casual_name: "${n}"`;
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

        if (passMoreOptions) moreOptions.push(place);
        else {
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

// --------------------
// Netlify handler
// --------------------
exports.handler = async (event, context) => {
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

    const t0 = Date.now();
    const timings = { places_fetch_ms: 0, filtering_ms: 0, total_ms: 0 };

    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!location) {
      return stableResponse([], [], {}, 'Missing "location"');
    }

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // 🚨 CACHE BUST: bump v6 -> v7
    const cacheKey = getCacheKey(location, 'all', 20, cuisine, openNow) + '_v7';
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

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return stableResponse([], [], { confirmedAddress: null }, null);
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;
    const locationType = geocodeData.results[0].geometry.location_type;

    console.log('Initial geocode:', { lat, lng, locationType, address: confirmedAddress });

    const isRawGPS = typeof location === 'string' && location.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);

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

        const R = 3959 * 5280;
        const dLat = (lat - oldLat) * Math.PI / 180;
        const dLon = (lng - oldLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(oldLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const deltaFeet = R * c;

        console.log('GPS normalized via reverse-geocode:', {
          oldCoords: { lat: oldLat, lng: oldLng },
          newCoords: { lat, lng },
          deltaFeet: Math.round(deltaFeet),
          rooftopAddress: rooftopResult.formatted_address
        });
      }
    }

    const normalizedLat = Math.round(lat * 10000) / 10000;
    const normalizedLng = Math.round(lng * 10000) / 10000;

    console.log('=== COORDINATE DEBUG ===');
    console.log('1) RAW ORIGIN:', { lat, lng });
    console.log('2) NORMALIZED ORIGIN (4-decimal):', { lat: normalizedLat, lng: normalizedLng });
    console.log('Address:', confirmedAddress);

    const normDeltaLat = Math.abs(lat - normalizedLat);
    const normDeltaLng = Math.abs(lng - normalizedLng);
    const normDeltaFeet = Math.sqrt(normDeltaLat * normDeltaLat + normDeltaLng * normDeltaLng) * 69 * 5280;
    console.log('Normalization delta:', Math.round(normDeltaFeet), 'feet');
    console.log('========================');

    const gridLat = normalizedLat;
    const gridLng = normalizedLng;

    const gridRadius = 750;
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

    console.log('Grid: 9 nodes, 750m radius per node, 600m spacing');

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

        if (pageData && pageData.results) {
          allResults = allResults.concat(pageData.results);
          pageCount++;
        }

        nextPageToken = pageData?.next_page_token;
      }

      console.log(`${label}: ${allResults.length} results (${pageCount} pages)`);
      return allResults;
    }

    const placesStart = Date.now();
    const gridFetches = gridPoints.map(point => fetchWithFullPagination(point.lat, point.lng, point.label));
    const gridResults = await Promise.all(gridFetches);
    timings.places_fetch_ms = Date.now() - placesStart;
    console.log(`⏱️ Places API fetch: ${timings.places_fetch_ms}ms`);

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

    allCandidates.sort((a, b) => a.place_id.localeCompare(b.place_id));
    console.log('Sorted by place_id for determinism');
    console.log('Sample place_ids:', allCandidates.slice(0, 10).map(p => p.place_id).join(', '));

    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959; // miles
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(gridLat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    console.log('Within 1.3 miles:', within1Mile.length);

    if (within1Mile.length > 0) {
      console.log('=== SAMPLE CANDIDATES BEFORE FILTERING ===');
      within1Mile.slice(0, 3).forEach(c => {
        console.log(`${c.name}: ${c.googleRating}⭐ (${c.googleReviewCount} reviews)`);
      });
    }

    const filterStartTime = Date.now();
    const { elite, moreOptions, excluded: tierExcluded } = filterRestaurantsByTier(within1Mile);

    // Attach Michelin badges to filtered results
    attachMichelinData(elite);
    attachMichelinData(moreOptions);

    console.log('=== TWO-TIER FILTERING ===');
    console.log('Within 1.3 miles:', within1Mile.length);
    console.log('Elite (4.6+):', elite.length);
    console.log('More Options (4.4+):', moreOptions.length);
    console.log('Excluded:', tierExcluded.length);

    const sortByWalkTime = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return a.name.localeCompare(b.name);
    };

    elite.sort(sortByWalkTime);
    moreOptions.sort(sortByWalkTime);

    timings.filtering_ms = Date.now() - filterStartTime;
    timings.total_ms = Date.now() - t0;

    // quick sanity metric for Michelin overlay
    const eliteMichelin = elite.filter(p => !!p.michelin).length;
    const moreMichelin = moreOptions.filter(p => !!p.michelin).length;
    console.log(`[Michelin] Badges attached: elite=${eliteMichelin}, moreOptions=${moreMichelin}`);

    console.log('Returning Elite:', elite.length, 'More Options:', moreOptions.length);
    console.log('=== PERFORMANCE ===');
    console.log(`places_fetch_ms: ${timings.places_fetch_ms}ms`);
    console.log(`filtering_ms: ${timings.filtering_ms}ms`);
    console.log(`total_ms: ${timings.total_ms}ms`);
    console.log('cache_hit: false');
    console.log('===================');

    const result = {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      within1Mile: within1Mile.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: tierExcluded.length,
      normalizedCoords: { lat: gridLat, lng: gridLng },
      rawCoords: { lat, lng },
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      michelinLoaded: MICHELIN_DATA.length,
      performance: {
        ...timings,
        cache_hit: false,
        cache_key: cacheKey,
        candidates_before_dm: elite.length + moreOptions.length
      }
    };

    setCache(cacheKey, { elite, moreOptions, stats: result });

    return stableResponse(elite, moreOptions, result, null);
  } catch (error) {
    console.error('ERROR in search-candidates:', error);
    return stableResponse([], [], {}, error.message);
  }
};
