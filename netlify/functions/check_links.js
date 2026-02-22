#!/usr/bin/env node

/**
 * Broken Link Checker for SeatSnags Restaurant App
 * 
 * HOW TO RUN:
 *   1. Put this file in the same folder as booking_lookup.json and index.html
 *   2. Run: node check_links.js
 *   3. Results saved to broken_links_report.json
 * 
 * Checks all OpenTable, Resy, Tock, and Infatuation/Eater URLs
 * for 404s, redirects, and connection errors.
 */

const fs = require('fs');
const path = require('path');

// ─── CONFIG ───
const CONCURRENCY = 5;        // how many URLs to check at once (don't hammer servers)
const TIMEOUT_MS = 10000;      // 10 second timeout per URL
const DELAY_BETWEEN_MS = 200;  // small delay between batches

// ─── LOAD DATA ───
let bookingLookup = {};
let buzzLinks = {};

// Load booking_lookup.json
try {
  bookingLookup = JSON.parse(fs.readFileSync(path.join(__dirname, 'booking_lookup.json'), 'utf8'));
  console.log(`✅ Loaded booking_lookup.json: ${Object.keys(bookingLookup).length} entries`);
} catch (e) {
  console.error('❌ Could not load booking_lookup.json:', e.message);
}

// Load buzz links from index.html
try {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const match = html.match(/const BUZZ_LINKS = ({.*?});/s);
  if (match) {
    buzzLinks = JSON.parse(match[1]);
    console.log(`✅ Loaded BUZZ_LINKS from index.html: ${Object.keys(buzzLinks).length} entries`);
  }
} catch (e) {
  console.error('❌ Could not load index.html:', e.message);
}

// ─── BUILD URL LIST ───
const urlsToCheck = [];

// Booking URLs
for (const [name, info] of Object.entries(bookingLookup)) {
  if (info.url) {
    urlsToCheck.push({
      name,
      url: info.url,
      source: 'booking',
      platform: info.platform
    });
  }
}

// Buzz URLs
for (const [name, entry] of Object.entries(buzzLinks)) {
  for (const link of (entry.links || [])) {
    if (link.url) {
      urlsToCheck.push({
        name,
        url: link.url,
        source: 'buzz',
        platform: link.source || link.label
      });
    }
  }
}

console.log(`\n🔍 Checking ${urlsToCheck.length} URLs...\n`);

// ─── CHECK FUNCTION ───
async function checkUrl(entry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(entry.url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    clearTimeout(timeout);

    // Some sites block HEAD requests — retry with GET if we get 405
    if (response.status === 405) {
      const getResp = await fetch(entry.url, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      return { ...entry, status: getResp.status, ok: getResp.ok, error: null };
    }

    return { ...entry, status: response.status, ok: response.ok, error: null };
  } catch (err) {
    clearTimeout(timeout);
    return { ...entry, status: null, ok: false, error: err.name === 'AbortError' ? 'TIMEOUT' : err.message };
  }
}

// ─── RUN IN BATCHES ───
async function runChecks() {
  const results = [];
  const broken = [];
  let checked = 0;

  for (let i = 0; i < urlsToCheck.length; i += CONCURRENCY) {
    const batch = urlsToCheck.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkUrl));

    for (const result of batchResults) {
      results.push(result);
      checked++;

      if (!result.ok) {
        broken.push(result);
        console.log(`❌ [${result.status || result.error}] ${result.source}/${result.platform}: ${result.name}`);
        console.log(`   ${result.url}`);
      }
    }

    // Progress update every 50
    if (checked % 50 === 0 || checked === urlsToCheck.length) {
      const pct = Math.round((checked / urlsToCheck.length) * 100);
      process.stdout.write(`\r  Progress: ${checked}/${urlsToCheck.length} (${pct}%) — ${broken.length} broken so far`);
    }

    // Be polite to servers
    if (i + CONCURRENCY < urlsToCheck.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
    }
  }

  console.log('\n');

  // ─── REPORT ───
  console.log('═'.repeat(60));
  console.log('BROKEN LINK REPORT');
  console.log('═'.repeat(60));

  // Group by type
  const booking404 = broken.filter(b => b.source === 'booking' && b.status === 404);
  const buzz404 = broken.filter(b => b.source === 'buzz' && b.status === 404);
  const timeouts = broken.filter(b => b.error === 'TIMEOUT');
  const otherErrors = broken.filter(b => b.error && b.error !== 'TIMEOUT');
  const otherStatus = broken.filter(b => b.status && b.status !== 404);

  console.log(`\nTotal checked: ${results.length}`);
  console.log(`Total broken:  ${broken.length}`);
  console.log(`  404 Not Found (booking): ${booking404.length}`);
  console.log(`  404 Not Found (buzz):    ${buzz404.length}`);
  console.log(`  Timeouts:                ${timeouts.length}`);
  console.log(`  Other HTTP errors:       ${otherStatus.length}`);
  console.log(`  Connection errors:       ${otherErrors.length}`);

  if (booking404.length > 0) {
    console.log('\n--- BOOKING 404s (restaurant page not found) ---');
    for (const b of booking404) {
      console.log(`  ${b.name} [${b.platform}]: ${b.url}`);
    }
  }

  if (buzz404.length > 0) {
    console.log('\n--- BUZZ 404s (review page not found) ---');
    for (const b of buzz404) {
      console.log(`  ${b.name} [${b.platform}]: ${b.url}`);
    }
  }

  if (otherStatus.length > 0) {
    console.log('\n--- OTHER HTTP ERRORS ---');
    for (const b of otherStatus) {
      console.log(`  [${b.status}] ${b.name} [${b.platform}]: ${b.url}`);
    }
  }

  // Save full report
  const report = {
    timestamp: new Date().toISOString(),
    total_checked: results.length,
    total_broken: broken.length,
    summary: {
      booking_404: booking404.length,
      buzz_404: buzz404.length,
      timeouts: timeouts.length,
      other_http: otherStatus.length,
      connection_errors: otherErrors.length
    },
    broken_links: broken.map(b => ({
      name: b.name,
      url: b.url,
      source: b.source,
      platform: b.platform,
      status: b.status,
      error: b.error
    }))
  };

  fs.writeFileSync(path.join(__dirname, 'broken_links_report.json'), JSON.stringify(report, null, 2));
  console.log('\n📄 Full report saved to broken_links_report.json');
}

runChecks().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
