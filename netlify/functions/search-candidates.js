// Deterministic 1-mile grid coverage with full pagination
// Two-tier filtering: Elite (4.6+) and More Options (4.4+)
// Global chain exclusion for both tiers
// Michelin overlay (badge only - does not change candidate pool)

const fs = require('fs');
const path = require('path');

// -------------------- MICHELIN LOADING --------------------
let MICHELIN_DATA = [];

function safeReadJson(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    console.warn('[Michelin] JSON exists but is not an array:', jsonPath);
    return [];
  } catch (e) {
    return null; // means "could not read"
  }
}

(function loadMichelinOnce() {
  // Try the most likely location first: same folder as function
  const candidates = [
    path.join(__dirname, 'michelin_nyc.json'),
    // fallback if you keep it in /data
    path.join(__dirname, '..', '..', 'data', 'michelin_nyc.json'),
    // fallback if accidentally at repo root
    path.join(__dirname, '..', '..', 'michelin_nyc.json'),
  ];

  for (const p of candidates) {
    const data = safeReadJson(p);
    if (data) {
      MICHELIN_DATA = data;
      console.log(`[Michelin] Loaded ${MICHELIN_DATA.length} entries from: ${p}`);
      return;
    }
  }

  console.warn('[Michelin] michelin_nyc.json not found in expected locations. Michelin badges disabled.');
})();

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(addr) {
  return String(addr || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Returns how many places got a Michelin badge
function attachMichelinData(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return 0;
  if (!Array.isArray(MICHELIN_DATA) || MICHELIN_DATA.length === 0) return 0;

  const COORD_THRESHOLD_METERS = 150; // was 50 — too strict

  let matched = 0;

  for (const place of candidates) {
    if (!place || !place.name) continue;

    const placeName = normalizeName(place.name);
    const placeVicinity = normalizeAddress(place.vicinity || place.formatted_address || '');

    // Already matched? skip
    if (place.michelin) continue;

    for (const michelin of MICHELIN_DATA) {
      const michelinName = normalizeName(michelin.name);
      const michelinAddr = normalizeAddress(michelin.address || '');

      // 1) Exact normalized name match
      if (placeName && michelinName && placeName === michelinName) {
        place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
        matched++;
        break;
      }

      // 2) Name contains (with guard)
      if (placeName && michelinName && (placeName.includes(michelinName) || michelinName.includes(placeName))) {
        if (Math.abs(placeName.length - michelinName.length) <= 8) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          matched++;
          break;
        }
      }

      // 3) Address/vicinity substring match (helps a LOT)
      // Example: "70 Pine St" in vicinity, etc.
      if (placeVicinity && michelinAddr && (placeVicinity.includes(michelinAddr) || michelinAddr.includes(placeVicinity))) {
        // only trust address match if it's reasonably long to avoid random matches
        if (michelinAddr.length >= 10) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          matched++;
          break;
        }
      }

      // 4) Coordinate proximity
      const pLoc = place.geometry?.location;
      if (michelin.lat && michelin.lng && pLoc && typeof pLoc.lat === 'number' && typeof pLoc.lng === 'number') {
        const distM = haversineMeters(pLoc.lat, pLoc.lng, michelin.lat, michelin.lng);
        if (distM <= COORD_THRESHOLD_METERS) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          matched++;
          break;
        }
      }
    }
  }

  return matched;
}

// -------------------- CACHE --------------------
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, cuisine, openNow) {
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

  console.log(`Cache HIT (age: ${Math.round(age / 1000)}s)`);
  return cached.data;
}

function setCache(key, data) {
  resultCache.set(key, { data, timestamp: Date.now() });

  if (resultCache.size > 100) {
    const oldest = Array.from(resultCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    resultCache.delete(oldest[0]);
  }
}

// -------------------- FILTERING --------------------
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

      let excludeReason = null;

      // Review sanity checks
      if (rating >= 4.9 && reviews < 50) {
        excludeReason = `fake_5.0_prevention (${rating}⭐ with only ${reviews} reviews, need 50+)`;
      } else if (rating >= 4.6 && rating < 4.9 && reviews < 10) {
        excludeReason = `low_review_count (${rating}⭐ with ${reviews} reviews, need 10+)`;
      }

      // Junk types
      if (!excludeReason) {
        for (const junkType of HARD_JUNK_TYPES) {
          if (types.includes(junkType)) { excludeReason = `hard_junk: ${junkType}`; break; }
        }
      }

      // More junk rules
      if (!excludeReason) {
        if (types.includes('street_food')) excludeReason = 'street_food';
        else if (types.includes('meal_takeaway') && !types.includes('restaurant')) excludeReason = 'meal_takeaway-only';
      }

      // Name keyword excludes
      if (!excludeReason) {
        for (const kw of NAME_KEYWORDS_EXCLUDE) {
          if (nameLower.includes(kw)) { excludeReason = `name_keyword: "${kw}"`; break; }
        }
      }

      // Fast casual list
      if (!excludeReason) {
        for (const n of FAST_CASUAL_NAMES) {
          if (nameLower.includes(n)) { excludeReason = `fast_casual_name: "${n}"`; break; }
        }
      }

      // Takeout grill heuristic
      if (!excludeReason) {
        const price = place.price_level ?? null;
        if (price !== null && price <= 1 && types.includes('meal_takeaway')) excludeReason = 'takeout_grill (low_price + meal_takeaway)';
      }

      // Chain check
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
        let pass = false;
        if (reviews >= 10) pass = true;
        else if (rating >= 4.7 && reviews >= 5) pass = true;

        if (pass) moreOptions.push(place);
        else excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: types.join(', '),
          reason: `more_options_low_reviews (${reviews}, need 10+)`
        });
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

  console.log('SIMPLIFIED FILTER RESULTS:');
  console.log(`  Elite (4.6+): ${elite.length}`);
  console.log(`  More Options (4.4+): ${moreOptions.length}`);
  console.log(`  Excluded: ${excluded.length}`);

  return { elite, moreOptions, excluded };
}

