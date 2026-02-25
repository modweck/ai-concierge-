/**
 * AVAILABILITY CHECKER — Scrapes Resy & OpenTable for real reservation data
 * ========================================================================
 * 
 * This script checks actual availability on Resy and OpenTable for every
 * restaurant in your booking_lookup.json. It stores the results so your
 * likelihood system can use REAL data instead of just proxies.
 *
 * RUN: GOOGLE_PLACES_API_KEY=xxx node availability-checker.js
 *
 * OPTIONS:
 *   --date 2026-03-01    Check a specific date (default: tomorrow)
 *   --party 2            Party size (default: 2)
 *   --quick              Only check 50 restaurants (for testing)
 *
 * OUTPUT: availability_data.json
 *
 * RATE LIMITING:
 *   - 1 request every 1.5 seconds (safe, won't trigger blocks)
 *   - ~700 Resy + ~700 OpenTable = ~2100 seconds = ~35 minutes per run
 *   - Run once daily, ideally early morning (6-7 AM)
 *
 * HOW IT WORKS:
 *   Resy: Calls their public API endpoint (same one their website uses)
 *   OpenTable: Calls their public availability endpoint
 *   Both: Uses authenticated API endpoints (Resy requires auth token)
 */

const fs = require('fs');
const path = require('path');

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const QUICK_MODE = args.includes('--quick');
const PARTY_SIZE = parseInt(getArg('party', '2'), 10);

// Default to tomorrow
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const CHECK_DATE = getArg('date', tomorrow.toISOString().split('T')[0]);

const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const CURATED_FILE = path.join(__dirname, 'curated_lists.json');
const OUTPUT_FILE = path.join(__dirname, 'availability_data.json');
const TODAY = new Date().toISOString().split('T')[0];

// Load data
let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
catch (e) { console.error('❌ Cannot load booking_lookup.json'); process.exit(1); }

let CURATED = { michelin: [], bib_gourmand: [], chase: [], rakuten: [], popular: [] };
try { CURATED = JSON.parse(fs.readFileSync(CURATED_FILE, 'utf8')); }
catch (e) { console.log('⚠️ No curated_lists.json found — checking all restaurants equally'); }

let EXISTING_DATA = {};
try { EXISTING_DATA = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) {}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractResySlug(url) {
  if (!url) return null;
  // Pattern: /cities/ny/SLUG or /cities/new-york-ny/venues/SLUG
  const m1 = url.match(/resy\.com\/cities\/[a-z-]+\/([a-z0-9-]+)\/?$/i);
  if (m1) return m1[1];
  const m2 = url.match(/venues\/([a-z0-9-]+)\/?$/i);
  if (m2) return m2[1];
  return null;
}

function extractOTSlug(url) {
  if (!url) return null;
  // Pattern: /r/SLUG or /SLUG
  const m1 = url.match(/opentable\.com\/r\/([a-z0-9-]+)\/?$/i);
  if (m1) return m1[1];
  const m2 = url.match(/opentable\.com\/([a-z0-9-]+)\/?$/i);
  if (m2 && !['r', 'restaurant', 'start'].includes(m2[1])) return m2[1];
  return null;
}

// ════════════════════════════════════════════════════════════════════
// RESY AVAILABILITY CHECK
// ════════════════════════════════════════════════════════════════════

