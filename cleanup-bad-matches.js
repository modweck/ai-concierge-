// Cleanup script for bad Resy matches in booking_lookup.json
// Run: node cleanup-bad-matches.js
// (run from your ai-concierge- directory)

const fs = require('fs');
const path = require('path');

const BF = path.join(__dirname, 'netlify/functions/booking_lookup.json');
const BL = JSON.parse(fs.readFileSync(BF, 'utf8'));

// Bad matches: [google name, wrong resy slug]
const BAD_MATCHES = [
  // Completely wrong restaurants
  ['smash house brooklyn', 'house-brooklyn'],           // Smash House ≠ HOUSE Brooklyn
  ['kyuramen - long island city', 'tacombi-lic'],       // Kyuramen ≠ Tacombi
  ['kyuramen - union square', 'canto-upper-west-side'], // Kyuramen ≠ Canto (this was #331)
  ['casa cipriani new york', 'casa-d-angelo-nyc'],      // Casa Cipriani ≠ Casa D'Angelo
  ['casa tua new york', 'casa-d-angelo-nyc'],           // Casa Tua ≠ Casa D'Angelo
  ['diva royale drag queen show nyc', 'queen'],         // Drag show ≠ Queen restaurant
  ['la donna re\'s', 'donna-ny'],                       // La Donna Re's ≠ Donna
  ['leo\'s restaurant & sports bar', 'leo-nyc'],        // Leo's Sports Bar ≠ Leo
  ['kuu', 'kuun'],                                      // Kuu ≠ KUUN (different restaurants)
  ['court street', 'court-street-restaurant-and-bar'],  // Generic "Court Street" - possibly wrong
  ['nsv kitchen by next stop vegan', 'next-stop-vegan'],// This one is actually correct! Same restaurant. KEEP.
  ['yuan', 'hwa-yuan-szechuan'],                        // Yuan ≠ Hwa Yuan Szechuan
];

// Remove NSV Kitchen from bad list - it IS Next Stop Vegan
const REMOVALS = BAD_MATCHES.filter(([name]) => 
  name !== 'nsv kitchen by next stop vegan'
);

let removed = 0;
const removedNames = [];

for (const [googleName, wrongSlug] of REMOVALS) {
  // Find the key (could be slightly different casing)
  const key = Object.keys(BL).find(k => {
    const kNorm = k.toLowerCase().trim();
    const gNorm = googleName.toLowerCase().trim();
    return kNorm === gNorm;
  });
  
  if (key && BL[key]?.url?.includes(wrongSlug)) {
    delete BL[key];
    removed++;
    removedNames.push(`  ❌ "${key}" → was linked to ${wrongSlug}`);
  } else if (key) {
    console.log(`  ⚠️  "${key}" exists but URL doesn't match slug "${wrongSlug}" — skipping`);
  } else {
    console.log(`  ⚠️  "${googleName}" not found in booking_lookup — already clean`);
  }
}

console.log(`\n🧹 CLEANUP RESULTS:`);
console.log(`   Removed: ${removed} bad matches\n`);
removedNames.forEach(r => console.log(r));

if (removed > 0) {
  fs.writeFileSync(BF, JSON.stringify(BL, null, 2));
  console.log(`\n💾 Saved! booking_lookup.json now has ${Object.keys(BL).length} entries`);
  console.log(`   (was 1846, removed ${removed} → ${Object.keys(BL).length})`);
} else {
  console.log('\n✅ No changes needed — already clean!');
}

console.log('\nDone!\n');