// -------------------- HANDLER --------------------
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

    // 🔥 BUMP THIS whenever you change Michelin logic so cache can’t lie
    const cacheKey = getCacheKey(location, cuisine, openNow) + '|v8';
    const cached = getFromCache(cacheKey);
    if (cached) {
      timings.total_ms = Date.now() - t0;
      return stableResponse(
        cached.elite,
        cached.moreOptions,
        { ...cached.stats, cached: true, performance: { ...timings, cache_hit: true } },
        null
      );
    }

    console.log('=== DETERMINISTIC 1-MILE GRID SEARCH ===');

    // 1) Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeData = await (await fetch(geocodeUrl)).json();

    if (geocodeData.status !== 'OK') {
      console.log('GEOCODE FAILED:', { status: geocodeData.status, error_message: geocodeData.error_message, input: location });
      timings.total_ms = Date.now() - t0;
      return stableResponse([], [], { confirmedAddress: null, userLocation: null, geocode: geocodeData, performance: { ...timings, total_ms: timings.total_ms, cache_hit: false } },
        `Geocode failed: ${geocodeData.status}${geocodeData.error_message ? ' - ' + geocodeData.error_message : ''}`
      );
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;
    const locationType = geocodeData.results[0].geometry.location_type;

    console.log('Initial geocode:', { lat, lng, locationType, address: confirmedAddress });

    // 2) Deterministic origin rounding
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

    console.log('Grid: 9 nodes, 750m radius per node, 600m spacing');

    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const data = await (await fetch(url)).json();

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`${label}: API error ${data.status}`, data.error_message || '');
        return [];
      }

      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;
      let pageCount = 1;

      const MAX_PAGES = 3;
      while (nextPageToken && pageCount < MAX_PAGES) {
        await new Promise(r => setTimeout(r, 2000));

        let retries = 0;
        let pageData = null;

        while (retries < 5) {
          const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
          pageData = await (await fetch(pageUrl)).json();

          if (pageData.status === 'INVALID_REQUEST') {
            retries++;
            console.log(`${label}: INVALID_REQUEST retry ${retries}/5`);
            await new Promise(r => setTimeout(r, 2000));
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

    // 3) Fetch all grid points
    const placesStart = Date.now();
    const gridFetches = gridPoints.map(p => fetchWithFullPagination(p.lat, p.lng, p.label));
    const gridResults = await Promise.all(gridFetches);
    timings.places_fetch_ms = Date.now() - placesStart;
    console.log(`⏱️ Places API fetch: ${timings.places_fetch_ms}ms`);

    // 4) Dedupe
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

    allCandidates.sort((a, b) => String(a.place_id).localeCompare(String(b.place_id)));

    console.log('Total raw results:', totalRaw);
    console.log('3) UNIQUE PLACES (after dedupe, BEFORE filters):', allCandidates.length);

    // 5) Add distance + normalize shape
    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959;
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
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

    // 6) Filter tiers
    const filterStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within1Mile);

    // 7) Michelin overlay
    console.log('=== MICHELIN MATCHING ===');
    console.log('[Michelin] Entries loaded:', Array.isArray(MICHELIN_DATA) ? MICHELIN_DATA.length : 'NOT_ARRAY');
    const matchedCount = attachMichelinData([...elite, ...moreOptions]);
    console.log('Michelin restaurants matched:', matchedCount);

    // 8) Sort results
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
      michelinMatched: matchedCount,
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      performance: { ...timings, cache_hit: false, cache_key: cacheKey }
    };

    setCache(cacheKey, { elite, moreOptions, stats });

    return stableResponse(elite, moreOptions, stats, null);

  } catch (err) {
    console.error('ERROR in search-candidates:', err);
    return stableResponse([], [], {}, err.message || 'Unknown error');
  }
};
