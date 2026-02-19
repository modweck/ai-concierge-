// search-candidates.js (Netlify Function)
// Deterministic 1-mile-ish grid w/ full pagination
// Two-tier filtering by default: Elite (4.6+) and More Options (4.4+)
// SPECIAL MODE: If transportMode=walk AND qualityMode=five_star =>
//   Step 1 returns ALL 4.6+ (minimal spam guard), NO heavy chain/junk exclusions.
// Michelin overlay remains badge-only.

const fs = require('fs');
const path = require('path');

let MICHELIN_DATA = [];
try {
  const michelinPath = path.join(__dirname, 'michelin_nyc.json');
  MICHELIN_DATA = JSON.parse(fs.readFileSync(michelinPath, 'utf8'));
  console.log(`Loaded ${MICHELIN_DATA.length} Michelin entries`);
} catch (err) {
  console.warn('Michelin data not found or invalid, continuing without:', err.message);
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attachMichelinData(candidates) {
  if (!MICHELIN_DATA.length) return;

  candidates.forEach(place => {
    const placeName = normalizeName(place.name);

    for (const michelin of MICHELIN_DATA) {
      const michelinName = normalizeName(michelin.name);

      if (placeName === michelinName) {
        place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
        return;
      }

      if (placeName.includes(michelinName) || michelinName.includes(placeName)) {
        if (Math.abs(placeName.length - michelinName.length) <= 5) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }

      if (michelin.lat && michelin.lng && place.geometry?.location) {
        const R = 6371000;
        const dLat = (place.geometry.location.lat - michelin.lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - michelin.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(michelin.lat * Math.PI / 180) *
          Math.cos(place.geometry.location.lat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance <= 50) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          return;
        }
      }
    }
  });
}

// ---- Cache ----
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, cuisine, openNow, qualityMode, transportMode, walkTimeLimit) {
  return [
    location || '',
    cuisine || '',
    openNow ? 'open' : 'any',
    qualityMode || 'any',
    transportMode || 'walk',
    walkTimeLimit || 'nolimit',
    'v5'
  ].join('|');
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

// ---- Default heavy filtering (your existing approach, slightly cleaned) ----
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

  const NAME_KEYWORDS_EXCLUDE = ['food truck', 'cart', 'truck', 'kiosk', 'deli'];

  function isChain(place) {
    const nameLower = (place.name || '').toLowerCase();
    const types = Array.isArray(place.types) ? place.types : [];
    const price = place.price_level ?? null;
    const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;

    for (const chain of KNOWN_CHAINS) {
      if (nameLower.includes(chain)) return { isChain: true, reason: `known_chain:${chain}` };
    }

    // heuristic fast food / chains
    if (price !== null && price <= 1 && reviews >= 150) {
      if (types.includes('meal_takeaway') || types.includes('fast_food_restaurant')) {
        return { isChain: true, reason: 'heuristic_chain(low_price+high_reviews+takeaway/fast_food)' };
      }
    }

    return { isChain: false, reason: null };
  }

  const elite = [];
  const moreOptions = [];
  const excluded = [];

  candidates.forEach(place => {
    const reviews = place.googleReviewCount ?? place.user_ratings_total ?? 0;
    const rating = place.googleRating ?? place.rating ?? 0;
    const nameLower = (place.name || '').toLowerCase();
    const types = Array.isArray(place.types) ? place.types : [];

    let excludeReason = null;

    // fake/low review guards
    if (rating >= 4.9 && reviews < 50) excludeReason = `fake_5.0_prevention`;
    else if (rating >= 4.6 && rating < 4.9 && reviews < 30) excludeReason = `low_review_count`;

    if (!excludeReason) {
      for (const jt of HARD_JUNK_TYPES) {
        if (types.includes(jt)) { excludeReason = `hard_junk:${jt}`; break; }
      }
    }

    if (!excludeReason) {
      if (types.includes('street_food')) excludeReason = 'street_food';
      else if (types.includes('meal_takeaway') && !types.includes('restaurant')) excludeReason = 'meal_takeaway_only';
    }

    if (!excludeReason) {
      for (const kw of NAME_KEYWORDS_EXCLUDE) {
        if (nameLower.includes(kw)) { excludeReason = `name_keyword:${kw}`; break; }
      }
    }

    if (!excludeReason) {
      const chainCheck = isChain(place);
      if (chainCheck.isChain) excludeReason = chainCheck.reason;
    }

    if (excludeReason) {
      excluded.push({
        place_id: place.place_id, name: place.name, rating, reviews,
        types: types.join(', '), reason: excludeReason
      });
      return;
    }

    if (rating >= 4.6) {
      elite.push(place);
    } else if (rating >= 4.4) {
      // More Options minimum review threshold
      if (reviews >= 10 || (rating >= 4.7 && reviews >= 5)) {
        moreOptions.push(place);
      } else {
        excluded.push({
          place_id: place.place_id, name: place.name, rating, reviews,
          types: types.join(', '), reason: 'more_options_low_reviews'
        });
      }
    } else {
      excluded.push({
        place_id: place.place_id, name: place.name, rating, reviews,
        types: types.join(', '), reason: 'rating_below_4.4'
      });
    }
  });

  return { elite, moreOptions, excluded };
}

