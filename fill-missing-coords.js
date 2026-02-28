/**
 * fill-missing-coords.js
 * 
 * Fills in missing lat/lng (and other data) for booking_lookup entries
 * using the Google Places Text Search API.
 * 
 * BEFORE RUNNING:
 * 1. Make sure you've regenerated your Google API key
 * 2. Paste your NEW key below where it says AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY
 * 3. Place your booking_lookup.json in the same folder as this script
 * 
 * HOW TO RUN:
 *   node fill-missing-coords.js
 * 
 * OUTPUT:
 *   booking_lookup_filled.json — your updated file with coordinates added
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// PUT YOUR NEW GOOGLE API KEY HERE
// ============================================================
const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
// ============================================================

if (API_KEY === 'SKIP_CHECK') {
  console.error('❌ You need to paste your Google API key on the line above!');
  console.error('   Open this file, find AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY, and replace it.');
  process.exit(1);
}

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or install node-fetch."); }
};

// Load booking_lookup.json
const LOOKUP_PATH = path.join(__dirname, 'booking_lookup.json');
if (!fs.existsSync(LOOKUP_PATH)) {
  console.error('❌ booking_lookup.json not found in the same folder as this script.');
  console.error('   Make sure the file is here:', __dirname);
  process.exit(1);
}

const booking = JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf8'));
const allKeys = Object.keys(booking);
const needCoords = allKeys.filter(k => !booking[k].lat || !booking[k].lng);

console.log(`📊 Total entries: ${allKeys.length}`);
console.log(`✅ Already have coordinates: ${allKeys.length - needCoords.length}`);
console.log(`🔍 Need coordinates: ${needCoords.length}`);

// Deduplicate by URL — only look up one entry per unique URL
const urlToKeys = {};
for (const key of needCoords) {
  const url = booking[key].url || '';
  if (!urlToKeys[url]) urlToKeys[url] = [];
  urlToKeys[url].push(key);
}

const uniqueURLs = Object.keys(urlToKeys);
console.log(`🎯 Unique URLs to look up: ${uniqueURLs.length}`);
console.log('');

// Rate limiting — Google allows ~50 requests/sec for Places API
// We'll be conservative and do 5 at a time with small delays
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function lookupRestaurant(name) {
  // Search for the restaurant in NYC using Google Places Text Search
  const query = `${name} restaurant New York City`;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const place = data.results[0];
      return {
        lat: place.geometry?.location?.lat || null,
        lng: place.geometry?.location?.lng || null,
        google_rating: place.rating || null,
        google_reviews: place.user_ratings_total || null,
        neighborhood: place.formatted_address || null,
        place_id: place.place_id || null,
        price_level: place.price_level || null
      };
    }
    
    return null;
  } catch (err) {
    console.error(`  ⚠️ Error looking up "${name}": ${err.message}`);
    return null;
  }
}

async function run() {
  let found = 0;
  let notFound = 0;
  let processed = 0;
  const total = uniqueURLs.length;
  
  // Save progress every 50 lookups in case something crashes
  const SAVE_INTERVAL = 50;

  for (const url of uniqueURLs) {
    const keys = urlToKeys[url];
    // Use the longest key name as the search term (usually the most descriptive)
    const bestName = keys.sort((a, b) => b.length - a.length)[0];
    
    processed++;
    const pct = Math.round((processed / total) * 100);
    process.stdout.write(`\r🔍 [${pct}%] ${processed}/${total} — Looking up: ${bestName.substring(0, 50).padEnd(50)}`);
    
    const result = await lookupRestaurant(bestName);
    
    if (result && result.lat && result.lng) {
      found++;
      // Apply the result to ALL keys that share this URL
      for (const key of keys) {
        booking[key].lat = result.lat;
        booking[key].lng = result.lng;
        if (result.google_rating && !booking[key].google_rating) {
          booking[key].google_rating = result.google_rating;
        }
        if (result.google_reviews && !booking[key].google_reviews) {
          booking[key].google_reviews = result.google_reviews;
        }
        if (result.neighborhood && !booking[key].neighborhood) {
          // Extract just the neighborhood from the full address
          const parts = (result.neighborhood || '').split(',');
          booking[key].neighborhood = parts.length > 1 ? parts[1].trim() : parts[0].trim();
        }
        if (result.place_id && !booking[key].place_id) {
          booking[key].place_id = result.place_id;
        }
        if (result.price_level != null && !booking[key].price) {
          booking[key].price = result.price_level;
        }
      }
    } else {
      notFound++;
    }
    
    // Save progress periodically
    if (processed % SAVE_INTERVAL === 0) {
      fs.writeFileSync(
        path.join(__dirname, 'booking_lookup_filled.json'),
        JSON.stringify(booking, null, 2)
      );
    }
    
    // Small delay to avoid hitting rate limits
    await sleep(200);
  }
  
  console.log('\n');
  
  // Final save
  const outputPath = path.join(__dirname, 'booking_lookup_filled.json');
  fs.writeFileSync(outputPath, JSON.stringify(booking, null, 2));
  
  // Count final stats
  const finalWithCoords = allKeys.filter(k => booking[k].lat && booking[k].lng).length;
  
  console.log('✅ Done!');
  console.log(`📊 Results:`);
  console.log(`   Found coordinates: ${found}/${total} unique restaurants`);
  console.log(`   Not found: ${notFound}/${total}`);
  console.log(`   Total entries with coordinates now: ${finalWithCoords}/${allKeys.length}`);
  console.log('');
  console.log(`💾 Saved to: ${outputPath}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Rename booking_lookup_filled.json to booking_lookup.json');
  console.log('2. Push to your GitHub repo');
  console.log('3. Netlify will auto-deploy with the updated data');
}

run().catch(err => {
  console.error('\n❌ Script failed:', err.message);
  // Save whatever progress we made
  const outputPath = path.join(__dirname, 'booking_lookup_filled.json');
  fs.writeFileSync(outputPath, JSON.stringify(booking, null, 2));
  console.log(`💾 Progress saved to: ${outputPath}`);
});
