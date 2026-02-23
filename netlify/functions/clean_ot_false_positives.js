#!/usr/bin/env node
/**
 * clean_ot_false_positives.js
 *
 * Identifies and removes false-positive OpenTable links from booking_lookup.json.
 *
 * False positive criteria:
 * 1. Non-NYC city in the URL (miami, nashville, houston, beverly-hills, etc.)
 * 2. Name mismatch: pageName shares no significant words with source name
 * 3. Ambiguous generic URLs (no city suffix) are only flagged if ALSO a name mismatch
 */

const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, 'opentable_find_report.json');
const LOOKUP_PATH = path.join(__dirname, 'booking_lookup.json');

// --- City lists ---

const NON_NYC_CITIES = [
  'miami', 'fort-lauderdale', 'nashville', 'houston', 'beverly-hills',
  'chicago', 'los-angeles', 'san-francisco', 'boston', 'philadelphia',
  'atlanta', 'dallas', 'denver', 'seattle', 'portland', 'austin',
  'scottsdale', 'las-vegas', 'washington', 'baltimore', 'san-diego',
  'phoenix', 'tampa', 'orlando', 'charlotte', 'minneapolis',
  'new-orleans', 'st-louis', 'detroit', 'pittsburgh', 'cincinnati',
  'indianapolis', 'columbus', 'milwaukee', 'raleigh', 'sacramento',
  'san-jose', 'san-antonio', 'memphis', 'louisville', 'richmond',
  'sarasota', 'boca-raton', 'west-palm-beach', 'coral-gables',
  'hewlett' // Long Island but not NYC proper – included because hewlett1 slug is ambiguous
];

const NYC_AREA_LOCATIONS = [
  'new-york', 'brooklyn', 'queens', 'manhattan', 'astoria',
  'long-island-city', 'williamsburg', 'jersey-city', 'edgewater',
  'hoboken', 'bronx', 'staten-island', 'forest-hills', 'rego-park',
  'flushing', 'harlem', 'tribeca', 'soho', 'chelsea', 'greenpoint',
  'bushwick', 'bed-stuy', 'park-slope', 'dumbo', 'cobble-hill',
  'carroll-gardens', 'battery-park', 'lic'
];

// --- Helpers ---

