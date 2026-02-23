#!/usr/bin/env node
/**
 * BOOKING LOOKUP EXPANDER
 * 
 * Scrapes Resy and OpenTable NYC restaurant directories to build
 * a comprehensive booking_lookup.json with thousands of entries.
 * 
 * Run from: netlify/functions/
 *   node expand_booking_lookup.js
 * 
 * What it does:
 *   1. Crawls Resy's NYC venue list (API-based)
 *   2. Crawls OpenTable's NYC restaurant listings (API-based)
 *   3. Merges with your existing booking_lookup.json (never overwrites existing entries)
 *   4. Saves expanded booking_lookup.json + backup
 * 
 * Requires: Node 18+ (for native fetch)
 */

const fs = require('fs');
const path = require('path');

const EXISTING_PATH = path.join(__dirname, 'booking_lookup.json');
const BACKUP_PATH = path.join(__dirname, 'booking_lookup.pre_expand.json');
const OUTPUT_PATH = path.join(__dirname, 'booking_lookup.json');
const REPORT_PATH = path.join(__dirname, 'booking_expand_report.json');

// Rate limiting helper
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-–—]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|café|bistro|brasserie|kitchen|dining|room)$/i, '')
    .replace(/^the\s+/, '')
    .trim();
}

// ═══════════════════════════════════════════════════════════
// RESY SCRAPER — Uses Resy's internal API
// ═══════════════════════════════════════════════════════════
async function scrapeResy() {
  console.log('\n🔴 SCRAPING RESY NYC...');
  const results = [];
  
  // Resy's venue search API — paginated
  // We search multiple neighborhoods and cuisine types to maximize coverage
  const searches = [
    // Borough-wide searches
    'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island',
    // Popular neighborhood searches  
    'west village', 'east village', 'soho', 'tribeca', 'lower east side',
    'chelsea', 'gramercy', 'midtown', 'upper east side', 'upper west side',
    'williamsburg', 'greenpoint', 'park slope', 'dumbo', 'bushwick',
    'long island city', 'astoria', 'harlem', 'hell\'s kitchen', 'nolita',
    'financial district', 'flatiron', 'murray hill', 'chinatown', 'little italy',
    'noho', 'meatpacking', 'hudson yards', 'prospect heights', 'cobble hill',
    'boerum hill', 'fort greene', 'crown heights', 'red hook', 'carroll gardens'
  ];

  const seen = new Set();

  // Method 1: Resy's search/find API
  for (const query of searches) {
    try {
      const url = `https://api.resy.com/3/venue?lat=40.7128&long=-74.0060&day=${getTodayDate()}&party_size=2&location=${encodeURIComponent('New York, NY')}&query=${encodeURIComponent(query)}&limit=100`;
      
      const resp = await fetch(url, {
        headers: {
          'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Origin': 'https://resy.com',
          'Referer': 'https://resy.com/'
        }
      });

      if (!resp.ok) {
        // Try alternate endpoint
        const altUrl = `https://api.resy.com/4/find?lat=40.7128&long=-74.0060&day=${getTodayDate()}&party_size=2&query=${encodeURIComponent(query)}`;
        const altResp = await fetch(altUrl, {
          headers: {
            'Authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Origin': 'https://resy.com',
            'Referer': 'https://resy.com/'
          }
        });
        
        if (altResp.ok) {
          const data = await altResp.json();
          const venues = data?.results?.venues || data?.venues || [];
          for (const v of venues) {
            const venue = v.venue || v;
            const name = venue.name;
            const slug = venue.url_slug || venue.slug;
            const location = venue.location || {};
            const city = (location.locality || '').toLowerCase();
            
            if (!name || !slug) continue;
            if (seen.has(slug)) continue;
            seen.add(slug);
            
            const resyUrl = `https://resy.com/cities/ny/${slug}`;
            results.push({
              name: name.trim(),
              normalized: normalize(name),
              platform: 'resy',
              url: resyUrl,
              neighborhood: location.neighborhood || '',
              address: location.address_1 || ''
            });
          }
        }
        
        await sleep(300);
        continue;
      }

      const data = await resp.json();
      const venues = data?.results?.venues || data?.venues || data || [];
      const venueList = Array.isArray(venues) ? venues : [];
      
      for (const v of venueList) {
        const venue = v.venue || v;
        const name = venue.name;
        const slug = venue.url_slug || venue.slug;
        
        if (!name || !slug) continue;
        if (seen.has(slug)) continue;
        seen.add(slug);
        
        const resyUrl = `https://resy.com/cities/ny/${slug}`;
        const location = venue.location || {};
        results.push({
          name: name.trim(),
          normalized: normalize(name),
          platform: 'resy',
          url: resyUrl,
          neighborhood: location.neighborhood || '',
          address: location.address_1 || ''
        });
      }
      
      console.log(`  ✅ Resy "${query}": found ${venueList.length} venues (${results.length} total unique)`);
      await sleep(300); // Rate limit
      
    } catch (err) {
      console.log(`  ⚠️ Resy "${query}": ${err.message}`);
      await sleep(500);
    }
  }

  // Method 2: Crawl Resy's city page for venue slugs
  try {
    console.log('  📄 Crawling resy.com/cities/ny for additional venues...');
    const pageResp = await fetch('https://resy.com/cities/ny', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });
    
    if (pageResp.ok) {
      const html = await pageResp.text();
      // Extract venue slugs from the page
      const slugMatches = html.matchAll(/resy\.com\/cities\/ny\/([a-z0-9-]+)/g);
      let pageAdded = 0;
      for (const m of slugMatches) {
        const slug = m[1];
        if (seen.has(slug) || slug === 'ny' || slug.length < 3) continue;
        seen.add(slug);
        
        // Convert slug to name
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        results.push({
          name: name,
          normalized: normalize(name),
          platform: 'resy',
          url: `https://resy.com/cities/ny/${slug}`,
          neighborhood: '',
          address: ''
        });
        pageAdded++;
      }
      console.log(`  ✅ Page crawl: +${pageAdded} venues from HTML`);
    }
  } catch (err) {
    console.log(`  ⚠️ Page crawl failed: ${err.message}`);
  }

  console.log(`🔴 RESY TOTAL: ${results.length} unique NYC venues`);
  return results;
}

