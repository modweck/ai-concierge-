#!/usr/bin/env node
/**
 * update_buzz_links.js — Verify, clean, and expand buzz links
 *
 * 1) Validate existing Infatuation links (keep if 200, delete otherwise)
 * 2) Delete ALL Eater + Grub Street links
 * 3) Add Time Out links if HTTP 200
 * 4) Add missing Infatuation links if HTTP 200
 * 5) Update buzz_links.json AND BUZZ_LINKS in index.html
 *
 * Usage: cd ~/ai-concierge- && node netlify/functions/update_buzz_links.js
 */

const fs = require('fs');
const path = require('path');

const CONCURRENCY = 6;
const DELAY_MS = 200;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 3000;
const RATE_LIMIT_DELAY_MS = 10000;

const ROOT = path.resolve(__dirname, '..', '..');
const POPULAR_PATH = path.join(__dirname, 'popular_nyc.json');
const MICHELIN_PATH = path.join(__dirname, 'michelin_nyc.json');
const BIB_PATH = path.join(__dirname, 'bib_gourmand_nyc.json');
const CHASE_PATH = path.join(__dirname, 'chase_sapphire_nyc.json');
const RAKUTEN_PATH = path.join(__dirname, 'rakuten_nyc.json');
const BUZZ_PATH = path.join(__dirname, 'buzz_links.json');
const INDEX_PATH = path.join(ROOT, 'index.html');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// Manual slug overrides for tricky restaurant names
const SLUG_OVERRIDES = {
  "l'artusi": 'lartusi',
  "l'antagoniste": 'lantagoniste',
  "le coucou": 'le-coucou',
  "le bernardin": 'le-bernardin',
  "le crocodile": 'le-crocodile',
  "l'industrie pizzeria": 'lindustrie-pizzeria',
  "4 charles prime rib": '4-charles-prime-rib',
  "1 hotel brooklyn bridge": '1-hotel-brooklyn-bridge',
  "abc kitchen": 'abc-kitchen',
  "abc cocina": 'abc-cocina',
  "e.a.k. ramen": 'eak-ramen',
  "gage & tollner": 'gage-and-tollner',
  "parm": 'parm',
  "rao's": 'raos',
  "peter luger steak house": 'peter-luger-steak-house',
  "joe's pizza": 'joes-pizza',
  "di fara pizza": 'di-fara-pizza',
  "katz's delicatessen": 'katzs-delicatessen',
  "russ & daughters cafe": 'russ-and-daughters-cafe',
  "king": 'king-restaurant',
  "the grill": 'the-grill',
  "the pool": 'the-pool'
};

// ============================================================
// HELPERS
// ============================================================

