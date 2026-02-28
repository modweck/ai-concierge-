/**
 * resy-availability-check.js
 * 
 * Checks Resy availability ONLY for restaurants that don't have availability data yet.
 * Skips OpenTable entirely. Skips restaurants already checked.
 * 
 * RUN:   node resy-availability-check.js
 * 
 * OPTIONS:
 *   --date 2026-03-01    Check a specific date (default: tomorrow)
 *   --party 2            Party size (default: 2)
 *   --quick              Only check first 50
 *   --all                Check ALL resy, even ones already checked
 * 
 * OUTPUT: availability_data.json (merges with existing)
 */

const fs = require('fs');
const path = require('path');

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const CHECK_ALL = args.includes('--all');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const CHECK_DATE = getArg('date', tomorrow.toISOString().split('T')[0]);
const TODAY = new Date().toISOString().split('T')[0];

const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE = path.join(__dirname, 'availability_data.json');

// Load data
let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('❌ Cannot load booking_lookup.json'); process.exit(1); }

let EXISTING_DATA = {};
try { EXISTING_DATA = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) {}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractResySlug(url) {
  if (!url) return null;
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?$/i);
  if (m1) return m1[1];
  const m2 = url.match(/venues\/([a-z0-9-]+)\/?$/i);
  if (m2) return m2[1];
  return null;
}

// ── Resy API check ──
async function checkResyAvailability(name, url, date, partySize) {
  const slug = extractResySlug(url);
  if (!slug) return { error: 'no_slug', slots: [] };

  try {
    const findUrl = `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`;
    const findResp = await fetch(findUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!findResp.ok) {
      return await checkResyBySlug(slug, date, partySize);
    }

    const venueData = await findResp.json();
    const venueId = venueData?.id?.resy;
    if (!venueId) return { error: 'no_venue_id', slots: [] };

    const availUrl = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`;
    const availResp = await fetch(availUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!availResp.ok) return { error: `http_${availResp.status}`, slots: [] };

    const availData = await availResp.json();
    const results = availData?.results?.venues?.[0];
    const slots = (results?.slots || []).map(s => ({
      time: s.date?.start || '',
      type: s.config?.type || 'dining_room'
    }));

    return {
      venue_id: venueId, date, party_size: partySize,
      total_slots: slots.length, slots,
      is_available: slots.length > 0,
      dinner_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('17:') || t.includes('18:') || t.includes('19:') || t.includes('20:') || t.includes('21:') || t.includes('22:');
      }).length,
      prime_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('18:') || t.includes('19:') || t.includes('20:');
      }).length,
      error: null
    };
  } catch (e) {
    return { error: e.message, slots: [] };
  }
}

async function checkResyBySlug(slug, date, partySize) {
  try {
    const url = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&slug=${slug}&location=ny`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!resp.ok) return { error: `slug_http_${resp.status}`, slots: [] };

    const data = await resp.json();
    const venues = data?.results?.venues || [];
    if (!venues.length) return { error: 'no_venues', slots: [], is_available: false, total_slots: 0 };

    const slots = (venues[0]?.slots || []).map(s => ({
      time: s.date?.start || '',
      type: s.config?.type || 'dining_room'
    }));

    return {
      date, party_size: partySize,
      total_slots: slots.length, slots,
      is_available: slots.length > 0,
      dinner_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('17:') || t.includes('18:') || t.includes('19:') || t.includes('20:') || t.includes('21:') || t.includes('22:');
      }).length,
      prime_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('18:') || t.includes('19:') || t.includes('20:');
      }).length,
      error: null
    };
  } catch (e) {
    return { error: e.message, slots: [] };
  }
}

// ── Scoring ──
function buildTimeWindows(slots) {
  const windows = {
    early:  { label: '5-6:30pm',     start: 17, end: 18.5, slots: [] },
    prime:  { label: '6:30-8:30pm',  start: 18.5, end: 20.5, slots: [] },
    late:   { label: '8:30-10pm',    start: 20.5, end: 22, slots: [] }
  };

  for (const slot of (slots || [])) {
    const m = (slot.time || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) continue;
    let h = parseInt(m[1]);
    const min = parseInt(m[2]);
    if (/pm/i.test(slot.time) && h !== 12) h += 12;
    if (/am/i.test(slot.time) && h === 12) h = 0;
    const hour = h + (min / 60);
    for (const [key, w] of Object.entries(windows)) {
      if (hour >= w.start && hour < w.end) { w.slots.push(slot.time); break; }
    }
  }

  const summary = {};
  for (const [key, w] of Object.entries(windows)) {
    summary[key] = { label: w.label, count: w.slots.length, status: w.slots.length > 0 ? 'available' : 'sold_out', times: w.slots };
  }
  return summary;
}

