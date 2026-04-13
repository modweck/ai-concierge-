// ─── ALL RESTAURANTS VIEW ───────────────────────────────────────────────────

// Init date for AR view
(function() {
  const t = new Date();
  const d = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const el = document.getElementById('arDateInput');
  if (el) { el.value = d; el.min = d; }
})();

const BUZZ_SET_AR = new Set(["15 east","4 charles prime rib","8282","abc cocina","abc kitchen","adda","ai fiori","al di la trattoria","altro paradiso","aquavit","aska","atera","atla","atoboy","atomix","babbo","bad roman","balthazar","bondst","bonnie's","buvette","carbone","cardamom","casa enrique","casa mono","catch","caviar russe","cecily","cervo's","charlie bird","ci siamo","claud","commerce","contra","coqodaq","cosme","craft","crown shy","dame","daniel","dante","dhamaka","don angie","double chicken please","eleven madison park","estela","fish cheeks","four twenty five","francie","frankies spuntino","frenchette","frevo","gabriel kreuther","gage & tollner","gramercy tavern","grand central oyster bar","haenyeo","hangawi","hart's","hasalon","hawksmoor","hearth","i sodi","il buco","il buco alimentari","indian accent","jack's wife freda","jeju noodle bar","jungsik","junoon","katz's","keens","king","kisa","kissaki","ko","kochi","kopitiam","la grande boucherie","laser wolf","le bernardin","le coucou","le pavillon","lilia","little owl","locanda verde","lucali","manhatta","marea","masa","minetta tavern","misi","momofuku ko","momofuku noodle bar","motorino","nami nori","nobu downtown","nom wah tea parlor","noreetuh","odo","ops","oxomoco","palma","pasquale jones","pastis","per se","peter luger","pig and khao","quality italian","quality meats","raf's","rao's","rezdora","roberta's","rubirosa","ruffian","saga","san sabino","sant ambroeus","scarr's pizza","semma","smith & wollensky","st. anselm","strip house","sugarfish","sunday in brooklyn","sushi nakazawa","tatiana","the dutch","the modern","the musket room","the polo bar","the river cafe","tiny's","torrisi","txikito","ugly baby","una pizza napoletana","union square cafe","via carota","wildair","win son","zuma"]);

function arSetTransport(mode, btn) {
  arState.transport = mode;
  document.querySelectorAll('#ar-tgroup .tbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['walk','drive','radius'].forEach(m => {
    const el = document.getElementById('ar-dd-' + m);
    if (el) el.classList.toggle('open', m === mode);
  });
}

