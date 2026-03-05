/**
 * RESERVATION LIKELIHOOD COLLECTOR
 * =================================
 * Scrapes Google reviews, Yelp reviews, photo velocity, and Popular Times
 * to build reservation difficulty profiles for each restaurant.
 *
 * RUN: GOOGLE_PLACES_API_KEY=xxx YELP_API_KEY=xxx node likelihood-collector.js
 *
 * If you don't have a Yelp API key, it still works — just skip Yelp data.
 * Get a free Yelp API key at: https://www.yelp.com/developers/v3/manage_app
 *
 * OUTPUT: reservation_likelihood.json
 *
 * This file is then loaded by search-candidates.js to power the
 * 🟢 High / 🟡 Medium / 🔴 Low likelihood badges.
 */

const fs = require('fs');
const path = require('path');

// Load .env
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
} catch (e) {}

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const YELP_KEY = process.env.YELP_API_KEY || null;

if (!GOOGLE_KEY) {
  console.error('❌ Missing GOOGLE_PLACES_API_KEY');
  process.exit(1);
}
if (!YELP_KEY) {
  console.warn('⚠️ No YELP_API_KEY — Yelp data will be skipped. Get one free at yelp.com/developers');
}

const SNAPSHOTS_FILE = path.join(__dirname, 'review_snapshots.json');
const LIKELIHOOD_FILE = path.join(__dirname, 'reservation_likelihood.json');
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const TODAY = new Date().toISOString().split('T')[0];

// ── Load existing data ──
let SNAPSHOTS = {};
try { SNAPSHOTS = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8')); } catch (e) {}

let EXISTING_LIKELIHOOD = {};
try { EXISTING_LIKELIHOOD = JSON.parse(fs.readFileSync(LIKELIHOOD_FILE, 'utf8')); } catch (e) {}

let BOOKING_LOOKUP = {};
try { BOOKING_LOOKUP = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); } catch (e) {}

let AVAILABILITY_DATA = {};
const AVAILABILITY_FILE = path.join(__dirname, 'availability_data.json');
try { AVAILABILITY_DATA = JSON.parse(fs.readFileSync(AVAILABILITY_FILE, 'utf8')); 
  const count = Object.keys(AVAILABILITY_DATA).filter(k => !k.startsWith('_')).length;
  if (count > 0) console.log(`✅ Availability data: ${count} restaurants`);
} catch (e) {}

// ── Concurrency helper ──
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

// ════════════════════════════════════════════════════════════════════
// NLP PHRASE MATCHING — Booking difficulty signals from review text
// ════════════════════════════════════════════════════════════════════

const HARD_TO_BOOK_PHRASES = [
  'hard to get a reservation', 'hard to get a table', 'hard to book',
  'impossible to book', 'impossible to get', 'impossible reservation',
  'booked weeks out', 'booked weeks in advance', 'booked months',
  'booked a month', 'booked two weeks', 'book well in advance',
  'finally got a table', 'finally got a reservation', 'finally got in',
  'waited weeks', 'waited months', 'waited forever',
  'set an alarm', 'set my alarm', 'alarm for reservations',
  'reservations sell out', 'sells out', 'sold out fast',
  'only got in after a cancellation', 'cancellation pickup',
  'impossible to get in', 'so hard to get in',
  'book early', 'book way ahead', 'book far in advance',
  'reservations go fast', 'gone in seconds', 'gone in minutes',
  'snag a reservation', 'snagged a last minute',
  'tough to get', 'tough reservation', 'good luck getting',
  'notoriously hard', 'notoriously difficult',
  'always booked', 'always full', 'always packed',
  'fully booked', 'completely booked', 'no availability',
  'tried for weeks', 'trying for months',
  'worth the wait', 'worth the hassle',
  'hot spot', 'hottest restaurant', 'hottest table',
  'most sought after', 'most coveted'
];

