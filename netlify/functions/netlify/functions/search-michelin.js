// netlify/functions/search-michelin.js
// Returns ALL Michelin restaurants (citywide) from michelin_nyc.json
// Computes distance from user location (straight-line) so user can sort.

const fs = require("fs");
const path = require("path");

// ---- Load Michelin list at cold start ----
let MICHELIN = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${MICHELIN.length}`);
} catch (e) {
  console.log(`[Michelin] Failed to load michelin_nyc.json: ${e.message}`);
  MICHELIN = [];
}

// ---- small helpers ----
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function stableResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
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
    if (!location) {
      return stableResponse({ error: "Missing location" }, 200);
    }

    // Geocode user location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      location
    )}&key=${GOOGLE_API_KEY}`;

    const geoResp = await fetch(geocodeUrl);
    const geo = await geoResp.json();

    if (geo.status !== "OK" || !geo.results?.[0]) {
      return stableResponse({
        error: `Geocode failed: ${geo.status}${geo.error_message ? " - " + geo.error_message : ""}`,
        michelin: [],
        confirmedAddress: null,
        userLocation: null,
      });
    }

    const origin = geo.results[0].geometry.location;
    const confirmedAddress = geo.results[0].formatted_address;

    // Build full Michelin list response (CITYWIDE)
    const out = (Array.isArray(MICHELIN) ? MICHELIN : []).map((m) => {
      const lat = typeof m.lat === "number" ? m.lat : null;
      const lng = typeof m.lng === "number" ? m.lng : null;

      let distanceMiles = null;
      let walkMinEstimate = null;
      let driveMinEstimate = null;
      let transitMinEstimate = null;

      // If lat/lng exist, compute distance + rough estimates
      if (lat !== null && lng !== null) {
        distanceMiles = Math.round(haversineMiles(origin.lat, origin.lng, lat, lng) * 10) / 10;
        walkMinEstimate = Math.round(distanceMiles * 20);   // ~3mph
        driveMinEstimate = Math.round(distanceMiles * 4);   // ~15mph city-ish
        transitMinEstimate = Math.round(distanceMiles * 6); // rough
      }

      return {
        // mimic your normal candidate shape enough for UI display
        place_id: m.place_id || null, // optional if you add later
        name: m.name,
        vicinity: m.address || "",
        formatted_address: m.address || "",
        geometry: lat !== null && lng !== null ? { location: { lat, lng } } : null,

        googleRating: m.googleRating || 0,
        googleReviewCount: m.googleReviewCount || 0,
        price_level: m.price_level || null,

        distanceMiles,
        walkMinEstimate,
        driveMinEstimate,
        transitMinEstimate,

        michelin: {
          distinction: m.distinction || "star",
          stars: m.stars || 0,
        },
      };
    });

    console.log(`[Michelin] Returning ${out.length} entries (citywide)`);

    return stableResponse({
      michelin: out,
      confirmedAddress,
      userLocation: origin,
      stats: { michelinCount: out.length, loaded: MICHELIN.length },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse({ error: e.message || "Unknown error", michelin: [] }, 200);
  }
};
