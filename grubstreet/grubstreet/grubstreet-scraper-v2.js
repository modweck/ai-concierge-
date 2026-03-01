// grubstreet-scraper-v2.js
// Run: node grubstreet-scraper-v2.js
// (cheerio and node-fetch@2 should already be installed from v1)

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');

// ============================================
// VERIFIED URLS — these are real, working pages
// ============================================
const URLS = [
  // Grub Street — confirmed working
  { url: 'https://www.grubstreet.com/article/best-new-restaurants-nyc-2025.html', source: 'Grub Street' },
  { url: 'https://www.grubstreet.com/article/best-new-restaurants-nyc-2024.html', source: 'Grub Street' },
  { url: 'https://www.grubstreet.com/article/best-new-food-nyc-2025.html', source: 'Grub Street' },

  // The Infatuation — NYC specific lists
  { url: 'https://www.theinfatuation.com/new-york/guides/best-new-restaurants-new-york-2025', source: 'Infatuation' },
  { url: 'https://www.theinfatuation.com/new-york/guides/best-new-restaurants-new-york-2024', source: 'Infatuation' },
  { url: 'https://www.theinfatuation.com/new-york/guides/best-restaurants-nyc', source: 'Infatuation' },

  // Eater NY
  { url: 'https://www.eater.com/dining-out/924306/best-new-restaurants-america-2025', source: 'Eater' },

  // Timeout — NYC best restaurants
  { url: 'https://www.timeout.com/newyork/restaurants/100-best-new-york-restaurants', source: 'TimeOut' },
];

// ============================================
// JUNK FILTER — much stricter than v1
// ============================================
const JUNK_PATTERNS = [
  // Navigation / UI
  /advertisement/i, /newsletter/i, /subscribe/i, /read more/i, /sign up/i,
  /log in/i, /search/i, /share/i, /comments/i, /trending/i, /tags:/i,
  /menu/i, /^more$/i, /load more/i, /see all/i, /show more/i,

  // Article meta / headings
  /best new restaurants/i, /best restaurants/i, /best food/i,
  /where to eat/i, /where should we go/i, /restaurant recommendation/i,
  /high points/i, /overeating/i, /our picks/i, /mapped$/i,
  /all of our/i, /plus:/i, /the best of/i, /the absolute best/i,
  /updated/i, /editor/i, /monthly/i,

  // Author / publication names
  /grub street/i, /new york magazine/i, /the infatuation/i, /eater/i, /time ?out/i,
  /emily sundberg/i, /isaac mizrahi/i, /ambassadors clubhouse/i,

  // Dates and generic text
  /^(january|february|march|april|may|june|july|august|september|october|november|december)/i,
  /202[0-9]/i,  // anything with a year
  /eat like/i, /more new bars/i, /ten spots/i, /everything right/i,
  /got everything/i,

  // Neighborhoods (not restaurant names)
  /^\(.*\)$/,  // "(East Village)", "(Dumbo)", etc.

  // Single characters or numbers
  /^[\d.]+$/,
  /^\.$/, /^,$/,
];

function isJunk(text) {
  const t = text.trim();
  if (t.length < 2 || t.length > 70) return true;
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(t)) return true;
  }
  // Skip if it looks like a sentence (too many words)
  if (t.split(/\s+/).length > 8) return true;
  // Must start with uppercase or number
  if (t[0] !== t[0].toUpperCase() && !/^\d/.test(t[0])) return true;
  // Skip if ends with common sentence punctuation
  if (/[.!?]$/.test(t) && t.length > 30) return true;

  return false;
}

// ============================================
// EXTRACTION — site-specific strategies
// ============================================
function extractFromGrubStreet($) {
  const names = new Set();

  // Grub Street uses h2 inside article for restaurant names
  $('article h2, article h3').each((_, el) => {
    let text = $(el).text().trim();
    // Clean up: remove leading numbers like "1." or "1 "
    text = text.replace(/^\d+[\.\)]\s*/, '');
    // Remove trailing neighborhood in parens like "Le Veau d'Or (Midtown)"
    text = text.replace(/\s*\([^)]*\)\s*$/, '');
    // Remove leading/trailing periods and whitespace
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text)) names.add(text);
  });

  // Also check bold text in paragraphs
  $('article p strong, article p b').each((_, el) => {
    let text = $(el).text().trim();
    text = text.replace(/^\d+[\.\)]\s*/, '');
    text = text.replace(/\s*\([^)]*\)\s*$/, '');
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text) && text.length < 50) names.add(text);
  });

  return [...names];
}

function extractFromInfatuation($) {
  const names = new Set();

  // Infatuation uses h2 or h3 for restaurant names in guide pages
  $('h2, h3').each((_, el) => {
    let text = $(el).text().trim();
    text = text.replace(/^\d+[\.\)]\s*/, '');
    text = text.replace(/\s*\([^)]*\)\s*$/, '');
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text) && text.length < 60) names.add(text);
  });

  // Also look for links that look like restaurant review links
  $('a[href*="/reviews/"]').each((_, el) => {
    let text = $(el).text().trim();
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text) && text.length < 60) names.add(text);
  });

  return [...names];
}

