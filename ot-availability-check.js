/**
 * ot-availability-check.js — OpenTable Availability Checker
 * ===========================================================
 * 
 * Checks OpenTable restaurant availability by scraping their 
 * availability widget endpoint.
 * 
 * RUN:   node ot-availability-check.js --date 2026-03-01
 * FLAGS: --date YYYY-MM-DD   Date to check (default: tomorrow)
 *        --quick             First 50 only
 *        --all               Recheck everything (ignore previous results)
 *        --debug             Verbose output
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const ALL_MODE = args.includes('--all');
const DEBUG = args.includes('--debug');

// Get date
let CHECK_DATE;
const dateArg = args.find(a => a.startsWith('--date'));
if (dateArg) {
  const idx = args.indexOf(dateArg);
  CHECK_DATE = args[idx + 1];
} else {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}

const OT_FILE = path.join(__dirname, 'ot_full.json');
const AVAIL_FILE = path.join(__dirname, 'availability_data.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extract slug from OpenTable URL
function getSlug(url) {
  if (!url) return null;
  const clean = url.replace(/\?.*$/, '').replace(/\/$/, '');
  const parts = clean.split('/');
  return parts[parts.length - 1] || null;
}

// Get restaurant ID from OpenTable page
async function getRestaurantId(slug) {
  try {
    const url = `https://www.opentable.com/r/${slug}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow'
    });

    if (!resp.ok) {
      // Try without /r/
      const resp2 = await fetch(`https://www.opentable.com/${slug}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        redirect: 'follow'
      });
      if (!resp2.ok) return null;
      const html2 = await resp2.text();
      const match2 = html2.match(/restaurantId["\s:]+(\d+)/);
      return match2 ? match2[1] : null;
    }

    const html = await resp.text();
    
    // Look for restaurant ID in the page
    const match = html.match(/restaurantId["\s:]+(\d+)/) ||
                  html.match(/"rid":(\d+)/) ||
                  html.match(/"restaurantId":(\d+)/) ||
                  html.match(/data-restaurant-id="(\d+)"/) ||
                  html.match(/\/restref\/client\?rid=(\d+)/);
    
    return match ? match[1] : null;
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ getRestaurantId error: ${e.message}`);
    return null;
  }
}

// Check availability using OpenTable's availability API
async function checkAvailability(slug, rid, date) {
  try {
    // Method 1: Direct availability API with slug
    const url = `https://www.opentable.com/dapi/fe/gql/availability/restaurant/${slug}`;
    const resp = await fetch(url + `?date=${date}&partySize=2&time=19:00`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://www.opentable.com/r/${slug}`,
        'Origin': 'https://www.opentable.com'
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data?.availability || data?.data) {
        return parseAvailabilityResponse(data);
      }
    }

    // Method 2: Widget/booking availability 
    if (rid) {
      const widgetUrl = `https://www.opentable.com/restref/client?rid=${rid}&datetime=${date}T19%3A00&covers=2&lang=en-US&r3uid=`;
      const resp2 = await fetch(widgetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Referer': 'https://www.opentable.com/'
        }
      });

      if (resp2.ok) {
        const html = await resp2.text();
        return parseWidgetHtml(html, date);
      }
    }

    // Method 3: Scrape the restaurant page for time slots
    const pageUrl = `https://www.opentable.com/r/${slug}?date=${date}&partySize=2&time=19:00`;
    const resp3 = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      }
    });

    if (resp3.ok) {
      const html = await resp3.text();
      return parsePageForSlots(html, date);
    }

    return null;
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ checkAvailability error: ${e.message}`);
    return null;
  }
}

function parseAvailabilityResponse(data) {
  try {
    // Handle GraphQL response format
    const avail = data?.availability?.data?.availability || 
                  data?.data?.availability || 
                  data?.availability || 
                  data;
    
    let slots = [];
    
    // Extract time slots
    if (avail?.timeslots) {
      slots = avail.timeslots.map(s => ({
        time: s.dateTime || s.time || s.label,
        type: s.type || 'standard'
      }));
    } else if (avail?.slots) {
      slots = avail.slots.map(s => ({
        time: s.time || s.dateTime,
        type: s.type || 'standard'  
      }));
    } else if (Array.isArray(avail)) {
      slots = avail.map(s => ({
        time: s.time || s.dateTime || s.label,
        type: s.type || 'standard'
      }));
    }

    return categorizeSlots(slots);
  } catch (e) {
    if (DEBUG) console.log(`    ⚠️ parseAvailability error: ${e.message}`);
    return null;
  }
}

function parseWidgetHtml(html, date) {
  try {
    // Look for time slot buttons in the widget HTML
    const timeRegex = /(\d{1,2}:\d{2}\s*(AM|PM))/gi;
    const matches = [...html.matchAll(timeRegex)];
    
    if (!matches.length) return null;

    const slots = matches.map(m => ({
      time: m[1],
      type: 'standard'
    }));

    return categorizeSlots(slots);
  } catch (e) {
    return null;
  }
}

function parsePageForSlots(html, date) {
  try {
    // Look for availability data in page JSON
    const jsonMatch = html.match(/__NEXT_DATA__.*?=\s*({.*?})\s*<\/script/s) ||
                      html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
    
    if (jsonMatch) {
      try {
        const pageData = JSON.parse(jsonMatch[1]);
        // Try to find slots in the data
        const slotsStr = JSON.stringify(pageData);
        const timeRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g;
        const times = [...slotsStr.matchAll(timeRegex)].map(m => m[1]);
        
        if (times.length) {
          const slots = times
            .filter(t => t.startsWith(date))
            .map(t => ({ time: t.split('T')[1], type: 'standard' }));
          return categorizeSlots(slots);
        }
      } catch (e) { /* ignore parse errors */ }
    }

    // Fallback: look for time slot patterns in HTML
    const timeRegex = /(\d{1,2}:\d{2}\s*(AM|PM))/gi;
    const matches = [...html.matchAll(timeRegex)];
    if (matches.length) {
      const slots = [...new Set(matches.map(m => m[1]))].map(t => ({
        time: t, type: 'standard'
      }));
      return categorizeSlots(slots);
    }

    // Check if "no availability" message exists
    if (html.includes('no availability') || html.includes('No tables') || 
        html.includes('fully booked') || html.includes('soldOut')) {
      return { score: 'sold_out', total_slots: 0, early: 0, prime: 0, late: 0, slots: [] };
    }

    return null;
  } catch (e) {
    return null;
  }
}

