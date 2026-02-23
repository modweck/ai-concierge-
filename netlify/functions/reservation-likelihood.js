/**
 * Seatwize Dining — Reservation Likelihood Estimator v3.1
 *
 * Estimate-only model. No live availability, no scraping, no booking APIs.
 *
 * v3.1 CHANGES:
 * - reservationType: likely_reservable / maybe_reservable / walk_in_only
 * - walk_in_only excluded from calibration universe
 * - walk_in_only gets "Walk-in focused" label, not High/Medium/Low
 * - Fixed missing price_level handling (default 0.95, not 1.0)
 * - Buzz multipliers only fire if buzzLinks/buzz_links array actually exists
 * - Michelin multipliers only fire if michelin object actually exists with data
 * - printCalibrationReport uses reservationType() properly
 */

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {

  popularity: {
    ratingFloor: 4.0,
    ratingCeiling: 5.0,
    reviewLogCap: 4.2,
    reviewWeight: 0.65,
    ratingWeight: 0.35
  },

  dayMultipliers: {
    sunday: 1.15, monday: 0.85, tuesday: 0.90, wednesday: 0.95,
    thursday: 1.05, friday: 1.25, saturday: 1.35
  },

  timeBuckets: [
    { start: 0,  mult: 0.65 },
    { start: 7,  mult: 0.70 },
    { start: 11, mult: 0.85 },
    { start: 14, mult: 0.75 },
    { start: 16, mult: 0.80 },
    { start: 17, mult: 0.90 },
    { start: 18, mult: 1.25 },
    { start: 19, mult: 1.35 },
    { start: 20, mult: 1.10 },
    { start: 21, mult: 0.85 },
    { start: 22, mult: 0.75 }
  ],

  partyMultipliers: [
    { max: 2, mult: 1.00 },
    { max: 4, mult: 1.12 },
    { max: 6, mult: 1.28 },
    { max: Infinity, mult: 1.50 }
  ],

  // price_level mapping — null/undefined → 0.95 (slight discount, not neutral)
  priceMultipliers: { 1: 0.92, 2: 1.00, 3: 1.12, 4: 1.22 },
  priceMissingDefault: 0.95,

  formatKeywords: {
    hard: [
      { pattern: /omakase/i, mult: 1.25, label: 'omakase format' },
      { pattern: /sushi (counter|bar)/i, mult: 1.20, label: 'sushi counter' },
      { pattern: /chef.?s (table|counter)/i, mult: 1.25, label: "chef's counter" },
      { pattern: /tasting menu/i, mult: 1.22, label: 'tasting menu' },
      { pattern: /prix.?fixe/i, mult: 1.22, label: 'prix fixe' },
      { pattern: /kaiseki/i, mult: 1.25, label: 'kaiseki' },
      { pattern: /kappo/i, mult: 1.20, label: 'kappo' }
    ],
    easy: [
      { pattern: /brasserie/i, mult: 0.93, label: 'large brasserie' },
      { pattern: /steakhouse|steak house/i, mult: 0.95, label: 'steakhouse (larger room)' },
      { pattern: /diner/i, mult: 0.90, label: 'diner format' },
      { pattern: /all.?day/i, mult: 0.92, label: 'all-day restaurant' },
      { pattern: /hotel restaurant/i, mult: 0.93, label: 'hotel restaurant' },
      { pattern: /food hall/i, mult: 0.88, label: 'food hall' },
      { pattern: /buffet/i, mult: 0.85, label: 'buffet' }
    ]
  },

  // Michelin — only applied if restaurant.michelin exists with stars or distinction
  michelinMultipliers: {
    3: 1.25, 2: 1.22, 1: 1.20,
    bib_gourmand: 1.10, bib: 1.10, recommended: 1.07
  },

  // Buzz — only applied if restaurant.buzzLinks or .buzz_links is a non-empty array
  buzzMultipliers: { eater: 1.05, infatuation: 1.05, grubstreet: 1.03, timeout: 1.03 },
  buzzCap: 1.12,

  boroughMultipliers: {
    manhattan: 1.05, brooklyn: 1.00, queens: 0.97, bronx: 0.95, 'staten island': 0.95
  },

  // Walk-in keyword patterns (matched against restaurant name)
  walkinKeywords: /\b(pizza|pizzeria|ramen|taco|tacos|taqueria|bagel|bakery|cafe|café|deli|express|food truck|food cart|halal|falafel|pho|banh mi|dumpling|noodle shop|juice|smoothie|bubble tea|boba|froyo|frozen yogurt|hot dog|pretzel|crepe|waffle)\b/i,

  knownHardOverrides: {
    'carbone': 1.15, 'don angie': 1.12, 'via carota': 1.12,
    'i sodi': 1.15, 'torrisi': 1.20, 'lilia': 1.10, 'tatiana': 1.10,
    '4 charles prime rib': 1.15, 'lucali': 1.15, 'atomix': 1.20,
    'masa': 1.20, 'per se': 1.15, 'eleven madison park': 1.15,
    'le bernardin': 1.10, 'sushi noz': 1.18, 'odo': 1.15, 'atera': 1.18
  },

  buckets: {
    highCeiling: 40,
    lowFloor: 75
  },

  confidence: {
    minReviewsForFull: 100,
    missingPricePenalty: 0.20,   // increased from 0.15
    missingBookingPenalty: 0.10,
    lowReviewCompress: 0.25
  }
};

