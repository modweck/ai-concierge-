#!/usr/bin/env node
/**
 * SEATWIZE CLEANUP + BOOKING MATCH
 * =================================
 * 1. Removes junk entries from popular_nyc.json
 * 2. Runs strict booking matcher
 * 3. Saves both changes
 *
 * RUN: cd ~/ai-concierge- && node cleanup-and-match.js
 * DRY RUN (preview): node cleanup-and-match.js --dry
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

let POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
let BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));

// ═══════════════════════════════════════
// STEP 1: REMOVE JUNK
// ═══════════════════════════════════════

const JUNK_EXACT = new Set([
  'iskcon new york city - hare krishna center',
  'hudson golf',
  'hotel riu plaza manhattan times square',
  'kimpton hotel eventi',
  'the tiny cupboard comedy club & board game bar',
  'uptown gaming bar and lounge',
  'kick axe throwing brooklyn',
  "alayna's nail lounge & s",
  'perfect picnic nyc',
  'chocolate connects inc',
  'buffalo wild wings go',
  'new york best halal food',
  'special halal food',
  'smokey chick halal',
  'best biryani & more... (only take-out and delivery)',
  'sko sushi & catering',
  'utica takeout',
  'the hot dog king',
  'pizza express',
  '183 fish market',
  'ab fish market & food',
  'the bronx beer hall',
  'sixpoint brewery at brookfield place',
  'zeppelin hall beer garden',
  'the wall street hotel',
  'the mark hotel',
  'wythe hotel',
]);

// Chain restaurants to remove ALL instances
const JUNK_STARTSWITH = [
  "dave's hot chicken",
  'wingstop',
  'pollo campero',
  'just salad',
  'playa bowls',
  'chopt creative salad',
  'cava',  // fast casual chain
  'hard rock cafe',
];

function isJunk(name) {
  const n = name.toLowerCase().trim();
  if (JUNK_EXACT.has(n)) return true;
  for (const prefix of JUNK_STARTSWITH) {
    if (n === prefix || n.startsWith(prefix + ' ')) return true;
  }
  return false;
}

const before = POPULAR.length;
const removed = [];
POPULAR = POPULAR.filter(r => {
  if (isJunk(r.name)) {
    removed.push(r.name);
    return false;
  }
  return true;
});

console.log(`\n🧹 STEP 1: CLEANUP`);
console.log(`  Before: ${before}`);
console.log(`  Removed: ${removed.length}`);
console.log(`  After: ${POPULAR.length}`);
if (removed.length > 0) {
  console.log(`\n  Removed entries:`);
  for (const r of removed) console.log(`    ❌ ${r}`);
}

// ═══════════════════════════════════════
// STEP 2: STRICT BOOKING MATCH
// ═══════════════════════════════════════

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

const bookingEntries = Object.entries(BOOKING).map(([name, info]) => ({
  name, norm: norm(name), core: coreWords(name), info
}));

function findMatch(restaurantName) {
  const n = norm(restaurantName);
  const core = coreWords(restaurantName);
  
  for (const b of bookingEntries) {
    if (b.norm === n) return { match: b, reason: 'exact' };
  }
  
  for (const b of bookingEntries) {
    const shorter = b.norm.length < n.length ? b.norm : n;
    const longer = b.norm.length < n.length ? n : b.norm;
    if (shorter.length >= 5 && shorter.length / longer.length > 0.35) {
      const regex = new RegExp('\\b' + shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (regex.test(longer)) return { match: b, reason: 'contains' };
    }
  }
  
  if (core.length >= 2) {
    for (const b of bookingEntries) {
      if (b.core.length < 2) continue;
      const shorter = core.length <= b.core.length ? core : b.core;
      const longer = core.length <= b.core.length ? b.core : core;
      const matchCount = shorter.filter(w => longer.includes(w)).length;
      if (matchCount === shorter.length && matchCount / longer.length >= 0.7) {
        return { match: b, reason: 'core-words' };
      }
    }
  }
  
  return null;
}

let alreadyTagged = 0, newlyMatched = 0, stillMissing = 0;
const matched = [];

for (const r of POPULAR) {
  if (r.booking_platform && r.booking_url) { alreadyTagged++; continue; }
  const result = findMatch(r.name);
  if (result) {
    r.booking_platform = result.match.info.platform;
    r.booking_url = result.match.info.url;
    if (result.match.info.restaurant_id) r.booking_id = result.match.info.restaurant_id;
    newlyMatched++;
    matched.push(`    ✅ ${r.name} → ${result.match.name} (${result.match.info.platform}) [${result.reason}]`);
  } else {
    stillMissing++;
  }
}

console.log(`\n🔗 STEP 2: BOOKING MATCH`);
console.log(`  Already tagged: ${alreadyTagged}`);
console.log(`  Newly matched: ${newlyMatched}`);
console.log(`  Still missing: ${stillMissing}`);

if (matched.length > 0 && matched.length <= 20) {
  console.log(`\n  New matches:`);
  for (const m of matched) console.log(m);
} else if (matched.length > 20) {
  console.log(`\n  First 20 matches:`);
  for (const m of matched.slice(0, 20)) console.log(m);
  console.log(`  ... and ${matched.length - 20} more`);
}

// ═══════════════════════════════════════
// STEP 3: SAVE
// ═══════════════════════════════════════

console.log(`\n📊 SUMMARY`);
console.log(`  Restaurants: ${before} → ${POPULAR.length} (removed ${removed.length} junk)`);
console.log(`  With booking links: ${alreadyTagged + newlyMatched} / ${POPULAR.length}`);
console.log(`  Without booking links: ${stillMissing}`);

if (DRY) {
  console.log(`\n⚠️  DRY RUN - no changes saved. Run without --dry to apply.`);
} else {
  fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));
  console.log(`\n💾 SAVED popular_nyc.json`);
}