const EASY_TO_BOOK_PHRASES = [
  'walked right in', 'walk right in', 'walked in no problem',
  'no reservation needed', 'no reservations needed', 'no reservation necessary',
  'no wait', 'seated immediately', 'seated right away',
  'plenty of tables', 'plenty of room', 'plenty of space',
  'easy to book', 'easy to get a table', 'easy reservation',
  'same-day reservation', 'same day reservation', 'booked same day',
  'last minute reservation', 'last minute booking',
  'lots of availability', 'wide open', 'empty tables',
  'never had trouble', 'always available',
  'walk-in friendly', 'walk in friendly', 'welcomes walk-ins',
  'open seating', 'first come first serve'
];

const WAIT_TIME_PHRASES = [
  'waited an hour', 'waited 45 minutes', 'waited 30 minutes',
  'hour wait', 'long wait', 'wait was long', 'wait was insane',
  'line out the door', 'line around the block', 'huge line',
  'expect a wait', 'be prepared to wait'
];

const PEAK_TIME_PHRASES = [
  'friday night', 'saturday night', 'weekend', 'weekends are',
  'prime time', 'peak hours', 'dinner rush',
  'weekday is easier', 'weekdays are better', 'go on a weekday',
  'tuesday', 'wednesday', 'try a weeknight',
  'lunch is easier', 'brunch is packed', 'brunch wait'
];

const SIZE_INDICATOR_PHRASES = [
  // Small
  'tiny', 'small', 'intimate', 'cozy', 'cramped', 'tight space',
  'only a few tables', 'limited seating', 'counter seating',
  'counter seats', 'omakase', 'chef\'s counter', 'bar seating only',
  '10 seats', '12 seats', '15 seats', '8 seats', '20 seats',
  // Large
  'huge', 'spacious', 'massive', 'large dining room', 'big space',
  'multiple floors', 'two floors', 'upstairs', 'downstairs',
  'private dining', 'banquet', 'large parties'
];