// ============================================================
// UI COPY — LOCKED FOR v1. Do not change without product review.
// ============================================================

const UI_COPY = {
  High: {
    label: 'High likelihood',
    subtitle: 'Good odds for this time window'
  },
  Medium: {
    label: 'Medium likelihood',
    subtitle: 'May require flexibility'
  },
  Low: {
    label: 'Low likelihood',
    subtitle: 'Hard to get at peak times',
    tip: 'Try earlier or later for better odds.'
  },
  'Walk-in focused': {
    label: 'Walk-in focused',
    subtitle: 'Appears walk-in focused (no reservation signals).'
  },
  tooltip: 'Seatwize estimate based on popularity and typical demand. Not real-time availability.',
  sortLabel: 'Best chance to book'
};

// ============================================================
// HELPERS
// ============================================================

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function normDay(d) {
  if (typeof d === 'number') return DAY_NAMES[d] || 'tuesday';
  return String(d).toLowerCase().trim();
}

function parseHour(t) {
  if (typeof t === 'number') return t;
  const s = String(t).trim().toLowerCase();
  const ampm = s.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (ampm) { let h = parseInt(ampm[1]); if (ampm[3].toLowerCase()==='pm' && h<12) h+=12; if (ampm[3].toLowerCase()==='am' && h===12) h=0; return h; }
  const mil = s.match(/^(\d{1,2}):(\d{2})$/);
  if (mil) return parseInt(mil[1]);
  return parseInt(s) || 19;
}

function getTimeMult(hour) {
  let m = 0.65;
  for (const b of CONFIG.timeBuckets) { if (hour >= b.start) m = b.mult; }
  return m;
}

function detectBorough(r) {
  const addr = String(r.formatted_address || r.vicinity || r.address || '').toLowerCase();
  if (addr.includes('brooklyn')) return 'brooklyn';
  if (addr.includes('queens')) return 'queens';
  if (addr.includes('bronx')) return 'bronx';
  if (addr.includes('staten island')) return 'staten island';
  if (addr.includes('manhattan') || addr.includes('new york, ny')) return 'manhattan';
  const zip = addr.match(/\b(1\d{4})\b/);
  if (zip) {
    const z = parseInt(zip[1]);
    if (z >= 10001 && z <= 10282) return 'manhattan';
    if (z >= 11201 && z <= 11256) return 'brooklyn';
    if ((z >= 11101 && z <= 11109) || (z >= 11351 && z <= 11697)) return 'queens';
    if (z >= 10451 && z <= 10475) return 'bronx';
    if (z >= 10301 && z <= 10314) return 'staten island';
  }
  return 'unknown';
}

// ============================================================
// RESERVATION TYPE CLASSIFICATION
// ============================================================

/**
 * Classify a restaurant's reservation type.
 * @returns 'likely_reservable' | 'maybe_reservable' | 'walk_in_only'
 */