// ═══════════════════════════════════════════════════════════
// OPENTABLE SCRAPER — Uses OpenTable's internal API
// ═══════════════════════════════════════════════════════════
async function scrapeOpenTable() {
  console.log('\n🟢 SCRAPING OPENTABLE NYC...');
  const results = [];
  const seen = new Set();

  // OpenTable's search API — paginated, metroId 4 = New York
  // We search different terms to maximize coverage
  const searches = [
    '', // empty = all restaurants
    'italian', 'japanese', 'french', 'chinese', 'mexican', 'thai',
    'indian', 'korean', 'mediterranean', 'seafood', 'steakhouse',
    'american', 'sushi', 'greek', 'spanish', 'vietnamese',
    'brunch', 'fine dining', 'tapas', 'pizza', 'ramen',
    'bbq', 'peruvian', 'turkish', 'middle eastern', 'caribbean',
    'brazilian', 'ethiopian', 'german', 'british', 'african'
  ];

  for (const term of searches) {
    let startPage = 0;
    let totalPages = 1;

    while (startPage < totalPages && startPage < 10) { // Max 10 pages per search
      try {
        const params = new URLSearchParams({
          metroId: '4', // NYC
          regionIds: '4', 
          pageSize: '100',
          startPage: String(startPage),
          sortBy: 'Popularity',
          ...(term ? { term } : {})
        });

        const url = `https://www.opentable.com/dapi/fe/gql?query=${encodeURIComponent(`query RestaurantSearch { restaurantSearch(metroId:4, term:"${term}", first:100, offset:${startPage * 100}) { totalCount restaurants { name restaurantUrl } } }`)}`;

        // Try the simpler search endpoint
        const searchUrl = `https://www.opentable.com/s?term=${encodeURIComponent(term)}&metroId=4&startPage=${startPage}&covers=2&dateTime=${getTodayDate()}T19%3A00`;
        
        const resp = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/json',
          }
        });

        if (!resp.ok) {
          console.log(`  ⚠️ OpenTable "${term}" p${startPage}: HTTP ${resp.status}`);
          break;
        }

        const html = await resp.text();
        
        // Extract restaurant links from HTML
        // Pattern: /r/restaurant-slug-city
        const linkMatches = html.matchAll(/opentable\.com\/r\/([a-z0-9-]+)/g);
        let pageAdded = 0;
        
        for (const m of linkMatches) {
          const slug = m[1];
          if (seen.has(slug) || slug.length < 3) continue;
          
          // Filter to NYC-area slugs (most end in -new-york, -brooklyn, etc)
          const isNYC = slug.includes('-new-york') || slug.includes('-brooklyn') || 
                        slug.includes('-queens') || slug.includes('-bronx') ||
                        slug.includes('-manhattan') || slug.includes('-nyc') ||
                        slug.includes('-long-island-city') || slug.includes('-astoria') ||
                        slug.includes('-williamsburg') || slug.includes('-staten-island') ||
                        slug.includes('-jersey-city') || slug.includes('-hoboken');
          
          if (!isNYC) continue;
          
          seen.add(slug);
          
          // Convert slug to name (remove city suffix)
          const nameSlug = slug
            .replace(/-new-york(-\d+)?$/, '')
            .replace(/-brooklyn(-\d+)?$/, '')
            .replace(/-queens(-\d+)?$/, '')
            .replace(/-manhattan(-\d+)?$/, '')
            .replace(/-nyc(-\d+)?$/, '')
            .replace(/-bronx(-\d+)?$/, '')
            .replace(/-long-island-city(-\d+)?$/, '')
            .replace(/-astoria(-\d+)?$/, '')
            .replace(/-williamsburg(-\d+)?$/, '')
            .replace(/-staten-island(-\d+)?$/, '')
            .replace(/-jersey-city(-\d+)?$/, '')
            .replace(/-hoboken(-\d+)?$/, '');
          
          const name = nameSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          
          results.push({
            name: name.trim(),
            normalized: normalize(name),
            platform: 'opentable',
            url: `https://www.opentable.com/r/${slug}`,
            neighborhood: '',
            address: ''
          });
          pageAdded++;
        }
        
        // Also try to extract from JSON-LD or Next.js data
        const jsonMatches = html.matchAll(/"restaurantUrl"\s*:\s*"(\/r\/[^"]+)"/g);
        for (const jm of jsonMatches) {
          const path = jm[1];
          const slug = path.replace('/r/', '');
          if (seen.has(slug) || slug.length < 3) continue;
          seen.add(slug);
          
          const nameSlug = slug.replace(/-new-york(-\d+)?$/, '').replace(/-brooklyn(-\d+)?$/, '');
          const name = nameSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          
          results.push({
            name: name.trim(),
            normalized: normalize(name),
            platform: 'opentable',
            url: `https://www.opentable.com/r/${slug}`,
            neighborhood: '',
            address: ''
          });
          pageAdded++;
        }

        console.log(`  ✅ OpenTable "${term || 'all'}" p${startPage}: +${pageAdded} (${results.length} total)`);
        
        // Check if there are more pages
        if (pageAdded === 0) break;
        startPage++;
        await sleep(500); // Rate limit — OpenTable is stricter
        
      } catch (err) {
        console.log(`  ⚠️ OpenTable "${term}" p${startPage}: ${err.message}`);
        break;
      }
    }
  }

  // Also try OpenTable's list pages for NYC
  const listPages = [
    'https://www.opentable.com/new-york-restaurant-listings',
    'https://www.opentable.com/brooklyn-restaurant-listings',
    'https://www.opentable.com/m/best-restaurants-in-nyc/',
    'https://www.opentable.com/m/best-italian-restaurants-nyc/',
    'https://www.opentable.com/m/best-japanese-restaurants-nyc/',
    'https://www.opentable.com/m/best-french-restaurants-nyc/',
    'https://www.opentable.com/m/best-steakhouses-nyc/'
  ];

  for (const listUrl of listPages) {
    try {
      const resp = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html'
        }
      });
      
      if (!resp.ok) continue;
      const html = await resp.text();
      
      const linkMatches = html.matchAll(/\/r\/([a-z0-9-]+)/g);
      let added = 0;
      for (const m of linkMatches) {
        const slug = m[1];
        if (seen.has(slug) || slug.length < 3) continue;
        seen.add(slug);
        
        const nameSlug = slug.replace(/-new-york(-\d+)?$/, '').replace(/-brooklyn(-\d+)?$/, '');
        const name = nameSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        
        results.push({
          name: name.trim(),
          normalized: normalize(name),
          platform: 'opentable',
          url: `https://www.opentable.com/r/${slug}`,
          neighborhood: '',
          address: ''
        });
        added++;
      }
      
      if (added > 0) console.log(`  ✅ List page: +${added} from ${listUrl.split('/').pop()}`);
      await sleep(500);
      
    } catch (err) {
      // skip
    }
  }

  console.log(`🟢 OPENTABLE TOTAL: ${results.length} unique NYC venues`);
  return results;
}

