#!/usr/bin/env node
/**
 * ADD YELP DISCOVERIES + BOOKING LINKS
 * ======================================
 * Adds 31 verified restaurants from Yelp to:
 *   1. popular_nyc.json (restaurant database)
 *   2. booking_lookup.json (Resy/OT links)
 *
 * These were found via Yelp, then verified on Resy/OpenTable.
 * 3 wrong-location matches excluded (Din Tai Fung→WA, Thailicious→TX, Atithi→London)
 *
 * RUN: cd ~/ai-concierge- && node add-yelp-verified.js
 * Add --save to write changes (dry run by default)
 */

const fs = require('fs');
const path = require('path');

const SAVE = process.argv.includes('--save');
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');
const YELP_FILE = path.join(__dirname, 'yelp-discoveries.json');

const popular = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
const booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
const yelp = JSON.parse(fs.readFileSync(YELP_FILE, 'utf8'));

const existingNames = new Set(popular.map(r => (r.name || '').toLowerCase().trim()));
const bookingKeys = new Set(Object.keys(booking).map(k => k.toLowerCase().trim()));

// 31 verified matches (excludes wrong-location: Din Tai Fung, Thailicious, Atithi)
const VERIFIED = [
  { name: "LoveMama", platform: "opentable", url: "https://www.opentable.com/r/lovemama-new-york" },
  { name: "Club A Steakhouse", platform: "opentable", url: "https://www.opentable.com/club-a-steakhouse" },
  { name: "Da Andrea - Greenwich Village", platform: "opentable", url: "https://www.opentable.com/r/da-andrea-greenwich-village-new-york" },
  { name: "Thursday Kitchen", platform: "opentable", url: "https://www.opentable.com/r/thursday-kitchen-new-york" },
  { name: "Uluh", platform: "opentable", url: "https://www.opentable.com/r/uluh-new-york" },
  { name: "Tia Pol", platform: "resy", url: "https://resy.com/cities/ny/tia-pol" },
  { name: "Da Andrea - Chelsea", platform: "opentable", url: "https://www.opentable.com/r/da-andrea-chelsea-new-york" },
  { name: "Mughlai Grill", platform: "opentable", url: "https://www.opentable.com/r/mughlai-grill-new-york" },
  { name: "GunBae Tribeca", platform: "opentable", url: "https://www.opentable.com/r/gunbae" },
  { name: "Alvin & Friends", platform: "opentable", url: "https://www.opentable.com/r/alvin-and-friends" },
  { name: "Athena Mediterranean Cuisine", platform: "opentable", url: "https://www.opentable.com/r/athena-mediterranean-cuisine" },
  { name: "Osteria 57", platform: "resy", url: "https://resy.com/cities/ny/osteria-57" },
  { name: "Sathi", platform: "opentable", url: "https://www.opentable.com/r/sathi-new-york" },
  { name: "Hui Restaurant & Bar", platform: "opentable", url: "https://www.opentable.com/r/hui-restaurant-and-bar-new-york" },
  { name: "Yara", platform: "opentable", url: "https://www.opentable.com/r/yara-new-york" },
  { name: "Osteria Delbianco", platform: "opentable", url: "https://www.opentable.com/r/osteria-delbianco-new-york" },
  { name: "Jose Luis Mediterranean Cuisine", platform: "opentable", url: "https://www.opentable.com/r/jose-luis-mediterranean-cuisine-new-york" },
  { name: "Heno Heno", platform: "opentable", url: "https://www.opentable.com/r/heno-heno-new-york" },
  { name: "Cka Ka Qellu - Bronx", platform: "opentable", url: "https://www.opentable.com/r/cka-ka-qellu-bronx" },
  { name: "Kalye", platform: "opentable", url: "https://www.opentable.com/r/kalye-at-rivington-new-york" },
  { name: "Otani", platform: "opentable", url: "https://www.opentable.com/r/otani-new-york" },
  { name: "The Shell Restaurant", platform: "opentable", url: "https://www.opentable.com/r/the-shell-new-york" },
  { name: "Yezo Thai Isankaya", platform: "opentable", url: "https://www.opentable.com/r/yezo-thai-isankaya-new-york" },
  { name: "Harlemite Peruvian Cuisine", platform: "opentable", url: "https://www.opentable.com/r/harlemite-new-york" },
  { name: "Elis Wine Bar & Restaurant", platform: "opentable", url: "https://www.opentable.com/r/elis-wine-bar-and-restaurant-new-york" },
  { name: "Debajo", platform: "resy", url: "https://resy.com/cities/ny/debajo" },
  { name: "Chomp Chomp Thai kitchen", platform: "opentable", url: "https://www.opentable.com/r/chomp-chomp-thai-kitchen-new-york" },
  { name: "White Olive", platform: "resy", url: "https://resy.com/cities/ny/white-olive" },
  { name: "Catch n' Chop", platform: "opentable", url: "https://www.opentable.com/r/catch-n-chop-new-york" },
  { name: "Bar Mexicana", platform: "resy", url: "https://resy.com/cities/ny/bar-mexicana" },
  { name: "345 Cantina", platform: "opentable", url: "https://www.opentable.com/r/345-cantina-new-york" },
];

// Build yelp data lookup
const yelpMap = new Map();
for (const r of yelp) {
  yelpMap.set(r.name.toLowerCase().trim(), r);
}

console.log(`\n📥 ADD YELP VERIFIED RESTAURANTS`);
console.log(`${'='.repeat(50)}`);

let addedPopular = 0;
let addedBooking = 0;
let skippedDupe = 0;

for (const v of VERIFIED) {
  const key = v.name.toLowerCase().trim();
  const yelpData = yelpMap.get(key);

  // Add to popular_nyc.json if not already there
  if (!existingNames.has(key)) {
    const entry = {
      name: v.name,
      address: yelpData?.address || '',
      lat: yelpData?.lat || null,
      lng: yelpData?.lng || null,
      googleRating: yelpData?.yelpRating || null,  // placeholder until Google lookup
      googleReviewCount: yelpData?.yelpReviewCount || 0,
      cuisine: yelpData?.categories || '',
      source: 'yelp_discovery',
      yelpRating: yelpData?.yelpRating,
      yelpReviewCount: yelpData?.yelpReviewCount,
      booking_platform: v.platform,
      booking_url: v.url,
    };
    popular.push(entry);
    existingNames.add(key);
    addedPopular++;
    console.log(`  ✅ ${v.name} → popular_nyc.json`);
  } else {
    console.log(`  ⚠️  ${v.name} — already in popular_nyc.json`);
    skippedDupe++;
  }

  // Add to booking_lookup.json
  if (!bookingKeys.has(key)) {
    booking[key] = { platform: v.platform, url: v.url };
    bookingKeys.add(key);
    addedBooking++;
    console.log(`  🔗 ${v.name} → booking_lookup.json (${v.platform})`);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Results:`);
console.log(`  Added to popular_nyc: ${addedPopular}`);
console.log(`  Added to booking_lookup: ${addedBooking}`);
console.log(`  Skipped (dupes): ${skippedDupe}`);
console.log(`  Total restaurants: ${popular.length}`);
console.log(`  Total booking entries: ${Object.keys(booking).length}`);

if (SAVE) {
  fs.writeFileSync(POPULAR_FILE, JSON.stringify(popular, null, 2));
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
  console.log(`\n💾 SAVED both files`);
  console.log(`📋 Next: git add -A && git commit -m "Add 31 Yelp discoveries with booking links" && git push`);
} else {
  console.log(`\n⚠️  DRY RUN — run with --save to apply`);
}
