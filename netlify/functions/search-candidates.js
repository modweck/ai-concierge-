const fs = require('fs');
const path = require('path');

// Safe fetch wrapper
const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  try {
    const nodeFetch = require('node-fetch');
    return nodeFetch(...args);
  } catch (e) {
    throw new Error("fetch is not available. Use Node 18+ or add node-fetch to package.json.");
  }
};

// Load Michelin base list once at startup
let MICHELIN_BASE = [];
try {
  const michelinPath = path.join(__dirname, 'michelin_nyc.json');
  MICHELIN_BASE = JSON.parse(fs.readFileSync(michelinPath, 'utf8'));
  console.log(`✅ Loaded Michelin base list: ${MICHELIN_BASE.length} entries`);
} catch (err) {
  console.warn('❌ Michelin base list missing/invalid:', err.message);
}

let MICHELIN_RESOLVED = null;
let MICHELIN_RESOLVED_AT = 0;
const MICHELIN_RESOLVE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---- Michelin resolution (unchanged) ----
async function resolveMichelinPlaces(GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];
  if (MICHELIN_RESOLVED && (Date.now() - MICHELIN_RESOLVED_AT) < MICHELIN_RESOLVE_TTL_MS) {
    return MICHELIN_RESOLVED;
  }
  if (!Array.isArray(MICHELIN_BASE) || !MICHELIN_BASE.length) {
    MICHELIN_RESOLVED = []; MICHELIN_RESOLVED_AT = Date.now(); return [];
  }

  console.log(`🔎 Resolving Michelin entries... (${MICHELIN_BASE.length})`);
  const resolved = await runWithConcurrency(MICHELIN_BASE, 5, async (m) => {
    if (!m?.name) return null;
    const query = encodeURIComponent(`${m.name} New York NY`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${GOOGLE_API_KEY}`;
    try {
      const data = await fetch(url).then(r => r.json());
      if (data.status !== 'OK' || !data.results?.length) {
        return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null };
      }
      const target = normalizeName(m.name);
      let best = data.results[0];
      for (const r of data.results) {
        const rn = normalizeName(r.name);
        if (rn === target) { best = r; break; }
        if (rn.startsWith(target) || target.startsWith(rn)) { best = r; }
      }
      return {
        ...m, place_id: best.place_id || null,
        address: best.formatted_address || best.vicinity || null,
        lat: best.geometry?.location?.lat ?? null, lng: best.geometry?.location?.lng ?? null,
        googleRating: best.rating ?? null, googleReviewCount: best.user_ratings_total ?? null
      };
    } catch (e) {
      return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null };
    }
  });

  MICHELIN_RESOLVED = resolved.filter(Boolean);
  MICHELIN_RESOLVED_AT = Date.now();
  console.log(`✅ Michelin resolved: ${MICHELIN_RESOLVED.filter(x => x.place_id).length}/${MICHELIN_RESOLVED.length}`);
  return MICHELIN_RESOLVED;
}

function attachMichelinBadgesToCandidates(candidates, michelinResolved) {
  if (!candidates?.length || !michelinResolved?.length) return;
  const byPlaceId = new Map();
  const byNormName = new Map();
  for (const m of michelinResolved) {
    if (m?.place_id) byPlaceId.set(m.place_id, m);
    if (m?.name) byNormName.set(normalizeName(m.name), m);
  }
  let matched = 0;
  for (const c of candidates) {
    if (c?.place_id && byPlaceId.has(c.place_id)) {
      c.michelin = { stars: byPlaceId.get(c.place_id).stars || 0, distinction: byPlaceId.get(c.place_id).distinction || 'star' };
      matched++; continue;
    }
    const cn = normalizeName(c?.name);
    if (cn && byNormName.has(cn)) {
      c.michelin = { stars: byNormName.get(cn).stars || 0, distinction: byNormName.get(cn).distinction || 'star' };
      matched++;
    }
  }
  console.log(`✅ Michelin badges: ${matched}`);
}

// ---- Cache ----
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, qualityMode, cuisine, openNow) {
  return `${location}_${qualityMode}_${String(cuisine || 'any').toLowerCase().trim()}_${openNow ? 'open' : 'any'}`;
}
function getFromCache(key) {
  const c = resultCache.get(key);
  if (!c) return null;
  if (Date.now() - c.timestamp > CACHE_TTL_MS) { resultCache.delete(key); return null; }
  return c.data;
}
function setCache(key, data) {
  resultCache.set(key, { data, timestamp: Date.now() });
  if (resultCache.size > 100) {
    const oldest = Array.from(resultCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    resultCache.delete(oldest[0]);
  }
}

function normalizeQualityMode(q) {
  q = String(q || 'any').toLowerCase().trim();
  if (q === 'recommended_44') return 'recommended_44';
  if (q === 'elite_45') return 'elite_45';
  if (q === 'strict_elite_46') return 'strict_elite_46';
  if (q === 'strict_elite_47') return 'strict_elite_47';
  if (q === 'five_star') return 'elite_45';
  if (q === 'top_rated_and_above' || q === 'top_rated') return 'recommended_44';
  if (q === 'michelin') return 'michelin';
  return 'any';
}

// ---- Rating filter with low-review protection ----
function filterRestaurantsByTier(candidates, qualityMode) {
  const elite = [], moreOptions = [], excluded = [];

  let eliteMin = 4.5, moreMin = 4.4, strict47 = false;
  if (qualityMode === 'strict_elite_47') { strict47 = true; eliteMin = 4.7; moreMin = 999; }
  else if (qualityMode === 'strict_elite_46') { eliteMin = 4.6; moreMin = 999; }
  else if (qualityMode === 'elite_45') { eliteMin = 4.5; moreMin = 4.4; }
  else if (qualityMode === 'recommended_44') { eliteMin = 4.4; moreMin = 999; }

  for (const place of candidates) {
    try {
      const reviews = Number(place.user_ratings_total ?? place.googleReviewCount ?? 0) || 0;
      const rating = Number(place.googleRating ?? place.rating ?? 0) || 0;

      // Low-review protection
      if (rating >= 4.9 && reviews < 50) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `unreliable (${rating}★/${reviews}rev)` });
        continue;
      }
      if (rating >= 4.7 && reviews < 20) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `few_reviews (${rating}★/${reviews}rev)` });
        continue;
      }
      if (reviews < 10) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `min_reviews (${reviews})` });
        continue;
      }

      if (rating >= eliteMin) elite.push(place);
      else if (!strict47 && rating >= moreMin) moreOptions.push(place);
      else excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: 'below_threshold' });
    } catch (err) {
      excluded.push({ place_id: place?.place_id, name: place?.name, reason: `error: ${err.message}` });
    }
  }

  console.log(`FILTER ${qualityMode}: Elite(>=${eliteMin}): ${elite.length} | More(>=${moreMin === 999 ? '-' : moreMin}): ${moreOptions.length} | Excluded: ${excluded.length}`);
  return { elite, moreOptions, excluded };
}


// =========================================================================
// LAYER 2: New API Nearby Search with multiple radius rings
//
// Google returns different restaurants for different radii.
// A 500m search returns 20 results from your immediate area.
// A 4000m search returns 20 DIFFERENT results from a wider area.
// Running 7 radii gives us up to 140 results (minus duplicates).
// =========================================================================
async function newApiNearbySearchRings(lat, lng, GOOGLE_API_KEY) {
  const rings = [500, 1000, 1500, 2500, 4000, 6000, 8000];

  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress',
    'places.location', 'places.rating', 'places.userRatingCount',
    'places.priceLevel', 'places.currentOpeningHours', 'places.types'
  ].join(',');

  const allResults = [];
  const seenIds = new Set();

  await runWithConcurrency(rings, 4, async (radius) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify({
          includedTypes: ['restaurant'],
          maxResultCount: 20,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radius
            }
          },
          languageCode: 'en'
        })
      });

      if (!resp.ok) { console.log(`⚠️ Nearby(New) ${radius}m: HTTP ${resp.status}`); return; }

      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const placeId = p.id || '';
        if (!placeId || seenIds.has(placeId)) continue;
        seenIds.add(placeId);
        added++;
        allResults.push({
          place_id: placeId,
          name: p.displayName?.text || '',
          vicinity: p.formattedAddress || '',
          formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0,
          user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPriceLevel(p.priceLevel),
          opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [],
          _source: 'new_nearby'
        });
      }
      console.log(`✅ Nearby(New) ${radius}m: ${(data.places||[]).length} returned, ${added} new`);
    } catch (err) {
      console.log(`⚠️ Nearby(New) ${radius}m error: ${err.message}`);
    }
  });

  return allResults;
}


// =========================================================================
// LAYER 3: New API Text Search by cuisine
//
// The secret weapon. Even when user picks "Any" cuisine, we search for
// each cuisine separately. Google returns COMPLETELY DIFFERENT restaurants
// for "best italian" vs "best japanese" vs "best thai".
// This is where most of the missing high-rated places come from.
// =========================================================================
async function newApiTextSearchByCuisine(lat, lng, userCuisine, GOOGLE_API_KEY) {
  let queries = [];

  if (userCuisine && userCuisine !== 'any') {
    queries = [
      `best ${userCuisine} restaurants`,
      `top rated ${userCuisine} restaurants`,
      `popular ${userCuisine} restaurants`
    ];
  } else {
    queries = [
      'best italian restaurants',
      'best japanese restaurants',
      'best chinese restaurants',
      'best mexican restaurants',
      'best thai restaurants',
      'best indian restaurants',
      'best french restaurants',
      'best korean restaurants',
      'best mediterranean restaurants',
      'best american restaurants',
      'best sushi restaurants',
      'best pizza restaurants',
      'best seafood restaurants',
      'best steakhouse',
      'best brunch restaurants',
      'best ramen restaurants',
      'best vietnamese restaurants',
      'best greek restaurants'
    ];
  }

  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress',
    'places.location', 'places.rating', 'places.userRatingCount',
    'places.priceLevel', 'places.currentOpeningHours', 'places.types'
  ].join(',');

  const allResults = [];
  const seenIds = new Set();

  await runWithConcurrency(queries, 5, async (query) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 20,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 8000
            }
          },
          languageCode: 'en'
        })
      });

      if (!resp.ok) { console.log(`⚠️ Text "${query}": HTTP ${resp.status}`); return; }

      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const placeId = p.id || '';
        if (!placeId || seenIds.has(placeId)) continue;
        seenIds.add(placeId);
        added++;
        allResults.push({
          place_id: placeId,
          name: p.displayName?.text || '',
          vicinity: p.formattedAddress || '',
          formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0,
          user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPriceLevel(p.priceLevel),
          opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [],
          _source: 'new_text'
        });
      }
      console.log(`✅ Text "${query}": ${(data.places||[]).length} returned, ${added} new`);
    } catch (err) {
      console.log(`⚠️ Text "${query}" error: ${err.message}`);
    }
  });

  return allResults;
}

function convertPriceLevel(str) {
  if (!str) return null;
  const map = { 'PRICE_LEVEL_FREE': 0, 'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3, 'PRICE_LEVEL_VERY_EXPENSIVE': 4 };
  return map[str] ?? null;
}

// ---- Legacy grid ----
function buildSearchGrid(centerLat, centerLng) {
  const spacingDeg = 0.75 / 69;
  const rings = 3;
  const points = [];
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      if (Math.sqrt(dy * dy + dx * dx) > rings + 0.5) continue;
      points.push({ lat: centerLat + dy * spacingDeg, lng: centerLng + dx * spacingDeg, label: `g${dy}_${dx}` });
    }
  }
  console.log(`🗺️ Legacy grid: ${points.length} points`);
  return points;
}


// =========================================================================
// MAIN HANDLER
// =========================================================================
exports.handler = async (event) => {
  const stableResponse = (elite = [], moreOptions = [], stats = {}, error = null) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elite: Array.isArray(elite) ? elite : [],
      moreOptions: Array.isArray(moreOptions) ? moreOptions : [],
      confirmedAddress: stats.confirmedAddress || null,
      userLocation: stats.userLocation || null,
      stats, error
    })
  });

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const t0 = Date.now();
    const timings = { legacy_ms: 0, new_nearby_ms: 0, new_text_ms: 0, filtering_ms: 0, total_ms: 0 };

    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, quality } = body;
    const qualityMode = normalizeQualityMode(quality || 'any');

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) return stableResponse([], [], {}, 'API key not configured');

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v4';
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) {
      timings.total_ms = Date.now() - t0;
      return stableResponse(cachedResult.elite, cachedResult.moreOptions,
        { ...cachedResult.stats, cached: true, performance: { ...timings, cache_hit: true } }, null);
    }

    // ---- Geocode ----
    let lat, lng, confirmedAddress = null;
    const locStr = String(location || '').trim();
    const coordMatch = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);

    if (coordMatch) {
      lat = Number(coordMatch[1]); lng = Number(coordMatch[2]);
      confirmedAddress = `Coordinates (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    } else {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${GOOGLE_API_KEY}`;
      const geoData = await fetch(geoUrl).then(r => r.json());
      if (geoData.status !== 'OK') {
        return stableResponse([], [], {
          confirmedAddress: null, userLocation: null,
          performance: { total_ms: Date.now() - t0, cache_hit: false },
          geocode: { status: geoData.status, error_message: geoData.error_message || null }
        }, `Geocode failed: ${geoData.status}`);
      }
      lat = geoData.results[0].geometry.location.lat;
      lng = geoData.results[0].geometry.location.lng;
      confirmedAddress = geoData.results[0].formatted_address;
    }

    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;

    // ---- MICHELIN MODE ----
    if (qualityMode === 'michelin') {
      const resolved = await resolveMichelinPlaces(GOOGLE_API_KEY);
      const within = resolved
        .filter(r => r?.lat != null && r?.lng != null)
        .map(r => {
          const d = haversineMiles(gridLat, gridLng, r.lat, r.lng);
          return {
            place_id: r.place_id, name: r.name,
            vicinity: r.address || '', formatted_address: r.address || '',
            price_level: null, opening_hours: null,
            geometry: { location: { lat: r.lat, lng: r.lng } },
            googleRating: r.googleRating, googleReviewCount: r.googleReviewCount,
            distanceMiles: Math.round(d * 10) / 10,
            walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: null,
            michelin: { stars: r.stars || 0, distinction: r.distinction || 'star' }
          };
        })
        .filter(r => r.distanceMiles <= 15)
        .sort((a, b) => a.distanceMiles - b.distanceMiles);

      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gridLat, lng: gridLng }, michelinMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats, null);
    }

    // =========================================================================
    // NORMAL MODE: THREE-LAYER PARALLEL SEARCH
    // =========================================================================
    const cuisineStr = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

    // Run all 3 layers at the same time
    const [legacyResults, newNearbyResults, newTextResults] = await Promise.all([

      // LAYER 1: Legacy grid search
      (async () => {
        const start = Date.now();
        const gridPoints = buildSearchGrid(gridLat, gridLng);

        async function fetchPage(searchLat, searchLng) {
          let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=800&type=restaurant&key=${GOOGLE_API_KEY}`;
          if (cuisineStr) url += `&keyword=${encodeURIComponent(cuisineStr)}`;
          if (openNow) url += `&opennow=true`;

          const data = await fetch(url).then(r => r.json());
          if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];

          let all = data.results || [];
          let token = data.next_page_token;
          let pages = 1;

          while (token && pages < 3) {
            await new Promise(r => setTimeout(r, 2000));
            let retries = 0, pd = null;
            while (retries < 5) {
              pd = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${token}&key=${GOOGLE_API_KEY}`).then(r => r.json());
              if (pd.status === 'INVALID_REQUEST') { retries++; await new Promise(r => setTimeout(r, 2000)); continue; }
              break;
            }
            if (pd?.results) { all = all.concat(pd.results); pages++; }
            token = pd?.next_page_token;
          }
          return all;
        }

        const gridResults = await runWithConcurrency(gridPoints, 8, async (pt) => fetchPage(pt.lat, pt.lng));
        timings.legacy_ms = Date.now() - start;
        return gridResults.flat();
      })(),

      // LAYER 2: New API Nearby Search rings
      (async () => {
        const start = Date.now();
        const r = await newApiNearbySearchRings(gridLat, gridLng, GOOGLE_API_KEY);
        timings.new_nearby_ms = Date.now() - start;
        return r;
      })(),

      // LAYER 3: New API Text Search by cuisine
      (async () => {
        const start = Date.now();
        const r = await newApiTextSearchByCuisine(gridLat, gridLng, cuisineStr, GOOGLE_API_KEY);
        timings.new_text_ms = Date.now() - start;
        return r;
      })()
    ]);

    // ---- Merge & deduplicate ----
    const seenIds = new Set();
    const allCandidates = [];
    let legacyCount = 0, newNearbyCount = 0, newTextCount = 0, totalRaw = 0;

    for (const p of legacyResults) {
      totalRaw++;
      if (p?.place_id && !seenIds.has(p.place_id)) { seenIds.add(p.place_id); allCandidates.push(p); legacyCount++; }
    }
    for (const p of newNearbyResults) {
      if (p?.place_id && !seenIds.has(p.place_id)) { seenIds.add(p.place_id); allCandidates.push(p); newNearbyCount++; }
    }
    for (const p of newTextResults) {
      if (p?.place_id && !seenIds.has(p.place_id)) { seenIds.add(p.place_id); allCandidates.push(p); newTextCount++; }
    }

    console.log(`📊 MERGE: Legacy=${legacyCount} + NewNearby=+${newNearbyCount} + NewText=+${newTextCount} = ${allCandidates.length} total`);

    // ---- Distance ----
    const candidatesWithDistance = allCandidates.map(place => {
      const pLat = place.geometry?.location?.lat ?? null;
      const pLng = place.geometry?.location?.lng ?? null;
      const dist = (pLat != null && pLng != null) ? haversineMiles(gridLat, gridLng, pLat, pLng) : 999;

      return {
        place_id: place.place_id,
        name: place.name,
        vicinity: place.vicinity || place.formatted_address || '',
        formatted_address: place.formatted_address || place.vicinity || '',
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        types: place.types || [],
        googleRating: place.rating || place.googleRating || 0,
        googleReviewCount: place.user_ratings_total || place.googleReviewCount || 0,
        distanceMiles: Math.round(dist * 10) / 10,
        walkMinEstimate: Math.round(dist * 20),
        driveMinEstimate: Math.round(dist * 4),
        transitMinEstimate: Math.round(dist * 6),
        _source: place._source || 'legacy'
      };
    });

    const maxMiles = 7.0;
    const withinMiles = candidatesWithDistance.filter(r => r.distanceMiles <= maxMiles);
    console.log(`📊 Within ${maxMiles}mi: ${withinMiles.length}`);

    // Michelin badges
    const michelinResolved = await resolveMichelinPlaces(GOOGLE_API_KEY);
    attachMichelinBadgesToCandidates(withinMiles, michelinResolved);

    // Filter
    const filterStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(withinMiles, qualityMode);
    timings.filtering_ms = Date.now() - filterStart;
    timings.total_ms = Date.now() - t0;

    // Sort
    const sortFn = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };
    elite.sort(sortFn);
    moreOptions.sort(sortFn);

    const stats = {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      withinMiles: withinMiles.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: excluded.length,
      sources: { legacy: legacyCount, newNearby: newNearbyCount, newText: newTextCount },
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      qualityMode,
      performance: { ...timings, cache_hit: false }
    };

    setCache(cacheKey, { elite, moreOptions, stats });
    return stableResponse(elite, moreOptions, stats, null);

  } catch (error) {
    console.error('ERROR in search-candidates:', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elite: [], moreOptions: [], stats: {}, error: error.message })
    };
  }
};
