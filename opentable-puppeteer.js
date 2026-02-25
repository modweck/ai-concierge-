/**
 * OpenTable Puppeteer Tool
 * ========================
 * Uses headless Chrome to search OpenTable and check availability.
 * OpenTable blocks all API/curl requests, so we need a real browser.
 * 
 * INSTALL: npm install puppeteer
 * 
 * USAGE:
 *   node opentable-puppeteer.js --search          Search Google restaurants for OT links
 *   node opentable-puppeteer.js --availability     Check availability for curated OT restaurants  
 *   node opentable-puppeteer.js --search --quick   Search first 20 only (test mode)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const args = process.argv.slice(2);
const MODE_SEARCH = args.includes('--search');
const MODE_AVAIL = args.includes('--availability');
const QUICK = args.includes('--quick');

if (!MODE_SEARCH && !MODE_AVAIL) {
  console.log('Usage:');
  console.log('  node opentable-puppeteer.js --search          Find OT links for Google restaurants');
  console.log('  node opentable-puppeteer.js --availability     Check availability for OT restaurants');
  console.log('  Add --quick for test mode (20 restaurants)');
  process.exit(0);
}

const BOOKING_FILE = path.join(__dirname, 'netlify/functions/booking_lookup.json');
const GOOGLE_FILE = path.join(__dirname, 'google_restaurants.json');
const AVAIL_FILE = path.join(__dirname, 'netlify/functions/availability_data.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SEARCH MODE: Find OpenTable links for Google restaurants ───

async function searchMode() {
  const BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const GOOGLE = JSON.parse(fs.readFileSync(GOOGLE_FILE, 'utf8'));
  
  // Filter to restaurants without Resy/OT links
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

  if (QUICK) toSearch = toSearch.slice(0, 20);

  console.log(`\n🔍 OPENTABLE SEARCH (Puppeteer)`);
  console.log(`📊 ${toSearch.length} restaurants to search\n`);

  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  let found = 0, notFound = 0;
  const newEntries = {};

  for (let i = 0; i < toSearch.length; i++) {
    const name = toSearch[i].name;
    const cleanName = name.replace(/[^\w\s]/g, '').trim();
    process.stdout.write(`  [${i+1}/${toSearch.length}] ${name}...`);

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      
      // Go to OpenTable search
      const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(cleanName + ' new york')}&metroId=8`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      
      // Wait for results to load
      await sleep(2000);
      
      // Look for restaurant links in search results
      const result = await page.evaluate((searchName) => {
        // Find all restaurant links on the page
        const links = document.querySelectorAll('a[href*="/r/"]');
        if (!links.length) return null;
        
        const clean = str => str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const searchClean = clean(searchName);
        const searchWords = searchClean.split(' ').filter(w => w.length > 2);
        
        let bestMatch = null;
        let bestScore = 0;
        
        for (const link of links) {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/r/')) continue;
          
          // Get restaurant name from the link or nearby text
          const text = link.textContent || link.innerText || '';
          const linkClean = clean(text);
          
          if (!linkClean || linkClean.length < 3) continue;
          
          // Score: exact match
          if (linkClean === searchClean) {
            bestMatch = { name: text.trim(), url: href };
            bestScore = 1;
            break;
          }
          
          // Score: word overlap
          const linkWords = linkClean.split(' ').filter(w => w.length > 2);
          const overlap = searchWords.filter(w => linkWords.some(lw => lw.includes(w) || w.includes(lw)));
          const score = searchWords.length > 0 ? overlap.length / searchWords.length : 0;
          
          if (score > bestScore && score >= 0.5) {
            bestScore = score;
            bestMatch = { name: text.trim(), url: href };
          }
        }
        
        return bestMatch;
      }, cleanName);
      
      if (result && result.url) {
        // Make sure it's a full URL
        const fullUrl = result.url.startsWith('http') 
          ? result.url 
          : `https://www.opentable.com${result.url}`;
        
        // Verify it's actually bookable (not just an info page)
        await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(1500);
        
        const isBookable = await page.evaluate(() => {
          const text = document.body.innerText || '';
          // Check for "Not available on OpenTable" or similar
          if (text.includes('Not taking reservations') || 
              text.includes('not available on OpenTable') ||
              text.includes('does not take reservations')) {
            return false;
          }
          // Check for time slot buttons
          const slots = document.querySelectorAll('[data-test="time-slot"], button[class*="time"], [class*="TimeSlot"]');
          return slots.length > 0 || text.includes('Find a time');
        });
        
        if (isBookable) {
          console.log(` ✅ ${result.name} → ${fullUrl.split('/r/')[1] || fullUrl}`);
          newEntries[name.toLowerCase().trim()] = {
            platform: 'opentable',
            url: fullUrl
          };
          found++;
        } else {
          console.log(` ⚠️  Page exists but not bookable`);
          notFound++;
        }
      } else {
        console.log(` ❌`);
        notFound++;
      }
      
      await page.close();
    } catch (err) {
      console.log(` ❌ (${err.message.slice(0, 40)})`);
      notFound++;
    }
    
    // Rate limit
    await sleep(2000);
  }

  await browser.close();

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`✅ Found: ${found} | ❌ Not found: ${notFound}`);
  
  if (Object.keys(newEntries).length > 0) {
    const merged = { ...BOOKING, ...newEntries };
    fs.writeFileSync(BOOKING_FILE, JSON.stringify(merged, null, 2));
    console.log(`💾 booking_lookup.json: ${Object.keys(BOOKING).length} → ${Object.keys(merged).length}`);
  }
  console.log('Done!\n');
}

// ─── AVAILABILITY MODE: Check availability for curated OT restaurants ───

async function availabilityMode() {
  const BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  
  // Load existing availability data
  let availData = {};
  try { availData = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); } catch(e) {}
  
  // Get curated OpenTable restaurants
  const otRestaurants = [];
  for (const [name, info] of Object.entries(BOOKING)) {
    const url = info.url || '';
    if (url.includes('opentable.com/r/')) {
      otRestaurants.push({ name, url, slug: url.split('/r/')[1] });
    }
  }
  
  // Filter to curated only if we have curated lists
  // For now just do all OT restaurants
  let toCheck = QUICK ? otRestaurants.slice(0, 20) : otRestaurants;
  
  console.log(`\n🔴 OPENTABLE AVAILABILITY CHECKER (Puppeteer)`);
  console.log(`📊 ${toCheck.length} restaurants to check`);
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  console.log(`📅 Date: ${dateStr} | 👥 Party: 2\n`);

  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let available = 0, soldOut = 0, errors = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const { name, url, slug } = toCheck[i];
    process.stdout.write(`  [${i+1}/${toCheck.length}] ${name}...`);

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      
      // Go to restaurant page with date params
      const pageUrl = `${url}?dateTime=${dateStr}T19%3A00&covers=2`;
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(3000);
      
      // Extract availability info
      const result = await page.evaluate(() => {
        const text = document.body.innerText || '';
        
        // Not bookable
        if (text.includes('Not taking reservations') || 
            text.includes('not available on OpenTable') ||
            text.includes('does not take reservations')) {
          return { status: 'not_bookable', slots: [] };
        }
        
        // Find time slots
        const slotElements = document.querySelectorAll(
          '[data-test="time-slot"], button[class*="time"], [class*="TimeSlot"], [data-test*="slot"]'
        );
        
        const slots = [];
        for (const el of slotElements) {
          const timeText = el.textContent || el.innerText || '';
          const time = timeText.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
          if (time) {
            slots.push(time[0]);
          }
        }
        
        // Also try to find times in text
        if (slots.length === 0) {
          const timeMatches = text.match(/\d{1,2}:\d{2}\s*(AM|PM)/gi) || [];
          // Filter to dinner times (5-10pm range)
          for (const t of timeMatches) {
            const hour = parseInt(t);
            const isPM = t.toUpperCase().includes('PM');
            if (isPM && hour >= 5 && hour <= 10) {
              slots.push(t);
            }
          }
        }
        
        if (slots.length > 0) {
          return { status: 'available', slots: [...new Set(slots)] };
        }
        
        // Check for "no availability" messages
        if (text.includes('No availability') || text.includes('no times available') ||
            text.includes('fully booked')) {
          return { status: 'sold_out', slots: [] };
        }
        
        return { status: 'unknown', slots: [] };
      });
      
      if (result.status === 'available') {
        console.log(` 🟢 ${result.slots.length} slots (${result.slots.slice(0,3).join(', ')})`);
        available++;
        
        // Save to availability data
        availData[name] = {
          platform: 'opentable',
          status: 'available',
          total_slots: result.slots.length,
          slots: result.slots,
          url,
          checked_date: dateStr,
          checked_at: new Date().toISOString()
        };
      } else if (result.status === 'sold_out') {
        console.log(` 🔴 Sold out`);
        soldOut++;
        availData[name] = {
          platform: 'opentable',
          status: 'sold_out',
          total_slots: 0,
          slots: [],
          url,
          checked_date: dateStr,
          checked_at: new Date().toISOString()
        };
      } else if (result.status === 'not_bookable') {
        console.log(` ⚪ Not bookable on OT`);
        errors++;
      } else {
        console.log(` ❓ Unknown`);
        errors++;
      }
      
      await page.close();
    } catch (err) {
      console.log(` ❌ (${err.message.slice(0, 40)})`);
      errors++;
    }
    
    await sleep(2500);
  }

  await browser.close();

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`🟢 Available: ${available} | 🔴 Sold out: ${soldOut} | ❌ Errors: ${errors}`);
  
  // Save availability data
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(availData, null, 2));
  console.log(`💾 Saved to ${AVAIL_FILE}`);
  console.log('Done!\n');
}

// ─── RUN ───

async function main() {
  if (MODE_SEARCH) await searchMode();
  if (MODE_AVAIL) await availabilityMode();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
