#!/usr/bin/env node
/**
 * CLEANUP: Remove junk from NO-BOOKING restaurants only
 * ======================================================
 * Only removes restaurants that have NO booking link at all.
 * Never touches restaurants that have Resy/OT/Google booking.
 *
 * Removes if NO booking AND:
 *   - Name matches junk keywords (pizza, cafe, bar, deli, etc.)
 *   - OR under 100 Google reviews
 *
 * RUN: cd ~/ai-concierge- && node cleanup-junk.js
 * Add --save to write changes (dry run by default)
 */

const fs = require('fs');
const path = require('path');

const SAVE = process.argv.includes('--save');
const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');

const popular = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8'));
const booking = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8'));
const bookingKeys = new Set(Object.keys(booking).map(k => k.toLowerCase().trim()));

const JUNK_KEYWORDS = [
  'pizza', 'pizzeria', 'slice',
  'cafe', 'café', 'coffee', 'espresso',
  'deli', 'delicatessen',
  'bar ', ' bar', 'pub', 'tavern', 'saloon', 'taproom', 'beer', 'ale house', 'brewery',
  'diner',
  'bakery', 'bake shop', 'pastry', 'patisserie',
  'market', 'store', 'grocery', 'bodega', 'shop',
  'bento', 'takeout', 'take-out', 'express', 'cart', 'truck', 'halal food',
  'fried chicken', 'wing', 'wings', 'sub ', 'hero', 'smoothie', 'juice',
  'bubble tea', 'boba', 'acai', 'poke', 'wrap', 'bowl',
  'catering', 'banquet',
  'hotel', 'inn ',
  'food hall', 'food court',
];

function hasBooking(r) {
  const key = (r.name || '').toLowerCase().trim();
  return bookingKeys.has(key) || !!r.booking_platform;
}

function isKeywordJunk(name) {
  const lower = name.toLowerCase();
  return JUNK_KEYWORDS.some(kw => lower.includes(kw));
}

const keep = [];
const remove = [];

for (const r of popular) {
  const name = r.name || '';
  if (!name) { remove.push({ name: '(empty)', reason: 'empty name' }); continue; }

  // Has booking? ALWAYS keep, no matter what
  if (hasBooking(r)) {
    keep.push(r);
    continue;
  }

  // === NO BOOKING from here down ===

  // Junk keyword in name? Remove
  if (isKeywordJunk(name)) {
    remove.push({ name, reason: 'keyword junk', reviews: r.googleReviewCount || 0 });
    continue;
  }

  // Under 100 reviews? Remove
  if ((r.googleReviewCount || 0) < 100) {
    remove.push({ name, reason: `under 100 reviews (${r.googleReviewCount || 0})`, reviews: r.googleReviewCount || 0 });
    continue;
  }

  // Passes all checks — keep
  keep.push(r);
}

console.log(`\n🧹 CLEANUP: Remove junk from no-booking restaurants`);
console.log(`${'='.repeat(55)}`);
console.log(`📊 Original: ${popular.length}`);
console.log(`📊 Keeping: ${keep.length}`);
console.log(`📊 Removing: ${remove.length}`);
console.log(`   Keyword junk: ${remove.filter(r => r.reason === 'keyword junk').length}`);
console.log(`   Under 100 reviews: ${remove.filter(r => r.reason.startsWith('under')).length}`);

console.log(`\n❌ Removing:`);
for (const r of remove.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${r.name} (${r.reviews} rev) — ${r.reason}`);
}

if (SAVE) {
  fs.writeFileSync(POPULAR_FILE, JSON.stringify(keep, null, 2));
  console.log(`\n💾 SAVED: ${keep.length} restaurants (removed ${remove.length})`);
  console.log(`📋 Next: git add -A && git commit -m "Remove ${remove.length} junk restaurants" && git push`);
} else {
  console.log(`\n⚠️  DRY RUN — run with --save to apply`);
}
