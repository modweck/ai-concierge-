#!/usr/bin/env node
/**
 * NYC RESTAURANT SWEEPER
 * 
 * Systematically searches ALL of NYC with a dense grid to find every
 * 4.4+ rated restaurant. Saves results to popular_nyc.json.
 * 
 * Run from: netlify/functions/
 *   node sweep_nyc_restaurants.js
 * 
 * Requires:
 *   - Node 18+ (native fetch)
 *   - GOOGLE_PLACES_API_KEY in .env or environment
 * 
 * API Usage Estimate:
 *   ~200-400 API calls (Nearby Search, New API)
 *   Runs in ~5-10 minutes
 * 
 * Output: popular_nyc.json — all 4.4+ restaurants across NYC
 */

const fs = require('fs');
const path = require('path');

// ─── Load API Key ───────────────────────────────────────────
let API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    const match = envFile.match(/GOOGLE_PLACES_API_KEY\s*=\s*(.+)/);
    if (match) API_KEY = match[1].trim().replace(/["']/g, '');
  } catch (e) {}
}
if (!API_KEY) {
  try {
    const envPath = path.join(__dirname, '..', '..', 'env.example');
    const envFile = fs.readFileSync(envPath, 'utf8');
    const match = envFile.match(/GOOGLE_PLACES_API_KEY\s*=\s*(.+)/);
    if (match && !match[1].includes('your_')) API_KEY = match[1].trim().replace(/["']/g, '');
  } catch (e) {}
}
if (!API_KEY) {
  console.error('❌ No GOOGLE_PLACES_API_KEY found. Set it in .env or environment.');
  console.log('   export GOOGLE_PLACES_API_KEY=your_key_here');
  process.exit(1);
}

const OUTPUT_PATH = path.join(__dirname, 'popular_nyc.json');
const REPORT_PATH = path.join(__dirname, 'sweep_report.json');
const BOOKING_PATH = path.join(__dirname, 'booking_lookup.json');

const MIN_RATING = 4.4;
const MIN_REVIEWS = 25;

// Load existing booking lookup for enrichment
let BOOKING_LOOKUP = {};
try {
  BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_PATH, 'utf8'));
  console.log(`✅ Booking lookup loaded: ${Object.keys(BOOKING_LOOKUP).length} entries`);
} catch (e) {}

// Load existing popular_nyc.json if resuming
let existingPopular = [];
try {
  existingPopular = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  console.log(`📂 Existing popular_nyc.json: ${existingPopular.length} entries (will merge)`);
} catch (e) {}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeForBooking(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-–—]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|café|bistro|brasserie|kitchen|dining|room)$/i, '')
    .replace(/^the\s+/, '')
    .trim();
}

function getBookingInfo(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (BOOKING_LOOKUP[key]) return BOOKING_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, '');
  if (BOOKING_LOOKUP[noThe]) return BOOKING_LOOKUP[noThe];
  const norm = normalizeForBooking(name);
  if (norm && BOOKING_LOOKUP[norm]) return BOOKING_LOOKUP[norm];
  for (const lk of Object.keys(BOOKING_LOOKUP)) {
    if (lk.length < 4) continue;
    if (key.includes(lk) || lk.includes(key)) return BOOKING_LOOKUP[lk];
  }
  return null;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

// ─── Types to exclude ───────────────────────────────────────
const ALWAYS_JUNK_TYPES = new Set([
  'ice_cream_shop', 'coffee_shop', 'bakery', 'bagel_shop', 'donut_shop',
  'juice_shop', 'smoothie_shop', 'dessert_shop', 'food_court',
  'convenience_store', 'grocery_store', 'supermarket', 'liquor_store',
  'shopping_mall', 'department_store', 'clothing_store', 'shoe_store',
  'electronics_store', 'museum', 'amusement_park', 'stadium',
  'movie_theater', 'observation_deck', 'visitor_center', 'night_club'
]);