function analyzeReviewText(reviews) {
  const allText = reviews.map(r => (r.text || '').toLowerCase()).join(' ');
  const recentText = reviews.slice(0, 20).map(r => (r.text || '').toLowerCase()).join(' ');

  // Count matches
  let hardCount = 0, easyCount = 0, waitCount = 0;
  let peakMentions = [], sizeSignals = [];

  for (const phrase of HARD_TO_BOOK_PHRASES) {
    const matches = (recentText.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    hardCount += matches;
  }

  for (const phrase of EASY_TO_BOOK_PHRASES) {
    const matches = (recentText.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    easyCount += matches;
  }

  for (const phrase of WAIT_TIME_PHRASES) {
    if (recentText.includes(phrase)) waitCount++;
  }

  for (const phrase of PEAK_TIME_PHRASES) {
    if (recentText.includes(phrase)) peakMentions.push(phrase);
  }

  // Size estimation from review text
  let sizeEstimate = 'medium'; // default
  const smallPhrases = ['tiny', 'small', 'intimate', 'cozy', 'cramped', 'tight space',
    'only a few tables', 'limited seating', 'counter seating', 'counter seats',
    'omakase', 'chef\'s counter', 'bar seating only'];
  const largePhrases = ['huge', 'spacious', 'massive', 'large dining room', 'big space',
    'multiple floors', 'two floors', 'upstairs', 'downstairs', 'private dining'];

  let smallSignals = 0, largeSignals = 0;
  for (const p of smallPhrases) { if (allText.includes(p)) smallSignals++; }
  for (const p of largePhrases) { if (allText.includes(p)) largeSignals++; }
  if (smallSignals > largeSignals + 1) sizeEstimate = 'small';
  else if (largeSignals > smallSignals + 1) sizeEstimate = 'large';

  return {
    hard_to_book_signals: hardCount,
    easy_to_book_signals: easyCount,
    wait_time_signals: waitCount,
    peak_mentions: [...new Set(peakMentions)],
    size_estimate: sizeEstimate,
    nlp_difficulty: hardCount > 0 ? (hardCount >= 3 ? 'high' : 'medium') : (easyCount >= 2 ? 'low' : 'unknown'),
    sample_size: reviews.length
  };
}

// ════════════════════════════════════════════════════════════════════
// GOOGLE REVIEWS FETCHER — Gets review text via Place Details
// ════════════════════════════════════════════════════════════════════

async function getGoogleReviews(placeId) {
  if (!placeId) return [];
  try {
    // New Places API - get reviews
    const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'reviews,photos'
      }
    });
    if (!resp.ok) return [];
    const data = await resp.json();

    const reviews = (data.reviews || []).map(r => ({
      text: r.text?.text || '',
      rating: r.rating || 0,
      time: r.publishTime || '',
      source: 'google'
    }));

    const photoCount = (data.photos || []).length;

    return { reviews, photoCount };
  } catch (e) {
    return { reviews: [], photoCount: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════
// YELP REVIEWS FETCHER — Gets reviews + business info
// ════════════════════════════════════════════════════════════════════

async function getYelpData(name, lat, lng) {
  if (!YELP_KEY || !name) return { reviews: [], yelpRating: null, yelpReviewCount: null, priceLevel: null };

  try {
    // Step 1: Find business on Yelp
    const searchUrl = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(name + ' restaurant')}&latitude=${lat}&longitude=${lng}&limit=3&sort_by=best_match`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${YELP_KEY}` }
    });
    if (!searchResp.ok) return { reviews: [], yelpRating: null, yelpReviewCount: null, priceLevel: null };
    const searchData = await searchResp.json();

    // Find best match by name
    const businesses = searchData.businesses || [];
    if (!businesses.length) return { reviews: [], yelpRating: null, yelpReviewCount: null, priceLevel: null };

    const nameLower = name.toLowerCase().trim();
    let match = businesses[0]; // default to first
    for (const b of businesses) {
      if (b.name.toLowerCase().trim() === nameLower) { match = b; break; }
      if (b.name.toLowerCase().includes(nameLower) || nameLower.includes(b.name.toLowerCase())) { match = b; }
    }

    const bizId = match.id;
    const yelpRating = match.rating || null;
    const yelpReviewCount = match.review_count || null;
    const priceLevel = match.price ? match.price.length : null; // "$" = 1, "$$" = 2, etc.

    // Step 2: Get reviews
    const reviewUrl = `https://api.yelp.com/v3/businesses/${bizId}/reviews?limit=20&sort_by=newest`;
    const reviewResp = await fetch(reviewUrl, {
      headers: { 'Authorization': `Bearer ${YELP_KEY}` }
    });

    let reviews = [];
    if (reviewResp.ok) {
      const reviewData = await reviewResp.json();
      reviews = (reviewData.reviews || []).map(r => ({
        text: r.text || '',
        rating: r.rating || 0,
        time: r.time_created || '',
        source: 'yelp'
      }));
    }

    return { reviews, yelpRating, yelpReviewCount, priceLevel };
  } catch (e) {
    return { reviews: [], yelpRating: null, yelpReviewCount: null, priceLevel: null };
  }
}

// ════════════════════════════════════════════════════════════════════
// PLATFORM BEHAVIOR SCORING
// ════════════════════════════════════════════════════════════════════

function getPlatformBehavior(bookingPlatform) {
  const behaviors = {
    'resy': {
      platform: 'resy',
      inventory_type: 'drops',           // releases at specific times
      cancellation_churn: 'medium',       // cancellations do appear
      bot_competition: 'high',            // alerts and bots common
      difficulty_modifier: 1.2            // 20% harder than baseline
    },
    'tock': {
      platform: 'tock',
      inventory_type: 'prepaid',          // mostly prepaid = low churn
      cancellation_churn: 'low',          // people don't cancel prepaid
      bot_competition: 'medium',
      difficulty_modifier: 1.4            // 40% harder (inventory is locked)
    },
    'opentable': {
      platform: 'opentable',
      inventory_type: 'rolling',          // continuous availability
      cancellation_churn: 'high',         // free cancellations = more churn
      bot_competition: 'low',
      difficulty_modifier: 0.85           // 15% easier (cancellations help)
    },
    'walkin': {
      platform: 'walkin',
      inventory_type: 'first_come',
      cancellation_churn: 'none',
      bot_competition: 'none',
      difficulty_modifier: 0.6            // much easier
    }
  };
  return behaviors[bookingPlatform] || {
    platform: 'unknown',
    inventory_type: 'unknown',
    cancellation_churn: 'unknown',
    bot_competition: 'unknown',
    difficulty_modifier: 1.0
  };
}

