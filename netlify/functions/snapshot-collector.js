/**
 * REVIEW VELOCITY SNAPSHOT COLLECTOR
 * ===================================
 * Run this script periodically (daily or weekly) to build review velocity data.
 * It pulls current review counts from Google Places API and stores snapshots.
 *
 * HOW TO USE:
 *   node snapshot-collector.js
 *
 * REQUIREMENTS:
 *   - Set GOOGLE_PLACES_API_KEY as an environment variable
 *   - Or create a .env file with GOOGLE_PLACES_API_KEY=your_key_here
 *   - Node 18+ (for native fetch)
 *
 * WHAT IT DOES:
 *   1. Searches Google Places for restaurants in NYC (grid search)
 *   2. Stores { place_id, name, rating, review_count, date } snapshots
 *   3. Appends to review_snapshots.json (never overwrites old data)
 *   4. Over time, you get velocity data: how fast reviews are growing
 *
 * COST: ~50-100 Google Places API calls per run (~$2-5 per run)
 *       Running daily for a month = ~$60-150
 *       Running weekly = ~$8-20/month (RECOMMENDED to start)
 */

const fs = require('fs');
const path = require('path');

// Load .env if available
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
} catch (e) { /* no .env file, that's fine */ }

const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('❌ Missing GOOGLE_PLACES_API_KEY. Set it as env variable or in .env file.');
  process.exit(1);
}

const SNAPSHOTS_FILE = path.join(__dirname, 'review_snapshots.json');
const TODAY = new Date().toISOString().split('T')[0]; // "2026-02-24"

// ── Load existing snapshots ──
function loadSnapshots() {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️ Could not load existing snapshots, starting fresh:', e.message);
  }
  return {};
}

function saveSnapshots(data) {
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(data, null, 2));
  console.log(`💾 Saved ${Object.keys(data).length} restaurants to ${SNAPSHOTS_FILE}`);
}

// ── Concurrency helper ──
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

// ── Build NYC grid points for searching ──
function buildNYCGrid() {
  // Cover all 5 boroughs with grid points
  const points = [
    // Manhattan (dense grid)
    { lat: 40.7128, lng: -74.0060, label: 'Lower Manhattan' },
    { lat: 40.7260, lng: -73.9897, label: 'East Village/LES' },
    { lat: 40.7350, lng: -74.0000, label: 'West Village/SoHo' },
    { lat: 40.7425, lng: -73.9870, label: 'Gramercy/Flatiron' },
    { lat: 40.7484, lng: -73.9856, label: 'Midtown South' },
    { lat: 40.7549, lng: -73.9840, label: 'Midtown' },
    { lat: 40.7614, lng: -73.9776, label: 'Midtown East' },
    { lat: 40.7681, lng: -73.9819, label: 'UWS/Lincoln Center' },
    { lat: 40.7736, lng: -73.9566, label: 'UES' },
    { lat: 40.7903, lng: -73.9730, label: 'UWS North' },
    { lat: 40.7957, lng: -73.9372, label: 'East Harlem' },
    { lat: 40.8075, lng: -73.9626, label: 'Harlem' },
    { lat: 40.8200, lng: -73.9493, label: 'Washington Heights' },
    // Brooklyn
    { lat: 40.6892, lng: -73.9857, label: 'Downtown Brooklyn' },
    { lat: 40.6782, lng: -73.9442, label: 'Crown Heights' },
    { lat: 40.6872, lng: -73.9418, label: 'Bed-Stuy' },
    { lat: 40.6782, lng: -73.9780, label: 'Park Slope' },
    { lat: 40.7140, lng: -73.9613, label: 'Williamsburg' },
    { lat: 40.7081, lng: -73.9571, label: 'Williamsburg South' },
    { lat: 40.6590, lng: -73.9930, label: 'Sunset Park' },
    { lat: 40.6340, lng: -74.0280, label: 'Bay Ridge' },
    // Queens
    { lat: 40.7282, lng: -73.7949, label: 'Flushing' },
    { lat: 40.7433, lng: -73.9230, label: 'Astoria' },
    { lat: 40.7472, lng: -73.8940, label: 'Jackson Heights' },
    { lat: 40.7135, lng: -73.8283, label: 'Forest Hills' },
    // Bronx
    { lat: 40.8448, lng: -73.8648, label: 'Bronx - Arthur Ave' },
    { lat: 40.8614, lng: -73.8910, label: 'Bronx - Fordham' },
  ];
  return points;
}

