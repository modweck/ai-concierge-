// netlify/functions/search-michelin.js
// Returns ALL Michelin restaurants (NYC + boroughs) sorted by distance to the user's input location

const fs = require("fs");
const path = require("path");

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

// Load Michelin JSON at startup (same folder as this function file)
let MICHELIN = [];
try {
  const p = path.join(__dirname, "michelin_nyc.json");
  MICHELIN = JSON.parse(fs.readFileSync(p, "utf8"));
  console.log(`[Michelin] Loaded entries: ${MICHELIN.length} from ${p}`);
} catch (e) {
  console.log(`[Michelin] FAILED to load michelin_nyc.json: ${e.message}`);
  MICHELIN = [];
}

exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const location = body.location;

    if (!location || typeof location !== "string") {
      return json(400, { error: "Missing location" });
    }

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!GOOGLE_API_KEY) {
      return json(500, { error: "API key not configured" });
    }

    // 1) Geocode the user's location input
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      location
    )}&key=${GOOGLE_API_KEY}`;

    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (geocodeData.status !== "OK" || !geocodeData.results?.[0]) {
      return json(200, {
        location,
        confirmedAddress: null,
        userLocation: null,
        michelin: [],
        error: `Geocode failed: ${geocodeData.status}${
          geocodeData.error_message ? " - " + geocodeData.error_message : ""
        }`,
      });
    }

    const confirmedAddress = geocodeData.results[0].formatted_address;
    const userLat = geocodeData.results[0].geometry.location.lat;
    const userLng = geocodeData.results[0].geometry.location.lng;

    // 2) Build Michelin list + compute distance
    const out = (MICHELIN || [])
      .map((m) => {
        const lat = typeof m.lat === "number" ? m.lat : null;
        const lng = typeof m.lng === "number" ? m.lng : null;
        const distMiles =
          lat !== null && lng !== null
            ? haversineMiles(userLat, userLng, lat, lng)
            : null;

        return {
          name: m.name,
          distinction: m.distinction || "star",
          stars: m.stars ?? null,
          address: m.address || null,
          lat,
          lng,
          distanceMiles: distMiles !== null ? Math.round(distMiles * 10) / 10 : null,
          walkMinEstimate: distMiles !== null ? Math.round(distMiles * 20) : null, // rough
          driveMinEstimate: distMiles !== null ? Math.round(distMiles * 4) : null, // rough
        };
      })
      .sort((a, b) => {
        // distance-null goes to bottom
        if (a.distanceMiles === null && b.distanceMiles === null) {
          return normalizeName(a.name).localeCompare(normalizeName(b.name));
        }
        if (a.distanceMiles === null) return 1;
        if (b.distanceMiles === null) return -1;
        if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
        return normalizeName(a.name).localeCompare(normalizeName(b.name));
      });

    console.log(
      `[Michelin] Returned ${out.length} entries. First 3: ${out
        .slice(0, 3)
        .map((x) => `${x.name} (${x.distanceMiles}mi)`)
        .join(", ")}`
    );

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
