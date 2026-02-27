#!/usr/bin/env node
/**
 * SEATWIZE STRICT BOOKING MATCHER
 * ================================
 * Only matches names that are clearly the same restaurant.
 * e.g. "carbone" → "Carbone New York" ✅
 * e.g. "Thai Nara" → "Up Thai" ❌ REJECTED
 *
 * Rules:
 * 1. Exact match (case-insensitive)
 * 2. One name fully contains the other AND shorter name is 5+ chars
 * 3. Both names start with the same 2+ significant words
 *
 * NO API CALLS.
 * RUN: cd ~/ai-concierge- && node booking-matcher-strict.js
 */

const fs = require('fs');
const path = require('path');

const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

let POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
let BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

// Noise words to strip for matching
const NOISE = new Set(['restaurant','nyc','new','york','ny','the','and','bar','grill',
  'kitchen','cafe','bistro','house','room','place','spot','club','lounge',
  'brooklyn','manhattan','harlem','queens','bronx','astoria','les','ues','uws',
  'midtown','downtown','uptown','village','east','west','north','south',
  'upper','lower','hells','soho','nolita','tribeca','dumbo','lic',
  'jersey','city','nj','heights','park','hill','slope','flatiron',
  'inc','corp','llc','ii','iii','iv','no1']);

function norm(s) {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`'.!?,;:\-–—()\[\]{}"🍕🍣🇯🇵🇲🇽🇨🇴🇻🇪]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ').trim();
}

function coreWords(s) {
  return norm(s).split(' ').filter(w => w.length > 1 && !NOISE.has(w));
}

// Build booking index
const bookingEntries = Object.entries(BOOKING).map(([name, info]) => ({
  name,
  norm: norm(name),
  core: coreWords(name),
  info
}));

function findMatch(restaurantName) {
  const n = norm(restaurantName);
  const core = coreWords(restaurantName);
  
  // 1. Exact normalized match
  for (const b of bookingEntries) {
    if (b.norm === n) return { match: b, reason: 'exact' };
  }
  
  // 2. One fully contains the other as whole words (shorter must be 5+ chars)
  for (const b of bookingEntries) {
    const shorter = b.norm.length < n.length ? b.norm : n;
    const longer = b.norm.length < n.length ? n : b.norm;
    if (shorter.length >= 5 && shorter.length / longer.length > 0.35) {
      // Must match as whole word(s), not substring
      const regex = new RegExp('\\b' + shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (regex.test(longer)) {
        return { match: b, reason: 'contains' };
      }
    }
  }
  
  // 3. Core words match: ALL core words of the shorter name appear in the longer
  //    AND the shorter name has at least 2 core words
  //    AND overlap is very high (>=80% of both)
  if (core.length >= 2) {
    for (const b of bookingEntries) {
      if (b.core.length < 2) continue;
      const shorter = core.length <= b.core.length ? core : b.core;
      const longer = core.length <= b.core.length ? b.core : core;
      
      const matchCount = shorter.filter(w => longer.includes(w)).length;
      const overlapShort = matchCount / shorter.length;
      const overlapLong = matchCount / longer.length;
      
      // ALL shorter words must match AND at least 70% of longer
      if (overlapShort === 1.0 && overlapLong >= 0.7) {
        return { match: b, reason: 'core-words' };
      }
    }
  }
  
  return null;
}

// Run matching
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
  
  const result = findMatch(r.name);
  if (result) {
    const { match, reason } = result;
    r.booking_platform = match.info.platform;
    r.booking_url = match.info.url;
    if (match.info.restaurant_id) r.booking_id = match.info.restaurant_id;
    newlyMatched++;
    matched.push(`  ✅ ${r.name} → ${match.name} (${match.info.platform}) [${reason}]`);
  } else {
    stillMissing++;
    missing.push(r.name);
  }
}

// Preview only - don't save yet
console.log(`\n🔗 SEATWIZE STRICT BOOKING MATCHER`);
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

// Check for --save flag
if (process.argv.includes('--save')) {
  fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));
  console.log(`\n💾 SAVED to popular_nyc.json`);
} else {
  console.log(`\n⚠️  DRY RUN - review matches above. Run with --save to apply.`);
}
