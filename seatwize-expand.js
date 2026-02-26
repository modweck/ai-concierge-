#!/usr/bin/env node
/**
 * SEATWIZE RESTAURANT EXPANDER
 * ============================
 * 
 * One script to do it all:
 *   STEP 1: Discover new NYC restaurants via Google Places API (multiple area searches)
 *   STEP 2: Filter out junk (food trucks, delis, chains, fast food)
 *   STEP 3: Check Resy for booking links on all new restaurants
 *   STEP 4: Run availability checks on restaurants with Resy links
 *   STEP 5: Update booking_lookup.json, popular_nyc.json, and availability_data.json
 *
 * RUN:
 *   cd ~/ai-concierge-
 *   GOOGLE_PLACES_API_KEY=YOUR_KEY node seatwize-expand.js
 *
 * OPTIONS:
 *   --skip-discover     Skip Google Places discovery (use existing data)
 *   --skip-resy         Skip Resy link lookup
 *   --skip-availability Skip availability checks
 *   --quick             Only process 20 restaurants per step (for testing)
 *   --date 2026-03-01   Date for availability check (default: tomorrow)
 *   --party 2           Party size (default: 2)
 */

const fs = require('fs');
const path = require('path');

// ── Config ──
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const SKIP_DISCOVER = args.includes('--skip-discover');
const SKIP_RESY = args.includes('--skip-resy');
const SKIP_AVAILABILITY = args.includes('--skip-availability');
const QUICK = args.includes('--quick');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const CHECK_DATE = getArg('date', tomorrow.toISOString().split('T')[0]);

const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY && !SKIP_DISCOVER) {
  console.error('❌ Set GOOGLE_PLACES_API_KEY environment variable');
  process.exit(1);
}

// ── File paths (run from repo root) ──
const POPULAR_FILE = path.join(__dirname, 'popular_nyc.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const GOOGLE_FILE = path.join(__dirname, 'google_restaurants.json');
const AVAIL_FILE = path.join(__dirname, 'availability_data.json');
const RESULTS_FILE = path.join(__dirname, 'expand-results.json');

// ── Load existing data ──
let POPULAR = []; try { POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8')); } catch(e) { console.log('⚠️  No popular_nyc.json found'); }
let BOOKING = {}; try { BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); } catch(e) { console.log('⚠️  No booking_lookup.json found'); }
let GOOGLE_REST = []; try { GOOGLE_REST = JSON.parse(fs.readFileSync(GOOGLE_FILE, 'utf8')); } catch(e) { console.log('⚠️  No google_restaurants.json found'); }
let AVAIL_DATA = {}; try { AVAIL_DATA = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); } catch(e) {}

// Build name sets for dedup
const existingNames = new Set();
for (const r of POPULAR) { if (r.name) existingNames.add(r.name.toLowerCase().trim()); }
for (const r of GOOGLE_REST) { if (r.name) existingNames.add(r.name.toLowerCase().trim()); }
for (const k of Object.keys(BOOKING)) { existingNames.add(k.toLowerCase().trim()); }

