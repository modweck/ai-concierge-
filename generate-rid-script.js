/**
 * generate-rid-script.js
 * 
 * Run this in terminal: node generate-rid-script.js
 * It reads ot_full.json and creates a chrome-rid-extractor.js file
 * Then paste the contents of chrome-rid-extractor.js into Chrome console
 * on any opentable.com page
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

console.log(`Total restaurants: ${otList.length}`);
console.log(`Unique slugs: ${slugs.length}`);

// Load existing RID cache if available
let existing = {};
try {
  existing = JSON.parse(fs.readFileSync('ot_rid_cache.json', 'utf8'));
  console.log(`Existing cached RIDs: ${Object.keys(existing).length}`);
} catch(e) {}

// Filter out already-cached slugs
const toCheck = slugs.filter(s => !existing[s]);
console.log(`Slugs to check: ${toCheck.length}`);

// Build chrome script
const script = `
// ═══════════════════════════════════════════════════
// OT RID EXTRACTOR — Paste in Chrome console on opentable.com
// Extracts restaurant IDs for ${toCheck.length} restaurants
// Estimated time: ~${Math.round(toCheck.length * 1.2 / 60)} minutes
// ═══════════════════════════════════════════════════

(async function() {
  const slugs = ${JSON.stringify(toCheck)};
  
  const results = {};
  const failed = [];
  let done = 0;
  
  console.log('🍽️  Starting RID extraction for ' + slugs.length + ' restaurants...');
  
  for (const slug of slugs) {
    done++;
    try {
      const resp = await fetch('/' + slug);
      if (!resp.ok) { failed.push(slug); continue; }
      const html = await resp.text();
      const matches = html.match(/"restaurantId":(\\d+)/g);
      if (matches) {
        // Get the non-zero RID
        for (const m of matches) {
          const rid = parseInt(m.split(':')[1]);
          if (rid > 0) {
            results[slug] = rid;
            break;
          }
        }
      }
      if (!results[slug]) failed.push(slug);
    } catch(e) {
      failed.push(slug);
    }
    
    if (done % 25 === 0) {
      console.log('  Progress: ' + done + '/' + slugs.length + ' | Found: ' + Object.keys(results).length + ' | Failed: ' + failed.length);
    }
    
    // Rate limit: 800ms between requests
    await new Promise(r => setTimeout(r, 800));
  }
  
  console.log('\\n════════════════════════════════════');
  console.log('✅ Done! Found ' + Object.keys(results).length + ' RIDs');
  console.log('❌ Failed: ' + failed.length);
  console.log('\\nCopy the result below and save as ot_rid_cache.json:');
  console.log('\\n' + JSON.stringify(results));
  
  // Also store in window for easy access
  window._otRids = results;
  window._otFailed = failed;
  console.log('\\nAlso stored in window._otRids — copy with: copy(JSON.stringify(window._otRids))');
})();
`;

fs.writeFileSync('chrome-rid-extractor.js', script);
console.log(`\n✅ Created chrome-rid-extractor.js`);
console.log(`\nNext steps:`);
console.log(`1. Open chrome-rid-extractor.js in a text editor`);
console.log(`2. Select all, copy`);
console.log(`3. Go to Chrome on any opentable.com page`);
console.log(`4. Open console (F12 → Console)`);
console.log(`5. Paste and press Enter`);
console.log(`6. Wait ~${Math.round(toCheck.length * 1.2 / 60)} minutes`);
console.log(`7. When done, type: copy(JSON.stringify(window._otRids))`);
console.log(`8. Paste into a new file called ot_rid_cache.json`);
