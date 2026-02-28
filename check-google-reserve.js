/**
 * check-google-reserve.js
 * 
 * Checks Google Places API to see which restaurants actually have 
 * Google Reserve (reservable flag / booking URL).
 * 
 * RUN: node check-google-reserve.js
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const INPUT_FILE = path.join(__dirname, 'google_reserve_final.json');
const OUTPUT_FILE = path.join(__dirname, 'google_reserve_verified.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkReservable(name) {
  try {
    // Step 1: Find the place
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' NYC')}&inputtype=textquery&fields=place_id,name,formatted_address&key=${API_KEY}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();
    
    if (!searchData.candidates || !searchData.candidates.length) {
      return { found: false, error: 'not_found' };
    }
    
    const placeId = searchData.candidates[0].place_id;
    const foundName = searchData.candidates[0].name;
    const address = searchData.candidates[0].formatted_address;
    
    // Step 2: Get place details including reservable field
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,reservable,url,website,formatted_phone_number,price_level,rating,user_ratings_total,geometry,types,business_status&key=${API_KEY}`;
    const detailResp = await fetch(detailUrl);
    const detailData = await detailResp.json();
    
    if (!detailData.result) {
      return { found: true, placeId, name: foundName, address, reservable: false, error: 'no_details' };
    }
    
    const r = detailData.result;
    return {
      found: true,
      placeId,
      name: r.name || foundName,
      address,
      reservable: r.reservable === true,
      website: r.website || null,
      phone: r.formatted_phone_number || null,
      rating: r.rating || null,
      reviews: r.user_ratings_total || null,
      price_level: r.price_level || null,
      lat: r.geometry?.location?.lat || null,
      lng: r.geometry?.location?.lng || null,
      types: r.types || [],
      business_status: r.business_status || null,
      google_maps_url: r.url || null
    };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

async function main() {
  let data;
  try { data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8')); }
  catch (e) { console.error('❌ Cannot load', INPUT_FILE); process.exit(1); }

  console.log(`\n🔍 GOOGLE RESERVE CHECKER`);
  console.log(`📊 Checking ${data.length} restaurants`);
  console.log(`⏱️  Estimated time: ~${Math.round(data.length * 0.5 / 60)} minutes\n`);

  const verified = [];
  const notReservable = [];
  const notFound = [];
  const SAVE_INTERVAL = 25;

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const name = item.name;
    
    process.stdout.write(`  [${i + 1}/${data.length}] ${name.substring(0, 45).padEnd(45)}...`);
    
    const result = await checkReservable(name);
    
    if (!result.found) {
      console.log(` ❌ Not found`);
      notFound.push({ ...item, check: result });
    } else if (result.reservable) {
      console.log(` ✅ RESERVABLE (⭐${result.rating} | ${result.reviews} reviews)`);
      verified.push({ 
        ...item, 
        place_id: result.placeId,
        google_name: result.name,
        lat: result.lat,
        lng: result.lng,
        website: result.website,
        google_rating: result.rating,
        google_reviews: result.reviews,
        google_maps_url: result.google_maps_url,
        address: result.address
      });
    } else {
      console.log(` ⛔ Not reservable`);
      notReservable.push({ ...item, check: result });
    }

    if ((i + 1) % SAVE_INTERVAL === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(verified, null, 2));
    }

    await sleep(200); // 5 requests/sec to stay under rate limit
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(verified, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Reservable:     ${verified.length}`);
  console.log(`   ⛔ Not reservable: ${notReservable.length}`);
  console.log(`   ❌ Not found:      ${notFound.length}`);
  console.log(`\n💾 Saved ${verified.length} verified restaurants to ${OUTPUT_FILE}`);
  console.log(`✅ Done!\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
