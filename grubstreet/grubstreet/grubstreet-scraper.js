// grubstreet-scraper.js
// Run: npm install cheerio node-fetch@2   (one time)
// Then: node grubstreet-scraper.js

const fetch = require('node-fetch');
const cheerio = require('cheerio');

const URLS = [
  'https://www.grubstreet.com/article/best-new-restaurants-nyc-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-nyc-2024.html',
  'https://www.grubstreet.com/article/absolute-best-restaurants-in-new-york.html',
  'https://www.grubstreet.com/article/where-to-eat-2025.html',
  'https://www.grubstreet.com/article/where-to-eat-2024.html',
  'https://www.grubstreet.com/article/best-new-restaurants-january-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-february-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-march-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-april-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-may-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-june-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-july-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-august-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-september-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-october-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-november-2025.html',
  'https://www.grubstreet.com/article/best-new-restaurants-december-2025.html',
];

// Words that are definitely NOT restaurant names
const JUNK_WORDS = [
  'advertisement', 'newsletter', 'subscribe', 'read more', 'related',
  'photo', 'credit', 'getty', 'share', 'comments', 'recommended',
  'most viewed', 'trending', 'sign up', 'log in', 'menu', 'search',
  'grub street', 'new york magazine', 'the year', 'the best', 'where to eat',
  'best new restaurants', 'monthly', 'january', 'february', 'march',
  'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'updated', 'editor', 'writer', 'by ',
];

function isLikelyRestaurantName(text) {
  const t = text.trim();
  if (t.length < 2 || t.length > 70) return false;

  const lower = t.toLowerCase();
  // Filter out junk
  for (const junk of JUNK_WORDS) {
    if (lower === junk || lower.startsWith(junk)) return false;
  }

  // Skip if it looks like a sentence (has periods, question marks, or is too wordy)
  if (t.includes('?') || t.includes('!')) return false;
  // Allow one period (e.g., "St. Anselm") but not full sentences
  if ((t.match(/\./g) || []).length > 1) return false;
  // Skip if it has too many words (likely a description, not a name)
  if (t.split(/\s+/).length > 8) return false;
  // Must start with uppercase
  if (t[0] !== t[0].toUpperCase()) return false;

  return true;
}

function extractRestaurants(html, url) {
  const $ = cheerio.load(html);
  const names = new Set();

  // Strategy 1: h2 and h3 inside article content (most common for Grub Street)
  $('article h2, article h3, .article-content h2, .article-content h3').each((_, el) => {
    const text = $(el).text().trim();
    if (isLikelyRestaurantName(text)) names.add(text);
  });

  // Strategy 2: Bold text in article paragraphs (sometimes names are bolded)
  $('article p strong, article p b, .article-content p strong, .article-content p b').each((_, el) => {
    const text = $(el).text().trim();
    if (isLikelyRestaurantName(text)) names.add(text);
  });

  // Strategy 3: heading-like elements with data attributes (modern CMS patterns)
  $('[data-editable="headingText"], [class*="headline"], [class*="hed"]').each((_, el) => {
    const text = $(el).text().trim();
    if (isLikelyRestaurantName(text)) names.add(text);
  });

  // Strategy 4: Generic fallback — any h2/h3/h4 on the page
  if (names.size === 0) {
    $('h2, h3, h4').each((_, el) => {
      const text = $(el).text().trim();
      if (isLikelyRestaurantName(text)) names.add(text);
    });
  }

  return [...names];
}

async function scrapeUrl(url) {
  try {
    console.log(`  Fetching: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      console.log(`  ⚠️  Got status ${res.status} for ${url}`);
      return { url, restaurants: [], status: res.status };
    }

    const html = await res.text();
    const restaurants = extractRestaurants(html, url);
    console.log(`  ✅ Found ${restaurants.length} names`);
    return { url, restaurants, status: 200 };
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return { url, restaurants: [], error: err.message };
  }
}

async function main() {
  console.log('=== Grub Street Restaurant Scraper ===\n');
  console.log(`Scraping ${URLS.length} pages...\n`);

  const allResults = [];
  const allNames = new Set();

  // Process one at a time to be polite to the server
  for (const url of URLS) {
    const result = await scrapeUrl(url);
    allResults.push(result);

    for (const name of result.restaurants) {
      allNames.add(name);
    }

    // Small delay between requests to be nice
    await new Promise(r => setTimeout(r, 1000));
  }

  // Build output
  const uniqueNames = [...allNames].sort();

  console.log('\n========================================');
  console.log(`TOTAL UNIQUE RESTAURANTS: ${uniqueNames.length}`);
  console.log('========================================\n');

  // Print them all
  uniqueNames.forEach((name, i) => {
    console.log(`${i + 1}. ${name}`);
  });

  // Save to files
  const fs = require('fs');

  // Save as JSON
  fs.writeFileSync('grubstreet_restaurants.json', JSON.stringify(uniqueNames, null, 2));
  console.log('\n✅ Saved to grubstreet_restaurants.json');

  // Save as CSV
  const csv = 'restaurant_name,source\n' +
    allResults.flatMap(r =>
      r.restaurants.map(name => `"${name.replace(/"/g, '""')}","${r.url}"`)
    ).join('\n');
  fs.writeFileSync('grubstreet_restaurants.csv', csv);
  console.log('✅ Saved to grubstreet_restaurants.csv');

  // Save detailed results per page
  const detailed = allResults.map(r => ({
    url: r.url,
    count: r.restaurants.length,
    restaurants: r.restaurants,
    status: r.status,
    error: r.error || null,
  }));
  fs.writeFileSync('grubstreet_detailed.json', JSON.stringify(detailed, null, 2));
  console.log('✅ Saved to grubstreet_detailed.json');

  // Summary
  console.log('\n--- Per-page summary ---');
  allResults.forEach(r => {
    const shortUrl = r.url.split('/article/')[1];
    console.log(`  ${shortUrl}: ${r.restaurants.length} restaurants`);
  });
}

main().catch(console.error);