// ════════════════════════════════════════════════════════════════════
// COMPUTE RESERVATION LIKELIHOOD SCORE
// ════════════════════════════════════════════════════════════════════

function computeLikelihoodProfile(restaurant) {
  const {
    name, rating, reviewCount, velocity,
    nlpAnalysis, platformBehavior, sizeEstimate,
    isMichelin, photoCount, yelpRating, yelpReviewCount
  } = restaurant;

  // ── BASE DEMAND SCORE (0-100) ──
  // Higher = more demand = harder to book

  let demandScore = 0;

  // 1. Review velocity contribution (0-35 points)
  if (velocity && velocity.growth30 != null) {
    if (velocity.growth30 >= 80) demandScore += 35;       // blowing up
    else if (velocity.growth30 >= 50) demandScore += 28;   // very hot
    else if (velocity.growth30 >= 25) demandScore += 20;   // trending
    else if (velocity.growth30 >= 10) demandScore += 12;   // moderate
    else demandScore += 5;                                  // steady
  } else {
    // No velocity data — estimate from review count
    if (reviewCount > 2000) demandScore += 15;
    else if (reviewCount > 500) demandScore += 10;
    else if (reviewCount > 100) demandScore += 5;
  }

  // 2. Rating contribution (0-15 points)
  if (rating >= 4.8) demandScore += 15;
  else if (rating >= 4.6) demandScore += 12;
  else if (rating >= 4.4) demandScore += 8;
  else demandScore += 3;

  // 3. NLP difficulty signals (0-25 points)
  if (nlpAnalysis) {
    const hardSignals = nlpAnalysis.hard_to_book_signals || 0;
    const easySignals = nlpAnalysis.easy_to_book_signals || 0;
    const waitSignals = nlpAnalysis.wait_time_signals || 0;

    demandScore += Math.min(15, hardSignals * 4);    // up to 15 from hard phrases
    demandScore += Math.min(5, waitSignals * 2);     // up to 5 from wait mentions
    demandScore -= Math.min(10, easySignals * 3);    // subtract for easy signals
  }

  // 4. Michelin / prestige (0-10 points)
  if (isMichelin) demandScore += 10;

  // 5. Platform modifier
  const platformMod = platformBehavior?.difficulty_modifier || 1.0;
  demandScore = Math.round(demandScore * platformMod);

  // 6. Size modifier (0-15 points)
  const size = nlpAnalysis?.size_estimate || sizeEstimate || 'medium';
  if (size === 'small') demandScore += 15;        // small = much harder
  else if (size === 'large') demandScore -= 8;    // large = easier

  // 7. Photo velocity bonus (social hype indicator)
  if (photoCount && photoCount >= 10) demandScore += 5;

  // 8. Cross-platform confirmation (Yelp agrees it's popular)
  if (yelpRating && yelpRating >= 4.5 && yelpReviewCount && yelpReviewCount >= 200) {
    demandScore += 5;
  }

  // 9. REAL AVAILABILITY DATA (strongest signal when available)
  const availKey = (restaurant.name || '').toLowerCase().trim();
  const availData = AVAILABILITY_DATA[availKey];
  let availabilityInfo = null;
  if (availData && availData.availability_demand_points != null) {
    demandScore += availData.availability_demand_points; // 0-30 points
    availabilityInfo = {
      tier: availData.availability_tier,
      total_slots: availData.total_slots,
      dinner_slots: availData.dinner_slots,
      prime_slots: availData.prime_slots,
      last_checked: availData.last_checked,
      history_length: (availData.check_history || []).length
    };
  }

  // Clamp to 0-100
  demandScore = Math.max(0, Math.min(100, demandScore));

  // ── CONVERT TO LIKELIHOOD TIERS ──
  // Higher demand = LOWER likelihood of getting a reservation
  let baseTier, baseLabel;
  if (demandScore >= 70) { baseTier = 'very_low'; baseLabel = 'Very Hard to Book'; }
  else if (demandScore >= 55) { baseTier = 'low'; baseLabel = 'Hard to Book'; }
  else if (demandScore >= 35) { baseTier = 'medium'; baseLabel = 'Moderate'; }
  else if (demandScore >= 15) { baseTier = 'high'; baseLabel = 'Good Chance'; }
  else { baseTier = 'very_high'; baseLabel = 'Easy to Book'; }

  // ── BUILD REASONS ──
  const reasons = [];

  if (velocity && velocity.growth30 >= 50) reasons.push('Very high recent buzz');
  else if (velocity && velocity.growth30 >= 25) reasons.push('Trending now');

  if (nlpAnalysis && nlpAnalysis.hard_to_book_signals >= 3) reasons.push('Reviews mention booking difficulty');
  else if (nlpAnalysis && nlpAnalysis.hard_to_book_signals >= 1) reasons.push('Some reviews note limited availability');

  if (nlpAnalysis && nlpAnalysis.easy_to_book_signals >= 2) reasons.push('Reviews suggest easy availability');

  if (isMichelin) reasons.push('Michelin-recognized (high demand)');

  if (size === 'small') reasons.push('Small/intimate venue');
  else if (size === 'large') reasons.push('Large dining room');

  if (platformBehavior) {
    if (platformBehavior.platform === 'tock') reasons.push('Tock (prepaid, limited cancellations)');
    else if (platformBehavior.platform === 'resy') reasons.push('Resy (timed drops, competitive)');
    else if (platformBehavior.platform === 'opentable') reasons.push('OpenTable (rolling availability)');
  }

  if (nlpAnalysis && nlpAnalysis.wait_time_signals >= 2) reasons.push('Long waits reported');

  // Availability data reasons
  if (availabilityInfo) {
    if (availabilityInfo.tier === 'sold_out') reasons.unshift('Sold out for checked date');
    else if (availabilityInfo.tier === 'nearly_full') reasons.unshift('Nearly full — very few slots');
    else if (availabilityInfo.tier === 'limited') reasons.push('Limited availability');
    else if (availabilityInfo.tier === 'available') reasons.push('Good availability detected');
  }

  return {
    demand_score: demandScore,
    base_tier: baseTier,
    base_label: baseLabel,
    reasons: reasons.slice(0, 5), // max 5 reasons
    availability: availabilityInfo,
    nlp: nlpAnalysis ? {
      hard_signals: nlpAnalysis.hard_to_book_signals,
      easy_signals: nlpAnalysis.easy_to_book_signals,
      wait_signals: nlpAnalysis.wait_time_signals,
      size_estimate: nlpAnalysis.size_estimate,
      difficulty: nlpAnalysis.nlp_difficulty,
      sample_size: nlpAnalysis.sample_size
    } : null,
    platform: platformBehavior ? {
      name: platformBehavior.platform,
      inventory_type: platformBehavior.inventory_type,
      churn: platformBehavior.cancellation_churn
    } : null,
    velocity_growth30: velocity?.growth30 || null,
    photo_count: photoCount || 0,
    yelp: (yelpRating || yelpReviewCount) ? { rating: yelpRating, reviews: yelpReviewCount } : null,
    last_updated: TODAY
  };
}

