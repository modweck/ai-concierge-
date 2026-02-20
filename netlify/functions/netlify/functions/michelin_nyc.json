// FILE PATH (create this file exactly here):
// netlify/functions/search-michelin.js
//
// What it does:
// - Loads michelin_nyc.json (names only)
// - Geocodes the user's location
// - For EACH Michelin restaurant, uses Google Places Find Place to get:
//   place_id, address, lat/lng, rating, review count, price_level
// - Computes straight-line distance from user
// - Filters to <= 15 miles
// - Sorts by distance ASC
//
// Required env var:
// GOOGLE_PLACES_API_KEY

const fs = require("fs");
const path = require("path");

let MICHELIN_LIST = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN_LIST = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${Array.isArray(MICHELIN_LIST) ? MICHELIN_LIST.length : 0}`);
} catch (e) {
  console.log(`[Michelin] Failed to load michelin_nyc.json: ${e.message}`);
  MICHELIN_LIST = [];
}

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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeAddress(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
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
  const url =
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
    `?input=${encodeURIComponent(query)}` +
    `&inputtype=textquery` +
    `&fields=place_id,formatted_address,geometry/location,rating,user_ratings_total,price_level,name` +
    `&key=${apiKey}`;

  const r = await fetch(url);
  const j = await r.json();

  if (j.status !== "OK" || !j.candidates?.[0]) return null;
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return stableResponse({ error: "Method not allowed" }, 405);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return stableResponse({ error: "GOOGLE_PLACES_API_KEY not configured" }, 500);

    const body = JSON.parse(event.body || "{}");
    const location = String(body.location || "").trim();
    if (!location) {
      return stableResponse({
        error: "Missing location",
        michelin: [],
        confirmedAddress: null,
        userLocation: null,
      });
    }

    const radiusMiles = Number(body.radiusMiles || 15);

    const geo = await geocodeAddress(location, apiKey);
    if (geo.error) {
      return stableResponse({
        error: geo.error,
        michelin: [],
        confirmedAddress: null,
        userLocation: null,
      });
    }

    const { origin, confirmedAddress } = geo;

    const list = Array.isArray(MICHELIN_LIST) ? MICHELIN_LIST : [];
    if (!list.length) {
      return stableResponse({
        error: "Michelin list is empty (michelin_nyc.json)",
        michelin: [],
        confirmedAddress,
        userLocation: origin,
      });
    }

    // Query format: "<name>, New York, NY" helps reduce wrong matches
    const resolved = await mapWithConcurrency(list, 5, async (m) => {
      const query = `${m.name}, New York, NY`;
      const place = await findPlaceByText(query, apiKey);
      if (!place?.geometry?.location) return null;

      const lat = place.geometry.location.lat;
      const lng = place.geometry.location.lng;

      const distanceMiles = Math.round(haversineMiles(origin.lat, origin.lng, lat, lng) * 10) / 10;

      // Filter here
      if (Number.isFinite(radiusMiles) && distanceMiles > radiusMiles) return null;

      // Rough estimates (optional)
      const walkMinEstimate = Math.round(distanceMiles * 20);
      const driveMinEstimate = Math.round(distanceMiles * 4);
      const transitMinEstimate = Math.round(distanceMiles * 6);

      return {
        place_id: place.place_id || null,
        name: place.name || m.name,
        vicinity: place.formatted_address || "",
        formatted_address: place.formatted_address || "",
        geometry: { location: { lat, lng } },

        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        price_level: place.price_level ?? null,

        distanceMiles,
        walkMinEstimate,
        driveMinEstimate,
        transitMinEstimate,

        michelin: { distinction: m.distinction || "star", stars: m.stars || 0 },
      };
    });

    const michelin = resolved.filter(Boolean);

    // Sort by distance
    michelin.sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

    console.log(`[Michelin] Returning ${michelin.length} entries within ${radiusMiles} miles`);

    return stableResponse({
      michelin,
      confirmedAddress,
      userLocation: origin,
      stats: {
        requestedRadiusMiles: radiusMiles,
        listCount: list.length,
        returnedCount: michelin.length,
      },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse({ error: e.message || "Unknown error", michelin: [] }, 200);
  }
};
