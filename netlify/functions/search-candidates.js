const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

let MICHELIN_BASE = [];
try {
  MICHELIN_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'michelin_nyc.json'), 'utf8'));
  console.log(`\u2705 Michelin base: ${MICHELIN_BASE.length} entries`);
} catch (err) { console.warn('\u274c Michelin base missing:', err.message); }

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
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

// ---- Michelin ----
async function resolveMichelinPlaces(GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];
  if (MICHELIN_RESOLVED && (Date.now() - MICHELIN_RESOLVED_AT) < MICHELIN_RESOLVE_TTL_MS) return MICHELIN_RESOLVED;
  if (!MICHELIN_BASE?.length) { MICHELIN_RESOLVED = []; MICHELIN_RESOLVED_AT = Date.now(); return []; }

  console.log(`\ud83d\udd0e Resolving Michelin... (${MICHELIN_BASE.length})`);
  const resolved = await runWithConcurrency(MICHELIN_BASE, 5, async (m) => {
    if (!m?.name) return null;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(m.name + ' New York NY')}&type=restaurant&key=${GOOGLE_API_KEY}`;
    try {
      const data = await fetch(url).then(r => r.json());
      if (data.status !== 'OK' || !data.results?.length) return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null };
      const target = normalizeName(m.name);
      let best = data.results[0];
      for (const r of data.results) { const rn = normalizeName(r.name); if (rn === target) { best = r; break; } if (rn.startsWith(target) || target.startsWith(rn)) best = r; }
      return { ...m, place_id: best.place_id || null, address: best.formatted_address || null, lat: best.geometry?.location?.lat ?? null, lng: best.geometry?.location?.lng ?? null, googleRating: best.rating ?? null, googleReviewCount: best.user_ratings_total ?? null };
    } catch { return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null }; }
  });

  MICHELIN_RESOLVED = resolved.filter(Boolean);
  MICHELIN_RESOLVED_AT = Date.now();
  console.log(`\u2705 Michelin resolved: ${MICHELIN_RESOLVED.filter(x => x.place_id).length}/${MICHELIN_RESOLVED.length}`);
  return MICHELIN_RESOLVED;
}

function attachMichelinBadges(candidates, michelinResolved) {
  if (!candidates?.length || !michelinResolved?.length) return;
  const byId = new Map(), byName = new Map();
  for (const m of michelinResolved) { if (m?.place_id) byId.set(m.place_id, m); if (m?.name) byName.set(normalizeName(m.name), m); }
  let matched = 0;
  for (const c of candidates) {
    const m = (c?.place_id && byId.get(c.place_id)) || (normalizeName(c?.name) && byName.get(normalizeName(c.name)));
    if (m) { c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' }; matched++; }
  }
  console.log(`\u2705 Michelin badges: ${matched}`);
}

// ---- Cache ----
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
function getCacheKey(loc, q, c, o) { return `${loc}_${q}_${String(c||'any').toLowerCase().trim()}_${o?'open':'any'}`; }
function getFromCache(key) { const c = resultCache.get(key); if (!c) return null; if (Date.now()-c.timestamp > CACHE_TTL_MS) { resultCache.delete(key); return null; } return c.data; }
function setCache(key, data) { resultCache.set(key, { data, timestamp: Date.now() }); if (resultCache.size > 100) { const o = Array.from(resultCache.entries()).sort((a,b)=>a[1].timestamp-b[1].timestamp)[0]; resultCache.delete(o[0]); } }

function normalizeQualityMode(q) {
  q = String(q||'any').toLowerCase().trim();
  if (q === 'recommended_44') return 'recommended_44';
  if (q === 'elite_45') return 'elite_45';
  if (q === 'strict_elite_46') return 'strict_elite_46';
  if (q === 'strict_elite_47') return 'strict_elite_47';
  if (q === 'five_star') return 'elite_45';
  if (q === 'top_rated_and_above' || q === 'top_rated') return 'recommended_44';
  if (q === 'michelin') return 'michelin';
  return 'any';
}

// ---- Filter with low-review protection ----
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

      // MICHELIN BYPASS: Michelin restaurants always pass all filters
      if (place.michelin) { elite.push(place); continue; }

      // 5.0 with under 500 reviews — likely inflated
      if (rating >= 5.0 && reviews < 500) { excluded.push({ name: place.name, reason: `perfect_5.0 (${reviews}rev)` }); continue; }
      // 4.9 needs 50+ reviews
      if (rating >= 4.9 && reviews < 50) { excluded.push({ name: place.name, reason: `unreliable ${rating}\u2605/${reviews}rev` }); continue; }
      // 4.7-4.8 needs 20+ reviews
      if (rating >= 4.7 && reviews < 20) { excluded.push({ name: place.name, reason: `few_reviews ${rating}\u2605/${reviews}rev` }); continue; }
      // Everything else needs 25+ reviews
      if (reviews < 25) { excluded.push({ name: place.name, reason: `min_reviews (${reviews})` }); continue; }
      if (rating >= eliteMin) elite.push(place);
      else if (!strict47 && rating >= moreMin) moreOptions.push(place);
      else excluded.push({ name: place.name, reason: 'below_threshold' });
    } catch (err) { excluded.push({ name: place?.name, reason: `error: ${err.message}` }); }
  }
  console.log(`FILTER ${qualityMode}: Elite(>=${eliteMin}):${elite.length} | More:${moreOptions.length} | Excl:${excluded.length}`);
  return { elite, moreOptions, excluded };
}

// =========================================================================
// LAYER 2: New API Nearby Search \u2014 5 radius rings (was 7)
// Dropped 500m and 6000m \u2014 500m overlaps with legacy grid center,
// 6000m overlaps heavily with 8000m
// =========================================================================
async function newApiNearbyRings(lat, lng, KEY) {
  const rings = [1000, 2000, 3500, 5500, 8000];
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types';
  const all = [], seen = new Set();

  await runWithConcurrency(rings, 5, async (radius) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          includedTypes: ['restaurant'], maxResultCount: 20, rankPreference: 'POPULARITY',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
          languageCode: 'en'
        })
      });
      if (!resp.ok) { console.log(`\u26a0\ufe0f Nearby ${radius}m: HTTP ${resp.status}`); return; }
      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const id = p.id || ''; if (!id || seen.has(id)) continue; seen.add(id); added++;
        all.push({ place_id: id, name: p.displayName?.text || '', vicinity: p.formattedAddress || '', formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0, user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPrice(p.priceLevel), opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [], _source: 'new_nearby' });
      }
      console.log(`\u2705 Nearby ${radius}m: ${(data.places||[]).length} ret, ${added} new`);
    } catch (err) { console.log(`\u26a0\ufe0f Nearby ${radius}m: ${err.message}`); }
  });
  return all;
}

// =========================================================================
// LAYER 3: Text Search by cuisine \u2014 12 queries (was 18)
// Dropped: pizza, brunch, ramen, vietnamese, greek, steakhouse
// (these overlap heavily with italian, american, japanese, etc.)
// =========================================================================
async function newApiTextByCuisine(lat, lng, userCuisine, KEY) {
  let queries;
  if (userCuisine) {
    queries = [`best ${userCuisine} restaurants`, `top rated ${userCuisine} restaurants`];
  } else {
    queries = [
      'best italian restaurants', 'best japanese restaurants',
      'best chinese restaurants', 'best mexican restaurants',
      'best thai restaurants', 'best indian restaurants',
      'best french restaurants', 'best korean restaurants',
      'best mediterranean restaurants', 'best american restaurants',
      'best sushi restaurants', 'best seafood restaurants'
    ];
  }

  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types';
  const all = [], seen = new Set();

  await runWithConcurrency(queries, 6, async (query) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          textQuery: query, maxResultCount: 20,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 8000 } },
          languageCode: 'en'
        })
      });
      if (!resp.ok) { console.log(`\u26a0\ufe0f Text "${query}": HTTP ${resp.status}`); return; }
      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const id = p.id || ''; if (!id || seen.has(id)) continue; seen.add(id); added++;
        all.push({ place_id: id, name: p.displayName?.text || '', vicinity: p.formattedAddress || '', formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0, user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPrice(p.priceLevel), opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [], _source: 'new_text' });
      }
      console.log(`\u2705 Text "${query}": ${(data.places||[]).length} ret, ${added} new`);
    } catch (err) { console.log(`\u26a0\ufe0f Text "${query}": ${err.message}`); }
  });
  return all;
}

function convertPrice(str) {
  if (!str) return null;
  return { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[str] ?? null;
}

// =========================================================================
// Legacy grid \u2014 2 rings instead of 3 (~25 points instead of ~37)
// No pagination \u2014 just page 1 (20 results per point)
// The new API layers now cover what pages 2-3 used to catch
// =========================================================================
function buildGrid(cLat, cLng) {
  const sp = 0.75 / 69;
  const rings = 2;  // was 3
  const pts = [];
  for (let dy = -rings; dy <= rings; dy++)
    for (let dx = -rings; dx <= rings; dx++) {
      if (Math.sqrt(dy*dy + dx*dx) > rings + 0.5) continue;
      pts.push({ lat: cLat + dy*sp, lng: cLng + dx*sp });
    }
  console.log(`\ud83d\uddfa\ufe0f Grid: ${pts.length} points (2 rings, no pagination)`);
  return pts;
}

// =========================================================================
// MAIN HANDLER
// =========================================================================
exports.handler = async (event) => {
  const stableResponse = (elite=[], more=[], stats={}, error=null) => ({
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elite: elite||[], moreOptions: more||[], confirmedAddress: stats.confirmedAddress||null, userLocation: stats.userLocation||null, stats, error })
  });

  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };

    const t0 = Date.now();
    const timings = { legacy_ms: 0, new_nearby_ms: 0, new_text_ms: 0, filtering_ms: 0, total_ms: 0 };
    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, quality } = body;
    const qualityMode = normalizeQualityMode(quality || 'any');
    const KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!KEY) return stableResponse([], [], {}, 'API key not configured');

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v8';
    const cached = getFromCache(cacheKey);
    if (cached) { timings.total_ms = Date.now()-t0; return stableResponse(cached.elite, cached.moreOptions, { ...cached.stats, cached: true, performance: { ...timings, cache_hit: true } }); }

    // Geocode
    let lat, lng, confirmedAddress = null;
    const locStr = String(location||'').trim();
    const cm = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (cm) { lat = +cm[1]; lng = +cm[2]; confirmedAddress = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`; }
    else {
      const gd = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${KEY}`).then(r=>r.json());
      if (gd.status !== 'OK') return stableResponse([],[],{ performance: { total_ms: Date.now()-t0 } }, `Geocode failed: ${gd.status}`);
      lat = gd.results[0].geometry.location.lat; lng = gd.results[0].geometry.location.lng;
      confirmedAddress = gd.results[0].formatted_address;
    }
    const gLat = Math.round(lat*10000)/10000, gLng = Math.round(lng*10000)/10000;

    // Michelin mode (unchanged)
    if (qualityMode === 'michelin') {
      const resolved = await resolveMichelinPlaces(KEY);
      const within = resolved.filter(r => r?.lat != null && r?.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating, googleReviewCount: r.googleReviewCount,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: null,
          michelin: { stars: r.stars||0, distinction: r.distinction||'star' } };
      }).filter(r => r.distanceMiles <= 15).sort((a,b) => a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, michelinMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // =========================================================================
    // THREE-LAYER PARALLEL SEARCH (speed-optimized)
    // =========================================================================
    const cuisineStr = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

    const [legacyFlat, nearbyResults, textResults] = await Promise.all([

      // LAYER 1: Legacy grid \u2014 NO PAGINATION (just page 1 = 20 results per point)
      // This alone saves 4-8 seconds because we skip the 2s waits for page tokens
      (async () => {
        const start = Date.now();
        const grid = buildGrid(gLat, gLng);
        const results = await runWithConcurrency(grid, 10, async (pt) => {
          let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${pt.lat},${pt.lng}&radius=800&type=restaurant&key=${KEY}`;
          if (cuisineStr) url += `&keyword=${encodeURIComponent(cuisineStr)}`;
          if (openNow) url += `&opennow=true`;
          const data = await fetch(url).then(r => r.json());
          return (data.status === 'OK') ? (data.results || []) : [];
        });
        timings.legacy_ms = Date.now() - start;
        return results.flat();
      })(),

      // LAYER 2: New Nearby rings
      (async () => { const s = Date.now(); const r = await newApiNearbyRings(gLat, gLng, KEY); timings.new_nearby_ms = Date.now()-s; return r; })(),

      // LAYER 3: New Text Search by cuisine
      (async () => { const s = Date.now(); const r = await newApiTextByCuisine(gLat, gLng, cuisineStr, KEY); timings.new_text_ms = Date.now()-s; return r; })()
    ]);

    // Merge & deduplicate
    const seen = new Set(), all = [];
    let legacyN = 0, nearbyN = 0, textN = 0, rawN = 0;

    for (const p of legacyFlat) { rawN++; if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); legacyN++; } }
    for (const p of nearbyResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); nearbyN++; } }
    for (const p of textResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); textN++; } }

    console.log(`\ud83d\udcca MERGE: Legacy=${legacyN} + Nearby=+${nearbyN} + Text=+${textN} = ${all.length}`);

    // Distance
    const withDist = all.map(p => {
      const pLat = p.geometry?.location?.lat, pLng = p.geometry?.location?.lng;
      const d = (pLat != null && pLng != null) ? haversineMiles(gLat, gLng, pLat, pLng) : 999;
      return {
        place_id: p.place_id, name: p.name,
        vicinity: p.vicinity || p.formatted_address || '', formatted_address: p.formatted_address || p.vicinity || '',
        price_level: p.price_level, opening_hours: p.opening_hours, geometry: p.geometry, types: p.types || [],
        googleRating: p.rating || p.googleRating || 0, googleReviewCount: p.user_ratings_total || p.googleReviewCount || 0,
        distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
        _source: p._source || 'legacy'
      };
    });

    const within = withDist.filter(r => r.distanceMiles <= 7.0);
    console.log(`\ud83d\udcca Within 7mi: ${within.length}`);

    const michelin = await resolveMichelinPlaces(KEY);
    attachMichelinBadges(within, michelin);

    // INJECT Michelin restaurants that weren't in Google results
    // This ensures they appear in 4.7+, 4.5+, etc. modes
    const existingIds = new Set(within.map(r => r.place_id).filter(Boolean));
    const existingNames = new Set(within.map(r => normalizeName(r.name)).filter(Boolean));
    let injected = 0;
    for (const m of michelin) {
      if (!m?.lat || !m?.lng) continue;
      // Skip if already matched
      if (m.place_id && existingIds.has(m.place_id)) continue;
      if (m.name && existingNames.has(normalizeName(m.name))) continue;
      const d = haversineMiles(gLat, gLng, m.lat, m.lng);
      if (d > 7.0) continue; // same radius as normal results
      within.push({
        place_id: m.place_id, name: m.name,
        vicinity: m.address || '', formatted_address: m.address || '',
        price_level: null, opening_hours: null,
        geometry: { location: { lat: m.lat, lng: m.lng } },
        types: [], googleRating: m.googleRating || 0, googleReviewCount: m.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: { stars: m.stars || 0, distinction: m.distinction || 'star' },
        _source: 'michelin_inject'
      });
      injected++;
    }
    if (injected) console.log(`\u2705 Injected ${injected} Michelin restaurants not in Google results`);

    const fStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within, qualityMode);
    timings.filtering_ms = Date.now() - fStart;
    timings.total_ms = Date.now() - t0;

    const sortFn = (a,b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return String(a.name||'').localeCompare(String(b.name||''));
    };
    elite.sort(sortFn); moreOptions.sort(sortFn);

    const stats = {
      totalRaw: rawN, uniquePlaceIds: all.length, withinMiles: within.length,
      eliteCount: elite.length, moreOptionsCount: moreOptions.length, excluded: excluded.length,
      sources: { legacy: legacyN, newNearby: nearbyN, newText: textN },
      confirmedAddress, userLocation: { lat: gLat, lng: gLng }, qualityMode,
      performance: { ...timings, cache_hit: false }
    };

    setCache(cacheKey, { elite, moreOptions, stats });
    return stableResponse(elite, moreOptions, stats);

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ elite: [], moreOptions: [], stats: {}, error: error.message }) };
  }
};