function reservationType(restaurant) {
  const hasBooking = !!(restaurant.booking_platform || restaurant.booking_url);
  const price = (restaurant.price_level != null) ? Number(restaurant.price_level) : null;
  const reviews = Number(restaurant.googleReviewCount || restaurant.user_ratings_total || 0);
  const name = String(restaurant.name || '').toLowerCase();

  // A) Has booking link → likely reservable
  if (hasBooking) return 'likely_reservable';

  // B) High-end with decent reviews → likely reservable
  if (price !== null && price >= 3 && reviews >= 300) return 'likely_reservable';

  // C) Mid-range with strong reviews → maybe reservable
  if (price === 2 && reviews >= 800) return 'maybe_reservable';

  // D) Walk-in keywords + no booking + low price + modest reviews -> walk-in only
  if (CONFIG.walkinKeywords.test(name) && (price === null || price <= 2) && reviews < 1200) return 'walk_in_only';

  // E) Default → maybe reservable
  return 'maybe_reservable';
}

// ============================================================
// SIGNAL FUNCTIONS
// ============================================================

function computePopularity(rating, reviewCount) {
  const c = CONFIG.popularity;
  const ratingScore = clamp((Number(rating||0) - c.ratingFloor) / (c.ratingCeiling - c.ratingFloor), 0, 1);
  const reviewsScore = clamp(Math.log10(Number(reviewCount||0) + 1) / c.reviewLogCap, 0, 1);
  return c.reviewWeight * reviewsScore + c.ratingWeight * ratingScore;
}

function computeDemandMult(dayOfWeek, timeWindow) {
  const day = normDay(dayOfWeek);
  const dayMult = CONFIG.dayMultipliers[day] || 1.0;
  let timeMult;
  if (Array.isArray(timeWindow) && timeWindow.length === 2) {
    const s = parseHour(timeWindow[0]), e = parseHour(timeWindow[1]);
    if (e <= s) { timeMult = getTimeMult(s); }
    else { let sum=0, n=0; for (let h=s; h<e; h++) { sum+=getTimeMult(h); n++; } timeMult = n>0 ? sum/n : 1.0; }
  } else {
    timeMult = getTimeMult(parseHour(timeWindow));
  }
  return { dayMult, timeMult, combined: dayMult * timeMult };
}

function getPartyMult(size) {
  const s = Number(size) || 2;
  for (const t of CONFIG.partyMultipliers) { if (s <= t.max) return t.mult; }
  return 1.50;
}

function getPriceMult(priceLevel) {
  if (priceLevel == null || priceLevel === 0 || priceLevel === undefined) {
    return CONFIG.priceMissingDefault;
  }
  const p = Number(priceLevel);
  return CONFIG.priceMultipliers[p] || CONFIG.priceMissingDefault;
}

function getFormatMult(restaurant) {
  const txt = [restaurant.name||'', restaurant.cuisine||'', ...(restaurant.types||[])].join(' ').toLowerCase();
  let mult=1.0, label=null, hardMax=1.0;
  for (const kw of CONFIG.formatKeywords.hard) {
    if (kw.pattern.test(txt) && kw.mult > hardMax) { hardMax=kw.mult; label=kw.label; }
  }
  mult *= hardMax;
  if (hardMax === 1.0) {
    let easyMin=1.0;
    for (const kw of CONFIG.formatKeywords.easy) {
      if (kw.pattern.test(txt) && kw.mult < easyMin) { easyMin=kw.mult; label=kw.label; }
    }
    mult *= easyMin;
  }
  return { mult, label };
}

function getMichelinMult(restaurant) {
  const m = restaurant.michelin;
  // Only apply if michelin object actually exists with meaningful data
  if (!m || typeof m !== 'object') return { mult: 1.0, label: null };
  const stars = Number(m.stars) || 0;
  if (stars >= 1 && CONFIG.michelinMultipliers[stars]) {
    return { mult: CONFIG.michelinMultipliers[stars], label: `${stars}-star Michelin` };
  }
  const d = String(m.distinction||'').toLowerCase();
  if (d && CONFIG.michelinMultipliers[d]) {
    const lbl = { bib_gourmand:'Bib Gourmand', bib:'Bib Gourmand', recommended:'Michelin recommended' };
    return { mult: CONFIG.michelinMultipliers[d], label: lbl[d] || 'Michelin listed' };
  }
  return { mult: 1.0, label: null };
}

