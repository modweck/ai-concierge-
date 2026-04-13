// ─── NAVIGATION ─────────────────────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById('view-' + name).classList.add('on');
}

function switchNav(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navKey = name === 'allrestaurants' ? 'search' : name;
  const navEl = document.getElementById('nav-' + navKey);
  if (navEl) navEl.classList.add('active');
  if (name === 'allrestaurants') showView('allrestaurants');
  else if (name === 'search') {
    // Reset Hot Spots to All NYC default
    state.transport = 'all_nyc';
    document.querySelectorAll('#tgroup .tbtn').forEach(b => b.classList.remove('active'));
    const allNYCBtn = document.querySelector('#tgroup .tbtn:last-child');
    if (allNYCBtn) allNYCBtn.classList.add('active');
    ['walk','drive','radius'].forEach(m => {
      const el = document.getElementById('dd-' + m);
      if (el) el.classList.remove('open');
    });
    showView('search');
    doSearch();
  }
  else if (name === 'home') showView('home');
  else if (name === 'drinks') {
    const bf = document.getElementById('bar-form');
    const br = document.getElementById('bar-results');
    if (bf) bf.style.display = 'block';
    if (br) br.style.display = 'none';
    showView('drinks');
  }
  else showView(name);
  // Sync hero tab highlights across all tab switchers
  syncHeroTabs(name);
}

function syncHeroTabs(activeView) {
  // Map view name to tab index (0=hotspots, 1=allrestaurants, 2=drinks)
  const tabMap = { home: 0, hotspots: 0, allrestaurants: 1, drinks: 2 };
  const activeIdx = tabMap[activeView] ?? 0;
  document.querySelectorAll('.hero-tabs .hero-tab').forEach((btn, i) => {
    const tabGroup = Math.floor(i / 3); // group by sets of 3
    const posInGroup = i % 3;
    btn.classList.toggle('active', posInGroup === activeIdx);
  });
  // Also sync the home hero-tab buttons by ID
  const ids = ['ht-hotspots', 'ht-all', 'ht-drinks'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', i === activeIdx);
  });
}

function setHeroTab(tab, btn) {
  homeState.tab = tab;
  if (tab === 'all') {
    switchNav('allrestaurants');
    document.getElementById('ar-form').style.display = 'block';
    document.getElementById('ar-results').style.display = 'none';
    allNYCRestaurants = [];
  } else if (tab === 'drinks') {
    switchNav('drinks');
    document.getElementById('bar-form').style.display = 'block';
    document.getElementById('bar-results').style.display = 'none';
  } else if (tab === 'hotspots') {
    switchNav('home');
  }
}

// Stub functions for backward compatibility
function setTrendingFilter1() {}
function setTrendingFilter2() {}
function setNearbyCuisine() {}
function setNearbyPrice() { goToSearch(); }

// Back navigation
function goBack() {
  allRestaurants = [];
  rawRestaurants = [];
  document.getElementById('search').classList.remove('hidden');
  document.getElementById('results').style.display = 'none';
  document.getElementById('list').innerHTML = '';
  document.getElementById('warnings').innerHTML = '';
}

function arGoBack() {
  document.getElementById('ar-results').style.display = 'none';
  document.getElementById('ar-form').style.display = 'block';
}

function barGoBack() {
  document.getElementById('bar-results').style.display = 'none';
  document.getElementById('bar-form').style.display = 'block';
}
