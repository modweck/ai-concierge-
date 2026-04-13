// ─── BARS & DRINKS VIEW ─────────────────────────────────────────────────────

function barUseGPS() {
  if (!navigator.geolocation) return;
  const el = document.getElementById('barAddrInput');
  if (el) el.placeholder = 'Getting location...';
  navigator.geolocation.getCurrentPosition(
    async p => {
      const addr = await reverseGeocode(p.coords.latitude, p.coords.longitude);
      if (el) {
        el.value = addr || `${p.coords.latitude},${p.coords.longitude}`;
        el.placeholder = 'Enter your address or neighborhood...';
      }
    },
    () => { if (el) el.placeholder = 'Enter your address or neighborhood...'; alert('Could not get location'); }
  );
}

function barSetTransport(mode, btn) {
  barState.transport = mode;
  document.querySelectorAll('#bar-tgroup .tbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['walk','drive','radius'].forEach(m => {
    const el = document.getElementById('bar-dd-' + m);
    if (el) el.classList.toggle('open', m === mode);
  });
}

function barSetVibe(vibe, btn) {
  barState.vibeFilter = vibe;
  document.querySelectorAll('[id^="bar-vibe-"]').forEach(b => b.classList.remove('on'));
  (btn || document.getElementById(vibe ? `bar-vibe-${vibe}` : 'bar-vibe-any')).classList.add('on');
}

