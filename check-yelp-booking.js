#!/usr/bin/env node
/**
 * CHECK YELP FINDS ON RESY & OPENTABLE
 * ======================================
 * Takes the 41 reservable Yelp discoveries and checks
 * if they're on Resy or OpenTable using slug lookups.
 *
 * RUN: cd ~/ai-concierge- && node check-yelp-booking.js
 */

const fs = require('fs');
const path = require('path');

const YELP_FILE = path.join(__dirname, 'yelp-discoveries.json');
const yelp = JSON.parse(fs.readFileSync(YELP_FILE, 'utf8'));

const RESY_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Only reservable ones
const toCheck = yelp.filter(r =>
  r.transactions && r.transactions.includes('restaurant_reservation')
);

console.log(`\n🔍 CHECK YELP FINDS ON RESY & OPENTABLE`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Checking: ${toCheck.length} restaurants\n`);

// ═══════════════════════════════════════════
// SLUG GENERATION
// ═══════════════════════════════════════════

function generateSlugs(name) {
  let base = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''""`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[/()]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugs = new Set();
  slugs.add(base);
  slugs.add(`${base}-new-york`);
  slugs.add(`${base}-nyc`);

  // Remove location suffixes
  const locSuffixes = ['-new-york', '-nyc', '-brooklyn', '-manhattan', '-queens',
    '-bronx', '-tribeca', '-les', '-east-village', '-west-village',
    '-park-slope', '-forest-hills', '-chelsea', '-midtown',
    '-upper-west-side', '-upper-east-side', '-little-italy',
    '-restaurant', '-and-bar', '-and-restaurant', '-cuisine'];
  for (const suf of locSuffixes) {
    if (base.endsWith(suf)) {
      const stripped = base.slice(0, -suf.length);
      if (stripped.length >= 3) {
        slugs.add(stripped);
        slugs.add(`${stripped}-new-york`);
      }
    }
  }

  // Remove "the-"
  if (base.startsWith('the-')) {
    slugs.add(base.slice(4));
    slugs.add(`${base.slice(4)}-new-york`);
  }

  // First 1-3 words
  const words = base.split('-').filter(w => w.length > 0);
  if (words.length > 2) {
    slugs.add(words.slice(0, 2).join('-'));
    slugs.add(`${words.slice(0, 2).join('-')}-new-york`);
    slugs.add(words[0]);
    slugs.add(`${words[0]}-new-york`);
  }
  if (words.length > 3) {
    slugs.add(words.slice(0, 3).join('-'));
    slugs.add(`${words.slice(0, 3).join('-')}-new-york`);
  }

  return [...slugs].filter(s => s.length >= 3).slice(0, 15);
}

// ═══════════════════════════════════════════
// RESY CHECK (venue lookup by slug)
// ═══════════════════════════════════════════

async function checkResy(name) {
  const slugs = generateSlugs(name);

  for (const slug of slugs) {
    try {
      const url = `https://api.resy.com/3/venue?url_slug=${slug}&location=ny`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `ResyAPI api_key="${RESY_KEY}"`,
          'Accept': 'application/json',
        }
      });

      if (resp.ok) {
        const data = await resp.json();
        const venueName = data?.name || '';
        const venueSlug = data?.url_slug || slug;

        if (venueName && namesMatch(name, venueName)) {
          return {
            found: true,
            platform: 'resy',
            url: `https://resy.com/cities/ny/${venueSlug}`,
            matchedName: venueName,
            slug: venueSlug
          };
        }
      }
    } catch (e) { /* ignore */ }
    await sleep(150);
  }

  return { found: false };
}

// ═══════════════════════════════════════════
// OPENTABLE CHECK (slug + page verify)
// ═══════════════════════════════════════════

