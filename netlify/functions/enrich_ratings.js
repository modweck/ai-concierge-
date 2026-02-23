#!/usr/bin/env node
/**
 * ENRICH MICHELIN/BIB DATA WITH GOOGLE RATINGS
 * 
 * Looks up each restaurant on Google Places API and adds
 * googleRating and googleReviewCount to the JSON files.
 * 
 * Run from: netlify/functions/
 *   node enrich_ratings.js
 * 
 * Requires: GOOGLE_MAPS_API_KEY env var or .env file in project root
 */

const fs = require('fs');
const path = require('path');

const MICHELIN_PATH = path.join(__dirname, 'michelin_nyc.json');
const BIB_PATH = path.join(__dirname, 'bib_gourmand_nyc.json');

const DELAY_MS = 300;
const TIMEOUT_MS = 5000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getApiKey() {
  // Try env var first
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  
  // Try .env file
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch(e) {}

  // Try env.example
  try {
    const envPath = path.join(__dirname, '..', '..', 'env.example');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match && !match[1].includes('your_')) return match[1].trim();
  } catch(e) {}

  return null;
}

async function lookupRating(name, lat, lng, apiKey) {
  try {
    // Use Place Search to find the restaurant
    const query = encodeURIComponent(name + ' restaurant New York');
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=rating,user_ratings_total,place_id,name&locationbias=point:${lat},${lng}&key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    if (data.candidates && data.candidates.length > 0) {
      const c = data.candidates[0];
      return {
        googleRating: c.rating || null,
        googleReviewCount: c.user_ratings_total || null,
        place_id: c.place_id || null
      };
    }
    return null;
  } catch(e) {
    return null;
  }
}

async function enrichFile(filePath, label, apiKey) {
  let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const total = data.length;
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  console.log('\n' + label + ': ' + total + ' restaurants');

  for (let i = 0; i < data.length; i++) {
    const r = data[i];

    // Skip if already has rating
    if (r.googleRating && r.googleReviewCount) {
      skipped++;
      continue;
    }

    const result = await lookupRating(r.name, r.lat, r.lng, apiKey);

    if (result && result.googleRating) {
      data[i].googleRating = result.googleRating;
      data[i].googleReviewCount = result.googleReviewCount;
      if (result.place_id && !data[i].place_id) {
        data[i].place_id = result.place_id;
      }
      enriched++;
      console.log('  [' + (i+1) + '/' + total + '] ' + r.name + ' -> ' + result.googleRating + ' (' + result.googleReviewCount + ' reviews)');
    } else {
      failed++;
      console.log('  [' + (i+1) + '/' + total + '] ' + r.name + ' -> not found');
    }

    await sleep(DELAY_MS);
  }

  // Save
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log('\n  ' + label + ' results:');
  console.log('    Enriched: ' + enriched);
  console.log('    Skipped (already had rating): ' + skipped);
  console.log('    Not found: ' + failed);

  return { enriched, skipped, failed };
}

async function main() {
  console.log('========================================');
  console.log('ENRICH MICHELIN/BIB WITH GOOGLE RATINGS');
  console.log('========================================');

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error('No Google Maps API key found.');
    console.error('Set GOOGLE_MAPS_API_KEY env var or add to .env file');
    console.error('Example: GOOGLE_MAPS_API_KEY=your_key_here node enrich_ratings.js');
    process.exit(1);
  }
  console.log('API key found');

  const m = await enrichFile(MICHELIN_PATH, 'Michelin', apiKey);
  const b = await enrichFile(BIB_PATH, 'Bib Gourmand', apiKey);

  console.log('\n========================================');
  console.log('DONE');
  console.log('========================================');
  console.log('Total enriched: ' + (m.enriched + b.enriched));
  console.log('Total skipped: ' + (m.skipped + b.skipped));
  console.log('Total not found: ' + (m.failed + b.failed));
  console.log('\nNext steps:');
  console.log('1. git add netlify/functions/michelin_nyc.json netlify/functions/bib_gourmand_nyc.json');
  console.log('2. git commit -m "Add Google ratings to Michelin/Bib data"');
  console.log('3. git push');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
