
#!/usr/bin/env node

/**
 * smart_fix_buzz_links.js
 * 
 * A smarter approach to fixing broken buzz links:
 * 1. First tries common URL slug variations (fast, no search needed)
 * 2. Falls back to DuckDuckGo site-specific search
 * 3. NEVER auto-removes links — generates a report for manual review
 * 4. Separates "fixed", "needs manual review", and "confirmed dead"
 * 
 * Usage: node smart_fix_buzz_links.js
 * 
 * Requires: broken_links_report.json and buzz_links.json in the same directory
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────
const DELAY_MS = 2500; // delay between HTTP requests to avoid rate limiting
const FETCH_TIMEOUT = 10000; // 10 second timeout per request
const MAX_SEARCH_RETRIES = 2;

// Common slug variations that Infatuation and Eater use
const SLUG_SUFFIXES = [
  '-nyc',
  '-new-york',
  '-restaurant',
  '-nyc-restaurant',
  '-bar-and-restaurant',
  '-new-york-city',
];

// Additional slug transformations to try
const SLUG_TRANSFORMS = [
  // Sometimes they add location qualifiers
  (slug) => slug + '-manhattan',
  (slug) => slug + '-brooklyn',
  (slug) => slug + '-nolita',
  (slug) => slug + '-soho',
  // Sometimes they remove trailing numbers
  (slug) => slug.replace(/-\d+$/, ''),
  // Sometimes hyphens change
  (slug) => slug.replace(/--/g, '-'),
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      method: 'HEAD', // HEAD is faster, we just need the status
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return { ok: response.ok, status: response.status, url: response.url };
  } catch (err) {
    clearTimeout(timeout);
    // If HEAD fails, try GET (some servers don't support HEAD)
    if (err.name !== 'AbortError') {
      try {
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), timeoutMs);
        const response = await fetch(url, {
          method: 'GET',
          signal: controller2.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          redirect: 'follow',
        });
        clearTimeout(timeout2);
        return { ok: response.ok, status: response.status, url: response.url };
      } catch (err2) {
        clearTimeout(timeout);
        return { ok: false, status: 0, error: err2.message };
      }
    }
    return { ok: false, status: 0, error: err.message };
  }
}

function extractSlug(url) {
  const parts = url.split('/');
  return parts[parts.length - 1] || parts[parts.length - 2];
}

function buildVariationUrls(originalUrl) {
  const slug = extractSlug(originalUrl);
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/'));
  
  const variations = [];
  
  // Try adding common suffixes
  for (const suffix of SLUG_SUFFIXES) {
    variations.push(`${baseUrl}/${slug}${suffix}`);
  }
  
  // Try slug transformations
  for (const transform of SLUG_TRANSFORMS) {
    const newSlug = transform(slug);
    if (newSlug !== slug) {
      variations.push(`${baseUrl}/${newSlug}`);
    }
  }
  
  return variations;
}

async function searchForReplacement(restaurantName, source) {
  const searchDomains = {
    'Eater': 'ny.eater.com',
    'Infatuation': 'theinfatuation.com',
    'GrubStreet': 'grubstreet.com',
  };
  
  const domain = searchDomains[source];
  if (!domain) return null;
  
  // Use DuckDuckGo HTML search (more bot-friendly than Google)
  const query = encodeURIComponent(`site:${domain} "${restaurantName}" review`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${query}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeout);
    
    const html = await response.text();
    
    // Extract URLs from DuckDuckGo results
    const urlPattern = new RegExp(`https?://${domain.replace('.', '\\.')}[^"\\s<>]+`, 'g');
    const matches = html.match(urlPattern) || [];
    
    // Filter for review/venue pages
    for (const match of matches) {
      const cleanUrl = match.replace(/&amp;/g, '&').split('&')[0];
      
      // For Infatuation, look for /reviews/ URLs
      if (source === 'Infatuation' && cleanUrl.includes('/reviews/')) {
        return cleanUrl;
      }
      // For Eater, look for /venue/ URLs
      if (source === 'Eater' && cleanUrl.includes('/venue/')) {
        return cleanUrl;
      }
    }
    
    return null;
  } catch (err) {
    console.log(`    ⚠️  Search failed: ${err.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('SMART BUZZ LINK FIXER');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');
  
  // Load broken links report
  let brokenReport;
  try {
    brokenReport = JSON.parse(fs.readFileSync('broken_links_report.json', 'utf8'));
    console.log('✅ Loaded broken_links_report.json');
  } catch (err) {
    console.error('❌ Could not load broken_links_report.json');
    console.error('   Run check_links.js first to generate the report');
    process.exit(1);
  }
  
  // Load buzz links
  let buzzLinks;
  try {
    buzzLinks = JSON.parse(fs.readFileSync('buzz_links.json', 'utf8'));
    console.log(`✅ Loaded buzz_links.json: ${Object.keys(buzzLinks).length} entries`);
  } catch (err) {
    console.error('❌ Could not load buzz_links.json');
    process.exit(1);
  }
  
  // Extract broken buzz links from the report
  const brokenBuzzLinks = (brokenReport.broken_links || brokenReport.broken || []).filter(item => {
    // Filter by source field if available, otherwise by URL
    if (item.source === 'buzz') return true;
    const url = item.url || '';
    return (
      url.includes('theinfatuation.com') ||
      url.includes('ny.eater.com') ||
      url.includes('grubstreet.com')
    );
  });
  
  console.log(`\n📊 Found ${brokenBuzzLinks.length} broken buzz links to process`);
  
  // Deduplicate by URL
  const seen = new Set();
  const uniqueBroken = brokenBuzzLinks.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  
  console.log(`   ${uniqueBroken.length} unique URLs after deduplication`);
  console.log(`   Estimated time: ~${Math.ceil(uniqueBroken.length * 3 / 60)} minutes\n`);
  
  // Results tracking
  const results = {
    fixed: [],          // Found a working replacement URL
    grubstreet_dead: [], // GrubStreet links (whole domain is dead)
    needs_manual: [],    // Couldn't find replacement automatically
    already_ok: [],      // Actually loads fine (was bot-blocked)
  };
  
  console.log('════════════════════════════════════════════════════════════');
  console.log('PROCESSING BROKEN BUZZ LINKS');
  console.log('════════════════════════════════════════════════════════════\n');
  
  for (let i = 0; i < uniqueBroken.length; i++) {
    const item = uniqueBroken[i];
    const url = item.url;
    const name = item.name || item.restaurant || 'Unknown';
    const source = url.includes('theinfatuation.com') ? 'Infatuation'
                 : url.includes('ny.eater.com') ? 'Eater'
                 : url.includes('grubstreet.com') ? 'GrubStreet'
                 : 'Unknown';
    
    console.log(`[${i + 1}/${uniqueBroken.length}] ${name} [${source}]`);
    console.log(`  Old: ${url}`);
    
    // Skip GrubStreet — their /listings/ path is entirely dead
    if (source === 'GrubStreet') {
      console.log(`  📋 GrubStreet /listings/ is deprecated — flagged for manual review`);
      results.grubstreet_dead.push({ name, source, old_url: url });
      continue;
    }
    
    // Step 1: Re-check the original URL (maybe it was bot-blocked before)
    await sleep(DELAY_MS);
    const recheck = await fetchWithTimeout(url);
    if (recheck.ok) {
      console.log(`  ✅ Actually works! (status ${recheck.status}) — was likely bot-blocked before`);
      results.already_ok.push({ name, source, url });
      continue;
    }
    
    // Step 2: Try URL variations
    const variations = buildVariationUrls(url);
    let found = false;
    
    for (const variation of variations) {
      await sleep(1000); // shorter delay for variation checks
      const check = await fetchWithTimeout(variation);
      if (check.ok) {
        console.log(`  ✅ FIXED via variation → ${variation}`);
        results.fixed.push({ name, source, old_url: url, new_url: variation });
        found = true;
        break;
      }
    }
    
    if (found) continue;
    
    // Step 3: Try DuckDuckGo search
    console.log(`  🔍 Trying search...`);
    await sleep(DELAY_MS);
    const searchResult = await searchForReplacement(name, source);
    
    if (searchResult && searchResult !== url) {
      // Verify the found URL actually works
      await sleep(1000);
      const verify = await fetchWithTimeout(searchResult);
      if (verify.ok) {
        console.log(`  ✅ FIXED via search → ${searchResult}`);
        results.fixed.push({ name, source, old_url: url, new_url: searchResult });
        continue;
      }
    }
    
    // Step 4: Couldn't fix — add to manual review list
    console.log(`  ❓ Needs manual review — no replacement found automatically`);
    results.needs_manual.push({ name, source, old_url: url });
  }
  
  // ─── Generate Report ──────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('RESULTS SUMMARY');
  console.log('════════════════════════════════════════════════════════════\n');
  
  console.log(`  ✅ Fixed (new URL found):     ${results.fixed.length}`);
  console.log(`  ✅ Actually OK (bot-blocked):  ${results.already_ok.length}`);
  console.log(`  📋 GrubStreet (deprecated):    ${results.grubstreet_dead.length}`);
  console.log(`  ❓ Needs manual review:        ${results.needs_manual.length}`);
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total_processed: uniqueBroken.length,
      fixed: results.fixed.length,
      actually_ok: results.already_ok.length,
      grubstreet_dead: results.grubstreet_dead.length,
      needs_manual: results.needs_manual.length,
    },
    fixed: results.fixed,
    actually_ok: results.already_ok,
    grubstreet_dead: results.grubstreet_dead,
    needs_manual: results.needs_manual,
  };
  
  fs.writeFileSync('smart_fix_report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Report saved to smart_fix_report.json');
  
  // ─── Apply Fixes (only the confirmed ones) ────────────────────────────────
  if (results.fixed.length > 0) {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('APPLYING CONFIRMED FIXES TO buzz_links.json');
    console.log('════════════════════════════════════════════════════════════\n');
    
    // Backup first
    fs.writeFileSync('buzz_links.pre_smart_fix.json', JSON.stringify(buzzLinks, null, 2));
    console.log('📦 Backup saved: buzz_links.pre_smart_fix.json');
    
    let appliedCount = 0;
    
    for (const fix of results.fixed) {
      // Find and update the link in buzz_links
      for (const [restaurantName, data] of Object.entries(buzzLinks)) {
        if (!data.links) continue;
        for (const link of data.links) {
          if (link.url === fix.old_url) {
            link.url = fix.new_url;
            appliedCount++;
            console.log(`  ✅ Updated: ${restaurantName} [${fix.source}]`);
            console.log(`     ${fix.old_url}`);
            console.log(`     → ${fix.new_url}`);
          }
        }
      }
    }
    
    fs.writeFileSync('buzz_links.json', JSON.stringify(buzzLinks, null, 2));
    console.log(`\n✅ Applied ${appliedCount} fixes to buzz_links.json`);
  }
  
  // ─── Helpful Next Steps ────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('NEXT STEPS');
  console.log('════════════════════════════════════════════════════════════\n');
  
  if (results.needs_manual.length > 0) {
    console.log('❓ NEEDS MANUAL REVIEW:');
    console.log('   These links are broken but no replacement was found automatically.');
    console.log('   Try searching each restaurant manually on the respective site.\n');
    
    for (const item of results.needs_manual) {
      console.log(`   ${item.name} [${item.source}]`);
      console.log(`     Old: ${item.old_url}`);
      if (item.source === 'Infatuation') {
        console.log(`     Try: https://www.theinfatuation.com/new-york?q=${encodeURIComponent(item.name)}`);
      } else if (item.source === 'Eater') {
        console.log(`     Try: https://ny.eater.com/search?q=${encodeURIComponent(item.name)}`);
      }
      console.log('');
    }
  }
  
  if (results.grubstreet_dead.length > 0) {
    console.log('\n📋 GRUBSTREET LINKS:');
    console.log('   GrubStreet\'s /listings/ path appears fully deprecated.');
    console.log('   Options: remove these links, or replace with a different source.\n');
  }
  
  console.log('💡 To apply fixes to index.html too, run:');
  console.log('   node apply_fixes_to_html.js\n');
}

main().catch(console.error);