console.log(`\n🍽️  SEATWIZE RESTAURANT EXPANDER`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Existing data: ${POPULAR.length} popular, ${Object.keys(BOOKING).length} bookings, ${GOOGLE_REST.length} google`);
console.log(`📊 Known names: ${existingNames.size}`);

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Junk filter — exclude food trucks, delis, chains, fast food, etc.
const JUNK_PATTERNS = [
  /food\s*truck/i, /food\s*cart/i, /food\s*stand/i, /hot\s*dog/i,
  /pizza\s*hut/i, /domino/i, /papa\s*john/i, /little\s*caesars/i,
  /mcdonald/i, /burger\s*king/i, /wendy/i, /taco\s*bell/i, /kfc/i,
  /chick-fil-a/i, /popeyes/i, /five\s*guys/i, /shake\s*shack/i,
  /chipotle/i, /panera/i, /subway(?!\s*(inn|club))/i, /dunkin/i,
  /starbucks/i, /pret\s*a\s*manger/i, /sweetgreen/i, /cava\b/i,
  /\bdeli\b.*\bcatering\b/i, /\bgrocery\b/i, /\bmarket\b(?!.*\b(restaurant|kitchen|bar|grill|bistro|cafe|eatery|table|dining)\b)/i,
  /\bbodega\b/i, /\bconvenience\b/i, /\bgas\s*station/i,
  /\bpharma/i, /\bwalgreens/i, /\bcvs\b/i,
  /applebee/i, /olive\s*garden/i, /red\s*lobster/i, /chili'?s\s*grill/i,
  /ihop\b/i, /denny'?s\b/i, /waffle\s*house/i, /cracker\s*barrel/i,
  /t\.?g\.?i\.?\s*friday/i, /outback\s*steak/i, /buffalo\s*wild/i,
  /cheesecake\s*factory/i, /p\.?f\.?\s*chang/i,
  /halal\s*(cart|guys|stand)/i, /street\s*meat/i,
  /\bcatering\b(?!.*\b(restaurant|kitchen|bar|grill|bistro)\b)/i,
  /\bbakery\b(?!.*\b(cafe|restaurant|bistro)\b)/i,
  /\bjuice\s*bar\b/i, /\bsmoothie/i, /\bboba\b/i, /\bbubble\s*tea\b/i,
  /\bice\s*cream\b(?!.*\b(restaurant|parlor|cafe)\b)/i,
  /7-?eleven/i, /wawa\b/i, /\bcostco\b/i, /\bwalmart/i, /\btarget\b/i
];

const JUNK_TYPES = new Set([
  'gas_station', 'convenience_store', 'grocery_or_supermarket', 
  'drugstore', 'pharmacy', 'supermarket', 'department_store',
  'shopping_mall', 'clothing_store', 'hardware_store',
  'lodging', 'hotel'  // hotels sometimes show up
]);

function isJunk(restaurant) {
  const name = restaurant.name || '';
  const types = restaurant.types || [];
  
  // Check name against junk patterns
  for (const pat of JUNK_PATTERNS) {
    if (pat.test(name)) return true;
  }
  
  // Check Google types
  for (const t of types) {
    if (JUNK_TYPES.has(t)) return true;
  }
  
  return false;
}

function isQuality(r) {
  const rating = r.rating || r.googleRating || 0;
  const reviews = r.user_ratings_total || r.googleReviewCount || 0;
  // 4.0+ with 50+ reviews, or 4.4+ with any reviews
  return (rating >= 4.0 && reviews >= 50) || (rating >= 4.4 && reviews >= 20);
}

// ════════════════════════════════════════════════════════════════
// STEP 1: DISCOVER NEW RESTAURANTS VIA GOOGLE PLACES
// ════════════════════════════════════════════════════════════════

// NYC area search grid — covers Manhattan, Brooklyn, Queens, Bronx, Staten Island
const SEARCH_AREAS = [
  // Manhattan
  { lat: 40.7580, lng: -73.9855, radius: 3000, label: 'Midtown' },
  { lat: 40.7282, lng: -73.9942, radius: 3000, label: 'Greenwich/Soho' },
  { lat: 40.7105, lng: -73.9975, radius: 3000, label: 'Lower Manhattan' },
  { lat: 40.7831, lng: -73.9712, radius: 3000, label: 'Upper West Side' },
  { lat: 40.7736, lng: -73.9566, radius: 3000, label: 'Upper East Side' },
  { lat: 40.7955, lng: -73.9370, radius: 3000, label: 'East Harlem/UES North' },
  { lat: 40.8116, lng: -73.9465, radius: 3000, label: 'Harlem' },
  { lat: 40.8400, lng: -73.9400, radius: 3000, label: 'Washington Heights' },
  // Brooklyn
  { lat: 40.6892, lng: -73.9857, radius: 3000, label: 'Downtown Brooklyn' },
  { lat: 40.6782, lng: -73.9442, radius: 3000, label: 'Crown Heights/Bed-Stuy' },
  { lat: 40.6880, lng: -73.9750, radius: 3000, label: 'Cobble Hill/Carroll Gardens' },
  { lat: 40.7081, lng: -73.9571, radius: 3000, label: 'Williamsburg' },
  { lat: 40.6782, lng: -73.9785, radius: 3000, label: 'Park Slope' },
  { lat: 40.6340, lng: -74.0280, radius: 3000, label: 'Bay Ridge' },
  { lat: 40.6520, lng: -73.9600, radius: 3000, label: 'Flatbush/Prospect Park South' },
  // Queens
  { lat: 40.7433, lng: -73.9230, radius: 3000, label: 'Long Island City/Astoria' },
  { lat: 40.7560, lng: -73.9050, radius: 3000, label: 'Astoria North' },
  { lat: 40.7282, lng: -73.8930, radius: 3000, label: 'Jackson Heights/Elmhurst' },
  { lat: 40.7580, lng: -73.8300, radius: 3000, label: 'Flushing' },
  { lat: 40.7110, lng: -73.8520, radius: 3000, label: 'Forest Hills' },
  // Bronx
  { lat: 40.8448, lng: -73.8648, radius: 3000, label: 'South Bronx/Mott Haven' },
  { lat: 40.8610, lng: -73.8900, radius: 3000, label: 'Fordham/Arthur Ave' },
  // Jersey City (bonus — close enough)
  { lat: 40.7178, lng: -74.0431, radius: 3000, label: 'Jersey City' },
];

// Cuisine-specific searches to find hidden gems
const CUISINE_SEARCHES = [
  'best omakase restaurant',
  'best Italian restaurant',
  'best Thai restaurant',
  'best Korean restaurant',
  'best Mexican restaurant',
  'best Indian restaurant',
  'best French restaurant',
  'best Ethiopian restaurant',
  'best Greek restaurant',
  'best Vietnamese restaurant',
  'best Peruvian restaurant',
  'best Turkish restaurant',
  'best Georgian restaurant',
  'best Uzbek restaurant',
  'fine dining restaurant',
  'tasting menu restaurant',
  'Michelin restaurant',
  'popular brunch restaurant',
  'rooftop restaurant',
  'steakhouse',
];

async function googleTextSearch(query, location, radius) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${location.lat},${location.lng}&radius=${radius}&type=restaurant&key=${KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.log(`  ⚠️  Google API: ${data.status} for "${query}"`);
  }
  return data.results || [];
}

async function googleNearbySearch(lat, lng, radius) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  let results = data.results || [];
  
  // Get page 2 if available
  if (data.next_page_token) {
    await sleep(2000); // Google requires 2s delay for next_page_token
    const url2 = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${data.next_page_token}&key=${KEY}`;
    const resp2 = await fetch(url2);
    const data2 = await resp2.json();
    results = results.concat(data2.results || []);
    
    // Get page 3 if available
    if (data2.next_page_token) {
      await sleep(2000);
      const url3 = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${data2.next_page_token}&key=${KEY}`;
      const resp3 = await fetch(url3);
      const data3 = await resp3.json();
      results = results.concat(data3.results || []);
    }
  }
  
  return results;
}

async function discoverRestaurants() {
  console.log(`\n📡 STEP 1: Discovering restaurants via Google Places API...`);
  
  const allDiscovered = new Map(); // place_id -> restaurant
  
  // Phase 1: Nearby search across NYC grid
  console.log(`\n  Phase 1: Area-based nearby search (${SEARCH_AREAS.length} areas)...`);
  for (let i = 0; i < SEARCH_AREAS.length; i++) {
    const area = SEARCH_AREAS[i];
    if (QUICK && i >= 3) { console.log(`  ⏭️  Quick mode — skipping remaining areas`); break; }
    
    process.stdout.write(`  [${i+1}/${SEARCH_AREAS.length}] ${area.label}...`);
    try {
      const results = await googleNearbySearch(area.lat, area.lng, area.radius);
      let newCount = 0;
      for (const r of results) {
        if (r.place_id && !allDiscovered.has(r.place_id)) {
          allDiscovered.set(r.place_id, r);
          newCount++;
        }
      }
      console.log(` ${results.length} found, ${newCount} new`);
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
    await sleep(200);
  }
  
  // Phase 2: Cuisine-specific text searches in key areas
  console.log(`\n  Phase 2: Cuisine-specific searches (${CUISINE_SEARCHES.length} queries)...`);
  const searchCenter = { lat: 40.7484, lng: -73.9857 }; // Midtown as center
  for (let i = 0; i < CUISINE_SEARCHES.length; i++) {
    const query = CUISINE_SEARCHES[i];
    if (QUICK && i >= 5) { console.log(`  ⏭️  Quick mode — skipping remaining cuisines`); break; }
    
    process.stdout.write(`  [${i+1}/${CUISINE_SEARCHES.length}] "${query} NYC"...`);
    try {
      const results = await googleTextSearch(query + ' NYC', searchCenter, 15000);
      let newCount = 0;
      for (const r of results) {
        if (r.place_id && !allDiscovered.has(r.place_id)) {
          allDiscovered.set(r.place_id, r);
          newCount++;
        }
      }
      console.log(` ${results.length} found, ${newCount} new`);
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
    await sleep(300);
  }
  
  console.log(`\n  📊 Total discovered: ${allDiscovered.size} unique restaurants`);
  return Array.from(allDiscovered.values());
}


// ════════════════════════════════════════════════════════════════
// STEP 2: FILTER OUT JUNK
// ════════════════════════════════════════════════════════════════

function filterRestaurants(discovered) {
  console.log(`\n🧹 STEP 2: Filtering out junk & known restaurants...`);
  
  let filtered = [];
  let junkCount = 0;
  let knownCount = 0;
  let lowQualityCount = 0;
  
  for (const r of discovered) {
    const name = (r.name || '').toLowerCase().trim();
    
    // Skip already known
    if (existingNames.has(name)) { knownCount++; continue; }
    
    // Skip junk
    if (isJunk(r)) { junkCount++; continue; }
    
    // Skip low quality
    if (!isQuality(r)) { lowQualityCount++; continue; }
    
    filtered.push({
      name: r.name,
      place_id: r.place_id,
      address: r.formatted_address || r.vicinity || '',
      lat: r.geometry?.location?.lat || null,
      lng: r.geometry?.location?.lng || null,
      rating: r.rating || 0,
      reviews: r.user_ratings_total || 0,
      types: r.types || [],
      price_level: r.price_level || null
    });
  }
  
  console.log(`  ❌ Junk removed: ${junkCount}`);
  console.log(`  ✅ Already known: ${knownCount}`);
  console.log(`  📉 Low quality: ${lowQualityCount}`);
  console.log(`  🆕 New quality candidates: ${filtered.length}`);
  
  // Sort by rating * log(reviews) — best restaurants first
  filtered.sort((a, b) => {
    const sa = a.rating * Math.log10(Math.max(a.reviews, 1));
    const sb = b.rating * Math.log10(Math.max(b.reviews, 1));
    return sb - sa;
  });
  
  return filtered;
}


// ════════════════════════════════════════════════════════════════
// STEP 3: CHECK RESY FOR BOOKING LINKS
// ════════════════════════════════════════════════════════════════

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*'
};

async function findResyLink(restaurantName, lat, lng) {
  // Try Resy search API to find the restaurant
  try {
    // Method 1: Search by name + location
    const searchUrl = `https://api.resy.com/3/venuesearch/search?query=${encodeURIComponent(restaurantName)}&lat=${lat || 40.7128}&long=${lng || -74.006}&per_page=5`;
    const resp = await fetch(searchUrl, { headers: RESY_HEADERS });
    
    if (resp.ok) {
      const data = await resp.json();
      const hits = data?.search?.hits || [];
      
      // Find best match by name
      const nameLower = restaurantName.toLowerCase().trim();
      for (const hit of hits) {
        const hitName = (hit.name || '').toLowerCase().trim();
        // Exact or close match
        if (hitName === nameLower || 
            hitName.includes(nameLower) || 
            nameLower.includes(hitName) ||
            levenshteinClose(hitName, nameLower)) {
          const slug = hit.url_slug || hit.slug || '';
          const location = hit.location?.code || 'ny';
          if (slug) {
            return {
              found: true,
              platform: 'resy',
              url: `https://resy.com/cities/${location}/${slug}`,
              slug: slug,
              venue_id: hit.id?.resy || null,
              resy_name: hit.name
            };
          }
        }
      }
    }
    
    // Method 2: Try guessing the slug
    const guessSlug = restaurantName.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    
    const venueUrl = `https://api.resy.com/3/venue?url_slug=${guessSlug}&location=ny`;
    const venueResp = await fetch(venueUrl, { headers: RESY_HEADERS });
    
    if (venueResp.ok) {
      const venueData = await venueResp.json();
      if (venueData?.id?.resy) {
        return {
          found: true,
          platform: 'resy',
          url: `https://resy.com/cities/ny/${guessSlug}`,
          slug: guessSlug,
          venue_id: venueData.id.resy,
          resy_name: venueData.name
        };
      }
    }
    
    return { found: false };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

function levenshteinClose(a, b) {
  // Simple check — if >80% of words overlap, consider it close
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return overlap / Math.min(wordsA.size, wordsB.size) >= 0.6;
}

async function checkResyLinks(candidates) {
  console.log(`\n🔍 STEP 3: Checking Resy for ${candidates.length} restaurants...`);
  
  const withResy = [];
  const noResy = [];
  const limit = QUICK ? 20 : candidates.length;
  
  for (let i = 0; i < Math.min(limit, candidates.length); i++) {
    const r = candidates[i];
    process.stdout.write(`  [${i+1}/${Math.min(limit, candidates.length)}] ${r.name}...`);
    
    const result = await findResyLink(r.name, r.lat, r.lng);
    
    if (result.found) {
      console.log(` ✅ ${result.url}`);
      withResy.push({ ...r, resy: result });
    } else {
      console.log(` ❌ Not on Resy`);
      noResy.push(r);
    }
    
    await sleep(500); // Be nice to Resy API
  }
  
  console.log(`\n  📊 Resy results: ${withResy.length} found, ${noResy.length} not found`);
  return { withResy, noResy };
}


// ════════════════════════════════════════════════════════════════
// STEP 4: CHECK AVAILABILITY FOR RESY RESTAURANTS
// ════════════════════════════════════════════════════════════════

async function checkAvailability(restaurant, date, partySize) {
  const slug = restaurant.resy?.slug;
  const venueId = restaurant.resy?.venue_id;
  if (!slug && !venueId) return null;
  
  try {
    let availUrl;
    if (venueId) {
      availUrl = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`;
    } else {
      availUrl = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&slug=${slug}&location=ny`;
    }
    
    const resp = await fetch(availUrl, { headers: RESY_HEADERS });
    if (!resp.ok) return { error: `http_${resp.status}`, is_available: false, total_slots: 0 };
    
    const data = await resp.json();
    const venues = data?.results?.venues || [];
    if (!venues.length) return { is_available: false, total_slots: 0, slots: [] };
    
    const slots = (venues[0]?.slots || []).map(s => ({
      time: s.date?.start || '',
      type: s.config?.type || 'dining_room'
    }));
    
    // Categorize by time window
    const earlySlots = slots.filter(s => {
      const h = getHour24(s.time);
      return h >= 11 && h < 17;
    });
    const primeSlots = slots.filter(s => {
      const h = getHour24(s.time);
      return h >= 18 && h <= 20;
    });
    const lateSlots = slots.filter(s => {
      const h = getHour24(s.time);
      return h >= 21;
    });
    
    return {
      date,
      party_size: partySize,
      total_slots: slots.length,
      is_available: slots.length > 0,
      early_slots: earlySlots.length,
      prime_slots: primeSlots.length,
      late_slots: lateSlots.length,
      sample_times: slots.slice(0, 8).map(s => s.time),
      error: null
    };
  } catch (e) {
    return { error: e.message, is_available: false, total_slots: 0 };
  }
}

function getHour24(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  let h = parseInt(match[1]);
  if (timeStr.toLowerCase().includes('pm') && h !== 12) h += 12;
  if (timeStr.toLowerCase().includes('am') && h === 12) h = 0;
  // If it looks like 24h format already
  if (h >= 0 && h <= 23) return h;
  return 0;
}

async function runAvailabilityChecks(resyRestaurants) {
  console.log(`\n⏰ STEP 4: Checking availability for ${resyRestaurants.length} Resy restaurants (date: ${CHECK_DATE})...`);
  
  const results = [];
  const limit = QUICK ? 20 : resyRestaurants.length;
  
  for (let i = 0; i < Math.min(limit, resyRestaurants.length); i++) {
    const r = resyRestaurants[i];
    process.stdout.write(`  [${i+1}/${Math.min(limit, resyRestaurants.length)}] ${r.name}...`);
    
    const avail = await checkAvailability(r, CHECK_DATE, PARTY_SIZE);
    
    if (avail && avail.is_available) {
      console.log(` ✅ ${avail.total_slots} slots (${avail.prime_slots} prime)`);
    } else if (avail) {
      console.log(` ❌ No availability (${avail.error || 'sold out'})`);
    } else {
      console.log(` ⚠️  Could not check`);
    }
    
    results.push({ ...r, availability: avail });
    await sleep(1000); // Be nice to Resy
  }
  
  return results;
}


// ════════════════════════════════════════════════════════════════
// STEP 5: UPDATE DATA FILES
// ════════════════════════════════════════════════════════════════

function updateDataFiles(resyRestaurants, allCandidates) {
  console.log(`\n💾 STEP 5: Updating data files...`);
  
  let bookingAdded = 0;
  let popularAdded = 0;
  let availAdded = 0;
  
  for (const r of resyRestaurants) {
    const nameLower = r.name.toLowerCase().trim();
    
    // Update booking_lookup.json
    if (!BOOKING[nameLower] && r.resy?.url) {
      BOOKING[nameLower] = {
        platform: 'resy',
        url: r.resy.url
      };
      bookingAdded++;
    }
    
    // Update popular_nyc.json
    const alreadyInPopular = POPULAR.some(p => 
      (p.name || '').toLowerCase().trim() === nameLower ||
      (p.place_id && p.place_id === r.place_id)
    );
    
    if (!alreadyInPopular && r.place_id) {
      POPULAR.push({
        name: r.name,
        place_id: r.place_id,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        googleRating: r.rating,
        googleReviewCount: r.reviews,
        price_level: r.price_level,
        source: 'expand_script',
        added_date: new Date().toISOString().split('T')[0]
      });
      popularAdded++;
    }
    
    // Update availability_data.json
    if (r.availability && r.availability.is_available) {
      AVAIL_DATA[nameLower] = {
        ...r.availability,
        last_checked: new Date().toISOString(),
        source_platform: 'resy'
      };
      availAdded++;
    }
  }
  
  // Save files
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(BOOKING, null, 2));
  console.log(`  📝 booking_lookup.json: +${bookingAdded} entries (total: ${Object.keys(BOOKING).length})`);
  
  fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));
  console.log(`  📝 popular_nyc.json: +${popularAdded} entries (total: ${POPULAR.length})`);
  
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL_DATA, null, 2));
  console.log(`  📝 availability_data.json: +${availAdded} entries`);
  
  // Save detailed results for review
  const report = {
    run_date: new Date().toISOString(),
    summary: {
      total_discovered: allCandidates.length,
      resy_found: resyRestaurants.length,
      booking_added: bookingAdded,
      popular_added: popularAdded,
      availability_added: availAdded
    },
    resy_restaurants: resyRestaurants.map(r => ({
      name: r.name,
      rating: r.rating,
      reviews: r.reviews,
      resy_url: r.resy?.url,
      available: r.availability?.is_available || false,
      prime_slots: r.availability?.prime_slots || 0,
      total_slots: r.availability?.total_slots || 0
    })),
    candidates_without_resy: allCandidates
      .filter(c => !resyRestaurants.some(r => r.place_id === c.place_id))
      .slice(0, 200)
      .map(c => ({ name: c.name, rating: c.rating, reviews: c.reviews, address: c.address }))
  };
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2));
  console.log(`  📝 expand-results.json: Full report saved`);
}


// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  
  let candidates;
  
  // STEP 1: Discover
  if (SKIP_DISCOVER) {
    // Try to load from previous run
    try {
      const prev = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      candidates = prev.candidates_without_resy || [];
      console.log(`\n⏭️  Skipping discovery — loaded ${candidates.length} candidates from previous run`);
    } catch {
      console.log('\n❌ No previous results found. Remove --skip-discover to run discovery.');
      return;
    }
  } else {
    const discovered = await discoverRestaurants();
    candidates = filterRestaurants(discovered);
  }
  
  if (!candidates.length) {
    console.log('\n🎉 No new restaurants to process!');
    return;
  }
  
  // Also add the 81 + 107 we already found from the missing analysis
  // (if those files exist from the previous session)
  try {
    const missingResy = JSON.parse(fs.readFileSync(path.join(__dirname, 'missing_resy_ot.json'), 'utf8'));
    const missingGoogle = JSON.parse(fs.readFileSync(path.join(__dirname, 'missing_quality_google.json'), 'utf8'));
    
    const existingPlaceIds = new Set(candidates.map(c => c.place_id).filter(Boolean));
    const existingCandNames = new Set(candidates.map(c => (c.name||'').toLowerCase().trim()));
    
    let injected = 0;
    for (const r of [...missingResy, ...missingGoogle]) {
      const n = (r.name || '').toLowerCase().trim();
      if (!existingCandNames.has(n) && !existingNames.has(n)) {
        candidates.push({
          name: r.name,
          place_id: null,
          address: r.address || '',
          lat: null, lng: null,
          rating: r.rating || 0,
          reviews: r.reviews || 0,
          types: [],
          price_level: null
        });
        existingCandNames.add(n);
        injected++;
      }
    }
    if (injected) console.log(`\n  📎 Also added ${injected} restaurants from previous missing analysis`);
  } catch {}
  
  // STEP 3: Check Resy links
  let withResy = [];
  if (SKIP_RESY) {
    console.log(`\n⏭️  Skipping Resy check`);
  } else {
    const resyResults = await checkResyLinks(candidates);
    withResy = resyResults.withResy;
  }
  
  // STEP 4: Availability
  if (SKIP_AVAILABILITY || withResy.length === 0) {
    if (withResy.length === 0) console.log(`\n⏭️  No Resy restaurants to check availability for`);
    else console.log(`\n⏭️  Skipping availability checks`);
  } else {
    withResy = await runAvailabilityChecks(withResy);
  }
  
  // STEP 5: Update files
  updateDataFiles(withResy, candidates);
  
  // Summary
  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes`);
  console.log(`\n📋 NEXT STEPS:`);
  console.log(`  1. Review expand-results.json for the full report`);
  console.log(`  2. git add -A && git commit -m "Add new restaurants from expand script" && git push`);
  console.log(`  3. Check your site after deploy\n`);
}

main().catch(e => { console.error('❌ Fatal error:', e); process.exit(1); });
