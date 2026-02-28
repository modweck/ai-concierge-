/**
 * enrich-booking-lookup.js
 * ========================
 * Adds lat/lng, google_rating, google_reviews to all booking_lookup entries
 * One-time run — ~2,941 Google API calls
 * 
 * RUN: node enrich-booking-lookup.js
 * FLAGS: --quick    First 50 only (test)
 *        --resume   Skip entries that already have lat/lng
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const BOOKING_FILE = path.join(__dirname, 'booking_enrichme.json');
const PROGRESS_FILE = path.join(__dirname, 'enrich_progress.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function lookupPlace(name) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' restaurant NYC')}&inputtype=textquery&fields=place_id,name,formatted_address,geometry,rating,user_ratings_total&key=${API_KEY}`;
    const resp = await fetch(searchUrl);
    const data = await resp.json();

    if (!data.candidates || !data.candidates.length) return null;

    const c = data.candidates[0];
    return {
      place_id: c.place_id,
      google_name: c.name,
      address: c.formatted_address,
      lat: c.geometry?.location?.lat,
      lng: c.geometry?.location?.lng,
      google_rating: c.rating || null,
      google_reviews: c.user_ratings_total || null
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  let booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  const keys = Object.keys(booking);

  let toProcess = keys.filter(k => !booking[k].lat || !booking[k].google_rating || !booking[k].google_reviews);
  console.log(`⏭️  Skipping ${keys.length - toProcess.length} already complete`);
  if (QUICK) toProcess = toProcess.slice(0, 50);

  console.log(`\n🔍 ENRICHING BOOKING LOOKUP WITH GOOGLE DATA`);
  console.log(`📊 Total: ${keys.length} | To process: ${toProcess.length}`);
  console.log(`⏱️  Estimated: ~${Math.round(toProcess.length * 0.3 / 60)} minutes`);
  console.log(`💰 API calls: ~${toProcess.length}\n`);

  let found = 0, notFound = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const key = toProcess[i];
    const entry = booking[key];
    
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${key.substring(0, 45).padEnd(45)} `);

    const result = await lookupPlace(key);

    if (result && result.lat) {
      booking[key] = {
        ...entry,
        lat: result.lat,
        lng: result.lng,
        google_rating: result.google_rating,
        google_reviews: result.google_reviews,
        address: result.address,
        place_id: result.place_id
      };
      found++;
      console.log(`✅ ${result.google_rating}⭐ ${result.google_reviews} reviews`);
    } else {
      notFound++;
      console.log(`❌`);
    }

    // Save every 100
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
      console.log(`  💾 Saved progress (${found} found, ${notFound} failed)`);
    }

    await sleep(100); // Rate limit
  }

  // Final save
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Found:    ${found}`);
  console.log(`   ❌ Failed:   ${notFound}`);
  console.log(`   📍 Total with lat/lng: ${Object.values(booking).filter(v => v.lat).length}`);
  console.log(`\nTo deploy:`);
  console.log(`  cp booking_lookup.json netlify/functions/booking_lookup.json`);
  console.log(`  git add -A && git commit -m "enriched booking lookup with coords" && git push`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
