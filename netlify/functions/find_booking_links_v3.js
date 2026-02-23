#!/usr/bin/env node
/**
 * BOOKING LINK FINDER v3 — Strict name validation
 * 
 * v1 problem: Resy HTTP 200 for all URLs (SPA)
 * v2 problem: Resy API url_slug endpoint returns a venue for ANY slug
 * v3 fix: Compare returned venue name against searched name for ALL lookups
 * 
 * Run from: netlify/functions/
 *   node find_booking_links_v3.js
 */

const fs = require('fs');
const path = require('path');

const POPULAR_PATH = path.join(__dirname, 'popular_nyc.json');
const BOOKING_PATH = path.join(__dirname, 'booking_lookup.json');
const BACKUP_PATH = path.join(__dirname, 'booking_lookup.pre_find_v3.json');
const REPORT_PATH = path.join(__dirname, 'booking_find_v3_report.json');

const CONCURRENCY = 3;
const DELAY_MS = 500;
const TIMEOUT_MS = 6000;
const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-\u2013\u2014]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|caf\u00e9|bistro|brasserie|kitchen|dining|room)$/i, '')
    .replace(/^the\s+/, '')
    .replace(/[''\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(name) {
  return (name || '').toLowerCase().trim()
    .replace(/['\u2019]/g, '')
    .replace(/&/g, 'and')
    .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, 'e')
    .replace(/[\u00e1\u00e0\u00e2\u00e3\u00e4]/g, 'a')
    .replace(/[\u00ed\u00ec\u00ee\u00ef]/g, 'i')
    .replace(/[\u00f3\u00f2\u00f4\u00f6\u00f5]/g, 'o')
    .replace(/[\u00fa\u00f9\u00fb\u00fc]/g, 'u')
    .replace(/\u00f1/g, 'n').replace(/\u00e7/g, 'c')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * STRICT name matching - the core fix for v3
 * Returns true only if names are genuinely the same restaurant
 */
function namesMatch(searchName, returnedName) {
  const a = normalize(searchName);
  const b = normalize(returnedName);
  
  if (!a || !b) return false;
  
  // Exact match after normalization
  if (a === b) return true;
  
  // One contains the other, but only if the shorter one is at least 4 chars
  // (prevents "bar" matching "bar bete")
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  
  // Check word overlap - at least 70% of words must match
  const wordsA = a.split(' ').filter(w => w.length > 2);
  const wordsB = b.split(' ').filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  
  const matchCount = wordsA.filter(w => wordsB.includes(w)).length;
  const overlapRatio = matchCount / Math.max(wordsA.length, wordsB.length);
  
  return overlapRatio >= 0.7;
}

// ═══════════════════════════════════════════════════════
// RESY — Use their API with STRICT name validation
// ═══════════════════════════════════════════════════════
async function searchResy(restaurantName) {
  try {
    // Method 1: Try url_slug lookup
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const slug = slugify(restaurantName);
    const url = `https://api.resy.com/3/venue?url_slug=${slug}&location=new-york-ny`;

    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/'
      }
    });

    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.id && data.id.resy && data.name) {
        // v3 FIX: Verify the returned venue name matches what we searched for
        if (namesMatch(restaurantName, data.name)) {
          const venueSlug = data.url_slug || slug;
          const loc = data.location;
          const city = loc ? (loc.code || 'ny') : 'ny';
          return {
            found: true,
            platform: 'resy',
            url: `https://resy.com/cities/${city}/${venueSlug}`,
            name: data.name,
            matchedVia: 'slug'
          };
        }
        // Name didn't match - this is a false positive
      }
    }

    // Method 2: Try search endpoint
    const query = encodeURIComponent(restaurantName);
    const searchUrl = `https://api.resy.com/3/venuesearch/search?query=${query}&geo={"latitude":40.7128,"longitude":-74.0060}&per_page=5&types=["venue"]`;

    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), TIMEOUT_MS);

    const resp2 = await fetch(searchUrl, {
      method: 'GET',
      signal: controller2.signal,
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/'
      }
    });

    clearTimeout(timeout2);

    if (resp2.ok) {
      const data2 = await resp2.json();
      const hits = data2.search && data2.search.hits;
      if (hits && hits.length > 0) {
        for (const hit of hits) {
          if (namesMatch(restaurantName, hit.name || '')) {
            const hitSlug = hit.url_slug || slugify(hit.name);
            const region = hit.region || 'new-york-ny';
            return {
              found: true,
              platform: 'resy',
              url: `https://resy.com/cities/${region}/${hitSlug}`,
              name: hit.name,
              matchedVia: 'search'
            };
          }
        }
      }
    }

    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════