async function checkOT(name) {
  const slugs = generateSlugs(name);

  for (const slug of slugs) {
    try {
      const url = `https://www.opentable.com/r/${slug}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        redirect: 'follow',
      });

      if (resp.ok) {
        const html = await resp.text();
        if (html.includes('"@type":"Restaurant"') ||
            html.includes('data-restaurant-id') ||
            html.includes('RestaurantProfile')) {

          const titleMatch = html.match(/<title>([^|<]+)/);
          let pageName = titleMatch ? titleMatch[1]
            .replace(/\s*[-|]?\s*OpenTable.*$/i, '')
            .replace(/\s*Reservations?\s*$/i, '')
            .trim() : '';

          if (pageName && namesMatch(name, pageName)) {
            return {
              found: true,
              platform: 'opentable',
              url: resp.url || url,
              matchedName: pageName,
              slug
            };
          }
        }
      }
    } catch (e) { /* ignore */ }
    await sleep(200);
  }

  // Also try without /r/ prefix
  for (const slug of slugs.slice(0, 5)) {
    try {
      const url = `https://www.opentable.com/${slug}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        redirect: 'follow',
      });

      if (resp.ok) {
        const html = await resp.text();
        if (html.includes('"@type":"Restaurant"') ||
            html.includes('data-restaurant-id') ||
            html.includes('RestaurantProfile')) {

          const titleMatch = html.match(/<title>([^|<]+)/);
          let pageName = titleMatch ? titleMatch[1]
            .replace(/\s*[-|]?\s*OpenTable.*$/i, '')
            .replace(/\s*Reservations?\s*$/i, '')
            .trim() : '';

          if (pageName && namesMatch(name, pageName)) {
            return {
              found: true,
              platform: 'opentable',
              url: resp.url || url,
              matchedName: pageName,
              slug
            };
          }
        }
      }
    } catch (e) { /* ignore */ }
    await sleep(200);
  }

  return { found: false };
}

function namesMatch(a, b) {
  a = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  b = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const noise = new Set(['the', 'and', 'of', 'at', 'in', 'on', 'by', 'nyc', 'new', 'york', 'brooklyn', 'manhattan', 'restaurant', 'kitchen', 'grill', 'cuisine']);
  const wa = new Set(a.split(/\s+/).filter(w => w.length > 1 && !noise.has(w)));
  const wb = new Set(b.split(/\s+/).filter(w => w.length > 1 && !noise.has(w)));
  if (!wa.size || !wb.size) return false;

  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap / Math.min(wa.size, wb.size) >= 0.5;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  const found = [];
  const notFound = [];

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    process.stdout.write(`  [${i+1}/${toCheck.length}] ${r.name}...`);

    // Check Resy first (faster API)
    const resy = await checkResy(r.name);
    if (resy.found) {
      console.log(` ✅ RESY → ${resy.matchedName} (${resy.slug})`);
      found.push({ ...r, booking: resy });
      continue;
    }

    // Then OpenTable
    const ot = await checkOT(r.name);
    if (ot.found) {
      console.log(` ✅ OT → ${ot.matchedName} (${ot.slug})`);
      found.push({ ...r, booking: ot });
      continue;
    }

    console.log(` ❌`);
    notFound.push(r);
  }

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE in ${elapsed} minutes`);
  console.log(`  Found on Resy/OT: ${found.length}`);
  console.log(`  Not found: ${notFound.length}`);

  if (found.length > 0) {
    const resyCount = found.filter(f => f.booking.platform === 'resy').length;
    const otCount = found.filter(f => f.booking.platform === 'opentable').length;
    console.log(`  Resy: ${resyCount}, OpenTable: ${otCount}`);

    console.log(`\n🎫 FOUND:`);
    for (const f of found) {
      console.log(`  ${f.name} → ${f.booking.platform} (${f.booking.url})`);
    }

    // Save results
    const outFile = path.join(__dirname, 'yelp-booking-matches.json');
    fs.writeFileSync(outFile, JSON.stringify(found.map(f => ({
      name: f.name,
      address: f.address,
      lat: f.lat,
      lng: f.lng,
      yelpRating: f.yelpRating,
      yelpReviewCount: f.yelpReviewCount,
      categories: f.categories,
      platform: f.booking.platform,
      bookingUrl: f.booking.url,
      bookingSlug: f.booking.slug,
    })), null, 2));
    console.log(`\n💾 Saved to: yelp-booking-matches.json`);
  }

  if (notFound.length > 0) {
    console.log(`\n❌ NOT FOUND (may use other platforms):`);
    for (const r of notFound) {
      console.log(`  ${r.name} (${r.yelpRating}⭐, ${r.yelpReviewCount} rev)`);
    }
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