// ---- SPECIAL: true 4.6+ walk mode filtering (minimal only) ----
function filterTrueEliteOnly(candidates) {
  const elite = [];
  const excluded = [];

  candidates.forEach(place => {
    const rating = place.googleRating ?? place.rating ?? 0;
    const reviews = place.googleReviewCount ?? place.user_ratings_total ?? 0;

    // minimal spam guard: don’t keep a 4.9 with 2 reviews
    const passesSpamGuard =
      (rating >= 4.9 && reviews >= 15) ||
      (rating >= 4.6 && reviews >= 10);

    if (rating >= 4.6 && passesSpamGuard) {
      elite.push(place);
    } else {
      excluded.push({
        place_id: place.place_id, name: place.name, rating, reviews,
        reason: rating < 4.6 ? 'below_4.6' : 'spam_guard'
      });
    }
  });

  return { elite, excluded };
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const t0 = Date.now();
  const timings = { places_fetch_ms: 0, filtering_ms: 0, total_ms: 0 };

  try {
    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, qualityMode, transportMode, walkTimeLimit } = body;

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) return stableResponse([], [], {}, 'API key not configured');

    const cacheKey = getCacheKey(location, cuisine, !!openNow, qualityMode, transportMode, walkTimeLimit);
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

    console.log('=== STEP 1 GRID SEARCH ===');

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeData = await fetch(geocodeUrl).then(r => r.json());

    if (geocodeData.status !== 'OK') {
      return stableResponse([], [], { confirmedAddress: null }, null);
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Normalize for determinism
    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;

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

    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const first = await fetch(url).then(r => r.json());
      if (first.status !== 'OK' && first.status !== 'ZERO_RESULTS') {
        console.log(`${label}: Places error ${first.status}`);
        return [];
      }

      let all = first.results || [];
      let next = first.next_page_token;
      let pages = 1;

      while (next && pages < 3) {
        await new Promise(res => setTimeout(res, 2000));
        const page = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${next}&key=${GOOGLE_API_KEY}`).then(r => r.json());
        if (page.status === 'INVALID_REQUEST') continue;
        if (Array.isArray(page.results)) all = all.concat(page.results);
        next = page.next_page_token;
        pages++;
      }

      console.log(`${label}: ${all.length} results`);
      return all;
    }

    const placesStart = Date.now();
    const gridResults = await Promise.all(
      gridPoints.map(p => fetchWithFullPagination(p.lat, p.lng, p.label))
    );
    timings.places_fetch_ms = Date.now() - placesStart;

    const seen = new Set();
    const allCandidatesRaw = [];
    let totalRaw = 0;

    gridResults.forEach(results => {
      totalRaw += results.length;
      results.forEach(place => {
        if (!seen.has(place.place_id)) {
          seen.add(place.place_id);
          allCandidatesRaw.push(place);
        }
      });
    });

    allCandidatesRaw.sort((a, b) => a.place_id.localeCompare(b.place_id));

    // Light distance estimates
    const candidatesWithDistance = allCandidatesRaw.map(place => {
      const R = 3959;
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(gridLat * Math.PI / 180) *
        Math.cos(place.geometry.location.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
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

    const within1_3 = candidatesWithDistance.filter(r => r.distanceMiles <= 1.3);

    const filterStart = Date.now();

    // SPECIAL TRUE MODE
    const isTrueEliteWalkMode = (transportMode === 'walk' && qualityMode === 'five_star');

    let elite = [];
    let moreOptions = [];
    let excludedCount = 0;

    if (isTrueEliteWalkMode) {
      const res = filterTrueEliteOnly(within1_3);
      elite = res.elite;
      moreOptions = []; // not used in this mode
      excludedCount = res.excluded.length;
      console.log(`TRUE ELITE WALK MODE: elite=${elite.length} excluded=${excludedCount}`);
    } else {
      const res = filterRestaurantsByTier(within1_3);
      elite = res.elite;
      moreOptions = res.moreOptions;
      excludedCount = res.excluded.length;
    }

    // Michelin badge overlay only
    attachMichelinData([...elite, ...moreOptions]);

    // Deterministic sort by estimated walk, then rating/reviews/name
    const sortByWalkEstimate = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return (a.name || '').localeCompare(b.name || '');
    };
    elite.sort(sortByWalkEstimate);
    moreOptions.sort(sortByWalkEstimate);

    timings.filtering_ms = Date.now() - filterStart;
    timings.total_ms = Date.now() - t0;

    const stats = {
      totalRaw,
      uniquePlaceIds: allCandidatesRaw.length,
      within1_3: within1_3.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: excludedCount,
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      performance: { ...timings, cache_hit: false, cache_key: cacheKey }
    };

    setCache(cacheKey, { elite, moreOptions, stats });

    return stableResponse(elite, moreOptions, stats, null);

  } catch (err) {
    console.error('ERROR in search-candidates:', err);
    timings.total_ms = Date.now() - t0;
    return stableResponse([], [], { performance: timings }, err.message);
  }
};