// ═══════════════════════════════════════════════════════════
// TOCK SCRAPER — Crawl Tock's NYC page
// ═══════════════════════════════════════════════════════════
async function scrapeTock() {
  console.log('\n🔵 SCRAPING TOCK NYC...');
  const results = [];
  const seen = new Set();

  const tockUrls = [
    'https://www.exploretock.com/new-york',
    'https://www.exploretock.com/brooklyn',
    'https://www.exploretock.com/queens'
  ];

  for (const tockUrl of tockUrls) {
    try {
      const resp = await fetch(tockUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html'
        }
      });

      if (!resp.ok) continue;
      const html = await resp.text();

      // Extract venue slugs
      const matches = html.matchAll(/exploretock\.com\/([a-z0-9-]+)/g);
      let added = 0;
      
      for (const m of matches) {
        const slug = m[1];
        // Skip non-venue pages
        if (['new-york', 'brooklyn', 'queens', 'about', 'contact', 'help', 'terms', 'privacy', 'careers', 'blog', 'gift-cards', 'login', 'signup'].includes(slug)) continue;
        if (seen.has(slug) || slug.length < 3) continue;
        seen.add(slug);

        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        results.push({
          name: name.trim(),
          normalized: normalize(name),
          platform: 'tock',
          url: `https://www.exploretock.com/${slug}`,
          neighborhood: '',
          address: ''
        });
        added++;
      }

      console.log(`  ✅ Tock ${tockUrl.split('/').pop()}: +${added}`);
      await sleep(500);

    } catch (err) {
      console.log(`  ⚠️ Tock: ${err.message}`);
    }
  }

  console.log(`🔵 TOCK TOTAL: ${results.length} unique venues`);
  return results;
}

