// netlify/functions/search-michelin.js
// Returns ALL Michelin restaurants from michelin_nyc.json sorted by distance from the user's location.
// If a Michelin entry has no lat/lng, it will be geocoded once and cached in memory (10 min).

const fs = require("fs");
const path = require("path");

// In-memory geocode cache (per warm function instance)
const geoCache = new Map();
const GEO_TTL_MS = 10 * 60 * 1000;

function cacheGet(key) {
  const v = geoCache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > GEO_TTL_MS) {
    geoCache.delete(key);
    return null;
  }
  return v.data;
}
function cacheSet(key, data) {
  geoCache.set(key, { t: Date.now(), data });
  if (geoCache.size > 300) {
    const oldest = Array.from(geoCache.entries()).sort((a, b) => a[1].t - b[1].t)[0];
    if (oldest) geoCache.delete(oldest[0]);
  }
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Load Michelin list at startup
let MICHELIN = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${MICHELIN.length} (${p})`);
} catch (e) {
  console.log(`[Michelin] FAILED to load michelin_nyc.json: ${e.message}`);
  MICHELIN = [];
}

async function geocodeAddressOrText(query, apiKey) {
  const cacheKey = normalizeName(query);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Use Places Text Search (better for business names)
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
    query
  )}&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status === "OK" && data.results?.[0]) {
    const r = data.results[0];
    const out = {
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
      formatted_address: r.formatted_address ?? null,
      place_id: r.place_id ?? null,
    };
    cacheSet(cacheKey, out);
    return out;
  }

  cacheSet(cacheKey, null);
  return null;
}

exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const location = body.location;

    if (!location || typeof location !== "string") {
      return json(400, { error: "Missing location" });
    }

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) {
      return json(500, { error: "API key not configured" });
    }

    // Geocode the user's input location
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      location
    )}&key=${GOOGLE_API_KEY}`;

    const gRes = await fetch(geocodeUrl);
    const gData = await gRes.json();

    if (gData.status !== "OK" || !gData.results?.[0]) {
      return json(200, {
        location,
        confirmedAddress: null,
        userLocation: null,
        michelin: [],
        error: `Geocode failed: ${gData.status}${gData.error_message ? " - " + gData.error_message : ""}`,
      });
    }

    const confirmedAddress = gData.results[0].formatted_address;
    const userLat = gData.results[0].geometry.location.lat;
    const userLng = gData.results[0].geometry.location.lng;

    // Build output list: ensure each entry has lat/lng by geocoding "Name, New York, NY"
    const out = [];
    for (const m of MICHELIN) {
      const name = m.name;
      const stars = m.stars ?? null;
      const distinction = m.distinction || "star";

      let lat = typeof m.lat === "number" ? m.lat : null;
      let lng = typeof m.lng === "number" ? m.lng : null;
      let address = m.address || null;

      // If no coordinates, geocode it
      if (lat === null || lng === null) {
        const guess = await geocodeAddressOrText(`${name}, New York, NY`, GOOGLE_API_KEY);
        if (guess?.lat != null && guess?.lng != null) {
          lat = guess.lat;
          lng = guess.lng;
          address = address || guess.formatted_address || null;
        }
      }

      const dist =
        lat != null && lng != null ? haversineMiles(userLat, userLng, lat, lng) : null;

      out.push({
        name,
        distinction,
        stars,
        address,
        lat,
        lng,
        distanceMiles: dist != null ? Math.round(dist * 10) / 10 : null,
        walkMinEstimate: dist != null ? Math.round(dist * 20) : null,
        driveMinEstimate: dist != null ? Math.round(dist * 4) : null,
      });
    }

    // Sort by distance
    out.sort((a, b) => {
      if (a.distanceMiles == null && b.distanceMiles == null) {
        return normalizeName(a.name).localeCompare(normalizeName(b.name));
      }
      if (a.distanceMiles == null) return 1;
      if (b.distanceMiles == null) return -1;
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
      return normalizeName(a.name).localeCompare(normalizeName(b.name));
    });

    const matchedCoordsCount = out.filter((x) => x.lat != null && x.lng != null).length;
    console.log(`[Michelin] Returned ${out.length} entries. With coords: ${matchedCoordsCount}`);

    return json(200, {
      location,
      confirmedAddress,
      userLocation: { lat: userLat, lng: userLng },
      michelin: out,
      error: null,
    });
  } catch (err) {
    console.log("ERROR in search-michelin:", err);
    return json(200, { michelin: [], error: err.message });
  }
};
