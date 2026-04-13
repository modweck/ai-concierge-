// ─── HOT SPOTS SEARCH ───────────────────────────────────────────────────────

// ─── INIT ─────────────────────────────────────────────────────────────────────
(function(){
  const t = new Date();
  const d = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  document.getElementById('dateInput').value = d;
  document.getElementById('dateInput').min = d;
})();

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(i) {
  document.querySelectorAll('.page').forEach((p,j) => p.classList.toggle('on', j===i));
  document.querySelectorAll('.tab').forEach((t,j) => t.classList.toggle('active', j===i));
  document.getElementById('tabBar').dataset.tab = i;
}

// ─── FORM CONTROLS ────────────────────────────────────────────────────────────
function setCuisine(val, btn) {
  state.cuisine = val;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
}

function setTransport(mode, btn) {
  state.transport = mode;
  document.querySelectorAll('#tgroup .tbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['walk','drive','radius'].forEach(m => document.getElementById('dd-'+m).classList.toggle('open', m===mode));
}

function adjParty(d) {
  const el = document.getElementById('party');
  el.value = Math.max(1, Math.min(20, parseInt(el.value)+d));
}

function useGPS() {
  if (!navigator.geolocation) return;
  const el = document.getElementById('addressInput');
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

// ─── RENDER CARD ──────────────────────────────────────────────────────────────
function renderCard(r, isRadar) {
  const name = tc(r.name) || 'Unknown';
  const addr = (r.vicinity||r.formatted_address||'').replace(/,?\s*U\.?S\.?A?\.?$/i,'');
  const walkStr = r.walkMinEstimate > 0 ? `🚶 ${r.walkMinEstimate} min` : null;
  const driveStr = r.driveMinEstimate > 0 ? `🚗 ${r.driveMinEstimate} min` : null;
  const sub = [r.cuisine, addr, r.distanceMiles!=null?`${r.distanceMiles} mi`:null, walkStr, driveStr].filter(Boolean).join(' · ');
  const price = r.price_level > 0 ? `<span class="card-price">${'$'.repeat(r.price_level)}</span>` : '';

  // Vibe tag pills
  // VIBE_EMOJI and VIBE_LABEL are defined in utils.js
  let vibeHtml = '';
  if (r.vibe_tags && r.vibe_tags.length) {
    const pills = r.vibe_tags.slice(0,4).map(v => {
      const emoji = VIBE_EMOJI[v] || '';
      const label = VIBE_LABEL[v] || v.replace(/_/g,' ');
      return `<span class="badge vibe">${emoji} ${label}</span>`;
    }).join('');
    vibeHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px">${pills}</div>`;
  }

  // Buzz badges
  let badges = '';
  if (r.michelin) {
    const st = r.michelin.stars||0, d = r.michelin.distinction||'';
    if (st>=1) badges += `<span class="badge mstar">${'⭐'.repeat(Math.min(st,3))} Michelin</span>`;
    else if (d==='bib_gourmand'||d==='bib') badges += `<span class="badge bib">🍽️ Bib Gourmand</span>`;
    else badges += `<span class="badge bib">✨ Michelin Rec</span>`;
  } else if (r.bib_gourmand) {
    badges += `<span class="badge bib">🍽️ Bib Gourmand</span>`;
  }
  const bdata = getBuzzLinks(r.name);
  const hasBuzz = hasBuzzCoverage(r);

  // NYT badge — 4 tiers using real data fields
  const isNYT = (r.buzz_sources && r.buzz_sources.some(s => s === 'NYT' || s === 'NY Times')) || r.pete_wells || r.nyt_top_100;
  if (isNYT) {
    if (r.nyt_top_100) {
      const bl = getBuzzLinks(r.name);
      const nytLink = bl && bl.links && bl.links.find(l => l.source === 'NYT');
      const rankMatch = nytLink && nytLink.label && nytLink.label.match(/#(\d+)/);
      const rankStr = rankMatch ? ` #${rankMatch[1]}` : '';
      badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.2)">📰 NYT Top 100${rankStr}</span>`;
    } else if (r.pete_wells && r.nyt_stars) {
      const stars = '★'.repeat(Math.min(r.nyt_stars, 4));
      badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.2)">📰 NYT ${stars}</span>`;
    } else {
      badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.15)">📰 NYT</span>`;
    }
  }

  // Press source badges with clickable links
  if (hasBuzz) {
    const pressLinks = new Map();
    const _ns = s => ({'eater':'Eater','infatuation':'Infatuation','the infatuation':'Infatuation','The Infatuation':'Infatuation','timeout':'Time Out','TimeOut':'Time Out','Time Out':'Time Out','grubstreet':'GrubStreet','GrubStreet':'GrubStreet','Grub Street':'GrubStreet','nyt':'NYT','NY Times':'NYT','michelin':'Michelin'}[s] || s.charAt(0).toUpperCase()+s.slice(1));
    if (bdata?.links) bdata.links.forEach(l => { const k = _ns(l.source); if (k !== 'NYT' && k !== 'Michelin') pressLinks.set(k, l.url); });
    if (r.buzz_sources) r.buzz_sources.forEach(s => { const k = _ns(s); if (k !== 'NYT' && k !== 'Michelin' && !pressLinks.has(k)) pressLinks.set(k, null); });
    if (pressLinks.size > 0) {
      pressLinks.forEach((url, src) => {
        if (url) badges += `<a href="${url}" target="_blank" rel="noopener" class="badge press" style="text-decoration:none;cursor:pointer">📰 ${src}</a>`;
        else badges += `<span class="badge press">📰 ${src}</span>`;
      });
    }
  }

  const reviews = Number(r.googleReviewCount||0);
  const rawRating = Number(r.googleRating||0);
  const rating = (rawRating > 0 && rawRating < 4) ? 4 : rawRating;
  const isNewRising = r.new_rising;
  if (isNewRising)
    badges += `<span class="badge" style="background:#fef9c3;color:#a16207;border:1px solid rgba(161,98,7,.2)">🌱 New &amp; Rising</span>`;
  if (rating > 0) {
    const rs = reviews >= 1000 ? (reviews/1000).toFixed(1)+'k' : reviews > 0 ? reviews : null;
    const opacity = rating >= 4.7 ? '1' : rating >= 4.4 ? '.8' : '.55';
    const countStr = rs ? ` (${rs})` : '';
    badges += `<span class="badge goog" style="opacity:${opacity}">⭐ ${rating}${countStr}</span>`;
  }

  // Instagram — backend field takes priority, fallback to lookup table
  const instaHandle = r.instagram || INSTA[(r.name||'').toLowerCase()];


  // Deposit badge — backend sends deposit_type on every card via stableResponse
  if (r.deposit_type === 'deposit' || r.deposit_type === 'prepay' || r.deposit_type === 'cc_hold')
    badges += `<span class="badge" style="background:#fef2f2;color:#dc2626;border:1px solid rgba(220,38,38,.2)">💳 Deposit Req.</span>`;

  // inKind badge — show for restaurants with a booking platform, or when inkind filter is active
  if (r.inkind && (hasBookingPlatform(r) || r.booking_platform === 'website' || state.rewardsFilter === 'inkind'))
    badges += `<span class="badge inkind">🔥 inKind 20% Off</span>`;

  // Bilt badge
  if (r.bilt_dining && (hasBookingPlatform(r) || state.rewardsFilter === 'bilt'))
    badges += `<span class="badge bilt">Bilt Dining</span>`;

  // Rakuten badge
  if (r.rakuten && (hasBookingPlatform(r) || r.booking_platform === 'website' || state.rewardsFilter === 'rakuten'))
    badges += `<span class="badge rakuten">🛍️ Rakuten Cash Back</span>`;

  const badgesHtml = badges ? `<div class="badges">${badges}</div>` : '';

  // Availability
  const tier = availTier(r);
  let availHtml = '';
  // Build time window badges
  // Window badge styles
  const _styleAvail   = 'display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#e8f5e9;color:#2e7d32;border:1px solid rgba(46,125,50,.2)';
  const _styleLimited = 'display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#fff8e1;color:#f57c00;border:1px solid rgba(245,124,0,.25)';
  const _styleBooked  = 'display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#fde8e8;color:#c0392b;border:1px solid rgba(192,57,43,.25)';

  function _windowBadge(status, label) {
    if (status === 'available') return `<span style="${_styleAvail}">${label}</span>`;
    if (status === 'limited')   return `<span style="${_styleLimited}">${label} Limited</span>`;
    return `<span style="${_styleBooked}">${label} Booked</span>`;
  }

  // Only compute window statuses if we actually have window data
  const hasNewData = r.early || r.prime || r.late;
  const hasOldData = r.has_early || r.has_prime || r.has_late;
  const hasWindowData = hasNewData || hasOldData;

  let timeBadgeHtml = '';

  // Hardcoded special labels by name
  const _nameLower = (r.name || '').toLowerCase();
  const _sundayOnly = _nameLower.includes('fini williamsburg');
  const _walkInOnly = _nameLower.includes('lucali') || _nameLower.includes('okdongsik');

  if (_sundayOnly) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#f3e5f5;color:#6a1b9a;border:1px solid rgba(106,27,154,.25)">🟣 Only Open Sunday</span></div>`;
  } else if (_walkInOnly) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#fff3e0;color:#ef6c00;border:1px solid rgba(239,108,0,.25)">🚶 Walk-in · Long Waits</span></div>`;
  } else if (hasWindowData) {
    // Use new string fields if present, fall back to old booleans
    const earlyStatus = r.early || (r.has_early ? 'available' : 'booked');
    const primeStatus = r.prime || (r.has_prime ? 'available' : 'booked');
    const lateStatus  = r.late  || (r.has_late  ? 'available' : 'booked');

    const allAvailable = earlyStatus === 'available' && primeStatus === 'available' && lateStatus === 'available';
    const allBooked    = earlyStatus === 'booked'    && primeStatus === 'booked'    && lateStatus === 'booked';
    const isBooked     = tier === 'booked' || allBooked;

    if (isBooked && r.opens_in) {
      availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#e8f5e9;color:#2e7d32;border:1px solid rgba(46,125,50,.25)">🟢 Opens +${r.opens_in}d</span></div>`;
    } else if (isBooked && r.fully_locked) {
      availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0;background:#2a2a2a;color:#fff;border-color:#2a2a2a">Booked Solid</span></div>`;
    } else if (isBooked) {
      availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span></div>`;
    } else if (allAvailable) {
      availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail av" style="margin-bottom:0">🟢 Available Tonight</span></div>`;
    } else {
      timeBadgeHtml = _windowBadge(earlyStatus, 'Early') + _windowBadge(primeStatus, 'Prime') + _windowBadge(lateStatus, 'Late');
      availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px">${timeBadgeHtml}</div>`;
    }
  } else if (tier === 'booked' && r.opens_in) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#e8f5e9;color:#2e7d32;border:1px solid rgba(46,125,50,.25)">🟢 Opens +${r.opens_in}d</span></div>`;
  } else if (tier === 'booked' && r.fully_locked) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0;background:#2a2a2a;color:#fff;border-color:#2a2a2a">Booked Solid</span></div>`;
  } else if (tier === 'booked' && r.opens_in) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#e8f5e9;color:#2e7d32;border:1px solid rgba(46,125,50,.25)">🟢 Opens +${r.opens_in}d</span></div>`;
  } else if (tier === 'booked') {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span></div>`;
  } else if (tier === 'available') {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail av" style="margin-bottom:0">🟢 Available Tonight</span></div>`;
  } else if (tier === 'limited') {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail lim" style="margin-bottom:0">🟡 Limited Spots</span></div>`;
  }

  // Maps URL
  const mapsUrl = r.place_id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name||'')}&query_place_id=${r.place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.name||'')+' restaurant New York NY')}`;

  // Book button
  let bookBtn = '';
  if (r.booking_url && r.booking_platform) {
    let url = r.booking_url;
    try { if (url.includes('google.com/url')) { const u = new URL(url); url = u.searchParams.get('q')||url; } } catch(e){}
    url = url.replace(/\/+$/,'');
    const bmap = {resy:{cls:'resy',label:'Book on Resy →'},opentable:{cls:'opentable',label:'Book on OpenTable →'},tock:{cls:'tock',label:'Book on Tock →'},bilt:{cls:'bilt',label:'🏠 Book on Bilt →'},google_reserve:{cls:'google',label:'Reserve via Google →'},website:{cls:'site',label:'Book →'},walkin:{cls:'site',label:'🚶 Walk-ins Welcome'}};
    const s = bmap[r.booking_platform]||{cls:'site',label:'Book →'};
    bookBtn = `<a href="${url}" target="_blank" rel="noopener" class="bbtn ${s.cls}">${s.label}</a>`;
  } else if (r.website) {
    bookBtn = `<a href="${r.website}" target="_blank" rel="noopener" class="bbtn site">Visit Website →</a>`;
  } else {
    bookBtn = `<a href="${mapsUrl}" target="_blank" rel="noopener" class="bbtn google">Find on Google →</a>`;
  }

  const pressHtml = '';

  // Website + Instagram links
  let cardLinks = '';
  if (r.website || instaHandle || (r.instagram_buzz && r.instagram_buzz.length > 0)) {
    cardLinks = '<div class="card-links">';
    if (r.website) cardLinks += `<a href="${r.website}" target="_blank" rel="noopener" class="web-link">🌐 Website</a>`;
    if (instaHandle) {
      const cleanHandle = instaHandle.replace(/^@/,'').replace(/https?:\/\/.*instagram\.com\//,'').replace(/\/?$/,'');
      cardLinks += `<a href="https://www.instagram.com/${cleanHandle}" target="_blank" rel="noopener" class="insta-link">📸 @${cleanHandle}</a>`;
    }
    if (r.instagram_buzz && r.instagram_buzz.length > 0) {
      const sorted = [...r.instagram_buzz].sort((a,b) => (b.likes||0) - (a.likes||0));
      const top = sorted[0];
      const rest = sorted.slice(1);
      const buzzId = 'ibuzz_' + Math.random().toString(36).slice(2,8);
      if (rest.length === 0) {
        cardLinks += `<a href="${top.post_url}" target="_blank" rel="noopener" class="insta-buzz-link">🎯 @${top.influencer}</a>`;
      } else {
        cardLinks += `<span class="insta-buzz-wrap">`;
        cardLinks += `<a href="${top.post_url}" target="_blank" rel="noopener" class="insta-buzz-link">🎯 @${top.influencer}</a>`;
        cardLinks += `<button class="insta-buzz-more" onclick="toggleInstaBuzz('${buzzId}',this)">+${rest.length} more ▾</button>`;
        cardLinks += `<span id="${buzzId}" class="insta-buzz-expanded" style="display:none">`;
        rest.forEach(p => {
          cardLinks += `<a href="${p.post_url}" target="_blank" rel="noopener" class="insta-buzz-link insta-buzz-sub">@${p.influencer}</a>`;
        });
        cardLinks += `</span></span>`;
      }
    }
    cardLinks += '</div>';
  }

  return `<div class="card${isRadar?' dim':''}">
    <div class="card-top"><div class="card-name">${name}</div>${price}</div>
    <div class="card-sub">${sub}</div>
    ${vibeHtml}
    ${badgesHtml}
    ${availHtml}
    <div class="actions">${bookBtn}<a href="${mapsUrl}" target="_blank" rel="noopener" class="mapbtn">📍</a></div>
    ${pressHtml}
    ${cardLinks}
  </div>`;
}

// ─── DISPLAY ──────────────────────────────────────────────────────────────────
function display(restaurants) {
  restaurants.forEach(r => { r._bs = buzzScore(r); });

  let list = [...restaurants];

  // ── Client-side distance filter (for walk/drive/radius modes) ──
  if (state.transport === 'walk') {
    const maxMin = +document.getElementById('walkTime').value;
    list = list.filter(r => {
      const wm = r.walkMinEstimate ?? r.walkMinutes;
      return wm == null || wm <= maxMin;
    });
  } else if (state.transport === 'drive') {
    const maxMin = +document.getElementById('driveTime').value;
    list = list.filter(r => {
      const dm = r.driveMinEstimate ?? r.driveMinutes;
      return dm == null || dm <= maxMin;
    });
  } else if (state.transport === 'radius') {
    const maxMi = state._homeRadius || +document.getElementById('radiusMiles').value || 1;
    list = list.filter(r => r.distanceMiles != null && r.distanceMiles <= maxMi);
  }
  // ── Trend/buzz filter — supports multiple selections (OR logic) ──
  const bfs = (state.trendFilters && state.trendFilters.length > 0) ? state.trendFilters : (state.buzzFilter && state.buzzFilter !== 'any' ? [state.buzzFilter] : []);
  if (bfs.length > 0) {
    list = list.filter(r => bfs.some(bf => {
      if (bf==='michelin') return (r.michelin?.stars||0)>=1;
      if (bf==='michelin_rec') return r.michelin_recommended || r.bib_gourmand || (r.michelin && (r.michelin.distinction==='recommended'||r.michelin.distinction==='bib_gourmand'));
      if (bf==='bib') return r.bib_gourmand || (r.michelin && (r.michelin.distinction==='bib_gourmand'||r.michelin.distinction==='bib'));
      if (bf==='press') {
        if (r.buzz_sources && r.buzz_sources.length > 0) return true;
        if (r.infatuation_url) return true;
        const bdata = getBuzzLinks(r.name);
        const hasEaterOrInfat = bdata?.links?.some(l => l.source==='Eater' || l.source==='The Infatuation' || l.source==='Infatuation');
        return hasEaterOrInfat || BUZZ_SET.has((r.name||'').toLowerCase().trim());
      }
      if (bf==='timeout') {
        if (r.buzz_sources && r.buzz_sources.some(s => s === 'Time Out' || s === 'TimeOut')) return true;
        const bdata = getBuzzLinks(r.name);
        return bdata?.links?.some(l => l.source==='timeout' || l.source==='Time Out');
      }
      if (bf==='nyt') return hasNYTCoverage(r);
      if (bf==='instagram') return !!(r.instagram_buzz && r.instagram_buzz.length > 0);
      if (bf==='google_amazing') return Number(r.googleRating||0)>=4.7 && Number(r.googleReviewCount||0)>=750;
      if (bf==='exceptional') return Number(r.googleRating||0) >= 4.7;
      if (bf==='new_rising') return r.new_rising || (r.velocity && r.velocity.growth30 >= 20);
      if (bf==='coming_soon') return !!r.coming_soon;
      return false;
    }));
  }

  // ── Cuisine filter ──
  if (state.cuisine && state.cuisine !== 'any') {
    const cs = state.cuisine.toLowerCase();
    list = list.filter(r => {
      const c = (r.cuisine || '').toLowerCase();
      return c.includes(cs) || (c && cs.includes(c));
    });
  }

  // ── Vibe filter — supports multiple selections (OR logic) ──
  const vfs = (state.vibeFilters && state.vibeFilters.length > 0) ? state.vibeFilters : (state.vibeFilter ? [state.vibeFilter] : []);
  if (vfs.length > 0) {
    list = list.filter(r => r.vibe_tags && vfs.every(vf => r.vibe_tags.includes(vf)));
  }

  if (state.priceFilter!=='any') {
    const pl = Number(state.priceFilter);
    list = list.filter(r => r.price_level===pl);
  }

  if (state.reviewCountFilter!=='any') {
    const minR = Number(state.reviewCountFilter);
    list = list.filter(r => (Number(r.googleReviewCount||0)) >= minR);
  }

  // Hide bilt-only restaurants (no booking URL) unless user specifically picked Bilt filter
  if (state.rewardsFilter !== 'bilt') {
    list = list.filter(r => !isBiltOnly(r));
  }

  if (state.rewardsFilter!=='any') {
    const rf = state.rewardsFilter;
    list = list.filter(r => {
      if (rf==='bilt') return r.bilt_dining || r.booking_platform==='bilt';
      if (rf==='chase_sapphire') return r.chase_sapphire;
      if (rf==='rakuten') return r.rakuten;
      if (rf==='inkind') return r.inkind;
      return true;
    });
  }

  // ── Availability filter (from home OR search page) ──
  const af = state.availFilter !== 'any' ? state.availFilter : homeState.availFilter;
  if (af && af !== 'any') {
    list = list.filter(r => {
      const tier = r.avail_tier;
      // Book in advance: booked tonight but available within next 14 days
      if (af === 'book_ahead') {
        const allDinnerBooked = r.early === 'booked' && r.prime === 'booked' && r.late === 'booked';
        return (tier === 'booked' || allDinnerBooked) && r.opens_in && r.opens_in <= 14;
      }
      if (r.coming_soon) return true;
      if (!tier) return false; // no data — hide when filtering by availability
      if (af === 'early') return r.has_early && tier !== 'booked';
      if (af === 'prime') return r.has_prime && tier !== 'booked';
      if (af === 'late')  return r.has_late  && tier !== 'booked';
      return true;
    });
  }

  list.sort((a,b) => {
    const aHasData = (Number(a.googleRating||0) > 0) || !!(a.booking_url);
    const bHasData = (Number(b.googleRating||0) > 0) || !!(b.booking_url);
    if (aHasData && !bHasData) return -1;
    if (!aHasData && bHasData) return 1;
    if (hotSpotsSortBy === 'distance') {
      const dA = a.distanceMiles != null ? a.distanceMiles : 9999;
      const dB = b.distanceMiles != null ? b.distanceMiles : 9999;
      if (dA !== dB) return dA - dB;
    } else if (hotSpotsSortBy === 'price_low') {
      const pA = a.price_level || 99, pB = b.price_level || 99;
      if (pA !== pB) return pA - pB;
    } else if (hotSpotsSortBy === 'price_high') {
      const pA = a.price_level || 0, pB = b.price_level || 0;
      if (pA !== pB) return pB - pA;
    } else {
      const rcA = Number(a.googleReviewCount||0), rcB = Number(b.googleReviewCount||0);
      const isWalkA = a.booking_platform==='walk_in'||a.booking_platform==='walkin';
      const isWalkB = b.booking_platform==='walk_in'||b.booking_platform==='walkin';
      function _pen(r, rc, isWalk) {
        if (isWalk) return 1;
        const rat = Number(r.googleRating||0);
        if (r.new_rising && rat >= 5) { if (rc >= 40) return 0; if (rc >= 25) return 1; return 2; }
        if (r.booking_platform === 'website' && rc < 200) return 1;
        if (!r.new_rising && rc > 0 && rc < 75) return 1;
        return 0;
      }
      const penA = _pen(a, rcA, isWalkA);
      const penB = _pen(b, rcB, isWalkB);
      const rA = Number(a.googleRating||0) - penA, rB = Number(b.googleRating||0) - penB;
      if (rB !== rA) return rB - rA;
      if (a.new_rising && !b.new_rising) return 1;
      if (!a.new_rising && b.new_rising) return -1;
    }
    return (b._bs||0)-(a._bs||0);
  });

  const isBookAhead = af === 'book_ahead';
  const avail=[], radar=[];
  list.forEach(r => { avail.push(r); });

  document.getElementById('resMeta').textContent = isBookAhead
    ? `${list.length} popular spot${list.length!==1?'s':''} — book ahead`
    : `${list.length} hot spot${list.length!==1?'s':''}`;

  // Pagination — render first 50, "Load More" for the rest
  const PAGE_SIZE = 50;
  _displayList = list;
  _displayedCount = Math.min(PAGE_SIZE, list.length);

  let html = '';
  if (isBookAhead) {
    html += `<div class="sec-head"><span class="sec-title hot">📅 Popular — Book in Advance</span><div class="sec-line"></div><span class="sec-count">${list.length}</span></div>`;
    html += list.slice(0, _displayedCount).map(r=>renderCard(r,false)).join('');
  } else {
    if (avail.length) {
      html += `<div class="sec-head"><span class="sec-title hot">🔥 Hot &amp; Available</span><div class="sec-line"></div><span class="sec-count">${avail.length}</span></div>`;
      html += avail.slice(0, _displayedCount).map(r=>renderCard(r,false)).join('');
    }
  }
  if (!list.length) {
    html = `<div class="empty"><div class="empty-icon">🍽️</div><div class="empty-title">${isBookAhead ? 'No book-ahead spots found' : 'No hot spots found'}</div><div class="empty-sub">Try adjusting your filters</div></div>`;
  }
  if (_displayedCount < list.length) {
    html += `<button id="loadMoreBtn" onclick="loadMoreResults()" style="width:100%;padding:14px;margin:16px 0;background:#fff;border:1px solid rgba(0,0,0,0.1);border-radius:12px;font-size:14px;font-weight:700;color:#1a1a2e;cursor:pointer;font-family:'DM Sans',sans-serif">Load ${Math.min(PAGE_SIZE, list.length - _displayedCount)} more &darr;</button>`;
  }
  document.getElementById('list').innerHTML = html;
}

let _displayList = [];
let _displayedCount = 0;
function loadMoreResults() {
  const PAGE_SIZE = 50;
  const nextCount = Math.min(_displayedCount + PAGE_SIZE, _displayList.length);
  const moreCards = _displayList.slice(_displayedCount, nextCount).map(r=>renderCard(r,false)).join('');
  _displayedCount = nextCount;
  const btn = document.getElementById('loadMoreBtn');
  if (btn) {
    btn.insertAdjacentHTML('beforebegin', moreCards);
    if (_displayedCount >= _displayList.length) btn.remove();
    else btn.textContent = 'Load ' + Math.min(PAGE_SIZE, _displayList.length - _displayedCount) + ' more ↓';
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
// Cache + debounce
let _searchCache = {};
let _searchDebounce = null;

function doSearchDebounced() {
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => doSearch(), 250);
}

async function doSearch() {
  if (searching && abortCtrl) abortCtrl.abort();
  const location = document.getElementById('addressInput').value.trim() || 'New York, NY';
  const cuisine = state.cuisine;
  searching = true;
  abortCtrl = new AbortController();

  const btn = document.getElementById('searchBtn');
  btn.textContent = '🔍 Finding Hot Spots...';
  btn.disabled = true;
  btn.classList.add('busy');

  document.getElementById('search').classList.add('hidden');
  document.getElementById('results').style.display = 'block';
  document.getElementById('warnings').innerHTML = '';
  document.getElementById('list').innerHTML = `<div style="text-align:center;padding:50px 20px"><div style="font-size:28px;margin-bottom:10px">🔥</div><div style="font-size:13px;font-weight:600;color:#444">Loading hot spots...</div></div>`;

  try {
    const tp = getTP();
    // Map buzz filter to quality param for the backend
    // If multiple trend filters selected, send 'any' and let client-side filter handle it
    const buzzToQuality = { michelin:'michelin', michelin_rec:'michelin_rec', bib:'bib_gourmand', any:'any', new_rising:'new_rising', coming_soon:'coming_soon' };
    const activeBuzz = (state.trendFilters && state.trendFilters.length === 1) ? state.trendFilters[0] : state.buzzFilter;
    const qualityParam = (state.trendFilters && state.trendFilters.length > 1) ? 'any' : (buzzToQuality[activeBuzz] || 'any');

    // Cache key — same params return cached result, no refetch
    const cacheKey = JSON.stringify({location, qualityParam, cuisine, transport: tp.transport, walkTime: tp.walkTime, driveTime: tp.driveTime, radiusMiles: tp.radiusMiles});
    let data;
    if (_searchCache[cacheKey]) {
      data = _searchCache[cacheKey];
    } else {
      const resp = await fetch('/.netlify/functions/search-candidates', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          location,
          quality: qualityParam,
          cuisine: cuisine==='any' ? undefined : cuisine,
          broadCity: state.transport !== 'radius' && state.transport !== 'walk' && state.transport !== 'drive' && (isBroadCity(location) || state.transport==='all_nyc'),
          transport: tp.transport,
          walkTime: tp.walkTime,
          driveTime: tp.driveTime,
          radiusMiles: tp.radiusMiles,
          hotSpotsOnly: true
        }),
        signal: abortCtrl.signal
      });
      data = await resp.json();
      if (!data?.error) _searchCache[cacheKey] = data;
    }
    if (data?.error) {
      document.getElementById('warnings').innerHTML = `<div class="err-banner">❌ ${data.error}</div>`;
      document.getElementById('list').innerHTML = `<div class="empty"><div class="empty-icon">😔</div><div class="empty-title">Search failed</div></div>`;
      return;
    }

    const addr = data.confirmedAddress || data.stats?.confirmedAddress;
    if (addr) document.getElementById('warnings').innerHTML = `<div class="loc-banner">📍 ${addr}</div>`;

    let results = [...(data.elite||[]), ...(data.moreOptions||[])];
    const seen = new Set();
    results = results.filter(r => { const k=(r.name||'').toLowerCase().trim(); if(!k||seen.has(k)) return false; seen.add(k); return true; });

    // Explicitly normalize booking fields so they're never lost
    results = results.map(r => ({
      ...r,
      booking_platform: r.booking_platform || null,
      booking_url: r.booking_url || null,
      website: r.website || null,
      vicinity: r.vicinity || r.formatted_address || r.address || null,
    }));

    allRestaurants = results;
    rawRestaurants = results;
    display(allRestaurants);

  } catch(err) {
    if (err.name==='AbortError') return;
    document.getElementById('warnings').innerHTML = `<div class="err-banner">😔 ${err.message||'Search failed'}</div>`;
    document.getElementById('list').innerHTML = `<div class="empty"><div class="empty-icon">😔</div><div class="empty-title">Something went wrong</div></div>`;
  } finally {
    searching = false;
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = 'Find Hot Spots';
  }
}

// ─── AVAILABILITY FILTER (search results page) ──────────────────────────────
function setSearchAvailFilter(val, btn) {
  document.querySelectorAll('#view-search .filter-chips .fchip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  state.availFilter = val;
  if (rawRestaurants.length > 0) display(rawRestaurants);
}

// ─── SORT ────────────────────────────────────────────────────────────────────
function setSortOrder(val) {
  hotSpotsSortBy = val;
  if (allRestaurants.length) display(allRestaurants);
}

// isBroadCity is defined in utils.js
