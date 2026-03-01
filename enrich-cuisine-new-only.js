const fs = require('fs');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const NEW_NAMES = 'new_cuisine_list.json';
const CUISINE_FILE = 'cuisine_lookup.json';
const DELAY_MS = 1500;
const BATCH_SIZE = 3;

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return require('node-fetch')(...args);
};

const TYPE_TO_CUISINE = {
  'american_restaurant': 'American',
  'barbecue_restaurant': 'Barbecue',
  'brazilian_restaurant': 'Brazilian',
  'chinese_restaurant': 'Chinese',
  'french_restaurant': 'French',
  'greek_restaurant': 'Greek',
  'indian_restaurant': 'Indian',
  'indonesian_restaurant': 'Indonesian',
  'italian_restaurant': 'Italian',
  'japanese_restaurant': 'Japanese',
  'korean_restaurant': 'Korean',
  'lebanese_restaurant': 'Lebanese',
  'mediterranean_restaurant': 'Mediterranean',
  'mexican_restaurant': 'Mexican',
  'middle_eastern_restaurant': 'Middle Eastern',
  'moroccan_restaurant': 'Moroccan',
  'pizza_restaurant': 'Pizza',
  'ramen_restaurant': 'Ramen',
  'seafood_restaurant': 'Seafood',
  'spanish_restaurant': 'Spanish',
  'steak_house': 'Steakhouse',
  'sushi_restaurant': 'Sushi',
  'thai_restaurant': 'Thai',
  'turkish_restaurant': 'Turkish',
  'vegan_restaurant': 'Vegan',
  'vegetarian_restaurant': 'Vegetarian',
  'vietnamese_restaurant': 'Vietnamese',
  'brunch_restaurant': 'Brunch',
  'hamburger_restaurant': 'American',
  'persian_restaurant': 'Persian',
  'african_restaurant': 'African',
  'caribbean_restaurant': 'Caribbean',
  'ethiopian_restaurant': 'Ethiopian',
};

async function getCuisine(name) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.types,places.displayName,places.primaryType,places.primaryTypeDisplayName'
      },
      body: JSON.stringify({
        textQuery: `${name} restaurant New York City`,
        maxResultCount: 1,
        locationBias: {
          circle: {
            center: { latitude: 40.7128, longitude: -74.0060 },
            radius: 50000
          }
        }
      })
    });
    if (!res.ok) return { cuisine: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data.places || data.places.length === 0) return { cuisine: null, error: 'no_results' };

    const place = data.places[0];
    const types = place.types || [];
    const primaryType = place.primaryType || '';
    
    if (TYPE_TO_CUISINE[primaryType]) return { cuisine: TYPE_TO_CUISINE[primaryType] };
    for (const type of types) {
      if (TYPE_TO_CUISINE[type]) return { cuisine: TYPE_TO_CUISINE[type] };
    }
    const displayName = place.primaryTypeDisplayName?.text || '';
    if (displayName && displayName !== 'Restaurant') return { cuisine: displayName };
    return { cuisine: null, types, primaryType };
  } catch (err) {
    return { cuisine: null, error: err.message };
  }
}

async function main() {
  const newNames = JSON.parse(fs.readFileSync(NEW_NAMES, 'utf8'));
  const cuisineLookup = fs.existsSync(CUISINE_FILE) 
    ? JSON.parse(fs.readFileSync(CUISINE_FILE, 'utf8')) 
    : {};
  
  const toProcess = newNames.filter(name => !cuisineLookup[name]);
  
  console.log(`\n🍽️  CUISINE ENRICHMENT (New Places API)`);
  console.log(`📊 Total new: ${newNames.length} | Already have: ${newNames.length - toProcess.length} | To process: ${toProcess.length}\n`);

  let added = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (name, batchIdx) => {
      const idx = i + batchIdx;
      const result = await getCuisine(name);
      if (result.cuisine) {
        cuisineLookup[name] = result.cuisine;
        console.log(`  [${idx + 1}/${toProcess.length}] ${name.padEnd(45)} ${result.cuisine}`);
        added++;
      } else {
        console.log(`  [${idx + 1}/${toProcess.length}] ${name.padEnd(45)} -`);
        failed++;
      }
    });
    await Promise.all(promises);
    if ((i % 50) < BATCH_SIZE) {
      fs.writeFileSync(CUISINE_FILE, JSON.stringify(cuisineLookup, null, 2));
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  fs.writeFileSync(CUISINE_FILE, JSON.stringify(cuisineLookup, null, 2));
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   🍽️  Cuisines added: ${added}`);
  console.log(`   ❌ No cuisine found: ${failed}`);
  console.log(`   📋 Total cuisines now: ${Object.keys(cuisineLookup).length}`);
  console.log(`${'═'.repeat(50)}`);
}

main().catch(console.error);