// ════════════════════════════════════════════════════════════════════
// TIME-BASED ADJUSTMENT (exported for frontend use)
// This is a MODIFIER table — the frontend multiplies base score by this
// ════════════════════════════════════════════════════════════════════

const TIME_MODIFIERS = {
  // These get written into the JSON so the frontend can use them
  // Format: { dayType: { timeSlot: modifier } }
  // modifier > 1 = harder, < 1 = easier
  peak: {      // Fri, Sat
    early_lunch: 0.7,     // 11:00-12:00
    lunch: 0.85,          // 12:00-14:00
    afternoon: 0.5,       // 14:00-17:00
    early_dinner: 0.9,    // 17:00-18:30
    prime_dinner: 1.3,    // 18:30-20:30  ← HARDEST
    late_dinner: 0.95,    // 20:30-22:00
    late_night: 0.6       // 22:00+
  },
  moderate: {  // Wed, Thu, Sun
    early_lunch: 0.5,
    lunch: 0.65,
    afternoon: 0.35,
    early_dinner: 0.7,
    prime_dinner: 1.0,    // baseline
    late_dinner: 0.75,
    late_night: 0.45
  },
  easy: {      // Mon, Tue
    early_lunch: 0.35,
    lunch: 0.5,
    afternoon: 0.25,
    early_dinner: 0.5,
    prime_dinner: 0.75,
    late_dinner: 0.55,
    late_night: 0.3
  }
};

