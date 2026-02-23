#!/usr/bin/env node
/**
 * OPENTABLE LINK FINDER — Uses curl (not Node fetch) for HTTP requests
 *
 * Node fetch gets IP-blocked by OpenTable but curl does not.
 * Uses expanded URL slug guessing with strict page content validation.
 *
 * Run from: netlify/functions/
 *   node find_opentable_links.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const POPULAR_PATH = path.join(__dirname, 'popular_nyc.json');
const BOOKING_PATH = path.join(__dirname, 'booking_lookup.json');
const BACKUP_PATH = path.join(__dirname, 'booking_lookup.pre_ot_find.json');
const REPORT_PATH = path.join(__dirname, 'opentable_find_report.json');

const DELAY_MS = 2000;        // 2s between restaurants
const SLUG_DELAY_MS = 500;    // 0.5s between slug attempts for same restaurant
const CURL_TIMEOUT = 20;      // seconds
const SAVE_EVERY = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-\u2013\u2014]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|café|bistro|brasserie|kitchen|dining|room)$/i, '')
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
 * Generate OpenTable URL candidates for a restaurant name.
 */
function generateOTCandidates(name) {
  const slug = slugify(name);
  if (slug.length < 2) return [];

  const cleanName = name.replace(/\s*[-\u2013\u2014]\s*.+$/, '').trim();
  const cleanSlug = slugify(cleanName);

  const urls = new Set();

  urls.add(`https://www.opentable.com/r/${slug}-new-york`);
  urls.add(`https://www.opentable.com/r/${slug}-brooklyn`);
  urls.add(`https://www.opentable.com/${slug}`);
  urls.add(`https://www.opentable.com/r/${slug}-manhattan`);
  urls.add(`https://www.opentable.com/r/${slug}-queens`);
  urls.add(`https://www.opentable.com/r/${slug}`);

  if (cleanSlug !== slug && cleanSlug.length >= 2) {
    urls.add(`https://www.opentable.com/r/${cleanSlug}-new-york`);
    urls.add(`https://www.opentable.com/r/${cleanSlug}-brooklyn`);
    urls.add(`https://www.opentable.com/${cleanSlug}`);
  }

  return [...urls];
}

/**
 * Fetch a URL using curl. Returns { status, body, finalUrl, error }.
 */
function curlFetch(url) {
  try {
    // -s silent, -L follow redirects, -w write status+finalUrl, -o output body to stdout
    // We write status code and effective URL to a special separator so we can parse it
    const result = execSync(
      `curl -s -L --max-time ${CURL_TIMEOUT} ` +
      `-H 'Accept: text/html' ` +
      `-w '\\n__CURL_META__%{http_code} %{url_effective}' ` +
      `'${url}'`,
      { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, timeout: (CURL_TIMEOUT + 5) * 1000 }
    );

    const metaSep = result.lastIndexOf('__CURL_META__');
    if (metaSep === -1) {
      return { status: 0, body: result, finalUrl: url, error: 'no meta' };
    }

    const body = result.substring(0, metaSep);
    const metaLine = result.substring(metaSep + '__CURL_META__'.length).trim();
    const spaceIdx = metaLine.indexOf(' ');
    const status = parseInt(metaLine.substring(0, spaceIdx), 10);
    const finalUrl = metaLine.substring(spaceIdx + 1);

    return { status, body, finalUrl, error: null };
  } catch (err) {
    return { status: 0, body: '', finalUrl: url, error: err.message.substring(0, 100) };
  }
}

/**
 * Check if an OpenTable URL is a real restaurant page using curl.
 */
function checkOTPage(url) {
  const { status, body, finalUrl, error } = curlFetch(url);

  if (error) return { found: false, error };
  if (status !== 200) return { found: false, status };

  // Reject redirects to homepage or search
  if (finalUrl === 'https://www.opentable.com/' ||
      finalUrl.includes('/s?') ||
      finalUrl.includes('/start/home')) {
    return { found: false, redirect: true };
  }

  // Reject 404 pages served as 200
  if (body.includes('Page Not Found') ||
      body.includes('page-not-found') ||
      body.includes('404 -')) {
    return { found: false, is404: true };
  }

  // Must contain restaurant booking content
  if (body.includes('Make a reservation') ||
      body.includes('Find a time') ||
      body.includes('Booked') ||
      body.includes('restProfileSummary') ||
      (body.includes('opentable') && body.includes('reservation'))) {

    // Extract restaurant name from page title
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const pageName = titleMatch ? titleMatch[1].replace(/\s*[-|].*$/, '').trim() : null;

    return { found: true, url: finalUrl, pageName };
  }

  return { found: false, noBookingContent: true };
}

/**
 * Test connectivity using curl.
 */
