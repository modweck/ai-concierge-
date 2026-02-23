#!/usr/bin/env node
/**
 * Run this from your ai-concierge- project folder:
 *   node run-calibration.js
 *
 * It loads your actual restaurant JSON files, runs the likelihood model
 * against all of them, and prints the calibration report so you can
 * see if the labels feel accurate and tune thresholds.
 */

const fs = require('fs');
const path = require('path');
const rl = require('./reservation-likelihood');

// ============================================================
// LOAD ALL YOUR RESTAURANT DATA
// ============================================================

const FUNCTIONS_DIR = path.join(__dirname, 'netlify', 'functions');

function loadJSON(filename) {
  const filepath = path.join(FUNCTIONS_DIR, filename);
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    console.log(`✅ Loaded ${filename}: ${data.length} entries`);
    return data;
  } catch (err) {
    console.warn(`⚠️  Could not load ${filename}: ${err.message}`);
    return [];
  }
}

const michelin = loadJSON('michelin_nyc.json');
const bibGourmand = loadJSON('bib_gourmand_nyc.json');
const chaseSapphire = loadJSON('chase_sapphire_nyc.json');
const rakuten = loadJSON('rakuten_nyc.json');
const popular = loadJSON('popular_nyc.json');

// Also try to load booking_lookup for booking_platform info
let bookingLookup = {};
try {
  bookingLookup = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'booking_lookup.json'), 'utf8'));
  console.log(`✅ Loaded booking_lookup.json: ${Object.keys(bookingLookup).length} entries`);
} catch (err) {
  console.warn(`⚠️  Could not load booking_lookup.json: ${err.message}`);
}

// ============================================================
// MERGE & DEDUPLICATE ALL RESTAURANTS
// ============================================================

const seen = new Set();
const allRestaurants = [];

function normName(n) {
  return String(n || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function addRestaurant(r, source) {
  if (!r || !r.name) return;
  const key = normName(r.name);
  if (seen.has(key)) return;
  seen.add(key);

  // Check if it has a booking platform from booking_lookup
  const lookupKey = r.name.toLowerCase().trim();
  const booking = bookingLookup[lookupKey] || bookingLookup[lookupKey.replace(/^the\s+/, '')] || null;

  allRestaurants.push({
    name: r.name,
    googleRating: r.googleRating || r.rating || 0,
    googleReviewCount: r.googleReviewCount || r.user_ratings_total || 0,
    price_level: r.price_level || null,
    cuisine: r.cuisine || null,
    michelin: r.michelin || (r.stars ? { stars: r.stars, distinction: r.distinction || 'star' } : null),
    formatted_address: r.address || r.formatted_address || '',
    booking_platform: r.booking_platform || (booking ? booking.platform : null),
    booking_url: r.booking_url || (booking ? booking.url : null),
    buzzLinks: r.buzzLinks || r.buzz_links || [],
    types: r.types || [],
    _source: source
  });
}

// Add Michelin with their star data
for (const r of michelin) {
  addRestaurant({
    ...r,
    michelin: { stars: r.stars || 0, distinction: r.distinction || 'star' }
  }, 'michelin');
}

// Add Bib Gourmand
for (const r of bibGourmand) {
  addRestaurant({
    ...r,
    michelin: { stars: 0, distinction: 'bib_gourmand' }
  }, 'bib_gourmand');
}

// Add Chase Sapphire
for (const r of chaseSapphire) addRestaurant(r, 'chase');

// Add Rakuten
for (const r of rakuten) addRestaurant(r, 'rakuten');

// Add Popular
for (const r of popular) addRestaurant(r, 'popular');

console.log(`\n📊 Total unique restaurants: ${allRestaurants.length}`);

// ============================================================
// CLASSIFY RESERVATION TYPES
// ============================================================

const types = { likely_reservable: 0, maybe_reservable: 0, walk_in_only: 0 };
for (const r of allRestaurants) {
  types[rl.reservationType(r)]++;
}
console.log(`   Likely reservable: ${types.likely_reservable}`);
console.log(`   Maybe reservable: ${types.maybe_reservable}`);
console.log(`   Walk-in only: ${types.walk_in_only}`);

// ============================================================
// CALIBRATE & REPORT
// ============================================================

console.log('\nCalibrating...');
const cal = rl.calibrate(allRestaurants);

// Print full report for all 3 scenarios
rl.printCalibrationReport(allRestaurants, cal);

// ============================================================
// SPOT-CHECK: known tough restaurants
// ============================================================

const spotChecks = [
  'Carbone', 'Don Angie', 'Via Carota', 'I Sodi', 'Torrisi',
  'Per Se', 'Eleven Madison Park', 'Atomix', 'Sushi Noz', 'Odo',
  '4 Charles Prime Rib', 'Lucali', 'Lilia', 'Le Bernardin',
  'Tatiana', 'Atera', 'Masa', 'Crown Shy', 'Balthazar',
  'Peter Luger'
];

const scenario = { dayOfWeek: 'friday', timeWindow: ['18:00', '20:00'], partySize: 2 };
console.log('\n' + '='.repeat(65));
console.log('🎯 SPOT CHECK — Friday 6–8pm, party of 2');
console.log('='.repeat(65));

for (const name of spotChecks) {
  const r = allRestaurants.find(x => normName(x.name) === normName(name));
  if (!r) {
    console.log(`   ❓ ${name}: NOT FOUND in dataset`);
    continue;
  }
  const est = rl.computeLikelihood(r, scenario, cal);
  const rt = rl.reservationType(r);
  console.log(`   ${est.likelihood.padEnd(16)} — ${r.name} (${rt}): ${est.reason}`);
}

console.log('\n✅ Done. Review the report above and adjust CONFIG thresholds if needed.');
