/**
 * OpenTable Puppeteer Tool v2
 * ===========================
 * Uses real OpenTable HTML selectors from actual page inspection.
 * 
 * KEY FINDING: The search results page already shows time slots!
 * So we can find restaurants AND check availability in one search.
 *
 * Selectors (from real OpenTable HTML):
 *   - Search results list: ol[data-test="restaurant-cards"]
 *   - Restaurant card: div[data-test="pinned-restaurant-card"] or div.multiSearchRestaurantCard
 *   - Restaurant link: a[data-test^="restaurant-card-profile-link"]
 *   - Time slots: ul[data-test="time-slots"]
 *   - Individual slot: li[data-test^="time-slot-"]
 *   - Restaurant ID: data-rid attribute on the card
 * 
 * INSTALL: npm install puppeteer
 * 
 * USAGE:
 *   node opentable-puppeteer-v2.js --search          Find OT links for Google restaurants
 *   node opentable-puppeteer-v2.js --availability     Check availability for existing OT restaurants
 *   node opentable-puppeteer-v2.js --both             Do both
 *   Add --quick for test mode (first 10)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const MODE_SEARCH = args.includes('--search') || args.includes('--both');
const MODE_AVAIL = args.includes('--availability') || args.includes('--both');
const QUICK = args.includes('--quick');

if (!MODE_SEARCH && !MODE_AVAIL) {
  console.log('Usage:');
  console.log('  node opentable-puppeteer-v2.js --search          Find OT links for Google restaurants');
  console.log('  node opentable-puppeteer-v2.js --availability     Check availability for OT restaurants');
  console.log('  node opentable-puppeteer-v2.js --both             Do both');
  console.log('  Add --quick for test mode (10 restaurants)');
  process.exit(0);
}

const BOOKING_FILE = path.join(__dirname, 'netlify/functions/booking_lookup.json');
const GOOGLE_FILE = path.join(__dirname, 'google_restaurants.json');
const AVAIL_FILE = path.join(__dirname, 'netlify/functions/availability_data.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tomorrow's date for availability
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const DATE_STR = tomorrow.toISOString().split('T')[0];

/**
 * Search OpenTable for a restaurant and extract results + time slots
 * Returns: { name, url, rid, slots[] } or null
 */
