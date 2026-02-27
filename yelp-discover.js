#!/usr/bin/env node
/**
 * YELP RESTAURANT DISCOVERY
 * ==========================
 * Uses Yelp Fusion API to find highly-rated NYC restaurants
 * not already in your database.
 *
 * RUN: cd ~/ai-concierge- && node yelp-discover.js
 * OPTIONS:
 *   --quick    Only search 5 neighborhoods (vs all)
 */

const fs = require('fs');
const path = require('path');

const QUICK = process.argv.includes('--quick');
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');

const YELP_KEY = 'D96Fea4WuBdtSf2G7TGxR77q9Bdo5FUK9a3GQ2t3mICRdMthsIAVprPELrWnJBzdZpuF97WCeL-ij8TPZPQvPYrxpu6Qh64hAcbun0zPqLXk7iPcCeEeuED0NZmUaXYx';

const popular = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
const existingNames = new Set(popular.map(r => (r.name || '').toLowerCase().trim()));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// NYC neighborhoods/areas to search
const AREAS = [
  // Manhattan
  { name: 'Lower East Side', lat: 40.7185, lng: -73.9842 },
  { name: 'East Village', lat: 40.7265, lng: -73.9815 },
  { name: 'West Village', lat: 40.7338, lng: -74.0027 },
  { name: 'SoHo', lat: 40.7233, lng: -73.9985 },
  { name: 'Tribeca', lat: 40.7163, lng: -74.0086 },
  { name: 'Chelsea', lat: 40.7465, lng: -74.0014 },
  { name: 'Midtown East', lat: 40.7549, lng: -73.9712 },
  { name: 'Midtown West', lat: 40.7616, lng: -73.9874 },
  { name: 'Upper West Side', lat: 40.7870, lng: -73.9754 },
  { name: 'Upper East Side', lat: 40.7736, lng: -73.9566 },
  { name: 'Harlem', lat: 40.8116, lng: -73.9465 },
  { name: 'Washington Heights', lat: 40.8417, lng: -73.9394 },
  { name: 'Chinatown', lat: 40.7158, lng: -73.9970 },
  { name: 'NoMad/Flatiron', lat: 40.7440, lng: -73.9882 },
  { name: 'Murray Hill/Gramercy', lat: 40.7478, lng: -73.9787 },
  { name: 'Financial District', lat: 40.7075, lng: -74.0089 },
  // Brooklyn
  { name: 'Williamsburg', lat: 40.7081, lng: -73.9571 },
  { name: 'Park Slope', lat: 40.6710, lng: -73.9814 },
  { name: 'DUMBO', lat: 40.7033, lng: -73.9881 },
  { name: 'Bushwick', lat: 40.6944, lng: -73.9213 },
  { name: 'Prospect Heights', lat: 40.6775, lng: -73.9692 },
  { name: 'Carroll Gardens/Cobble Hill', lat: 40.6840, lng: -73.9967 },
  { name: 'Crown Heights', lat: 40.6694, lng: -73.9422 },
  { name: 'Greenpoint', lat: 40.7282, lng: -73.9542 },
  { name: 'Bed-Stuy', lat: 40.6872, lng: -73.9418 },
  { name: 'Fort Greene', lat: 40.6882, lng: -73.9742 },
  // Queens
  { name: 'Astoria', lat: 40.7723, lng: -73.9301 },
  { name: 'Long Island City', lat: 40.7447, lng: -73.9485 },
  { name: 'Jackson Heights', lat: 40.7557, lng: -73.8831 },
  { name: 'Flushing', lat: 40.7654, lng: -73.8318 },
  { name: 'Forest Hills', lat: 40.7185, lng: -73.8448 },
  // Bronx
  { name: 'Arthur Avenue/Belmont', lat: 40.8554, lng: -73.8882 },
  // Jersey side
  { name: 'Hoboken', lat: 40.7440, lng: -74.0324 },
  { name: 'Jersey City', lat: 40.7178, lng: -74.0431 },
];

// Cuisine categories to search
const CUISINES = [
  'italian', 'japanese', 'mexican', 'chinese', 'thai', 'indian',
  'french', 'korean', 'mediterranean', 'seafood', 'steakhouses',
  'sushi', 'peruvian', 'ethiopian', 'caribbean', 'greek',
  'vietnamese', 'turkish', 'colombian', 'brazilian',
  'newamerican', 'tradamerican', 'spanish', 'mideastern'
];

const searchAreas = QUICK ? AREAS.slice(0, 5) : AREAS;

// ═══════════════════════════════════════════
// YELP API
// ═══════════════════════════════════════════