async function checkResyAvailability(name, url, date, partySize) {
  const slug = extractResySlug(url);
  if (!slug) return { error: 'no_slug', slots: [] };

  try {
    // Step 1: Get the venue ID from the Resy API
    const findUrl = `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`;
    const findResp = await fetch(findUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
        'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!findResp.ok) {
      // Try alternate approach — direct slug lookup
      return await checkResyBySlug(slug, date, partySize);
    }

    const venueData = await findResp.json();
    const venueId = venueData?.id?.resy;
    if (!venueId) return { error: 'no_venue_id', slots: [] };

    // Step 2: Check availability for the date
    const availUrl = `https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${date}&party_size=${partySize}&venue_id=${venueId}`;
    const availResp = await fetch(availUrl, {
      headers: {
        'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
        'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
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
      type: s.config?.type || 'dining_room',
      token: s.config?.token ? true : false  // just track if bookable
    }));

    return {
      venue_id: venueId,
      date,
      party_size: partySize,
      total_slots: slots.length,
      slots: slots.map(s => ({ time: s.time, type: s.type })),
      is_available: slots.length > 0,
      dinner_slots: slots.filter(s => {
        const h = parseInt((s.time || '').split(' ')[1]?.split(':')[0] || '0');
        const t = s.time || '';
        return (h >= 17 && h <= 22) || t.includes('PM');
      }).length,
      prime_slots: slots.filter(s => {
        const timePart = (s.time || '').replace(/.*\s/, '');
        const h = parseInt(timePart.split(':')[0] || '0');
        const m = parseInt(timePart.split(':')[1] || '0');
        const hour24 = (s.time || '').toLowerCase().includes('pm') && h !== 12 ? h + 12 : h;
        return hour24 >= 18 && hour24 <= 21;
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
        'X-Resy-Auth-Token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
        'X-Resy-Universal-Auth': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzU5MTI5MDQsInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AbLsC4mROj3TN9otRtBL7UikUVDg4zBJInRJ_gHWiQ6hzuW7eY0zvPLeUhJyW2bokab4DO0jZXxeobiW2ANUCzI0AT8jENhBeyTE1HSUVcmH3ICRj3NIpbfNTGtFuhHgB_jjOe09EYoAc1sao3BDBgCiR1fNTXjlTmd4HYTkazZRH288',
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
      total_slots: slots.length,
      slots: slots,
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

// ════════════════════════════════════════════════════════════════════
// OPENTABLE AVAILABILITY CHECK
// ════════════════════════════════════════════════════════════════════

async function checkOpenTableAvailability(name, url, date, partySize) {
  const slug = extractOTSlug(url);
  if (!slug) return { error: 'no_slug', slots: [] };

  try {
    // Step 1: Get restaurant ID from the OT page
    // OT uses a numeric restaurant ID internally
    const pageUrl = `https://www.opentable.com/r/${slug}`;
    const pageResp = await fetch(url, {  // use original URL (handles /r/ and direct)
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });

    if (!pageResp.ok) return { error: `page_http_${pageResp.status}`, slots: [] };

    const html = await pageResp.text();

    // Extract restaurant ID from the page HTML
    // OT embeds it in various places
    let restaurantId = null;

    // Try: data-restaurant-id
    const m1 = html.match(/data-restaurant-id="(\d+)"/);
    if (m1) restaurantId = m1[1];

    // Try: "rid":12345 or "restaurantId":12345
    if (!restaurantId) {
      const m2 = html.match(/"rid"\s*:\s*(\d+)/);
      if (m2) restaurantId = m2[1];
    }
    if (!restaurantId) {
      const m3 = html.match(/"restaurantId"\s*:\s*(\d+)/);
      if (m3) restaurantId = m3[1];
    }

    // Try: /restref/client?rid=12345
    if (!restaurantId) {
      const m4 = html.match(/rid=(\d+)/);
      if (m4) restaurantId = m4[1];
    }

    // Try: restref path
    if (!restaurantId) {
      const m5 = html.match(/\/restaurant\/profile\/(\d+)/);
      if (m5) restaurantId = m5[1];
    }

    if (!restaurantId) {
      // Can't find ID — try the availability API with slug directly
      return await checkOTBySlug(slug, date, partySize);
    }

    // Step 2: Check availability
    const availUrl = `https://www.opentable.com/dapi/availability?rid=${restaurantId}&partySize=${partySize}&dateTime=${date}T19:00&enableFutureAvailability=true`;
    
    await sleep(500); // small delay between page fetch and API call
    
    const availResp = await fetch(availUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': url
      }
    });

    if (!availResp.ok) return { error: `avail_http_${availResp.status}`, slots: [], restaurant_id: restaurantId };

    const availData = await availResp.json();
    const timeSlots = availData?.availability?.timeslots || availData?.timeslots || [];

    const slots = timeSlots.map(s => ({
      time: s.dateTime || s.time || '',
      type: s.areaName || s.type || 'dining_room'
    }));

    return {
      restaurant_id: restaurantId,
      date, party_size: partySize,
      total_slots: slots.length,
      slots: slots,
      is_available: slots.length > 0,
      dinner_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('T17:') || t.includes('T18:') || t.includes('T19:') || t.includes('T20:') || t.includes('T21:') || t.includes('T22:');
      }).length,
      prime_slots: slots.filter(s => {
        const t = s.time || '';
        return t.includes('T18:') || t.includes('T19:') || t.includes('T20:');
      }).length,
      error: null
    };

  } catch (e) {
    return { error: e.message, slots: [] };
  }
}

async function checkOTBySlug(slug, date, partySize) {
  try {
    // Try the direct availability endpoint with slug
    const url = `https://www.opentable.com/dapi/availability?name=${slug}&partySize=${partySize}&dateTime=${date}T19:00`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) return { error: `slug_http_${resp.status}`, slots: [] };
    
    const data = await resp.json();
    const timeSlots = data?.availability?.timeslots || data?.timeslots || [];
    const slots = timeSlots.map(s => ({ time: s.dateTime || '', type: s.areaName || '' }));

    return {
      date, party_size: partySize,
      total_slots: slots.length, slots,
      is_available: slots.length > 0,
      dinner_slots: slots.filter(s => /T1[7-9]:|T2[0-2]:/.test(s.time)).length,
      prime_slots: slots.filter(s => /T18:|T19:|T20:/.test(s.time)).length,
      error: null
    };
  } catch (e) {
    return { error: e.message, slots: [] };
  }
}

