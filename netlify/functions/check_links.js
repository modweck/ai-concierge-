#!/usr/bin/env node

/**
 * check_links.js — URL Validator for Restaurant App
 * 
 * Checks all booking URLs and buzz URLs for broken links.
 * 
 * SMART HANDLING:
 *   - OpenTable 503 → bot_blocked (works in browser)
 *   - Tock 403      → bot_blocked (works in browser)
 *   - Everything else is checked normally
 * 
 * HOW TO RUN:
 *   node check_links.js
 * 
 * OUTPUT:
 *   broken_links_report.json in the same directory
 */

const fs = require('fs');
const path = require('path');
const dir = __dirname;

// ─── LOAD DATA ───
let booking, buzzLinks;

try {
  booking = JSON.parse(fs.readFileSync(path.join(dir, 'booking_lookup.json'), 'utf8'));
  console.log(`✅ Loaded booking_lookup.json: ${Object.keys(booking).length} entries`);
} catch (e) {
  console.error('❌ Missing booking_lookup.json'); process.exit(1);
}

let indexHtml;
try {
  indexHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
} catch (e) {
  console.error('❌ Missing index.html'); process.exit(1);
}

// Prefer buzz_links.json if it exists, otherwise fall back to embedded BUZZ_LINKS
try {
  buzzLinks = JSON.parse(fs.readFileSync(path.join(dir, 'buzz_links.json'), 'utf8'));
  console.log(`✅ Loaded buzz_links.json: ${Object.keys(buzzLinks).length} entries`);
} catch (e) {
  const m = indexHtml.match(/const BUZZ_LINKS = ({.*?});/s);
  buzzLinks = m ? JSON.parse(m[1]) : {};
  console.log(`✅ Loaded BUZZ_LINKS from index.html: ${Object.keys(buzzLinks).length} entries`);
}

// ─── BUILD URL LIST ───
const urlsToCheck = [];

// Booking URLs
for (const [name, info] of Object.entries(booking)) {
  if (info.url) {
    urlsToCheck.push({
      name,
      url: info.url.replace(/\/+$/, ''),
      platform: info.platform || 'unknown',
      source: 'booking'
    });
  }
}

// Buzz URLs
for (const [name, entry] of Object.entries(buzzLinks)) {
  if (entry.links) {
    for (const link of entry.links) {
      urlsToCheck.push({
        name,
        url: link.url,
        platform: link.source || link.label || 'unknown',
        source: 'buzz'
      });
    }
  }
}

console.log(`\n🔍 Checking ${urlsToCheck.length} URLs...\n`);

// ─── CHECK URLS ───
const CONCURRENCY = 10;
const TIMEOUT = 10000;

async function checkUrl(item) {
  try {
    const resp = await fetch(item.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    // ── BOT BLOCKING (not broken) ──
    // OpenTable returns 503, Tock returns 403 — both work fine in browser
    if (item.url.includes('opentable.com') && resp.status === 503) {
      return { ...item, status: 503, result: 'bot_blocked' };
    }
    if (item.url.includes('exploretock.com') && resp.status === 403) {
      return { ...item, status: 403, result: 'bot_blocked' };
    }

    if (resp.ok) {
      return { ...item, status: resp.status, result: 'ok' };
    }

    // HEAD rejected? Retry with GET
    if (resp.status === 405) {
      const resp2 = await fetch(item.url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      if (resp2.ok) return { ...item, status: resp2.status, result: 'ok' };
      return { ...item, status: resp2.status, result: 'broken' };
    }

    return { ...item, status: resp.status, result: 'broken' };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return { ...item, status: null, error: 'TIMEOUT', result: 'timeout' };
    }
    return { ...item, status: null, error: err.message || 'FETCH_FAILED', result: 'error' };
  }
}

async function main() {
  const results = { ok: [], bot_blocked: [], broken: [], timeout: [], error: [] };
  let checked = 0;
  const total = urlsToCheck.length;

  // Process in batches
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = urlsToCheck.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkUrl));

    for (const r of batchResults) {
      results[r.result].push(r);
      checked++;

      if (r.result === 'broken') {
        console.log(`❌ [${r.status}] ${r.source}/${r.platform}: ${r.name}`);
        console.log(`   ${r.url}`);
      } else if (r.result === 'error') {
        console.log(`❌ [${r.error}] ${r.source}/${r.platform}: ${r.name}`);
        console.log(`   ${r.url}`);
      } else if (r.result === 'timeout') {
        console.log(`⏱️  [TIMEOUT] ${r.source}/${r.platform}: ${r.name}`);
        console.log(`   ${r.url}`);
      }
      // bot_blocked and ok are silent
    }

    if (checked % 50 < CONCURRENCY || checked >= total) {
      const brokenCount = results.broken.length + results.error.length;
      process.stdout.write(`  Progress: ${checked}/${total} (${Math.round(checked/total*100)}%) — ${brokenCount} broken, ${results.bot_blocked.length} bot-blocked\n`);
    }
  }

  // ─── REPORT ───
  console.log(`\n${'═'.repeat(60)}`);
  console.log('LINK CHECK REPORT');
  console.log('═'.repeat(60));
  console.log(`\nTotal checked:    ${total}`);
  console.log(`✅ OK:            ${results.ok.length}`);
  console.log(`🤖 Bot-blocked:   ${results.bot_blocked.length} (OpenTable 503 + Tock 403 — these work in browser)`);
  console.log(`❌ Broken (404):   ${results.broken.filter(r => r.status === 404).length}`);
  console.log(`❌ Other errors:   ${results.broken.filter(r => r.status !== 404).length + results.error.length}`);
  console.log(`⏱️  Timeouts:      ${results.timeout.length}`);

  // Separate buzz vs booking broken
  const brokenBuzz = results.broken.filter(r => r.source === 'buzz');
  const brokenBooking = results.broken.filter(r => r.source === 'booking');

  if (brokenBooking.length > 0) {
    console.log(`\n--- BROKEN BOOKING LINKS ---`);
    for (const r of brokenBooking) {
      console.log(`  [${r.status}] ${r.name} [${r.platform}]: ${r.url}`);
    }
  }

  if (brokenBuzz.length > 0) {
    console.log(`\n--- BROKEN BUZZ LINKS (${brokenBuzz.length}) ---`);
    for (const r of brokenBuzz) {
      console.log(`  ${r.name} [${r.platform}]: ${r.url}`);
    }
  }

  if (results.error.length > 0) {
    console.log(`\n--- CONNECTION ERRORS ---`);
    for (const r of results.error) {
      console.log(`  [${r.error}] ${r.name}: ${r.url}`);
    }
  }

  if (results.timeout.length > 0) {
    console.log(`\n--- TIMEOUTS ---`);
    for (const r of results.timeout) {
      console.log(`  ${r.name}: ${r.url}`);
    }
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    total_checked: total,
    ok: results.ok.length,
    bot_blocked: results.bot_blocked.length,
    broken_links: results.broken,
    timeouts: results.timeout.map(r => ({ name: r.name, url: r.url, source: r.source })),
    errors: results.error.map(r => ({ name: r.name, url: r.url, error: r.error }))
  };

  const reportPath = path.join(dir, 'broken_links_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to broken_links_report.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
