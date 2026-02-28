/**
 * generate-rid-script-v2.js
 * 
 * Run in terminal: node generate-rid-script-v2.js
 * Creates chrome-rid-extractor.js to paste in Chrome console
 */

const fs = require('fs');

const otList = JSON.parse(fs.readFileSync('ot_full.json', 'utf8'));

// Get unique slugs
const seen = new Set();
const slugs = [];
for (const r of otList) {
  const slug = r.url.replace(/\?.*$/, '').replace(/\/$/, '').split('/').pop();
  if (slug && !seen.has(slug)) {
    seen.add(slug);
    slugs.push(slug);
  }
}

// Load existing RID cache
let existing = {};
try {
  existing = JSON.parse(fs.readFileSync('ot_rid_cache.json', 'utf8'));
  console.log(`Existing cached RIDs: ${Object.keys(existing).length}`);
} catch(e) {}

const toCheck = slugs.filter(s => !existing[s]);
console.log(`Total unique: ${slugs.length}`);
console.log(`To check: ${toCheck.length}`);

const script = `
(async function() {
  const slugs = ${JSON.stringify(toCheck)};
  const results = {};
  const failed = [];
  let done = 0;

  console.log('🍽️  Starting RID extraction for ' + slugs.length + ' restaurants...');
  console.log('Trying multiple URL formats per restaurant...');

  for (const slug of slugs) {
    done++;
    
    // Try multiple URL formats
    const urls = [
      '/' + slug,
      '/r/' + slug,
      '/r/' + slug + '-new-york',
      '/r/' + slug + '-brooklyn',
    ];
    
    let found = false;
    for (const url of urls) {
      if (found) break;
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const html = await resp.text();
        const matches = html.match(/"restaurantId":(\\d+)/g);
        if (matches) {
          for (const m of matches) {
            const rid = parseInt(m.split(':')[1]);
            if (rid > 0) { results[slug] = rid; found = true; break; }
          }
        }
      } catch(e) {}
    }
    
    if (!found) failed.push(slug);

    if (done % 25 === 0) {
      console.log('  [' + done + '/' + slugs.length + '] Found: ' + Object.keys(results).length + ' | Failed: ' + failed.length);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\\n════════════════════════════════════');
  console.log('✅ Done! Found ' + Object.keys(results).length + ' RIDs out of ' + slugs.length);
  console.log('❌ Failed: ' + failed.length);
  window._otRids = results;
  window._otFailed = failed;
  console.log('\\nTo copy: copy(JSON.stringify(window._otRids))');
  console.log('Then paste into ot_rid_cache.json');
})();
`;

fs.writeFileSync('chrome-rid-extractor.js', script);
console.log(`\n✅ Created chrome-rid-extractor.js`);
console.log(`Estimated time: ~${Math.round(toCheck.length * 2 / 60)} minutes`);
console.log(`\nSteps:`);
console.log(`  cat chrome-rid-extractor.js | pbcopy`);
console.log(`  Paste in Chrome console on opentable.com`);
