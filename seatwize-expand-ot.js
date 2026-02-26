#!/usr/bin/env node
/**
 * SEATWIZE OPENTABLE EXPANDER
 * ============================
 * 
 * Finds OpenTable links for restaurants not already on Resy.
 * Uses the expand-results.json from the Resy script, plus
 * scans existing popular_nyc entries that lack booking links.
 *
 * HOW IT WORKS:
 *   1. Loads candidates (from expand-results.json + popular_nyc without bookings)
 *   2. Tries multiple OT slug patterns for each restaurant
 *   3. Confirms by hitting the OT page and extracting restaurant ID
 *   4. Checks availability for confirmed restaurants
 *   5. Updates booking_lookup.json and availability_data.json
 *
 * RUN:
 *   cd ~/ai-concierge-
 *   node seatwize-expand-ot.js
 *
 * OPTIONS:
 *   --quick             Only process 30 restaurants (for testing)
 *   --skip-availability Skip availability checks
 *   --date 2026-03-01   Date for availability (default: tomorrow)
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
const QUICK = args.includes('--quick');
const SKIP_AVAILABILITY = args.includes('--skip-availability');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const CHECK_DATE = getArg('date', tomorrow.toISOString().split('T')[0]);

// ── File paths ──
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');
const GOOGLE_FILE = path.join(FUNC_DIR, 'google_restaurants.json');
const AVAIL_FILE = path.join(FUNC_DIR, 'availability_data.json');
const EXPAND_RESULTS = path.join(__dirname, 'expand-results.json');
const OT_RESULTS_FILE = path.join(__dirname, 'expand-results-ot.json');

// ── Load data ──
let POPULAR = []; try { POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8')); } catch(e) { console.log('⚠️  No popular_nyc.json'); }
let BOOKING = {}; try { BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); } catch(e) { console.log('⚠️  No booking_lookup.json'); }
let GOOGLE_REST = []; try { GOOGLE_REST = JSON.parse(fs.readFileSync(GOOGLE_FILE, 'utf8')); } catch(e) {}
let AVAIL_DATA = {}; try { AVAIL_DATA = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); } catch(e) {}
let EXPAND = null; try { EXPAND = JSON.parse(fs.readFileSync(EXPAND_RESULTS, 'utf8')); } catch(e) {}

// Build set of restaurants that already have bookings
const hasBooking = new Set();
for (const [k, v] of Object.entries(BOOKING)) {
  hasBooking.add(k.toLowerCase().trim());
}

console.log(`\n🍽️  SEATWIZE OPENTABLE EXPANDER`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Existing: ${Object.keys(BOOKING).length} bookings (${[...Object.values(BOOKING)].filter(v => v.platform === 'opentable').length} OT), ${POPULAR.length} popular`);
console.log(`📊 Already have booking links: ${hasBooking.size}`);

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Generate OpenTable slug candidates from a restaurant name
function generateOTSlugs(name, address) {
  const base = name.toLowerCase()
    .replace(/['']/g, '')           // remove apostrophes
    .replace(/&/g, 'and')           // & → and
    .replace(/[^a-z0-9\s-]/g, '')   // remove special chars
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse hyphens
    .replace(/^-|-$/g, '');         // trim hyphens

  const slugs = [base];

  // Try with location suffixes
  const locations = ['new-york', 'nyc', 'manhattan', 'brooklyn', 'queens'];
  
  // Extract neighborhood from address
  const neighborhoods = [
    'midtown', 'soho', 'tribeca', 'chelsea', 'village', 'harlem',
    'williamsburg', 'dumbo', 'astoria', 'flushing', 'park-slope',
    'upper-east-side', 'upper-west-side', 'lower-east-side',
    'east-village', 'west-village', 'greenwich-village', 'gramercy',
    'flatiron', 'nomad', 'murray-hill', 'hells-kitchen', 'times-square',
    'financial-district', 'battery-park', 'nolita', 'little-italy',
    'chinatown', 'lower-manhattan', 'downtown', 'uptown',
    'cobble-hill', 'carroll-gardens', 'prospect-heights', 'bay-ridge',
    'long-island-city', 'jackson-heights', 'forest-hills',
    'jersey-city', 'hoboken'
  ];

  for (const loc of locations) {
    slugs.push(`${base}-${loc}`);
  }

  // Try extracting area from address
  if (address) {
    const addrLower = address.toLowerCase();
    for (const n of neighborhoods) {
      if (addrLower.includes(n.replace(/-/g, ' ')) || addrLower.includes(n)) {
        slugs.push(`${base}-${n}`);
      }
    }
  }

  // Common OT patterns: with /r/ prefix format
  // Also try without common suffixes like "restaurant", "nyc", etc.
  const shortened = base
    .replace(/-restaurant$/,'')
    .replace(/-nyc$/,'')
    .replace(/-new-york$/,'')
    .replace(/-bar-and-grill$/,'')
    .replace(/-bar-grill$/,'');
  
  if (shortened !== base) {
    slugs.push(shortened);
    slugs.push(`${shortened}-new-york`);
  }

  // Dedupe
  return [...new Set(slugs)];
}

// Try to find a restaurant on OpenTable by testing slug candidates
async function findOpenTableLink(name, address) {
  const slugs = generateOTSlugs(name, address);
  
  for (const slug of slugs) {
    try {
      // Try /r/ path first (most common)
      const url = `https://www.opentable.com/r/${slug}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow'
      });

      if (resp.ok) {
        const html = await resp.text();
        
        // Verify it's a real restaurant page (not 404 soft redirect)
        if (html.includes('data-restaurant-id') || 
            html.includes('"restaurantId"') || 
            html.includes('rid=') ||
            html.includes('RestaurantProfile') ||
            html.includes('og:type" content="restaurant"')) {
          
          // Extract restaurant ID for availability checks
          let restaurantId = null;
          const m1 = html.match(/data-restaurant-id="(\d+)"/);
          if (m1) restaurantId = m1[1];
          if (!restaurantId) {
            const m2 = html.match(/"rid"\s*:\s*(\d+)/);
            if (m2) restaurantId = m2[1];
          }
          if (!restaurantId) {
            const m3 = html.match(/"restaurantId"\s*:\s*(\d+)/);
            if (m3) restaurantId = m3[1];
          }
          if (!restaurantId) {
            const m4 = html.match(/rid=(\d+)/);
            if (m4) restaurantId = m4[1];
          }

          // Extract the actual restaurant name from the page to verify match
          const titleMatch = html.match(/<title>([^<]+)/);
          const pageTitle = titleMatch ? titleMatch[1] : '';

          return {
            found: true,
            platform: 'opentable',
            url: resp.url || url, // use final URL after redirects
            slug: slug,
            restaurant_id: restaurantId,
            page_title: pageTitle.replace(/ \| OpenTable$/, '').replace(/ - .*$/, '').trim()
          };
        }
      }

      // Try without /r/ prefix
      const url2 = `https://www.opentable.com/${slug}`;
      const resp2 = await fetch(url2, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow'
      });

      if (resp2.ok) {
        const html2 = await resp2.text();
        if (html2.includes('data-restaurant-id') || 
            html2.includes('"restaurantId"') ||
            html2.includes('RestaurantProfile')) {
          
          let restaurantId = null;
          const m = html2.match(/data-restaurant-id="(\d+)"/) || 
                    html2.match(/"rid"\s*:\s*(\d+)/) || 
                    html2.match(/"restaurantId"\s*:\s*(\d+)/) ||
                    html2.match(/rid=(\d+)/);
          if (m) restaurantId = m[1];

          return {
            found: true,
            platform: 'opentable',
            url: resp2.url || url2,
            slug: slug,
            restaurant_id: restaurantId,
            page_title: ''
          };
        }
      }

      await sleep(300); // Be nice between slug attempts
    } catch (e) {
      // Network error, try next slug
      continue;
    }
  }

  return { found: false };
}


// ════════════════════════════════════════════════════════════════
// CHECK OPENTABLE AVAILABILITY
// ════════════════════════════════════════════════════════════════

async function checkOTAvailability(restaurant, date, partySize) {
  const rid = restaurant.ot?.restaurant_id;
  const slug = restaurant.ot?.slug;
  
  if (!rid && !slug) return null;

  try {
    let availUrl;
    if (rid) {
      availUrl = `https://www.opentable.com/dapi/availability?rid=${rid}&partySize=${partySize}&dateTime=${date}T19:00&enableFutureAvailability=true`;
    } else {
      availUrl = `https://www.opentable.com/dapi/availability?name=${slug}&partySize=${partySize}&dateTime=${date}T19:00`;
    }

    const resp = await fetch(availUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': restaurant.ot?.url || 'https://www.opentable.com'
      }
    });

    if (!resp.ok) return { error: `http_${resp.status}`, is_available: false, total_slots: 0 };

    const data = await resp.json();
    const timeSlots = data?.availability?.timeslots || data?.timeslots || [];

    const slots = timeSlots.map(s => ({
      time: s.dateTime || s.time || '',
      type: s.areaName || s.type || 'dining_room'
    }));

    const earlySlots = slots.filter(s => /T1[1-6]:/.test(s.time)).length;
    const primeSlots = slots.filter(s => /T18:|T19:|T20:/.test(s.time)).length;
    const lateSlots = slots.filter(s => /T2[1-3]:/.test(s.time)).length;

    return {
      date, party_size: partySize,
      total_slots: slots.length,
      is_available: slots.length > 0,
      early_slots: earlySlots,
      prime_slots: primeSlots,
      late_slots: lateSlots,
      sample_times: slots.slice(0, 8).map(s => s.time),
      error: null
    };
  } catch (e) {
    return { error: e.message, is_available: false, total_slots: 0 };
  }
}


// ════════════════════════════════════════════════════════════════
// BUILD CANDIDATE LIST
// ════════════════════════════════════════════════════════════════

function buildCandidates() {
  console.log(`\n📋 Building candidate list...`);
  
  const candidates = new Map(); // name_lower -> {name, address, ...}

  // Source 1: expand-results.json — restaurants NOT found on Resy
  if (EXPAND?.candidates_without_resy) {
    for (const r of EXPAND.candidates_without_resy) {
      const key = (r.name || '').toLowerCase().trim();
      if (!key || hasBooking.has(key)) continue;
      candidates.set(key, {
        name: r.name,
        address: r.address || '',
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        source: 'expand_no_resy'
      });
    }
    console.log(`  📎 From expand-results (no Resy): ${candidates.size}`);
  }

  // Source 2: popular_nyc entries without booking links
  let popularAdded = 0;
  for (const r of POPULAR) {
    const key = (r.name || '').toLowerCase().trim();
    if (!key || hasBooking.has(key) || candidates.has(key)) continue;
    candidates.set(key, {
      name: r.name,
      address: r.address || r.formatted_address || '',
      rating: r.googleRating || 0,
      reviews: r.googleReviewCount || 0,
      source: 'popular_no_booking'
    });
    popularAdded++;
  }
  console.log(`  📎 From popular_nyc (no booking): ${popularAdded}`);

  // Source 3: google_restaurants without booking links
  let googleAdded = 0;
  for (const r of GOOGLE_REST) {
    const key = (r.name || '').toLowerCase().trim();
    if (!key || hasBooking.has(key) || candidates.has(key)) continue;
    const rating = r.googleRating || r.rating || 0;
    const reviews = r.googleReviewCount || r.user_ratings_total || 0;
    if (rating < 4.0 || reviews < 50) continue; // quality filter
    candidates.set(key, {
      name: r.name,
      address: r.address || r.formatted_address || '',
      rating: rating,
      reviews: reviews,
      source: 'google_no_booking'
    });
    googleAdded++;
  }
  console.log(`  📎 From google_restaurants (no booking, 4.0+): ${googleAdded}`);

  // Sort by rating * log(reviews) — best first
  const sorted = [...candidates.values()].sort((a, b) => {
    const sa = a.rating * Math.log10(Math.max(a.reviews, 1));
    const sb = b.rating * Math.log10(Math.max(b.reviews, 1));
    return sb - sa;
  });

  console.log(`  📊 Total candidates to check: ${sorted.length}`);
  return sorted;
}


// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();

  // Step 1: Build candidates
  const candidates = buildCandidates();
  if (!candidates.length) {
    console.log('\n🎉 All restaurants already have booking links!');
    return;
  }

  // Step 2: Check OpenTable
  const limit = QUICK ? 30 : candidates.length;
  console.log(`\n🔍 Checking OpenTable for ${Math.min(limit, candidates.length)} restaurants...`);

  const withOT = [];
  const noOT = [];

  for (let i = 0; i < Math.min(limit, candidates.length); i++) {
    const r = candidates[i];
    process.stdout.write(`  [${i+1}/${Math.min(limit, candidates.length)}] ${r.name}...`);

    const result = await findOpenTableLink(r.name, r.address);

    if (result.found) {
      console.log(` ✅ ${result.url}`);
      withOT.push({ ...r, ot: result });
    } else {
      console.log(` ❌ Not on OT`);
      noOT.push(r);
    }

    await sleep(800); // Be respectful to OT servers
  }

  console.log(`\n  📊 OpenTable results: ${withOT.length} found, ${noOT.length} not found`);

  // Step 3: Availability checks
  let checkedOT = withOT;
  if (!SKIP_AVAILABILITY && withOT.length > 0) {
    console.log(`\n⏰ Checking availability for ${withOT.length} OT restaurants (date: ${CHECK_DATE})...`);

    for (let i = 0; i < withOT.length; i++) {
      const r = withOT[i];
      process.stdout.write(`  [${i+1}/${withOT.length}] ${r.name}...`);

      const avail = await checkOTAvailability(r, CHECK_DATE, PARTY_SIZE);

      if (avail && avail.is_available) {
        console.log(` ✅ ${avail.total_slots} slots (${avail.prime_slots} prime)`);
      } else if (avail) {
        console.log(` ❌ No availability (${avail.error || 'sold out'})`);
      } else {
        console.log(` ⚠️  Could not check`);
      }

      withOT[i] = { ...r, availability: avail };
      await sleep(1000);
    }
  }

  // Step 4: Update files
  console.log(`\n💾 Updating data files...`);

  let bookingAdded = 0;
  let availAdded = 0;

  for (const r of withOT) {
    const nameLower = r.name.toLowerCase().trim();

    // Update booking_lookup.json
    if (!BOOKING[nameLower] && r.ot?.url) {
      BOOKING[nameLower] = {
        platform: 'opentable',
        url: r.ot.url
      };
      bookingAdded++;
    }

    // Update availability
    if (r.availability?.is_available) {
      AVAIL_DATA[nameLower] = {
        ...r.availability,
        last_checked: new Date().toISOString(),
        source_platform: 'opentable'
      };
      availAdded++;
    }
  }

  // Backup before overwriting
  const backupPath = BOOKING_FILE.replace('.json', '.pre_ot_expand.json');
  fs.writeFileSync(backupPath, JSON.stringify(
    JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')), null, 2
  ));
  console.log(`  💾 Backup: ${path.basename(backupPath)}`);

  fs.writeFileSync(BOOKING_FILE, JSON.stringify(BOOKING, null, 2));
  console.log(`  📝 booking_lookup.json: +${bookingAdded} OT entries (total: ${Object.keys(BOOKING).length})`);

  fs.writeFileSync(AVAIL_FILE, JSON.stringify(AVAIL_DATA, null, 2));
  console.log(`  📝 availability_data.json: +${availAdded} entries`);

  // Save report
  const report = {
    run_date: new Date().toISOString(),
    summary: {
      candidates_checked: Math.min(limit, candidates.length),
      opentable_found: withOT.length,
      booking_added: bookingAdded,
      availability_added: availAdded
    },
    opentable_restaurants: withOT.map(r => ({
      name: r.name,
      rating: r.rating,
      reviews: r.reviews,
      ot_url: r.ot?.url,
      restaurant_id: r.ot?.restaurant_id,
      available: r.availability?.is_available || false,
      prime_slots: r.availability?.prime_slots || 0,
      total_slots: r.availability?.total_slots || 0
    })),
    not_found: noOT.slice(0, 200).map(r => ({
      name: r.name, rating: r.rating, reviews: r.reviews
    }))
  };

  fs.writeFileSync(OT_RESULTS_FILE, JSON.stringify(report, null, 2));
  console.log(`  📝 expand-results-ot.json: Full report saved`);

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes`);
  console.log(`\n📋 NEXT STEPS:`);
  console.log(`  1. Review expand-results-ot.json`);
  console.log(`  2. git add -A && git commit -m "Add OpenTable restaurants" && git push`);
  console.log(`  3. Check your site after deploy\n`);
}

main().catch(e => { console.error('❌ Fatal error:', e); process.exit(1); });