function barSetAvail(val, btn) {
  ['bar-hor-3','bar-hor-5','bar-hor-7','bar-hor-14'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  ['bar-avail-any','bar-avail-early','bar-avail-prime','bar-avail-late'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  barState.availFilter = val; barState.horizonFilter = null;
  btn.classList.add('on');
}
function barSetHorizon(days, btn) {
  ['bar-avail-any','bar-avail-early','bar-avail-prime','bar-avail-late'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  ['bar-hor-3','bar-hor-5','bar-hor-7','bar-hor-14'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  barState.availFilter = null; barState.horizonFilter = days;
  btn.classList.add('on');
}

const BAR_VIBE_STYLES = {
  party:        { bg:'#fdf2f8', color:'#be185d', border:'rgba(190,24,93,.2)', emoji:'🎉' },
  dive:         { bg:'#fefce8', color:'#b45309', border:'rgba(180,83,9,.2)', emoji:'🍺' },
  upscale:      { bg:'#ecfeff', color:'#0e7490', border:'rgba(14,116,144,.2)', emoji:'💎' },
  neighborhood: { bg:'#f0fdf4', color:'#15803d', border:'rgba(21,128,61,.2)', emoji:'🏘️' },
  date_night:   { bg:'#fdf2f8', color:'#be185d', border:'rgba(190,24,93,.2)', emoji:'🌹' },
  cocktail:     { bg:'#fdf2f8', color:'#be185d', border:'rgba(190,24,93,.2)', emoji:'🍸' },
  wine:         { bg:'#faf5ff', color:'#7e22ce', border:'rgba(126,34,206,.2)', emoji:'🍷' },
  speakeasy:    { bg:'#f5f3ff', color:'#6d28d9', border:'rgba(109,40,217,.2)', emoji:'🕯️' },
  rooftop:      { bg:'#eff6ff', color:'#1d4ed8', border:'rgba(29,78,216,.2)', emoji:'🌃' },
  lounge:       { bg:'#fff7ed', color:'#c2410c', border:'rgba(194,65,12,.2)', emoji:'🛋️' },
  live_music:   { bg:'#fdf2f8', color:'#be185d', border:'rgba(190,24,93,.2)', emoji:'🎶' },
  beer:         { bg:'#fefce8', color:'#b45309', border:'rgba(180,83,9,.2)', emoji:'🍺' },
  mezcal:       { bg:'#fdf8f0', color:'#92400e', border:'rgba(146,64,14,.2)', emoji:'🥃' },
  sake:         { bg:'#1a0612', color:'#f9a8d4', border:'#831843', emoji:'🍶' },
  tiki:         { bg:'#0a1a0a', color:'#4ade80', border:'#14532d', emoji:'🌴' },
  whiskey:      { bg:'#150f0a', color:'#d97706', border:'#78350f', emoji:'🥃' },
  karaoke:      { bg:'#0d0a1a', color:'#a78bfa', border:'#3730a3', emoji:'🎤' },
};

function renderBarCard(b) {
  const name = tc(b.name) || 'Unknown';
  const rating = b.barScore || b.googleRating || 0;
  const reviews = b.googleReviewCount || 0;
  const addr = (b.vicinity || b.formatted_address || '').replace(/,?\s*USA?\.?$/i,'');
  const sub = [b.neighborhood||addr, b.walkMinEstimate?`🚶 ${b.walkMinEstimate} min`:null, b.distanceMiles!=null?`${b.distanceMiles} mi`:null].filter(Boolean).join(' · ');
  const price = b.price_level > 0 ? `<span class="card-price">${'$'.repeat(b.price_level)}</span>` : '';
  const mapsUrl = b.place_id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name)}&query_place_id=${b.place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name+' bar New York NY')}`;

  // Badges
  let badges = '';
  if (rating >= 4.0) {
    const rs = reviews>=1000?(reviews/1000).toFixed(1)+'k':reviews;
    badges += `<span class="badge goog">⭐ ${Number(rating).toFixed(1)} (${rs})</span>`;
  }

  // Tier badge
  const TIER_STYLES_BAR = {
    must_book: { bg:'#fff4ed', color:'#c2410c', border:'rgba(194,65,12,.2)', label:'🔥 Must-Book' },
    notable:   { bg:'#f5f3ff', color:'#6d28d9', border:'rgba(109,40,217,.2)', label:'⭐ Notable' },
  };
  const tierStyle = TIER_STYLES_BAR[b.bar_tier];
  if (tierStyle) badges += `<span class="badge" style="background:${tierStyle.bg};color:${tierStyle.color};border:1px solid ${tierStyle.border}">${tierStyle.label}</span>`;

  // Vibe badges — pick up to 3
  const MOOD_VIBES = new Set(['party','dive','upscale','neighborhood','date_night']);
  const SPEC_VIBES = new Set(['cocktail','wine','speakeasy','rooftop','lounge','live_music','beer','mezcal','sake','tiki','tapas','whiskey','karaoke']);
  const allVibes = b.bar_vibes || [];
  const moodPick = allVibes.filter(v => MOOD_VIBES.has(v)).slice(0,1);
  const specPick = allVibes.filter(v => SPEC_VIBES.has(v)).slice(0,1);
  const used = new Set([...moodPick,...specPick]);
  const extra = allVibes.filter(v => !used.has(v)).slice(0,1);
  [...moodPick,...specPick,...extra].slice(0,3).forEach(v => {
    const s = BAR_VIBE_STYLES[v];
    if (s) badges += `<span class="badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.border}">${s.emoji} ${v.replace('_',' ')}</span>`;
  });

  // Press pick
  if (b.buzz_sources && b.buzz_sources.length > 0) badges += `<span class="badge press">📰 Press Pick</span>`;

  // Hours display
  let hoursHtml = '';
  if (b.hours && b.hours.length > 0) {
    const todayIdx = new Date().getDay();
    const dayMap = [6,0,1,2,3,4,5];
    const isWeekend = barState.dayMode === 'weekend';
    const useIdx = isWeekend ? 4 : dayMap[todayIdx];
    const raw = b.hours[useIdx] || '';
    const clean = raw.replace(/\u202f/g,' ').replace(/\u2009/g,' ').replace(/\u2013/g,'–');
    if (clean) {
      const label = isWeekend ? clean.replace(/^\w+:\s*/,'Fri: ') : clean;
      hoursHtml = `<div style="font-size:11px;color:#999;margin-bottom:6px">🕐 ${label}</div>`;
    }
    // Late night badge
    const allMatches = [...raw.matchAll(/[–\-]\s*(\d+):(\d+)\s*(AM|PM)/gi)];
    if (allMatches.length > 0) {
      const last = allMatches[allMatches.length-1];
      let hr = parseInt(last[1]);
      const ampm = last[3].toUpperCase();
      const closeHour = ampm === 'AM' ? (hr===12?24:24+hr) : (hr===12?12:12+hr);
      if (closeHour >= 29) badges += `<span class="badge" style="background:#f5f3ff;color:#6d28d9;border:1px solid rgba(109,40,217,.2)">🌑 Until 5am+</span>`;
      else if (closeHour === 28) badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.2)">🌙 Until 4am</span>`;
    }
  }

  // Book button — search-bars returns resy_url, opentable_url, booking_platform, booking_url
  let bookBtn = '';
  const resyUrl = b.resy_url || (b.booking_platform==='resy' ? b.booking_url : null);
  const otUrl = b.opentable_url || (b.booking_platform==='opentable' ? b.booking_url : null);
  const tockUrl = b.booking_platform==='tock' ? b.booking_url : null;
  if (resyUrl) bookBtn = `<a href="${resyUrl}" target="_blank" rel="noopener" class="bbtn resy">Book on Resy →</a>`;
  else if (otUrl) bookBtn = `<a href="${otUrl}" target="_blank" rel="noopener" class="bbtn opentable">Book on OpenTable →</a>`;
  else if (tockUrl) bookBtn = `<a href="${tockUrl}" target="_blank" rel="noopener" class="bbtn tock">Book on Tock →</a>`;
  else if (b.website) bookBtn = `<a href="${b.website}" target="_blank" rel="noopener" class="bbtn site">Visit Website →</a>`;
  else bookBtn = `<a href="${mapsUrl}" target="_blank" rel="noopener" class="bbtn google">Find on Google →</a>`;

  return `<div class="card">
    <div class="card-top"><div class="card-name">${name}</div>${price}</div>
    <div class="card-sub">${sub}</div>
    ${hoursHtml}
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    <div class="actions">${bookBtn}<a href="${mapsUrl}" target="_blank" rel="noopener" class="mapbtn">📍</a></div>
  </div>`;
}

