// netlify/functions/search-michelin.js

const fs = require("fs");
const path = require("path");

function stableResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
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
    return { error: `Geocode failed: ${j.status}${j.error_message ? " - " + j.error_message : ""}` };
  }
  return {
    origin: j.results[0].geometry.location,
    confirmedAddress: j.results[0].formatted_address,
  };
}

async function findPlaceByText(query, apiKey) {
  // IMPORTANT: fields must include `geometry` (not geometry/location)
  const url =
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
    `?input=${encodeURIComponent(query)}` +
    `&inputtype=textquery` +
    `&fields=place_id,formatted_address,geometry,rating,user_ratings_total,price_level,name` +
    `&key=${apiKey}`;

  const r = await fetch(url);
  const j = await r.json();

  if (j.status !== "OK" || !j.candidates?.[0]) {
    // helpful log for debugging
    console.log("[FindPlace] status:", j.status, "query:", query, j.error_message || "");
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
      } catch (e) {
        results[i] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// --- Load Michelin list at cold start ---
let MICHELIN_LIST = [];
let MICHELIN_LOAD_ERROR = null;

try {
  const p = path.join(__dirname, "michelin_nyc.json");

  // DEBUG: show what files exist next to the function at runtime
  try {
    const filesHere = fs.readdirSync(__dirname);
    console.log("[Michelin] __dirname:", __dirname);
    console.log("[Michelin] Files in __dirname:", filesHere);
  } catch (e) {
    console.log("[Michelin] Could not list __dirname files:", e.message);
  }

  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    MICHELIN_LOAD_ERROR = `michelin_nyc.json parsed but was not an array (type=${typeof parsed})`;
    MICHELIN_LIST = [];
  } else {
    MICHELIN_LIST = parsed;
  }

  console.log(`[Michelin] Loaded entries: ${MICHELIN_LIST.length}`);
  console.log("[Michelin] Sample entry:", MICHELIN_LIST?.[0] || null);
} catch (e) {
  MICHELIN_LOAD_ERROR = `Failed to load michelin_nyc.json: ${e.message}`;
  console.log(`[Michelin] ${MICHELIN_LOAD_ERROR}`);
  MICHELIN_LIST = [];
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return stableResponse({ error: "Method not allowed" }, 405);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return stableResponse({ error: "GOOGLE_PLACES_API_KEY not configured" }, 500);

    const body = JSON.parse(event.body || "{}");
    const location = String(body.location || "").trim();
    const radiusMiles = Number.isFinite(Number(body.radiusMiles)) ? Number(body.radiusMiles) : 15;

    if (!location) {
      return stableResponse({ error: "Missing location", michelin: [], confirmedAddress: null, userLocation: null }, 400);
    }

    const geo = await geocodeAddress(location, apiKey);
    if (geo.error) {
      return stableResponse({ error: geo.error, michelin: [], confirmedAddress: null, userLocation: null }, 400);
    }

    const { origin, confirmedAddress } = geo;

    if (!MICHELIN_LIST.length) {
      return stableResponse(
        {
          error: "Michelin list is empty or invalid (michelin_nyc.json)",
          debug: {
            loadError: MICHELIN_LOAD_ERROR,
            loadedCount: MICHELIN_LIST.length,
          },
          michelin: [],
          confirmedAddress,
          userLocation: origin,
        },
        500
      );
    }

    const resolved = await mapWithConcurrency(MICHELIN_LIST, 5, async (m) => {
      const name = (m && m.name) ? String(m.name).trim() : "";
      if (!name) return null;

      const query = `${name}, New York, NY`;
      const place = await findPlaceByText(query, apiKey);
      if (!place?.geometry?.location) return null;

      const lat = place.geometry.location.lat;
      const lng = place.geometry.location.lng;

      const distanceMiles = Math.round(haversineMiles(origin.lat, origin.lng, lat, lng) * 10) / 10;
      if (distanceMiles > radiusMiles) return null;

      return {
        place_id: place.place_id || null,
        name: place.name || name,
        formatted_address: place.formatted_address || "",
        geometry: { location: { lat, lng } },

        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        price_level: place.price_level ?? null,

        distanceMiles,

        michelin: { distinction: m.distinction || "star", stars: Number(m.stars || 0) },
      };
    });

    const michelin = resolved.filter(Boolean).sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

    return stableResponse({
      michelin,
      confirmedAddress,
      userLocation: origin,
      stats: {
        requestedRadiusMiles: radiusMiles,
        listCount: MICHELIN_LIST.length,
        returnedCount: michelin.length,
      },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse({ error: e.message || "Unknown error", michelin: [] }, 500);
  }
};
