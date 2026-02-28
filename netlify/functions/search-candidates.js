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

let BIB_GOURMAND_BASE = [];
try {
  BIB_GOURMAND_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'bib_gourmand_nyc.json'), 'utf8'));
  console.log(`\u2705 Bib Gourmand base: ${BIB_GOURMAND_BASE.length} entries`);
} catch (err) { console.warn('\u274c Bib Gourmand base missing:', err.message); }

let CHASE_SAPPHIRE_BASE = [];
try {
  CHASE_SAPPHIRE_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'chase_sapphire_nyc.json'), 'utf8'));
  console.log(`\u2705 Chase Sapphire base: ${CHASE_SAPPHIRE_BASE.length} entries`);
} catch (err) { console.warn('\u274c Chase Sapphire base missing:', err.message); }

let RAKUTEN_BASE = [];
try {
  RAKUTEN_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'rakuten_nyc.json'), 'utf8'));
  console.log(`\u2705 Rakuten base: ${RAKUTEN_BASE.length} entries`);
} catch (err) { console.warn('\u274c Rakuten base missing:', err.message); }

let POPULAR_BASE = [];
try {
  POPULAR_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'popular_nyc.json'), 'utf8'));
  console.log(`\u2705 Popular base: ${POPULAR_BASE.length} entries`);
} catch (err) { console.warn('\u26a0\ufe0f Popular base missing:', err.message); }

let DEPOSIT_LOOKUP = {};
try {
  DEPOSIT_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'deposit_lookup.json'), 'utf8'));
  console.log(`\u2705 Deposit lookup: ${Object.keys(DEPOSIT_LOOKUP).length} entries`);
} catch (err) { console.warn('\u274c Deposit lookup missing:', err.message); }

let BOOKING_LOOKUP = {};
let BOOKING_KEYS = [];
try {
  BOOKING_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'booking_lookup.json'), 'utf8'));
  BOOKING_KEYS = Object.keys(BOOKING_LOOKUP);
  console.log(`\u2705 Booking lookup: ${BOOKING_KEYS.length} entries`);
} catch (err) { console.warn('\u274c Booking lookup missing:', err.message); }

let CUISINE_LOOKUP = {};
try {
  CUISINE_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'cuisine_lookup.json'), 'utf8'));
  console.log(`\u2705 Cuisine lookup: ${Object.keys(CUISINE_LOOKUP).length} entries`);
} catch (err) { console.warn('\u26a0\ufe0f Cuisine lookup missing:', err.message); }

// ── REVIEW VELOCITY DATA ──
let REVIEW_SNAPSHOTS = {};
try {
  REVIEW_SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'review_snapshots.json'), 'utf8'));
  const withVelocity = Object.values(REVIEW_SNAPSHOTS).filter(r => r.snapshots && r.snapshots.length >= 2).length;
  console.log(`\u2705 Review snapshots: ${Object.keys(REVIEW_SNAPSHOTS).length} restaurants (${withVelocity} with velocity data)`);
} catch (err) { console.warn('\u26a0\ufe0f Review snapshots missing:', err.message); }

/**
 * Calculate review velocity for a restaurant
 * Returns object with growth stats or null if not enough data
 */
function getReviewVelocity(placeId) {
  if (!placeId || !REVIEW_SNAPSHOTS[placeId]) return null;
  const data = REVIEW_SNAPSHOTS[placeId];
  if (!data.snapshots || data.snapshots.length < 2) return null;

  const latest = data.snapshots[data.snapshots.length - 1];
  const oldest = data.snapshots[0];
  const daysBetween = Math.max(1, (new Date(latest.date) - new Date(oldest.date)) / 86400000);
  const growth = latest.review_count - oldest.review_count;
  const growthPer30 = Math.round((growth / daysBetween) * 30);

  return {
    growth30: growthPer30,
    totalGrowth: growth,
    daysTracked: Math.round(daysBetween),
    latestCount: latest.review_count,
    latestRating: latest.rating,
    firstSeen: data.first_seen || oldest.date
  };
}

// ── RESERVATION LIKELIHOOD DATA ──
let LIKELIHOOD_DATA = {};
let LIKELIHOOD_TIME_MODS = {};
let LIKELIHOOD_PARTY_MODS = {};
try {
  LIKELIHOOD_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'reservation_likelihood.json'), 'utf8'));
  LIKELIHOOD_TIME_MODS = LIKELIHOOD_DATA._time_modifiers || {};
  LIKELIHOOD_PARTY_MODS = LIKELIHOOD_DATA._party_size_modifiers || {};
  const count = Object.keys(LIKELIHOOD_DATA).filter(k => !k.startsWith('_')).length;
  console.log(`\u2705 Reservation likelihood: ${count} restaurants profiled`);
} catch (err) { console.warn('\u26a0\ufe0f Reservation likelihood missing:', err.message); }

/**
 * Get reservation likelihood for a restaurant
 * Returns the pre-computed profile or null
 */
