#!/bin/bash
# patch_likelihood.sh — Add reservation likelihood to search-candidates.js
# Usage: cd ~/ai-concierge- && bash patch_likelihood.sh

set -e
FILE="netlify/functions/search-candidates.js"

# 1) Ensure reservation-likelihood.js is in netlify/functions/
if [ ! -f "netlify/functions/reservation-likelihood.js" ]; then
  if [ -f "reservation-likelihood.js" ]; then
    cp reservation-likelihood.js netlify/functions/
    echo "📦 Copied reservation-likelihood.js → netlify/functions/"
  else
    echo "❌ reservation-likelihood.js not found!"
    exit 1
  fi
fi

# 2) Skip if already patched
if grep -q "reservation-likelihood" "$FILE"; then
  echo "⚠️  Already patched!"
  exit 0
fi

# 3) Backup
cp "$FILE" "${FILE}.bak"
echo "💾 Backup → ${FILE}.bak"

# 4) PATCH A: Add require + helpers after "let BOOKING_KEYS = [];"
#    We insert right after the line containing "BOOKING_KEYS = Object.keys"
INSERT_AFTER=$(grep -n "BOOKING_KEYS = Object.keys" "$FILE" | tail -1 | cut -d: -f1)
# Go 2 lines past that (to get past the catch block)
INSERT_AFTER=$((INSERT_AFTER + 2))

sed -i '' "${INSERT_AFTER}a\\
\\
// ── RESERVATION LIKELIHOOD ──────────────────────────────────────\\
const likelihood = require('./reservation-likelihood');\\
let LIKELIHOOD_CAL = null;\\
function getLikelihoodCalibration() {\\
  if (LIKELIHOOD_CAL) return LIKELIHOOD_CAL;\\
  const allForCal = [], seenCal = new Set();\\
  const addCal = (arr, transform) => {\\
    for (const r of (arr || [])) {\\
      if (!r || !r.name) continue;\\
      const key = (r.name || '').toLowerCase().trim();\\
      if (seenCal.has(key)) continue; seenCal.add(key);\\
      allForCal.push(transform ? transform(r) : {\\
        name: r.name, googleRating: r.googleRating || r.rating || 0,\\
        googleReviewCount: r.googleReviewCount || r.user_ratings_total || 0,\\
        price_level: r.price_level || null, michelin: r.michelin || null,\\
        formatted_address: r.address || r.formatted_address || '',\\
        booking_platform: r.booking_platform || null, booking_url: r.booking_url || null,\\
        cuisine: r.cuisine || null, types: r.types || []\\
      });\\
    }\\
  };\\
  addCal(POPULAR_BASE);\\
  addCal(MICHELIN_BASE, m => ({\\
    name: m.name, googleRating: m.googleRating || 0, googleReviewCount: m.googleReviewCount || 0,\\
    price_level: m.price_level || null, michelin: { stars: m.stars||0, distinction: m.distinction||'star' },\\
    formatted_address: m.address || '', booking_platform: m.booking_platform || null,\\
    booking_url: m.booking_url || null, cuisine: m.cuisine || null, types: []\\
  }));\\
  addCal(BIB_GOURMAND_BASE, b => ({\\
    name: b.name, googleRating: b.googleRating || 0, googleReviewCount: b.googleReviewCount || 0,\\
    price_level: b.price_level || null, michelin: { stars: 0, distinction: 'bib_gourmand' },\\
    formatted_address: b.address || '', booking_platform: b.booking_platform || null,\\
    booking_url: b.booking_url || null, cuisine: b.cuisine || null, types: []\\
  }));\\
  addCal(CHASE_SAPPHIRE_BASE);\\
  addCal(RAKUTEN_BASE);\\
  for (const r of allForCal) {\\
    if (!r.booking_platform) {\\
      const info = getBookingInfo(r.name);\\
      if (info) { r.booking_platform = info.platform; r.booking_url = info.url; }\\
    }\\
  }\\
  console.log('📊 Likelihood: calibrating ' + allForCal.length + ' restaurants');\\
  LIKELIHOOD_CAL = likelihood.calibrate(allForCal);\\
  return LIKELIHOOD_CAL;\\
}\\
function attachLikelihoodEstimates(restaurants, scenario) {\\
  if (!restaurants || !restaurants.length) return;\\
  const cal = getLikelihoodCalibration();\\
  const sc = scenario || { dayOfWeek: 'tuesday', timeWindow: ['18:00', '20:00'], partySize: 2 };\\
  for (const r of restaurants) {\\
    const est = likelihood.computeLikelihood(r, sc, cal);\\
    r.reservationEstimate = {\\
      likelihood: est.likelihood, reason: est.reason,\\
      suggestion: est.suggestion, reservationType: est.reservationType,\\
      _likelihoodScore: est.likelihoodScore\\
    };\\
  }\\
}\\
// ── END RESERVATION LIKELIHOOD ──────────────────────────────────
" "$FILE"

echo "✅ Added likelihood model + calibration helper"

# 5) PATCH B: Attach estimates before the final sort
#    Insert before "const sortFn = "
SORT_LINE=$(grep -n "const sortFn = " "$FILE" | tail -1 | cut -d: -f1)

sed -i '' "$((SORT_LINE))i\\
\\
    // Attach reservation likelihood estimates\\
    attachLikelihoodEstimates(visibleRestaurants);\\
    console.log('✅ Likelihood: ' + visibleRestaurants.length + ' restaurants scored');\\
" "$FILE"

echo "✅ Added likelihood scoring before sort"
echo ""
echo "🎉 Done! Now:"
echo "  git add -A"
echo "  git commit -m 'feat: add reservation likelihood estimates'"
echo "  git push"