// OPENTABLE — Check with content validation
// ═══════════════════════════════════════════════════════
async function searchOpenTable(restaurantName) {
  const slug = slugify(restaurantName);
  if (slug.length < 2) return { found: false };

  const candidates = [
    `https://www.opentable.com/r/${slug}-new-york`,
    `https://www.opentable.com/r/${slug}-brooklyn`,
    `https://www.opentable.com/${slug}`
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html'
        },
        redirect: 'follow'
      });

      clearTimeout(timeout);

      if (!resp.ok) continue;

      const text = await resp.text().catch(() => '');
      const finalUrl = resp.url || url;

      // Reject redirects to homepage or search
      if (finalUrl === 'https://www.opentable.com/' ||
          finalUrl.includes('/s?') ||
          finalUrl.includes('/start/home')) continue;

      // Must contain restaurant-like content
      if (text.includes('Make a reservation') ||
          text.includes('Find a time') ||
          text.includes('Booked') ||
          text.includes('restProfileSummary') ||
          (text.includes('opentable') && text.includes('restaurant'))) {
        if (text.includes('Page Not Found') ||
            text.includes('page-not-found') ||
            text.includes('404 -')) continue;

        return {
          found: true,
          platform: 'opentable',
          url: url
        };
      }
    } catch (err) {
      continue;
    }
  }

  return { found: false };
}

