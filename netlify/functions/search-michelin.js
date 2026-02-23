const fs = require("fs");
const path = require("path");

// =========================================================================
// LOAD DATA FILES
// =========================================================================

let MICHELIN_LIST = [];
let MICHELIN_LOAD_ERROR = null;
try {
  MICHELIN_LIST = require("./michelin_nyc.json");
  if (!Array.isArray(MICHELIN_LIST)) {
    MICHELIN_LOAD_ERROR = "michelin_nyc.json did not export an array";
    MICHELIN_LIST = [];
  }
  console.log(`✅ Michelin list: ${MICHELIN_LIST.length} entries`);
} catch (e) {
  MICHELIN_LOAD_ERROR = `Failed to require michelin_nyc.json: ${e.message}`;
  console.log("[Michelin]", MICHELIN_LOAD_ERROR);
  MICHELIN_LIST = [];
}

// Booking lookup — maps restaurant names to OpenTable/Resy/Tock URLs
let BOOKING_LOOKUP = {};
let BOOKING_KEYS = [];
try {
  BOOKING_LOOKUP = JSON.parse(
    fs.readFileSync(path.join(__dirname, "booking_lookup.json"), "utf8")
  );
  BOOKING_KEYS = Object.keys(BOOKING_LOOKUP);
  console.log(`✅ Booking lookup: ${BOOKING_KEYS.length} entries`);
} catch (err) {
  console.warn("⚠️ Booking lookup missing:", err.message);
}

// Deposit lookup — restaurants that require deposits/prepay
let DEPOSIT_LOOKUP = {};
try {
  DEPOSIT_LOOKUP = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deposit_lookup.json"), "utf8")
  );
  console.log(`✅ Deposit lookup: ${Object.keys(DEPOSIT_LOOKUP).length} entries`);
} catch (err) {
  console.warn("⚠️ Deposit lookup missing:", err.message);
}

// =========================================================================
// HELPERS
// =========================================================================

function stableResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeAddress(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.[0]) {
    return {
      error: `Geocode failed: ${j.status}${
        j.error_message ? " - " + j.error_message : ""
      }`,
    };
  }
  return {
    origin: j.results[0].geometry.location,
    confirmedAddress: j.results[0].formatted_address,
  };
}

