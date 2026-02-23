#!/usr/bin/env node

/**
 * fix_buzz_links.js — Automated Buzz Link Fixer
 * 
 * Fixes broken Infatuation, Eater, and GrubStreet review URLs
 * by searching Google/DuckDuckGo for the current page.
 * 
 * PREREQUISITES:
 *   1. Run check_links.js first to generate broken_links_report.json
 *   2. Make sure index.html is in the same directory
 * 
 * HOW TO RUN:
 *   node fix_buzz_links.js
 * 
 * OUTPUT:
 *   - Updated index.html with fixed BUZZ_LINKS
 *   - Backup of original at index.backup.html
 *   - buzz_fix_report.json with details of what was fixed
 * 
 * REQUIRES: Node 18+ (uses built-in fetch)
 */

const fs = require('fs');
const path = require('path');
const dir = __dirname;

// ─── CONFIG ───
const DELAY_MS = 3000;         // 3s between Google searches to avoid rate limits
const SEARCH_TIMEOUT = 10000;
const VERIFY_TIMEOUT = 8000;

// ─── LOAD DATA ───
let report, indexHtml, buzzLinks, buzzJsonPath, hasBuzzJson = false;

try {
  report = JSON.parse(fs.readFileSync(path.join(dir, 'broken_links_report.json'), 'utf8'));
  console.log(`✅ Loaded broken_links_report.json`);
} catch (e) {
  console.error('❌ Missing broken_links_report.json — run check_links.js first');
  process.exit(1);
}

// Load buzz_links.json (primary source of truth)
buzzJsonPath = path.join(dir, 'buzz_links.json');
try {
  buzzLinks = JSON.parse(fs.readFileSync(buzzJsonPath, 'utf8'));
  hasBuzzJson = true;
  console.log(`✅ Loaded buzz_links.json: ${Object.keys(buzzLinks).length} entries`);
} catch (e) {
  console.log(`⚠️  No buzz_links.json found, will try index.html`);
}

// Also load index.html (has embedded copy of BUZZ_LINKS)
try {
  indexHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (!hasBuzzJson) {
    const m = indexHtml.match(/const BUZZ_LINKS = ({.*?});/s);
    buzzLinks = m ? JSON.parse(m[1]) : {};
    console.log(`✅ Loaded BUZZ_LINKS from index.html: ${Object.keys(buzzLinks).length} entries`);
  } else {
    console.log(`✅ Loaded index.html (will update embedded BUZZ_LINKS too)`);
  }
} catch (e) {
  if (!hasBuzzJson) {
    console.error('❌ Missing both buzz_links.json and index.html');
    process.exit(1);
  }
  console.log(`⚠️  No index.html found, will only update buzz_links.json`);
}

// ─── EXTRACT BROKEN BUZZ LINKS ───
const brokenBuzz = report.broken_links.filter(l => l.source === 'buzz' && l.status === 404);
console.log(`\n📊 Found ${brokenBuzz.length} broken buzz links to fix`);

// Deduplicate by URL
const uniqueBroken = new Map();
for (const link of brokenBuzz) {
  if (!uniqueBroken.has(link.url)) uniqueBroken.set(link.url, link);
}
console.log(`   ${uniqueBroken.size} unique URLs after deduplication`);
console.log(`   Estimated time: ~${Math.round(uniqueBroken.size * 4 / 60)} minutes\n`);

// ─── HELPERS ───
const sleep = ms => new Promise(r => setTimeout(r, ms));

let googleBlocked = false; // Track if Google is blocking us

/**
 * Search Google for URLs
 */
async function searchGoogle(query) {
  if (googleBlocked) return searchDuckDuckGo(query);

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await resp.text();

    if (html.includes('unusual traffic') || html.includes('captcha') || html.includes('sorry/index')) {
      console.log('  ⚠️  Google is rate-limiting us, switching to DuckDuckGo...');
      googleBlocked = true;
      return searchDuckDuckGo(query);
    }

    const urls = new Set();
    // Extract /url?q= redirects
    const re = /\/url\?q=(https?:\/\/[^&"]+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const decoded = decodeURIComponent(m[1]);
      if (!decoded.includes('google.com') && !decoded.includes('gstatic.com')) {
        urls.add(decoded);
      }
    }
    return [...urls];
  } catch (err) {
    console.log(`  ⚠️  Google search error: ${err.message}`);
    return searchDuckDuckGo(query);
  }
}

/**
 * DuckDuckGo fallback
 */
async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    const html = await resp.text();

    const urls = new Set();
    // DDG uses uddg= redirect params
    const re = /uddg=(https?[^&"]+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      urls.add(decodeURIComponent(m[1]));
    }
    // Also try direct href
    const re2 = /href="(https?:\/\/(?:www\.)?(?:theinfatuation\.com|ny\.eater\.com|grubstreet\.com)[^"]+)"/g;
    while ((m = re2.exec(html)) !== null) {
      urls.add(m[1]);
    }
    return [...urls];
  } catch {
    return [];
  }
}

/**
 * Verify a URL actually works
 */
