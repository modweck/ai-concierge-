/**
 * enrich-cuisine-insta.js
 * =======================
 * Adds cuisine type and Instagram to booking_lookup using Google Place Details API.
 * For restaurants without place_id, does a Find Place first.
 * 
 * RUN:   node enrich-cuisine-insta.js
 * FLAGS: --quick    First 50 only
 *        --resume   Skip already done
 * 
 * Outputs:
 *   - Updates booking_enrichme.json with instagram field
 *   - Creates/updates cuisine_lookup.json with cuisine mappings
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const BOOKING_FILE = path.join(__dirname, 'booking_enrichme.json');
const CUISINE_FILE = path.join(__dirname, 'cuisine_lookup.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const RESUME = args.includes('--resume');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════
// Google type → cuisine mapping
// ═══════════════════════════════════════════════════════════════════
const TYPE_TO_CUISINE = {
  'american_restaurant': 'American',
  'barbecue_restaurant': 'Barbecue',
  'brazilian_restaurant': 'Brazilian',
  'chinese_restaurant': 'Chinese',
  'french_restaurant': 'French',
  'greek_restaurant': 'Greek',
  'hamburger_restaurant': 'American',
  'indian_restaurant': 'Indian',
  'indonesian_restaurant': 'Indonesian',
  'italian_restaurant': 'Italian',
  'japanese_restaurant': 'Japanese',
  'korean_restaurant': 'Korean',
  'lebanese_restaurant': 'Lebanese',
  'mediterranean_restaurant': 'Mediterranean',
  'mexican_restaurant': 'Mexican',
  'middle_eastern_restaurant': 'Middle Eastern',
  'pizza_restaurant': 'Italian/Pizza',
  'ramen_restaurant': 'Japanese/Ramen',
  'seafood_restaurant': 'Seafood',
  'spanish_restaurant': 'Spanish',
  'steak_house': 'Steakhouse',
  'sushi_restaurant': 'Japanese/Sushi',
  'thai_restaurant': 'Thai',
  'turkish_restaurant': 'Turkish',
  'vegan_restaurant': 'Vegan',
  'vegetarian_restaurant': 'Vegetarian',
  'vietnamese_restaurant': 'Vietnamese',
  'african_restaurant': 'African',
  'caribbean_restaurant': 'Caribbean',
  'peruvian_restaurant': 'Peruvian',
  'filipino_restaurant': 'Filipino',
  'ethiopian_restaurant': 'Ethiopian',
};

// Secondary types (less specific)
const SECONDARY_TYPES = {
  'bar_and_grill': 'American',
  'brunch_restaurant': 'American',
  'fast_food_restaurant': null, // skip
  'meal_delivery': null,
  'meal_takeaway': null,
};

function mapGoogleTypes(types) {
  if (!types || !types.length) return null;
  
  // Try primary cuisine types first
  for (const t of types) {
    if (TYPE_TO_CUISINE[t]) return TYPE_TO_CUISINE[t];
  }
  
  // Try secondary
  for (const t of types) {
    if (SECONDARY_TYPES[t] !== undefined) return SECONDARY_TYPES[t];
  }
  
  return null;
}

function extractInstagram(website) {
  if (!website) return null;
  const lower = website.toLowerCase();
  
  // Direct Instagram URL
  if (lower.includes('instagram.com')) {
    const match = website.match(/instagram\.com\/([^/?#]+)/i);
    if (match && match[1] !== 'explore' && match[1] !== 'p' && match[1] !== 'reel') {
      return match[1].replace(/\/$/, '');
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Get Place ID if missing
// ═══════════════════════════════════════════════════════════════════
async function findPlaceId(name) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' restaurant NYC')}&inputtype=textquery&fields=place_id&key=${API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    return data.candidates?.[0]?.place_id || null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Get Place Details (cuisine types + website)
// ═══════════════════════════════════════════════════════════════════
async function getPlaceDetails(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=types,website,url&key=${API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    
    if (!data.result) return null;
    
    return {
      types: data.result.types || [],
      website: data.result.website || null,
      maps_url: data.result.url || null
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  let booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  
  // Load existing cuisine lookup
  let cuisineLookup = {};
  try { cuisineLookup = JSON.parse(fs.readFileSync(CUISINE_FILE, 'utf8')); }
  catch (e) { console.log('ℹ️  No existing cuisine_lookup, creating new'); }

  const keys = Object.keys(booking);
  
  // Determine what needs processing
  let toProcess = keys.filter(k => {
    const cuisineKey = k; // lowercase already in booking
    const hasCuisine = cuisineLookup[k] || cuisineLookup[k.charAt(0).toUpperCase() + k.slice(1)];
    const hasInsta = booking[k].instagram;
    if (RESUME && hasCuisine && hasInsta) return false;
    if (hasCuisine && hasInsta) return false; // skip if both exist
    return true;
  });

  if (QUICK) toProcess = toProcess.slice(0, 50);

  console.log(`\n🍽️  CUISINE + INSTAGRAM ENRICHMENT`);
  console.log(`📊 Total: ${keys.length} | To process: ${toProcess.length}`);
  console.log(`📋 Existing cuisines: ${Object.keys(cuisineLookup).length}`);
  console.log(`📸 Existing instagrams: ${keys.filter(k => booking[k].instagram).length}`);
  console.log(`⏱️  Estimated: ~${Math.round(toProcess.length * 0.25 / 60)} minutes`);
  console.log(`💰 API calls: ~${toProcess.length * 1.5} (some need Find Place + Details)\n`);

  let cuisineAdded = 0, instaAdded = 0, failed = 0, apiCalls = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const key = toProcess[i];
    const entry = booking[key];
    
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${key.substring(0, 42).padEnd(42)} `);

    // Step 1: Get place_id if missing
    let placeId = entry.place_id;
    if (!placeId) {
      placeId = await findPlaceId(key);
      apiCalls++;
      if (placeId) {
        booking[key].place_id = placeId;
      } else {
        failed++;
        console.log(`❌ not found`);
        await sleep(100);
        continue;
      }
    }

    // Step 2: Get Place Details
    const details = await getPlaceDetails(placeId);
    apiCalls++;
    
    if (!details) {
      failed++;
      console.log(`❌ no details`);
      await sleep(100);
      continue;
    }

    // Step 3: Map cuisine
    const cuisine = mapGoogleTypes(details.types);
    let cuisineStatus = '-';
    if (cuisine) {
      cuisineLookup[key] = cuisine;
      cuisineAdded++;
      cuisineStatus = cuisine;
    }

    // Step 4: Extract Instagram from website
    let instaStatus = '-';
    const insta = extractInstagram(details.website);
    if (insta) {
      booking[key].instagram = insta;
      instaAdded++;
      instaStatus = '@' + insta;
    } else if (details.website && !booking[key].website) {
      // Save website even if not Instagram
      booking[key].website = details.website;
    }

    console.log(`✅ ${cuisineStatus.substring(0, 20).padEnd(20)} ${instaStatus}`);

    // Save every 200
    if ((i + 1) % 200 === 0) {
      fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
      fs.writeFileSync(CUISINE_FILE, JSON.stringify(cuisineLookup, null, 2));
      console.log(`  💾 Saved (${cuisineAdded} cuisines, ${instaAdded} instagrams)`);
    }

    await sleep(100);
  }

  // Final save
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
  fs.writeFileSync(CUISINE_FILE, JSON.stringify(cuisineLookup, null, 2));

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   🍽️  Cuisines added:    ${cuisineAdded}`);
  console.log(`   📸 Instagrams added:   ${instaAdded}`);
  console.log(`   ❌ Failed:             ${failed}`);
  console.log(`   🔑 API calls made:     ${apiCalls}`);
  console.log(`   📋 Total cuisines now: ${Object.keys(cuisineLookup).length}`);
  console.log(`\nTo deploy:`);
  console.log(`  cp booking_enrichme.json netlify/functions/booking_lookup.json`);
  console.log(`  cp cuisine_lookup.json netlify/functions/cuisine_lookup.json`);
  console.log(`  git add -A && git commit -m "cuisine + instagram enrichment" && git push`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
