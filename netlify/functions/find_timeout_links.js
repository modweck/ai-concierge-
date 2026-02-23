#!/usr/bin/env node
/**
 * find_timeout_links.js — Find Time Out NYC review URLs via Google search
 *
 * Since Time Out URLs aren't predictable slugs (e.g. carbone-1 not carbone),
 * this script searches Google for "site:timeout.com/newyork/restaurants RESTAURANT_NAME"
 * and picks the best matching result.
 *
 * Usage: cd ~/ai-concierge- && node netlify/functions/find_timeout_links.js
 */

const fs = require('fs');
const path = require('path');

const CONCURRENCY = 3;        // Keep low — Google blocks fast
const DELAY_MS = 2000;        // 2 sec between requests to avoid blocks
const RETRY_COUNT = 2;
const RATE_LIMIT_DELAY_MS = 15000;

const BUZZ_PATH = path.join(__dirname, 'buzz_links.json');
const POPULAR_PATH = path.join(__dirname, 'popular_nyc.json');
const MICHELIN_PATH = path.join(__dirname, 'michelin_nyc.json');
const BIB_PATH = path.join(__dirname, 'bib_gourmand_nyc.json');
const CHASE_PATH = path.join(__dirname, 'chase_sapphire_nyc.json');
const RAKUTEN_PATH = path.join(__dirname, 'rakuten_nyc.json');
const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'index.html');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms + Math.random() * 500));
}

function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// URLs to skip — these are list pages, not restaurant reviews
const SKIP_PATTERNS = [
  /100-best/i, /best-restaurants/i, /latest-restaurant-reviews/i,
  /restaurants-in-/i, /best-new-/i, /cheap-eats/i, /restaurant-week/i,
  /food-drink/i, /bars\//i, /reservations/i, /how-we-review/i,
  /best-brunch/i, /best-pizza/i, /best-sushi/i, /best-italian/i,
  /best-chinese/i, /best-japanese/i, /best-thai/i, /best-indian/i,
  /best-mexican/i, /best-french/i, /best-korean/i, /best-seafood/i
];

function isValidTimeoutReviewUrl(url) {
  if (!url) return false;
  if (!url.includes('timeout.com/newyork/restaurants/')) return false;
  // Must have a slug after /restaurants/
  const afterRestaurants = url.split('/restaurants/')[1];
  if (!afterRestaurants || afterRestaurants.length < 3) return false;
  // Skip list/category pages
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(afterRestaurants)) return false;
  }
  return true;
}

async function searchGoogle(restaurantName) {
  const query = `site:timeout.com/newyork/restaurants "${restaurantName}" NYC restaurant review`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (resp.status === 429 || resp.status === 403) {
      return { rateLimited: true, urls: [] };
    }

    if (!resp.ok) return { rateLimited: false, urls: [] };

    const html = await resp.text();

    // Extract timeout.com URLs from Google results
    const urlMatches = html.match(/https?:\/\/(?:www\.)?timeout\.com\/newyork\/restaurants\/[a-z0-9-]+/gi) || [];

    // Dedupe and filter
    const seen = new Set();
    const valid = [];
    for (const u of urlMatches) {
      const clean = u.toLowerCase().replace(/\/+$/, '');
      if (seen.has(clean)) continue;
      seen.add(clean);
      if (isValidTimeoutReviewUrl(clean)) valid.push(clean);
    }

    return { rateLimited: false, urls: valid };
  } catch (err) {
    return { rateLimited: false, urls: [] };
  }
}

async function verifyUrl(url) {
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
    return resp.status === 200;
  } catch {
    return false;
  }
}