async function yelpSearch(params) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.yelp.com/v3/businesses/search?${qs}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${YELP_KEY}`,
        'Accept': 'application/json',
      }
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`  Yelp API error ${resp.status}: ${err.slice(0, 100)}`);
      return [];
    }

    const data = await resp.json();
    return data.businesses || [];
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  const allFound = new Map(); // name -> restaurant data (dedup by name)
  let apiCalls = 0;

  console.log(`\n🔍 YELP RESTAURANT DISCOVERY`);
  console.log(`${'='.repeat(50)}`);
  console.log(`📊 Existing restaurants: ${popular.length}`);
  console.log(`📊 Searching ${searchAreas.length} areas\n`);

  // Search each area with general "restaurants" query
  for (let i = 0; i < searchAreas.length; i++) {
    const area = searchAreas[i];
    process.stdout.write(`  [${i+1}/${searchAreas.length}] ${area.name}...`);

    const results = await yelpSearch({
      term: 'restaurants',
      latitude: area.lat,
      longitude: area.lng,
      radius: 1500, // 1.5km radius
      sort_by: 'rating',
      limit: 50,
      categories: 'restaurants',
    });
    apiCalls++;

    let newCount = 0;
    for (const biz of results) {
      // Filter: must be a restaurant, 4.0+ rating, 50+ reviews
      if (biz.rating < 4.0) continue;
      if (biz.review_count < 50) continue;
      if (biz.is_closed) continue;

      // Skip if transactions suggest non-sitdown (only delivery/pickup)
      // Keep if has restaurant_reservation or none specified

      const name = biz.name;
      const nameLower = name.toLowerCase().trim();

      // Skip if already in our database
      if (existingNames.has(nameLower)) continue;

      // Skip duplicates from other areas
      if (allFound.has(nameLower)) continue;

      // Skip junk keywords
      const junk = ['pizza', 'cafe', 'café', 'coffee', 'deli', 'diner', 'bakery',
        'market', 'grocery', 'bodega', 'truck', 'cart', 'halal food',
        'bubble tea', 'boba', 'juice', 'smoothie'];
      if (junk.some(kw => nameLower.includes(kw))) continue;

      allFound.set(nameLower, {
        name,
        yelpRating: biz.rating,
        yelpReviewCount: biz.review_count,
        address: biz.location?.display_address?.join(', ') || '',
        lat: biz.coordinates?.latitude,
        lng: biz.coordinates?.longitude,
        categories: (biz.categories || []).map(c => c.title).join(', '),
        yelpUrl: biz.url,
        phone: biz.phone,
        price: biz.price || '',
        neighborhood: area.name,
        transactions: biz.transactions || [],
      });
      newCount++;
    }

    console.log(` ${results.length} results, ${newCount} new`);
    await sleep(300); // Yelp rate limit: ~5 req/sec
  }

  // Also search by top cuisines in all of NYC
  console.log(`\n📊 Searching by cuisine type...\n`);
  for (let i = 0; i < CUISINES.length; i++) {
    const cuisine = CUISINES[i];
    process.stdout.write(`  [${i+1}/${CUISINES.length}] ${cuisine}...`);

    const results = await yelpSearch({
      term: cuisine + ' restaurant',
      location: 'New York City, NY',
      sort_by: 'rating',
      limit: 50,
      categories: 'restaurants',
    });
    apiCalls++;

    let newCount = 0;
    for (const biz of results) {
      if (biz.rating < 4.0 || biz.review_count < 50 || biz.is_closed) continue;

      const nameLower = biz.name.toLowerCase().trim();
      if (existingNames.has(nameLower) || allFound.has(nameLower)) continue;

      const junk = ['pizza', 'cafe', 'café', 'coffee', 'deli', 'diner', 'bakery',
        'market', 'grocery', 'bodega', 'truck', 'cart', 'halal food',
        'bubble tea', 'boba', 'juice', 'smoothie'];
      if (junk.some(kw => nameLower.includes(kw))) continue;

      allFound.set(nameLower, {
        name: biz.name,
        yelpRating: biz.rating,
        yelpReviewCount: biz.review_count,
        address: biz.location?.display_address?.join(', ') || '',
        lat: biz.coordinates?.latitude,
        lng: biz.coordinates?.longitude,
        categories: (biz.categories || []).map(c => c.title).join(', '),
        yelpUrl: biz.url,
        phone: biz.phone,
        price: biz.price || '',
        neighborhood: 'cuisine search: ' + cuisine,
        transactions: biz.transactions || [],
      });
      newCount++;
    }

    console.log(` ${results.length} results, ${newCount} new`);
    await sleep(300);
  }

  // Sort by review count
  const discoveries = [...allFound.values()]
    .sort((a, b) => b.yelpReviewCount - a.yelpReviewCount);

  // Separate ones with reservation capability
  const withReservation = discoveries.filter(d =>
    d.transactions.includes('restaurant_reservation'));
  const withoutReservation = discoveries.filter(d =>
    !d.transactions.includes('restaurant_reservation'));

  // Save results
  const outputFile = path.join(__dirname, 'yelp-discoveries.json');
  fs.writeFileSync(outputFile, JSON.stringify(discoveries, null, 2));

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes (${apiCalls} API calls)`);
  console.log(`\n📊 Results:`);
  console.log(`  Total new restaurants found: ${discoveries.length}`);
  console.log(`  With reservation capability: ${withReservation.length}`);
  console.log(`  Without reservation: ${withoutReservation.length}`);

  if (withReservation.length) {
    console.log(`\n🎯 TOP NEW RESTAURANTS WITH RESERVATIONS:`);
    for (const r of withReservation.slice(0, 20)) {
      console.log(`  ${r.name} (${r.yelpRating}⭐, ${r.yelpReviewCount} reviews) — ${r.categories}`);
      console.log(`    ${r.address}`);
    }
  }

  console.log(`\n📋 TOP NEW RESTAURANTS (all):`);
  for (const r of discoveries.slice(0, 30)) {
    const res = r.transactions.includes('restaurant_reservation') ? ' 🎫' : '';
    console.log(`  ${r.name} (${r.yelpRating}⭐, ${r.yelpReviewCount} reviews)${res} — ${r.categories}`);
  }

  console.log(`\n💾 Full list saved to: yelp-discoveries.json`);
  console.log(`📋 Next: Review the list, then add promising ones to popular_nyc.json`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