function getBuzzMult(restaurant) {
  // Only apply if buzzLinks is a real non-empty array
  const links = restaurant.buzzLinks || restaurant.buzz_links;
  if (!Array.isArray(links) || links.length === 0) return { mult: 1.0, count: 0 };
  let mult=1.0, count=0; const seen=new Set();
  for (const link of links) {
    const src = String(link.source||'').toLowerCase();
    if (!src || seen.has(src)) continue; seen.add(src);
    for (const [key, boost] of Object.entries(CONFIG.buzzMultipliers)) {
      if (src.includes(key)) { mult *= boost; count++; break; }
    }
  }
  return { mult: Math.min(mult, CONFIG.buzzCap), count };
}

function getBoroughMult(restaurant) {
  const borough = detectBorough(restaurant);
  return { mult: CONFIG.boroughMultipliers[borough] || 1.0, borough };
}

function normalizeForOverride(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^\w\s]/g, '')     // strip punctuation
    .replace(/\s+/g, ' ')        // collapse whitespace
    .replace(/^the\s+/, '');     // remove leading "the"
}

function getOverrideMult(restaurant) {
  const norm = normalizeForOverride(restaurant.name);
  if (!norm) return 1.0;
  for (const [key, mult] of Object.entries(CONFIG.knownHardOverrides)) {
    if (norm === key || norm.startsWith(key) || key.startsWith(norm)) return mult;
  }
  return 1.0;
}

// ============================================================
// CONFIDENCE
// ============================================================

function assessConfidence(restaurant) {
  const reviews = Number(restaurant.googleReviewCount || restaurant.user_ratings_total || 0);
  const price = restaurant.price_level;
  const hasBooking = !!(restaurant.booking_platform || restaurant.booking_url);

  let dampening = 0;
  const flags = [];

  if (reviews < CONFIG.confidence.minReviewsForFull) {
    dampening += CONFIG.confidence.lowReviewCompress;
    flags.push('low_reviews');
  }

  if (price == null || price === 0 || price === undefined) {
    dampening += CONFIG.confidence.missingPricePenalty;
    flags.push('no_price');
  }

  if (!hasBooking) {
    dampening += CONFIG.confidence.missingBookingPenalty;
    flags.push('no_booking');
  }

  dampening = Math.min(dampening, 0.45);
  return { dampening, flags, isLowConfidence: dampening > 0.15 };
}

function dampenPercentile(percentile, dampening) {
  if (dampening <= 0) return percentile;
  return percentile + (50 - percentile) * dampening;
}

// ============================================================
// CORE: computeDifficulty
// ============================================================

function computeDifficulty(restaurant, scenario) {
  const rating = Number(restaurant.googleRating || restaurant.rating || 0);
  const reviews = Number(restaurant.googleReviewCount || restaurant.user_ratings_total || 0);
  const popularity = computePopularity(rating, reviews);
  const demand = computeDemandMult(scenario.dayOfWeek, scenario.timeWindow || scenario.timeSlot);
  const partyMult = getPartyMult(scenario.partySize);
  const priceMult = getPriceMult(restaurant.price_level);
  const format = getFormatMult(restaurant);
  const michelin = getMichelinMult(restaurant);
  const buzz = getBuzzMult(restaurant);
  const borough = getBoroughMult(restaurant);
  const overrideMult = getOverrideMult(restaurant);
  const confidence = assessConfidence(restaurant);
  const resType = reservationType(restaurant);

  const difficultyRaw = popularity * demand.combined * partyMult * priceMult
    * format.mult * michelin.mult * buzz.mult * borough.mult * overrideMult;

  return {
    difficultyRaw,
    confidence,
    reservationType: resType,
    components: {
      popularity: Math.round(popularity*1000)/1000,
      dayMult: demand.dayMult, timeMult: Math.round(demand.timeMult*100)/100,
      demandMult: Math.round(demand.combined*100)/100,
      partyMult, priceMult,
      formatMult: format.mult, formatLabel: format.label,
      michelinMult: michelin.mult, michelinLabel: michelin.label,
      buzzMult: buzz.mult, buzzCount: buzz.count,
      boroughMult: borough.mult, borough: borough.borough,
      overrideMult, restaurantName: restaurant.name || 'Unknown'
    }
  };
}

// ============================================================
// CALIBRATION — excludes walk_in_only
// ============================================================