async function findPlaceByText(query, apiKey) {
  const url =
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
    `?input=${encodeURIComponent(query)}` +
    `&inputtype=textquery` +
    `&fields=place_id,formatted_address,geometry,rating,user_ratings_total,price_level,name` +
    `&key=${apiKey}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status !== "OK" || !j.candidates?.[0]) {
    return null;
  }
  return j.candidates[0];
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// =========================================================================
// BOOKING LOOKUP — matches restaurant names to OpenTable/Resy/Tock URLs
// =========================================================================

function normalizeForBooking(name) {
  return (name || "")
    .toLowerCase()
    .trim()
    .replace(
      /\s*[-\u2013\u2014]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i,
      ""
    )
    .replace(
      /\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|steakhouse|trattoria|pizzeria|cafe|café|bistro|brasserie|kitchen)$/i,
      ""
    )
    .replace(/^the\s+/, "")
    .trim();
}

function getBookingInfo(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (BOOKING_LOOKUP[key]) return BOOKING_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, "");
  if (BOOKING_LOOKUP[noThe]) return BOOKING_LOOKUP[noThe];
  const norm = normalizeForBooking(name);
  if (norm && BOOKING_LOOKUP[norm]) return BOOKING_LOOKUP[norm];
  for (const lk of BOOKING_KEYS) {
    if (lk.length < 4) continue;
    if (key.includes(lk) || lk.includes(key)) return BOOKING_LOOKUP[lk];
    if (norm && norm.length >= 4 && (norm.includes(lk) || lk.includes(norm)))
      return BOOKING_LOOKUP[lk];
  }
  return null;
}

function getDepositType(name) {
  if (!name) return "unknown";
  const key = name.toLowerCase().trim();
  if (DEPOSIT_LOOKUP[key]) return DEPOSIT_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, "");
  if (DEPOSIT_LOOKUP[noThe]) return DEPOSIT_LOOKUP[noThe];
  return "unknown";
}

// =========================================================================
// CACHE — avoid re-geocoding the same Michelin restaurants on every search
// =========================================================================
const resolvedCache = new Map(); // name -> { place_id, lat, lng, ... }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let cacheTimestamp = 0;

function getCachedPlace(name) {
  if (Date.now() - cacheTimestamp > CACHE_TTL) {
    resolvedCache.clear();
    cacheTimestamp = Date.now();
    return null;
  }
  return resolvedCache.get(name.toLowerCase().trim()) || null;
}

function setCachedPlace(name, data) {
  resolvedCache.set(name.toLowerCase().trim(), data);
}

// =========================================================================
// HANDLER
// =========================================================================

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return stableResponse({ error: "Method not allowed" }, 405);
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return stableResponse(
        { error: "GOOGLE_PLACES_API_KEY not configured" },
        500
      );
    }

    const body = JSON.parse(event.body || "{}");
    const location = String(body.location || "").trim();
    const radiusMiles = Number.isFinite(Number(body.radiusMiles))
      ? Number(body.radiusMiles)
      : 15;

    if (!location) {
      return stableResponse({ error: "Missing location", michelin: [] }, 400);
    }

    const geo = await geocodeAddress(location, apiKey);
    if (geo.error) {
      return stableResponse({ error: geo.error, michelin: [] }, 400);
    }

    const { origin, confirmedAddress } = geo;

    if (!MICHELIN_LIST.length) {
      return stableResponse(
        {
          error: "Michelin list empty or failed to load",
          debug: {
            loadError: MICHELIN_LOAD_ERROR,
            loadedCount: MICHELIN_LIST.length,
          },
          michelin: [],
        },
        500
      );
    }

    const t0 = Date.now();
    let cacheHits = 0;
    let apiCalls = 0;

    // Resolve Michelin restaurants — use cache when available
    const resolved = await mapWithConcurrency(MICHELIN_LIST, 10, async (m) => {
      const name = m?.name ? String(m.name).trim() : "";
      if (!name) return null;

      // Check cache first
      let place = getCachedPlace(name);
      if (place) {
        cacheHits++;
      } else {
        // Geocode via Google API
        apiCalls++;
        const query = `${name}, New York, NY`;
        place = await findPlaceByText(query, apiKey);
        if (place?.geometry?.location) {
          setCachedPlace(name, place);
        }
      }

      if (!place?.geometry?.location) return null;

      const lat = place.geometry.location.lat;
      const lng = place.geometry.location.lng;

      const distanceMiles =
        Math.round(haversineMiles(origin.lat, origin.lng, lat, lng) * 10) / 10;

      if (distanceMiles > radiusMiles) return null;

      const walkMinEstimate = Math.round(distanceMiles * 20);
      const driveMinEstimate = Math.round(distanceMiles * 4);
      const transitMinEstimate = Math.round(distanceMiles * 6);

      // Get booking info — check lookup file first, then fall back to michelin_nyc.json data
      let bookingPlatform = m.booking_platform || null;
      let bookingUrl = m.booking_url || null;

      const lookupInfo = getBookingInfo(name);
      if (lookupInfo) {
        bookingPlatform = lookupInfo.platform;
        bookingUrl = lookupInfo.url;
      }

      return {
        place_id: place.place_id || null,
        name: place.name || name,
        vicinity: place.formatted_address || "",
        formatted_address: place.formatted_address || "",
        geometry: { location: { lat, lng } },

        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        price_level: place.price_level ?? m.price_level ?? null,

        distanceMiles,
        walkMinEstimate,
        driveMinEstimate,
        transitMinEstimate,

        michelin: {
          distinction: m.distinction || "star",
          stars: Number(m.stars || 0),
        },

        booking_platform: bookingPlatform,
        booking_url: bookingUrl,
        deposit_type: getDepositType(name),
        chase_sapphire: m.chase_sapphire || false,
        cuisine: m.cuisine || null,
      };
    });

    const michelin = resolved
      .filter(Boolean)
      .sort(
        (a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999)
      );

    const elapsed = Date.now() - t0;
    console.log(
      `✅ Michelin search: ${michelin.length} results in ${elapsed}ms ` +
        `(${cacheHits} cached, ${apiCalls} API calls)`
    );

    return stableResponse({
      michelin,
      confirmedAddress,
      userLocation: origin,
      stats: {
        requestedRadiusMiles: radiusMiles,
        listCount: MICHELIN_LIST.length,
        returnedCount: michelin.length,
        performance: {
          totalMs: elapsed,
          cacheHits,
          apiCalls,
        },
      },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse(
      { error: e.message || "Unknown error", michelin: [] },
      500
    );
  }
};
