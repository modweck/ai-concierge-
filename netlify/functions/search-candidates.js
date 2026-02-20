// Deterministic grid coverage with full pagination
// SIMPLIFIED filtering: Only by rating (no chains, no types, no keywords)
// Michelin overlay:
//   - In normal mode: badge overlay only (does not change pool)
//   - In Michelin mode: returns Michelin-only within 15 miles (ignores rating thresholds)

const fs = require('fs');
const path = require('path');

// Load Michelin base list once at startup (names + stars only)
let MICHELIN_BASE = [];
try {
  const michelinPath = path.join(__dirname, 'michelin_nyc.json');
  MICHELIN_BASE = JSON.parse(fs.readFileSync(michelinPath, 'utf8'));
  console.log(`✅ Loaded Michelin base list: ${MICHELIN_BASE.length} entries`);
} catch (err) {
  console.warn('❌ Michelin base list missing/invalid:', err.message);
}

// Resolved Michelin cache (place_id + lat/lng + address) - in-memory
let MICHELIN_RESOLVED = null;
let MICHELIN_RESOLVED_AT = 0;
const MICHELIN_RESOLVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Basic concurrency limiter (so we don’t blast Google)
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

// Resolve Michelin list -> real Google Places (place_id + geometry + address)
// Uses Places Text Search (works well for restaurant names)
async function resolveMichelinPlaces(GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];

  // Serve cache
  if (MICHELIN_RESOLVED && (Date.now() - MICHELIN_RESOLVED_AT) < MICHELIN_RESOLVE_TTL_MS) {
    console.log(`💾 Michelin resolved cache HIT (${MICHELIN_RESOLVED.length})`);
    return MICHELIN_RESOLVED;
  }

  if (!Array.isArray(MICHELIN_BASE) || MICHELIN_BASE.length === 0) {
    console.log('Michelin base list empty - nothing to resolve.');
    MICHELIN_RESOLVED = [];
    MICHELIN_RESOLVED_AT = Date.now();
    return MICHELIN_RESOLVED;
  }

  console.log(`🔎 Resolving Michelin entries to Google Places... (${MICHELIN_BASE.length})`);

  const resolved = await runWithConcurrency(MICHELIN_BASE, 5, async (m) => {
    const name = m?.name;
    if (!name) return null;

    // Force NYC context for better precision
    const query = encodeURIComponent(`${name} New York NY`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${GOOGLE_API_KEY}`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.status !== 'OK' || !data.results?.length) {
        return {
          ...m,
          place_id: null,
          address: null,
          lat: null,
          lng: null,
          googleRating: null,
          googleReviewCount: null,
          _resolveStatus: data.status
        };
      }

      // Pick best match: exact normalized name if possible, otherwise first result
      const target = normalizeName(name);
      let best = data.results[0];

      for (const r of data.results) {
        const rn = normalizeName(r.name);
        if (rn === target) { best = r; break; }
        // also allow prefix match
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
      return {
        ...m,
        place_id: null,
        address: null,
        lat: null,
        lng: null,
        googleRating: null,
        googleReviewCount: null,
        _resolveStatus: `ERR:${e.message}`
      };
    }
  });

  MICHELIN_RESOLVED = resolved.filter(Boolean);
  MICHELIN_RESOLVED_AT = Date.now();

  const okCount = MICHELIN_RESOLVED.filter(x => x.place_id && x.lat && x.lng).length;
  console.log(`✅ Michelin resolved: ${okCount}/${MICHELIN_RESOLVED.length} with place_id+coords`);

  return MICHELIN_RESOLVED;
}

// Badge overlay for normal mode: match candidates to Michelin by place_id first, then name
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
    // place_id exact match
    if (c?.place_id && byPlaceId.has(c.place_id)) {
      const m = byPlaceId.get(c.place_id);
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      matched++;
      continue;
    }

    // name match fallback
    const cn = normalizeName(c?.name);
    if (cn && byNormName.has(cn)) {
      const m = byNormName.get(cn);
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      matched++;
    }
  }

  console.log(`✅ Michelin badges attached (normal mode): ${matched}`);
}

// In-memory cache with 10-minute TTL
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, qualityMode, cuisine, openNow) {
  return `${location}_${qualityMode}_${cuisine || 'any'}_${openNow ? 'open' : 'any'}`;
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

// SIMPLIFIED FILTERING - Only filter by rating
function filterRestaurantsByTier(candidates) {
  const elite = [];
  const moreOptions = [];
  const excluded = [];

  candidates.forEach(place => {
    try {
      const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;
      const rating = place.googleRating ?? place.rating ?? 0;

      // Fake 5.0 prevention
      if (rating >= 4.9 && reviews < 50) {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: '',
          reason: `fake_5.0_prevention (${rating}⭐ with only ${reviews} reviews)`
        });
        return;
      }

      if (rating >= 4.6) elite.push(place);
      else if (rating >= 4.4) moreOptions.push(place);
      else {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: '',
          reason: 'rating_below_4.4'
        });
      }
    } catch (err) {
      excluded.push({
        place_id: place.place_id,
        name: place.name,
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
    const { location, cuisine, openNow, quality } = body;
    const qualityMode = (quality || 'any').toLowerCase();
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return stableResponse([], [], {}, 'API key not configured');
    }

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v1';
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

    // 1) Geocode origin
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return stableResponse(
        [],
        [],
        {
          confirmedAddress: null,
          userLocation: null,
          performance: { places_fetch_ms: 0, filtering_ms: 0, total_ms: Date.now() - t0, cache_hit: false },
          geocode: { status: geocodeData.status, error_message: geocodeData.error_message || null, input: location }
        },
        `Geocode failed: ${geocodeData.status}${geocodeData.error_message ? ' - ' + geocodeData.error_message : ''}`
      );
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Normalize to 4 decimals for determinism
    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;

    // ✅ MICHELIN MODE: 15 miles, ignore rating thresholds, return Michelin only sorted by distance
    if (qualityMode === 'michelin') {
      const resolved = await resolveMichelinPlaces(GOOGLE_API_KEY);

      // Compute distances and filter within 15 miles
      const maxMiles = 15.0;

      const within = resolved
        .filter(r => r?.lat != null && r?.lng != null)
        .map(r => {
          const distMiles = haversineMiles(gridLat, gridLng, r.lat, r.lng);
          return {
            place_id: r.place_id || null,
            name: r.name,
            vicinity: r.address || '',
            formatted_address: r.address || '',
            price_level: null,
            opening_hours: null,
            geometry: { location: { lat: r.lat, lng: r.lng } },
            googleRating: r.googleRating ?? null,
            googleReviewCount: r.googleReviewCount ?? null,
            distanceMiles: Math.round(distMiles * 10) / 10,
            walkMinEstimate: Math.round(distMiles * 20), // crude but consistent
            driveMinEstimate: Math.round(distMiles * 4),
            transitMinEstimate: null,
            michelin: { stars: r.stars || 0, distinction: r.distinction || 'star' }
          };
        })
        .filter(r => r.distanceMiles <= maxMiles)
        .sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

      timings.total_ms = Date.now() - t0;

      const stats = {
        confirmedAddress,
        userLocation: { lat: gridLat, lng: gridLng },
        michelinMode: true,
        maxMiles,
        count: within.length,
        performance: { ...timings, cache_hit: false }
      };

      // Put all Michelin in "elite" so front end just renders
      setCache(cacheKey, { elite: within, moreOptions: [], stats });

      return stableResponse(within, [], stats, null);
    }

    // 2) NORMAL MODE: your existing grid search
    const gridRadius = 1500;
    const spacingMiles = 1.5;
    const spacingDegrees = spacingMiles / 69;

    const gridPoints = [
      { lat: gridLat, lng: gridLng, label: 'Center' },
      { lat: gridLat, lng: gridLng + spacingDegrees, label: 'E1' },
      { lat: gridLat, lng: gridLng + spacingDegrees * 2, label: 'E2' },
      { lat: gridLat, lng: gridLng - spacingDegrees, label: 'W1' },
      { lat: gridLat, lng: gridLng - spacingDegrees * 2, label: 'W2' },

      { lat: gridLat + spacingDegrees, lng: gridLng, label: 'N1' },
      { lat: gridLat + spacingDegrees, lng: gridLng + spacingDegrees, label: 'NE1' },
      { lat: gridLat + spacingDegrees, lng: gridLng - spacingDegrees, label: 'NW1' },

      { lat: gridLat + spacingDegrees * 2, lng: gridLng, label: 'N2' },
      { lat: gridLat + spacingDegrees * 2, lng: gridLng + spacingDegrees, label: 'NE2' },
      { lat: gridLat + spacingDegrees * 2, lng: gridLng - spacingDegrees, label: 'NW2' },

      { lat: gridLat - spacingDegrees, lng: gridLng, label: 'S1' },
      { lat: gridLat - spacingDegrees, lng: gridLng + spacingDegrees, label: 'SE1' },
      { lat: gridLat - spacingDegrees, lng: gridLng - spacingDegrees, label: 'SW1' },

      { lat: gridLat - spacingDegrees * 2, lng: gridLng, label: 'S2' },
      { lat: gridLat - spacingDegrees * 2, lng: gridLng + spacingDegrees, label: 'SE2' },
      { lat: gridLat - spacingDegrees * 2, lng: gridLng - spacingDegrees, label: 'SW2' }
    ];

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

    const candidatesWithDistance = allCandidates.map(place => {
      const distMiles = haversineMiles(
        gridLat,
        gridLng,
        place.geometry.location.lat,
        place.geometry.location.lng
      );

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

    // Normal mode distance cap (keep your behavior)
    const maxMiles = 5.0;
    const withinMiles = candidatesWithDistance.filter(r => r.distanceMiles <= maxMiles);

    // Attach Michelin badges so Michelin appears “normally” in 4.6/4.4 results
    const michelinResolved = await resolveMichelinPlaces(GOOGLE_API_KEY);
    attachMichelinBadgesToCandidates(withinMiles, michelinResolved);

    const filterStart = Date.now();
    const { elite, moreOptions, excluded: tierExcluded } = filterRestaurantsByTier(withinMiles);
    timings.filtering_ms = Date.now() - filterStart;
    timings.total_ms = Date.now() - t0;

    // Sort by walk estimate deterministically
    const sortByWalkTime = (a, b) => {
      if (a.walkMinEstimate !== b.walkMinEstimate) return a.walkMinEstimate - b.walkMinEstimate;
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return a.name.localeCompare(b.name);
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
      normalizedCoords: { lat: gridLat, lng: gridLng },
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
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