function getReservationLikelihood(placeId) {
  if (!placeId || !LIKELIHOOD_DATA[placeId]) return null;
  const data = LIKELIHOOD_DATA[placeId];
  if (!data.demand_score && data.demand_score !== 0) return null;
  return data;
}

const CUISINE_FILTER_MAP = {
  'american':       ['American', 'Soul Food', 'Hawaiian', 'Tex-Mex'],
  'barbecue':       ['Barbecue'],
  'chinese':        ['Chinese', 'Cantonese', 'Taiwanese'],
  'french':         ['French'],
  'greek':          ['Greek'],
  'indian':         ['Indian'],
  'italian':        ['Italian', 'Pizza'],
  'japanese':       ['Japanese', 'Sushi', 'Ramen'],
  'korean':         ['Korean'],
  'mediterranean':  ['Mediterranean', 'Turkish', 'Israeli', 'Middle Eastern', 'Lebanese', 'Moroccan', 'Persian'],
  'mexican':        ['Mexican', 'Latin'],
  'seafood':        ['Seafood'],
  'spanish':        ['Spanish'],
  'steakhouse':     ['Steakhouse'],
  'sushi':          ['Sushi'],
  'thai':           ['Thai'],
  'vietnamese':     ['Vietnamese']
};

function cuisineLookupMatches(name, userCuisine, fallbackCuisine) {
  if (!userCuisine || !name) return true;
  const allowed = CUISINE_FILTER_MAP[userCuisine.toLowerCase()] || [];
  if (allowed.length === 0) return true; // no filter map entry = can't filter, allow

  // Check CUISINE_LOOKUP first (most accurate source)
  const c = CUISINE_LOOKUP[name];
  if (c) {
    return c.split('/').some(p => allowed.some(a => p.trim().toLowerCase().includes(a.toLowerCase())));
  }

  // Fallback: check the restaurant's own cuisine field
  if (fallbackCuisine) {
    const fb = String(fallbackCuisine).toLowerCase();
    return allowed.some(a => fb.includes(a.toLowerCase()));
  }

  // Not in lookup AND no fallback cuisine → EXCLUDE (strict mode)
  return false;
}

function normalizeForBooking(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-\u2013\u2014]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|caf\u00e9|bistro|brasserie|kitchen|dining|room)$/i, '')
    .replace(/^the\s+/, '')
    .trim();
}

function getBookingInfo(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (BOOKING_LOOKUP[key]) return BOOKING_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, '');
  if (BOOKING_LOOKUP[noThe]) return BOOKING_LOOKUP[noThe];
  const norm = normalizeForBooking(name);
  if (norm && BOOKING_LOOKUP[norm]) return BOOKING_LOOKUP[norm];
  for (const lk of BOOKING_KEYS) {
    if (lk.length < 4) continue;
    if (key.includes(lk) || lk.includes(key)) return BOOKING_LOOKUP[lk];
    if (norm && norm.length >= 4 && (norm.includes(lk) || lk.includes(norm))) return BOOKING_LOOKUP[lk];
  }
  return null;
}

function getDepositType(name) {
  if (!name) return 'unknown';
  const key = name.toLowerCase().trim();
  if (DEPOSIT_LOOKUP[key]) return DEPOSIT_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, '');
  if (DEPOSIT_LOOKUP[noThe]) return DEPOSIT_LOOKUP[noThe];
  return 'unknown';
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
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

async function detectBookingPlatforms(restaurants, KEY) {
  // Pass 1: Check booking lookup table (instant, no API calls)
  for (const r of restaurants) {
    if (r.booking_platform) continue;
    const bookingInfo = getBookingInfo(r.name);
    if (bookingInfo) {
      r.booking_platform = bookingInfo.platform;
      r.booking_url = bookingInfo.url;
    }
  }

  // Pass 2: Check if websiteUri already IS a booking platform URL
  for (const r of restaurants) {
    if (r.booking_platform) continue;
    if (!r.websiteUri) continue;
    const w = (r.websiteUri || '').toLowerCase();
    if (w.includes('resy.com/cities/')) {
      r.booking_platform = 'resy';
      r.booking_url = r.websiteUri;
    } else if (w.includes('opentable.com/r/') || w.includes('opentable.com/restaurant/')) {
      r.booking_platform = 'opentable';
      r.booking_url = r.websiteUri;
    } else if ((w.includes('exploretock.com/') || w.includes('tock.com/')) && w.split('/').length > 3) {
      r.booking_platform = 'tock';
      r.booking_url = r.websiteUri;
    }
  }

  // Pass 3: Crawl restaurant websites for booking links (max 10, only unmatched)
  const unmatched = restaurants.filter(r => !r.booking_platform && r.websiteUri);
  const toCrawl = unmatched.slice(0, 30);
  if (toCrawl.length > 0) {
    console.log(`\ud83d\udd0d Crawling ${toCrawl.length} restaurant websites for booking links...`);
    await runWithConcurrency(toCrawl, 5, async (r) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(r.websiteUri, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow'
        });
        clearTimeout(timeout);
        if (!resp.ok) return;
        const html = await resp.text();
        const lower = html.toLowerCase();
        if (lower.includes('resy.com/cities/')) {
          const m = html.match(/https?:\/\/resy\.com\/cities\/[a-z-]+\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'resy'; r.booking_url = m[0]; }
        } else if (lower.includes('opentable.com/r/') || lower.includes('opentable.com/restref/')) {
          const m = html.match(/https?:\/\/(?:www\.)?opentable\.com\/r(?:estref)?\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'opentable'; r.booking_url = m[0]; }
        } else if (lower.includes('exploretock.com/') || lower.includes('tock.com/')) {
          const m = html.match(/https?:\/\/(?:www\.)?exploretock\.com\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'tock'; r.booking_url = m[0]; }
        }
      } catch (e) { /* timeout or fetch error — skip */ }
    });
  }

  const matched = restaurants.filter(r => r.booking_platform).length;
  const crawlMatched = toCrawl.filter(r => r.booking_platform).length;
  console.log(`\u2705 Booking: ${matched}/${restaurants.length} matched (lookup: ${matched - crawlMatched}, crawl: ${crawlMatched})`);
}

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

