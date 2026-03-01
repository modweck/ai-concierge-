const fs = require('fs');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const INPUT = 'enrich_list.json';
const OUTPUT = 'enriched_results.json';
const PROGRESS_FILE = 'enrich_progress.json';
const BATCH_SIZE = 10; // concurrent requests
const DELAY_MS = 2000; // between batches

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return require('node-fetch')(...args);
};

async function findPlace(name) {
  const query = `${name} restaurant New York City`;
  const url = `https://places.googleapis.com/v1/places:searchText`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.websiteUri,places.priceLevel'
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 1,
        locationBias: {
          circle: {
            center: { latitude: 40.7128, longitude: -74.0060 },
            radius: 50000
          }
        }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
    }

    const data = await res.json();
    if (!data.places || data.places.length === 0) return { error: 'no_results' };

    const p = data.places[0];
    return {
      place_id: p.id || null,
      name_matched: p.displayName?.text || null,
      address: p.formattedAddress || null,
      lat: p.location?.latitude || null,
      lng: p.location?.longitude || null,
      google_rating: p.rating || null,
      google_reviews: p.userRatingCount || null,
      website: p.websiteUri || null,
      price_level: p.priceLevel || null
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  const list = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  
  // Load progress if exists
  let results = {};
  let startIdx = 0;
  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    results = progress.results || {};
    startIdx = progress.lastIndex || 0;
    console.log(`\u2705 Resuming from index ${startIdx} (${Object.keys(results).length} already done)`);
  }

  console.log(`\n\ud83c\udf7d\ufe0f  ENRICHMENT RUN`);
  console.log(`\ud83d\udcca Total: ${list.length} | Starting from: ${startIdx}`);
  console.log(`\u23f1\ufe0f  Estimated: ~${Math.ceil((list.length - startIdx) / BATCH_SIZE * DELAY_MS / 60000)} minutes\n`);

  let success = 0, failed = 0, apiCalls = 0;

  for (let i = startIdx; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (entry, batchIdx) => {
      const idx = i + batchIdx;
      const name = entry.name;
      
      // Skip if already done
      if (results[name]) return;
      
      apiCalls++;
      const result = await findPlace(name);
      
      if (result.error) {
        console.log(`  [${idx + 1}/${list.length}] ${name.padEnd(45)} \u274c ${result.error}`);
        results[name] = { ...entry, google_error: result.error };
        failed++;
      } else {
        const stars = result.google_rating ? `${result.google_rating}\u2b50` : 'no rating';
        const revs = result.google_reviews || 0;
        console.log(`  [${idx + 1}/${list.length}] ${name.padEnd(45)} \u2705 ${stars} (${revs} reviews)`);
        results[name] = { ...entry, ...result };
        success++;
      }
    });

    await Promise.all(promises);
    
    // Save progress every 50 restaurants
    if ((i % 50) < BATCH_SIZE) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastIndex: i + BATCH_SIZE, results }, null, 2));
    }
    
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Final save
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastIndex: list.length, results }, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`\ud83d\udcca RESULTS:`);
  console.log(`   \u2705 Success: ${success}`);
  console.log(`   \u274c Failed: ${failed}`);
  console.log(`   \ud83d\udd11 API calls: ${apiCalls}`);
  console.log(`   \ud83d\udcbe Saved to ${OUTPUT}`);
  console.log(`${'═'.repeat(50)}`);
}

main().catch(console.error);