function displayBarResults(results, totalCount) {
  const meta = document.getElementById('barResultsMeta');
  const list = document.getElementById('barResultsList');
  const displayCount = totalCount || results.length;
  meta.textContent = `${displayCount.toLocaleString()} bar${displayCount!==1?'s':''}`;
  if (!results.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">🍸</div><div class="empty-title">No bars found</div><div class="empty-sub">Try adjusting your filters</div></div>`;
    return;
  }
  // Sort by boosted score
  results.sort((a,b) => {
    const scoreA = (a.barScore||a.googleRating||0) + (a.googleReviewCount>=1000?0.3:a.googleReviewCount>=500?0.2:a.googleReviewCount>=200?0.1:0);
    const scoreB = (b.barScore||b.googleRating||0) + (b.googleReviewCount>=1000?0.3:b.googleReviewCount>=500?0.2:b.googleReviewCount>=200?0.1:0);
    return scoreB - scoreA || (a.distanceMiles||999)-(b.distanceMiles||999);
  });
  list.innerHTML = results.map(renderBarCard).join('');
}

async function doBarSearch() {
  if (barSearching && barAbort) barAbort.abort();
  barSearching = true;
  barAbort = new AbortController();

  document.getElementById('bar-form').style.display = 'none';
  document.getElementById('bar-results').style.display = 'block';

  const list = document.getElementById('barResultsList');
  const warn = document.getElementById('barResultsWarnings');
  list.innerHTML = `<div style="text-align:center;padding:50px 20px"><div style="font-size:28px;margin-bottom:10px">🍸</div><div style="font-size:13px;font-weight:600;color:#444">Finding bars...</div></div>`;
  warn.innerHTML = '';

  const btn = document.getElementById('barSearchBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Searching...'; }

  try {
    const location = document.getElementById('barAddrInput').value.trim() || 'New York, NY';
    // Build vibes array from dropdowns
    const vibes = [];
    if (barState.mood !== 'any') vibes.push(barState.mood);
    if (barState.specialty !== 'any') vibes.push(barState.specialty);

    const lateNightLevel = document.getElementById('barLateFilter').value;
    const priceLevel = document.getElementById('barPriceFilter').value;
    const buzzOn = document.getElementById('barBuzzFilter').value === 'on';
    const resp = await fetch('/.netlify/functions/search-bars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        vibes,
        quality: 'any',
        lateNight: lateNightLevel !== 'off',
        lateNightLevel: lateNightLevel !== 'off' ? lateNightLevel : 'late',
        buzz: buzzOn,
        price: priceLevel !== 'any' ? priceLevel : undefined,
        broadCity: barState.transport === 'all_nyc',
        maxDist: getBarMaxDist()
      }),
      signal: barAbort.signal
    });
    const data = await resp.json();
    if (data.error) {
      warn.innerHTML = `<div class="err-banner">❌ ${data.error}</div>`;
      list.innerHTML = '';
      return;
    }
    let results = [...(data.elite||[]), ...(data.moreOptions||[])];
    if (priceLevel !== 'any') {
      results = results.filter(b => b.price_level === Number(priceLevel));
    }
    if (buzzOn) {
      results = results.filter(b => b.buzz_sources && b.buzz_sources.length > 0);
    }
    // Late night client-side filter
    if (lateNightLevel !== 'off') {
      const dayMap = [6,0,1,2,3,4,5];
      const isWeekend = barState.dayMode === 'weekend';
      const useIdx = isWeekend ? 4 : dayMap[new Date().getDay()];
      results = results.filter(b => {
        if (!b.hours || !b.hours.length) return false;
        const h = b.hours[useIdx] || '';
        const allM = [...h.matchAll(/[–\-]\s*(\d+):(\d+)\s*(AM|PM)/gi)];
        if (!allM.length) return false;
        const last = allM[allM.length-1];
        let hr = parseInt(last[1]);
        const ampm = last[3].toUpperCase();
        const closeHour = ampm === 'AM' ? (hr===12?24:24+hr) : (hr===12?12:12+hr);
        if (lateNightLevel === 'late') return closeHour === 28;
        if (lateNightLevel === 'very_late') return closeHour >= 29;
        return closeHour >= 28;
      });
    }

    if (data.confirmedAddress) {
      warn.innerHTML = `<div class="loc-banner">📍 ${data.confirmedAddress.replace(/,?\s*USA?\.?$/i,'')}</div>`;
    }
    // ── Vibe filter ──
    if (barState.vibeFilter) {
      results = results.filter(b => (b.bar_vibes || b.vibe_tags || []).includes(barState.vibeFilter));
    }
    barState.allResults = results;
    barRefilter();
  } catch(err) {
    if (err.name === 'AbortError') return;
    warn.innerHTML = `<div class="err-banner">😔 ${err.message || 'Search failed'}</div>`;
    list.innerHTML = '';
  } finally {
    barSearching = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Find Bars & Drinks'; }
  }
}