const CALIBRATION_SCENARIOS = {
  weekday_dinner: { dayOfWeek: 'tuesday', timeWindow: ['18:00', '20:00'], partySize: 2 },
  weekend_dinner: { dayOfWeek: 'saturday', timeWindow: ['18:00', '20:00'], partySize: 2 },
  off_peak:       { dayOfWeek: 'monday',   timeWindow: ['17:00', '18:00'], partySize: 2 }
};

function classifyScenario(scenario) {
  const day = normDay(scenario.dayOfWeek);
  const isWeekend = (day === 'friday' || day === 'saturday' || day === 'sunday');
  let peakHour;
  if (Array.isArray(scenario.timeWindow) && scenario.timeWindow.length === 2) {
    const s = parseHour(scenario.timeWindow[0]), e = parseHour(scenario.timeWindow[1]);
    peakHour = Math.floor((s + e) / 2);
  } else {
    peakHour = parseHour(scenario.timeWindow || scenario.timeSlot || 19);
  }
  const isDinner = peakHour >= 17 && peakHour <= 21;
  if (isWeekend && isDinner) return 'weekend_dinner';
  if (!isWeekend && isDinner) return 'weekday_dinner';
  return 'off_peak';
}

function calibrate(restaurants) {
  const all = restaurants || [];
  const calibration = {};
  let walkinCount = 0;
  let reservableCount = 0;

  // Pre-classify all restaurants
  const reservable = [];
  for (const r of all) {
    const rt = reservationType(r);
    if (rt === 'walk_in_only') {
      walkinCount++;
    } else {
      reservable.push(r);
      reservableCount++;
    }
  }

  for (const [key, scenario] of Object.entries(CALIBRATION_SCENARIOS)) {
    const scores = [];
    for (const r of reservable) {
      scores.push(computeDifficulty(r, scenario).difficultyRaw);
    }
    scores.sort((a, b) => a - b);
    calibration[key] = scores;
  }

  console.log(`📊 Calibration: ${all.length} total, ${reservableCount} reservable, ${walkinCount} walk-in only`);
  const wd = calibration.weekday_dinner;
  if (wd.length > 0) {
    const pct = (p) => wd[Math.floor(p/100*(wd.length-1))] || 0;
    console.log(`   Weekday dinner (reservable only): P25=${pct(25).toFixed(3)} P50=${pct(50).toFixed(3)} P75=${pct(75).toFixed(3)} P90=${pct(90).toFixed(3)}`);
  }

  return { scenarios: calibration, count: all.length, reservableCount, walkinCount };
}

// Rank-based percentile via binary search
function rankPercentile(score, sortedScores) {
  if (!sortedScores || sortedScores.length === 0) return 50;
  const n = sortedScores.length;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedScores[mid] < score) lo = mid + 1;
    else hi = mid;
  }
  return (lo / n) * 100;
}

// ============================================================
// PERCENTILE → LABEL + SCORE
// ============================================================

function percentileToLabel(percentile) {
  if (percentile <= CONFIG.buckets.highCeiling) return 'High';
  if (percentile <= CONFIG.buckets.lowFloor) return 'Medium';
  return 'Low';
}

function percentileToLikelihoodScore(percentile, label) {
  if (label === 'High') {
    const pos = percentile / CONFIG.buckets.highCeiling;
    return Math.round(90 - pos * 25);
  }
  if (label === 'Medium') {
    const range = CONFIG.buckets.lowFloor - CONFIG.buckets.highCeiling;
    const pos = (percentile - CONFIG.buckets.highCeiling) / range;
    return Math.round(64 - pos * 29);
  }
  const range = 100 - CONFIG.buckets.lowFloor;
  const pos = clamp((percentile - CONFIG.buckets.lowFloor) / range, 0, 1);
  return Math.round(34 - pos * 29);
}

// ============================================================
// REASON + SUGGESTION BUILDERS
// ============================================================

// v1 locked UI copy per label
const LABEL_COPY = {
  High:   'Good odds for this time window',
  Medium: 'May require flexibility',
  Low:    'Hard to get at peak times'
};

const TOOLTIP_TEXT = 'Seatwize estimate based on popularity and typical demand. Not real-time availability.';