function categorizeSlots(slots) {
  if (!slots || !slots.length) {
    return { score: 'sold_out', total_slots: 0, early: 0, prime: 0, late: 0, slots: [] };
  }

  // Remove duplicates
  const unique = [...new Map(slots.map(s => [s.time, s])).values()];

  let early = 0, prime = 0, late = 0;

  for (const slot of unique) {
    const hour = parseHour(slot.time);
    if (hour === null) continue;
    if (hour >= 17 && hour < 18.5) early++;
    else if (hour >= 18.5 && hour < 20.5) prime++;
    else if (hour >= 20.5 && hour <= 22) late++;
  }

  const total = early + prime + late;
  let score;
  if (total === 0) score = 'sold_out';
  else if (total <= 2) score = 'nearly_full';
  else if (total <= 5) score = 'limited';
  else if (total <= 10) score = 'moderate';
  else score = 'available';

  return {
    score,
    total_slots: total,
    early,
    prime,
    late,
    slots: unique.map(s => s.time)
  };
}

function parseHour(timeStr) {
  if (!timeStr) return null;
  
  // Handle "7:30 PM" format
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h + m / 60;
  }

  // Handle "19:30" format
  const mil = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (mil) {
    return parseInt(mil[1]) + parseInt(mil[2]) / 60;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  // Load OT restaurants
  let otList;
  try { otList = JSON.parse(fs.readFileSync(OT_FILE, 'utf8')); }
  catch (e) { console.error('❌ Cannot load', OT_FILE); process.exit(1); }

  // Load existing availability data
  let availData = {};
  try { availData = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); }
  catch (e) { console.log('ℹ️ No existing availability data, starting fresh'); }

  // Deduplicate by URL
  const seen = new Set();
  const unique = otList.filter(r => {
    const slug = getSlug(r.url);
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  // Filter out already checked (unless --all)
  let toCheck;
  if (ALL_MODE) {
    toCheck = unique;
  } else {
    toCheck = unique.filter(r => {
      const key = r.name.toLowerCase().trim();
      const existing = availData[key];
      if (!existing) return true;
      // Recheck if last check was for a different date
      return existing.date !== CHECK_DATE;
    });
  }

  if (QUICK_MODE) toCheck = toCheck.slice(0, 50);

  console.log(`\n🍽️  OPENTABLE AVAILABILITY CHECKER`);
  console.log(`📅 Date: ${CHECK_DATE}`);
  console.log(`📊 Total OT restaurants: ${otList.length}`);
  console.log(`🔍 Unique slugs: ${unique.length}`);
  console.log(`✅ To check: ${toCheck.length}`);
  console.log(`⏱️  Estimated time: ~${Math.round(toCheck.length * 3 / 60)} minutes\n`);

  let success = 0, failed = 0, soldOut = 0;
  const SAVE_INTERVAL = 25;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    const slug = getSlug(r.url);
    const nameKey = r.name.toLowerCase().trim();

    process.stdout.write(`  [${i+1}/${toCheck.length}] ${r.name.substring(0,40).padEnd(40)} `);

    // Get restaurant ID (needed for some methods)
    const rid = await getRestaurantId(slug);
    await sleep(500);

    // Check availability
    const avail = await checkAvailability(slug, rid, CHECK_DATE);
    await sleep(1500);

    if (avail) {
      availData[nameKey] = {
        ...avail,
        date: CHECK_DATE,
        platform: 'opentable',
        checked: new Date().toISOString()
      };

      if (avail.score === 'sold_out') {
        console.log(`🔴 Sold out`);
        soldOut++;
      } else {
        console.log(`✅ ${avail.score} (${avail.total_slots} slots: ${avail.early}E/${avail.prime}P/${avail.late}L)`);
      }
      success++;
    } else {
      console.log(`❌ Could not check`);
      failed++;
    }

    // Save progress
    if ((i + 1) % SAVE_INTERVAL === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(availData, null, 2));
      console.log(`  💾 Progress saved (${i+1}/${toCheck.length})`);
    }
  }

  // Final save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availData, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Checked:    ${success}`);
  console.log(`   🔴 Sold out:   ${soldOut}`);
  console.log(`   ❌ Failed:     ${failed}`);
  console.log(`\n💾 Saved to ${AVAIL_FILE}`);
  console.log(`\nTo deploy:`);
  console.log(`  cp availability_data.json netlify/functions/availability_data.json`);
  console.log(`  git add -A && git commit -m "OT availability update" && git push`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
