const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

// ── BARS MASTER (BARS_MERGED_V14 — array format) ──
let BARS_ARRAY = [];
try {
  BARS_ARRAY = JSON.parse(fs.readFileSync(path.join(__dirname, 'BARS_MERGED_V15.json'), 'utf8'));
  console.log(`✅ Bars master: ${BARS_ARRAY.length} bars`);
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

function getCacheKey(loc, vibes, tier, lateNight, broadCity) {
  return `bars_${loc}_${(vibes||[]).sort().join('+')||'any'}_${tier||'any'}_${lateNight?'late':''}_${broadCity?'all':'local'}`;
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

// ── VIBE FILTERING ──
// vibes is an array of selected vibe filters (OR logic — match any)
function matchesVibeFilter(bar, vibes) {
  if (!vibes || vibes.length === 0) return true;
  const barVibes = new Set(bar.bar_vibes || []);
  return vibes.some(v => barVibes.has(v));
}

// ── TIER FILTERING ──
function matchesTierFilter(bar, tier) {
  if (!tier || tier === 'any') return true;
  return bar.bar_tier === tier;
}

// ── QUALITY FILTER ──
function matchesQualityFilter(bar, qualityMode) {
  const rating = bar.google_rating || 0;
  if (qualityMode === 'great') return rating >= 4.3;
  if (qualityMode === 'top') return rating >= 4.5;
  return rating >= 3.5; // 'any' = show anything decent
}

// ── LATE NIGHT FILTER ──
function getMaxCloseHour(hours) {
  if (!hours || !Array.isArray(hours)) return 0;
  let maxHour = 0;
  for (const h of hours) {
    const match = h.match(/–\s*(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) continue;
    let hr = parseInt(match[1]);
    const ampm = match[3].toUpperCase();
    if (ampm === 'AM') {
      hr = hr === 12 ? 24 : 24 + hr;
    } else {
      hr = hr === 12 ? 12 : 12 + hr;
    }
    if (hr > maxHour) maxHour = hr;
  }
  return maxHour;
}

function calcLateNightFlags(bar) {
  const maxHour = getMaxCloseHour(bar.hours);
  return {
    late_night: maxHour === 28,
    very_late:  maxHour >= 29
  };
}

function matchesLateNight(bar, lateNight) {
  if (!lateNight) return true;
  const flags = calcLateNightFlags(bar);
  return flags.late_night || flags.very_late;
}

// ── SCORE ──
function computeBarScore(bar) {
  let score = bar.google_rating || 0;
  if (score === 0) return 0;
  // Boost must_book bars slightly
  if (bar.bar_tier === 'must_book') score = Math.min(5.0, score + 0.1);
  return Math.min(5.0, Math.round(score * 10) / 10);
}

// ── TIER BUCKETS ──
function splitByTier(bars) {
  const elite = [], moreOptions = [];
  for (const bar of bars) {
    if (bar.bar_tier === 'must_book' || bar.bar_tier === 'notable') elite.push(bar);
    else moreOptions.push(bar);
  }
  return { elite, moreOptions };
}

// ── MAIN HANDLER ──

exports.handler = async (event) => {
  const stableResponse = (elite = [], more = [], stats = {}, error = null) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elite, moreOptions: more, confirmedAddress: stats.confirmedAddress || null, userLocation: stats.userLocation || null, stats, error })
  });

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const t0 = Date.now();
    const body = JSON.parse(event.body || '{}');

    const { location, vibes, vibe, tier, quality, price, lateNight, buzz, broadCity, maxDist: clientMaxDist } = body;

    // Support both single vibe (old) and array (new)
    const vibeList = vibes ? (Array.isArray(vibes) ? vibes : [vibes]) : (vibe && vibe !== 'any' ? [vibe] : []);
    const qualityMode = (quality || 'any').toLowerCase().trim();
    const KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!KEY) return stableResponse([], [], {}, 'API key not configured');

    // Cache check
    const cacheKey = getCacheKey(location, vibeList, tier, lateNight, broadCity);
    const cached = getFromCache(cacheKey);
    if (cached) return stableResponse(cached.elite, cached.moreOptions, { ...cached.stats, cached: true });

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

    // ── SEARCH ──
    const maxDist = broadCity ? 999 : (clientMaxDist || 1.0);
    const results = [];

    for (const bar of BARS_ARRAY) {
      if (!bar.lat || !bar.lng) continue;

      // Distance filter
      const d = haversineMiles(gLat, gLng, bar.lat, bar.lng);
      if (d > maxDist) continue;

      // Vibe filter (OR logic)
      if (!matchesVibeFilter(bar, vibeList)) continue;

      // Tier filter
      if (!matchesTierFilter(bar, tier)) continue;

      // Quality filter
      if (!matchesQualityFilter(bar, qualityMode)) continue;

      // Late night filter
      if (!matchesLateNight(bar, lateNight)) continue;

      // Price filter
      if (price && price !== 'any') {
        if (bar.price == null || Number(bar.price) !== Number(price)) continue;
      }

      // Buzz filter
      if (buzz && (!bar.buzz_sources || bar.buzz_sources.length === 0)) continue;

      results.push({
        name: bar.name,
        place_id: bar.place_id || null,
        vicinity: bar.address || bar.neighborhood || '',
        formatted_address: bar.address || '',
        price_level: bar.price || null,
        geometry: { location: { lat: bar.lat, lng: bar.lng } },
        googleRating: bar.google_rating || 0,
        barScore: bar.barScore || bar.google_rating || 0,
        buzz_sources: bar.buzz_sources || [],
        buzz_url: bar.buzz_url || null,
        googleReviewCount: bar.google_reviews || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20),
        driveMinEstimate: Math.round(d * 4),
        transitMinEstimate: Math.round(d * 6),
        // New V14 fields
        bar_vibes: bar.bar_vibes || [],
        bar_tier: bar.bar_tier || 'neighborhood',
        crowd_estimate: bar.crowd_estimate || null,
        late_night: calcLateNightFlags(bar).late_night,
        very_late: calcLateNightFlags(bar).very_late,
        // Booking
        resy_url: bar.resy_url || null,
        opentable_url: bar.opentable_url || null,
        booking_platform: bar.resy_url ? 'resy' : bar.opentable_url ? 'opentable' : null,
        booking_url: bar.resy_url || bar.opentable_url || null,
        // Other
        website: bar.website || null,
        google_url: bar.google_url || null,
        hours: bar.hours || null,
        neighborhood: bar.neighborhood || null,
        yelp_url: bar.yelp_url || null,
        yelp_rating: bar.yelp_rating || null,
        _source: 'bars_master'
      });
    }

    console.log(`🍸 Found ${results.length} bars within ${maxDist}mi`);

    // Compute scores
    results.forEach(r => { r.barScore = computeBarScore({ google_rating: r.googleRating, bar_tier: r.bar_tier }); });

    // Dedup by normalized name
    const deduped = [];
    const seenNames = new Set();
    for (const r of results) {
      const nk = normalizeName(r.name);
      if (nk && seenNames.has(nk)) continue;
      if (nk) seenNames.add(nk);
      deduped.push(r);
    }

    // Split into elite (must_book + notable) and moreOptions (neighborhood)
    const { elite, moreOptions } = splitByTier(deduped);

    // Sort each bucket: score desc, then distance
    const sortFn = (a, b) => {
      if ((b.barScore || 0) !== (a.barScore || 0)) return (b.barScore || 0) - (a.barScore || 0);
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
      return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
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
      vibeFilter: vibeList,
      qualityMode,
      lateNight: !!lateNight,
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