function extractFromEater($) {
  const names = new Set();

  $('h2, h3').each((_, el) => {
    let text = $(el).text().trim();
    text = text.replace(/^\d+[\.\)]\s*/, '');
    // Eater sometimes does "Restaurant Name, City"
    text = text.replace(/,\s*(New York|NYC|Brooklyn|Manhattan|Queens|Bronx).*$/i, '');
    text = text.replace(/\s*\([^)]*\)\s*$/, '');
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text) && text.length < 60) names.add(text);
  });

  return [...names];
}

function extractFromTimeOut($) {
  const names = new Set();

  // TimeOut uses h2/h3 for restaurant names
  $('h2, h3').each((_, el) => {
    let text = $(el).text().trim();
    text = text.replace(/^\d+[\.\)]\s*/, '');
    text = text.replace(/\s*\([^)]*\)\s*$/, '');
    text = text.replace(/^[\s.]+|[\s.]+$/g, '');
    if (text && !isJunk(text) && text.length < 60) names.add(text);
  });

  return [...names];
}

function extractRestaurants(html, source) {
  const $ = cheerio.load(html);
  switch (source) {
    case 'Grub Street': return extractFromGrubStreet($);
    case 'Infatuation': return extractFromInfatuation($);
    case 'Eater': return extractFromEater($);
    case 'TimeOut': return extractFromTimeOut($);
    default: return extractFromGrubStreet($); // fallback
  }
}

// ============================================
// MAIN SCRAPER
// ============================================
async function scrapeUrl({ url, source }) {
  try {
    console.log(`  Fetching [${source}]: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.log(`  ⚠️  Status ${res.status}`);
      return { url, source, restaurants: [], status: res.status };
    }

    const html = await res.text();
    const restaurants = extractRestaurants(html, source);
    console.log(`  ✅ Found ${restaurants.length} names`);
    return { url, source, restaurants, status: 200 };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return { url, source, restaurants: [], error: err.message };
  }
}

async function main() {
  console.log('=== Grub Street + NYC Restaurant Scraper v2 ===\n');
  console.log(`Scraping ${URLS.length} pages...\n`);

  const allResults = [];
  const allNames = new Map(); // name -> set of sources

  for (const entry of URLS) {
    const result = await scrapeUrl(entry);
    allResults.push(result);

    for (const name of result.restaurants) {
      if (!allNames.has(name)) {
        allNames.set(name, new Set());
      }
      allNames.get(name).add(result.source);
    }

    // 1.5s delay between requests
    await new Promise(r => setTimeout(r, 1500));
  }

  // Build sorted output
  const uniqueNames = [...allNames.keys()].sort();

  console.log('\n========================================');
  console.log(`TOTAL UNIQUE RESTAURANTS: ${uniqueNames.length}`);
  console.log('========================================\n');

  uniqueNames.forEach((name, i) => {
    const sources = [...allNames.get(name)].join(', ');
    console.log(`${String(i + 1).padStart(3)}. ${name}  [${sources}]`);
  });

  // --- Save JSON (with source info) ---
  const jsonOutput = uniqueNames.map(name => ({
    name,
    sources: [...allNames.get(name)],
  }));
  fs.writeFileSync('grubstreet_restaurants_v2.json', JSON.stringify(jsonOutput, null, 2));
  console.log('\n✅ Saved to grubstreet_restaurants_v2.json');

  // --- Save CSV ---
  const csvLines = ['restaurant_name,sources,source_count'];
  for (const name of uniqueNames) {
    const sources = [...allNames.get(name)];
    csvLines.push(`"${name.replace(/"/g, '""')}","${sources.join('; ')}",${sources.length}`);
  }
  fs.writeFileSync('grubstreet_restaurants_v2.csv', csvLines.join('\n'));
  console.log('✅ Saved to grubstreet_restaurants_v2.csv');

  // --- Save detailed per-page results ---
  const detailed = allResults.map(r => ({
    url: r.url,
    source: r.source,
    count: r.restaurants.length,
    restaurants: r.restaurants,
    status: r.status,
    error: r.error || null,
  }));
  fs.writeFileSync('grubstreet_detailed_v2.json', JSON.stringify(detailed, null, 2));
  console.log('✅ Saved to grubstreet_detailed_v2.json');

  // --- Summary ---
  console.log('\n--- Per-page summary ---');
  allResults.forEach(r => {
    const shortUrl = r.url.replace(/https:\/\/www\.\w+\.\w+\//, '').slice(0, 60);
    const status = r.status === 200 ? '✅' : '⚠️';
    console.log(`  ${status} [${r.source}] ${shortUrl}: ${r.restaurants.length} found`);
  });

  // Bonus: restaurants appearing in multiple sources
  const multiSource = uniqueNames.filter(n => allNames.get(n).size > 1);
  if (multiSource.length > 0) {
    console.log(`\n--- Restaurants in multiple sources (${multiSource.length}) ---`);
    multiSource.forEach(name => {
      const sources = [...allNames.get(name)].join(', ');
      console.log(`  ⭐ ${name}  [${sources}]`);
    });
  }
}

main().catch(console.error);
