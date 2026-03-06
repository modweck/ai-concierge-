const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

// ── BARS MASTER (primary search source) ──
let BARS_MASTER = {};
let BARS_KEYS = [];
try {
  BARS_MASTER = JSON.parse(fs.readFileSync(path.join(__dirname, 'BARS_LOUNGES.json'), 'utf8'));
  BARS_KEYS = Object.keys(BARS_MASTER);
  console.log(`✅ Bars master: ${BARS_KEYS.length} bars`);
} catch (err) { console.warn('⚠️ Bars master missing:', err.message); }

// ── HELPERS ──

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── CACHE ──
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(loc, vibe, broadCity) {
  return `bars_${loc}_${String(vibe || 'any').toLowerCase().trim()}_${broadCity ? 'all' : 'local'}`;
}

function getFromCache(key) {
  const c = resultCache.get(key);
  if (!c) return null;
  if (Date.now() - c.timestamp > CACHE_TTL_MS) { resultCache.delete(key); return null; }
  return c.data;
}

function setCache(key, data) {
  resultCache.set(key, { data, timestamp: Date.now() });
  if (resultCache.size > 50) {
    const oldest = Array.from(resultCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    resultCache.delete(oldest[0]);
  }
}

// ── BAR TYPE / VIBE FILTERING ──
// Maps user-facing vibe filter values to tags we expect in the data
const VIBE_FILTER_MAP = {
  'cocktail':   ['cocktail bar', 'speakeasy', 'cocktail'],
  'wine':       ['wine bar', 'wine'],
  'rooftop':    ['rooftop', 'rooftop bar'],
  'speakeasy':  ['speakeasy', 'hidden bar'],
  'dive':       ['dive bar', 'dive'],
  'sports':     ['sports bar', 'sports'],
  'beer':       ['beer garden', 'beer hall', 'brewery', 'beer'],
  'lounge':     ['lounge', 'club lounge'],
  'live_music': ['live music', 'jazz', 'jazz bar'],
  'hotel':      ['hotel bar', 'hotel'],
};

function matchesVibeFilter(bar, vibeFilter) {
  if (!vibeFilter || vibeFilter === 'any') return true;

  const allowed = VIBE_FILTER_MAP[vibeFilter.toLowerCase()] || [];
  if (allowed.length === 0) return true; // unknown filter = show all

  // Check bar_type field
  const barType = (bar.bar_type || '').toLowerCase();
  if (allowed.some(v => barType.includes(v))) return true;

  // Check vibe_tags array
  const vibeTags = (bar.vibe_tags || []).map(t => t.toLowerCase());
  if (vibeTags.some(tag => allowed.some(v => tag.includes(v)))) return true;

  // Check name as last resort
  const name = (bar.name || '').toLowerCase();
  if (allowed.some(v => name.includes(v))) return true;

  return false;
}

// ── SCORE ──
// Simple quality score for bars: Google rating is the main signal
function computeBarScore(bar) {
  let score = bar.google_rating || bar.googleRating || 0;
  if (score === 0) return 0;
  return Math.min(5.0, Math.round(score * 10) / 10);
}

// ── QUALITY TIERS ──
function filterBarsByTier(bars, qualityMode) {
  const elite = [], moreOptions = [], excluded = [];

  let eliteMin = 4.2, moreMin = 999;
  if (qualityMode === 'top')   { eliteMin = 4.5; moreMin = 4.2; }
  else if (qualityMode === 'great') { eliteMin = 4.3; moreMin = 4.0; }
  // default 'any' = 4.0+ elite, no moreOptions tier
  else { eliteMin = 4.0; moreMin = 999; }

  for (const bar of bars) {
    const score = bar.barScore || bar.google_rating || bar.googleRating || 0;
    if (score >= eliteMin) elite.push(bar);
    else if (score >= moreMin) moreOptions.push(bar);
    else excluded.push(bar);
  }

  console.log(`FILTER bars ${qualityMode}: Elite(>=${eliteMin}):${elite.length} | More:${moreOptions.length} | Excl:${excluded.length}`);
  return { elite, moreOptions, excluded };
}

// ── MAIN HANDLER ──

exports.handler = async (event) => {
  const stableResponse = (elite = [], more = [], stats = {}, error = null) => {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elite,
        moreOptions: more,
        confirmedAddress: stats.confirmedAddress || null,
        userLocation: stats.userLocation || null,
        stats,
        error
      })
    };
  };

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const t0 = Date.now();
    const body = JSON.parse(event.body || '{}');
    const { location, vibe, quality, broadCity } = body;
    const qualityMode = (quality || 'any').toLowerCase().trim();
    const KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!KEY) return stableResponse([], [], {}, 'API key not configured');

    // Cache check
    const cacheKey = getCacheKey(location, vibe, broadCity);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return stableResponse(cached.elite, cached.moreOptions, { ...cached.stats, cached: true });
    }

    // ── GEOCODE ──
    let lat, lng, confirmedAddress = null;
    const locStr = String(location || '').trim();
    const cm = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (cm) {
      lat = +cm[1]; lng = +cm[2];
      confirmedAddress = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    } else {
      const gd = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${KEY}`).then(r => r.json());
      if (gd.status !== 'OK') return stableResponse([], [], {}, `Geocode failed: ${gd.status}`);
      lat = gd.results[0].geometry.location.lat;
      lng = gd.results[0].geometry.location.lng;
      confirmedAddress = gd.results[0].formatted_address;
    }
    const gLat = Math.round(lat * 10000) / 10000;
    const gLng = Math.round(lng * 10000) / 10000;

    // ── SEARCH BARS_MASTER ──
    const maxDist = broadCity ? 999 : 5.0; // 5 miles local, unlimited for "all NYC"
    const vibeFilter = (vibe && String(vibe).toLowerCase().trim() !== 'any') ? vibe : null;
    const results = [];

    for (const [key, entry] of Object.entries(BARS_MASTER)) {
      if (!entry.lat || !entry.lng) continue;

      // Vibe filter
      if (vibeFilter && !matchesVibeFilter(entry, vibeFilter)) continue;

      const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
      if (d > maxDist) continue;

      results.push({
        name: key,
        place_id: entry.place_id || null,
        vicinity: entry.address || entry.neighborhood || '',
        formatted_address: entry.address || '',
        price_level: entry.price || null,
        geometry: { location: { lat: entry.lat, lng: entry.lng } },
        googleRating: entry.google_rating || entry.googleRating || 0,
        googleReviewCount: entry.google_reviews || entry.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20),
        driveMinEstimate: Math.round(d * 4),
        transitMinEstimate: Math.round(d * 6),
        bar_type: entry.bar_type || null,
        vibe_tags: entry.vibe_tags || [],
        booking_platform: entry.platform || entry.booking_platform || null,
        booking_url: entry.url || entry.booking_url || null,
        website: entry.website || null,
        instagram: entry.instagram || null,
        neighborhood: entry.neighborhood || null,
        _source: 'bars_master'
      });
    }

    console.log(`🍸 Bars master: ${results.length} bars within ${maxDist}mi` + (vibeFilter ? ` (vibe: ${vibeFilter})` : ''));

    // Compute scores
    results.forEach(r => { r.barScore = computeBarScore(r); });

    // Dedup by normalized name
    const deduped = [];
    const seenNames = new Set();
    for (const r of results) {
      const nk = normalizeName(r.name);
      if (nk && seenNames.has(nk)) continue;
      if (nk) seenNames.add(nk);
      deduped.push(r);
    }
    if (deduped.length < results.length) {
      console.log(`🧹 Deduped: removed ${results.length - deduped.length} duplicate bars`);
    }

    // Quality tier filter
    const { elite, moreOptions, excluded } = filterBarsByTier(deduped, qualityMode);

    // Sort: distance first, then score, then review count
    const sortFn = (a, b) => {
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
      if ((b.barScore || 0) !== (a.barScore || 0)) return (b.barScore || 0) - (a.barScore || 0);
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };
    elite.sort(sortFn);
    moreOptions.sort(sortFn);

    const totalMs = Date.now() - t0;
    const stats = {
      confirmedAddress,
      userLocation: { lat: gLat, lng: gLng },
      count: elite.length + moreOptions.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excluded: excluded.length,
      vibeFilter: vibeFilter || 'any',
      qualityMode,
      performance: { total_ms: totalMs, cache_hit: false }
    };

    setCache(cacheKey, { elite, moreOptions, stats });
    return stableResponse(elite, moreOptions, stats);

  } catch (error) {
    console.error('ERROR:', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elite: [], moreOptions: [], stats: {}, error: error.message })
    };
  }
};