function slugify(name) {
  const lower = String(name || '').toLowerCase().trim();
  if (SLUG_OVERRIDES[lower]) return SLUG_OVERRIDES[lower];

  return lower
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[''´`]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms + Math.random() * 100));
}

async function checkUrl(url, retries) {
  retries = retries || 0;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      method: 'GET',
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (resp.status === 200) return true;

    // Rate limited — backoff and retry
    if ((resp.status === 429 || resp.status === 403) && retries < RETRY_COUNT) {
      const delay = RATE_LIMIT_DELAY_MS * (retries + 1);
      console.log(`   ⏳ Rate limited (${resp.status}) on ${url}, retrying in ${delay/1000}s...`);
      await sleep(delay);
      return checkUrl(url, retries + 1);
    }

    return false;
  } catch (err) {
    if (retries < RETRY_COUNT) {
      await sleep(RETRY_DELAY_MS);
      return checkUrl(url, retries + 1);
    }
    return false;
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
      if (idx % limit === 0) await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
  return results;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🔗 Buzz Links Updater');
  console.log('='.repeat(60));

  // Load all restaurant sources
  const loadJSON = (filepath, label) => {
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      console.log(`✅ Loaded ${label}: ${data.length} entries`);
      return data;
    } catch (err) {
      console.warn(`⚠️  Could not load ${label}: ${err.message}`);
      return [];
    }
  };

  const popular = loadJSON(POPULAR_PATH, 'popular_nyc.json');
  const michelin = loadJSON(MICHELIN_PATH, 'michelin_nyc.json');
  const bib = loadJSON(BIB_PATH, 'bib_gourmand_nyc.json');
  const chase = loadJSON(CHASE_PATH, 'chase_sapphire_nyc.json');
  const rakuten = loadJSON(RAKUTEN_PATH, 'rakuten_nyc.json');

  // Deduplicate by name across all sources
  const seen = new Set();
  const allRestaurants = [];
  for (const r of [...popular, ...michelin, ...bib, ...chase, ...rakuten]) {
    if (!r || !r.name) continue;
    const key = r.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    allRestaurants.push(r);
  }
  console.log(`📊 Total unique restaurants: ${allRestaurants.length}`);
  console.log(`   (Popular: ${popular.length}, Michelin: ${michelin.length}, Bib: ${bib.length}, Chase: ${chase.length}, Rakuten: ${rakuten.length})`);


  let existingBuzz = {};
  try {
    existingBuzz = JSON.parse(fs.readFileSync(BUZZ_PATH, 'utf8'));
    console.log(`✅ Loaded buzz_links.json: ${Object.keys(existingBuzz).length} entries`);
  } catch (err) {
    console.warn('⚠️  No existing buzz_links.json, starting fresh');
  }

  // Stats
  const stats = {
    total: allRestaurants.length,
    infatuationKept: 0,
    infatuationRemoved: 0,
    infatuationAdded: 0,
    eaterRemoved: 0,
    grubstreetRemoved: 0,
    timeoutAdded: 0,
    timeoutExisted: 0,
    bothLinks: 0,
    onlyInfatuation: 0,
    onlyTimeout: 0,
    neither: 0
  };

  // Build restaurant name list
  const restaurantNames = allRestaurants.map(r => r.name).filter(Boolean);
  console.log(`\n📊 Processing ${restaurantNames.length} restaurants...\n`);

  // ============================================================
  // STEP 1 + 2: Validate existing links, remove Eater/GrubStreet
  // ============================================================

  console.log('STEP 1-2: Validating existing Infatuation links, removing Eater/GrubStreet...');

  const existingInfatuation = {}; // name -> url (only verified ones)
  const toVerify = [];

  for (const [name, links] of Object.entries(existingBuzz)) {
    const linkArr = Array.isArray(links) ? links : [];
    for (const link of linkArr) {
      const src = String(link.source || '').toLowerCase();
      const url = link.url || '';

      if (src.includes('eater')) {
        stats.eaterRemoved++;
      } else if (src.includes('grub') || src.includes('grubstreet')) {
        stats.grubstreetRemoved++;
      } else if (src.includes('infatuation') && url) {
        toVerify.push({ name, url });
      }
      // timeout links from old data — we'll regenerate them all
    }
  }

  console.log(`   Checking ${toVerify.length} existing Infatuation links...`);
  console.log(`   Removing ${stats.eaterRemoved} Eater + ${stats.grubstreetRemoved} Grub Street links`);

  await runWithConcurrency(toVerify, CONCURRENCY, async (item, idx) => {
    const ok = await checkUrl(item.url);
    if (ok) {
      existingInfatuation[item.name] = item.url;
      stats.infatuationKept++;
    } else {
      stats.infatuationRemoved++;
    }
    if ((idx + 1) % 50 === 0) {
      console.log(`   ... verified ${idx + 1}/${toVerify.length} Infatuation links`);
    }
  });

  console.log(`   ✅ Infatuation: ${stats.infatuationKept} kept, ${stats.infatuationRemoved} removed\n`);

  // ============================================================
  // STEP 3: Generate & verify Time Out links for ALL restaurants
  // ============================================================

  console.log('STEP 3: Checking Time Out links for all restaurants...');

  const timeoutResults = {}; // name -> url

  await runWithConcurrency(restaurantNames, CONCURRENCY, async (name, idx) => {
    const slug = slugify(name);
    const url = `https://www.timeout.com/newyork/restaurants/${slug}`;
    const ok = await checkUrl(url);
    if (ok) {
      timeoutResults[name] = url;
      stats.timeoutAdded++;
    }
    if ((idx + 1) % 100 === 0) {
      console.log(`   ... checked ${idx + 1}/${restaurantNames.length} Time Out URLs (${stats.timeoutAdded} found)`);
    }
  });

  console.log(`   ✅ Time Out: ${stats.timeoutAdded} working links found\n`);

  // ============================================================
  // STEP 4: Generate & verify missing Infatuation links
  // ============================================================

  console.log('STEP 4: Checking missing Infatuation links...');

  const missingInfatuation = restaurantNames.filter(n => !existingInfatuation[n]);
  console.log(`   ${missingInfatuation.length} restaurants need Infatuation check...`);

  await runWithConcurrency(missingInfatuation, CONCURRENCY, async (name, idx) => {
    const slug = slugify(name);
    const url = `https://www.theinfatuation.com/new-york/reviews/${slug}`;
    const ok = await checkUrl(url);
    if (ok) {
      existingInfatuation[name] = url;
      stats.infatuationAdded++;
    }
    if ((idx + 1) % 100 === 0) {
      console.log(`   ... checked ${idx + 1}/${missingInfatuation.length} Infatuation URLs (${stats.infatuationAdded} new)`);
    }
  });

  console.log(`   ✅ Infatuation: ${stats.infatuationAdded} new links added\n`);

  // ============================================================
  // STEP 5: Build final buzz_links object
  // ============================================================

  console.log('STEP 5: Building final buzz_links...');

  const newBuzz = {};

  for (const name of restaurantNames) {
    const links = [];

    if (existingInfatuation[name]) {
      links.push({ source: 'infatuation', url: existingInfatuation[name] });
    }

    if (timeoutResults[name]) {
      links.push({ source: 'timeout', url: timeoutResults[name] });
    }

    if (links.length > 0) {
      newBuzz[name] = links;
    }

    // Count stats
    const hasInf = !!existingInfatuation[name];
    const hasTO = !!timeoutResults[name];
    if (hasInf && hasTO) stats.bothLinks++;
    else if (hasInf) stats.onlyInfatuation++;
    else if (hasTO) stats.onlyTimeout++;
    else stats.neither++;
  }

  // ============================================================
  // STEP 6a: Write buzz_links.json
  // ============================================================

  fs.writeFileSync(BUZZ_PATH, JSON.stringify(newBuzz, null, 2));
  console.log(`✅ Wrote buzz_links.json (${Object.keys(newBuzz).length} restaurants with links)`);

  // ============================================================
  // STEP 6b: Update BUZZ_LINKS in index.html
  // ============================================================

  try {
    let indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');

    // Build the JS object string
    const buzzLines = [];
    for (const [name, links] of Object.entries(newBuzz)) {
      const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const linkStrs = links.map(l => {
        const srcEsc = l.source.replace(/'/g, "\\'");
        const urlEsc = l.url.replace(/'/g, "\\'");
        return `{source:'${srcEsc}',url:'${urlEsc}'}`;
      });
      buzzLines.push(`  '${escaped}':[${linkStrs.join(',')}]`);
    }
    const buzzObj = `const BUZZ_LINKS = {\n${buzzLines.join(',\n')}\n};`;

    // Find and replace existing BUZZ_LINKS
    const buzzRegex = /const BUZZ_LINKS\s*=\s*\{[\s\S]*?\};/;
    if (buzzRegex.test(indexHtml)) {
      indexHtml = indexHtml.replace(buzzRegex, buzzObj);
      fs.writeFileSync(INDEX_PATH, indexHtml);
      console.log(`✅ Updated BUZZ_LINKS in index.html`);
    } else {
      console.warn('⚠️  Could not find BUZZ_LINKS in index.html — update manually');
    }
  } catch (err) {
    console.error('❌ Error updating index.html:', err.message);
  }

  // ============================================================
  // SUMMARY
  // ============================================================

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`   Total restaurants processed: ${stats.total}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Both links:          ${stats.bothLinks}`);
  console.log(`   Only Infatuation:    ${stats.onlyInfatuation}`);
  console.log(`   Only Time Out:       ${stats.onlyTimeout}`);
  console.log(`   Neither:             ${stats.neither}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Infatuation kept:    ${stats.infatuationKept}`);
  console.log(`   Infatuation removed: ${stats.infatuationRemoved}`);
  console.log(`   Infatuation added:   ${stats.infatuationAdded}`);
  console.log(`   Eater removed:       ${stats.eaterRemoved}`);
  console.log(`   Grub Street removed: ${stats.grubstreetRemoved}`);
  console.log(`   Time Out added:      ${stats.timeoutAdded}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Restaurants with links: ${Object.keys(newBuzz).length}`);
  console.log(`   Restaurants without:    ${stats.neither}`);
  console.log('\n✅ Done! Now run:');
  console.log('   git add -A');
  console.log('   git commit -m "update: refresh buzz links (Infatuation + Time Out)"');
  console.log('   git push');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
