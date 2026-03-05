#!/usr/bin/env node
/**
 * patch_likelihood.js — Wire reservation likelihood into backend + frontend
 * Usage: cd ~/ai-concierge- && node patch_likelihood.js
 */
const fs = require('fs');
const path = require('path');

// ============================================================
// 1) Ensure reservation-likelihood.js is in netlify/functions/
// ============================================================
const srcRL = path.join(__dirname, 'reservation-likelihood.js');
const destRL = path.join(__dirname, 'netlify', 'functions', 'reservation-likelihood.js');

if (!fs.existsSync(destRL)) {
  if (fs.existsSync(srcRL)) {
    fs.copyFileSync(srcRL, destRL);
    console.log('📦 Copied reservation-likelihood.js → netlify/functions/');
  } else {
    console.error('❌ reservation-likelihood.js not found in project root!');
    process.exit(1);
  }
} else {
  console.log('✅ reservation-likelihood.js already in netlify/functions/');
}

// ============================================================
// 2) Patch search-candidates.js (backend)
// ============================================================
const scPath = path.join(__dirname, 'netlify', 'functions', 'search-candidates.js');
let sc = fs.readFileSync(scPath, 'utf8');

if (sc.includes('reservation-likelihood')) {
  console.log('⚠️  search-candidates.js already patched — skipping backend');
} else {
  // Backup
  fs.writeFileSync(scPath + '.bak', sc);
  console.log('💾 Backup → search-candidates.js.bak');

  // PATCH A: Add require + helpers after BOOKING_KEYS block
  const bookingAnchor = "} catch (err) { console.warn('\\u274c Booking lookup missing:', err.message); }";
  const patchA = `

// ── RESERVATION LIKELIHOOD ──────────────────────────────────────
const likelihood = require('./reservation-likelihood');
let LIKELIHOOD_CAL = null;
function getLikelihoodCalibration() {
  if (LIKELIHOOD_CAL) return LIKELIHOOD_CAL;
  const allForCal = [], seenCal = new Set();
  const addCal = (arr, transform) => {
    for (const r of (arr || [])) {
      if (!r || !r.name) continue;
      const key = (r.name || '').toLowerCase().trim();
      if (seenCal.has(key)) continue; seenCal.add(key);
      allForCal.push(transform ? transform(r) : {
        name: r.name, googleRating: r.googleRating || r.rating || 0,
        googleReviewCount: r.googleReviewCount || r.user_ratings_total || 0,
        price_level: r.price_level || null, michelin: r.michelin || null,
        formatted_address: r.address || r.formatted_address || '',
        booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,
        cuisine: r.cuisine || null, types: r.types || []
      });
    }
  };
  addCal(POPULAR_BASE);
  addCal(MICHELIN_BASE, m => ({
    name: m.name, googleRating: m.googleRating || 0, googleReviewCount: m.googleReviewCount || 0,
    price_level: m.price_level || null, michelin: { stars: m.stars||0, distinction: m.distinction||'star' },
    formatted_address: m.address || '', booking_platform: m.booking_platform || null,
    booking_url: m.booking_url || null, cuisine: m.cuisine || null, types: []
  }));
  addCal(BIB_GOURMAND_BASE, b => ({
    name: b.name, googleRating: b.googleRating || 0, googleReviewCount: b.googleReviewCount || 0,
    price_level: b.price_level || null, michelin: { stars: 0, distinction: 'bib_gourmand' },
    formatted_address: b.address || '', booking_platform: b.booking_platform || null,
    booking_url: b.booking_url || null, cuisine: b.cuisine || null, types: []
  }));
  addCal(CHASE_SAPPHIRE_BASE);
  addCal(RAKUTEN_BASE);
  for (const r of allForCal) {
    if (!r.booking_platform) {
      const info = getBookingInfo(r.name);
      if (info) { r.booking_platform = info.platform; r.booking_url = info.url; }
    }
  }
  console.log('📊 Likelihood: calibrating ' + allForCal.length + ' restaurants');
  LIKELIHOOD_CAL = likelihood.calibrate(allForCal);
  return LIKELIHOOD_CAL;
}
function attachLikelihoodEstimates(restaurants, scenario) {
  if (!restaurants || !restaurants.length) return;
  const cal = getLikelihoodCalibration();
  const sc = scenario || { dayOfWeek: 'tuesday', timeWindow: ['18:00', '20:00'], partySize: 2 };
  for (const r of restaurants) {
    const est = likelihood.computeLikelihood(r, sc, cal);
    r.reservationEstimate = {
      likelihood: est.likelihood, reason: est.reason,
      suggestion: est.suggestion, reservationType: est.reservationType,
      _likelihoodScore: est.likelihoodScore
    };
  }
}
// ── END RESERVATION LIKELIHOOD ──────────────────────────────────`;

  if (!sc.includes(bookingAnchor)) {
    console.error('❌ Could not find BOOKING anchor in search-candidates.js');
    process.exit(1);
  }
  sc = sc.replace(bookingAnchor, bookingAnchor + patchA);
  console.log('✅ Added likelihood require + calibration helper');

  // PATCH B: Attach estimates before the final sort
  const sortAnchor = '    const sortFn = (a,b) => {';
  const patchB = `    // Attach reservation likelihood estimates
    attachLikelihoodEstimates(visibleRestaurants);
    console.log('✅ Likelihood: ' + visibleRestaurants.length + ' restaurants scored');

`;
  if (!sc.includes(sortAnchor)) {
    console.error('❌ Could not find sortFn anchor in search-candidates.js');
    process.exit(1);
  }
  sc = sc.replace(sortAnchor, patchB + sortAnchor);
  console.log('✅ Added likelihood scoring before sort');

  fs.writeFileSync(scPath, sc);
  console.log('✅ search-candidates.js patched!');
}

