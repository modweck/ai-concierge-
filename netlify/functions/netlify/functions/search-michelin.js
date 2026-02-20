// netlify/functions/search-michelin.js
// Michelin mode: resolve Michelin names -> Google Places (place_id + lat/lng)
// Filter to 20 miles from user, sort by distance by default.

const fs = require("fs");
const path = require("path");

// ---- Load Michelin base list at cold start (names + stars only) ----
let MICHELIN = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${MICHELIN.length}`);
} catch (e) {
  console.log(`[Michelin] Failed to load michelin_nyc.json: ${e.message}`);
  MICHELIN = [];
}

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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simple concurrency limiter
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return stableResponse({ error: "Method not allowed" }, 405);
    }

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) {
      return stableResponse({ error: "GOOGLE_PLACES_API_KEY not configured" }, 500);
    }

    const body = JSON.parse(event.body || "{}");
    const location = String(body.location || "").trim();
    const maxMiles = typeof body.maxMiles === "number" ? body.maxMiles : 20;

    if (!location) {
      return stableResponse({ error: "Missing location", michelin: [] }, 200);
    }

    // 1) Geocode user location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      location
    )}&key=${GOOGLE_API_KEY}`;

    const geoResp = await fetch(geocodeUrl);
    const geo = await geoResp.json();

    if (geo.status !== "OK" || !geo.results?.[0]) {
      return stableResponse({
        error: `Geocode failed: ${geo.status}${
          geo.error_message ? " - " + geo.error_message : ""
        }`,
        michelin: [],
        confirmedAddress: null,
        userLocation: null,
      });
    }

    const origin = geo.results[0].geometry.location;
    const confirmedAddress = geo.results[0].formatted_address;

    // 2) Resolve each Michelin name to a real Google place (Text Search)
    const baseList = Array.isArray(MICHELIN) ? MICHELIN : [];
    if (!baseList.length) {
      return stableResponse({
        michelin: [],
        confirmedAddress,
        userLocation: origin,
        stats: { michelinCount: 0, loaded: 0 },
      });
    }

    console.log(`[Michelin] Resolving ${baseList.length} entries via Places Text Search...`);

    const resolved = await runWithConcurrency(baseList, 5, async (m) => {
      const name = String(m.name || "").trim();
      if (!name) return null;

      // Force NYC context for accuracy
      const query = encodeURIComponent(`${name} New York NY`);
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${GOOGLE_API_KEY}`;

      try {
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== "OK" || !data.results?.length) {
          return {
            name,
            distinction: m.distinction || "star",
            stars: m.stars || 0,
            place_id: null,
            geometry: null,
            formatted_address: null,
            vicinity: null,
            googleRating: null,
            googleReviewCount: null,
            distanceMiles: null,
            walkMinEstimate: null,
            driveMinEstimate: null,
            transitMinEstimate: null,
            _resolveStatus: data.status,
          };
        }

        const best = data.results[0];
        const lat = best.geometry?.location?.lat;
        const lng = best.geometry?.location?.lng;

        let distanceMiles = null;
        let walkMinEstimate = null;
        let driveMinEstimate = null;
        let transitMinEstimate = null;

        if (typeof lat === "number" && typeof lng === "number") {
          distanceMiles = Math.round(haversineMiles(origin.lat, origin.lng, lat, lng) * 10) / 10;
          walkMinEstimate = Math.round(distanceMiles * 20);
          driveMinEstimate = Math.round(distanceMiles * 4);
          transitMinEstimate = Math.round(distanceMiles * 6);
        }

        return {
          place_id: best.place_id || null,
          name: best.name || name,
          vicinity: best.formatted_address || best.vicinity || "",
          formatted_address: best.formatted_address || best.vicinity || "",
          geometry: typeof lat === "number" && typeof lng === "number" ? { location: { lat, lng } } : null,
          googleRating: best.rating ?? null,
          googleReviewCount: best.user_ratings_total ?? null,
          price_level: best.price_level ?? null,
          distanceMiles,
          walkMinEstimate,
          driveMinEstimate,
          transitMinEstimate,
          michelin: {
            distinction: m.distinction || "star",
            stars: m.stars || 0,
          },
          _resolveStatus: data.status,
        };
      } catch (e) {
        return {
          name,
          distinction: m.distinction || "star",
          stars: m.stars || 0,
          place_id: null,
          geometry: null,
          formatted_address: null,
          vicinity: null,
          googleRating: null,
          googleReviewCount: null,
          distanceMiles: null,
          walkMinEstimate: null,
          driveMinEstimate: null,
          transitMinEstimate: null,
          _resolveStatus: `ERR:${e.message}`,
        };
      }
    });

    // 3) Filter + sort by distance
    const clean = resolved.filter(Boolean);

    const withDistance = clean.filter((x) => typeof x.distanceMiles === "number");
    const within = withDistance.filter((x) => x.distanceMiles <= maxMiles);

    within.sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

    console.log(
      `[Michelin] Resolved: ${withDistance.length}/${clean.length} with coords. Returning within ${maxMiles} miles: ${within.length}`
    );

    return stableResponse({
      michelin: within,
      confirmedAddress,
      userLocation: origin,
      stats: {
        loaded: baseList.length,
        resolvedWithCoords: withDistance.length,
        returned: within.length,
        maxMiles,
      },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse({ error: e.message || "Unknown error", michelin: [] }, 200);
  }
};