// ════════════════════════════════════════════════════════════════════
// AVAILABILITY SCORING — Convert raw data to useful metrics
// ════════════════════════════════════════════════════════════════════

function parseSlotHour(timeStr) {
  // Resy format: "2026-02-26 17:30:00" or with AM/PM
  if (!timeStr) return null;
  // Try 24h format first: "2026-02-26 17:30:00"
  const m24 = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m24) {
    let h = parseInt(m24[1]);
    const min = parseInt(m24[2]);
    // Check for AM/PM
    if (/pm/i.test(timeStr) && h !== 12) h += 12;
    if (/am/i.test(timeStr) && h === 12) h = 0;
    return h + (min / 60);  // 17.5 = 5:30pm
  }
  return null;
}

function buildTimeWindows(slots) {
  // 3 simple windows that match how people actually book dinner
  const windows = {
    early:  { label: '5-6:30pm',     start: 17, end: 18.5, slots: [] },
    prime:  { label: '6:30-8:30pm',  start: 18.5, end: 20.5, slots: [] },
    late:   { label: '8:30-10pm',    start: 20.5, end: 22, slots: [] }
  };

  for (const slot of (slots || [])) {
    const h = parseSlotHour(slot.time);
    if (h === null) continue;
    for (const [key, w] of Object.entries(windows)) {
      if (h >= w.start && h < w.end) {
        w.slots.push(slot.time);
        break;
      }
    }
  }

  const summary = {};
  for (const [key, w] of Object.entries(windows)) {
    summary[key] = { 
      label: w.label, 
      count: w.slots.length, 
      status: w.slots.length > 0 ? 'available' : 'sold_out',
      times: w.slots 
    };
  }
  return summary;
}