// ============================================================
// 3) Patch index.html (frontend — add likelihood badge)
// ============================================================
const indexPath = path.join(__dirname, 'index.html');
let idx = fs.readFileSync(indexPath, 'utf8');

if (idx.includes('likelihoodHtml')) {
  console.log('⚠️  index.html already patched — skipping frontend');
} else {
  // Backup
  fs.writeFileSync(indexPath + '.bak', idx);
  console.log('💾 Backup → index.html.bak');

  // PATCH C: Add CSS for likelihood badges
  const cssAnchor = '.badge.distance{background:#e0f2fe;border-color:#7dd3fc;color:#075985}';
  const patchCSS = `.badge.distance{background:#e0f2fe;border-color:#7dd3fc;color:#075985}
    .badge.likelihood-high{background:#dcfce7;border-color:#86efac;color:#166534}
    .badge.likelihood-medium{background:#fef9c3;border-color:#fde047;color:#854d0e}
    .badge.likelihood-low{background:#fee2e2;border-color:#fca5a5;color:#991b1b}
    .badge.likelihood-walkin{background:#f3f4f6;border-color:#d1d5db;color:#6b7280}`;

  if (!idx.includes(cssAnchor)) {
    console.error('❌ Could not find CSS anchor in index.html');
    process.exit(1);
  }
  idx = idx.replace(cssAnchor, patchCSS);
  console.log('✅ Added likelihood badge CSS');

  // PATCH D: Add likelihood badge rendering in renderCard()
  // Insert after the rakutenHtml line
  const rakutenAnchor = `const rakutenHtml = (state.rewardsFilter === 'rakuten' || isRakutenRestaurant(r.name))`;
  const rakutenLineEnd = idx.indexOf('\n', idx.indexOf(rakutenAnchor));

  const patchBadge = `

  // Reservation likelihood badge
  let likelihoodHtml = '';
  if (r.reservationEstimate) {
    const est = r.reservationEstimate;
    const likelihoodMap = {
      'High': { css: 'likelihood-high', icon: '🟢', text: 'High likelihood' },
      'Medium': { css: 'likelihood-medium', icon: '🟡', text: 'Medium likelihood' },
      'Low': { css: 'likelihood-low', icon: '🔴', text: 'Low likelihood' },
      'Walk-in focused': { css: 'likelihood-walkin', icon: '🚶', text: 'Walk-in focused' }
    };
    const style = likelihoodMap[est.likelihood] || likelihoodMap['Medium'];
    likelihoodHtml = '<span class="badge ' + style.css + '" title="' + (est.reason || 'Seatwize estimate') + '">' + style.icon + ' ' + style.text + '</span>';
  }`;

  idx = idx.slice(0, rakutenLineEnd) + patchBadge + idx.slice(rakutenLineEnd);
  console.log('✅ Added likelihood badge rendering');

  // PATCH E: Add likelihoodHtml to the badges div
  // Find the badges section and add likelihoodHtml after michelinHtml
  const badgesAnchor = '${michelinHtml}\n        ${ratingHtml}';
  const patchBadgeInsert = '${michelinHtml}\n        ${likelihoodHtml}\n        ${ratingHtml}';

  if (!idx.includes(badgesAnchor)) {
    // Try without newline (in case of different whitespace)
    const alt = '${michelinHtml}';
    const altIdx = idx.indexOf(alt, idx.indexOf('<div class="badges">'));
    if (altIdx > -1) {
      idx = idx.slice(0, altIdx + alt.length) + '\n        ${likelihoodHtml}' + idx.slice(altIdx + alt.length);
      console.log('✅ Added likelihoodHtml to badges div (alt method)');
    } else {
      console.warn('⚠️  Could not find badges anchor — add ${likelihoodHtml} manually to the badges div');
    }
  } else {
    idx = idx.replace(badgesAnchor, patchBadgeInsert);
    console.log('✅ Added likelihoodHtml to badges div');
  }

  fs.writeFileSync(indexPath, idx);
  console.log('✅ index.html patched!');
}

console.log('\n🎉 All done! Now deploy:');
console.log('  git add -A');
console.log('  git commit -m "feat: add reservation likelihood badges"');
console.log('  git push');
