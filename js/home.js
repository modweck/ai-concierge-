// ─── HOME SCREEN ────────────────────────────────────────────────────────────

function setAvailFilter(val, btn) {
  homeState.horizonFilter = null;
  ['hor-3','hor-5','hor-7','hor-14'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('on'); });
  ['avail-any','avail-tonight','avail-early','avail-prime','avail-late'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('on'); });
  homeState.availFilter = val;
  btn.classList.add('on');
  const labels = { any:'Any Time', tonight:'Tonight', early:'Early (6–7:30)', prime:'Prime Time', late:'Late Night' };
  const vb = document.getElementById('trendingViewBtn');
  if (vb) vb.textContent = 'View Hot Spots — ' + (labels[val] || 'Tonight');
}

function setHorizonFilter(days, btn) {
  homeState.availFilter = null;
  homeState.horizonFilter = days;
  ['avail-any','avail-tonight','avail-early','avail-prime','avail-late'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('on'); });
  ['hor-3','hor-5','hor-7','hor-14'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('on'); });
  btn.classList.add('on');
  const vb = document.getElementById('trendingViewBtn');
  if (vb) vb.textContent = 'View Hot Spots — Next ' + days + ' Days';
}

function setTrendFilter(buzz, btn) {
  if (buzz === 'any') {
    homeState.trendFilters = [];
    homeState.trendFilter = 'any';
    document.querySelectorAll('#trendingChips .fchip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    return;
  }
  const idx = homeState.trendFilters.indexOf(buzz);
  if (idx > -1) {
    homeState.trendFilters.splice(idx, 1);
    btn.classList.remove('on');
  } else {
    homeState.trendFilters.push(buzz);
    btn.classList.add('on');
  }
  const anyBtn = document.querySelector('#trendingChips .fchip');
  if (homeState.trendFilters.length > 0) {
    anyBtn && anyBtn.classList.remove('on');
    homeState.trendFilter = homeState.trendFilters[0];
  } else {
    anyBtn && anyBtn.classList.add('on');
    homeState.trendFilter = 'any';
  }
}

function setVibeFilter(vibe, btn) {
  const idx = homeState.vibeFilters.indexOf(vibe);
  if (idx > -1) {
    homeState.vibeFilters.splice(idx, 1);
    btn.classList.remove('on');
  } else {
    homeState.vibeFilters.push(vibe);
    btn.classList.add('on');
  }
  homeState.vibeFilter = homeState.vibeFilters[0] || null;
}

function setRadius(miles, btn) {
  homeState.radiusMiles = miles;
  document.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function homeUseGPS() {
  if (!navigator.geolocation) return;
  const el = document.getElementById('homeAddrInput');
  if (el) el.placeholder = 'Getting location...';
  navigator.geolocation.getCurrentPosition(
    async p => {
      const coordStr = p.coords.latitude + ',' + p.coords.longitude;
      const addr = await reverseGeocode(p.coords.latitude, p.coords.longitude);
      if (el) {
        el.value = addr || coordStr;
        el.placeholder = 'Enter your address or neighborhood...';
      }
      homeState.addr = addr || coordStr;
    },
    () => { if (el) el.placeholder = 'Enter your address or neighborhood...'; alert('Could not get location'); }
  );
}

function goToSearchWithAddr(cuisineOverride) {
  // Transfer address from home screen
  const addr = document.getElementById('homeAddrInput').value.trim();
  if (addr) document.getElementById('addressInput').value = addr;

  // Cuisine — use override (card click) or dropdown selection
  const cuisine = cuisineOverride || document.getElementById('homeCuisine').value || 'any';

  // Restaurant name — if filled, use as address/location search hint
  const restName = document.getElementById('homeRestInput') ? document.getElementById('homeRestInput').value.trim() : '';
  if (restName && !addr) {
    document.getElementById('addressInput').value = restName + ' New York, NY';
  }

  // Set radius/transport
  const r = homeState.radiusMiles;
  if (r === 0) {
    state.transport = 'all_nyc';
    document.querySelectorAll('#tgroup .tbtn').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('#tgroup .tbtn:last-child');
    if (allBtn) allBtn.classList.add('active');
    ['walk','drive','radius'].forEach(m => {
      const el = document.getElementById('dd-' + m);
      if (el) el.classList.remove('open');
    });
  } else {
    state.transport = 'radius';
    document.querySelectorAll('#tgroup .tbtn').forEach(b => b.classList.remove('active'));
    const radiusBtn = document.querySelector('#tgroup .tbtn:nth-child(3)');
    if (radiusBtn) radiusBtn.classList.add('active');
    const rSelect = document.getElementById('radiusMiles');
    if (rSelect) { rSelect.value = r; }
    document.getElementById('dd-walk').classList.remove('open');
    document.getElementById('dd-drive').classList.remove('open');
    document.getElementById('dd-radius').classList.add('open');
  }

  goToSearch(null, cuisine);
}

function goToSearch(buzz, cuisine) {
  showView('search');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-search').classList.add('active');
  // Always sync buzz filter from home screen — reset to 'any' when no specific filter
  if (buzz && buzz !== 'any') {
    state.buzzFilter = buzz;
  } else {
    state.buzzFilter = 'any';
  }
  const buzzSel = document.getElementById('buzzFilter');
  if (buzzSel) buzzSel.value = state.buzzFilter;

  if (cuisine) {
    state.cuisine = cuisine;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    document.querySelectorAll('.chip').forEach(c => {
      const oc = c.getAttribute('onclick') || '';
      if (oc.includes("'" + cuisine + "'")) c.classList.add('on');
    });
  }
  // Sync home address bar if filled
  const homeAddr = document.getElementById('homeAddrInput');
  const mainInput = document.getElementById('addressInput');
  if (homeAddr && homeAddr.value.trim()) mainInput.value = homeAddr.value;

  // Apply radius from home screen — store directly so getTP() uses it reliably
  const r = homeState.radiusMiles;
  if (r === 0) {
    state.transport = 'all_nyc';
    state._homeRadius = 0;
  } else {
    state.transport = 'radius';
    state._homeRadius = r;
    const rSelect = document.getElementById('radiusMiles');
    if (rSelect) rSelect.value = r;
  }

  // Sync vibe filter from home screen
  state.vibeFilter = homeState.vibeFilter || null;
  state.vibeFilters = homeState.vibeFilters || [];
  state.trendFilters = homeState.trendFilters || [];

  // Auto-fire search so results show immediately
  doSearch();
}