function buildReason(comp, label, scenario) {
  // Primary line is the locked UI copy
  const primary = LABEL_COPY[label] || LABEL_COPY.Medium;

  // Build a short driver suffix for context (keep it brief)
  const drivers = [];
  if (comp.michelinLabel) drivers.push(comp.michelinLabel);
  if (comp.formatLabel && comp.formatMult > 1.1) drivers.push(comp.formatLabel);
  if (comp.popularity >= 0.7) drivers.push('very popular');
  if (comp.overrideMult > 1.0) drivers.push('tough reservation');
  if (comp.demandMult >= 1.4) {
    const d = normDay(scenario.dayOfWeek);
    drivers.push(`peak ${d.charAt(0).toUpperCase()+d.slice(1)}`);
  }
  if (comp.partyMult >= 1.25) drivers.push(`party of ${scenario.partySize}`);

  if (drivers.length === 0) return primary + '.';
  return primary + ' — ' + drivers.slice(0, 2).join(', ') + '.';
}

function buildSuggestion(label, scenario, comp) {
  if (label === 'High') return null;
  if (label === 'Low') return 'Try earlier or later for better odds.';
  // Medium: only suggest if there's a clear action
  if ((Number(scenario.partySize)||2) >= 5) return 'A smaller party may help.';
  if (comp.dayMult >= 1.20) return 'Weekday evenings are typically easier.';
  return null;
}

// ============================================================
// MAIN: computeLikelihood
// ============================================================

function computeLikelihood(restaurant, scenario, cal) {
  const { difficultyRaw, confidence, reservationType: resType, components } = computeDifficulty(restaurant, scenario);

  // Walk-in only → special output, skip scoring
  if (resType === 'walk_in_only') {
    return {
      likelihood: 'Walk-in focused',
      likelihoodScore: 50,
      reason: 'Appears walk-in focused (no reservation signals).',
      suggestion: null,
      reservationType: resType,
      debug: {
        difficultyRaw: Math.round(difficultyRaw * 10000) / 10000,
        scenarioKey: classifyScenario(scenario),
        rawPercentile: null,
        dampenedPercentile: null,
        confidenceDampening: confidence.dampening,
        confidenceFlags: confidence.flags,
        reservationType: resType,
        ...components
      }
    };
  }

  // Reservable restaurants → rank-based percentile against reservable-only calibration
  const scenarioKey = classifyScenario(scenario);
  const sortedScores = (cal && cal.scenarios && cal.scenarios[scenarioKey]) || [];

  let percentile = rankPercentile(difficultyRaw, sortedScores);
  const rawPercentile = percentile;
  percentile = dampenPercentile(percentile, confidence.dampening);

  const likelihood = percentileToLabel(percentile);
  const likelihoodScore = percentileToLikelihoodScore(percentile, likelihood);
  const reason = buildReason(components, likelihood, scenario);
  const suggestion = buildSuggestion(likelihood, scenario, components);

  return {
    likelihood,
    likelihoodScore,
    reason,
    suggestion,
    reservationType: resType,
    debug: {
      difficultyRaw: Math.round(difficultyRaw * 10000) / 10000,
      scenarioKey,
      rawPercentile: Math.round(rawPercentile * 10) / 10,
      dampenedPercentile: Math.round(percentile * 10) / 10,
      confidenceDampening: Math.round(confidence.dampening * 100) / 100,
      confidenceFlags: confidence.flags,
      reservationType: resType,
      ...components
    }
  };
}

// ============================================================
// BATCH
// ============================================================

function addLikelihoodToResults(restaurants, scenario, cal) {
  return (restaurants || []).map(r => {
    const est = computeLikelihood(r, scenario, cal);
    return {
      ...r,
      reservationEstimate: {
        likelihood: est.likelihood,
        reason: est.reason,
        suggestion: est.suggestion,
        reservationType: est.reservationType,
        _likelihoodScore: est.likelihoodScore
      }
    };
  });
}

// ============================================================
// CALIBRATION REPORT
// ============================================================