/** Decode HTML entities (&#x27; -> ', &amp; -> &, etc.) */
function decodeHtml(str) {
  return str
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Normalize a name: lowercase, decode HTML, strip diacritics, strip punctuation, collapse whitespace */
function normalize(name) {
  return decodeHtml(name)
    .normalize('NFD')                 // decompose accented chars (ë -> e + combining diaeresis)
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/['\u2018\u2019`]/g, '') // all apostrophe variants (straight, curly left/right, backtick)
    .replace(/[^a-z0-9\s]/g, ' ')   // strip remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Get significant words (length > 3) from a normalized name */
function significantWords(normalized) {
  const STOP = new Set([
    'the', 'and', 'bar', 'restaurant', 'grill', 'cafe', 'kitchen',
    'house', 'room', 'bistro', 'tavern', 'club', 'shop', 'food',
    'thai', 'new', 'york', 'east', 'west', 'north', 'south',
    'upper', 'lower', 'side', 'city'
  ]);
  return normalized
    .split(' ')
    .filter(w => w.length > 3 && !STOP.has(w));
}

/** Check if two names share at least one significant word */
function namesMatch(sourceName, pageName) {
  const nSource = normalize(sourceName);
  const nPage = normalize(pageName);

  // Exact match after normalization
  if (nSource === nPage) return true;

  // One contains the other
  if (nSource.includes(nPage) || nPage.includes(nSource)) return true;

  // Check significant word overlap
  const srcWords = significantWords(nSource);
  const pageWords = significantWords(nPage);

  // If either side has no significant words, fall back to checking
  // if one is a substring of the other or first 4 chars match
  if (srcWords.length === 0 || pageWords.length === 0) {
    // Short-name heuristic: first significant token overlap
    const srcTokens = nSource.split(' ').filter(w => w.length > 1);
    const pageTokens = nPage.split(' ').filter(w => w.length > 1);
    for (const s of srcTokens) {
      for (const p of pageTokens) {
        if (s === p) return true;
        const shorter = Math.min(s.length, p.length);
        const longer = Math.max(s.length, p.length);
        if ((s.startsWith(p) || p.startsWith(s)) && shorter / longer >= 0.8) return true;
      }
    }
    return false;
  }

  const pageWordSet = new Set(pageWords);
  for (const w of srcWords) {
    if (pageWordSet.has(w)) return true;
    // Partial match: one word starts with the other, but only if the shorter
    // is >= 80% the length of the longer (avoids "maya" matching "mayahuel")
    for (const pw of pageWords) {
      const shorter = Math.min(w.length, pw.length);
      const longer = Math.max(w.length, pw.length);
      if ((w.startsWith(pw) || pw.startsWith(w)) && shorter / longer >= 0.8) return true;
    }
  }
  return false;
}

/**
 * Extract the city/location suffix from an OpenTable URL.
 * URLs are like:
 *   /r/restaurant-name-city
 *   /restaurant-name  (old format, no /r/)
 * Returns the last hyphen-segment that looks like a city, or null.
 */
function extractUrlCity(url) {
  const urlPath = new URL(url).pathname;  // e.g. /r/mojo-fort-lauderdale
  // Remove /r/ prefix if present
  const slug = urlPath.replace(/^\/r\//, '/').replace(/^\//, '');
  return slug; // return full slug for pattern matching
}

/** Check if URL contains a non-NYC city */
function hasNonNycCity(url) {
  const slug = extractUrlCity(url).toLowerCase();
  for (const city of NON_NYC_CITIES) {
    // Match city as a suffix or segment: slug ends with -city or -city-N (numbered)
    const pattern = new RegExp(`-${city}(\\d*)$`);
    if (pattern.test(slug)) return city;
    // Also check if the city appears as a segment in the middle (e.g. beverly-hills-at-...)
    const segPattern = new RegExp(`-${city}-`);
    if (segPattern.test(slug)) return city;
    // Also check for slug starting with city name (for old-format /city-restaurant)
    if (slug.startsWith(city + '-') || slug === city) return city;
  }
  // Special case: check for "freds-beverly-hills" pattern
  if (slug.includes('beverly-hills')) return 'beverly-hills';
  return null;
}

/** Check if URL has an NYC-area location */
function hasNycLocation(url) {
  const slug = extractUrlCity(url).toLowerCase();
  for (const loc of NYC_AREA_LOCATIONS) {
    const pattern = new RegExp(`-${loc}(\\d*)$`);
    if (pattern.test(slug)) return true;
    if (slug.endsWith(`-${loc}`)) return true;
  }
  return false;
}

// --- Main ---

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const lookup = JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf8'));

const newLinks = report.newLinks;
const falsePositives = []; // { name, url, pageName, reason }
const falsePositiveUrls = new Set();

for (const entry of newLinks) {
  const { name, url, pageName } = entry;
  const reasons = [];

  // Check 1: Non-NYC city in URL
  const nonNycCity = hasNonNycCity(url);
  if (nonNycCity) {
    reasons.push(`Non-NYC city in URL: "${nonNycCity}"`);
  }

  // Check 2: Name mismatch
  const nameMatches = namesMatch(name, pageName);

  if (!nameMatches) {
    // For URLs with a known NYC location or old-format URLs, still flag name mismatches
    reasons.push(`Name mismatch: source="${name}" vs page="${decodeHtml(pageName)}"`);
  }

  // Check 3: If the URL has no city suffix and there IS a name mismatch, flag it
  // (handled by the above logic: non-NYC city OR name mismatch triggers flagging)

  // Only flag if we have at least one reason
  if (reasons.length > 0) {
    falsePositives.push({ name, url, pageName: decodeHtml(pageName), reasons });
    falsePositiveUrls.add(url);
  }
}

// De-duplicate false positives by URL (same URL can appear multiple times in report)
const uniqueFP = new Map();
for (const fp of falsePositives) {
  if (!uniqueFP.has(fp.url)) {
    uniqueFP.set(fp.url, fp);
  } else {
    // Merge reasons
    const existing = uniqueFP.get(fp.url);
    for (const r of fp.reasons) {
      if (!existing.reasons.includes(r)) {
        existing.reasons.push(r);
      }
    }
  }
}

// Now find all keys in booking_lookup.json whose URL matches a false positive
const keysToRemove = [];
for (const [key, value] of Object.entries(lookup)) {
  if (value.url && falsePositiveUrls.has(value.url)) {
    keysToRemove.push({ key, url: value.url, platform: value.platform });
  }
}

// Print results
console.log('=== FALSE POSITIVE OPENTABLE LINKS ===\n');
console.log(`Total new links in report: ${newLinks.length}`);
console.log(`False positives identified: ${uniqueFP.size} unique URLs`);
console.log(`Keys to remove from booking_lookup.json: ${keysToRemove.length}\n`);

console.log('--- Detailed False Positives ---\n');
let i = 0;
for (const [url, fp] of uniqueFP) {
  i++;
  console.log(`${i}. ${fp.name}`);
  console.log(`   URL: ${fp.url}`);
  console.log(`   Page: ${fp.pageName}`);
  console.log(`   Reason(s): ${fp.reasons.join('; ')}`);

  // Show which keys will be removed
  const matchingKeys = keysToRemove.filter(k => k.url === url);
  if (matchingKeys.length > 0) {
    console.log(`   Lookup keys removed: ${matchingKeys.map(k => `"${k.key}"`).join(', ')}`);
  } else {
    console.log(`   (No matching keys found in booking_lookup.json)`);
  }
  console.log('');
}

// Remove from lookup
let removedCount = 0;
for (const { key } of keysToRemove) {
  delete lookup[key];
  removedCount++;
}

// Write updated lookup
fs.writeFileSync(LOOKUP_PATH, JSON.stringify(lookup, null, 2) + '\n');

console.log(`\n=== DONE ===`);
console.log(`Removed ${removedCount} entries from booking_lookup.json`);
console.log(`Remaining entries: ${Object.keys(lookup).length}`);
