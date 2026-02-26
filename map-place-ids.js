#!/usr/bin/env node
/**
 * map-place-ids.js
 * 
 * Run this AFTER availability-checker.js to add Google place_ids to availability_data.json.
 * This makes the frontend matching 100% accurate instead of relying on fuzzy name matching.
 *
 * Usage:
 *   node map-place-ids.js
 *
 * What it does:
 *   1. Reads availability_data.json (keyed by restaurant name)
 *   2. For each restaurant, looks up the Google Places place_id
 *   3. Saves availability_data.json with BOTH name keys AND place_id keys
 *   4. Caches the name→place_id mapping so future runs are instant
 *
 * Requires: GOOGLE_MAPS_KEY environment variable (same one your app uses)
 *   export GOOGLE_MAPS_KEY="your-key-here"
 *   node map-place-ids.js
 */

const fs = require('fs');
const path = require('path');

const AVAIL_PATH = path.join(__dirname, 'netlify/functions/availability_data.json');
const CACHE_PATH = path.join(__dirname, 'netlify/functions/place_id_cache.json');

const API_KEY = process.env.GOOGLE_MAPS_KEY;
if (!API_KEY) {
  console.error('❌ Set GOOGLE_MAPS_KEY environment variable first');
  console.error('   export GOOGLE_MAPS_KEY="your-key"');
  process.exit(1);
}

// Rate limiting
const DELAY_MS = 200; // 200ms between requests = 5/sec (well under Google's limit)
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lookupPlaceId(name) {
  const query = encodeURIComponent(name + ' restaurant New York NY');
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${API_KEY}`;
  
  const resp = await fetch(url);
  if (!resp.ok) return null;
  
  const data = await resp.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  
  // Return the top result's place_id
  return data.results[0].place_id;
}

async function main() {
  // Load availability data
  if (!fs.existsSync(AVAIL_PATH)) {
    console.error('❌ availability_data.json not found at:', AVAIL_PATH);
    console.error('   Run availability-checker.js first');
    process.exit(1);
  }
  
  const avail = JSON.parse(fs.readFileSync(AVAIL_PATH, 'utf8'));
  const names = Object.keys(avail);
  console.log(`📊 Loaded ${names.length} restaurants from availability_data.json`);

  // Load cache (previous name→place_id lookups)
  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    console.log(`📦 Loaded ${Object.keys(cache).length} cached place_id mappings`);
  }

  // Look up missing place_ids
  let looked = 0, found = 0, cached = 0, failed = 0;
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    
    // Skip if already cached
    if (cache[name]) {
      cached++;
      continue;
    }
    
    // Skip entries that look like place_ids already (from previous runs)
    if (name.startsWith('ChIJ') || name.startsWith('Eh')) {
      continue;
    }
    
    looked++;
    process.stdout.write(`  [${i + 1}/${names.length}] ${name}... `);
    
    const placeId = await lookupPlaceId(name);
    
    if (placeId) {
      cache[name] = placeId;
      found++;
      console.log(`✅ ${placeId}`);
    } else {
      cache[name] = null; // Mark as "looked up but not found" so we don't retry
      failed++;
      console.log('❌ not found');
    }
    
    await sleep(DELAY_MS);
    
    // Save cache every 50 lookups in case of interruption
    if (looked % 50 === 0) {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
    }
  }
  
  // Save final cache
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  
  console.log(`\n📊 Results:`);
  console.log(`   Cached (skipped): ${cached}`);
  console.log(`   Looked up: ${looked}`);
  console.log(`   Found: ${found}`);
  console.log(`   Not found: ${failed}`);

  // Now rebuild availability_data.json with place_id keys added
  const newAvail = {};
  let placeIdCount = 0;
  
  for (const [name, data] of Object.entries(avail)) {
    // Keep the original name key
    newAvail[name] = data;
    
    // Also add a place_id key pointing to the same data
    const placeId = cache[name];
    if (placeId) {
      newAvail[`pid:${placeId}`] = data;
      placeIdCount++;
    }
  }
  
  console.log(`\n💾 Writing availability_data.json with ${Object.keys(newAvail).length} keys`);
  console.log(`   (${names.length} by name + ${placeIdCount} by place_id)`);
  
  fs.writeFileSync(AVAIL_PATH, JSON.stringify(newAvail));
  console.log('✅ Done!');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