function printCalibrationReport(restaurants, cal) {
  const scenarios = {
    'Weekday dinner (Tue 6–8pm)': { dayOfWeek: 'tuesday', timeWindow: ['18:00','20:00'], partySize: 2 },
    'Weekend dinner (Sat 6–8pm)': { dayOfWeek: 'saturday', timeWindow: ['18:00','20:00'], partySize: 2 },
    'Off-peak (Mon 5–6pm)':       { dayOfWeek: 'monday',   timeWindow: ['17:00','18:00'], partySize: 2 }
  };

  for (const [label, scenario] of Object.entries(scenarios)) {
    const all = (restaurants || []).map(r => ({
      name: r.name,
      resType: reservationType(r),
      ...computeLikelihood(r, scenario, cal)
    }));

    const walkins = all.filter(r => r.resType === 'walk_in_only');
    const reservable = all.filter(r => r.resType !== 'walk_in_only');
    const likelyRes = all.filter(r => r.resType === 'likely_reservable');
    const maybeRes = all.filter(r => r.resType === 'maybe_reservable');

    const counts = { High: 0, Medium: 0, Low: 0 };
    for (const r of reservable) counts[r.likelihood]++;
    const n = reservable.length;

    console.log(`\n${'='.repeat(65)}`);
    console.log(`📊 ${label}`);
    console.log(`${'='.repeat(65)}`);
    console.log(`   Total: ${all.length} | Reservable: ${n} | Walk-in only: ${walkins.length}`);
    console.log(`   Likely reservable: ${likelyRes.length} | Maybe reservable: ${maybeRes.length}`);
    if (n > 0) {
      console.log(`   High: ${counts.High} (${(counts.High/n*100).toFixed(1)}%) | Medium: ${counts.Medium} (${(counts.Medium/n*100).toFixed(1)}%) | Low: ${counts.Low} (${(counts.Low/n*100).toFixed(1)}%)`);
    }

    // Sort reservable by difficulty (hardest first)
    reservable.sort((a, b) => b.debug.difficultyRaw - a.debug.difficultyRaw);

    console.log(`\n   🔴 TOP 15 HARDEST (reservable):`);
    for (const r of reservable.slice(0, 15)) {
      const conf = r.debug.confidenceFlags.length > 0 ? ` [${r.debug.confidenceFlags.join(',')}]` : '';
      const rt = r.resType === 'maybe_reservable' ? ' (maybe)' : '';
      console.log(`      ${r.likelihood.padEnd(6)} — ${r.name}${rt}: ${r.reason}${conf}`);
    }

    console.log(`\n   🟢 TOP 15 EASIEST (reservable):`);
    for (const r of reservable.slice(-15).reverse()) {
      const conf = r.debug.confidenceFlags.length > 0 ? ` [${r.debug.confidenceFlags.join(',')}]` : '';
      const rt = r.resType === 'maybe_reservable' ? ' (maybe)' : '';
      console.log(`      ${r.likelihood.padEnd(6)} — ${r.name}${rt}: ${r.reason}${conf}`);
    }

    if (walkins.length > 0) {
      console.log(`\n   🚶 WALK-IN ONLY (${walkins.length}):`);
      for (const r of walkins.slice(0, 10)) {
        console.log(`      ${r.name}: ${r.reason}`);
      }
      if (walkins.length > 10) console.log(`      ... and ${walkins.length - 10} more`);
    }
  }
}

// ============================================================
// FUTURE LEARNING HOOKS
// ============================================================

const LearningHooks = {
  recordBookingClick: function(restaurantId, scenario, likelihood) {
    // TODO: send to analytics
  },
  recordBookingOutcome: function(restaurantId, scenario, outcome) {
    // TODO: send to analytics — outcome: 'success' | 'failed' | 'waitlisted'
  },
  computeWeightAdjustments: function(historicalData) {
    // TODO: analyze data, return suggested CONFIG changes
    return null;
  }
};

// ============================================================
// SORT: "Best chance to book" — by likelihoodScore descending
// ============================================================

function sortByLikelihood(restaurants) {
  return [...(restaurants || [])].sort((a, b) => {
    const scoreA = (a.reservationEstimate && a.reservationEstimate._likelihoodScore) || 50;
    const scoreB = (b.reservationEstimate && b.reservationEstimate._likelihoodScore) || 50;
    return scoreB - scoreA;
  });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  computeLikelihood,
  computeDifficulty,
  calibrate,
  addLikelihoodToResults,
  sortByLikelihood,
  printCalibrationReport,
  reservationType,
  CONFIG,
  LABEL_COPY,
  TOOLTIP_TEXT,
  CALIBRATION_SCENARIOS,
  LearningHooks,
  // Internals for testing
  computePopularity, computeDemandMult, getPartyMult, getPriceMult,
  getFormatMult, getMichelinMult, getBuzzMult, getBoroughMult,
  getOverrideMult, assessConfidence, rankPercentile, classifyScenario
};