const EXCLUDED_NAME_PATTERNS = [
  /\bstarbucks\b/i, /\bdunkin\b/i, /\bmcdonald/i, /\bsubway\b/i,
  /\bchipotle\b/i, /\bshake shack\b/i, /\bsweetgreen\b/i,
  /\bpanera\b/i, /\bpret a manger\b/i, /\bchick-fil-a\b/i,
  /\bwendy'?s\b/i, /\bburger king\b/i, /\btaco bell\b/i,
  /\bpopeyes\b/i, /\bfive guys\b/i, /\bpapa john/i, /\bdomino/i,
  /\bpizza hut\b/i, /\blittle caesars\b/i, /\bkfc\b/i,
  /\bdeli\b/i, /\bbodega\b/i, /\bice cream\b/i, /\bgelato\b/i,
  /\bfrozen yogurt\b/i, /\bjuice\b/i, /\bsmoothie\b/i,
  /\bboba\b/i, /\bbubble tea\b/i, /\bcoffee\b/i,
  /\bbakery\b/i, /\bdonut\b/i, /\bbagel\b/i,
  /\bfood truck\b/i, /\bfood cart\b/i, /\bhalal cart\b/i,
  /\bdollar pizza\b/i, /\b\$1 pizza\b/i
];

function isJunk(name, types) {
  if (types.some(t => ALWAYS_JUNK_TYPES.has(t))) return true;
  if (EXCLUDED_NAME_PATTERNS.some(rx => rx.test(name))) return true;
  return false;
}