// Score how well a URL matches a restaurant name
function scoreMatch(url, restaurantName) {
  const slug = (url.split('/restaurants/')[1] || '').toLowerCase().replace(/-/g, ' ').replace(/\d+$/, '').trim();
  const name = normalizeName(restaurantName);
  if (slug === name) return 100;
  if (slug.startsWith(name) || name.startsWith(slug)) return 80;
  // Check if most words overlap
  const slugWords = slug.split(' ').filter(w => w.length > 2);
  const nameWords = name.split(' ').filter(w => w.length > 2);
  if (nameWords.length === 0) return 0;
  const matches = nameWords.filter(w => slugWords.includes(w)).length;
  return Math.round((matches / nameWords.length) * 60);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🔍 Time Out Link Finder (via Google Search)');
  console.log('='.repeat(60));

  // Load all restaurant sources
  const loadJSON = (filepath, label) => {
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      console.log(`✅ ${label}: ${data.length}`);
      return data;
    } catch { return []; }
  };

  const popular = loadJSON(POPULAR_PATH, 'popular_nyc.json');
  const michelin = loadJSON(MICHELIN_PATH, 'michelin_nyc.json');
  const bib = loadJSON(BIB_PATH, 'bib_gourmand_nyc.json');
  const chase = loadJSON(CHASE_PATH, 'chase_sapphire_nyc.json');
  const rakuten = loadJSON(RAKUTEN_PATH, 'rakuten_nyc.json');

  // Dedupe
  const seen = new Set();
  const allNames = [];
  for (const r of [...popular, ...michelin, ...bib, ...chase, ...rakuten]) {
    if (!r || !r.name) continue;
    const key = r.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    allNames.push(r.name);
  }
  console.log(`\n📊 Total unique restaurants: ${allNames.length}`);

  // Load existing buzz links
  let buzzLinks = {};
  try {
    buzzLinks = JSON.parse(fs.readFileSync(BUZZ_PATH, 'utf8'));
    console.log(`✅ Existing buzz_links.json: ${Object.keys(buzzLinks).length} entries`);
  } catch { console.log('⚠️  No existing buzz_links.json'); }

  // Find restaurants that don't already have a timeout link
  const needTimeout = allNames.filter(name => {
    const links = buzzLinks[name] || [];
    return !links.some(l => (l.source || '').toLowerCase().includes('timeout'));
  });

  console.log(`\n🔍 ${needTimeout.length} restaurants need Time Out links`);
  console.log(`   (Searching Google — this will take a while...)\n`);

  let found = 0;
  let rateLimitHits = 0;
  let searched = 0;
  let consecutiveRateLimits = 0;

  // Process in small batches
  for (let i = 0; i < needTimeout.length; i++) {
    const name = needTimeout[i];
    searched++;

    // If too many consecutive rate limits, pause longer
    if (consecutiveRateLimits >= 3) {
      console.log(`   ⏸️  Too many rate limits, pausing 60s...`);
      await sleep(60000);
      consecutiveRateLimits = 0;
    }

    const result = await searchGoogle(name);

    if (result.rateLimited) {
      rateLimitHits++;
      consecutiveRateLimits++;
      console.log(`   ⏳ Rate limited at "${name}" (${rateLimitHits} total), backing off...`);
      await sleep(RATE_LIMIT_DELAY_MS);
      // Retry once
      const retry = await searchGoogle(name);
      if (retry.rateLimited) {
        await sleep(RATE_LIMIT_DELAY_MS * 2);
        continue;
      }
      result.urls = retry.urls;
      consecutiveRateLimits = 0;
    } else {
      consecutiveRateLimits = 0;
    }

    if (result.urls.length > 0) {
      // Pick best matching URL
      let bestUrl = result.urls[0];
      let bestScore = 0;
      for (const url of result.urls) {
        const score = scoreMatch(url, name);
        if (score > bestScore) { bestScore = score; bestUrl = url; }
      }

      // Verify it actually loads
      if (bestScore >= 30) {
        const ok = await verifyUrl(bestUrl);
        if (ok) {
          // Add to buzz links
          if (!buzzLinks[name]) buzzLinks[name] = [];
          buzzLinks[name].push({ source: 'timeout', url: bestUrl });
          found++;
          console.log(`   ✅ ${name} → ${bestUrl} (score: ${bestScore})`);
        }
      }
    }

    if (searched % 25 === 0) {
      console.log(`   --- Progress: ${searched}/${needTimeout.length} searched, ${found} found, ${rateLimitHits} rate limits ---`);
    }

    // Delay between searches
    await sleep(DELAY_MS);
  }

  // ============================================================
  // SAVE RESULTS
  // ============================================================

  console.log('\n💾 Saving...');
  fs.writeFileSync(BUZZ_PATH, JSON.stringify(buzzLinks, null, 2));
  console.log(`✅ Updated buzz_links.json`);

  // Update index.html BUZZ_LINKS
  try {
    let indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
    const buzzLines = [];
    for (const [name, links] of Object.entries(buzzLinks)) {
      const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const linkStrs = links.map(l => {
        const srcEsc = l.source.replace(/'/g, "\\'");
        const urlEsc = l.url.replace(/'/g, "\\'");
        return `{source:'${srcEsc}',url:'${urlEsc}'}`;
      });
      buzzLines.push(`  '${escaped}':[${linkStrs.join(',')}]`);
    }
    const buzzObj = `const BUZZ_LINKS = {\n${buzzLines.join(',\n')}\n};`;
    const buzzRegex = /const BUZZ_LINKS\s*=\s*\{[\s\S]*?\};/;
    if (buzzRegex.test(indexHtml)) {
      indexHtml = indexHtml.replace(buzzRegex, buzzObj);
      fs.writeFileSync(INDEX_PATH, indexHtml);
      console.log(`✅ Updated BUZZ_LINKS in index.html`);
    } else {
      console.warn('⚠️  Could not find BUZZ_LINKS in index.html');
    }
  } catch (err) {
    console.error('❌ Error updating index.html:', err.message);
  }

  // ============================================================
  // SUMMARY
  // ============================================================

  // Count final stats
  let bothCount = 0, onlyInf = 0, onlyTO = 0, neitherCount = 0;
  for (const name of allNames) {
    const links = buzzLinks[name] || [];
    const hasInf = links.some(l => (l.source || '').includes('infatuation'));
    const hasTO = links.some(l => (l.source || '').includes('timeout'));
    if (hasInf && hasTO) bothCount++;
    else if (hasInf) onlyInf++;
    else if (hasTO) onlyTO++;
    else neitherCount++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`   Total restaurants:    ${allNames.length}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Time Out found:       ${found}`);
  console.log(`   Searches made:        ${searched}`);
  console.log(`   Rate limit hits:      ${rateLimitHits}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Both links:           ${bothCount}`);
  console.log(`   Only Infatuation:     ${onlyInf}`);
  console.log(`   Only Time Out:        ${onlyTO}`);
  console.log(`   Neither:              ${neitherCount}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Total with links:     ${Object.keys(buzzLinks).length}`);
  console.log('\n✅ Done! Now run:');
  console.log('   git add -A');
  console.log('   git commit -m "feat: add Time Out buzz links via search"');
  console.log('   git push');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
