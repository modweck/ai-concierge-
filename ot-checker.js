#!/usr/bin/env node
/**
 * OPENTABLE CHECKER
 * =================
 * Checks if remaining no-booking restaurants are on OpenTable
 * using OT's autocomplete/search endpoint.
 *
 * RUN: cd ~/ai-concierge- && node ot-checker.js
 * OPTIONS:
 *   --quick    Check first 30 only
 *   --save     Write matches to booking_lookup.json
 */

const fs = require('fs');
const path = require('path');

const QUICK = process.argv.includes('--quick');
const SAVE = process.argv.includes('--save');
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

const popular = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
const booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
const bookingKeys = new Set(Object.keys(booking).map(k => k.toLowerCase().trim()));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Find restaurants with no booking at all
const candidates = popular.filter(r => {
  const key = (r.name || '').toLowerCase().trim();
  if (!key) return false;
  if (bookingKeys.has(key)) return false;
  if (r.booking_platform) return false;
  return true;
}).sort((a, b) => (b.googleReviewCount || 0) - (a.googleReviewCount || 0));

const limit = QUICK ? 30 : candidates.length;

console.log(`\n🔍 OPENTABLE CHECKER`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 No-booking restaurants: ${candidates.length}`);
console.log(`📊 Will check: ${Math.min(limit, candidates.length)}\n`);

// ═══════════════════════════════════════════
// OpenTable autocomplete search
// ═══════════════════════════════════════════

async function searchOT(name, lat, lng) {
  try {
    // Method 1: OT autocomplete/suggest endpoint
    const q = encodeURIComponent(name);
    const url = `https://www.opentable.com/dapi/fe/gql?optype=autocomplete`;
    
    const resp = await fetch('https://www.opentable.com/dapi/fe/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://www.opentable.com',
        'Referer': 'https://www.opentable.com/',
      },
      body: JSON.stringify({
        operationName: 'Autocomplete',
        variables: {
          term: name,
          latitude: lat || 40.7128,
          longitude: lng || -74.006,
        },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: 'e2e97bcfe40cdbcbbfbef73282e6ee7e2fec886fa42b43e0b0e38e7be3d3cfce'
          }
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const results = data?.data?.autocomplete?.restaurants || [];
      
      for (const r of results) {
        const otName = (r.name || '').toLowerCase().trim();
        const ourName = name.toLowerCase().trim();
        
        if (namesMatch(ourName, otName)) {
          const rid = r.rid || r.restaurantId || '';
          const slug = r.profileLink || '';
          let url = '';
          if (slug) {
            url = slug.startsWith('http') ? slug : `https://www.opentable.com${slug}`;
          } else if (rid) {
            url = `https://www.opentable.com/restref/client/?rid=${rid}`;
          }
          
          return {
            found: true,
            platform: 'opentable',
            url,
            ot_name: r.name,
            rid
          };
        }
      }
    }
  } catch (e) {
    // GraphQL endpoint might not work, try fallback
  }

  // Method 2: Simple slug guess + fetch
  try {
    const slugs = generateSlugs(name);
    for (const slug of slugs) {
      const url = `https://www.opentable.com/r/${slug}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        redirect: 'follow'
      });

      if (resp.ok) {
        const html = await resp.text();
        if (html.includes('data-restaurant-id') ||
            html.includes('"restaurantId"') ||
            html.includes('RestaurantProfile') ||
            html.includes('og:type" content="restaurant"')) {
          
          // Extract restaurant name from page to verify match
          const titleMatch = html.match(/<title>([^<]+)/);
          const pageName = titleMatch ? titleMatch[1].replace(/ - OpenTable.*/, '').replace(/Reservations.*/, '').trim() : '';
          
          if (pageName && namesMatch(name.toLowerCase(), pageName.toLowerCase())) {
            return {
              found: true,
              platform: 'opentable',
              url: resp.url || url,
              ot_name: pageName
            };
          }
        }
      }
      await sleep(300);
    }
  } catch (e) {
    // ignore
  }

  return { found: false };
}

function generateSlugs(name) {
  const base = name.toLowerCase()
    .replace(/[''""`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set([base]);
  slugs.add(`${base}-new-york`);
  slugs.add(`${base}-brooklyn`);
  slugs.add(`${base}-manhattan`);

  // Without location suffixes
  const locSuffixes = ['-nyc', '-new-york', '-brooklyn', '-manhattan', '-queens',
    '-astoria', '-harlem', '-lic', '-restaurant', '-and-bar'];
  for (const suf of locSuffixes) {
    if (base.endsWith(suf)) {
      const stripped = base.slice(0, -suf.length);
      slugs.add(stripped);
      slugs.add(`${stripped}-new-york`);
    }
  }

  // Without "the-"
  if (base.startsWith('the-')) {
    slugs.add(base.slice(4));
    slugs.add(`${base.slice(4)}-new-york`);
  }

  return [...slugs].filter(s => s.length >= 3);
}

function namesMatch(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  
  // Word overlap
  const wa = new Set(a.split(/[\s\-,]+/).filter(w => w.length > 2));
  const wb = new Set(b.split(/[\s\-,]+/).filter(w => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
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

    process.stdout.write(`  [${i+1}/${Math.min(limit, candidates.length)}] ${name}...`);

    const result = await searchOT(name, lat, lng);
    
    if (result.found) {
      console.log(` ✅ OT → ${result.ot_name}`);
      found.push({ name, result });
    } else {
      console.log(` ❌`);
      notFound.push(name);
    }

    await sleep(500);
  }

  // Save if requested
  if (SAVE && found.length > 0) {
    let added = 0;
    for (const f of found) {
      const key = f.name.toLowerCase().trim();
      if (!booking[key]) {
        booking[key] = { platform: f.result.platform, url: f.result.url };
        added++;
      }
    }
    fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
    console.log(`\n💾 SAVED: Added ${added} entries. Total: ${Object.keys(booking).length}`);
  }

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes`);
  console.log(`  Found on OT: ${found.length}`);
  console.log(`  Not on OT: ${notFound.length}`);

  if (found.length > 0 && !SAVE) {
    console.log(`\n⚠️  Run with --save to add to booking_lookup.json`);
  }
  if (found.length > 0 && SAVE) {
    console.log(`\n📋 Next: git add -A && git commit -m "Add ${found.length} OT links" && git push`);
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
