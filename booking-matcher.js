#!/usr/bin/env node
/**
 * SEATWIZE BOOKING MATCHER
 * ========================
 * Fuzzy-matches booking_lookup.json entries to popular_nyc.json entries.
 * Many restaurants have slightly different names between the two files
 * (e.g. "carbone" vs "Carbone New York"). This script matches them up
 * and tags popular_nyc entries with booking_platform and booking_url.
 *
 * NO API CALLS - just local file matching.
 *
 * RUN: cd ~/ai-concierge- && node booking-matcher.js
 */

const fs = require('fs');
const path = require('path');

const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

let POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
let BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

function norm(s) {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`'.!?,;:\-–—()\[\]{}"]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ').trim();
}

// Build normalized booking lookup
const bookingNorm = new Map();
for (const [name, info] of Object.entries(BOOKING)) {
  bookingNorm.set(norm(name), { name, ...info });
}

// Also build word sets for fuzzy matching
const bookingWords = new Map();
for (const [name, info] of Object.entries(BOOKING)) {
  const words = norm(name).split(' ').filter(w => w.length > 2);
  bookingWords.set(norm(name), { words, name, ...info });
}

function findBooking(restaurantName) {
  const n = norm(restaurantName);
  
  // 1. Exact match
  if (bookingNorm.has(n)) return bookingNorm.get(n);
  
  // 2. One contains the other
  for (const [bk, info] of bookingNorm) {
    if (n.includes(bk) || bk.includes(n)) return info;
  }
  
  // 3. Word overlap >= 60% (with the shorter name's words)
  const wordsA = n.split(' ').filter(w => w.length > 2);
  if (wordsA.length === 0) return null;
  
  let bestMatch = null;
  let bestOverlap = 0;
  
  for (const [bk, info] of bookingWords) {
    const wordsB = info.words;
    if (wordsB.length === 0) continue;
    const common = wordsA.filter(w => wordsB.includes(w));
    const overlap = common.length / Math.min(wordsA.length, wordsB.length);
    if (overlap > bestOverlap && overlap >= 0.6) {
      bestOverlap = overlap;
      bestMatch = info;
    }
  }
  
  return bestMatch;
}

// Match and update
let alreadyTagged = 0;
let newlyMatched = 0;
let stillMissing = 0;
const matched = [];
const missing = [];

for (const r of POPULAR) {
  if (r.booking_platform && r.booking_url) {
    alreadyTagged++;
    continue;
  }
  
  const match = findBooking(r.name);
  if (match) {
    r.booking_platform = match.platform;
    r.booking_url = match.url;
    newlyMatched++;
    matched.push(`  ✅ ${r.name} → ${match.name} (${match.platform})`);
  } else {
    stillMissing++;
    missing.push(r.name);
  }
}

// Save
fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));

console.log(`\n🔗 SEATWIZE BOOKING MATCHER`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 popular_nyc: ${POPULAR.length} restaurants`);
console.log(`📊 booking_lookup: ${Object.keys(BOOKING).length} entries`);
console.log(`\n📊 Results:`);
console.log(`  Already tagged: ${alreadyTagged}`);
console.log(`  Newly matched: ${newlyMatched}`);
console.log(`  Still missing: ${stillMissing}`);

if (matched.length > 0) {
  console.log(`\n✅ New matches (${matched.length}):`);
  for (const m of matched) console.log(m);
}

if (missing.length > 0 && missing.length <= 50) {
  console.log(`\n❌ Still no booking link (${missing.length}):`);
  for (const m of missing) console.log(`  ${m}`);
} else if (missing.length > 50) {
  console.log(`\n❌ Still no booking link: ${missing.length} restaurants`);
  console.log(`  First 30:`);
  for (const m of missing.slice(0, 30)) console.log(`  ${m}`);
}

console.log(`\n✨ Done! popular_nyc.json updated.`);