// ── Search one grid point using New Places API ──
async function searchGridPoint(point) {
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types';

  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify({
        includedTypes: ['restaurant'],
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: point.lat, longitude: point.lng },
            radius: 1500  // 1.5km radius per point
          }
        },
        languageCode: 'en'
      })
    });

    if (!resp.ok) {
      console.log(`  ⚠️ ${point.label}: HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const places = (data.places || []).map(p => ({
      place_id: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? 0,
      review_count: p.userRatingCount ?? 0,
      types: p.types || []
    }));

    console.log(`  ✅ ${point.label}: ${places.length} restaurants`);
    return places;

  } catch (err) {
    console.log(`  ❌ ${point.label}: ${err.message}`);
    return [];
  }
}

// ── Also search for "new restaurants" and "trending restaurants" ──
async function searchTrending() {
  const queries = [
    'new restaurants NYC 2025',
    'new restaurants NYC 2026',
    'trending restaurants NYC',
    'hot new restaurants Manhattan',
    'new restaurants Brooklyn',
    'best new restaurants Queens',
    'new opening restaurants NYC'
  ];

  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types';
  const results = [];

  await runWithConcurrency(queries, 3, async (query) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 20,
          locationBias: {
            circle: {
              center: { latitude: 40.7128, longitude: -74.0060 },
              radius: 25000  // 25km = covers all NYC
            }
          },
          languageCode: 'en'
        })
      });

      if (!resp.ok) {
        console.log(`  ⚠️ "${query}": HTTP ${resp.status}`);
        return;
      }

      const data = await resp.json();
      for (const p of (data.places || [])) {
        results.push({
          place_id: p.id,
          name: p.displayName?.text || '',
          address: p.formattedAddress || '',
          lat: p.location?.latitude ?? null,
          lng: p.location?.longitude ?? null,
          rating: p.rating ?? 0,
          review_count: p.userRatingCount ?? 0,
          types: p.types || []
        });
      }
      console.log(`  ✅ "${query}": ${(data.places || []).length} results`);
    } catch (err) {
      console.log(`  ❌ "${query}": ${err.message}`);
    }
  });

  return results;
}

// ── MAIN ──
async function main() {
  console.log(`\n🚀 Review Velocity Snapshot Collector`);
  console.log(`📅 Date: ${TODAY}`);
  console.log(`─────────────────────────────────────\n`);

  // Load existing data
  const snapshots = loadSnapshots();
  const existingCount = Object.keys(snapshots).length;
  console.log(`📂 Loaded ${existingCount} existing restaurants\n`);

  // Check if we already ran today
  let alreadyRanToday = 0;
  for (const pid of Object.keys(snapshots)) {
    const last = snapshots[pid].snapshots?.slice(-1)[0];
    if (last?.date === TODAY) alreadyRanToday++;
  }
  if (alreadyRanToday > 50) {
    console.log(`⚠️ Already collected ${alreadyRanToday} snapshots today. Run again tomorrow.`);
    console.log(`   (Delete today's entries from review_snapshots.json to force re-run)\n`);
    process.exit(0);
  }

  // Search grid
  console.log('🗺️ Searching NYC grid points...');
  const grid = buildNYCGrid();
  const gridResults = await runWithConcurrency(grid, 5, searchGridPoint);
  const allFromGrid = gridResults.flat();

  // Search trending
  console.log('\n🔥 Searching for trending/new restaurants...');
  const trendingResults = await searchTrending();

  // Combine & deduplicate
  const seen = new Set();
  const allPlaces = [];
  for (const p of [...allFromGrid, ...trendingResults]) {
    if (!p.place_id || seen.has(p.place_id)) continue;
    seen.add(p.place_id);
    allPlaces.push(p);
  }

  console.log(`\n📊 Found ${allPlaces.length} unique restaurants`);

  // Add today's snapshot for each restaurant
  let newRestaurants = 0;
  let updatedRestaurants = 0;
  let skippedToday = 0;

  for (const place of allPlaces) {
    const pid = place.place_id;

    if (!snapshots[pid]) {
      // Brand new restaurant — first time seeing it
      snapshots[pid] = {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        first_seen: TODAY,
        snapshots: []
      };
      newRestaurants++;
    }

    // Update name/address if changed
    snapshots[pid].name = place.name;
    if (place.address) snapshots[pid].address = place.address;

    // Check if we already have today's snapshot
    const existingToday = snapshots[pid].snapshots.find(s => s.date === TODAY);
    if (existingToday) {
      skippedToday++;
      continue;
    }

    // Add today's snapshot
    snapshots[pid].snapshots.push({
      date: TODAY,
      review_count: place.review_count,
      rating: place.rating
    });
    updatedRestaurants++;
  }

  // Save
  saveSnapshots(snapshots);

  // Stats
  const total = Object.keys(snapshots).length;
  const withMultiple = Object.values(snapshots).filter(r => r.snapshots.length >= 2).length;

  console.log(`\n📈 RESULTS:`);
  console.log(`   New restaurants added:     ${newRestaurants}`);
  console.log(`   Existing updated:          ${updatedRestaurants}`);
  console.log(`   Skipped (already today):   ${skippedToday}`);
  console.log(`   Total in database:         ${total}`);
  console.log(`   With 2+ snapshots:         ${withMultiple} (can calculate velocity)`);

  if (withMultiple === 0) {
    console.log(`\n💡 TIP: Run this script again in 7-30 days to start getting velocity data.`);
    console.log(`   The more snapshots you collect, the more accurate velocity becomes.`);
  } else {
    // Show top rising restaurants
    console.log(`\n🔥 TOP RISING (by review growth):`);
    const rising = [];
    for (const [pid, data] of Object.entries(snapshots)) {
      if (data.snapshots.length < 2) continue;
      const latest = data.snapshots[data.snapshots.length - 1];
      const oldest = data.snapshots[0];
      const daysBetween = Math.max(1, (new Date(latest.date) - new Date(oldest.date)) / 86400000);
      const growth = latest.review_count - oldest.review_count;
      const growthPer30 = Math.round((growth / daysBetween) * 30);
      const currentRating = latest.rating;

      if (currentRating >= 4.6 && growthPer30 >= 10) {
        rising.push({
          name: data.name,
          rating: currentRating,
          reviews: latest.review_count,
          growth30: growthPer30,
          days: Math.round(daysBetween)
        });
      }
    }

    rising.sort((a, b) => b.growth30 - a.growth30);
    for (const r of rising.slice(0, 20)) {
      console.log(`   ${r.name}: +${r.growth30} reviews/30d | ${r.rating}⭐ | ${r.reviews} total | ${r.days}d tracked`);
    }
  }

  console.log(`\n✅ Done! Next run recommended in 7 days.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
