const fs = require("fs");
const path = require("path");

// Load Michelin list at cold start
let MICHELIN = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${Array.isArray(MICHELIN) ? MICHELIN.length : 0}`);
} catch (e) {
  console.log(`[Michelin] Failed to load michelin_nyc.json: ${e.message}`);
  MICHELIN = [];
}

// In-memory cache (persists while the function instance stays warm)
const placeCache = new Map(); // key: normalized name -> { place_id, lat, lng, address }

function stableResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function toRad(x) {
  return (x * Math.PI) / 180;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")                 // remove accents (César -> Cesar)
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function geocodeAddress(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;
  const r = await fetch(url);
  const j = await r.json();
  return j;
}

async function textSearchPlace(query, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
    query
  )}&key=${apiKey}`;
  const r = await fetch(url);
  const j = await r.json();
  return j;
}

async function resolveMichelinPlace(m, apiKey) {
  const key = normalizeName(m.name);
  if (placeCache.has(key)) return placeCache.get(key);

  // If your JSON already has lat/lng, trust it and cache it
  if (typeof m.lat === "number" && typeof m.lng === "number") {
    const cached = {
      place_id: m.place_id || null,
      lat: m.lat,
      lng: m.lng,
      address: m.address || "",
    };
    placeCache.set(key, cached);
    return cached;
  }

  // Otherwise, look it up via Places Text Search
  // Add "New York, NY" to reduce wrong matches
  const q = `${m.name} New York, NY`;
  const ts = await textSearchPlace(q, apiKey);

  if (ts.status !== "OK" || !ts.results || !ts.results[0]) {
    // cache negative so we don’t hammer API
    placeCache.set(key, null);
    return null;
  }

  const top = ts.results[0];
  const loc = top.geometry && top.geometry.location ? top.geometry.location : null;

  const cached = {
    place_id: top.place_id || null,
    lat: loc && typeof loc.lat === "number" ? loc.lat : null,
    lng: loc && typeof loc.lng === "number" ? loc.lng : null,
    address: top.formatted_address || top.name || "",
  };

  placeCache.set(key, cached);
  return cached;
}

// IMPORTANT: CommonJS Netlify export (this fixes your 502)
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return stableResponse({ error: "Method not allowed" }, 405);
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return stableResponse({ error: "GOOGLE_PLACES_API_KEY not configured" }, 500);
    }

    const body = JSON.parse(event.body || "{}");
    const locationInput = String(body.location || "").trim();
    const radiusMiles = Number(body.radiusMiles || 15); // DEFAULT 15 miles (your request)

    if (!locationInput) {
      return stableResponse({ error: "Missing location", michelin: [] }, 200);
    }

    // Geocode user
    const geo = await geocodeAddress(locationInput, apiKey);
    if (geo.status !== "OK" || !geo.results || !geo.results[0]) {
      return stableResponse({
        error: `Geocode failed: ${geo.status}${geo.error_message ? " - " + geo.error_message : ""}`,
        michelin: [],
        confirmedAddress: null,
        userLocation: null,
      });
    }

    const origin = geo.results[0].geometry.location;
    const confirmedAddress = geo.results[0].formatted_address;

    const list = Array.isArray(MICHELIN) ? MICHELIN : [];

    // Resolve places (sequential but safe; list sizes are manageable)
    const resolved = [];
    for (const m of list) {
      const place = await resolveMichelinPlace(m, apiKey);
      if (!place || place.lat == null || place.lng == null) continue;

      const dist = haversineMiles(origin.lat, origin.lng, place.lat, place.lng);
      if (dist > radiusMiles) continue;

      const distanceMiles = Math.round(dist * 10) / 10;

      resolved.push({
        name: m.name,
        place_id: place.place_id,
        formatted_address: place.address || "",
        vicinity: place.address || "",
        geometry: { location: { lat: place.lat, lng: place.lng } },

        // for your UI / sorting
        distanceMiles,
        walkMinEstimate: Math.round(distanceMiles * 20),
        driveMinEstimate: Math.round(distanceMiles * 4),
        transitMinEstimate: Math.round(distanceMiles * 6),

        michelin: {
          distinction: m.distinction || "star",
          stars: Number(m.stars || 0),
        },
      });
    }

    // Sort by distance by default (your request)
    resolved.sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

    return stableResponse({
      michelin: resolved,
      confirmedAddress,
      userLocation: origin,
      stats: {
        loadedMichelinList: list.length,
        returnedWithinRadius: resolved.length,
        radiusMiles,
      },
    });
  } catch (e) {
    console.log("search-michelin error:", e);
    return stableResponse({ error: e.message || "Unknown error", michelin: [] }, 200);
  }
};