function getBibGourmandPlaces() {
  if (!BIB_GOURMAND_BASE?.length) return [];
  return BIB_GOURMAND_BASE.filter(b => b.lat != null && b.lng != null);
}

function getPopularPlaces() {
  if (!POPULAR_BASE?.length) return [];
  return POPULAR_BASE.filter(p => p.lat != null && p.lng != null);
}

function attachMichelinBadges(candidates, michelinResolved) {
  if (!candidates?.length || !michelinResolved?.length) return;
  const byId = new Map(), byName = new Map();
  for (const m of michelinResolved) { if (m?.place_id) byId.set(m.place_id, m); if (m?.name) byName.set(normalizeName(m.name), m); }
  let matched = 0;
  for (const c of candidates) {
    const m = (c?.place_id && byId.get(c.place_id)) || (normalizeName(c?.name) && byName.get(normalizeName(c.name)));
    if (m) {
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      c.booking_platform = m.booking_platform || null;
      c.booking_url = m.booking_url || null;
      matched++;
    }
  }
  console.log(`\u2705 Michelin badges: ${matched}`);
}

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
  if (q === 'bib_gourmand') return 'bib_gourmand';
  if (q === 'chase_sapphire') return 'chase_sapphire';
  if (q === 'rakuten') return 'rakuten';
  return 'any';
}

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

      // CHASE SAPPHIRE BYPASS: Chase partner restaurants always pass filters
      if (place.chase_sapphire) { moreOptions.push(place); continue; }

      // 5.0 with under 500 reviews — likely inflated
      if (rating >= 5.0 && reviews < 500) { excluded.push({ name: place.name, reason: `perfect_5.0 (${reviews}rev)` }); continue; }
      // 4.9 needs 50+ reviews
      if (rating >= 4.9 && reviews < 50) { excluded.push({ name: place.name, reason: `unreliable ${rating}\u2605/${reviews}rev` }); continue; }
      // 4.7-4.8 needs 50+ reviews
      if (rating >= 4.7 && reviews < 50) { excluded.push({ name: place.name, reason: `few_reviews ${rating}\u2605/${reviews}rev` }); continue; }
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

async function newApiNearbyRings(lat, lng, KEY) {
  const rings = [1000, 2000, 3500, 5500, 8000];
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types,places.websiteUri';
  const all = [], seen = new Set();

  await runWithConcurrency(rings, 5, async (radius) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          includedTypes: ['restaurant'], maxResultCount: 20, rankPreference: 'POPULARITY',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
          minRating: 4.4,
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
          types: p.types || [], websiteUri: p.websiteUri || null, _source: 'new_nearby' });
      }
      console.log(`\u2705 Nearby ${radius}m: ${(data.places||[]).length} ret, ${added} new`);
    } catch (err) { console.log(`\u26a0\ufe0f Nearby ${radius}m: ${err.message}`); }
  });
  return all;
}

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

  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types,places.websiteUri';
  const all = [], seen = new Set();

  await runWithConcurrency(queries, 6, async (query) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          textQuery: query, maxResultCount: 20,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 8000 } },
          minRating: 4.4,
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
          types: p.types || [], websiteUri: p.websiteUri || null, _source: 'new_text' });
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

function buildGrid(cLat, cLng) {
  const sp = 0.75 / 69;
  const rings = 2;
  const pts = [];
  for (let dy = -rings; dy <= rings; dy++)
    for (let dx = -rings; dx <= rings; dx++) {
      if (Math.sqrt(dy*dy + dx*dx) > rings + 0.5) continue;
      pts.push({ lat: cLat + dy*sp, lng: cLng + dx*sp });
    }
  console.log(`\ud83d\uddfa\ufe0f Grid: ${pts.length} points (2 rings, no pagination)`);
  return pts;
}