let barSortBy = 'rating';
function setBarSortOrder(val) { barSortBy = val; barRefilter(); }

function barRefilter() {
  let results = barState.allResults || [];
  if (barState.vibeFilter) {
    results = results.filter(b => (b.bar_vibes || b.vibe_tags || []).includes(barState.vibeFilter));
  }
  if (barState.priceLevel && barState.priceLevel !== 'any') {
    const p = parseInt(barState.priceLevel);
    results = results.filter(b => (b.price_level || b.price || 0) === p);
  }
  if (barState.reviewCountFilter && barState.reviewCountFilter !== 'any') {
    const minR = Number(barState.reviewCountFilter);
    results = results.filter(b => (Number(b.googleReviewCount || b.google_reviews || 0)) >= minR);
  }
  if (barState.maxDist && barState.maxDist !== 'any') {
    const maxD = parseFloat(barState.maxDist);
    results = results.filter(b => (b.distanceMiles ?? 999) <= maxD);
  }
  results.sort((a, b) => {
    if (barSortBy === 'distance') return (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999);
    if (barSortBy === 'price_low') return (a.price_level || a.price || 99) - (b.price_level || b.price || 99);
    if (barSortBy === 'price_high') return (b.price_level || b.price || 0) - (a.price_level || a.price || 0);
    return (b.barScore || b.googleRating || 0) - (a.barScore || a.googleRating || 0);
  });
  displayBarResults(results);
}
