// ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────

// Vibe tag display constants
const VIBE_EMOJI = {
  date_night: '🍷', upscale: '💎', lively: '🔥', chill: '😌',
  trendy: '✨', brunch: '🥞', outdoor: '🌿', late_night: '🌙',
  casual: '👕', hidden_gem: '🕵️', foodie: '🍽'
};

const VIBE_LABEL = {
  date_night: 'Date', upscale: 'Upscale', lively: 'Lively', chill: 'Chill',
  trendy: 'Trendy', brunch: 'Brunch', outdoor: 'Outdoor', late_night: 'Late Night',
  casual: 'Casual', hidden_gem: 'Hidden Gem', foodie: 'Foodie'
};

// Title case
function tc(str) {
  return str ? str.replace(/\b\w/g, l => l.toUpperCase()).replace(/'\w/g, m => m.toLowerCase()) : '';
}

function tcAR(str) {
  return str ? str.replace(/\b\w/g, l => l.toUpperCase()).replace(/'\w/g, m => m.toLowerCase()) : '';
}

// Check if restaurant is Bilt-only (no real booking URL)
function isBiltOnly(r) {
  return r.bilt_dining && !r.booking_url && r.booking_platform === 'bilt';
}

// Check if restaurant has a real booking platform (not website/walk_in)
function hasBookingPlatform(r) {
  const p = r.booking_platform || r.platform || '';
  return p && p !== 'walk_in' && p !== 'website' && p !== 'walkin' && p !== 'bilt';
}
const hasBookingPlatformAR = hasBookingPlatform;

// Buzz score for ranking
function buzzScore(r) {
  let s = 0;
  if (r.michelin) {
    const st = r.michelin.stars || 0;
    if (st >= 3) s += 100;
    else if (st === 2) s += 80;
    else if (st === 1) s += 60;
    else {
      const d = r.michelin.distinction || '';
      if (d === 'bib_gourmand' || d === 'bib') s += 40;
      else s += 30;
    }
  }
  if (r.bib_gourmand) s += 40;
  if (r.nyt_top_100) s += 35;
  if (r.pete_wells) s += 30;
  if (r.buzz_sources && r.buzz_sources.length > 0) s += 10 * r.buzz_sources.length;
  if (r.infatuation_url) s += 10;
  if (BUZZ_SET.has((r.name || '').toLowerCase().trim())) s += 10;
  const gR = Number(r.googleRating || 0);
  if (gR >= 4.7) s += 15;
  else if (gR >= 4.5) s += 10;
  else if (gR >= 4.0) s += 5;
  if (r.instagram_buzz && r.instagram_buzz.length > 0) s += 8 * Math.min(r.instagram_buzz.length, 3);
  return s;
}

function hasBuzzCoverage(r) {
  const n = (r.name || '').toLowerCase().trim();
  return BUZZ_SET.has(n)
    || !!(r.buzz_sources && r.buzz_sources.length > 0)
    || !!(r.infatuation_url)
    || !!(r.instagram_buzz && r.instagram_buzz.length > 0);
}

function hasNYTCoverage(r) {
  return (r.buzz_sources && r.buzz_sources.some(s => s === 'NYT' || s === 'NY Times'))
    || r.pete_wells || r.nyt_top_100;
}

function getBuzzLinks(name) {
  if (!name) return null;
  return BUZZ_LINKS[name]
    || BUZZ_LINKS[name.toLowerCase()]
    || BUZZ_LINKS[tc(name)]
    || null;
}

// Availability tier
function availTier(r) {
  const t = r.avail_tier || r.tier;
  if (t === 'available' || t === 'open') return 'available';
  if (t === 'limited') return 'limited';
  if (t === 'hard' || t === 'hard_to_book') return 'booked';
  if (t === 'booked' || t === 'fully_booked') return 'booked';
  if (t === 'prime_booked' || t === 'very_hard') return 'booked';
  return null;
}

function availTierAR(r) {
  const t = r.avail_tier || r.tier;
  if (t === 'available' || t === 'open') return 'available';
  if (t === 'limited') return 'limited';
  if (t === 'hard' || t === 'hard_to_book') return 'hard';
  if (t === 'booked' || t === 'fully_booked') return 'booked';
  if (t === 'prime_booked' || t === 'very_hard') return 'booked';
  return null;
}

function hasBuzzAR(r) {
  const n = (r.name || '').toLowerCase().trim();
  return BUZZ_SET_AR.has(n) || !!(r.buzz_sources && r.buzz_sources.length > 0);
}

// Reverse geocode
async function reverseGeocode(lat, lng) {
  try {
    const d = await (await fetch('/.netlify/functions/get-maps-key')).json();
    if (!d.key) return null;
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${d.key}`);
    const j = await r.json();
    return j.results?.[0]?.formatted_address || null;
  } catch (e) { return null; }
}

// Get transport params for search
function getTP() {
  const t = state.transport;
  if (t === 'walk') return { transport: 'walk', walkTime: +document.getElementById('walkTime').value };
  if (t === 'drive') return { transport: 'drive', driveTime: +document.getElementById('driveTime').value };
  if (t === 'radius') {
    const miles = state._homeRadius || +document.getElementById('radiusMiles').value || 1;
    return { transport: 'radius', radiusMiles: miles };
  }
  return { transport: 'all_nyc' };
}

function isBroadCity(loc) {
  const l = loc.toLowerCase().trim().replace(/[,.]/g, '').replace(/\s+/g, ' ');
  return ['new york ny', 'new york new york', 'nyc', 'manhattan ny', 'brooklyn ny', 'new york city']
    .some(t => l === t || l.startsWith(t + ' '));
}

// Toggle instagram buzz expanded section
function toggleInstaBuzz(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'flex';
  btn.textContent = isOpen ? btn.textContent.replace('▴', '▾') : btn.textContent.replace('▾', '▴');
}

// Bar distance helper
function getBarMaxDist() {
  const t = barState.transport;
  if (t === 'all_nyc') return 999;
  if (t === 'walk') return Number(document.getElementById('barWalkTime').value) / 20;
  if (t === 'drive') return Number(document.getElementById('barDriveTime').value) / 4;
  if (t === 'radius') return Number(document.getElementById('barRadiusMiles').value);
  return 1.0;
}
