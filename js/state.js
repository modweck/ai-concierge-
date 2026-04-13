// ─── APPLICATION STATE ──────────────────────────────────────────────────────

// Home screen state
const homeState = {
  tab: 'hotspots',
  trendFilter: 'any',
  trendFilters: [],
  vibeFilter: null,
  vibeFilters: [],
  radiusMiles: 1,
  addr: '',
  cuisine: 'any',
  availFilter: 'tonight',
  horizonFilter: null
};

// Hot spots search state
const state = {
  cuisine: 'any',
  buzzFilter: 'any',
  trendFilters: [],
  priceFilter: 'any',
  rewardsFilter: 'any',
  reviewCountFilter: 'any',
  availFilter: 'any',
  transport: 'all_nyc',
  vibeFilter: null,
  vibeFilters: []
};

// All restaurants view state
const arState = {
  cuisine: 'any',
  buzzFilter: 'any',
  priceFilter: 'any',
  rewardsFilter: 'any',
  reviewCountFilter: 'any',
  transport: 'all_nyc',
  availFilter: 'any',
  horizonFilter: null,
  vibeFilter: null,
  hotspotFilter: 'any',
  hotspotFilters: []
};

// Bars/drinks view state
const barState = {
  transport: 'all_nyc',
  mood: 'any',
  specialty: 'any',
  lateNight: false,
  lateNightLevel: 'off',
  buzz: false,
  dayMode: 'weekday',
  priceLevel: 'any',
  allResults: [],
  sortBy: 'rating',
  availFilter: 'any',
  horizonFilter: null,
  vibeFilter: null
};

// Sort state
let hotSpotsSortBy = 'reviews';
let arSortBy = 'reviews';

// Global search variables
let allRestaurants = [];
let rawRestaurants = [];
let abortCtrl = null;
let searching = false;

// All NYC search variables
let allNYCRestaurants = [];
let allNYCSearching = false;
let allNYCAbort = null;
let allNYCCacheKey = '';

// Bar search variables
let barSearching = false;
let barAbort = null;