async function verifyUrl(url) {
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(VERIFY_TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    if (resp.status === 405) {
      // Retry with GET if HEAD rejected
      const resp2 = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(VERIFY_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      return resp2.ok;
    }
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── FINDERS ───

async function findInfatuation(name) {
  // Try exact match first
  let results = await searchGoogle(`site:theinfatuation.com/new-york/reviews "${name}"`);
  let candidates = results.filter(u => u.includes('theinfatuation.com/new-york/reviews/'));

  for (const url of candidates.slice(0, 3)) {
    if (await verifyUrl(url)) return url;
  }

  // Broader search
  await sleep(1500);
  results = await searchGoogle(`theinfatuation.com "${name}" New York review`);
  candidates = results.filter(u => u.includes('theinfatuation.com/new-york/reviews/'));

  for (const url of candidates.slice(0, 3)) {
    if (await verifyUrl(url)) return url;
  }
  return null;
}

async function findEater(name) {
  let results = await searchGoogle(`site:ny.eater.com/venue "${name}"`);
  let candidates = results.filter(u => u.includes('ny.eater.com/venue/'));

  for (const url of candidates.slice(0, 3)) {
    if (await verifyUrl(url)) return url;
  }

  // Broader
  await sleep(1500);
  results = await searchGoogle(`ny.eater.com "${name}" venue`);
  candidates = results.filter(u => u.includes('ny.eater.com'));

  for (const url of candidates.slice(0, 3)) {
    if (await verifyUrl(url)) return url;
  }
  return null;
}

async function findGrubStreet(name) {
  const results = await searchGoogle(`site:grubstreet.com/listings "${name}"`);
  const candidates = results.filter(u => u.includes('grubstreet.com/listings/'));

  for (const url of candidates.slice(0, 2)) {
    if (await verifyUrl(url)) return url;
  }
  return null;
}

// ─── MAIN ───
async function main() {
  const fixReport = {
    timestamp: new Date().toISOString(),
    total_broken: uniqueBroken.size,
    fixed: [],
    not_found: [],
    entries_cleaned: []
  };

  console.log('═'.repeat(60));
  console.log('FIXING BROKEN BUZZ LINKS');
  console.log('═'.repeat(60));

  let idx = 0;
  for (const [oldUrl, link] of uniqueBroken) {
    idx++;
    console.log(`\n[${idx}/${uniqueBroken.size}] ${link.name} [${link.platform}]`);
    console.log(`  Old: ${oldUrl}`);

    let newUrl = null;

    if (oldUrl.includes('theinfatuation.com')) {
      newUrl = await findInfatuation(link.name);
    } else if (oldUrl.includes('ny.eater.com')) {
      newUrl = await findEater(link.name);
    } else if (oldUrl.includes('grubstreet.com')) {
      newUrl = await findGrubStreet(link.name);
    }

    if (newUrl && newUrl !== oldUrl) {
      // Update in buzzLinks
      for (const entry of Object.values(buzzLinks)) {
        if (entry.links) {
          for (const bl of entry.links) {
            if (bl.url === oldUrl) bl.url = newUrl;
          }
        }
      }
      fixReport.fixed.push({
        name: link.name,
        source: link.platform,
        old_url: oldUrl,
        new_url: newUrl
      });
      console.log(`  ✅ FIXED → ${newUrl}`);
    } else {
      // Remove the broken link from buzz entry
      for (const entry of Object.values(buzzLinks)) {
        if (entry.links) {
          entry.links = entry.links.filter(l => l.url !== oldUrl);
        }
      }
      fixReport.not_found.push({
        name: link.name,
        source: link.platform,
        old_url: oldUrl
      });
      console.log(`  ❌ REMOVED — no replacement found`);
    }

    await sleep(DELAY_MS);
  }

  // Clean up buzz entries with no links remaining
  for (const [name, entry] of Object.entries(buzzLinks)) {
    if (!entry.links || entry.links.length === 0) {
      fixReport.entries_cleaned.push(name);
      delete buzzLinks[name];
    }
  }

  // ─── SAVE ───
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SAVING');
  console.log('═'.repeat(60));

  // Backup originals
  if (hasBuzzJson) {
    fs.copyFileSync(buzzJsonPath, path.join(dir, 'buzz_links.backup.json'));
    console.log('📦 Backup saved: buzz_links.backup.json');
  }
  if (indexHtml) {
    fs.copyFileSync(path.join(dir, 'index.html'), path.join(dir, 'index.backup.html'));
    console.log('📦 Backup saved: index.backup.html');
  }

  // Save updated buzz_links.json
  if (hasBuzzJson) {
    fs.writeFileSync(buzzJsonPath, JSON.stringify(buzzLinks, null, 2));
    console.log('✅ buzz_links.json updated');
  }

  // Save updated index.html (update the embedded BUZZ_LINKS)
  if (indexHtml) {
    const newBuzzStr = `const BUZZ_LINKS = ${JSON.stringify(buzzLinks, null, 2)};`;
    const updatedHtml = indexHtml.replace(/const BUZZ_LINKS = {.*?};/s, newBuzzStr);
    fs.writeFileSync(path.join(dir, 'index.html'), updatedHtml);
    console.log('✅ index.html updated');
  }

  // Save report
  fs.writeFileSync(path.join(dir, 'buzz_fix_report.json'), JSON.stringify(fixReport, null, 2));
  console.log('✅ buzz_fix_report.json saved');

  // ─── SUMMARY ───
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Total broken buzz links: ${uniqueBroken.size}`);
  console.log(`  ✅ Fixed:               ${fixReport.fixed.length}`);
  console.log(`  ❌ Removed (not found):  ${fixReport.not_found.length}`);
  console.log(`  🗑️  Entries cleaned up:   ${fixReport.entries_cleaned.length}`);
  console.log(`\n💡 NEXT STEPS:`);
  console.log(`  1. Review buzz_fix_report.json`);
  console.log(`  2. Upload buzz_fix_report.json to Claude for manual review of "not found" items`);
  console.log(`  3. Run check_links.js again to verify`);
  console.log(`  4. Deploy updated index.html`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
