#!/usr/bin/env node
/**
 * FIX BOOKING MISMATCHES
 * ======================
 * Adds 74 restaurants that have Resy/OT links in popular_nyc.json
 * but were missing from booking_lookup.json due to name mismatches.
 * 
 * RUN: cd ~/ai-concierge- && node fix-booking-mismatches.js
 * Add --save to actually write changes (dry run by default)
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

// ═══════════════════════════════════════════
// AUTO-MATCHED (58) - Ultra-strict algorithm confirmed these
// ═══════════════════════════════════════════

function normalize(s) {
  return s.toLowerCase().trim()
    .replace(/[''"""`]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function slugToName(slug) {
  const suffixes = ['-new-york', '-manhattan', '-brooklyn', '-queens', '-nyc', '-ny',
    '-midtown', '-flatiron', '-soho', '-tribeca', '-east-village',
    '-west-village', '-williamsburg', '-dumbo', '-harlem',
    '-upper-west-side', '-upper-east-side', '-downtown',
    '-world-trade-center', '-hudson-yards'];
  for (const suf of suffixes) slug = slug.replace(suf, '');
  return slug.replace(/-/g, ' ').trim();
}

const GENERIC_SLUGS = new Set(['king', 'craft', 'diner', 'masa', 'commerce', 'gotham',
  'dante', 'le-b', 'cote', 'catch', 'stars', 'fonda', 'folk', 'cove', 'dame',
  'claud', 'petes', 'ren', 'manhatta', 'lavo', 'mira', 'nari', 'olmo', 'huda', 'lysee', 'lords']);

const LOC_WORDS = new Set(['nyc', 'lic', 'brooklyn', 'manhattan', 'queens', 'astoria',
  'harlem', 'flushing', 'dumbo', 'williamsburg', 'soho', 'tribeca', 'midtown',
  'flatiron', 'chelsea', 'new', 'york', 'upper', 'west', 'east', 'side', 'village',
  'greenwich', 'hudson', 'yards', 'wall', 'street', 'jersey', 'city']);

// ═══════════════════════════════════════════
// MANUAL OVERRIDES - Verified correct but algorithm couldn't catch
// (accent issues, name format differences, etc.)
// ═══════════════════════════════════════════

const MANUAL_OVERRIDES = new Map([
  // Accent stripping issues
  ['fogo de chão brazilian steakhouse', true],
  ['mála project 53rd st', true],
  ['mála project greenpoint', true],
  ['la tête d\'or by daniel', true],
  // Name format differences (but confirmed correct restaurants)
  ['sea fire grill', true],
  ['huda new levantine bistro', true],
  ['kochi - korean fine dining', true],
  ['seva indian cuisine', true],
  ['lungi south indian & sri lankan restaurant', true],
  ['larina pastificio & vino', true],
  ['spiga ristorante & cocktail bar', true],
  ['clara restaurant', true],
  ['tumi peruvian restaurant nyc', true],
  ['avra madison', true],
  ['the simpson', true],
  ['carmine\'s - time square', true],
]);

function extractSlug(url) {
  if (url.includes('opentable.com/r/')) return url.split('/r/')[1]?.split('?')[0]?.split('/')[0] || '';
  if (url.includes('/venues/')) return url.split('/venues/')[1]?.split('?')[0]?.split('/')[0] || '';
  if (url.includes('resy.com/cities/')) {
    const parts = url.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
  }
  return '';
}

function autoMatch(name, slug) {
  const slugName = slugToName(slug);
  const nameNorm = normalize(name);
  const nameCore = nameNorm.split(' ').filter(w => !LOC_WORDS.has(w)).join(' ');

  // Skip generic slugs unless exact match
  if (GENERIC_SLUGS.has(slug)) {
    return slugName === nameCore;
  }

  // Exact core match
  if (slugName === nameCore) return true;

  // Multi-word slug, all words in name
  if (slugName.split(' ').length >= 2) {
    const slugWords = slugName.split(' ');
    const nameWords = new Set(nameNorm.split(' '));
    if (slugWords.every(w => nameWords.has(w))) return true;
  }

  // Slug ≥6 chars, name starts with slug or slug is first word
  if (slugName.length >= 6) {
    if (nameCore.startsWith(slugName)) return true;
    if (slugName.startsWith(nameCore) && nameCore.length >= 4) return true;
    if (nameCore.split(' ')[0] === slugName && slugName.length >= 6) return true;
  }

  return false;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

const added = [];
const skipped = [];

for (const r of popular) {
  const key = (r.name || '').toLowerCase().trim();
  if (!key || bookingKeys.has(key)) continue;
  if (!r.booking_platform || !r.booking_url) continue;

  const slug = extractSlug(r.booking_url);
  if (!slug) continue;

  const isManual = MANUAL_OVERRIDES.has(key);
  const isAuto = autoMatch(r.name, slug);

  if (isAuto || isManual) {
    added.push({
      name: r.name,
      key,
      platform: r.booking_platform,
      url: r.booking_url,
      slug,
      method: isManual ? 'manual' : 'auto'
    });
  } else {
    skipped.push({ name: r.name, slug, platform: r.booking_platform });
  }
}

console.log(`\n🔧 FIX BOOKING MISMATCHES`);
console.log(`${'='.repeat(50)}`);
console.log(`📊 Found: ${added.length} to add (${added.filter(a => a.method === 'auto').length} auto, ${added.filter(a => a.method === 'manual').length} manual)`);
console.log(`📊 Skipped: ${skipped.length} (wrong matches)`);

console.log(`\n✅ Adding:`);
for (const a of added) {
  console.log(`  ${a.method === 'manual' ? '🔧' : '✅'} ${a.name} → ${a.slug} (${a.platform})`);
}

if (skipped.length) {
  console.log(`\n❌ Skipped (wrong restaurant matches):`);
  for (const s of skipped) {
    console.log(`  ${s.name} → ${s.slug} (${s.platform})`);
  }
}

if (SAVE) {
  let count = 0;
  for (const a of added) {
    if (!booking[a.key]) {
      booking[a.key] = { platform: a.platform, url: a.url };
      count++;
    }
  }
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(booking, null, 2));
  console.log(`\n💾 SAVED: Added ${count} entries. Total: ${Object.keys(booking).length}`);
  console.log(`📋 Next: git add -A && git commit -m "Fix ${count} booking mismatches" && git push`);
} else {
  console.log(`\n⚠️  DRY RUN - run with --save to apply changes`);
}
