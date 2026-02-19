// Deterministic grid coverage with full pagination
// SIMPLIFIED filtering: Only by rating
// Michelin overlay (badge only - does not change candidate pool)

const fs = require('fs');
const path = require('path');

// -------------------- MICHELIN LOADER (robust paths) --------------------
let MICHELIN_DATA = [];
let MICHELIN_SOURCE = null;

function tryLoadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

(function loadMichelinOnce() {
  console.log('[Michelin] __dirname:', __dirname);

  // Try multiple likely locations (Netlify bundling can be weird)
  const candidates = [
    path.join(__dirname, 'michelin_nyc.json'),            // ✅ recommended
    path.join(__dirname, '..', 'data', 'michelin_nyc.json'),
    path.join(process.cwd(), 'netlify', 'functions', 'michelin_nyc.json'),
    path.join(process.cwd(), 'data', 'michelin_nyc.json')
  ];

  for (const p of candidates) {
    const loaded = tryLoadJson(p);
    if (loaded && loaded.length) {
      MICHELIN_DATA = loaded;
      MICHELIN_SOURCE = p;
      break;
    }
  }

  if (MICHELIN_DATA.length) {
    console.log(`[Michelin] ✅ Loaded entries: ${MICHELIN_DATA.length}`);
    console.log(`[Michelin] ✅ Loaded from: ${MICHELIN_SOURCE}`);
  } else {
    console.log('[Michelin] ❌ Entries loaded: 0');
    console.log('[Michelin] Tried paths:', candidates);
  }
})();

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Badge overlay only
function attachMichelinData(candidates) {
  if (!MICHELIN_DATA.length) return 0;

  let matchedCount = 0;

  for (const place of candidates) {
    const placeName = normalizeName(place.name);

    for (const michelin of MICHELIN_DATA) {
      const michelinName = normalizeName(michelin.name);

      // 1) Exact name
      if (placeName && placeName === michelinName) {
        place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
        matchedCount++;
        break;
      }

      // 2) Loose contains (very conservative)
      if (placeName && michelinName) {
        if ((placeName.includes(michelinName) || michelinName.includes(placeName)) &&
            Math.abs(placeName.length - michelinName.length) <= 5) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          matchedCount++;
          break;
        }
      }

      // 3) Coords proximity (within 80m)
      if (michelin.lat && michelin.lng && place.geometry?.location) {
        const R = 6371000;
        const dLat = (place.geometry.location.lat - michelin.lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - michelin.lng) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(michelin.lat * Math.PI / 180) *
            Math.cos(place.geometry.location.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance <= 80) {
          place.michelin = { distinction: michelin.distinction, stars: michelin.stars };
          matchedCount++;
          break;
        }
      }
    }
  }

  return matchedCount;
}