async function searchOpenTable(page, restaurantName) {
  const cleanName = restaurantName
    .replace(/\(.*\)/g, '')
    .replace(/[^\w\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName)}&dateTime=${DATE_STR}T19%3A00%3A00&covers=2&metroId=8`;

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2500);

    // Extract restaurant cards from search results
    const results = await page.evaluate((searchName) => {
      const clean = str => str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const searchClean = clean(searchName);
      const searchWords = searchClean.split(' ').filter(w => w.length > 2);
      
      // Stop words to ignore in matching
      const stopWords = ['the', 'and', 'restaurant', 'bar', 'grill', 'cafe', 'kitchen', 'nyc', 'new', 'york'];

      // Find all restaurant cards
      const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"], [data-test="restaurant-card"], .multiSearchRestaurantCard');
      
      const matches = [];
      
      for (const card of cards) {
        // Get restaurant link
        const link = card.querySelector('a[data-test^="restaurant-card-profile-link"]') 
                  || card.querySelector('a[href*="opentable.com/"]');
        if (!link) continue;
        
        const href = link.getAttribute('href') || '';
        const name = link.textContent.trim();
        const rid = card.getAttribute('data-rid') || '';
        
        if (!name || !href) continue;
        
        // Score match
        const nameClean = clean(name);
        const nameWords = nameClean.split(' ').filter(w => w.length > 2 && !stopWords.includes(w));
        const filteredSearch = searchWords.filter(w => !stopWords.includes(w));
        
        let score = 0;
        if (nameClean === searchClean) {
          score = 1.0;
        } else if (nameClean.includes(searchClean) || searchClean.includes(nameClean)) {
          score = 0.9;
        } else if (filteredSearch.length > 0) {
          const overlap = filteredSearch.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw)));
          score = overlap.length / filteredSearch.length;
        }
        
        // Get time slots from this card
        const slotList = card.querySelector('ul[data-test="time-slots"]');
        const slots = [];
        if (slotList) {
          const slotItems = slotList.querySelectorAll('li[data-test^="time-slot"]');
          for (const item of slotItems) {
            const timeText = item.textContent.trim();
            if (timeText) slots.push(timeText);
          }
        }
        
        matches.push({ name, url: href, rid, score, slots });
      }
      
      // Return best match above threshold
      matches.sort((a, b) => b.score - a.score);
      return matches.length > 0 && matches[0].score >= 0.5 ? matches[0] : null;
      
    }, cleanName);

    return results;

  } catch (err) {
    return null;
  }
}


// ─── SEARCH MODE ───

async function searchMode(browser) {
  const BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const GOOGLE = JSON.parse(fs.readFileSync(GOOGLE_FILE, 'utf8'));

  function hasBooking(name) {
    const clean = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const k of Object.keys(BOOKING)) {
      const kc = k.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (kc === clean) {
        const url = BOOKING[k].url || '';
        if (url.includes('resy.com') || url.includes('opentable.com')) return true;
      }
    }
    return false;
  }

  let toSearch = GOOGLE.filter(r => {
    if (!r.name || r.name.length < 3 || /^\d/.test(r.name)) return false;
    return !hasBooking(r.name);
  });

  if (QUICK) toSearch = toSearch.slice(0, 10);

  console.log(`\n🔍 OPENTABLE SEARCH (Puppeteer v2)`);
  console.log(`📊 ${toSearch.length} restaurants to search`);
  console.log(`📅 Date: ${DATE_STR} | 👥 Party: 2\n`);

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let found = 0, notFound = 0;
  const newEntries = {};

  for (let i = 0; i < toSearch.length; i++) {
    const name = toSearch[i].name;
    process.stdout.write(`  [${i + 1}/${toSearch.length}] ${name}...`);

    const result = await searchOpenTable(page, name);

    if (result && result.url) {
      const fullUrl = result.url.startsWith('http') ? result.url : `https://www.opentable.com${result.url}`;
      const slotsInfo = result.slots.length > 0 
        ? ` (${result.slots.length} slots: ${result.slots.slice(0, 3).join(', ')})` 
        : ' (no slots shown)';
      console.log(` ✅ ${result.name}${slotsInfo}`);
      
      newEntries[name.toLowerCase().trim()] = {
        platform: 'opentable',
        url: fullUrl
      };
      found++;
    } else {
      console.log(` ❌`);
      notFound++;
    }

    await sleep(2000);
  }

  await page.close();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ Found: ${found} | ❌ Not found: ${notFound}`);

  if (Object.keys(newEntries).length > 0) {
    const merged = { ...BOOKING, ...newEntries };
    fs.writeFileSync(BOOKING_FILE, JSON.stringify(merged, null, 2));
    console.log(`💾 booking_lookup.json: ${Object.keys(BOOKING).length} → ${Object.keys(merged).length}`);
  }
  console.log('');
}


// ─── AVAILABILITY MODE ───

async function availabilityMode(browser) {
  const BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

  // Load existing availability data
  let availData = {};
  try { availData = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); } catch (e) {}

  // Get all OpenTable restaurants from booking_lookup
  const otRestaurants = [];
  for (const [name, info] of Object.entries(BOOKING)) {
    const url = info.url || '';
    if (url.includes('opentable.com')) {
      otRestaurants.push({ name, url });
    }
  }

  let toCheck = QUICK ? otRestaurants.slice(0, 10) : otRestaurants;

  console.log(`\n🔴 OPENTABLE AVAILABILITY (Puppeteer v2)`);
  console.log(`📊 ${toCheck.length} restaurants to check`);
  console.log(`📅 Date: ${DATE_STR} | 👥 Party: 2\n`);

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  let available = 0, soldOut = 0, errors = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const { name, url } = toCheck[i];
    process.stdout.write(`  [${i + 1}/${toCheck.length}] ${name}...`);

    // Search by name to get time slots from search results
    const result = await searchOpenTable(page, name);

    if (result && result.slots.length > 0) {
      console.log(` 🟢 ${result.slots.length} slots (${result.slots.slice(0, 4).join(', ')})`);
      available++;

      availData[name] = {
        platform: 'opentable',
        status: 'available',
        total_slots: result.slots.length,
        prime_slots: result.slots.length, // all shown slots are prime on OT
        slots: result.slots,
        url,
        checked_date: DATE_STR,
        checked_at: new Date().toISOString()
      };
    } else if (result && result.url) {
      console.log(` 🔴 Found but no slots`);
      soldOut++;

      availData[name] = {
        platform: 'opentable',
        status: 'sold_out',
        total_slots: 0,
        prime_slots: 0,
        slots: [],
        url,
        checked_date: DATE_STR,
        checked_at: new Date().toISOString()
      };
    } else {
      console.log(` ❌ Not found on OT`);
      errors++;
    }

    await sleep(2000);
  }

  await page.close();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🟢 Available: ${available} | 🔴 Sold out: ${soldOut} | ❌ Errors: ${errors}`);

  // Save
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availData, null, 2));
  console.log(`💾 Saved to availability_data.json`);
  console.log('');
}


// ─── MAIN ───

async function main() {
  console.log('\n🚀 OpenTable Puppeteer v2');
  console.log('   Using real selectors: data-test="time-slots", data-test="time-slot-N"');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  });

  try {
    if (MODE_SEARCH) await searchMode(browser);
    if (MODE_AVAIL) await availabilityMode(browser);
  } finally {
    await browser.close();
  }

  console.log('✅ All done!\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