function testConnectivity() {
  console.log('  Testing: curl https://www.opentable.com/');
  const { status, body, error } = curlFetch('https://www.opentable.com/');
  if (error) {
    console.error('  FAIL: curl error -', error);
    return false;
  }
  if (status === 200 || status === 301 || status === 302) {
    console.log('  OK: HTTP ' + status + ' (' + body.length + ' bytes)');
    return true;
  }
  console.error('  FAIL: HTTP ' + status);
  console.error('  Body (first 200 chars): ' + body.substring(0, 200));
  return false;
}

function searchOpenTable(restaurantName) {
  const candidates = generateOTCandidates(restaurantName);

  for (let j = 0; j < candidates.length; j++) {
    const url = candidates[j];
    const result = checkOTPage(url);

    if (result.found) {
      return {
        found: true,
        platform: 'opentable',
        url: result.url || url,
        pageName: result.pageName
      };
    }

    // If curl itself errors, might be a network issue
    if (result.error) {
      return { found: false, blocked: true, error: result.error };
    }

    // Small delay between slug attempts (synchronous sleep)
    if (j < candidates.length - 1) {
      execSync(`sleep ${SLUG_DELAY_MS / 1000}`);
    }
  }

  return { found: false };
}

async function main() {
  console.log('================================================================');
  console.log('OPENTABLE LINK FINDER (curl-based)');
  console.log('================================================================');

  console.log('\nTesting OpenTable connectivity...');
  const canConnect = testConnectivity();
  if (!canConnect) {
    console.error('\n  ERROR: Cannot reach OpenTable.');
    console.error('  Check your network connection.\n');
    process.exit(1);
  }

  let popular;
  try {
    popular = JSON.parse(fs.readFileSync(POPULAR_PATH, 'utf8'));
    console.log('\nPopular restaurants:', popular.length);
  } catch (err) {
    console.error('Cannot load popular_nyc.json:', err.message);
    process.exit(1);
  }

  let booking = {};
  try {
    booking = JSON.parse(fs.readFileSync(BOOKING_PATH, 'utf8'));
    console.log('Existing booking entries:', Object.keys(booking).length);
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

  console.log('\nMissing booking links:', missing.length);
  console.log('Delay: ' + (DELAY_MS / 1000) + 's between restaurants');
  console.log('================================================================\n');

  let found = 0, notFound = 0, blocked = 0;
  const newLinks = [];
  let consecutiveBlocks = 0;

  for (let i = 0; i < missing.length; i++) {
    const restaurant = missing[i];
    const name = restaurant.name;

    const result = searchOpenTable(name);

    if (result.blocked) {
      blocked++;
      consecutiveBlocks++;
      if (consecutiveBlocks >= 5) {
        console.log('\n  BLOCKED: 5 consecutive curl failures. Saving and exiting.');
        console.log('  Last error: ' + (result.error || 'unknown') + '\n');
        break;
      }
      continue;
    }

    consecutiveBlocks = 0;

    if (result.found) {
      const norm = normalize(name);
      const nameLower = name.toLowerCase().trim();
      booking[norm] = { platform: result.platform, url: result.url };
      if (nameLower !== norm) booking[nameLower] = { platform: result.platform, url: result.url };
      found++;
      newLinks.push({ name, platform: 'opentable', url: result.url, pageName: result.pageName });
      console.log('  \u2705 [' + Math.round((i + 1) / missing.length * 100) + '%] ' + name + ' -> ' + result.url);
    } else {
      notFound++;
    }

    // Save periodically
    if ((i + 1) % SAVE_EVERY === 0) {
      fs.writeFileSync(BOOKING_PATH, JSON.stringify(booking, null, 2));
      const pct = Math.round(found / (i + 1) * 100);
      console.log('\n  \ud83d\udcca Progress: ' + (i + 1) + '/' + missing.length +
        ' | OT found: ' + found + ' (' + pct + '%) | Not found: ' + notFound +
        ' | Blocked: ' + blocked + '\n');
    }

    await sleep(DELAY_MS);
  }

  // Final save
  fs.writeFileSync(BOOKING_PATH, JSON.stringify(booking, null, 2));
  const afterCount = Object.keys(booking).length;

  console.log('\n================================================================');
  console.log('RESULTS');
  console.log('================================================================');
  console.log('  Checked:       ' + (found + notFound + blocked));
  console.log('  \u2705 OT found:    ' + found);
  console.log('  \u274c Not found:   ' + notFound);
  console.log('  \u26a0\ufe0f  Blocked:     ' + blocked);
  console.log('  Before:        ' + beforeCount);
  console.log('  After:         ' + afterCount);
  console.log('\n\ud83d\udcbe Saved booking_lookup.json');

  const report = {
    timestamp: new Date().toISOString(),
    checked: found + notFound + blocked,
    found, notFound, blocked,
    beforeCount, afterCount, newLinks
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\ud83d\udcc4 Report: opentable_find_report.json');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
