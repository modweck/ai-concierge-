const fs = require('fs');

const INPUT = 'resy_check_list.json';
const OUTPUT = 'resy_matches.json';
const DELAY_MS = 400; // delay between requests to avoid rate limiting
const BATCH_SIZE = 5;

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return require('node-fetch')(...args);
};

async function checkResySlug(slug) {
  const url = `https://resy.com/cities/ny/${slug}`;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    // 200 = exists, 404 = doesn't exist, 301/302 = redirected (might exist)
    if (res.status === 200) return { found: true, url, status: 200 };
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') || '';
      // If redirected to another restaurant page, it's a match
      if (location.includes('resy.com/cities/')) return { found: true, url: location, status: res.status };
      return { found: false, status: res.status, redirect: location };
    }
    return { found: false, status: res.status };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

async function main() {
  const list = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const results = { found: [], not_found: [] };
  
  console.log(`\n🔍 RESY BOOKING CHECKER`);
  console.log(`📊 Checking ${list.length} restaurants\n`);

  let foundCount = 0;
  let missCount = 0;

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (entry, batchIdx) => {
      const idx = i + batchIdx;
      const result = await checkResySlug(entry.slug);
      
      if (result.found) {
        foundCount++;
        const finalUrl = result.url || entry.resy_url;
        console.log(`  [${idx + 1}/${list.length}] ${entry.name.padEnd(50)} ✅ ${finalUrl}`);
        results.found.push({
          name: entry.name,
          slug: entry.slug,
          resy_url: finalUrl,
          status: result.status
        });
      } else {
        missCount++;
        if ((idx + 1) % 50 === 0) {
          console.log(`  [${idx + 1}/${list.length}] ... ${missCount} misses so far`);
        }
      }
    });

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Save results
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Found on Resy: ${foundCount}`);
  console.log(`   ❌ Not on Resy: ${missCount}`);
  console.log(`   💾 Saved to ${OUTPUT}`);
  console.log(`${'═'.repeat(50)}`);
}

main().catch(console.error);