// ═══════════════════════════════════════════════════════
// TOCK — Check with content validation
// ═══════════════════════════════════════════════════════
async function searchTock(restaurantName) {
  const slug = slugify(restaurantName);
  if (slug.length < 2) return { found: false };

  const tockSlugNoHyphens = slug.replace(/-/g, '');
  const candidates = [
    `https://www.exploretock.com/${tockSlugNoHyphens}`,
    `https://www.exploretock.com/${slug}`
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html'
        },
        redirect: 'follow'
      });

      clearTimeout(timeout);

      if (!resp.ok) continue;

      const text = await resp.text().catch(() => '');
      const finalUrl = resp.url || url;

      if (finalUrl === 'https://www.exploretock.com/' ||
          finalUrl.includes('/search')) continue;

      if (text.includes('exploretock') &&
          (text.includes('Book') || text.includes('reservation') || text.includes('experience')) &&
          !text.includes('Page not found') &&
          !text.includes('404')) {
        return {
          found: true,
          platform: 'tock',
          url: url
        };
      }
    } catch (err) {
      continue;
    }
  }

  return { found: false };
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════
async function main() {
  console.log('================================================================');
  console.log('BOOKING LINK FINDER v3 (Strict name validation)');
  console.log('================================================================');

  let popular;
  try {
    popular = JSON.parse(fs.readFileSync(POPULAR_PATH, 'utf8'));
    console.log('Popular restaurants: ' + popular.length);
  } catch (err) {
    console.error('Cannot load popular_nyc.json: ' + err.message);
    process.exit(1);
  }

  let booking = {};
  try {
    booking = JSON.parse(fs.readFileSync(BOOKING_PATH, 'utf8'));
    console.log('Existing booking entries: ' + Object.keys(booking).length);
  } catch (err) {
    console.log('No existing booking_lookup.json');
  }

  // Backup
  if (Object.keys(booking).length > 0) {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(booking, null, 2));
    console.log('Backup saved');
  }

  const beforeCount = Object.keys(booking).length;

  // Find missing restaurants
  const missing = [];
  for (const r of popular) {
    if (!r.name) continue;
    const norm = normalize(r.name);
    const nameLower = r.name.toLowerCase().trim();
    if (booking[norm] || booking[nameLower]) continue;
    if (r.booking_url && r.booking_platform) continue;
    missing.push(r);
  }

  console.log('\nMissing booking links: ' + missing.length);
  console.log('Concurrency: ' + CONCURRENCY);
  console.log('Estimated time: ~' + Math.ceil(missing.length / CONCURRENCY * 2.5 / 60) + ' minutes\n');
  console.log('================================================================\n');

  let resyFound = 0, otFound = 0, tockFound = 0, notFound = 0;
  let resyRejected = 0;
  const newLinks = [];
  const rejected = [];

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);

    const promises = batch.map(async (restaurant) => {
      const name = restaurant.name;

      // Try Resy API first
      const resy = await searchResy(name);
      if (resy.found) {
        const norm = normalize(name);
        const nameLower = name.toLowerCase().trim();
        booking[norm] = { platform: resy.platform, url: resy.url };
        if (nameLower !== norm) booking[nameLower] = { platform: resy.platform, url: resy.url };
        resyFound++;
        newLinks.push({ name, platform: 'resy', url: resy.url, resyName: resy.name, via: resy.matchedVia });
        const pct = Math.round((i + batch.indexOf(restaurant) + 1) / missing.length * 100);
        console.log('  \u2705 [' + pct + '%] ' + name + ' -> resy: ' + resy.url);
        return;
      }

      // Try OpenTable
      const ot = await searchOpenTable(name);
      if (ot.found) {
        const norm = normalize(name);
        const nameLower = name.toLowerCase().trim();
        booking[norm] = { platform: ot.platform, url: ot.url };
        if (nameLower !== norm) booking[nameLower] = { platform: ot.platform, url: ot.url };
        otFound++;
        newLinks.push({ name, platform: 'opentable', url: ot.url });
        const pct = Math.round((i + batch.indexOf(restaurant) + 1) / missing.length * 100);
        console.log('  \u2705 [' + pct + '%] ' + name + ' -> opentable: ' + ot.url);
        return;
      }

      // Try Tock
      const tock = await searchTock(name);
      if (tock.found) {
        const norm = normalize(name);
        const nameLower = name.toLowerCase().trim();
        booking[norm] = { platform: tock.platform, url: tock.url };
        if (nameLower !== norm) booking[nameLower] = { platform: tock.platform, url: tock.url };
        tockFound++;
        newLinks.push({ name, platform: 'tock', url: tock.url });
        const pct = Math.round((i + batch.indexOf(restaurant) + 1) / missing.length * 100);
        console.log('  \u2705 [' + pct + '%] ' + name + ' -> tock: ' + tock.url);
        return;
      }

      notFound++;
    });

    await Promise.all(promises);

    // Save periodically
    if ((i + CONCURRENCY) % 150 === 0) {
      fs.writeFileSync(BOOKING_PATH, JSON.stringify(booking, null, 2));
    }

    const processed = Math.min(i + CONCURRENCY, missing.length);
    if (processed % 50 === 0 || processed === missing.length) {
      const total = resyFound + otFound + tockFound;
      const pct = Math.round(total / processed * 100);
      console.log('\n  \ud83d\udcca Progress: ' + processed + '/' + missing.length +
        ' | Found: ' + total + ' (' + pct + '%) | Resy: +' + resyFound + ' | OT: +' + otFound + ' | Tock: +' + tockFound +
        ' | Not found: ' + notFound + '\n');
    }

    await sleep(DELAY_MS);
  }

  // Save
  fs.writeFileSync(BOOKING_PATH, JSON.stringify(booking, null, 2));
  const afterCount = Object.keys(booking).length;

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('RESULTS');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  Checked:     ' + missing.length);
  console.log('  \u2705 Resy:      ' + resyFound);
  console.log('  \u2705 OpenTable: ' + otFound);
  console.log('  \u2705 Tock:      ' + tockFound);
  console.log('  \u274c Not found: ' + notFound);
  console.log('  Before:      ' + beforeCount);
  console.log('  After:       ' + afterCount);
  console.log('\n\ud83d\udcbe Saved booking_lookup.json');
  console.log('\ud83d\udcbe Backup at booking_lookup.pre_find_v3.json');

  // Report
  const report = {
    timestamp: new Date().toISOString(),
    checked: missing.length,
    resyFound, otFound, tockFound, notFound,
    beforeCount, afterCount, newLinks
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\ud83d\udcc4 Report: booking_find_v3_report.json');
  console.log('\nNext: git add booking_lookup.json && git commit -m "Expand booking links" && git push');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
