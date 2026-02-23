#!/usr/bin/env node
/**
 * PATCH: Wire popular_nyc.json into search-candidates.js
 * 
 * Run from: netlify/functions/
 *   node patch_popular.js
 * 
 * Creates a backup first, then makes 3 surgical edits.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'search-candidates.js');
const BACKUP = path.join(__dirname, 'search-candidates.pre_popular.js');

let code = fs.readFileSync(FILE, 'utf8');

// Backup
fs.writeFileSync(BACKUP, code);
console.log(`💾 Backup saved to ${BACKUP}`);

let changes = 0;

// ─── CHANGE 1: Add POPULAR_BASE load after RAKUTEN_BASE ───
const rakutenLoadEnd = "} catch (err) { console.warn('\\u274c Rakuten base missing:', err.message); }";
if (code.includes(rakutenLoadEnd) && !code.includes('POPULAR_BASE')) {
  const popularLoad = `

let POPULAR_BASE = [];
try {
  POPULAR_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'popular_nyc.json'), 'utf8'));
  console.log(\`\\u2705 Popular base: \${POPULAR_BASE.length} entries\`);
} catch (err) { console.warn('\\u26a0\\ufe0f Popular base missing:', err.message); }`;

  code = code.replace(rakutenLoadEnd, rakutenLoadEnd + popularLoad);
  changes++;
  console.log('✅ Change 1: Added POPULAR_BASE load');
} else if (code.includes('POPULAR_BASE')) {
  console.log('⏭️  Change 1: POPULAR_BASE already exists, skipping');
} else {
  // Try alternate marker
  const altMarker = "} catch (err) { console.warn('⚠️ Rakuten base missing:', err.message); }";
  if (code.includes(altMarker)) {
    const popularLoad = `

let POPULAR_BASE = [];
try {
  POPULAR_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'popular_nyc.json'), 'utf8'));
  console.log(\`✅ Popular base: \${POPULAR_BASE.length} entries\`);
} catch (err) { console.warn('⚠️ Popular base missing:', err.message); }`;
    code = code.replace(altMarker, altMarker + popularLoad);
    changes++;
    console.log('✅ Change 1: Added POPULAR_BASE load (alt marker)');
  } else {
    console.log('❌ Change 1: Could not find RAKUTEN_BASE load block');
  }
}

// ─── CHANGE 2: Add getPopularPlaces function after getBibGourmandPlaces ───
if (!code.includes('getPopularPlaces')) {
  const bibFuncEnd = 'function getBibGourmandPlaces() {\n  if (!BIB_GOURMAND_BASE?.length) return [];\n  return BIB_GOURMAND_BASE.filter(b => b.lat != null && b.lng != null);\n}';
  
  const popularFunc = `

function getPopularPlaces() {
  if (!POPULAR_BASE?.length) return [];
  return POPULAR_BASE.filter(p => p.lat != null && p.lng != null);
}`;

  if (code.includes(bibFuncEnd)) {
    code = code.replace(bibFuncEnd, bibFuncEnd + popularFunc);
    changes++;
    console.log('✅ Change 2: Added getPopularPlaces function');
  } else {
    // Try to find it with different whitespace
    const bibMatch = code.match(/function getBibGourmandPlaces\(\)\s*\{[^}]+\}/);
    if (bibMatch) {
      code = code.replace(bibMatch[0], bibMatch[0] + popularFunc);
      changes++;
      console.log('✅ Change 2: Added getPopularPlaces function (flex match)');
    } else {
      console.log('❌ Change 2: Could not find getBibGourmandPlaces function');
    }
  }
} else {
  console.log('⏭️  Change 2: getPopularPlaces already exists, skipping');
}

// ─── CHANGE 3: Add popular injection block after Bib Gourmand injection ───
if (!code.includes('popular_inject')) {
  // Find the end of the Bib Gourmand injection block
  const bibInjectEnd = `if (bibInjected) console.log(\`\\u2705 Injected \${bibInjected} Bib Gourmand restaurants not in Google results\`);`;
  const bibInjectEndAlt = 'if (bibInjected) console.log(`✅ Injected ${bibInjected} Bib Gourmand restaurants not in Google results`);';
  
  const popularInjectBlock = `

    // INJECT Popular 4.4+ restaurants not in Google results
    const popularPlaces = getPopularPlaces();
    let popularInjected = 0;
    for (const p of popularPlaces) {
      if (!p?.lat || !p?.lng) continue;
      if (p.place_id && existingIds.has(p.place_id)) continue;
      if (p.name && existingNames.has(normalizeName(p.name))) continue;
      if (cuisineStr && p.cuisine) {
        const pc = p.cuisine.toLowerCase();
        if (!pc.includes(cuisineStr.toLowerCase())) continue;
      }
      const d = haversineMiles(gLat, gLng, p.lat, p.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: p.place_id || null, name: p.name,
        vicinity: p.address || '', formatted_address: p.address || '',
        price_level: p.price_level || null, opening_hours: null,
        geometry: { location: { lat: p.lat, lng: p.lng } },
        types: [], googleRating: p.googleRating || 0, googleReviewCount: p.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 20), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: null, cuisine: p.cuisine || null,
        booking_platform: p.booking_platform || null,
        booking_url: p.booking_url || null,
        _source: 'popular_inject'
      });
      if (p.place_id) existingIds.add(p.place_id);
      existingNames.add(normalizeName(p.name));
      popularInjected++;
    }
    if (popularInjected) console.log(\`\\u2705 Injected \${popularInjected} popular 4.4+ restaurants not in other results\`);`;

  if (code.includes(bibInjectEnd)) {
    code = code.replace(bibInjectEnd, bibInjectEnd + popularInjectBlock);
    changes++;
    console.log('✅ Change 3: Added popular injection block');
  } else if (code.includes(bibInjectEndAlt)) {
    code = code.replace(bibInjectEndAlt, bibInjectEndAlt + popularInjectBlock.replace(/\\u2705/g, '✅'));
    changes++;
    console.log('✅ Change 3: Added popular injection block (alt marker)');
  } else {
    console.log('❌ Change 3: Could not find Bib Gourmand injection end marker');
    console.log('   Looking for:', bibInjectEnd.slice(0, 60) + '...');
  }
} else {
  console.log('⏭️  Change 3: popular_inject already exists, skipping');
}

// Save
if (changes > 0) {
  fs.writeFileSync(FILE, code);
  console.log(`\n✅ Applied ${changes} changes to search-candidates.js`);
  console.log(`💾 Backup at ${BACKUP}`);
} else {
  console.log('\n⚠️ No changes applied — check error messages above');
}
