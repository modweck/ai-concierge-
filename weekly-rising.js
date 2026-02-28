/**
 * weekly-rising.js — New & Rising Restaurant Detector
 * =====================================================
 * 
 * Runs weekly to:
 * 1. Snapshot Google review counts + ratings for all restaurants
 * 2. Compare to previous snapshots to find fast-growing restaurants
 * 3. Auto-search Resy + OpenTable for booking links on new finds
 * 4. Update booking_lookup.json with new entries
 * 
 * CRITERIA for "New & Rising":
 *   - 50–200 total reviews (genuinely new)
 *   - 15%+ review growth in the past month (4 weeks)
 *   - Rating 4.6+
 *   - Has or can find a booking link
 * 
 * RUN:    node weekly-rising.js
 * FLAGS:  --snapshot-only    Just save snapshot, skip rising detection
 *         --skip-booking     Skip booking link search
 *         --dry-run          Don't save any files
 *         --debug            Verbose output
 * 
 * FIRST RUN: Will only create a snapshot. Need 3-4 weeks of data
 *            before rising detection kicks in.
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const RESY_API_KEY   = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

const BOOKING_FILE   = path.join(__dirname, 'booking_lookup.json');
const SNAPSHOT_DIR   = path.join(__dirname, 'snapshots');
const RISING_FILE    = path.join(__dirname, 'new_and_rising.json');

// Rising criteria
const MIN_REVIEWS    = 50;
const MAX_REVIEWS    = 200;
const MIN_GROWTH     = 0.15;   // 15% growth over ~4 weeks
const MIN_RATING     = 4.6;
const WEEKS_NEEDED   = 3;      // minimum weeks of data before detecting

// ── CLI flags ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SNAPSHOT_ONLY  = args.includes('--snapshot-only');
const SKIP_BOOKING   = args.includes('--skip-booking');
const DRY_RUN        = args.includes('--dry-run');
const DEBUG          = args.includes('--debug');

// ── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanName(name) {
  return (name || '').toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(inputName, resultName) {
  const a = cleanName(inputName);
  const b = cleanName(resultName);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aWords = a.split(' ').filter(w => w.length > 1);
  const bWords = b.split(' ').filter(w => w.length > 1);
  const stop = new Set(['the','and','of','at','in','on','by','a','an','bar','restaurant','cafe','grill','kitchen','nyc','ny','new','york']);
  const aSig = aWords.filter(w => !stop.has(w));
  const bSig = bWords.filter(w => !stop.has(w));
  if (!aSig.length || !bSig.length) return 0;
  const matches = aSig.filter(w => bSig.some(bw => bw.includes(w) || w.includes(bw)));
  return matches.length / Math.max(aSig.length, bSig.length);
}

function isNYCArea(locality) {
  if (!locality) return false;
  const l = locality.toLowerCase();
  return l.includes('new york') || l.includes('nyc') || l.includes('manhattan') ||
    l.includes('brooklyn') || l.includes('queens') || l.includes('bronx') ||
    l.includes('staten island') || l.includes('jersey city') || l.includes('hoboken') ||
    l.includes('long island city') || l.includes('astoria') || l.includes('williamsburg');
}

function todayStr() {
  return new Date().toISOString().split('T')[0]; // 2026-03-01
}

// ── Junk filter ─────────────────────────────────────────────────────
function isJunk(name) {
  const n = name.toLowerCase();
  const junk = /\b(bagel|deli|donut|ice\s*cream|frozen\s*yogurt|juice|smoothie|bubble\s*tea|boba|pizza|pizzeria|cafe|café|coffee|bakery|burger|taco|gyro|ramen|falafel|halal|sandwich|cheesesteak|hot\s*dog|buffet|grocery|market|store|shop|express|counter|lounge|pub|tavern|brewery|food\s*truck|cart|catering|food\s*hall)\b/;
  return junk.test(n);
}

// ── Google Places lookup ────────────────────────────────────────────
async function getGoogleData(name) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' NYC')}&inputtype=textquery&fields=place_id,name,formatted_address&key=${GOOGLE_API_KEY}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    if (!searchData.candidates?.length) return null;

    const placeId = searchData.candidates[0].place_id;

    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,geometry,reservable,price_level,types,business_status&key=${GOOGLE_API_KEY}`;
    const detailResp = await fetch(detailUrl);
    const detailData = await detailResp.json();
    const r = detailData.result;
    if (!r) return null;

    return {
      name: r.name,
      place_id: placeId,
      rating: r.rating || 0,
      reviews: r.user_ratings_total || 0,
      lat: r.geometry?.location?.lat || null,
      lng: r.geometry?.location?.lng || null,
      reservable: r.reservable === true,
      price_level: r.price_level || null,
      types: r.types || [],
      business_status: r.business_status || null
    };
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ Google error for "${name}": ${e.message}`);
    return null;
  }
}

// ── Resy search ─────────────────────────────────────────────────────
async function searchResy(name) {
  try {
    const resp = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        query: cleanName(name),
        geo: { latitude: 40.7128, longitude: -74.006 },
        types: ['venue'],
        per_page: 5
      })
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const hits = data?.search?.hits || [];
    if (!hits.length) return null;

    for (const hit of hits) {
      const locality = hit.locality || hit.location?.name || '';
      if (!isNYCArea(locality)) continue;
      const score = matchScore(name, hit.name || '');
      if (score >= 0.75) {
        return {
          platform: 'resy',
          url: `https://resy.com/cities/ny/${hit.url_slug}`,
          name: hit.name,
          score
        };
      }
    }
    return null;
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ Resy error: ${e.message}`);
    return null;
  }
}

// ── OpenTable search ────────────────────────────────────────────────
async function searchOpenTable(name) {
  try {
    const searchName = cleanName(name);
    const url = `https://www.opentable.com/restref/api/suggest?term=${encodeURIComponent(searchName)}&latitude=40.7128&longitude=-74.006&lang=en-US`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const results = data?.restaurants || data?.results || data || [];

    if (Array.isArray(results)) {
      for (const r of results) {
        const rName = r.name || r.restaurantName || '';
        const rLink = r.profileLink || r.link || r.url || '';
        const score = matchScore(name, rName);
        if (score >= 0.75 && rLink) {
          const fullUrl = rLink.startsWith('http') ? rLink : `https://www.opentable.com${rLink}`;
          return { platform: 'opentable', url: fullUrl, name: rName, score };
        }
      }
    }
    return null;
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ OpenTable error: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// STEP 1: TAKE SNAPSHOT
// ═══════════════════════════════════════════════════════════════════
async function takeSnapshot(bookingLookup) {
  const date = todayStr();
  const snapshotFile = path.join(SNAPSHOT_DIR, `snapshot_${date}.json`);

  if (fs.existsSync(snapshotFile)) {
    console.log(`⚠️  Snapshot for ${date} already exists. Skipping.`);
    return JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  }

  console.log(`\n📸 TAKING SNAPSHOT — ${date}`);
  console.log(`   Checking ${Object.keys(bookingLookup).length} restaurants via Google Places API...`);
  console.log(`   ⏱️  Estimated time: ~${Math.round(Object.keys(bookingLookup).length * 0.25 / 60)} minutes\n`);

  const snapshot = {};
  let checked = 0, found = 0, failed = 0;
  const keys = Object.keys(bookingLookup);
  const SAVE_INTERVAL = 50;

  for (let i = 0; i < keys.length; i++) {
    const name = keys[i];
    process.stdout.write(`  [${i+1}/${keys.length}] ${name.substring(0,40).padEnd(40)} `);

    const data = await getGoogleData(name);
    if (data) {
      snapshot[name] = {
        rating: data.rating,
        reviews: data.reviews,
        lat: data.lat,
        lng: data.lng,
        place_id: data.place_id,
        reservable: data.reservable,
        checked: date
      };
      found++;
      console.log(`✅ ${data.rating}⭐ ${data.reviews} reviews`);
    } else {
      failed++;
      console.log(`❌`);
    }
    checked++;

    // Save progress
    if (!DRY_RUN && checked % SAVE_INTERVAL === 0) {
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    }

    await sleep(200); // rate limit
  }

  if (!DRY_RUN) {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  console.log(`\n📸 SNAPSHOT COMPLETE`);
  console.log(`   ✅ Found: ${found}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   💾 Saved: ${snapshotFile}\n`);

  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2: DETECT RISING RESTAURANTS
// ═══════════════════════════════════════════════════════════════════
function detectRising() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.log('❌ No snapshots directory yet. Run again next week.');
    return [];
  }

  const files = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
    .sort();

  console.log(`\n🔍 DETECTING RISING RESTAURANTS`);
  console.log(`   📁 Found ${files.length} snapshot(s)`);

  if (files.length < WEEKS_NEEDED) {
    console.log(`   ⏳ Need at least ${WEEKS_NEEDED} weeks of data. Have ${files.length}. Run again later.`);
    return [];
  }

  // Load latest and oldest (within ~4 weeks)
  const latestFile = files[files.length - 1];
  const latest = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, latestFile), 'utf8'));

  // Find snapshot closest to 4 weeks ago
  const latestDate = new Date(latestFile.replace('snapshot_', '').replace('.json', ''));
  let oldestFile = files[0];
  for (const f of files) {
    const d = new Date(f.replace('snapshot_', '').replace('.json', ''));
    const daysDiff = (latestDate - d) / (1000 * 60 * 60 * 24);
    if (daysDiff >= 21 && daysDiff <= 35) { // 3-5 weeks ago
      oldestFile = f;
      break;
    }
  }

  const oldest = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, oldestFile), 'utf8'));

  console.log(`   📊 Comparing: ${oldestFile} → ${latestFile}`);

  const rising = [];

  for (const [name, now] of Object.entries(latest)) {
    const prev = oldest[name];

    // Must have previous data
    if (!prev || !prev.reviews) continue;

    const currentReviews = now.reviews;
    const previousReviews = prev.reviews;
    const currentRating = now.rating;
    const growth = (currentReviews - previousReviews) / previousReviews;

    // Apply criteria
    if (currentReviews < MIN_REVIEWS) continue;
    if (currentReviews > MAX_REVIEWS) continue;
    if (currentRating < MIN_RATING) continue;
    if (growth < MIN_GROWTH) continue;

    // Skip junk
    if (isJunk(name)) continue;

    const gained = currentReviews - previousReviews;

    rising.push({
      name,
      rating: currentRating,
      reviews: currentReviews,
      previousReviews,
      gained,
      growthPct: Math.round(growth * 100),
      lat: now.lat,
      lng: now.lng,
      place_id: now.place_id,
      reservable: now.reservable
    });

    if (DEBUG) {
      console.log(`   🔥 ${name}: ${previousReviews} → ${currentReviews} (+${gained}, ${Math.round(growth*100)}%) ⭐${currentRating}`);
    }
  }

  // Sort by growth rate
  rising.sort((a, b) => b.growthPct - a.growthPct);

  console.log(`\n🔥 RISING RESTAURANTS FOUND: ${rising.length}`);
  for (const r of rising) {
    console.log(`   🔥 ${r.name}: +${r.gained} reviews (${r.growthPct}% growth) ⭐${r.rating} (${r.reviews} total)`);
  }

  return rising;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3: FIND BOOKING LINKS FOR RISING RESTAURANTS
// ═══════════════════════════════════════════════════════════════════
async function findBookingLinks(rising, bookingLookup) {
  console.log(`\n🔗 SEARCHING FOR BOOKING LINKS`);

  const results = [];
  let foundResy = 0, foundOT = 0, foundGoogle = 0, notFound = 0;

  for (let i = 0; i < rising.length; i++) {
    const r = rising[i];
    const nameKey = r.name.toLowerCase().trim();

    // Already in booking_lookup?
    if (bookingLookup[nameKey]) {
      console.log(`  [${i+1}/${rising.length}] ${r.name} — already in booking_lookup (${bookingLookup[nameKey].platform})`);
      results.push({ ...r, platform: bookingLookup[nameKey].platform, url: bookingLookup[nameKey].url, source: 'existing' });
      continue;
    }

    process.stdout.write(`  [${i+1}/${rising.length}] ${r.name.substring(0,40).padEnd(40)} `);

    // Try Resy first
    const resy = await searchResy(r.name);
    if (resy) {
      console.log(`✅ Resy (${resy.url})`);
      results.push({ ...r, platform: 'resy', url: resy.url, source: 'auto_found' });
      foundResy++;
      await sleep(500);
      continue;
    }

    await sleep(300);

    // Try OpenTable
    const ot = await searchOpenTable(r.name);
    if (ot) {
      console.log(`✅ OpenTable (${ot.url})`);
      results.push({ ...r, platform: 'opentable', url: ot.url, source: 'auto_found' });
      foundOT++;
      await sleep(500);
      continue;
    }

    // Google Reserve?
    if (r.reservable) {
      console.log(`✅ Google Reserve`);
      results.push({ ...r, platform: 'google', url: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`, source: 'google_reserve' });
      foundGoogle++;
      continue;
    }

    console.log(`⛔ No booking link found`);
    results.push({ ...r, platform: null, url: null, source: 'none' });
    notFound++;

    await sleep(300);
  }

  console.log(`\n🔗 BOOKING LINK RESULTS:`);
  console.log(`   ✅ Resy:           ${foundResy}`);
  console.log(`   ✅ OpenTable:      ${foundOT}`);
  console.log(`   ✅ Google Reserve: ${foundGoogle}`);
  console.log(`   ⛔ Not found:      ${notFound}`);

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4: UPDATE FILES
// ═══════════════════════════════════════════════════════════════════
function updateFiles(results, bookingLookup) {
  console.log(`\n💾 UPDATING FILES`);

  let addedToBooking = 0;

  // Add new booking links to booking_lookup
  for (const r of results) {
    if (!r.platform || !r.url) continue;
    if (r.source === 'existing') continue;

    const nameKey = r.name.toLowerCase().trim();
    if (bookingLookup[nameKey]) continue;

    bookingLookup[nameKey] = {
      platform: r.platform,
      url: r.url,
      lat: r.lat,
      lng: r.lng,
      google_rating: r.rating,
      google_reviews: r.reviews,
      place_id: r.place_id
    };
    addedToBooking++;
  }

  // Save new_and_rising.json (for frontend to use)
  const risingOutput = results
    .filter(r => r.platform)
    .map(r => ({
      name: r.name,
      rating: r.rating,
      reviews: r.reviews,
      gained: r.gained,
      growthPct: r.growthPct,
      platform: r.platform,
      url: r.url,
      lat: r.lat,
      lng: r.lng,
      place_id: r.place_id
    }));

  if (!DRY_RUN) {
    fs.writeFileSync(BOOKING_FILE, JSON.stringify(bookingLookup, null, 2));
    fs.writeFileSync(RISING_FILE, JSON.stringify(risingOutput, null, 2));

    // Also copy to netlify/functions
    const nfBooking = path.join(__dirname, 'netlify/functions/booking_lookup.json');
    const nfRising = path.join(__dirname, 'netlify/functions/new_and_rising.json');
    fs.writeFileSync(nfBooking, JSON.stringify(bookingLookup, null, 2));
    fs.writeFileSync(nfRising, JSON.stringify(risingOutput, null, 2));
  }

  console.log(`   📗 Added ${addedToBooking} new restaurants to booking_lookup`);
  console.log(`   🔥 Saved ${risingOutput.length} rising restaurants to new_and_rising.json`);
  console.log(`   ${DRY_RUN ? '⚠️  DRY RUN — no files saved' : '✅ All files saved'}`);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('═'.repeat(55));
  console.log('  🔥 WEEKLY NEW & RISING RESTAURANT DETECTOR');
  console.log('═'.repeat(55));

  // Load booking_lookup
  let bookingLookup = {};
  try { bookingLookup = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
  catch (e) { console.error('❌ Cannot load', BOOKING_FILE); process.exit(1); }
  console.log(`📗 Loaded ${Object.keys(bookingLookup).length} restaurants from booking_lookup`);

  // Step 1: Take snapshot
  await takeSnapshot(bookingLookup);

  if (SNAPSHOT_ONLY) {
    console.log('\n✅ Snapshot-only mode. Done!');
    return;
  }

  // Step 2: Detect rising
  const rising = detectRising();
  if (!rising.length) {
    console.log('\n✅ No rising restaurants detected yet. Keep collecting snapshots!');
    return;
  }

  // Step 3: Find booking links
  let results;
  if (SKIP_BOOKING) {
    console.log('\n⏭️  Skipping booking link search (--skip-booking)');
    results = rising.map(r => ({ ...r, platform: null, url: null, source: 'skipped' }));
  } else {
    results = await findBookingLinks(rising, bookingLookup);
  }

  // Step 4: Update files
  updateFiles(results, bookingLookup);

  console.log('\n' + '═'.repeat(55));
  console.log('  ✅ WEEKLY UPDATE COMPLETE');
  console.log('═'.repeat(55));
  console.log('\nNext steps:');
  console.log('  git add -A && git commit -m "weekly rising update" && git push');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
