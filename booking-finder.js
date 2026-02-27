#!/usr/bin/env node
/**
 * SEATWIZE BOOKING FINDER
 * ========================
 * Finds Resy and OpenTable links for restaurants in popular_nyc
 * that don't have booking links yet.
 *
 * NO Google API calls. Only hits Resy search API + OpenTable pages.
 *
 * RUN: cd ~/ai-concierge- && node booking-finder.js
 * OPTIONS:
 *   --quick       Only check 30 restaurants (for testing)
 *   --resy-only   Skip OpenTable checks
 *   --ot-only     Skip Resy checks
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESY_ONLY = args.includes('--resy-only');
const OT_ONLY = args.includes('--ot-only');

const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

let POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
let BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

const bookingKeys = new Set(Object.keys(BOOKING).map(k => k.toLowerCase().trim()));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
// Find restaurants without booking links
// ═══════════════════════════════════════════

const candidates = POPULAR.filter(r => {
  const key = (r.name || '').toLowerCase().trim();
  if (!key) return false;
  if (r.booking_platform && r.booking_url) return false;
  if (bookingKeys.has(key)) return false;
  return true;
}).sort((a, b) => (b.googleRating || 0) - (a.googleRating || 0));

console.log(`\n🔍 SEATWIZE BOOKING FINDER`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Popular: ${POPULAR.length} | Booking: ${Object.keys(BOOKING).length}`);
console.log(`📊 Missing booking links: ${candidates.length}`);

if (!candidates.length) {
  console.log('\n🎉 All restaurants have booking links!');
  process.exit(0);
}

const limit = QUICK ? 30 : candidates.length;
console.log(`📊 Will check: ${Math.min(limit, candidates.length)}\n`);

// ═══════════════════════════════════════════
// RESY SEARCH
// ═══════════════════════════════════════════

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const RESY_HEADERS = {
  'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json'
};

async function findResy(name, lat, lng) {
  try {
    // Method 1: Search API
    const q = encodeURIComponent(name);
    const url = `https://api.resy.com/3/venuesearch/search?query=${q}&lat=${lat || 40.7128}&long=${lng || -74.006}&per_page=5`;
    const resp = await fetch(url, { headers: RESY_HEADERS });

    if (resp.ok) {
      const data = await resp.json();
      const hits = data?.search?.hits || [];
      const nameLower = name.toLowerCase().trim();

      for (const hit of hits) {
        const hitName = (hit.name || '').toLowerCase().trim();
        if (hitName === nameLower ||
            hitName.includes(nameLower) ||
            nameLower.includes(hitName) ||
            wordOverlap(hitName, nameLower) >= 0.7) {
          const slug = hit.url_slug || '';
          const loc = hit.location?.code || 'ny';
          if (slug) {
            return {
              found: true,
              platform: 'resy',
              url: `https://resy.com/cities/${loc}/${slug}`,
              resy_name: hit.name
            };
          }
        }
      }
    }

    // Method 2: Guess slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-').trim();

    const vResp = await fetch(
      `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`,
      { headers: RESY_HEADERS }
    );

    if (vResp.ok) {
      const vData = await vResp.json();
      if (vData?.id?.resy) {
        return {
          found: true,
          platform: 'resy',
          url: `https://resy.com/cities/ny/${slug}`,
          resy_name: vData.name
        };
      }
    }

    return { found: false };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

// ═══════════════════════════════════════════
// OPENTABLE SEARCH
// ═══════════════════════════════════════════

async function findOpenTable(name, address) {
  const base = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Try a few slug variations
  const slugs = [base];
  const shortened = base
    .replace(/-restaurant$/,'').replace(/-nyc$/,'')
    .replace(/-new-york$/,'').replace(/-bar-and-grill$/,'');
  if (shortened !== base) slugs.push(shortened);
  slugs.push(`${base}-new-york`);

  for (const slug of slugs) {
    try {
      const url = `https://www.opentable.com/r/${slug}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html'
        },
        redirect: 'follow'
      });

      if (resp.ok) {
        const html = await resp.text();
        if (html.includes('data-restaurant-id') ||
            html.includes('"restaurantId"') ||
            html.includes('RestaurantProfile') ||
            html.includes('og:type" content="restaurant"')) {
          
          let rid = null;
          const m = html.match(/data-restaurant-id="(\d+)"/) ||
                    html.match(/"rid"\s*:\s*(\d+)/) ||
                    html.match(/"restaurantId"\s*:\s*(\d+)/);
          if (m) rid = m[1];

          return {
            found: true,
            platform: 'opentable',
            url: resp.url || url,
            restaurant_id: rid
          };
        }
      }
      await sleep(200);
    } catch (e) {
      continue;
    }
  }

  return { found: false };
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function wordOverlap(a, b) {
  const wa = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wb = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap / Math.min(wa.size, wb.size);
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  const found = [];
  const notFound = [];

  for (let i = 0; i < Math.min(limit, candidates.length); i++) {
    const r = candidates[i];
    const name = r.name;
    const lat = r.lat || (r.geometry?.location?.lat);
    const lng = r.lng || (r.geometry?.location?.lng);
    const addr = r.address || '';

    process.stdout.write(`  [${i+1}/${Math.min(limit, candidates.length)}] ${name}...`);

    // Try Resy first (faster API)
    if (!OT_ONLY) {
      const resy = await findResy(name, lat, lng);
      if (resy.found) {
        console.log(` ✅ Resy: ${resy.url}`);
        found.push({ name, result: resy });

        // Add to booking_lookup
        const key = name.toLowerCase().trim();
        BOOKING[key] = { platform: 'resy', url: resy.url };
        await sleep(400);
        continue;
      }
      await sleep(300);
    }

    // Try OpenTable
    if (!RESY_ONLY) {
      const ot = await findOpenTable(name, addr);
      if (ot.found) {
        console.log(` ✅ OT: ${ot.url}`);
        found.push({ name, result: ot });

        const key = name.toLowerCase().trim();
        BOOKING[key] = {
          platform: 'opentable',
          url: ot.url,
          ...(ot.restaurant_id ? { restaurant_id: ot.restaurant_id } : {})
        };
        await sleep(400);
        continue;
      }
      await sleep(200);
    }

    console.log(` ❌`);
    notFound.push(name);
  }

  // Save
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(BOOKING, null, 2));

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes`);
  console.log(`\n📊 Results:`);
  console.log(`  Found: ${found.length}`);
  console.log(`    Resy: ${found.filter(f => f.result.platform === 'resy').length}`);
  console.log(`    OpenTable: ${found.filter(f => f.result.platform === 'opentable').length}`);
  console.log(`  Not found: ${notFound.length}`);
  console.log(`  Booking lookup total: ${Object.keys(BOOKING).length}`);
  console.log(`\n📋 Next: git add -A && git commit -m "Add booking links from finder" && git push`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