function scoreAvailability(result, platform) {
  if (!result || result.error) {
    return { fill_rate: null, availability_tier: 'unknown', raw_error: result?.error };
  }

  const total = result.total_slots || 0;
  const dinner = result.dinner_slots || 0;
  const prime = result.prime_slots || 0;
  const slots = result.slots || [];

  // Build time window breakdown
  const time_windows = buildTimeWindows(slots);

  // Count how many dinner windows have availability
  const dinnerWindowsAvailable = ['early', 'prime', 'late']
    .filter(k => time_windows[k]?.count > 0).length;

  // Tier logic
  let availability_tier;
  if (total === 0) {
    availability_tier = 'sold_out';
  } else if (prime === 0 && dinner <= 1) {
    availability_tier = 'nearly_full';
  } else if (prime <= 1 && dinner <= 3) {
    availability_tier = 'limited';
  } else if (dinner <= 6) {
    availability_tier = 'moderate';
  } else {
    availability_tier = 'available';
  }

  // Demand score contribution (0-30 range)
  let availability_demand_points;
  if (availability_tier === 'sold_out') availability_demand_points = 30;
  else if (availability_tier === 'nearly_full') availability_demand_points = 22;
  else if (availability_tier === 'limited') availability_demand_points = 14;
  else if (availability_tier === 'moderate') availability_demand_points = 6;
  else availability_demand_points = 0;

  return {
    total_slots: total,
    dinner_slots: dinner,
    prime_slots: prime,
    availability_tier,
    availability_demand_points,
    is_available: total > 0,
    time_windows,
    dinner_windows_available: dinnerWindowsAvailable,
    checked_date: result.date,
    checked_party_size: result.party_size,
    platform
  };
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🔍 AVAILABILITY CHECKER');
  console.log(`📅 Checking date: ${CHECK_DATE}`);
  console.log(`👥 Party size: ${PARTY_SIZE}`);
  console.log(`${QUICK_MODE ? '⚡ Quick mode (curated only)' : '🏁 Full mode'}`);
  console.log('─────────────────────────────────────\n');

  // Build curated name set for priority sorting
  const curatedPriority = new Map(); // name_lower → priority (lower = checked first)
  const tierLabels = ['michelin', 'bib_gourmand', 'chase', 'rakuten', 'popular'];
  tierLabels.forEach((tier, idx) => {
    for (const name of (CURATED[tier] || [])) {
      const key = name.toLowerCase().trim();
      if (!curatedPriority.has(key)) curatedPriority.set(key, idx);
    }
  });
  console.log(`⭐ Curated restaurants: ${curatedPriority.size} (Michelin: ${(CURATED.michelin||[]).length}, Bib: ${(CURATED.bib_gourmand||[]).length}, Chase: ${(CURATED.chase||[]).length}, Rakuten: ${(CURATED.rakuten||[]).length})`);

  // Deduplicate restaurants by URL
  const resyRestaurants = new Map();
  const otRestaurants = new Map();

  for (const [name, info] of Object.entries(BOOKING_LOOKUP)) {
    const url = info.url || '';
    if (info.platform === 'resy' && url) {
      const slug = extractResySlug(url);
      if (slug && !resyRestaurants.has(slug)) {
        const priority = curatedPriority.get(name.toLowerCase().trim()) ?? 99;
        resyRestaurants.set(slug, { name, url, slug, priority });
      }
    } else if (info.platform === 'opentable' && url) {
      const slug = extractOTSlug(url);
      if (slug && !otRestaurants.has(slug)) {
        const priority = curatedPriority.get(name.toLowerCase().trim()) ?? 99;
        otRestaurants.set(slug, { name, url, slug, priority });
      }
    }
  }

  console.log(`📊 Found ${resyRestaurants.size} unique Resy restaurants`);
  console.log(`📊 Found ${otRestaurants.size} unique OpenTable restaurants`);

  // Sort by priority: curated first (0=michelin, 1=bib, 2=chase, 3=rakuten, 4=popular, 99=other)
  let resyList = Array.from(resyRestaurants.values()).sort((a, b) => a.priority - b.priority);
  let otList = Array.from(otRestaurants.values()).sort((a, b) => a.priority - b.priority);

  const resyCurated = resyList.filter(r => r.priority < 99).length;
  const otCurated = otList.filter(r => r.priority < 99).length;
  console.log(`⭐ Curated in Resy: ${resyCurated} | Curated in OpenTable: ${otCurated}`);

  if (QUICK_MODE) {
    // In quick mode: check ALL curated + a few extras
    const resyCuratedList = resyList.filter(r => r.priority < 99);
    const otCuratedList = otList.filter(r => r.priority < 99);
    resyList = resyCuratedList;
    otList = otCuratedList;
    console.log(`⚡ Quick mode: checking ${resyList.length} curated Resy + ${otList.length} curated OpenTable`);
  }

  const availability = { ...EXISTING_DATA };
  let resySuccess = 0, resyFail = 0;
  let otSuccess = 0, otFail = 0;

  // ── Check Resy ──
  console.log(`\n🟣 Checking Resy (${resyList.length} restaurants)...\n`);

  for (let i = 0; i < resyList.length; i++) {
    const r = resyList[i];
    process.stdout.write(`  [${i + 1}/${resyList.length}] ${r.name}...`);

    const result = await checkResyAvailability(r.name, r.url, CHECK_DATE, PARTY_SIZE);
    const scored = scoreAvailability(result, 'resy');

    // Tier label for display
    const tierTag = r.priority === 0 ? '⭐' : r.priority === 1 ? '🍽️' : r.priority === 2 ? '💳' : r.priority === 3 ? '🛍️' : r.priority === 4 ? '🔥' : '';

    // Store by name (lowercase) so likelihood-collector can merge it
    const key = r.name.toLowerCase().trim();
    availability[key] = {
      name: r.name,
      platform: 'resy',
      url: r.url,
      slug: r.slug,
      curated_tier: r.priority < 99 ? tierLabels[r.priority] : null,
      ...scored,
      last_checked: TODAY,
      check_history: [
        ...(availability[key]?.check_history || []).slice(-13), // keep last 14 days
        {
          date: TODAY,
          checked_for: CHECK_DATE,
          party_size: PARTY_SIZE,
          total_slots: scored.total_slots,
          dinner_slots: scored.dinner_slots,
          prime_slots: scored.prime_slots,
          tier: scored.availability_tier
        }
      ]
    };

    if (scored.availability_tier !== 'unknown') {
      const emoji = {
        sold_out: '🔴', nearly_full: '🟠',
        limited: '🟡', moderate: '🔵', available: '🟢'
      }[scored.availability_tier] || '⚪';
      console.log(` ${emoji} ${scored.availability_tier} (${scored.total_slots} slots, ${scored.prime_slots} prime) ${tierTag}`);
      
      // Show time window breakdown
      if (scored.time_windows) {
        const tw = scored.time_windows;
        const parts = ['early', 'prime', 'late'].map(k => {
          const w = tw[k];
          if (!w) return null;
          return w.count > 0 
            ? `    ✅ ${w.label}: ${w.count} slots` 
            : `    ❌ ${w.label}: SOLD OUT`;
        }).filter(Boolean);
        if (parts.length) console.log(parts.join('\n'));
      }
      resySuccess++;
    } else {
      console.log(` ❌ ${scored.raw_error || 'failed'} ${tierTag}`);
      resyFail++;
    }

    await sleep(1500); // 1.5 second delay between requests
  }

  // ── Check OpenTable ──
  console.log(`\n🔴 Checking OpenTable (${otList.length} restaurants)...\n`);

  for (let i = 0; i < otList.length; i++) {
    const r = otList[i];
    process.stdout.write(`  [${i + 1}/${otList.length}] ${r.name}...`);

    const result = await checkOpenTableAvailability(r.name, r.url, CHECK_DATE, PARTY_SIZE);
    const scored = scoreAvailability(result, 'opentable');

    const tierTag = r.priority === 0 ? '⭐' : r.priority === 1 ? '🍽️' : r.priority === 2 ? '💳' : r.priority === 3 ? '🛍️' : r.priority === 4 ? '🔥' : '';

    const key = r.name.toLowerCase().trim();
    availability[key] = {
      name: r.name,
      platform: 'opentable',
      url: r.url,
      slug: r.slug,
      restaurant_id: result.restaurant_id || null,
      curated_tier: r.priority < 99 ? tierLabels[r.priority] : null,
      ...scored,
      last_checked: TODAY,
      check_history: [
        ...(availability[key]?.check_history || []).slice(-13),
        {
          date: TODAY,
          checked_for: CHECK_DATE,
          party_size: PARTY_SIZE,
          total_slots: scored.total_slots,
          dinner_slots: scored.dinner_slots,
          prime_slots: scored.prime_slots,
          tier: scored.availability_tier
        }
      ]
    };

    if (scored.availability_tier !== 'unknown') {
      const emoji = {
        sold_out: '🔴', nearly_full: '🟠',
        limited: '🟡', moderate: '🔵', available: '🟢'
      }[scored.availability_tier] || '⚪';
      console.log(` ${emoji} ${scored.availability_tier} (${scored.total_slots} slots, ${scored.prime_slots} prime) ${tierTag}`);
      
      // Show time window breakdown
      if (scored.time_windows) {
        const tw = scored.time_windows;
        const parts = ['early', 'prime', 'late'].map(k => {
          const w = tw[k];
          if (!w) return null;
          return w.count > 0 
            ? `    ✅ ${w.label}: ${w.count} slots` 
            : `    ❌ ${w.label}: SOLD OUT`;
        }).filter(Boolean);
        if (parts.length) console.log(parts.join('\n'));
      }
      otSuccess++;
    } else {
      console.log(` ❌ ${scored.raw_error || 'failed'} ${tierTag}`);
      otFail++;
    }

    await sleep(1500);
  }

  // ── Add metadata ──
  availability._meta = {
    last_run: TODAY,
    checked_date: CHECK_DATE,
    party_size: PARTY_SIZE,
    resy: { checked: resyList.length, success: resySuccess, failed: resyFail },
    opentable: { checked: otList.length, success: otSuccess, failed: otFail },
    curated: {
      michelin: (CURATED.michelin || []).length,
      bib_gourmand: (CURATED.bib_gourmand || []).length,
      chase: (CURATED.chase || []).length,
      rakuten: (CURATED.rakuten || []).length
    }
  };

  // ── Save ──
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(availability, null, 2));

  // ── Stats ──
  const tiers = { sold_out: 0, nearly_full: 0, limited: 0, moderate: 0, available: 0, unknown: 0 };
  const curatedTiers = { michelin: {}, bib_gourmand: {}, chase: {}, rakuten: {} };
  for (const [k, v] of Object.entries(availability)) {
    if (k.startsWith('_')) continue;
    tiers[v.availability_tier || 'unknown']++;
    if (v.curated_tier && curatedTiers[v.curated_tier]) {
      const t = v.availability_tier || 'unknown';
      curatedTiers[v.curated_tier][t] = (curatedTiers[v.curated_tier][t] || 0) + 1;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 RESULTS:');
  console.log(`   Resy:      ${resySuccess} success / ${resyFail} failed`);
  console.log(`   OpenTable: ${otSuccess} success / ${otFail} failed`);
  console.log(`\n   🔴 Sold Out:     ${tiers.sold_out}`);
  console.log(`   🟠 Nearly Full:  ${tiers.nearly_full}`);
  console.log(`   🟡 Limited:      ${tiers.limited}`);
  console.log(`   🔵 Moderate:     ${tiers.moderate}`);
  console.log(`   🟢 Available:    ${tiers.available}`);
  console.log(`   ⚪ Unknown:      ${tiers.unknown}`);
  
  console.log(`\n⭐ CURATED BREAKDOWN:`);
  for (const [tier, counts] of Object.entries(curatedTiers)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const soldOut = counts.sold_out || 0;
    const hard = (counts.nearly_full || 0) + soldOut;
    console.log(`   ${tier}: ${total} checked | ${soldOut} sold out | ${hard} hard to book`);
  }

  console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
  console.log('✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