function scoreAvailability(result) {
  if (!result || result.error) {
    return { fill_rate: null, availability_tier: 'unknown', raw_error: result?.error };
  }

  const total = result.total_slots || 0;
  const dinner = result.dinner_slots || 0;
  const prime = result.prime_slots || 0;
  const time_windows = buildTimeWindows(result.slots || []);

  let availability_tier;
  if (total === 0) availability_tier = 'sold_out';
  else if (prime === 0 && dinner <= 1) availability_tier = 'nearly_full';
  else if (prime <= 1 && dinner <= 3) availability_tier = 'limited';
  else if (dinner <= 6) availability_tier = 'moderate';
  else availability_tier = 'available';

  let availability_demand_points;
  if (availability_tier === 'sold_out') availability_demand_points = 30;
  else if (availability_tier === 'nearly_full') availability_demand_points = 22;
  else if (availability_tier === 'limited') availability_demand_points = 14;
  else if (availability_tier === 'moderate') availability_demand_points = 6;
  else availability_demand_points = 0;

  return {
    total_slots: total, dinner_slots: dinner, prime_slots: prime,
    availability_tier, availability_demand_points,
    is_available: total > 0, time_windows,
    checked_date: result.date, checked_party_size: result.party_size,
    platform: 'resy'
  };
}

// ── MAIN ──
async function main() {
  console.log('\n🟣 RESY-ONLY AVAILABILITY CHECKER');
  console.log(`📅 Checking date: ${CHECK_DATE}`);
  console.log(`👥 Party size: ${PARTY_SIZE}`);
  console.log('─────────────────────────────────────\n');

  // Build list of Resy restaurants, deduplicated by slug
  const resyMap = new Map();
  for (const [name, info] of Object.entries(BOOKING_LOOKUP)) {
    if (info.platform !== 'resy' || !info.url) continue;
    const slug = extractResySlug(info.url);
    if (!slug || resyMap.has(slug)) continue;
    resyMap.set(slug, { name, url: info.url, slug });
  }

  let resyList = Array.from(resyMap.values());
  console.log(`📊 Total unique Resy restaurants: ${resyList.length}`);
  console.log(`📊 Already have availability data: ${Object.keys(EXISTING_DATA).filter(k => !k.startsWith('_')).length}`);

  // Filter out already-checked unless --all flag
  if (!CHECK_ALL) {
    const alreadyChecked = new Set(
      Object.entries(EXISTING_DATA)
        .filter(([k, v]) => !k.startsWith('_') && v.platform === 'resy' && v.availability_tier && v.availability_tier !== 'unknown')
        .map(([k]) => k.toLowerCase().trim())
    );
    const before = resyList.length;
    resyList = resyList.filter(r => !alreadyChecked.has(r.name.toLowerCase().trim()));
    console.log(`⏭️  Skipping ${before - resyList.length} already checked`);
  }

  if (QUICK_MODE) {
    resyList = resyList.slice(0, 50);
    console.log(`⚡ Quick mode: checking first 50 only`);
  }

  console.log(`🎯 Will check: ${resyList.length} restaurants`);
  console.log(`⏱️  Estimated time: ~${Math.round(resyList.length * 1.5 / 60)} minutes\n`);

  const availability = { ...EXISTING_DATA };
  let success = 0, fail = 0;
  const SAVE_INTERVAL = 25;

  for (let i = 0; i < resyList.length; i++) {
    const r = resyList[i];
    process.stdout.write(`  [${i + 1}/${resyList.length}] ${r.name.substring(0, 40).padEnd(40)}...`);

    const result = await checkResyAvailability(r.name, r.url, CHECK_DATE, PARTY_SIZE);
    const scored = scoreAvailability(result);

    const key = r.name.toLowerCase().trim();
    availability[key] = {
      name: r.name,
      platform: 'resy',
      url: r.url,
      slug: r.slug,
      ...scored,
      last_checked: TODAY,
      check_history: [
        ...(availability[key]?.check_history || []).slice(-13),
        {
          date: TODAY, checked_for: CHECK_DATE, party_size: PARTY_SIZE,
          total_slots: scored.total_slots, dinner_slots: scored.dinner_slots,
          prime_slots: scored.prime_slots, tier: scored.availability_tier
        }
      ]
    };

    if (scored.availability_tier !== 'unknown') {
      const emoji = { sold_out: '🔴', nearly_full: '🟠', limited: '🟡', moderate: '🔵', available: '🟢' }[scored.availability_tier] || '⚪';
      console.log(` ${emoji} ${scored.availability_tier} (${scored.total_slots} slots, ${scored.prime_slots} prime)`);
      success++;
    } else {
      console.log(` ❌ ${scored.raw_error || 'failed'}`);
      fail++;
    }

    // Save progress periodically
    if ((i + 1) % SAVE_INTERVAL === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(availability, null, 2));
    }

    await sleep(1500);
  }

  // Final save
  availability._meta = {
    last_run: TODAY, checked_date: CHECK_DATE, party_size: PARTY_SIZE,
    resy: { checked: resyList.length, success, failed: fail }
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(availability, null, 2));

  // Stats
  const tiers = { sold_out: 0, nearly_full: 0, limited: 0, moderate: 0, available: 0, unknown: 0 };
  for (const [k, v] of Object.entries(availability)) {
    if (k.startsWith('_')) continue;
    tiers[v.availability_tier || 'unknown']++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 RESULTS:');
  console.log(`   Checked: ${success + fail} | Success: ${success} | Failed: ${fail}`);
  console.log(`\n   🔴 Sold Out:     ${tiers.sold_out}`);
  console.log(`   🟠 Nearly Full:  ${tiers.nearly_full}`);
  console.log(`   🟡 Limited:      ${tiers.limited}`);
  console.log(`   🔵 Moderate:     ${tiers.moderate}`);
  console.log(`   🟢 Available:    ${tiers.available}`);
  console.log(`   ⚪ Unknown:      ${tiers.unknown}`);
  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
  console.log('✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
