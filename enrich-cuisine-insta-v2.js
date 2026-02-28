/**
 * enrich-cuisine-insta-v2.js
 * ==========================
 * Uses Google Places API (New) to get cuisine types and Instagram
 * 
 * RUN:   node enrich-cuisine-insta-v2.js
 * FLAGS: --quick    First 50 only
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const BOOKING_FILE = path.join(__dirname, 'booking_enrichme.json');
const CUISINE_FILE = path.join(__dirname, 'cuisine_lookup.json');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════
// Google primaryType → cuisine mapping
// ═══════════════════════════════════════════════════════════════════
const TYPE_TO_CUISINE = {
  'american_restaurant': 'American',
  'barbecue_restaurant': 'Barbecue',
  'brazilian_restaurant': 'Brazilian',
  'breakfast_restaurant': 'American',
  'brunch_restaurant': 'American',
  'chinese_restaurant': 'Chinese',
  'fast_food_restaurant': null,
  'french_restaurant': 'French',
  'greek_restaurant': 'Greek',
  'hamburger_restaurant': 'American',
  'indian_restaurant': 'Indian',
  'indonesian_restaurant': 'Indonesian',
  'italian_restaurant': 'Italian',
  'japanese_restaurant': 'Japanese',
  'korean_restaurant': 'Korean',
  'lebanese_restaurant': 'Lebanese',
  'meal_delivery': null,
  'meal_takeaway': null,
  'mediterranean_restaurant': 'Mediterranean',
  'mexican_restaurant': 'Mexican',
  'middle_eastern_restaurant': 'Middle Eastern',
  'pizza_restaurant': 'Italian/Pizza',
  'ramen_restaurant': 'Japanese/Ramen',
  'restaurant': null, // too generic
  'sandwich_shop': null,
  'seafood_restaurant': 'Seafood',
  'spanish_restaurant': 'Spanish',
  'steak_house': 'Steakhouse',
  'sushi_restaurant': 'Japanese/Sushi',
  'thai_restaurant': 'Thai',
  'turkish_restaurant': 'Turkish',
  'vegan_restaurant': 'Vegan',
  'vegetarian_restaurant': 'Vegetarian',
  'vietnamese_restaurant': 'Vietnamese',
};

// Secondary type fallbacks (check all types if primaryType is generic)
const SECONDARY_MAP = {
  'african_restaurant': 'African',
  'bar_and_grill': 'American',
  'caribbean_restaurant': 'Caribbean',
  'ethiopian_restaurant': 'Ethiopian',
  'filipino_restaurant': 'Filipino',
  'georgian_restaurant': 'Georgian',
  'persian_restaurant': 'Persian',
  'peruvian_restaurant': 'Peruvian',
  'taiwanese_restaurant': 'Taiwanese',
};

function mapCuisine(primaryType, allTypes) {
  // Try primaryType first
  if (primaryType && TYPE_TO_CUISINE[primaryType]) {
    return TYPE_TO_CUISINE[primaryType];
  }
  
  // Search all types for specific cuisine
  if (allTypes) {
    for (const t of allTypes) {
      if (TYPE_TO_CUISINE[t]) return TYPE_TO_CUISINE[t];
      if (SECONDARY_MAP[t]) return SECONDARY_MAP[t];
    }
  }
  
  return null;
}

function extractInstagram(website) {
  if (!website) return null;
  if (website.toLowerCase().includes('instagram.com')) {
    const match = website.match(/instagram\.com\/([^/?#]+)/i);
    if (match && !['explore','p','reel','stories','accounts'].includes(match[1].toLowerCase())) {
      return match[1].replace(/\/$/, '');
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// New Places API (v1) lookup
// ═══════════════════════════════════════════════════════════════════
async function getPlaceDetailsNew(placeId) {
  try {
    const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}?fields=primaryType,types,websiteUri,primaryTypeDisplayName`, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'primaryType,types,websiteUri,primaryTypeDisplayName'
      }
    });
    const data = await resp.json();
    if (data.error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Find place_id if missing
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
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  let booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
  let cuisineLookup = {};
  try { cuisineLookup = JSON.parse(fs.readFileSync(CUISINE_FILE, 'utf8')); } catch(e) {}

  const cuisineLower = {};
  for (const [k, v] of Object.entries(cuisineLookup)) {
    cuisineLower[k.toLowerCase().trim()] = true;
  }

  const keys = Object.keys(booking);

  // Only process entries missing cuisine OR instagram
  let toProcess = keys.filter(k => {
    const needsCuisine = !cuisineLower[k.toLowerCase().trim()];
    const needsInsta = !booking[k].instagram;
    return needsCuisine || needsInsta;
  });

  if (QUICK) toProcess = toProcess.slice(0, 50);

  console.log(`\n🍽️  CUISINE + INSTAGRAM ENRICHMENT (New Places API)`);
  console.log(`📊 Total: ${keys.length} | To process: ${toProcess.length}`);
  console.log(`📋 Existing cuisines: ${Object.keys(cuisineLookup).length}`);
  console.log(`📸 Existing instagrams: ${keys.filter(k => booking[k].instagram).length}`);
  console.log(`⏱️  Estimated: ~${Math.round(toProcess.length * 0.2 / 60)} minutes`);
  console.log(`💰 API calls: ~${toProcess.length}\n`);

  let cuisineAdded = 0, instaAdded = 0, failed = 0, apiCalls = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const key = toProcess[i];
    const entry = booking[key];

    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${key.substring(0, 42).padEnd(42)} `);

    // Get place_id
    let placeId = entry.place_id;
    if (!placeId) {
      placeId = await findPlaceId(key);
      apiCalls++;
      if (placeId) {
        booking[key].place_id = placeId;
      } else {
        failed++;
        console.log(`❌ not found`);
        await sleep(80);
        continue;
      }
    }

    // Get details from new API
    const details = await getPlaceDetailsNew(placeId);
    apiCalls++;

    if (!details) {
      failed++;
      console.log(`❌ no details`);
      await sleep(80);
      continue;
    }

    // Map cuisine
    let cuisineStr = '-';
    const cuisine = mapCuisine(details.primaryType, details.types);
    if (cuisine && !cuisineLower[key.toLowerCase().trim()]) {
      cuisineLookup[key] = cuisine;
      cuisineLower[key.toLowerCase().trim()] = true;
      cuisineAdded++;
      cuisineStr = cuisine;
    } else if (cuisineLower[key.toLowerCase().trim()]) {
      cuisineStr = '(exists)';
    }

    // Extract Instagram
    let instaStr = '-';
    const insta = extractInstagram(details.websiteUri);
    if (insta && !booking[key].instagram) {
      booking[key].instagram = insta;
      instaAdded++;
      instaStr = '@' + insta;
    } else if (!booking[key].instagram && details.websiteUri) {
      // Save website anyway
      booking[key].website = details.websiteUri;
    }

    console.log(`${cuisineStr.substring(0, 22).padEnd(22)} ${instaStr}`);

    // Save every 200
    if ((i + 1) % 200 === 0) {
      fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
      fs.writeFileSync(CUISINE_FILE, JSON.stringify(cuisineLookup, null, 2));
      console.log(`  💾 Saved (${cuisineAdded} cuisines, ${instaAdded} instagrams, ${failed} failed)`);
    }

    await sleep(80);
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
  console.log(`   📸 Total instagrams:   ${Object.values(booking).filter(v => v.instagram).length}`);
  console.log(`\nTo deploy:`);
  console.log(`  cp booking_enrichme.json netlify/functions/booking_lookup.json`);
  console.log(`  cp cuisine_lookup.json netlify/functions/cuisine_lookup.json`);
  console.log(`  git add -A && git commit -m "cuisine + instagram enrichment" && git push`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
