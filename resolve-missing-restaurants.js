#!/usr/bin/env node
// resolve-missing-restaurants.js
// Looks up restaurants from availability_data.json via Google Places API
// and adds them to popular_nyc.json so they show up in search results.
//
// Usage: node resolve-missing-restaurants.js [--dry-run]
//
// Requires: GOOGLE_PLACES_API_KEY env variable or .env file
// Run from your ai-concierge- directory

const fs = require('fs');
const path = require('path');

// Try to load .env if dotenv is available
try { require('dotenv').config(); } catch(e) {}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('❌ Set GOOGLE_PLACES_API_KEY env variable or add to .env');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const FUNCTIONS_DIR = path.join(__dirname, 'netlify', 'functions');

// Load all existing data
const AVAIL = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'availability_data.json'), 'utf8'));
const POPULAR = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'popular_nyc.json'), 'utf8'));
const BOOKING = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'booking_lookup.json'), 'utf8'));

let MICHELIN = [], BIB = [], CHASE = [], RAKUTEN = [];
try { MICHELIN = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'michelin_nyc.json'), 'utf8')); } catch(e) {}
try { BIB = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'bib_gourmand_nyc.json'), 'utf8')); } catch(e) {}
try { CHASE = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'chase_sapphire_nyc.json'), 'utf8')); } catch(e) {}
try { RAKUTEN = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'rakuten_nyc.json'), 'utf8')); } catch(e) {}

let CUISINE = {};
try { CUISINE = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'cuisine_lookup.json'), 'utf8')); } catch(e) {}

// Build set of already-resolved names (normalized)
function norm(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`'.!?,;:\-–—()\[\]{}"]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ').trim();
}

const resolvedNames = new Set();
const resolvedIds = new Set();

for (const list of [MICHELIN, BIB, CHASE, RAKUTEN, POPULAR]) {
  for (const r of list) {
    if (r.name) resolvedNames.add(norm(r.name));
    if (r.place_id) resolvedIds.add(r.place_id);
  }
}

console.log(`Already resolved: ${resolvedNames.size} unique names across all curated lists`);

// Find restaurants with known availability that aren't resolved yet
const toResolve = [];
for (const [key, info] of Object.entries(AVAIL)) {
  const tier = info.availability_tier || 'unknown';
  if (tier === 'unknown') continue;

  const name = info.name || key;
  const nn = norm(name);

  // Skip if already in a curated list
  let found = false;
  if (resolvedNames.has(nn)) { found = true; }
  if (!found) {
    for (const rn of resolvedNames) {
      if (nn.includes(rn) || rn.includes(nn)) { found = true; break; }
    }
  }
  if (found) continue;

  toResolve.push({
    key,
    name,
    platform: info.platform,
    url: info.url,
    tier,
    curated_tier: info.curated_tier || null
  });
}

console.log(`Need to resolve: ${toResolve.length} restaurants`);
if (DRY_RUN) {
  console.log('\n--dry-run: would look up these restaurants:');
  toResolve.slice(0, 30).forEach(r => console.log(`  ${r.name} (${r.tier})`));
  if (toResolve.length > 30) console.log(`  ... and ${toResolve.length - 30} more`);
  process.exit(0);
}

// Google Places Text Search lookup
async function lookupPlace(name) {
  const query = encodeURIComponent(name + ' restaurant New York NY');
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=restaurant&key=${API_KEY}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'OK' || !data.results?.length) return null;

    // Find best match — prefer exact name match
    const nn = norm(name);
    let best = data.results[0]; // default to first result
    for (const r of data.results) {
      if (norm(r.name) === nn) { best = r; break; }
      if (norm(r.name).includes(nn) || nn.includes(norm(r.name))) { best = r; break; }
    }

    return {
      place_id: best.place_id,
      name: best.name,
      address: best.formatted_address || best.vicinity || '',
      lat: best.geometry?.location?.lat,
      lng: best.geometry?.location?.lng,
      googleRating: best.rating || 0,
      googleReviewCount: best.user_ratings_total || 0,
      price_level: best.price_level || null
    };
  } catch (e) {
    console.error(`  ❌ API error for "${name}": ${e.message}`);
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const newPopular = [];
  let resolved = 0, failed = 0, skipped = 0;

  for (let i = 0; i < toResolve.length; i++) {
    const r = toResolve[i];
    process.stdout.write(`[${i + 1}/${toResolve.length}] ${r.name}... `);

    const place = await lookupPlace(r.name);
    if (!place || !place.lat || !place.lng) {
      console.log('❌ not found');
      failed++;
      await sleep(200);
      continue;
    }

    // Check it's actually in NYC area (within ~20 miles of Manhattan)
    const dist = Math.sqrt(
      Math.pow((place.lat - 40.7580) * 69, 2) +
      Math.pow((place.lng - (-73.9855)) * 54.6, 2)
    );
    if (dist > 20) {
      console.log(`⚠️ too far (${Math.round(dist)} mi) — skipping`);
      skipped++;
      await sleep(200);
      continue;
    }

    // Skip if place_id already exists
    if (resolvedIds.has(place.place_id)) {
      console.log(`⏭️ place_id already in curated lists`);
      skipped++;
      await sleep(200);
      continue;
    }

    // Get booking info from booking_lookup
    const bk = BOOKING[r.key] || BOOKING[r.name] || BOOKING[r.name.toLowerCase()];
    const bookingPlatform = bk?.platform || r.platform || null;
    const bookingUrl = bk?.url || r.url || null;

    const entry = {
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      place_id: place.place_id,
      googleRating: place.googleRating,
      googleReviewCount: place.googleReviewCount,
      price_level: place.price_level,
      cuisine: CUISINE[r.name] || CUISINE[place.name] || null,
      booking_platform: bookingPlatform,
      booking_url: bookingUrl
    };

    newPopular.push(entry);
    resolvedIds.add(place.place_id);
    resolvedNames.add(norm(place.name));
    resolved++;

    console.log(`✅ ${place.name} (${place.googleRating}⭐, ${place.googleReviewCount} reviews)`);

    // Rate limit — 200ms between requests
    await sleep(200);

    // Save progress every 50 restaurants
    if (resolved % 50 === 0) {
      const merged = [...POPULAR, ...newPopular];
      fs.writeFileSync(path.join(FUNCTIONS_DIR, 'popular_nyc.json'), JSON.stringify(merged, null, 2));
      console.log(`\n💾 Progress saved: ${resolved} new + ${POPULAR.length} existing = ${merged.length} total\n`);
    }
  }

  // Final save
  const merged = [...POPULAR, ...newPopular];
  fs.writeFileSync(path.join(FUNCTIONS_DIR, 'popular_nyc.json'), JSON.stringify(merged, null, 2));

  // Also save just the new ones for reference
  fs.writeFileSync(path.join(FUNCTIONS_DIR, 'newly_resolved.json'), JSON.stringify(newPopular, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Resolved: ${resolved}`);
  console.log(`❌ Not found: ${failed}`);
  console.log(`⏭️ Skipped: ${skipped}`);
  console.log(`📊 popular_nyc.json: was ${POPULAR.length} → now ${merged.length}`);
  console.log(`💾 Saved newly_resolved.json (${newPopular.length} entries)`);
  console.log('\nDone! Push to GitHub to deploy.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