// Party size modifiers
const PARTY_SIZE_MODIFIERS = {
  1: 0.7,    // solo = easiest
  2: 0.85,   // couple = easy
  3: 1.0,    // baseline
  4: 1.0,    // baseline
  5: 1.15,   // starts getting harder
  6: 1.3,    // large party
  7: 1.5,
  8: 1.7,    // very hard
  9: 1.9,
  10: 2.0    // 10+ = extremely hard
};

// ════════════════════════════════════════════════════════════════════
// MAIN COLLECTOR
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🎯 RESERVATION LIKELIHOOD COLLECTOR');
  console.log(`📅 Date: ${TODAY}`);
  console.log(`🔑 Google API: ✅`);
  console.log(`🔑 Yelp API: ${YELP_KEY ? '✅' : '❌ (skipping Yelp data)'}`);
  console.log('─────────────────────────────────────\n');

  // Get all restaurants from snapshots
  const restaurants = Object.entries(SNAPSHOTS).filter(([pid, data]) => {
    return data.name && data.lat && data.lng && pid !== '_README';
  });

  console.log(`📂 Processing ${restaurants.length} restaurants from snapshots...\n`);

  if (restaurants.length === 0) {
    console.log('❌ No restaurants in review_snapshots.json. Run snapshot-collector.js first.');
    process.exit(1);
  }

  const likelihood = { ...EXISTING_LIKELIHOOD };
  let processed = 0, errors = 0;
  let googleReviewsTotal = 0, yelpReviewsTotal = 0;

  // Process in batches of 3 (to avoid rate limits)
  await runWithConcurrency(restaurants, 3, async ([placeId, data]) => {
    try {
      const name = data.name;
      const lat = data.lat;
      const lng = data.lng;

      // Skip if recently processed (within 7 days)
      const existing = likelihood[placeId];
      if (existing && existing.last_updated) {
        const daysSince = (new Date(TODAY) - new Date(existing.last_updated)) / 86400000;
        if (daysSince < 7) {
          processed++;
          return;
        }
      }

      // Get velocity from snapshots
      let velocity = null;
      if (data.snapshots && data.snapshots.length >= 2) {
        const latest = data.snapshots[data.snapshots.length - 1];
        const oldest = data.snapshots[0];
        const days = Math.max(1, (new Date(latest.date) - new Date(oldest.date)) / 86400000);
        const growth = latest.review_count - oldest.review_count;
        velocity = {
          growth30: Math.round((growth / days) * 30),
          daysTracked: Math.round(days),
          latestCount: latest.review_count,
          latestRating: latest.rating
        };
      }

      const latestSnapshot = data.snapshots?.[data.snapshots.length - 1] || {};
      const rating = latestSnapshot.rating || 0;
      const reviewCount = latestSnapshot.review_count || 0;

      // ── Fetch Google reviews ──
      process.stdout.write(`  📖 ${name}...`);
      const googleData = await getGoogleReviews(placeId);
      const googleReviews = googleData.reviews || [];
      const photoCount = googleData.photoCount || 0;
      googleReviewsTotal += googleReviews.length;

      // ── Fetch Yelp reviews ──
      let yelpData = { reviews: [], yelpRating: null, yelpReviewCount: null, priceLevel: null };
      if (YELP_KEY) {
        yelpData = await getYelpData(name, lat, lng);
        yelpReviewsTotal += yelpData.reviews.length;
      }

      // ── Combine reviews for NLP ──
      const allReviews = [...googleReviews, ...yelpData.reviews];

      // ── Run NLP analysis ──
      const nlpAnalysis = analyzeReviewText(allReviews);

      // ── Get platform behavior ──
      const bookingKey = name.toLowerCase().trim();
      const bookingInfo = BOOKING_LOOKUP[bookingKey] || BOOKING_LOOKUP[bookingKey.replace(/^the\s+/, '')] || null;
      const platform = bookingInfo?.platform || null;
      const platformBehavior = getPlatformBehavior(platform);

      // ── Check if Michelin ──
      // (Simple check — relies on naming. In production you'd cross-reference michelin_nyc.json)
      const isMichelin = false; // Will be enriched later by search-candidates.js

      // ── Compute likelihood profile ──
      const profile = computeLikelihoodProfile({
        name, rating, reviewCount, velocity,
        nlpAnalysis, platformBehavior,
        sizeEstimate: nlpAnalysis.size_estimate,
        isMichelin, photoCount,
        yelpRating: yelpData.yelpRating,
        yelpReviewCount: yelpData.yelpReviewCount
      });

      likelihood[placeId] = {
        name,
        ...profile
      };

      const tierEmoji = { very_low: '🔴', low: '🟠', medium: '🟡', high: '🟢', very_high: '🟢' };
      console.log(` ${tierEmoji[profile.base_tier] || '⚪'} ${profile.base_label} (score: ${profile.demand_score}) | G:${googleReviews.length} Y:${yelpData.reviews.length} reviews`);

      processed++;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      console.log(` ❌ Error: ${e.message}`);
      errors++;
    }
  });

  // Add time modifiers and party size modifiers to the output
  likelihood._time_modifiers = TIME_MODIFIERS;
  likelihood._party_size_modifiers = PARTY_SIZE_MODIFIERS;
  likelihood._meta = {
    last_run: TODAY,
    restaurants_processed: processed,
    errors: errors,
    google_reviews_analyzed: googleReviewsTotal,
    yelp_reviews_analyzed: yelpReviewsTotal
  };

  // Save
  fs.writeFileSync(LIKELIHOOD_FILE, JSON.stringify(likelihood, null, 2));

  // Stats
  const tiers = { very_low: 0, low: 0, medium: 0, high: 0, very_high: 0 };
  for (const [pid, data] of Object.entries(likelihood)) {
    if (pid.startsWith('_')) continue;
    if (data.base_tier) tiers[data.base_tier]++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 RESULTS:');
  console.log(`   Processed:        ${processed} restaurants`);
  console.log(`   Errors:           ${errors}`);
  console.log(`   Google reviews:   ${googleReviewsTotal} analyzed`);
  console.log(`   Yelp reviews:     ${yelpReviewsTotal} analyzed`);
  console.log(`\n   🔴 Very Hard:     ${tiers.very_low}`);
  console.log(`   🟠 Hard:          ${tiers.low}`);
  console.log(`   🟡 Moderate:      ${tiers.medium}`);
  console.log(`   🟢 Good Chance:   ${tiers.high}`);
  console.log(`   🟢 Easy:          ${tiers.very_high}`);
  console.log(`\n💾 Saved to ${LIKELIHOOD_FILE}`);
  console.log('✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