// -------------------- CACHE --------------------
const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(location, qualityMode, walkMinutes) {
  return `${location}_${qualityMode}_${walkMinutes}`;
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

// -------------------- FILTERING (simple) --------------------
function filterRestaurantsByTier(candidates) {
  const elite = [];
  const moreOptions = [];
  const excluded = [];

  for (const place of candidates) {
    const reviews = place.user_ratings_total ?? place.googleReviewCount ?? 0;
    const rating = place.googleRating ?? place.rating ?? 0;

    // prevent fake 5.0
    if (rating >= 4.9 && reviews < 50) {
      excluded.push({ name: place.name, rating, reviews, reason: 'fake_5.0_prevention' });
      continue;
    }

    if (rating >= 4.6) elite.push(place);
    else if (rating >= 4.4) moreOptions.push(place);
    else excluded.push({ name: place.name, rating, reviews, reason: 'rating_below_4.4' });
  }

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
      return stableResponse([], [], {}, 'API key not configured');
    }

    // IMPORTANT: bump this when you change logic (forces fresh results)
    const cacheKey = getCacheKey(location, 'all', 20) + '_v16';
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

    console.log('=== DETERMINISTIC GRID SEARCH (anti-60-cap) ===');

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK' || !geocodeData.results?.[0]) {
      return stableResponse([], [], {}, `Geocode failed: ${geocodeData.status}`);
    }

    let { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    const gridLat = Math.round(lat * 10000) / 10000;
    const gridLng = Math.round(lng * 10000) / 10000;
    console.log('Normalized origin:', { gridLat, gridLng });

    // ✅ KEY FIX: smaller radius + denser grid (beats 60-result cap)
    const gridRadius = 750;      // meters
    const spacingMiles = 0.37;   // miles
    const spacingDegrees = spacingMiles / 69;

    // 5x5 grid (25 nodes)
    const steps = [-2, -1, 0, 1, 2];
    const gridPoints = [];
    for (const i of steps) {
      for (const j of steps) {
        gridPoints.push({
          lat: gridLat + i * spacingDegrees,
          lng: gridLng + j * spacingDegrees,
          label: `P_${i}_${j}`
        });
      }
    }
    console.log(`Grid: ${gridPoints.length} nodes, ${gridRadius}m radius per node, ${spacingMiles} mile spacing`);

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

      while (nextPageToken && pageCount < 3) {
        await new Promise((r) => setTimeout(r, 2000));

        let pageData = null;
        for (let retries = 0; retries < 5; retries++) {
          const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
          const pageResponse = await fetch(pageUrl);
          pageData = await pageResponse.json();

          if (pageData.status === 'INVALID_REQUEST') {
            await new Promise((r) => setTimeout(r, 2000));
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

    // Fetch grid
    const placesStart = Date.now();
    const gridResults = await Promise.all(
      gridPoints.map((p) => fetchWithFullPagination(p.lat, p.lng, p.label))
    );
    timings.places_fetch_ms = Date.now() - placesStart;
    console.log(`⏱️ Places API fetch: ${timings.places_fetch_ms}ms`);

    // Dedupe
    const seen = new Set();
    const allCandidates = [];
    let totalRaw = 0;

    for (const results of gridResults) {
      totalRaw += results.length;
      for (const place of results) {
        if (!seen.has(place.place_id)) {
          seen.add(place.place_id);
          allCandidates.push(place);
        }
      }
    }

    console.log('Total raw results:', totalRaw);
    console.log('Unique places (after dedupe):', allCandidates.length);

    // Build candidate objects with distance
    const candidatesWithDistance = allCandidates.map((place) => {
      const R = 3959;
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(gridLat * Math.PI / 180) *
          Math.cos(place.geometry.location.lat * Math.PI / 180) *
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
        walkMinEstimate: Math.round(distMiles * 20)
      };
    });

    // Keep up to 5 miles
    const within5Miles = candidatesWithDistance.filter((r) => r.distanceMiles <= 5.0);

    const filterStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within5Miles);
    timings.filtering_ms = Date.now() - filterStart;

    // Michelin overlay
    console.log('=== MICHELIN MATCHING ===');
    console.log(`[Michelin] Entries loaded: ${MICHELIN_DATA.length}`);
    const michelinMatched = attachMichelinData([...elite, ...moreOptions]);
    console.log(`Michelin restaurants matched: ${michelinMatched}`);

    timings.total_ms = Date.now() - t0;

    const stats = {
      totalRaw,
      uniquePlaceIds: allCandidates.length,
      within5Miles: within5Miles.length,
      eliteCount: elite.length,
      moreOptionsCount: moreOptions.length,
      excludedCount: excluded.length,
      confirmedAddress,
      userLocation: { lat: gridLat, lng: gridLng },
      performance: { ...timings, cache_hit: false, cache_key: cacheKey }
    };

    setCache(cacheKey, { elite, moreOptions, stats });

    return stableResponse(elite, moreOptions, stats, null);
  } catch (err) {
    console.error('FATAL ERROR:', err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elite: [], moreOptions: [], error: err.message })
    };
  }
};