function convertPrice(str) {
  if (!str) return null;
  return { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[str] ?? null;
}

// ═══════════════════════════════════════════════════════════
// NYC GRID — Dense coverage of all five boroughs
// ═══════════════════════════════════════════════════════════
function buildNYCGrid() {
  const grid = [];
  
  // NYC bounding areas with grid spacing
  // Each area: [name, minLat, maxLat, minLng, maxLng, stepMiles]
  const areas = [
    // Manhattan — dense grid (0.4 mile steps)
    ['Manhattan South', 40.700, 40.735, -74.020, -73.970, 0.4],
    ['Manhattan Mid-South', 40.735, 40.760, -74.010, -73.965, 0.4],
    ['Manhattan Midtown', 40.750, 40.775, -74.000, -73.960, 0.4],
    ['Manhattan Upper', 40.775, 40.810, -73.990, -73.945, 0.4],
    ['Manhattan Harlem+', 40.810, 40.880, -73.970, -73.930, 0.5],
    
    // Brooklyn — medium grid (0.5 mile steps)
    ['Brooklyn North', 40.680, 40.720, -73.990, -73.930, 0.5],
    ['Brooklyn Central', 40.650, 40.680, -73.990, -73.940, 0.5],
    ['Brooklyn South', 40.620, 40.650, -74.010, -73.940, 0.6],
    ['Brooklyn East', 40.650, 40.700, -73.930, -73.880, 0.6],
    ['Williamsburg/Greenpoint', 40.710, 40.740, -73.970, -73.935, 0.4],
    
    // Queens — medium grid
    ['LIC/Astoria', 40.740, 40.785, -73.935, -73.890, 0.5],
    ['Queens Central', 40.720, 40.760, -73.890, -73.830, 0.6],
    ['Flushing', 40.755, 40.775, -73.840, -73.810, 0.4],
    ['Jackson Heights', 40.745, 40.760, -73.895, -73.860, 0.5],
    
    // Bronx — sparse grid
    ['Bronx South', 40.820, 40.860, -73.930, -73.880, 0.6],
    ['Bronx Arthur Ave', 40.850, 40.870, -73.895, -73.870, 0.5],
    
    // Staten Island — sparse
    ['Staten Island North', 40.630, 40.650, -74.090, -74.050, 0.7],
    
    // Jersey City/Hoboken (bonus — close to NYC)
    ['Jersey City', 40.715, 40.745, -74.060, -74.025, 0.5],
    ['Hoboken', 40.735, 40.755, -74.040, -74.020, 0.5],
  ];
  
  for (const [name, minLat, maxLat, minLng, maxLng, stepMiles] of areas) {
    const stepLat = stepMiles / 69; // ~69 miles per degree latitude
    const stepLng = stepMiles / 54.6; // ~54.6 miles per degree longitude at NYC latitude
    
    let areaPoints = 0;
    for (let lat = minLat; lat <= maxLat; lat += stepLat) {
      for (let lng = minLng; lng <= maxLng; lng += stepLng) {
        grid.push({
          lat: Math.round(lat * 10000) / 10000,
          lng: Math.round(lng * 10000) / 10000,
          area: name
        });
        areaPoints++;
      }
    }
    console.log(`  📍 ${name}: ${areaPoints} grid points`);
  }
  
  console.log(`\n🗺️  Total grid points: ${grid.length}`);
  return grid;
}

// ═══════════════════════════════════════════════════════════
// NEW API — Nearby Search (20 results per point)
// ═══════════════════════════════════════════════════════════
async function searchNearby(lat, lng, radius) {
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.websiteUri';
  
  try {
    const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify({
        includedTypes: ['restaurant'],
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radius
          }
        },
        languageCode: 'en'
      })
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        console.log('  ⏳ Rate limited, waiting 5s...');
        await sleep(5000);
        return [];
      }
      return [];
    }

    const data = await resp.json();
    return (data.places || []).map(p => ({
      place_id: p.id || '',
      name: (p.displayName?.text || '').trim(),
      address: p.formattedAddress || '',
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      googleRating: p.rating ?? 0,
      googleReviewCount: p.userRatingCount ?? 0,
      price_level: convertPrice(p.priceLevel),
      types: p.types || [],
      websiteUri: p.websiteUri || null
    }));
  } catch (err) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN SWEEP
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('NYC RESTAURANT SWEEPER — Finding all 4.4+ restaurants');
  console.log('════════════════════════════════════════════════════════════\n');

  const grid = buildNYCGrid();
  
  const seen = new Set();
  const allResults = [];
  let apiCalls = 0;
  let totalRaw = 0;
  
  // Add existing entries to seen set
  for (const r of existingPopular) {
    if (r.place_id) seen.add(r.place_id);
  }
  if (seen.size > 0) console.log(`📂 Skipping ${seen.size} already-known place IDs\n`);
  
  // Process grid in batches to show progress
  const batchSize = 8; // concurrent requests
  const totalBatches = Math.ceil(grid.length / batchSize);
  
  console.log(`🔍 Starting sweep: ${grid.length} grid points, ${batchSize} concurrent`);
  console.log(`   Estimated API calls: ~${grid.length}`);
  console.log(`   Estimated time: ~${Math.ceil(grid.length / batchSize * 1.5)} seconds\n`);
  
  const startTime = Date.now();
  const areaStats = {};
  
  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, grid.length);
    const batchItems = grid.slice(batchStart, batchEnd);
    
    const results = await Promise.all(batchItems.map(async (pt) => {
      const places = await searchNearby(pt.lat, pt.lng, 600); // 600m radius
      apiCalls++;
      return { area: pt.area, places };
    }));
    
    let batchNew = 0;
    for (const { area, places } of results) {
      if (!areaStats[area]) areaStats[area] = { raw: 0, new: 0, qualified: 0 };
      
      for (const p of places) {
        totalRaw++;
        areaStats[area].raw++;
        
        if (!p.place_id || seen.has(p.place_id)) continue;
        seen.add(p.place_id);
        
        // Filter: must be real restaurant, 4.4+, enough reviews
        if (isJunk(p.name, p.types)) continue;
        if (p.googleRating < MIN_RATING) continue;
        if (p.googleReviewCount < MIN_REVIEWS) continue;
        
        // Skip $1 price level (fast food tier)
        if (p.price_level === 1) continue;
        
        // 5.0 with <500 reviews = likely inflated
        if (p.googleRating >= 5.0 && p.googleReviewCount < 500) continue;
        // 4.9 needs 50+ reviews
        if (p.googleRating >= 4.9 && p.googleReviewCount < 50) continue;
        
        // Look up booking info
        let booking_platform = null;
        let booking_url = null;
        const bookingInfo = getBookingInfo(p.name);
        if (bookingInfo) {
          booking_platform = bookingInfo.platform;
          booking_url = bookingInfo.url;
        }
        if (!booking_platform && p.websiteUri) {
          const w = p.websiteUri.toLowerCase();
          if (w.includes('resy.com/cities/')) { booking_platform = 'resy'; booking_url = p.websiteUri; }
          else if (w.includes('opentable.com/r/')) { booking_platform = 'opentable'; booking_url = p.websiteUri; }
          else if (w.includes('exploretock.com/') || w.includes('tock.com/')) { booking_platform = 'tock'; booking_url = p.websiteUri; }
        }
        
        allResults.push({
          place_id: p.place_id,
          name: p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          googleRating: p.googleRating,
          googleReviewCount: p.googleReviewCount,
          price_level: p.price_level,
          booking_platform,
          booking_url
        });
        
        areaStats[area].new++;
        areaStats[area].qualified++;
        batchNew++;
      }
    }
    
    // Progress update every batch
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = Math.round((batchEnd / grid.length) * 100);
    process.stdout.write(`\r  [${pct}%] ${batchEnd}/${grid.length} points | ${apiCalls} API calls | ${allResults.length} qualified restaurants | ${elapsed}s`);
    
    // Small delay between batches
    await sleep(200);
  }
  
  console.log('\n');
  
  // Merge with existing
  const existingById = new Map();
  for (const r of existingPopular) {
    if (r.place_id) existingById.set(r.place_id, r);
  }
  
  // Combine: existing + new (deduped)
  const merged = [...existingPopular];
  let newCount = 0;
  for (const r of allResults) {
    if (!existingById.has(r.place_id)) {
      merged.push(r);
      newCount++;
    }
  }
  
  // Sort by rating desc, then review count desc
  merged.sort((a, b) => {
    if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
    return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
  });
  
  // Save
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Grid points searched: ${grid.length}`);
  console.log(`  API calls made:       ${apiCalls}`);
  console.log(`  Raw results:          ${totalRaw}`);
  console.log(`  Unique place IDs:     ${seen.size}`);
  console.log(`  Qualified (${MIN_RATING}+):     ${allResults.length} new`);
  console.log(`  Previously known:     ${existingPopular.length}`);
  console.log(`  TOTAL saved:          ${merged.length}`);
  console.log(`  Time elapsed:         ${elapsed}s`);
  
  console.log('\n📊 By area:');
  for (const [area, stats] of Object.entries(areaStats).sort((a, b) => b[1].qualified - a[1].qualified)) {
    if (stats.qualified > 0) {
      console.log(`  ${area}: ${stats.qualified} qualified (${stats.raw} raw)`);
    }
  }
  
  // Rating distribution
  const dist = { '4.9+': 0, '4.7-4.8': 0, '4.5-4.6': 0, '4.4': 0 };
  for (const r of merged) {
    if (r.googleRating >= 4.9) dist['4.9+']++;
    else if (r.googleRating >= 4.7) dist['4.7-4.8']++;
    else if (r.googleRating >= 4.5) dist['4.5-4.6']++;
    else dist['4.4']++;
  }
  console.log('\n⭐ Rating distribution:');
  for (const [range, count] of Object.entries(dist)) {
    console.log(`  ${range}: ${count}`);
  }
  
  // Booking coverage
  const withBooking = merged.filter(r => r.booking_platform).length;
  console.log(`\n🔖 Booking links: ${withBooking}/${merged.length} (${Math.round(withBooking/merged.length*100)}%)`);
  
  console.log(`\n💾 Saved to ${OUTPUT_PATH}`);
  
  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    gridPoints: grid.length,
    apiCalls,
    totalRaw,
    uniquePlaceIds: seen.size,
    newQualified: allResults.length,
    previouslyKnown: existingPopular.length,
    totalSaved: merged.length,
    elapsedSeconds: parseFloat(elapsed),
    areaStats,
    ratingDistribution: dist,
    bookingCoverage: { withBooking, total: merged.length }
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to ${REPORT_PATH}`);
  
  // ───────────────────────────────────────────────────────
  // NEXT STEP REMINDER
  // ───────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('NEXT STEPS');
  console.log('════════════════════════════════════════════════════════════');
  console.log('1. Review popular_nyc.json');
  console.log('2. Update search-candidates.js to inject popular restaurants');
  console.log('   (same pattern as Michelin/Bib Gourmand injection)');
  console.log('3. Deploy to Netlify');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
