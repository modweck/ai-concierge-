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
    throw new Error(
      "fetch is not available. Use Node 18+ or add node-fetch to package.json."
    );
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

// Resolved Michelin cache
let MICHELIN_RESOLVED = null;
let MICHELIN_RESOLVED_AT = 0;
const MICHELIN_RESOLVE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

// Resolve Michelin list -> Google Places
async function resolveMichelinPlaces(GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];

  if (MICHELIN_RESOLVED && (Date.now() - MICHELIN_RESOLVED_AT) < MICHELIN_RESOLVE_TTL_MS) {
    console.log(`💾 Michelin resolved cache HIT (${MICHELIN_RESOLVED.length})`);
    return MICHELIN_RESOLVED;
  }

  if (!Array.isArray(MICHELIN_BASE) || MICHELIN_BASE.length === 0) {
    MICHELIN_RESOLVED = [];
    MICHELIN_RESOLVED_AT = Date.now();
    return MICHELIN_RESOLVED;
  }

  console.log(`🔎 Resolving Michelin entries... (${MICHELIN_BASE.length})`);

  const resolved = await runWithConcurrency(MICHELIN_BASE, 5, async (m) => {
    const name = m?.name;
    if (!name) return null;

    const query = encodeURIComponent(`${name} New York NY`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${GOOGLE_API_KEY}`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.status !== 'OK' || !data.results?.length) {
        return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null, _resolveStatus: data.status };
      }

      const target = normalizeName(name);
      let best = data.results[0];
      for (const r of data.results) {
        const rn = normalizeName(r.name);
        if (rn === target) { best = r; break; }
        if (rn.startsWith(target) || target.startsWith(rn)) { best = r; }
      }

      return {
        ...m,
        place_id: best.place_id || null,
        address: best.formatted_address || best.vicinity || null,
        lat: best.geometry?.location?.lat ?? null,
        lng: best.geometry?.location?.lng ?? null,
        googleRating: best.rating ?? null,
        googleReviewCount: best.user_ratings_total ?? null,
        _resolveStatus: data.status
      };
    } catch (e) {
      return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null, _resolveStatus: `ERR:${e.message}` };
    }
  });

  MICHELIN_RESOLVED = resolved.filter(Boolean);
  MICHELIN_RESOLVED_AT = Date.now();
  const okCount = MICHELIN_RESOLVED.filter(x => x.place_id && x.lat && x.lng).length;
  console.log(`✅ Michelin resolved: ${okCount}/${MICHELIN_RESOLVED.length} with place_id+coords`);
  return MICHELIN_RESOLVED;
}

// Badge overlay
function attachMichelinBadgesToCandidates(candidates, michelinResolved) {
  if (!Array.isArray(candidates) || !candidates.length) return;
  if (!Array.isArray(michelinResolved) || !michelinResolved.length) return;

  const byPlaceId = new Map();
  const byNormName = new Map();
  for (const m of michelinResolved) {
    if (m?.place_id) byPlaceId.set(m.place_id, m);
    if (m?.name) byNormName.set(normalizeName(m.name), m);
  }

  let matched = 0;
  for (const c of candidates) {
    if (c?.place_id && byPlaceId.has(c.place_id)) {
      const m = byPlaceId.get(c.place_id);
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      matched++;
      continue;
    }
    const cn = normalizeName(c?.name);
    if (cn && byNormName.has(cn)) {
      const m = byNormName.get(cn);
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      matched++;
    }
  }
  console.log(`✅ Michelin badges attached: ${matched}`);
}

// In-memory cache
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, qualityMode, cuisine, openNow) {
  const c = String(cuisine || 'any').toLowerCase().trim();
  return `${location}_${qualityMode}_${c}_${openNow ? 'open' : 'any'}`;
}

function getFromCache(key) {
  const cached = resultCache.get(key);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) { resultCache.delete(key); return null; }
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

function normalizeQualityMode(qualityModeRaw) {
  const q = String(qualityModeRaw || 'any').toLowerCase().trim();
  if (q === 'recommended_44') return 'recommended_44';
  if (q === 'elite_45') return 'elite_45';
  if (q === 'strict_elite_46') return 'strict_elite_46';
  if (q === 'strict_elite_47') return 'strict_elite_47';
  if (q === 'five_star') return 'elite_45';
  if (q === 'top_rated_and_above') return 'recommended_44';
  if (q === 'top_rated') return 'recommended_44';
  if (q === 'michelin') return 'michelin';
  if (q === 'any') return 'any';
  return q;
}

// Rating filter with low-review protection
function filterRestaurantsByTier(candidates, qualityMode) {
  const elite = [];
  const moreOptions = [];
  const excluded = [];

  let eliteMin = 4.5;
  let moreMin = 4.4;
  let strict47 = false;

  if (qualityMode === 'strict_elite_47') { strict47 = true; eliteMin = 4.7; moreMin = 999; }
  if (qualityMode === 'strict_elite_46') { eliteMin = 4.6; moreMin = 999; }
  if (qualityMode === 'elite_45') { eliteMin = 4.5; moreMin = 4.4; }
  if (qualityMode === 'recommended_44') { eliteMin = 4.4; moreMin = 999; }

  candidates.forEach(place => {
    try {
      const reviewsRaw = place.user_ratings_total ?? place.googleReviewCount ?? 0;
      const ratingRaw = place.googleRating ?? place.rating ?? 0;
      const reviews = Number(reviewsRaw) || 0;
      const rating = Number(ratingRaw) || 0;

      // ========================================================
      // FIX: Low-review filter
      // Ratings from very few reviews are unreliable.
      // - 4.9+ needs at least 50 reviews (fake 5.0 prevention)
      // - 4.7+ needs at least 20 reviews
      // - Everything else needs at least 10 reviews
      // ========================================================
      if (rating >= 4.9 && reviews < 50) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `unreliable_rating (${rating}⭐ with only ${reviews} reviews)` });
        return;
      }
      if (rating >= 4.7 && reviews < 20) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `too_few_reviews (${rating}⭐ with only ${reviews} reviews)` });
        return;
      }
      if (reviews < 10) {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: `minimum_reviews_not_met (only ${reviews} reviews)` });
        return;
      }

      if (rating >= eliteMin) elite.push(place);
      else if (!strict47 && rating >= moreMin) moreOptions.push(place);
      else {
        excluded.push({ place_id: place.place_id, name: place.name, rating, reviews, reason: 'rating_below_threshold' });
      }
    } catch (err) {
      excluded.push({ place_id: place?.place_id, name: place?.name, rating: 0, reviews: 0, reason: `filter_error: ${err.message}` });
    }
  });

  console.log(`FILTER: qualityMode=${qualityMode} | Elite(>=${eliteMin}): ${elite.length} | More(>=${moreMin === 999 ? 'none' : moreMin}): ${moreOptions.length} | Excluded: ${excluded.length}`);
  return { elite, moreOptions, excluded };
}

// =========================================================================
// NEW: Supplemental search using Places API (New) - Text Search
// This catches high-rated restaurants the old Nearby Search misses.
//
// How it works:
//   - Uses the NEW Text Search endpoint (places.googleapis.com)
//   - Searches for "top rated restaurants" near the user's location
//   - Can also search by cuisine: "top rated italian restaurants"
//   - Returns up to 20 results per query, ranked by RELEVANCE
//   - We run multiple queries to maximize coverage
// =========================================================================
async function supplementalNewApiSearch(lat, lng, radiusMeters, cuisine, GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];

  // Build search queries - we'll run several to catch more restaurants
  const queries = [];

  // Main query: "top rated restaurants"
  queries.push('top rated restaurants');

  // Cuisine-specific query if provided
  if (cuisine && cuisine !== 'any') {
    queries.push(`best ${cuisine} restaurants`);
  }

  // Additional queries to catch different types of highly-rated places
  queries.push('highly rated restaurants');
  queries.push('best restaurants');

  const allResults = [];
  const seenPlaceIds = new Set();

  // The fields we want back from the new API
  // This controls both what data we get AND what we're billed for
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.priceLevel',
    'places.currentOpeningHours',
    'places.types'
  ].join(',');

  for (const query of queries) {
    try {
      const requestBody = {
        textQuery: query,
        maxResultCount: 20,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters
          }
        },
        includedType: 'restaurant',
        languageCode: 'en'
      };

      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify(requestBody)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.log(`⚠️ New API query "${query}" failed: ${resp.status} ${errText}`);
        continue;
      }

      const data = await resp.json();
      const places = data.places || [];

      for (const place of places) {
        // The new API returns place IDs in format "places/XXXXX"
        // We need just the ID part to match with old API results
        const rawId = place.id || '';
        const placeId = rawId.startsWith('places/') ? rawId.substring(7) : rawId;

        if (!placeId || seenPlaceIds.has(placeId)) continue;
        seenPlaceIds.add(placeId);

        // Convert new API format to match our existing data structure
        allResults.push({
          place_id: placeId,
          name: place.displayName?.text || '',
          vicinity: place.formattedAddress || '',
          formatted_address: place.formattedAddress || '',
          geometry: {
            location: {
              lat: place.location?.latitude ?? null,
              lng: place.location?.longitude ?? null
            }
          },
          rating: place.rating ?? 0,
          user_ratings_total: place.userRatingCount ?? 0,
          price_level: convertPriceLevel(place.priceLevel),
          opening_hours: place.currentOpeningHours ? { open_now: isOpenNow(place.currentOpeningHours) } : null,
          types: place.types || [],
          _source: 'new_api'
        });
      }

      console.log(`✅ New API "${query}": ${places.length} results (${allResults.length} unique total)`);

    } catch (err) {
      console.log(`⚠️ New API query "${query}" error: ${err.message}`);
    }
  }

  console.log(`📊 Supplemental new API search: ${allResults.length} unique restaurants found`);
  return allResults;
}

// The new API returns price level as a string like "PRICE_LEVEL_MODERATE"
// Convert to the old API's numeric format (1-4)
function convertPriceLevel(priceLevelStr) {
  if (!priceLevelStr) return null;
  const map = {
    'PRICE_LEVEL_FREE': 0,
    'PRICE_LEVEL_INEXPENSIVE': 1,
    'PRICE_LEVEL_MODERATE': 2,
    'PRICE_LEVEL_EXPENSIVE': 3,
    'PRICE_LEVEL_VERY_EXPENSIVE': 4
  };
  return map[priceLevelStr] ?? null;
}

// Simple check if currently open from the new API's hours format
function isOpenNow(openingHours) {
  if (!openingHours) return false;
  if (typeof openingHours.openNow === 'boolean') return openingHours.openNow;
  return false;
}

// Build a denser search grid
function buildSearchGrid(centerLat, centerLng) {
  const spacingMiles = 0.75;
  const spacingDegrees = spacingMiles / 69;
  const rings = 3;
  const points = [];

  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      const distFromCenter = Math.sqrt(dy * dy + dx * dx);
      if (distFromCenter > rings + 0.5) continue;
      points.push({
        lat: centerLat + (dy * spacingDegrees),
        lng: centerLng + (dx * spacingDegrees),
        label: `grid_${dy}_${dx}`
      });
    }
  }

  console.log(`🗺️ Search grid: ${points.length} points`);
  return points;
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
    const timings = { places_fetch_ms: 0, new_api_ms: 0, filtering_ms: 0, total_ms: 0 };

    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, quality } = body;
    const qualityMode = normalizeQualityMode(quality || 'any');

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) {
      return stableResponse([], [], {}, 'API key not configured (GOOGLE_PLACES_API_KEY)');
    }

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v3';
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) {
      timings.total_ms = Date.now() - t0;
      return stableResponse(cachedResult.elite, cachedResult.moreOptions,
        { ...cachedResult.stats, cached: true, performance: { ...timings, cache_hit: true } }, null);
    }

    // 1) Geocode the location
    let lat, lng;
    let confirmedAddress = null;

    const locStr = String(location || '').trim();
    const coordMatch = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);

    if (coordMatch) {
      lat = Number(coordMatch[1]);
      lng = Number(coordMatch[2]);
      confirmedAddress = `Coordinates (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    } else {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${GOOGLE_API_KEY}`;
      const geocodeResponse = await fetch(geocodeUrl);
      const geocodeData = await geocodeResponse.json();

      if (geocodeData.status !== 'OK') {
        return stableResponse([], [], {
          confirmedAddress: null, userLocation: null,
          performance: { places_fetch_ms: 0, filtering_ms: 0, total_ms: Date.now() - t0, cache_hit: false },
          geocode: { status: geocodeData.status, error_message: geocodeData.error_message || null, input: locStr }
        }, `Geocode failed: ${geocodeData.status}${geocodeData.error_message ? ' - ' + geocodeData.error_message : ''}`);
      }

      lat = geocodeData.results[0].geometry.location.lat;
      lng = geocodeData.results[0].geometry.location.lng;
      confirmedAddress = geocodeData.results[0].formatted_address;
    }

    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;

    // ✅ MICHELIN MODE (unchanged)
    if (qualityMode === 'michelin') {
      const resolved = await resolveMichelinPlaces(GOOGLE_API_KEY);
      const maxMiles = 15.0;

      const within = resolved
        .filter(r => r?.lat != null && r?.lng != null)
        .map(r => {
          const distMiles = haversineMiles(gridLat, gridLng, r.lat, r.lng);
          return {
            place_id: r.place_id || null, name: r.name,
            vicinity: r.address || '', formatted_address: r.address || '',
            price_level: null, opening_hours: null,
            geometry: { location: { lat: r.lat, lng: r.lng } },
            googleRating: r.googleRating ?? null, googleReviewCount: r.googleReviewCount ?? null,
            distanceMiles: Math.round(distMiles * 10) / 10,
            walkMinEstimate: Math.round(distMiles * 20),
            driveMinEstimate: Math.round(distMiles * 4),
            transitMinEstimate: null,
            michelin: { stars: r.stars || 0, distinction: r.distinction || 'star' }
          };
        })
        .filter(r => r.distanceMiles <= maxMiles)
        .sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

      timings.total_ms = Date.now() - t0;
      const stats = {
        confirmedAddress, userLocation: { lat: gridLat, lng: gridLng },
        michelinMode: true, maxMiles, count: within.length,
        performance: { ...timings, cache_hit: false }
      };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats, null);
    }

    // =========================================================================
    // 2) NORMAL MODE: Legacy grid search + NEW API supplemental search
    // =========================================================================

    const gridRadius = 800;
    const gridPoints = buildSearchGrid(gridLat, gridLng);

    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;

      if (cuisine && String(cuisine).toLowerCase().trim() !== 'any') {
        url += `&keyword=${encodeURIComponent(cuisine)}`;
      }
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

    // --- STEP A: Legacy grid search (same as before) ---
    const placesStart = Date.now();
    const gridResults = await runWithConcurrency(gridPoints, 8, async (point) => {
      return fetchWithFullPagination(point.lat, point.lng, point.label);
    });
    timings.places_fetch_ms = Date.now() - placesStart;

    // Deduplicate legacy results
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

    console.log(`📊 Legacy grid: ${totalRaw} raw → ${allCandidates.length} unique`);

    // --- STEP B: NEW API supplemental search ---
    // This runs in parallel-ish after the grid search.
    // Uses a 5km radius from user location to find top-rated places
    // the legacy API missed.
    const newApiStart = Date.now();
    const supplementalResults = await supplementalNewApiSearch(
      gridLat, gridLng,
      8000,  // 8km radius (~5 miles) for the new API search
      cuisine,
      GOOGLE_API_KEY
    );
    timings.new_api_ms = Date.now() - newApiStart;

    // --- STEP C: Merge supplemental results into allCandidates ---
    let supplementalAdded = 0;
    for (const place of supplementalResults) {
      if (place?.place_id && !seenIds.has(place.place_id)) {
        seenIds.add(place.place_id);
        allCandidates.push(place);
        supplementalAdded++;
      }
    }
    console.log(`📊 New API added ${supplementalAdded} restaurants not found by legacy search`);

    // Add distance info to each candidate
    const candidatesWithDistance = allCandidates.map(place => {
      const placeLat = place.geometry?.location?.lat ?? null;
      const placeLng = place.geometry?.location?.lng ?? null;

      let distMiles = 999;
      if (placeLat != null && placeLng != null) {
        distMiles = haversineMiles(gridLat, gridLng, placeLat, placeLng);
      }

      return {
        place_id: place.place_id,
        name: place.name,
        vicinity: place.vicinity || place.formatted_address || '',
        formatted_address: place.formatted_address || place.vicinity || '',
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        types: place.types || [],
        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        distanceMiles: Math.round(distMiles * 10) / 10,
        walkMinEstimate: Math.round(distMiles * 20),
        driveMinEstimate: Math.round(distMiles * 4),
        transitMinEstimate: Math.round(distMiles * 6),
        _source: place._source || 'legacy'
      };
    });

    // Distance cap
    const maxMiles = 7.0;
    const withinMiles = candidatesWithDistance.filter(r => r.distanceMiles <= maxMiles);
    console.log(`📊 Within ${maxMiles} miles: ${withinMiles.length} restaurants`);

    // Attach Michelin badges
    const michelinResolved = await resolveMichelinPlaces(GOOGLE_API_KEY);
    attachMichelinBadgesToCandidates(withinMiles, michelinResolved);

    // Filter by quality tier
    const filterStart = Date.now();
    const { elite, moreOptions, excluded: tierExcluded } = filterRestaurantsByTier(withinMiles, qualityMode);
    timings.filtering_ms = Date.now() - filterStart;
    timings.total_ms = Date.now() - t0;

    // Sort by walk time
    const sortByWalkTime = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };

    elite.sort(sortByWalkTime);
    moreOptions.sort(sortByWalkTime);

    const stats = {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      withinMiles: withinMiles.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: tierExcluded.length,
      supplementalAdded,
      normalizedCoords: { lat: gridLat, lng: gridLng },
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      qualityMode,
      gridPoints: gridPoints.length,
      gridRadius,
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