function arSetAvail(val, btn) {
  ['ar-hor-3','ar-hor-5','ar-hor-7','ar-hor-14'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  ['ar-avail-any','ar-avail-limited','ar-avail-book_ahead','ar-avail-booked','ar-avail-early','ar-avail-prime','ar-avail-late'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  arState.availFilter = val; arState.horizonFilter = null;
  btn.classList.add('on');
  if (allNYCRestaurants.length > 0) displayAllNYC(allNYCRestaurants);
}
function arSetHorizon(days, btn) {
  ['ar-avail-any','ar-avail-limited','ar-avail-book_ahead','ar-avail-booked','ar-avail-early','ar-avail-prime','ar-avail-late'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  ['ar-hor-3','ar-hor-5','ar-hor-7','ar-hor-14'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  arState.availFilter = null; arState.horizonFilter = days;
  btn.classList.add('on');
}

function arSetVibe(vibe, btn) {
  arState.vibeFilter = vibe;
  document.querySelectorAll('[id^="ar-vibe-"]').forEach(b => b.classList.remove('on'));
  (btn || document.getElementById(vibe ? `ar-vibe-${vibe}` : 'ar-vibe-any')).classList.add('on');
}

function arSetHotspot(val, btn) {
  if (val === 'any') {
    arState.hotspotFilters = ['michelin','michelin_rec','nyt','press','timeout','instagram','google_amazing','new_rising'];
    arState.hotspotFilter = 'any';
    document.querySelectorAll('[id^="ar-hot-"]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  } else {
    const idx = arState.hotspotFilters.indexOf(val);
    if (idx > -1) {
      arState.hotspotFilters.splice(idx, 1);
      btn.classList.remove('on');
    } else {
      arState.hotspotFilters.push(val);
      btn.classList.add('on');
    }
    const anyBtn = document.getElementById('ar-hot-any');
    if (arState.hotspotFilters.length > 0) {
      anyBtn && anyBtn.classList.remove('on');
      arState.hotspotFilter = arState.hotspotFilters[0];
    } else {
      arState.hotspotFilter = 'none';
    }
  }
  // Coming Soon: render hardcoded list directly
  if (val === 'coming_soon' && arState.hotspotFilters.includes('coming_soon')) {
    var _cs = [
      {name:"Or'esh", hood:"SoHo"},
      {name:"Soba Ulala by Hirohisa", hood:"LES"},
      {name:"Beto's Carnitas & Guisados", hood:"Lower East Side"},
      {name:"Death & Co East Village", hood:"East Village"},
      {name:"Please Don't Tell (PDT)", hood:"East Village"},
      {name:"10Cubed", hood:"Meatpacking"},
      {name:"Erewhon", hood:"Tribeca"}
    ];
    var _html = _cs.map(function(r){
      return '<div style="padding:16px 20px;border-bottom:1px solid #f0f0f0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><div style="font-size:15px;font-weight:700;color:#1a1a1a">' + r.name + '</div>' +
        '<div style="font-size:12px;color:#888;margin-top:3px">' + r.hood + '</div></div>' +
        '<span style="background:#fef3c7;color:#92400e;border:1px solid rgba(146,64,14,.2);font-size:12px;padding:4px 10px;border-radius:6px;font-weight:700;white-space:nowrap">🚀 Coming Soon</span>' +
        '</div></div>';
    }).join('');
    document.getElementById('allRestMeta').textContent = _cs.length + ' restaurants';
    document.getElementById('allRestList').innerHTML = _html;
    return;
  }
  if (allNYCRestaurants.length > 0) displayAllNYC(allNYCRestaurants);
}

function arSetCuisine(val) {
  arState.cuisine = val;
  if (allNYCRestaurants.length > 0) displayAllNYC(allNYCRestaurants);
}

function arAdjParty(d) {
  const el = document.getElementById('arParty');
  if (el) el.value = Math.max(1, Math.min(20, +el.value + d));
}

function arUseGPS() {
  if (!navigator.geolocation) return;
  const el = document.getElementById('arAddrInput');
  if (el) el.placeholder = 'Getting location...';
  navigator.geolocation.getCurrentPosition(async pos => {
    const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    if (el) {
      el.value = addr || `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      el.placeholder = 'Enter your address or neighborhood...';
    }
  }, () => { if (el) el.placeholder = 'Enter your address or neighborhood...'; });
}

function renderCardAR(r) {
  const name = tcAR(r.name) || 'Unknown';
  const addr = (r.vicinity || r.formatted_address || r.address || '').replace(/,?\s*U\.?S\.?A?\.?$/i, '');
  const walkStr = r.walkMinEstimate > 0 && r.walkMinEstimate < 999 ? `🚶 ${r.walkMinEstimate} min` : null;
  const driveStr = r.driveMinEstimate > 0 && r.driveMinEstimate < 999 ? `🚗 ${r.driveMinEstimate} min` : null;
  const sub = [r.cuisine, addr, r.distanceMiles != null && r.distanceMiles < 999 ? `${r.distanceMiles} mi` : null, walkStr, driveStr].filter(Boolean).join(' · ');
  const price = r.price_level > 0 ? `<span style="color:#888;font-size:12px">${'$'.repeat(r.price_level)}</span>` : '';

  // Vibe tag pills
  let vibeHtml = '';
  if (r.vibe_tags && r.vibe_tags.length) {
    const pills = r.vibe_tags.slice(0,4).map(v => {
      const emoji = VIBE_EMOJI[v] || '';
      const label = VIBE_LABEL[v] || v.replace(/_/g,' ');
      return `<span class="badge vibe">${emoji} ${label}</span>`;
    }).join('');
    vibeHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px">${pills}</div>`;
  }

  let badges = '';
  if (r.michelin) {
    const st = r.michelin.stars || 0, d2 = r.michelin.distinction || '';
    if (st >= 1) badges += `<span class="badge mstar">${'⭐'.repeat(Math.min(st,3))} Michelin</span>`;
    else if (d2 === 'bib_gourmand' || d2 === 'bib') badges += `<span class="badge bib">🍽️ Bib Gourmand</span>`;
    else badges += `<span class="badge bib">✨ Michelin Rec</span>`;
  }
  if (hasBuzzAR(r) && !r.michelin) badges += `<span class="badge press">📰 Press Pick</span>`;
  if (!r.michelin) {
    const isNYT_AR = (r.buzz_sources && r.buzz_sources.some(s => s === 'NYT' || s === 'NY Times')) || r.pete_wells || r.nyt_top_100;
    if (isNYT_AR) {
      // Remove generic press pick if NYT
      badges = badges.replace(`<span class="badge press">📰 Press Pick</span>`, '');
      if (r.nyt_top_100) {
        const blAR = BUZZ_LINKS[r.name] || BUZZ_LINKS[(r.name||'').toLowerCase()];
        const nytLinkAR = blAR && blAR.links && blAR.links.find(l => l.source === 'NYT');
        const rm = nytLinkAR && nytLinkAR.label && nytLinkAR.label.match(/#(\d+)/);
        const rs = rm ? ` #${rm[1]}` : '';
        badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.2)">📰 NYT Top 100${rs}</span>`;
      } else if (r.pete_wells && r.nyt_stars) {
        const stars = '★'.repeat(Math.min(r.nyt_stars, 4));
        badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.2)">📰 NYT ${stars}</span>`;
      } else {
        badges += `<span class="badge" style="background:#eef2ff;color:#4338ca;border:1px solid rgba(67,56,202,.15)">📰 NYT</span>`;
      }
    }
  }
  const rat = Number(r.googleRating || 0), rev = Number(r.googleReviewCount || 0);
  if (rat >= 4.0 && rev > 0) {
    const rs = rev >= 1000 ? (rev/1000).toFixed(1)+'k' : rev;
    const opacity = rat >= 4.7 ? '1' : rat >= 4.4 ? '.8' : '.55';
    badges += `<span class="badge goog" style="opacity:${opacity}">⭐ ${rat} (${rs})</span>`;
  } else if (rat >= 4.0) {
    badges += `<span class="badge goog" style="opacity:.55">⭐ ${rat}</span>`;
  }

  // inKind badge — show for restaurants with a booking platform, or when inkind filter is active
  if (r.inkind && (hasBookingPlatformAR(r) || arState.rewardsFilter === 'inkind'))
    badges += `<span class="badge inkind">🔥 inKind 20% Off</span>`;

  // Bilt badge
  if (r.bilt_dining && (hasBookingPlatformAR(r) || arState.rewardsFilter === 'bilt'))
    badges += `<span class="badge bilt">Bilt Dining</span>`;

  // Rakuten badge
  if (r.rakuten && (hasBookingPlatformAR(r) || arState.rewardsFilter === 'rakuten'))
    badges += `<span class="badge rakuten">🛍️ Rakuten Cash Back</span>`;

  const tier = availTierAR(r);
  let availHtml = '';
  const _nameLower = (r.name || '').toLowerCase();
  const _sundayOnly = _nameLower.includes('fini williamsburg');
  const _walkInOnly = _nameLower.includes('lucali') || _nameLower.includes('okdongsik');

  if (_sundayOnly) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#f3e5f5;color:#6a1b9a;border:1px solid rgba(106,27,154,.25)">🟣 Only Open Sunday</span></div>`;
  } else if (_walkInOnly) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#fff3e0;color:#ef6c00;border:1px solid rgba(239,108,0,.25)">🚶 Walk-in · Long Waits</span></div>`;
  } else if (tier === 'booked' && r.opens_in) {
    availHtml = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:9px"><span class="avail hard" style="margin-bottom:0">🔴 Booked Tonight</span><span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:4px;background:#e8f5e9;color:#2e7d32;border:1px solid rgba(46,125,50,.25)">🟢 Opens +${r.opens_in}d</span></div>`;
  } else if (tier === 'booked' && r.fully_locked) {
    availHtml = `<div><span class="avail hard" style="background:#2a2a2a;color:#fff;border-color:#2a2a2a">⚫ Fully Booked</span></div>`;
  } else if (tier === 'booked') {
    availHtml = `<div><span class="avail hard">🔴 Fully Booked Tonight</span></div>`;
  } else if (tier === 'available') availHtml = `<div><span class="avail av">🟢 Available Tonight</span></div>`;
  else if (tier === 'limited') availHtml = `<div><span class="avail lim">🟡 Limited Spots</span></div>`;
  else if (tier === 'hard') availHtml = `<div><span class="avail hard" style="background:#2a2a2a;color:#fff;border-color:#2a2a2a">Booked Solid</span></div>`;

  const instaHandle = r.instagram || INSTA[(r.name||'').toLowerCase()];
  const mapsUrl = r.place_id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name||'')}&query_place_id=${r.place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((r.name||'')+' restaurant New York NY')}`;

  let bookBtn = '';
  if (r.booking_url && r.booking_platform) {
    const bmap = {resy:{cls:'resy',label:'Book on Resy →'},opentable:{cls:'opentable',label:'Book on OpenTable →'},tock:{cls:'tock',label:'Book on Tock →'},website:{cls:'site',label:'Book →'},walkin:{cls:'site',label:'🚶 Walk-ins Welcome'}};
    const s = bmap[r.booking_platform] || {cls:'site', label:'Book →'};
    bookBtn = `<a href="${r.booking_url}" target="_blank" rel="noopener" class="bbtn ${s.cls}">${s.label}</a>`;
  } else if (r.website) {
    bookBtn = `<a href="${r.website}" target="_blank" rel="noopener" class="bbtn site">Visit Website →</a>`;
  } else {
    bookBtn = `<a href="${mapsUrl}" target="_blank" rel="noopener" class="bbtn google">Find on Google →</a>`;
  }

  let cardLinks = '';
  if (r.website || instaHandle || (r.instagram_buzz && r.instagram_buzz.length > 0)) {
    cardLinks = '<div class="card-links">';
    if (r.website) cardLinks += `<a href="${r.website}" target="_blank" rel="noopener" class="web-link">🌐 Website</a>`;
    if (instaHandle) {
      const ch = instaHandle.replace(/^@/,'').replace(/https?:\/\/.*instagram\.com\//,'').replace(/\/?$/,'');
      cardLinks += `<a href="https://www.instagram.com/${ch}" target="_blank" rel="noopener" class="insta-link">📸 @${ch}</a>`;
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

  return `<div class="card">
    <div class="card-top"><div class="card-name">${name}</div>${price}</div>
    <div class="card-sub">${sub}</div>
    ${vibeHtml}
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    ${availHtml}
    <div class="actions">${bookBtn}<a href="${mapsUrl}" target="_blank" rel="noopener" class="mapbtn">📍</a></div>
    ${cardLinks}
  </div>`;
}

function applyARFilters(list) {
  const bf = arState.buzzFilter, pf = arState.priceFilter, tp = arState.transport;
  if (tp === 'walk') { const m = +document.getElementById('arWalkTime').value; list = list.filter(r => (r.walkMinEstimate ?? 999) <= m); }
  else if (tp === 'drive') { const m = +document.getElementById('arDriveTime').value; list = list.filter(r => (r.driveMinEstimate ?? 999) <= m); }
  else if (tp === 'radius') { const m = +document.getElementById('arRadiusMiles').value; list = list.filter(r => (r.distanceMiles ?? 999) <= m); }
  if (bf === 'michelin') list = list.filter(r => (r.michelin?.stars || 0) >= 1);
  else if (bf === 'michelin_rec') list = list.filter(r => r.michelin_recommended || r.bib_gourmand || (r.michelin && (r.michelin.distinction === 'recommended' || r.michelin.distinction === 'bib_gourmand')));
  else if (bf === 'bib') list = list.filter(r => r.bib_gourmand || (r.michelin && (r.michelin.distinction === 'bib_gourmand' || r.michelin.distinction === 'bib')));
  else if (bf === 'press') list = list.filter(r => hasBuzzAR(r));
  else if (bf === 'nyt') list = list.filter(r => hasBuzzAR(r));
  else if (bf === 'google_amazing') list = list.filter(r => Number(r.googleRating||0) >= 4.7 && Number(r.googleReviewCount||0) >= 750);
  else if (bf === 'new_rising') list = list.filter(r => r.new_rising || (r.velocity && r.velocity.growth30 >= 20));
  else if (bf === 'coming_soon') list = list.filter(r => r.coming_soon);
  else if (bf === 'good') list = list.filter(r => { const rg = Number(r.googleRating||0); return rg >= 4.2 && rg < 4.5; });
  else if (bf === 'still_good') list = list.filter(r => { const rg = Number(r.googleRating||0); return rg >= 4.2 && rg < 4.5; });
  else if (bf === 'any') {} // no filter
  else if (bf === 'very_good') list = list.filter(r => { const rg = Number(r.googleRating||0); return rg >= 4.5 && rg < 4.65; });
  else if (bf === 'great') list = list.filter(r => { const rg = Number(r.googleRating||0); return rg >= 4.6 && rg < 4.75; });
  else if (bf === 'exceptional') list = list.filter(r => Number(r.googleRating||0) >= 4.8 || (r.michelin?.stars||0) >= 1);
  if (pf === 'multi' && arState.priceLevels && arState.priceLevels.length > 0) {
    const mn = Math.min(...arState.priceLevels), mx = Math.max(...arState.priceLevels);
    list = list.filter(r => r.price_level >= mn && r.price_level <= mx);
  } else if (pf !== 'any') list = list.filter(r => r.price_level === Number(pf));
  if (arState.reviewCountFilter && arState.reviewCountFilter !== 'any') {
    const minR = Number(arState.reviewCountFilter);
    list = list.filter(r => (Number(r.googleReviewCount||0)) >= minR);
  }
  if (arState.cuisine && arState.cuisine !== 'any') {
    const cs = arState.cuisine.toLowerCase();
    list = list.filter(r => { const cc = (r.cuisine || '').toLowerCase().trim(); return cc.includes(cs) || (cc && cs.includes(cc)); });
  }
  // Hide bilt-only restaurants (no booking URL) unless user specifically picked Bilt filter
  if (arState.rewardsFilter !== 'bilt') {
    list = list.filter(r => !isBiltOnly(r));
  }

  const rf = arState.rewardsFilter;
  if (rf !== 'any') {
    list = list.filter(r => {
      if (rf==='bilt') return r.bilt_dining || r.booking_platform==='bilt';
      if (rf==='chase_sapphire') return r.chase_sapphire;
      if (rf==='rakuten') return r.rakuten;
      if (rf==='inkind') return r.inkind;
      return true;
    });
  }
  // ── Hot Spots filter (multi-select OR logic, same as Hot Spots view) ──
  const hsfs = (arState.hotspotFilters && arState.hotspotFilters.length > 0) ? arState.hotspotFilters : (arState.hotspotFilter && arState.hotspotFilter !== 'any' ? [arState.hotspotFilter] : []);
  if (hsfs.length > 0) {
    list = list.filter(r => hsfs.some(hsf => {
      if (hsf==='michelin') return (r.michelin?.stars||0)>=1;
      if (hsf==='michelin_rec') return r.michelin_recommended || r.bib_gourmand || (r.michelin && (r.michelin.distinction==='recommended'||r.michelin.distinction==='bib_gourmand'));
      if (hsf==='nyt') return hasNYTCoverage(r);
      if (hsf==='press') {
        if (r.buzz_sources && r.buzz_sources.length > 0) return true;
        if (r.infatuation_url) return true;
        const bdata = getBuzzLinks(r.name);
        const hasEaterOrInfat = bdata?.links?.some(l => l.source==='Eater' || l.source==='The Infatuation' || l.source==='Infatuation');
        return hasEaterOrInfat || BUZZ_SET_AR.has((r.name||'').toLowerCase().trim());
      }
      if (hsf==='timeout') {
        if (r.buzz_sources && r.buzz_sources.some(s => s === 'Time Out' || s === 'TimeOut')) return true;
        const bdata = getBuzzLinks(r.name);
        return bdata?.links?.some(l => l.source==='timeout' || l.source==='Time Out');
      }
      if (hsf==='instagram') return !!(r.instagram_buzz && r.instagram_buzz.length > 0);
      if (hsf==='google_amazing') return Number(r.googleRating||0)>=4.7 && Number(r.googleReviewCount||0)>=750;
      if (hsf==='exceptional') return Number(r.googleRating||0) >= 4.7;
      if (hsf==='new_rising') return r.new_rising || (r.velocity && r.velocity.growth30 >= 20);
      if (hsf==='coming_soon') return !!r.coming_soon;
      return false;
    }));
  }
  // ── Availability filter ──
  const af = arState.availFilter;
  const hf = arState.horizonFilter;
  if (af && af !== 'any') {
    list = list.filter(r => {
      const tier = r.avail_tier || availTierAR(r);
      if (af === 'book_ahead') {
        const allDinnerBooked = r.early === 'booked' && r.prime === 'booked' && r.late === 'booked';
        return (tier === 'booked' || allDinnerBooked) && r.opens_in && r.opens_in <= 14;
      }
      if (r.coming_soon) return true;
      if (!tier) return false;
      if (af === 'limited') return tier === 'limited';
      if (af === 'booked_solid') return tier === 'booked' || tier === 'booked_solid';
      if (af === 'early') return r.has_early && tier !== 'booked';
      if (af === 'prime') return r.has_prime && tier !== 'booked';
      if (af === 'late')  return r.has_late  && tier !== 'booked';
      return true;
    });
  }
  // ── Vibe filter ──
  if (arState.vibeFilter) {
    list = list.filter(r => r.vibe_tags && r.vibe_tags.includes(arState.vibeFilter));
  }
  return list;
}

function displayAllNYC(restaurants) {
  const filtered = applyARFilters([...restaurants]);
  document.getElementById('allRestMeta').textContent = `${filtered.length} restaurant${filtered.length !== 1 ? 's' : ''}`;
  if (!filtered.length) {
    document.getElementById('allRestList').innerHTML = `<div style="text-align:center;padding:50px 20px;color:#555"><div style="font-size:36px;margin-bottom:12px">🍽️</div><div>No restaurants match these filters</div></div>`;
    return;
  }
  // Sort based on dropdown selection
  filtered.sort((a, b) => {
    const aHasData = (Number(a.googleRating||0) > 0) || !!(a.booking_url);
    const bHasData = (Number(b.googleRating||0) > 0) || !!(b.booking_url);
    if (aHasData && !bHasData) return -1;
    if (!aHasData && bHasData) return 1;
    if (arSortBy === 'distance') {
      const dA = a.distanceMiles != null ? a.distanceMiles : 9999;
      const dB = b.distanceMiles != null ? b.distanceMiles : 9999;
      if (dA !== dB) return dA - dB;
    } else if (arSortBy === 'price_low') {
      const pA = a.price_level || 99, pB = b.price_level || 99;
      if (pA !== pB) return pA - pB;
    } else if (arSortBy === 'price_high') {
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
      const rA = Number(a.googleRating||0) - _pen(a, rcA, isWalkA);
      const rB = Number(b.googleRating||0) - _pen(b, rcB, isWalkB);
      if (rB !== rA) return rB - rA;
      if (a.new_rising && !b.new_rising) return 1;
      if (!a.new_rising && b.new_rising) return -1;
    }
    return 0;
  });
  document.getElementById('allRestList').innerHTML = filtered.map(r => renderCardAR(r)).join('');
}

function setARSortOrder(val) {
  arSortBy = val;
  if (allNYCRestaurants.length) displayAllNYC(allNYCRestaurants);
}

async function doAllNYCSearch() {
  if (allNYCSearching && allNYCAbort) allNYCAbort.abort();
  allNYCSearching = true;
  allNYCAbort = new AbortController();

  document.getElementById('ar-form').style.display = 'none';
  document.getElementById('ar-results').style.display = 'block';

  const listEl = document.getElementById('allRestList');
  const warnEl = document.getElementById('allRestWarnings');
  listEl.innerHTML = `<div style="text-align:center;padding:50px 20px"><div style="font-size:28px;margin-bottom:10px">📍</div><div style="font-size:13px;font-weight:600;color:#555">Loading all restaurants...</div></div>`;
  warnEl.innerHTML = '';

  const btn = document.getElementById('arSearchBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Searching...'; }

  // Cache key — re-fetch when quality, cuisine, transport, or coming_soon filter changes
  const hasCS = arState.hotspotFilters && arState.hotspotFilters.includes('coming_soon');
  const cacheKey = `${arState.buzzFilter}|${arState.cuisine}|${arState.transport}|${document.getElementById('arAddrInput')?.value.trim()||'nyc'}|cs:${hasCS}`;
  if (allNYCRestaurants.length > 0 && allNYCCacheKey === cacheKey) {
    displayAllNYC(allNYCRestaurants);
    allNYCSearching = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Find Restaurants'; }
    return;
  }
  allNYCCacheKey = cacheKey;
  allNYCRestaurants = [];

  try {
    const location = document.getElementById('arAddrInput')?.value.trim() || 'New York, NY';
    const cuisine = arState.cuisine === 'any' ? undefined : arState.cuisine;
    const isAllNYC = arState.transport === 'all_nyc';

    // Map quality dropdown → backend quality param
    // 'any' (All Restaurants) = 'all' on backend = no rating floor
    // 'very_good' / 'great' / 'exceptional' pass straight through
    const hasComingSoon = arState.hotspotFilters && arState.hotspotFilters.includes('coming_soon');
    const qualityParam = 'all';

    const resp = await fetch('/.netlify/functions/search-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        quality: qualityParam,
        cuisine,
        broadCity: isAllNYC,
        transport: arState.transport,
        walkTime: document.getElementById('arWalkTime')?.value,
        driveTime: document.getElementById('arDriveTime')?.value,
        radiusMiles: document.getElementById('arRadiusMiles')?.value
      }),
      signal: allNYCAbort.signal
    });
    const data = await resp.json();
    if (data?.error) {
      warnEl.innerHTML = `<div style="padding:12px 20px;color:#f87171;font-size:13px">❌ ${data.error}</div>`;
      listEl.innerHTML = '';
      return;
    }
    let results = [...(data.elite || []), ...(data.moreOptions || [])];

    // If coming_soon filter is active, also fetch coming_soon results and merge
    if (hasComingSoon) {
      try {
        const csResp = await fetch('/.netlify/functions/search-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location, quality: 'coming_soon', broadCity: true, transport: 'all_nyc' })
        });
        const csData = await csResp.json();
        results.push(...(csData.elite || []), ...(csData.moreOptions || []));
      } catch {}
    }

    const seen = new Set();
    results = results.filter(r => { const k=(r.name||'').toLowerCase().trim(); if(!k||seen.has(k)) return false; seen.add(k); return true; });
    results = results.map(r => ({ ...r, name: r.name||r.vicinity||'', booking_platform: r.booking_platform||null, booking_url: r.booking_url||null, website: r.website||null }));
    allNYCRestaurants = results;
    displayAllNYC(allNYCRestaurants);
  } catch(err) {
    if (err.name === 'AbortError') return;
    warnEl.innerHTML = `<div style="padding:12px 20px;color:#f87171;font-size:13px">😔 ${err.message || 'Search failed'}</div>`;
    listEl.innerHTML = '';
  } finally {
    allNYCSearching = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Find Restaurants'; }
  }
}