exports.handler = async (event) => {
  const stableResponse = (elite=[], more=[], stats={}, error=null) => {
    // Enrich all results with deposit info
    const enrichDeposit = (arr) => (arr || []).map(r => ({
      ...r,
      deposit_type: r.deposit_type || getDepositType(r.name)
    }));
    return {
      statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elite: enrichDeposit(elite), moreOptions: enrichDeposit(more), confirmedAddress: stats.confirmedAddress||null, userLocation: stats.userLocation||null, stats, error, likelihood_modifiers: { time: LIKELIHOOD_TIME_MODS, party: LIKELIHOOD_PARTY_MODS } })
    };
  };

  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };

    const t0 = Date.now();
    const timings = { legacy_ms: 0, new_nearby_ms: 0, new_text_ms: 0, filtering_ms: 0, total_ms: 0 };
    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, quality, broadCity, transport } = body;
    const qualityMode = normalizeQualityMode(quality || 'any');
    const KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!KEY) return stableResponse([], [], {}, 'API key not configured');

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v15';
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

    // Build Chase name lookup for tagging
    const chaseNameLookup = new Set();
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (c?.name) chaseNameLookup.add(normalizeName(c.name));
    }

    // Michelin mode — with cuisine filter support
    if (qualityMode === 'michelin') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      const resolved = await resolveMichelinPlaces(KEY);
      const within = resolved.filter(r => r?.lat != null && r?.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating, googleReviewCount: r.googleReviewCount,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: { stars: r.stars||0, distinction: r.distinction||'star' },
          cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,
          chase_sapphire: chaseNameLookup.has(normalizeName(r.name)) };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine))
        .sort((a,b) => (b.michelin?.stars || 0) - (a.michelin?.stars || 0) || (b.googleRating || 0) - (a.googleRating || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, michelinMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // Bib Gourmand mode — 15 mile radius (pre-resolved, no API calls needed)
    if (qualityMode === 'bib_gourmand') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      const bibPlaces = getBibGourmandPlaces();
      console.log(`\ud83c\udf7d\ufe0f Bib Gourmand: ${bibPlaces.length} pre-resolved entries`);
      const within = bibPlaces.map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating, googleReviewCount: r.googleReviewCount,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: { stars: 0, distinction: 'bib_gourmand' }, cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,
          chase_sapphire: chaseNameLookup.has(normalizeName(r.name)) };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine))
        .sort((a,b) => (b.googleRating || 0) - (a.googleRating || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, bibGourmandMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // Chase Sapphire Reserve mode — 15 mile radius from chase_sapphire_nyc.json
    if (qualityMode === 'chase_sapphire') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      console.log(`\ud83d\udcb3 Chase Sapphire: ${CHASE_SAPPHIRE_BASE.length} entries`);
      const within = CHASE_SAPPHIRE_BASE.filter(r => r.lat != null && r.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id || null, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating || 0, googleReviewCount: r.googleReviewCount || 0,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: null, cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,
          chase_sapphire: true };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine))
        .sort((a,b) => (b.googleRating || 0) - (a.googleRating || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, chaseSapphireMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // Rakuten mode — 15 mile radius from rakuten_nyc.json
    if (qualityMode === 'rakuten') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      console.log('Rakuten: ' + RAKUTEN_BASE.length + ' entries');
      const within = RAKUTEN_BASE.filter(r => r.lat != null && r.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id || null, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating || 0, googleReviewCount: r.googleReviewCount || 0,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: null, cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,
          rakuten: true };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine))
        .sort((a,b) => (b.googleRating || 0) - (a.googleRating || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, rakutenMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // =========================================================================
    // ALL NYC FAST PATH — skip Google API entirely, use booking_lookup only
    // =========================================================================
    const cuisineStr = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
    const isAllNYC = (transport === 'all_nyc' || broadCity === true || broadCity === 'true');

    if (isAllNYC && BOOKING_KEYS.length > 0) {
      console.log(`🗽 ALL NYC MODE — skipping Google API, using ${BOOKING_KEYS.length} booking_lookup entries`);
      const injected = [];
      for (const [key, entry] of Object.entries(BOOKING_LOOKUP)) {
        if (!entry.lat || !entry.lng) continue;

        // Cuisine filter
        if (cuisineStr) {
          const entryCuisine = CUISINE_LOOKUP[key] || entry.cuisine || null;
          if (!entryCuisine) continue;
          const c = entryCuisine.toLowerCase();
          const cs = cuisineStr.toLowerCase();
          if (!c.includes(cs) && !cs.includes(c)) continue;
        }

        const d = haversine(gLat, gLng, entry.lat, entry.lng);
        injected.push({
          name: key,
          place_id: entry.place_id || null,
          address: entry.address || entry.neighborhood || null,
          lat: entry.lat, lng: entry.lng,
          rating: entry.google_rating || entry.resy_rating || 0,
          user_ratings_total: entry.google_reviews || 0,
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat: entry.lat, lng: entry.lng } },
          types: ['restaurant'],
          booking_platform: entry.platform,
          booking_url: entry.url,
          distanceMiles: Math.round(d*10)/10,
          walkMinEstimate: Math.round(d*20),
          driveMinEstimate: Math.round(d*4),
          transitMinEstimate: Math.round(d*6),
          googleRating: entry.google_rating || 0,
          googleReviewCount: entry.google_reviews || 0,
        });
      }
      console.log(`🗽 Injected ${injected.length} restaurants from booking_lookup`);

      // Apply quality filter
      const { elite, moreOptions, excluded } = applyQualityFilter(injected, qualityMode);
      console.log(`FILTER ${qualityMode}: Elite(>=4.5):${elite.length} | More:${moreOptions.length} | Excl:${excluded.length}`);

      // Detect booking platforms
      detectBookingPlatforms(elite);
      detectBookingPlatforms(moreOptions);

      const stats = {
        confirmedAddress, userLocation: { lat: gLat, lng: gLng },
        allNYCMode: true, count: elite.length + moreOptions.length,
        performance: { ...timings, cache_hit: false }
      };
      setCache(cacheKey, { elite, moreOptions, stats });
      return stableResponse(elite, moreOptions, stats);
    }

    // =========================================================================
    // THREE-LAYER PARALLEL SEARCH (speed-optimized) — for non-All-NYC searches
    // =========================================================================

    const [legacyFlat, nearbyResults, textResults] = await Promise.all([

      // LAYER 1: Legacy grid — NO PAGINATION (just page 1 = 20 results per point)
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

    // Cuisine type mapping: our dropdown value -> Google place types that match
    const CUISINE_TYPE_MAP = {
      'american': ['american_restaurant', 'hamburger_restaurant', 'steak_house', 'breakfast_restaurant', 'brunch_restaurant'],
      'barbecue': ['barbecue_restaurant'],
      'chinese': ['chinese_restaurant'],
      'french': ['french_restaurant'],
      'greek': ['greek_restaurant'],
      'indian': ['indian_restaurant'],
      'italian': ['italian_restaurant'],
      'japanese': ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'],
      'korean': ['korean_restaurant'],
      'mediterranean': ['mediterranean_restaurant', 'greek_restaurant', 'middle_eastern_restaurant', 'lebanese_restaurant', 'turkish_restaurant'],
      'mexican': ['mexican_restaurant'],
      'seafood': ['seafood_restaurant'],
      'spanish': ['spanish_restaurant'],
      'steakhouse': ['steak_house'],
      'sushi': ['sushi_restaurant', 'japanese_restaurant'],
      'thai': ['thai_restaurant'],
      'vietnamese': ['vietnamese_restaurant']
    };

    // Types to EXCLUDE — not real sit-down restaurants
    const HARD_JUNK_TYPES = [
      'ice_cream_shop', 'coffee_shop', 'cafe', 'bakery', 'sandwich_shop',
      'bagel_shop', 'donut_shop', 'juice_shop', 'smoothie_shop',
      'dessert_shop', 'dessert_restaurant', 'pizza_takeout',
      'food_court', 'fast_food_restaurant', 'convenience_store',
      'grocery_store', 'supermarket', 'liquor_store', 'night_club',
      'meal_delivery', 'meal_takeaway',
      'shopping_mall', 'department_store', 'tourist_attraction',
      'amusement_park', 'museum', 'park', 'stadium', 'movie_theater',
      'observation_deck', 'visitor_center', 'event_venue', 'market',
      'clothing_store', 'shoe_store', 'electronics_store',
      'deli', 'food_stand', 'kiosk'
    ];

    const ALWAYS_JUNK_TYPES = [
      'ice_cream_shop', 'coffee_shop', 'bakery', 'bagel_shop', 'donut_shop',
      'juice_shop', 'smoothie_shop', 'dessert_shop', 'food_court',
      'convenience_store', 'grocery_store', 'supermarket', 'liquor_store',
      'shopping_mall', 'department_store', 'clothing_store', 'shoe_store',
      'electronics_store', 'museum', 'amusement_park', 'stadium',
      'movie_theater', 'observation_deck', 'visitor_center', 'night_club'
    ];

    const EXCLUDED_NAME_PATTERNS = [
      /\bstarbucks\b/i, /\bdunkin\b/i, /\bmcdonald/i, /\bsubway\b/i,
      /\bchipotle\b/i, /\bshake shack\b/i, /\bsweetgreen\b/i,
      /\bpanera\b/i, /\bpret a manger\b/i, /\bchick-fil-a\b/i,
      /\bwendy'?s\b/i, /\bburger king\b/i, /\btaco bell\b/i,
      /\bpopeyes\b/i, /\bfive guys\b/i, /\bpapa john/i, /\bdomino/i,
      /\bpizza hut\b/i, /\blittle caesars\b/i, /\bjack in the box\b/i,
      /\bkfc\b/i, /\barby'?s\b/i, /\bsonic drive/i, /\bwhataburger\b/i,
      /\bdeli\b/i, /\bbodega\b/i, /\bice cream\b/i, /\bgelato\b/i,
      /\bfrozen yogurt\b/i, /\bfroyo\b/i, /\bjuice\b/i, /\bsmoothie\b/i,
      /\bboba\b/i, /\bbubble tea\b/i, /\btea shop\b/i,
      /\bcoffee\b/i, /\bespresso\b/i, /\bcaf\u00e9\b(?!\s*(otro|spaghetti|mars|zaffri|mado|rue))/i,
      /\bbakery\b/i, /\bdonut\b/i, /\bdoughnut\b/i, /\bbagel\b/i,
      /\bcake shop\b/i, /\bcupcake\b/i, /\bpastry\b/i, /\bdessert\b/i,
      /\bcreperie\b/i, /\bpatisserie\b/i,
      /\bfood truck\b/i, /\bfood cart\b/i, /\bfood stand\b/i,
      /\bhalal cart\b/i, /\bkiosk\b/i,
      /\bgrill & deli\b/i, /\bgrill and deli\b/i,
      /\bpizza by the slice\b/i, /\b\$1 pizza\b/i, /\bdollar pizza\b/i,
      /\bwestfield\b/i, /\bobservatory\b/i, /\bpier \d+\b/i,
      /\bworld trade center\b/i, /\btimes square\b/i,
      /\bjazz club\b/i, /\bcomedy club\b/i, /\bkaraoke\b/i,
      /\bbowling\b/i, /\barcade\b/i, /\bbilliard/i, /\bpool hall\b/i,
      /\bnight ?club\b/i, /\bdisco\b/i, /\bhookah\b/i, /\bshisha\b/i,
      /\bwine bar\b$/i, /\bcocktail bar\b$/i, /\bsports bar\b$/i,
      /\btaproom\b/i, /\bbeer hall\b/i, /\bbrewery\b/i, /\bbrew pub\b/i,
      /\bpub\b$/i, /\btavern\b$/i
    ];

    const RESTAURANT_WORDS = /restaurant|grill|kitchen|bistro|trattoria|osteria|ristorante|brasserie|steakhouse|sushi|ramen|taqueria|pizzeria|diner|eatery|cuisine|bbq|barbecue|seafood|noodle|dumpling|dim sum|omakase|izakaya|cantina|chophouse|taverna/i;

    // Merge & deduplicate
    const seen = new Set(), all = [];
    let legacyN = 0, nearbyN = 0, textN = 0, rawN = 0;

    for (const p of legacyFlat) { rawN++; if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); legacyN++; } }
    for (const p of nearbyResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); nearbyN++; } }
    for (const p of textResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); textN++; } }

    console.log(`\ud83d\udcca MERGE: Legacy=${legacyN} + Nearby=+${nearbyN} + Text=+${textN} = ${all.length}`);

    // Filter out non-restaurants
    const beforeExclude = all.length;
    const cleaned = all.filter(p => {
      const pTypes = (p.types || []).map(t => t.toLowerCase());
      const pName = (p.name || '');
      const hasRestaurantType = pTypes.some(t => t.includes('restaurant'));

      // HARD KILL: these types are NEVER restaurants, even if Google also tags them "restaurant"
      if (pTypes.some(t => ALWAYS_JUNK_TYPES.includes(t))) return false;

      // SOFT KILL: these types get removed unless they also have restaurant type AND restaurant name
      const hasJunkType = pTypes.some(t => HARD_JUNK_TYPES.includes(t));
      if (hasJunkType && !hasRestaurantType) return false;
      if (hasJunkType && hasRestaurantType && !RESTAURANT_WORDS.test(pName)) return false;

      // Name-based exclusions — always applied
      if (EXCLUDED_NAME_PATTERNS.some(rx => rx.test(pName))) return false;

      // Bars without restaurant type or restaurant-like name
      if (pTypes.includes('bar') && !hasRestaurantType && !RESTAURANT_WORDS.test(pName)) return false;

      // Fast food with restaurant type still gets cut unless it has a restaurant name
      if (pTypes.includes('fast_food_restaurant') && !RESTAURANT_WORDS.test(pName)) return false;
      if (pTypes.includes('hamburger_restaurant') && !RESTAURANT_WORDS.test(pName)) return false;

      return true;
    });
    if (cleaned.length < beforeExclude) console.log(`\ud83e\uddf9 Excluded ${beforeExclude - cleaned.length} non-restaurants (chains/delis/coffee/bars/venues)`);

    // Post-filter by cuisine type
    let cuisineFiltered = cleaned;
    if (cuisineStr) {
      const allowedTypes = CUISINE_TYPE_MAP[cuisineStr.toLowerCase()] || [];
      if (allowedTypes.length > 0) {
        const beforeCount = cuisineFiltered.length;
        cuisineFiltered = cuisineFiltered.filter(p => {
          // Check our cuisine lookup first (most accurate)
          const lookupResult = cuisineLookupMatches(p.name, cuisineStr, p.cuisine);
          if (lookupResult) return true;   // matched via lookup or fallback cuisine
          // Not matched — fall back to Google types and name
          const pTypes = (p.types || []).map(t => t.toLowerCase());
          const matches = allowedTypes.some(at => pTypes.includes(at));
          const nameMatch = (p.name || '').toLowerCase().includes(cuisineStr.toLowerCase());
          return matches || nameMatch;
        });
        console.log(`\ud83c\udf55 Cuisine filter "${cuisineStr}": ${beforeCount} \u2192 ${cuisineFiltered.length} (removed ${beforeCount - cuisineFiltered.length})`);
      }
    }

    // Exclude cheap ($) spots — price_level 1 is fast food / takeout tier
    const beforePrice = cuisineFiltered.length;
    cuisineFiltered = cuisineFiltered.filter(p => {
      const pl = p.price_level ?? p.priceLevel ?? null;
      if (pl === 1) return false;
      return true;
    });
    if (cuisineFiltered.length < beforePrice) console.log(`\ud83d\udcb0 Price filter: removed ${beforePrice - cuisineFiltered.length} cheap ($) spots`);

    // Distance
    const withDist = cuisineFiltered.map(p => {
      const pLat = p.geometry?.location?.lat, pLng = p.geometry?.location?.lng;
      const d = (pLat != null && pLng != null) ? haversineMiles(gLat, gLng, pLat, pLng) : 999;
      let bp = p.booking_platform || null;
      let bu = p.booking_url || null;
      if (!bp) {
        const bookingInfo = getBookingInfo(p.name);
        if (bookingInfo) { bp = bookingInfo.platform; bu = bookingInfo.url; }
      }
      if (!bp && p.websiteUri) {
        const w = (p.websiteUri || '').toLowerCase();
        if (w.includes('resy.com/cities/')) { bp = 'resy'; bu = p.websiteUri; }
        else if (w.includes('opentable.com/r/') || w.includes('opentable.com/restaurant/')) { bp = 'opentable'; bu = p.websiteUri; }
        else if ((w.includes('exploretock.com/') || w.includes('tock.com/')) && w.split('/').length > 3) { bp = 'tock'; bu = p.websiteUri; }
      }
      return {
        place_id: p.place_id, name: p.name,
        vicinity: p.vicinity || p.formatted_address || '', formatted_address: p.formatted_address || p.vicinity || '',
        price_level: p.price_level, opening_hours: p.opening_hours, geometry: p.geometry, types: p.types || [],
        googleRating: p.rating || p.googleRating || 0, googleReviewCount: p.user_ratings_total || p.googleReviewCount || 0,
        distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
        booking_platform: bp, booking_url: bu,
        websiteUri: p.websiteUri || null,
        cuisine: CUISINE_LOOKUP[p.name] || p.cuisine || null,
        velocity: getReviewVelocity(p.place_id),
        likelihood: getReservationLikelihood(p.place_id),
        _source: p._source || 'legacy'
      };
    });

    const maxDistMiles = 7.0;
    const within = withDist.filter(r => r.distanceMiles <= maxDistMiles);
    console.log(`\ud83d\udcca Within 7mi: ${within.length}`);

    const michelin = await resolveMichelinPlaces(KEY);
    attachMichelinBadges(within, michelin);

    // Attach Bib Gourmand booking data
    const bibAll = getBibGourmandPlaces();
    const bibByName = new Map();
    for (const b of bibAll) { if (b?.name) bibByName.set(normalizeName(b.name), b); }
    for (const c of within) {
      const b = normalizeName(c?.name) && bibByName.get(normalizeName(c.name));
      if (b && !c.michelin) {
        c.michelin = { stars: 0, distinction: 'bib_gourmand' };
        c.booking_platform = b.booking_platform || null;
        c.booking_url = b.booking_url || null;
      }
    }

    // INJECT Michelin restaurants not in Google results
    const existingIds = new Set(within.map(r => r.place_id).filter(Boolean));
    const existingNames = new Set(within.map(r => normalizeName(r.name)).filter(Boolean));
    let injected = 0;
    for (const m of michelin) {
      if (!m?.lat || !m?.lng) continue;
      if (m.place_id && existingIds.has(m.place_id)) continue;
      if (m.name && existingNames.has(normalizeName(m.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(m.name, cuisineStr, m.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, m.lat, m.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: m.place_id, name: m.name,
        vicinity: m.address || '', formatted_address: m.address || '',
        price_level: m.price_level || null, opening_hours: null,
        geometry: { location: { lat: m.lat, lng: m.lng } },
        types: [], googleRating: m.googleRating || 0, googleReviewCount: m.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: { stars: m.stars || 0, distinction: m.distinction || 'star' },
        cuisine: CUISINE_LOOKUP[m.name] || m.cuisine || null,
        booking_platform: m.booking_platform || null,
        booking_url: m.booking_url || null,
        _source: 'michelin_inject'
      });
      if (m.place_id) existingIds.add(m.place_id);
      existingNames.add(normalizeName(m.name));
      injected++;
    }
    if (injected) console.log(`\u2705 Injected ${injected} Michelin restaurants not in Google results`);

    // INJECT Bib Gourmand restaurants not in Google results
    const bibPlaces = getBibGourmandPlaces();
    let bibInjected = 0;
    for (const b of bibPlaces) {
      if (!b?.lat || !b?.lng) continue;
      if (b.name && existingNames.has(normalizeName(b.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(b.name, cuisineStr, b.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, b.lat, b.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: null, name: b.name,
        vicinity: b.address || '', formatted_address: b.address || '',
        price_level: b.price_level || null, opening_hours: null,
        geometry: { location: { lat: b.lat, lng: b.lng } },
        types: [], googleRating: 0, googleReviewCount: 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: { stars: 0, distinction: 'bib_gourmand' }, cuisine: CUISINE_LOOKUP[b.name] || b.cuisine || null,
        booking_platform: b.booking_platform || null,
        booking_url: b.booking_url || null,
        _source: 'bib_inject'
      });
      existingNames.add(normalizeName(b.name));
      bibInjected++;
    }
    if (bibInjected) console.log(`\u2705 Injected ${bibInjected} Bib Gourmand restaurants not in Google results`);

    // INJECT Popular 4.4+ restaurants not in Google results
    const popularPlaces = getPopularPlaces();
    let popularInjected = 0;
    for (const p of popularPlaces) {
      if (!p?.lat || !p?.lng) continue;
      if (p.place_id && existingIds.has(p.place_id)) continue;
      if (p.name && existingNames.has(normalizeName(p.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(p.name, cuisineStr, p.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, p.lat, p.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: p.place_id || null, name: p.name,
        vicinity: p.address || '', formatted_address: p.address || '',
        price_level: p.price_level || null, opening_hours: null,
        geometry: { location: { lat: p.lat, lng: p.lng } },
        types: [], googleRating: p.googleRating || 0, googleReviewCount: p.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: null, cuisine: CUISINE_LOOKUP[p.name] || p.cuisine || null,
        booking_platform: p.booking_platform || null,
        booking_url: p.booking_url || null,
        _source: 'popular_inject'
      });
      if (p.place_id) existingIds.add(p.place_id);
      existingNames.add(normalizeName(p.name));
      popularInjected++;
    }
    if (popularInjected) console.log(`\u2705 Injected ${popularInjected} popular 4.4+ restaurants not in other results`);

    // TAG + INJECT Chase Sapphire restaurants
    const chaseNameSet = new Set();
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (c?.name) chaseNameSet.add(normalizeName(c.name));
    }
    for (const r of within) {
      if (r?.name && chaseNameSet.has(normalizeName(r.name))) {
        r.chase_sapphire = true;
      }
    }
    let chaseInjected = 0;
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (!c?.lat || !c?.lng) continue;
      if (c.name && existingNames.has(normalizeName(c.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(c.name, cuisineStr, c.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, c.lat, c.lng);
      if (d > 15.0) continue;
      within.push({
        place_id: null, name: c.name,
        vicinity: c.address || '', formatted_address: c.address || '',
        price_level: c.price_level || null, opening_hours: null,
        geometry: { location: { lat: c.lat, lng: c.lng } },
        types: [], googleRating: c.googleRating || 0, googleReviewCount: c.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: null, cuisine: CUISINE_LOOKUP[c.name] || c.cuisine || null,
        booking_platform: c.booking_platform || null,
        booking_url: c.booking_url || null,
        chase_sapphire: true,
        _source: 'chase_inject'
      });
      existingNames.add(normalizeName(c.name));
      chaseInjected++;
    }
    if (chaseInjected) console.log(`\u2705 Injected ${chaseInjected} Chase Sapphire restaurants not in other results`);

    // Final dedup pass — catch any duplicates from multiple inject paths
    const deduped = [];
    const dedupSeen = new Set();
    for (const r of within) {
      const key = r.place_id || normalizeName(r.name);
      if (!key || dedupSeen.has(key)) continue;
      dedupSeen.add(key);
      // Also dedupe by normalized name if place_id was the key
      if (r.place_id && r.name) {
        const nk = normalizeName(r.name);
        if (nk && dedupSeen.has(nk)) continue;
        dedupSeen.add(nk);
      }
      deduped.push(r);
    }
    if (deduped.length < within.length) console.log(`\ud83e\uddf9 Deduped: removed ${within.length - deduped.length} duplicate restaurants`);
    within.length = 0;
    within.push(...deduped);

    const fStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within, qualityMode);
    timings.filtering_ms = Date.now() - fStart;

    // DETECT BOOKING PLATFORMS for visible restaurants
    const detectStart = Date.now();
    const visibleRestaurants = [...elite, ...moreOptions];
    await detectBookingPlatforms(visibleRestaurants, KEY);
    timings.booking_detect_ms = Date.now() - detectStart;

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