function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════
// MAIN — Merge everything
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('BOOKING LOOKUP EXPANDER');
  console.log('════════════════════════════════════════════════════════════');

  // Load existing
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(EXISTING_PATH, 'utf8'));
    console.log(`✅ Loaded existing booking_lookup.json: ${Object.keys(existing).length} entries`);
  } catch (err) {
    console.log('⚠️ No existing booking_lookup.json — starting fresh');
  }

  // Backup
  if (Object.keys(existing).length > 0) {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(existing, null, 2));
    console.log(`💾 Backup saved to ${BACKUP_PATH}`);
  }

  // Scrape all platforms
  const [resyResults, openTableResults, tockResults] = await Promise.all([
    scrapeResy(),
    scrapeOpenTable(),
    scrapeTock()
  ]);

  // Merge — existing entries take priority (never overwrite)
  const merged = { ...existing };
  let added = { resy: 0, opentable: 0, tock: 0 };
  let skippedDuplicate = 0;

  const allScraped = [...resyResults, ...openTableResults, ...tockResults];

  for (const r of allScraped) {
    const key = r.normalized || normalize(r.name);
    if (!key || key.length < 2) continue;

    // Skip if already exists
    if (merged[key]) {
      skippedDuplicate++;
      continue;
    }

    // Also check the original name as key
    const origKey = (r.name || '').toLowerCase().trim();
    if (merged[origKey]) {
      skippedDuplicate++;
      continue;
    }

    // Add new entry
    merged[key] = {
      platform: r.platform,
      url: r.url
    };

    // Also add with original name if different
    if (origKey && origKey !== key && !merged[origKey]) {
      merged[origKey] = {
        platform: r.platform,
        url: r.url
      };
    }

    added[r.platform]++;
  }

  // Save
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
  
  const totalNew = added.resy + added.opentable + added.tock;
  const totalEntries = Object.keys(merged).length;

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Existing entries:   ${Object.keys(existing).length}`);
  console.log(`  Scraped:            ${allScraped.length} total`);
  console.log(`    Resy:             ${resyResults.length} found, +${added.resy} new`);
  console.log(`    OpenTable:        ${openTableResults.length} found, +${added.opentable} new`);
  console.log(`    Tock:             ${tockResults.length} found, +${added.tock} new`);
  console.log(`  Skipped duplicates: ${skippedDuplicate}`);
  console.log(`  NEW TOTAL:          ${totalEntries} entries (+${totalNew} new)`);
  console.log(`\n💾 Saved to ${OUTPUT_PATH}`);
  console.log(`💾 Backup at ${BACKUP_PATH}`);

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    existing: Object.keys(existing).length,
    scraped: { resy: resyResults.length, opentable: openTableResults.length, tock: tockResults.length },
    added,
    skippedDuplicate,
    totalEntries
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to ${REPORT_PATH}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
