const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function compressResponse(statusCode, body) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const compressed = zlib.gzipSync(json);
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    body: compressed.toString('base64'),
    isBase64Encoded: true,
  };
}

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  try { return require('node-fetch')(...args); }
  catch (e) { throw new Error("fetch not available. Use Node 18+ or add node-fetch."); }
};

let MICHELIN_BASE = [];
try {
  MICHELIN_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'michelin_nyc.json'), 'utf8'));
  console.log(`\u2705 Michelin base: ${MICHELIN_BASE.length} entries`);
} catch (err) { console.warn('\u274c Michelin base missing:', err.message); }

let BIB_GOURMAND_BASE = [];
try {
  BIB_GOURMAND_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'bib_gourmand_nyc.json'), 'utf8'));
  console.log(`\u2705 Bib Gourmand base: ${BIB_GOURMAND_BASE.length} entries`);
} catch (err) { console.warn('\u274c Bib Gourmand base missing:', err.message); }

let CHASE_SAPPHIRE_BASE = [];
try {
  CHASE_SAPPHIRE_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'chase_sapphire_nyc.json'), 'utf8'));
  console.log(`\u2705 Chase Sapphire base: ${CHASE_SAPPHIRE_BASE.length} entries`);
} catch (err) { console.warn('\u274c Chase Sapphire base missing:', err.message); }

let RAKUTEN_BASE = [];
try {
  RAKUTEN_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'rakuten_nyc.json'), 'utf8'));
  console.log(`\u2705 Rakuten base: ${RAKUTEN_BASE.length} entries`);
} catch (err) { console.warn('\u274c Rakuten base missing:', err.message); }

let POPULAR_BASE = [];
try {
  POPULAR_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'popular_nyc.json'), 'utf8'));
  console.log(`\u2705 Popular base: ${POPULAR_BASE.length} entries`);
} catch (err) { console.warn('\u26a0\ufe0f Popular base missing:', err.message); }

let DEPOSIT_LOOKUP = {};
try {
  DEPOSIT_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'deposit_lookup.json'), 'utf8'));
  console.log(`\u2705 Deposit lookup: ${Object.keys(DEPOSIT_LOOKUP).length} entries`);
} catch (err) { console.warn('\u274c Deposit lookup missing:', err.message); }

let BOOKING_LOOKUP = {};
let BOOKING_KEYS = [];
try {
  BOOKING_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'booking_lookup.json'), 'utf8'));
  BOOKING_KEYS = Object.keys(BOOKING_LOOKUP);
  console.log(`\u2705 Booking lookup: ${BOOKING_KEYS.length} entries`);
} catch (err) { console.warn('\u274c Booking lookup missing:', err.message); }

// ── MASTER BOOK (primary source — 8,400+ restaurants) ──
let MASTER_BOOK = {};
let MASTER_KEYS = [];
let AVAILABILITY_BOOK = {};
try {
  MASTER_BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, 'BOOKING_MASTER.json'), 'utf8'));
  // Build case-insensitive lookup so enrichNYT can find "Babbo Ristorante" via "babbo ristorante"
  for (const key of Object.keys(MASTER_BOOK)) {
    const lk = key.toLowerCase();
    if (lk !== key && !MASTER_BOOK[lk]) MASTER_BOOK[lk] = MASTER_BOOK[key];
  }
  MASTER_KEYS = Object.keys(MASTER_BOOK);
  console.log(`✅ Master book: ${MASTER_KEYS.length} restaurants`);
} catch (err) { console.warn('⚠️ Master book missing, using booking_lookup:', err.message); }
try {
  AVAILABILITY_BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, 'tonight_availability.json'), 'utf8'));
  const availCount = Object.keys(AVAILABILITY_BOOK).filter(k => !k.startsWith('_')).length;
  console.log(`✅ Tonight availability: ${availCount} restaurants`);
  // Merge full OT availability at load time
  try {
    const otAvail = JSON.parse(fs.readFileSync(path.join(__dirname, 'tonight_availability_ot.json'), 'utf8'));
    let otMerged = 0;
    for (const [name, val] of Object.entries(otAvail)) {
      if (name.startsWith('_')) continue;
      const key = name.toLowerCase();
      if (!AVAILABILITY_BOOK[key] || val.checked_date > (AVAILABILITY_BOOK[key].checked_date || '')) {
        AVAILABILITY_BOOK[key] = val;
        otMerged++;
      }
    }
    if (otMerged) console.log(`✅ Merged OT availability: ${otMerged} restaurants`);
  } catch(e) {}
  // Merge Google Reserve availability — overrides false "booked" from OT/Resy
  try {
    const googleAvail = JSON.parse(fs.readFileSync(path.join(__dirname, 'tonight_availability_google.json'), 'utf8'));
    let googleMerged = 0;
    for (const [name, val] of Object.entries(googleAvail)) {
      if (name.startsWith('_')) continue;
      const key = name.toLowerCase();
      const existing = AVAILABILITY_BOOK[key];
      // Override if: no existing data, or existing says booked but Google says open/limited
      if (!existing || (existing.tier === 'booked' && (val.tier === 'open' || val.tier === 'limited'))) {
        AVAILABILITY_BOOK[key] = val;
        googleMerged++;
      }
    }
    if (googleMerged) console.log(`✅ Merged Google Reserve availability: ${googleMerged} restaurants`);
  } catch(e) {}
} catch (err) { console.warn('⚠️ Availability book missing:', err.message); }

// Build normalized availability lookup for fuzzy name matching
const AVAIL_LOOKUP = {};
const AVAIL_LOCATIONS = ['midtown', 'downtown', 'uptown', 'williamsburg', 'bushwick', 'greenpoint', 'les', 'ues', 'uws', 'fidi', 'soho', 'noho', 'nolita', 'tribeca', 'chelsea', 'flatiron', 'gramercy', 'murray hill', 'hells kitchen', "hell's kitchen", 'east village', 'west village', 'lower east side', 'upper east side', 'upper west side', 'bowery', 'harlem', 'astoria', 'brooklyn', 'queens', 'bronx', 'staten island', 'long island city', 'flushing', 'fort greene', 'park slope', 'cobble hill', 'boerum hill', 'prospect heights', 'crown heights', 'bed-stuy', 'dumbo', 'financial district', 'kips bay', 'nomad', 'two bridges', 'chinatown', 'little italy', 'meatpacking'];
const AVAIL_SUFFIXES = ['restaurant', 'ristorante', 'bistro', 'brasserie', 'trattoria', 'osteria', 'cafe', 'café', 'bar & grill', 'bar and grill', 'nyc', 'ny', 'new york', 'kitchen', 'house', 'grill', 'tavern', 'pub', 'lounge'];

function availNorm(s) {
  let n = s.toLowerCase();
  // Strip " - Location" suffix (before removing apostrophes so "hell's kitchen" matches)
  const locPattern = new RegExp('\\s*[-–—]\\s*(' + AVAIL_LOCATIONS.join('|') + ')\\s*$', 'i');
  n = n.replace(locPattern, '');
  // Also strip location as trailing words (no dash): "Pasta Eater Hell's Kitchen"
  const locTrailing = new RegExp('\\s+(' + AVAIL_LOCATIONS.join('|') + ')\\s*$', 'i');
  n = n.replace(locTrailing, '');
  // Strip " (Location)" parenthetical
  n = n.replace(/\s*\([^)]+\)\s*$/, '');
  // Now strip apostrophes/quotes for uniform matching
  n = n.replace(/[''\']/g, '');
  // Strip trailing suffixes like "restaurant", "bistro", etc.
  const sufPattern = new RegExp('\\s+(' + AVAIL_SUFFIXES.join('|') + ')\\s*$', 'i');
  n = n.replace(sufPattern, '');
  // Replace hyphens/dashes with spaces, then clean non-alphanumeric
  n = n.replace(/[-–—]/g, ' ');
  return n.replace(/[^a-z0-9\s&]/g, '').replace(/\s+/g, ' ').trim();
}

(function buildAvailLookup() {
  // Track which normalized keys have multiple entries (collision) — skip those
  const normCount = {};
  for (const [key, val] of Object.entries(AVAILABILITY_BOOK)) {
    if (key.startsWith('_')) continue;
    AVAIL_LOOKUP[key] = val;
    AVAIL_LOOKUP[key.toLowerCase()] = val;
    const normed = availNorm(key);
    if (normed) normCount[normed] = (normCount[normed] || 0) + 1;
  }
  // Only add normalized keys that have exactly ONE match (no ambiguity)
  for (const [key, val] of Object.entries(AVAILABILITY_BOOK)) {
    if (key.startsWith('_')) continue;
    const normed = availNorm(key);
    if (normed && normCount[normed] === 1 && !AVAIL_LOOKUP[normed]) AVAIL_LOOKUP[normed] = val;
  }
  const skipped = Object.values(normCount).filter(c => c > 1).length;
  console.log(`✅ Availability lookup: ${Object.keys(AVAIL_LOOKUP).length} keys (from ${Object.keys(AVAILABILITY_BOOK).filter(k=>!k.startsWith('_')).length} restaurants, ${skipped} ambiguous norms skipped)`);
})();

function getAvail(name) {
  if (!name) return null;
  const hit = AVAIL_LOOKUP[name] || AVAIL_LOOKUP[name.toLowerCase()] || AVAIL_LOOKUP[availNorm(name)];
  if (hit) return hit;
  // Chain restaurant fallback: "STK - Nyc - Meatpacking" → try matching keys starting with "stk - " or "stk meatpacking"
  const lower = name.toLowerCase().trim();
  const dashIdx = lower.indexOf(' - ');
  if (dashIdx > 0) {
    const base = lower.substring(0, dashIdx).trim();
    // Extract location parts after dashes
    const parts = lower.split(/\s*-\s*/);
    const locParts = parts.slice(1).map(p => p.trim()).filter(Boolean);
    // Try "base location" combos (e.g. "stk meatpacking")
    for (const loc of locParts) {
      const tryKey = base + ' ' + loc;
      const found = AVAIL_LOOKUP[tryKey] || AVAIL_LOOKUP[availNorm(tryKey)];
      if (found) return found;
    }
    // Try just the base name as exact key
    const baseHit = AVAIL_LOOKUP[base] || AVAIL_LOOKUP[availNorm(base)];
    if (baseHit) return baseHit;
  }
  return null;
}

let CUISINE_LOOKUP = {};
try {
  CUISINE_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'cuisine_lookup.json'), 'utf8'));
  console.log(`\u2705 Cuisine lookup: ${Object.keys(CUISINE_LOOKUP).length} entries`);
} catch (err) { console.warn('\u26a0\ufe0f Cuisine lookup missing:', err.message); }

let BUZZ_LOOKUP = {};
try {
  BUZZ_LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'buzz_lookup.json'), 'utf8'));
  console.log(`\u2705 Buzz lookup: ${Object.keys(BUZZ_LOOKUP).length} entries`);
} catch (err) { console.warn('\u26a0\ufe0f Buzz lookup missing:', err.message); }

// ── INSTAGRAM BUZZ (influencer posts mentioning this restaurant) ──
let INSTAGRAM_BUZZ = {};
try {
  INSTAGRAM_BUZZ = JSON.parse(fs.readFileSync(path.join(__dirname, 'instagram_buzz.json'), 'utf8'));
  // Build case-insensitive lookup for instagram buzz
  for (const key of Object.keys(INSTAGRAM_BUZZ)) {
    const lk = key.toLowerCase();
    if (lk !== key && !INSTAGRAM_BUZZ[lk]) INSTAGRAM_BUZZ[lk] = INSTAGRAM_BUZZ[key];
  }
  console.log(`✅ Instagram buzz: ${Object.keys(INSTAGRAM_BUZZ).length} restaurants with influencer links`);
} catch (err) { console.warn('⚠️ Instagram buzz missing:', err.message); }
// ── REVIEW VELOCITY DATA ──
let REVIEW_SNAPSHOTS = {};
try {
  REVIEW_SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'review_snapshots.json'), 'utf8'));
  const withVelocity = Object.values(REVIEW_SNAPSHOTS).filter(r => r.snapshots && r.snapshots.length >= 2).length;
  console.log(`\u2705 Review snapshots: ${Object.keys(REVIEW_SNAPSHOTS).length} restaurants (${withVelocity} with velocity data)`);
} catch (err) { console.warn('\u26a0\ufe0f Review snapshots missing:', err.message); }

/**
 * Calculate review velocity for a restaurant
 * Returns object with growth stats or null if not enough data
 */
function getReviewVelocity(placeId) {
  if (!placeId || !REVIEW_SNAPSHOTS[placeId]) return null;
  const data = REVIEW_SNAPSHOTS[placeId];
  if (!data.snapshots || data.snapshots.length < 2) return null;

  const latest = data.snapshots[data.snapshots.length - 1];
  const oldest = data.snapshots[0];
  const daysBetween = Math.max(1, (new Date(latest.date) - new Date(oldest.date)) / 86400000);
  const growth = latest.review_count - oldest.review_count;
  const growthPer30 = Math.round((growth / daysBetween) * 30);

  return {
    growth30: growthPer30,
    totalGrowth: growth,
    daysTracked: Math.round(daysBetween),
    latestCount: latest.review_count,
    latestRating: latest.rating,
    firstSeen: data.first_seen || oldest.date
  };
}

// ── BUZZ RESTAURANTS (Eater, Infatuation, TimeOut, Grub Street coverage) ──
// These bypass quality tier filters and get a 4.4 score floor
const BUZZ_RESTAURANTS = new Set([
  '15 east',
  '188 bakery cuchifritos',
  '4 charles prime rib',
  '8282',
  'a sushi',
  'a&a bake and doubles',
  'abc cocina',
  'abc kitchen',
  'abc kitchens - dumbo',
  'abuqir seafood',
  'adda',
  'agi\'s counter',
  'ai fiori',
  'al di la trattoria',
  'alley 41',
  'almond',
  'alta calidad',
  'altro paradiso',
  'amber',
  'anton\'s',
  'anything',
  'aquavit',
  'aska',
  'askili orchard',
  'asset',
  'atera',
  'atla',
  'atoboy',
  'atomix',
  'augustine',
  'avenue',
  'avra madison estiatorio',
  'babbo',
  'bad roman',
  'balthazar',
  'bamonte\'s',
  'bananas',
  'banh anh em',
  'bar',
  'bar kabawa',
  'bar mario',
  'bar miller',
  'bar pitti',
  'barbetta',
  'barbuto',
  'barney greengrass',
  'bartolo',
  'bayon',
  'bea',
  'beauty & essex',
  'becco',
  'bird dog',
  'birds',
  'birria-landia',
  'bistrot ha',
  'blend',
  'blu on the hudson',
  'blue hill',
  'blue hill at stone barns',
  'blue ribbon sushi',
  'bohemian spirit',
  'bondst',
  'bongkoch',
  'bonnie\'s',
  'boqueria ues',
  'borgo',
  'boro6 wine bar',
  'bouquet',
  'bowery meat company',
  'branch',
  'brass',
  'brick',
  'bridges',
  'briscola',
  'brooklyn chop house',
  'bubby\'s',
  'buddakan',
  'bungalow',
  'burrata',
  'buvette',
  'bánh anh em',
  'c as in charlie',
  'cadence',
  'cafe boulud',
  'cafe cluny',
  'cafe fiorello',
  'cafe kestrel',
  'cafe mado',
  'cafe mogador',
  'cafe zaffri',
  'café mars',
  'café spaghetti',
  'caleta 111 cevicheria',
  'carbone',
  'cardamom',
  'carmine\'s',
  'carnitas ramirez',
  'casa enrique',
  'casa mono',
  'catch',
  'cathédrale',
  'caviar russe',
  'cecily',
  'celestine',
  'cervo\'s',
  'cha kee',
  'chalong',
  'chambers',
  'charlie bird',
  'chavela\'s',
  'chef\'s table at brooklyn fare',
  'cheli',
  'chez fifi',
  'chez ma tante',
  'cho dang gol',
  'chongqing lao zao',
  'chuan tian xia',
  'chutney masala',
  'ci siamo',
  'cipriani downtown',
  'claro',
  'claud',
  'clinton st. baking company',
  'clover hill',
  'cocina consuelo',
  'colonie',
  'commerce',
  'concrete',
  'confidant',
  'contra',
  'cookshop',
  'coqodaq',
  'cosme',
  'cote',
  'court street',
  'covacha',
  'craft',
  'crave fishbar',
  'crave fishbar uws',
  'crown shy',
  'da toscano',
  'dame',
  'daniel',
  'dante',
  'david burke tavern',
  'del frisco\'s double eagle steakhouse',
  'delmonico\'s',
  'demo',
  'dhamaka',
  'di an di',
  'di fara pizza',
  'dim sum go go',
  'dimes',
  'dirt candy',
  'don angie',
  'don peppe',
  'double',
  'double chicken please',
  'dowling\'s',
  'drift restaurant & bar',
  'drink',
  'dubuhaus',
  'egg',
  'eleven madison park',
  'emily',
  'emmett\'s on grove',
  'emmy squared',
  'empellón',
  'emporio',
  'ends meat',
  'enoteca maria',
  'entre nous',
  'estela',
  'estiatorio milos',
  'ewe\'s delicious treats',
  'extra virgin',
  'eyval',
  'fairfax',
  'falansai',
  'famous',
  'fasano',
  'fedora',
  'felina steak',
  'fig & olive',
  'fish cheeks',
  'five leaves',
  'flora bar',
  'fogo de chao',
  'fogo de chão',
  'four twenty five',
  'francie',
  'frankies spuntino',
  'freemans',
  'frenchette',
  'frevo',
  'gabriel kreuther',
  'gage & tollner',
  'gallaghers steakhouse',
  'gaonnuri',
  'gjelina',
  'gnocchi bar',
  'golden diner',
  'golden steer',
  'gordo\'s cantina',
  'gotham',
  'gramercy tavern',
  'grand central oyster bar',
  'great ny noodletown',
  'gupshup',
  'h',
  'ha\'s snack bar',
  'haenyeo',
  'hags',
  'hainan chicken house',
  'hakata tonton',
  'hakkasan',
  'hamburger america',
  'han dynasty lic',
  'han dynasty uws',
  'hangawi',
  'harry\'s',
  'hart\'s',
  'hasalon',
  'hawksmoor',
  'hawksmoor nyc',
  'hearth',
  'hellbender',
  'ho foods',
  'hometown bar b que new york',
  'houseman',
  'hupo',
  'hutong new york',
  'i cavallini',
  'i sodi',
  'ichimura',
  'il buco',
  'il buco alimentari',
  'il mulino',
  'ilili midtown',
  'indian accent',
  'industry',
  'insa',
  'ippudo',
  'ishq',
  'jack\'s wife freda',
  'jajaja mexicana',
  'jean-georges',
  'jeffrey\'s grocery',
  'jeju noodle bar',
  'jiang nan',
  'joe allen',
  'joe\'s shanghai',
  'joo ok',
  'joseph leonard',
  'juliana\'s pizza',
  'jungsik',
  'junoon',
  'jupiter',
  'kabawa',
  'kanan',
  'kanyakumari',
  'katz\'s',
  'keens',
  'keens steakhouse',
  'king',
  'kisa',
  'kissaki',
  'ko',
  'kochi',
  'koloman',
  'kono',
  'kopitiam',
  'kosaka',
  'kru',
  'kung fu little steamed buns ramen',
  'kyma',
  'l\'abeille',
  'l\'artusi',
  'l\'industrie pizzeria',
  'la bonne soupe',
  'la dong',
  'la grande boucherie',
  'la marchande',
  'la masseria',
  'lafayette',
  'laghman express',
  'lakruwana',
  'laliko',
  'land',
  'laser wolf',
  'lavo',
  'laziza',
  'le b.',
  'le bernardin',
  'le chene',
  'le chêne',
  'le coucou',
  'le crocodile',
  'le pavillon',
  'le rock',
  'le veau d\'or',
  'legacy records',
  'legend of taste',
  'levant',
  'levantine',
  'lexington candy shop',
  'lilia',
  'lincoln ristorante',
  'little alley',
  'little italy',
  'little myanmar',
  'little owl',
  'llama inn',
  'llama san',
  'locanda verde',
  'loi estiatorio',
  'lola\'s',
  'lord\'s',
  'lore',
  'loring place',
  'lucali',
  'lucia pizza of avenue x',
  'lucien',
  'lucky',
  'lunar',
  'lungi',
  'lupa',
  'lure fishbar',
  'maddy rose',
  'madera',
  'maialino mare',
  'maison pickle',
  'maison premiere',
  'manhatta',
  'marea',
  'market table',
  'masa',
  'mastro\'s steakhouse',
  'messy',
  'meximodo',
  'milk bar',
  'minetta tavern',
  'misi',
  'miss ada',
  'mission chinese food',
  'mitsuru',
  'mixteca',
  'miznon',
  'momofuku ko',
  'momofuku noodle bar',
  'momoya upper west',
  'moody tongue sushi',
  'morimoto',
  'motorino',
  'mozzarella',
  'mr chow',
  'muku',
  'málà project',
  'mắm',
  'nami nori',
  'neighbors',
  'nerai',
  'nerina',
  'nobu downtown',
  'nom wah tea parlor',
  'noodle village',
  'noreetuh',
  'noz market',
  'o',
  'oasis',
  'ocean prime',
  'odo',
  'oiji mi',
  'okdongsik',
  'okiboru house of tsukemen',
  'old homestead steakhouse',
  'old sport',
  'olio e più',
  'olmo',
  'olmsted',
  'one if by land two if by sea',
  'one white street',
  'ops',
  'oso',
  'ovelia psistaria bar',
  'oxalis',
  'oxomoco',
  'palma',
  'parcelle chinatown',
  'parcelle greenwich village',
  'pasquale jones',
  'pastis',
  'pastrami queen',
  'patsy\'s italian restaurant',
  'paulie gee\'s',
  'peasant',
  'peking duck house',
  'penny',
  'peppercorn station',
  'per se',
  'pera mediterranean brasserie',
  'peter luger',
  'phayul',
  'philippe chow',
  'phoenix palace',
  'pierozek',
  'pig and khao',
  'pinch chinese',
  'place des fêtes',
  'popular',
  'potluck club',
  'pranakhon',
  'quality italian',
  'quality meats',
  'raf\'s',
  'raku',
  'randazzo\'s clam bar',
  'raoul\'s',
  'ras plant based',
  'razza',
  'red hook tavern',
  'red rooster',
  'renaissance',
  'rezdora',
  'rice thief',
  'richardson',
  'rider',
  'riverpark',
  'roast',
  'roberta\'s',
  'rolo\'s',
  'rosa mexicano',
  'rubirosa',
  'ruffian',
  'rule of thirds',
  'runner up',
  'russ & daughters cafe',
  's & p lunch',
  'sadelle\'s',
  'saga',
  'sagara',
  'sailor',
  'sal tang\'s',
  'salty lunch lady\'s little luncheonette',
  'san sabino',
  'sant ambroeus',
  'santi',
  'sappeisan',
  'saranrom thai',
  'sauced',
  'scarpetta',
  'scarr\'s pizza',
  'schmuck',
  'sea',
  'semma',
  'seoul',
  'serendipity 3',
  'serendipity 3 times square',
  'settepani',
  'shalom japan',
  'shaw-nae\'s',
  'shaw-naé\'s house',
  'shukette',
  'shuko',
  'smith & wollensky',
  'snail',
  'soba totto',
  'socarrat east',
  'sofreh',
  'souraji',
  'sparks steak house',
  'speedy romeo',
  'spice',
  'st. anselm',
  'st. jardim',
  'steak frites',
  'steam',
  'sticky rice',
  'stk steakhouse',
  'strange delight',
  'stretch pizza',
  'strip house',
  'sugarfish',
  'sunday',
  'sunday in brooklyn',
  'sunn\'s',
  'superiority burger',
  'sushi amane',
  'sushi ginza onodera',
  'sushi nakazawa',
  'sushi noz',
  'sushi on me',
  'sushi ouji',
  'sushi sho',
  'sylvia\'s',
  'szechuan mountain house',
  'tacombi',
  'taim mediterranean kitchen',
  'taiwanese gourmet',
  'tamarind',
  'tao downtown',
  'tao uptown',
  'tatiana',
  'tatiana by kwame onwuachi',
  'tavern on the green',
  'taverna kyclades',
  'temple canteen',
  'terre',
  'tha phraya',
  'thai diner',
  'the bar room at the modern',
  'the brick',
  'the corner',
  'the dining room at gramercy tavern',
  'the dutch',
  'the four horsemen',
  'the golden swan',
  'the grill',
  'the lobster club',
  'the mermaid inn',
  'the modern',
  'the musket room',
  'the odeon',
  'the polo bar',
  'the pool',
  'the river cafe',
  'the sea fire grill',
  'the smith',
  'the snail',
  'the standard grill',
  'the tavern at gramercy tavern',
  'the view',
  'theodora',
  'third falcon',
  'tiny\'s',
  'tolo',
  'toloache',
  'tonchin',
  'tong sam gyup goo yi',
  'tony\'s di napoli',
  'torrisi',
  'tribeca grill',
  'trinciti roti shop',
  'tsukimi',
  'twist',
  'txikito',
  'ugly baby',
  'una pizza napoletana',
  'union square cafe',
  'untable',
  'upland',
  'verde',
  'veselka',
  'via carota',
  'village café',
  'waverly inn',
  'wayla',
  'wayne & sons',
  'wayward fare',
  'westville',
  'westville hell\'s kitchen',
  'westville lic',
  'westville uws',
  'white bear',
  'wild cherry',
  'wildair',
  'win son',
  'wolfgang\'s steakhouse',
  'wonder',
  'yellow rose',
  'yemenat',
  'yoon haeundae galbi',
  'zaab zaab',
  'zou zou\'s',
  'zuma',
  'çka ka qëllue',
]);

function isBuzzRestaurant(name) {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  return BUZZ_RESTAURANTS.has(n) || !!BUZZ_LOOKUP[n];
}

// ── SEATWIZE SCORE ──
// Blended quality score: Google rating + Michelin prestige bonus
// Michelin starred (1-3★): +0.2 | Bib Gourmand / Recommended: +0.1
// No review count bonuses/penalties — Google already factors volume
function enrichNYT(r) {
  const mk = (r.name || '').toLowerCase().trim();
  const entry = MASTER_BOOK[mk] || MASTER_BOOK[mk.replace(/^the /, '')] || {};
  if (!r.buzz_sources || r.buzz_sources.length === 0) {
    r.buzz_sources = entry.buzz_sources || [];
  }
  if (!r.nyt_stars && entry.nyt_stars) r.nyt_stars = entry.nyt_stars;
  if (!r.pete_wells && entry.pete_wells) r.pete_wells = entry.pete_wells;
  if (!r.nyt_top_100 && entry.nyt_top_100) r.nyt_top_100 = entry.nyt_top_100;
  if (!r.pete_wells_rank && entry.pete_wells_rank) r.pete_wells_rank = entry.pete_wells_rank;
  if (!r.instagram_buzz) r.instagram_buzz = INSTAGRAM_BUZZ[mk] || INSTAGRAM_BUZZ[mk.replace(/^the /, '')] || null;
  if (!r.vibe_tags || r.vibe_tags.length === 0) r.vibe_tags = entry.vibe_tags || [];
  if (!r.bib_gourmand && entry.bib_gourmand) r.bib_gourmand = entry.bib_gourmand;
  if (!r.michelin_recommended && entry.michelin_recommended) r.michelin_recommended = entry.michelin_recommended;
  if (!r.michelin && entry.michelin_stars) r.michelin = { stars: entry.michelin_stars, distinction: 'star' };
  else if (!r.michelin && entry.bib_gourmand) r.michelin = { stars: 0, distinction: 'bib_gourmand' };
  else if (!r.michelin && entry.michelin_recommended) r.michelin = { stars: 0, distinction: 'recommended' };
  if (!r.website && entry.website) r.website = entry.website;
  if (!r.instagram && entry.instagram) r.instagram = entry.instagram;
  // Enrich availability from tonight_availability
  const avail = getAvail(mk);
  const plat = (entry.platform || r.booking_platform || '').toLowerCase();
  const hasRealPlatform = plat === 'resy' || plat === 'opentable' || plat === 'tock' || plat === 'sevenrooms';
  if (avail && hasRealPlatform) {
    if (!r.avail_tier) r.avail_tier = avail.tier || null;
    if (!r.opens_in && avail.opens_in) r.opens_in = avail.opens_in;
    if (!r.prepaid_price && avail.prepaid_price) r.prepaid_price = avail.prepaid_price;
    if (!r.fully_locked && avail.fully_locked) r.fully_locked = true;
    if (avail.sunday_only) r.sunday_only = true;
    if (avail.walk_in_only) r.walk_in_only = true;
    if (r.has_early === undefined || r.has_early === null) r.has_early = avail.has_early || false;
    if (r.has_prime === undefined || r.has_prime === null) r.has_prime = avail.has_prime || false;
    if (r.has_late === undefined || r.has_late === null) r.has_late = avail.has_late || false;
    if (!r.early) r.early = avail.early || null;
    if (!r.prime) r.prime = avail.prime || null;
    if (!r.late) r.late = avail.late || null;
  }
  return r;
}

function computeSeatWizeScore(r) {
  let score = r.googleRating || 0;
  if (score === 0) return 0;

  // Michelin bonus only
  if (r.michelin) {
    const stars = r.michelin.stars || 0;
    if (stars >= 1) score += 0.2;
    else score += 0.1; // bib_gourmand or recommended
  }

  score = Math.min(5.0, Math.round(score * 10) / 10);

  // Floor: Any hot spot (Michelin, Bib, NYT, press, Instagram buzz) never drops below 4.5
  const isHotSpot = r.michelin || r.bib_gourmand || r.nyt_top_100 || r.pete_wells
    || (r.buzz_sources && r.buzz_sources.length > 0)
    || r.infatuation_url
    || (r.instagram_buzz && r.instagram_buzz.length > 0)
    || isBuzzRestaurant(r.name);
  if (isHotSpot && score < 4.5) score = 4.5;

  return score;
}

// ── RESERVATION LIKELIHOOD DATA ──
let LIKELIHOOD_DATA = {};
let LIKELIHOOD_TIME_MODS = {};
let LIKELIHOOD_PARTY_MODS = {};
try {
  LIKELIHOOD_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'reservation_likelihood.json'), 'utf8'));
  LIKELIHOOD_TIME_MODS = LIKELIHOOD_DATA._time_modifiers || {};
  LIKELIHOOD_PARTY_MODS = LIKELIHOOD_DATA._party_size_modifiers || {};
  const count = Object.keys(LIKELIHOOD_DATA).filter(k => !k.startsWith('_')).length;
  console.log(`\u2705 Reservation likelihood: ${count} restaurants profiled`);
} catch (err) { console.warn('\u26a0\ufe0f Reservation likelihood missing:', err.message); }

/**
 * Get reservation likelihood for a restaurant
 * Returns the pre-computed profile or null
 */
function getReservationLikelihood(placeId) {
  if (!placeId || !LIKELIHOOD_DATA[placeId]) return null;
  const data = LIKELIHOOD_DATA[placeId];
  if (!data.demand_score && data.demand_score !== 0) return null;
  return data;
}

const CUISINE_FILTER_MAP = {
  'american':       ['American', 'Soul Food', 'Hawaiian', 'Tex-Mex'],
  'barbecue':       ['Barbecue'],
  'chinese':        ['Chinese', 'Cantonese', 'Taiwanese'],
  'french':         ['French'],
  'greek':          ['Greek'],
  'indian':         ['Indian'],
  'italian':        ['Italian', 'Pizza'],
  'japanese':       ['Japanese', 'Sushi', 'Ramen'],
  'korean':         ['Korean'],
  'mediterranean':  ['Mediterranean', 'Turkish', 'Israeli', 'Middle Eastern', 'Lebanese', 'Moroccan', 'Persian'],
  'mexican':        ['Mexican', 'Latin'],
  'seafood':        ['Seafood'],
  'spanish':        ['Spanish'],
  'steakhouse':     ['Steakhouse'],
  'sushi':          ['Sushi'],
  'thai':           ['Thai'],
  'vietnamese':     ['Vietnamese'],
  'kosher':         ['Kosher']
};

function cuisineLookupMatches(name, userCuisine, fallbackCuisine) {
  if (!userCuisine || !name) return true;
  const allowed = CUISINE_FILTER_MAP[userCuisine.toLowerCase()] || [];
  if (allowed.length === 0) return true; // no filter map entry = can't filter, allow

  // Check CUISINE_LOOKUP first (most accurate source)
  const c = CUISINE_LOOKUP[name];
  if (c) {
    return c.split('/').some(p => allowed.some(a => p.trim().toLowerCase().includes(a.toLowerCase())));
  }

  // Fallback: check the restaurant's own cuisine field
  if (fallbackCuisine) {
    const fb = String(fallbackCuisine).toLowerCase();
    return allowed.some(a => fb.includes(a.toLowerCase()));
  }

  // Not in lookup AND no fallback cuisine → EXCLUDE (strict mode)
  return false;
}

function normalizeForBooking(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s*[-\u2013\u2014]\s*(midtown|downtown|uptown|east village|west village|tribeca|soho|noho|brooklyn|queens|fidi|financial district|nomad|lincoln square|nyc|new york|manhattan|ny).*$/i, '')
    .replace(/\s+(restaurant|ristorante|nyc|ny|new york|bar & restaurant|bar and restaurant|bar & grill|bar and grill|steakhouse|trattoria|pizzeria|cafe|caf\u00e9|bistro|brasserie|kitchen|dining|room)$/i, '')
    .replace(/^the\s+/, '')
    .trim();
}

function normalizeApostrophes(s) {
  return s.replace(/[\u2018\u2019\u201A\u201B\u2032\u0060]/g, "'");
}

function getBookingInfo(name) {
  if (!name) return null;
  const key = normalizeApostrophes(name.toLowerCase().trim());
  if (BOOKING_LOOKUP[key]) return BOOKING_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, '');
  if (BOOKING_LOOKUP[noThe]) return BOOKING_LOOKUP[noThe];
  const norm = normalizeForBooking(name);
  if (norm && BOOKING_LOOKUP[norm]) return BOOKING_LOOKUP[norm];
  for (const lk of BOOKING_KEYS) {
    if (lk.length < 4) continue;
    if (key.includes(lk) || lk.includes(key)) return BOOKING_LOOKUP[lk];
    if (norm && norm.length >= 4 && (norm.includes(lk) || lk.includes(norm))) return BOOKING_LOOKUP[lk];
  }
  // Fall back to MASTER_BOOK with apostrophe normalization
  let masterEntry = MASTER_BOOK[key] || MASTER_BOOK[noThe];
  if (!masterEntry) {
    for (const mk of MASTER_KEYS) {
      const mkNorm = normalizeApostrophes(mk.toLowerCase());
      if (mkNorm === key || mkNorm === noThe) { masterEntry = MASTER_BOOK[mk]; break; }
    }
  }
  if (masterEntry) {
    const bookingUrl = masterEntry.booking_url || masterEntry.url || null;
    const platform = masterEntry.platform || masterEntry.booking_platform || null;
    if (bookingUrl && platform && platform !== 'none' && platform !== 'unknown') {
      return { platform, url: bookingUrl };
    }
  }
  return null;
}

function getDepositType(name) {
  if (!name) return 'unknown';
  const key = name.toLowerCase().trim();
  if (DEPOSIT_LOOKUP[key]) return DEPOSIT_LOOKUP[key];
  const noThe = key.replace(/^the\s+/, '');
  if (DEPOSIT_LOOKUP[noThe]) return DEPOSIT_LOOKUP[noThe];
  return 'unknown';
}

let MICHELIN_RESOLVED = null;
let MICHELIN_RESOLVED_AT = 0;
const MICHELIN_RESOLVE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

async function detectBookingPlatforms(restaurants, KEY) {
  // Pass 1: Check booking lookup table (instant, no API calls)
  for (const r of restaurants) {
    if (r.booking_platform) continue;
    const bookingInfo = getBookingInfo(r.name);
    if (bookingInfo) {
      r.booking_platform = bookingInfo.platform;
      r.booking_url = bookingInfo.url;
    }
  }

  // Pass 2: Check if websiteUri already IS a booking platform URL
  for (const r of restaurants) {
    if (r.booking_platform) continue;
    if (!r.websiteUri) continue;
    const w = (r.websiteUri || '').toLowerCase();
    if (w.includes('resy.com/cities/')) {
      r.booking_platform = 'resy';
      r.booking_url = r.websiteUri;
    } else if (w.includes('opentable.com/r/') || w.includes('opentable.com/restaurant/')) {
      r.booking_platform = 'opentable';
      r.booking_url = r.websiteUri;
    } else if ((w.includes('exploretock.com/') || w.includes('tock.com/')) && w.split('/').length > 3) {
      r.booking_platform = 'tock';
      r.booking_url = r.websiteUri;
    }
  }

  // Pass 3: Crawl restaurant websites for booking links (max 10, only unmatched)
  const unmatched = restaurants.filter(r => !r.booking_platform && r.websiteUri);
  const toCrawl = unmatched.slice(0, 30);
  if (toCrawl.length > 0) {
    console.log(`\ud83d\udd0d Crawling ${toCrawl.length} restaurant websites for booking links...`);
    await runWithConcurrency(toCrawl, 5, async (r) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(r.websiteUri, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow'
        });
        clearTimeout(timeout);
        if (!resp.ok) return;
        const html = await resp.text();
        const lower = html.toLowerCase();
        if (lower.includes('resy.com/cities/')) {
          const m = html.match(/https?:\/\/resy\.com\/cities\/[a-z-]+\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'resy'; r.booking_url = m[0]; }
        } else if (lower.includes('opentable.com/r/') || lower.includes('opentable.com/restref/')) {
          const m = html.match(/https?:\/\/(?:www\.)?opentable\.com\/r(?:estref)?\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'opentable'; r.booking_url = m[0]; }
        } else if (lower.includes('exploretock.com/') || lower.includes('tock.com/')) {
          const m = html.match(/https?:\/\/(?:www\.)?exploretock\.com\/[a-z0-9-]+/i);
          if (m) { r.booking_platform = 'tock'; r.booking_url = m[0]; }
        }
      } catch (e) { /* timeout or fetch error — skip */ }
    });
  }

  const matched = restaurants.filter(r => r.booking_platform).length;
  const crawlMatched = toCrawl.filter(r => r.booking_platform).length;
  console.log(`\u2705 Booking: ${matched}/${restaurants.length} matched (lookup: ${matched - crawlMatched}, crawl: ${crawlMatched})`);
}

async function resolveMichelinPlaces(GOOGLE_API_KEY) {
  if (!GOOGLE_API_KEY) return [];
  if (MICHELIN_RESOLVED && (Date.now() - MICHELIN_RESOLVED_AT) < MICHELIN_RESOLVE_TTL_MS) return MICHELIN_RESOLVED;
  if (!MICHELIN_BASE?.length) { MICHELIN_RESOLVED = []; MICHELIN_RESOLVED_AT = Date.now(); return []; }

  console.log(`\ud83d\udd0e Resolving Michelin... (${MICHELIN_BASE.length})`);
  const resolved = await runWithConcurrency(MICHELIN_BASE, 5, async (m) => {
    if (!m?.name) return null;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(m.name + ' New York NY')}&type=restaurant&key=${GOOGLE_API_KEY}`;
    try {
      const data = await fetch(url).then(r => r.json());
      if (data.status !== 'OK' || !data.results?.length) return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null };
      const target = normalizeName(m.name);
      let best = data.results[0];
      for (const r of data.results) { const rn = normalizeName(r.name); if (rn === target) { best = r; break; } if (rn.startsWith(target) || target.startsWith(rn)) best = r; }
      return { ...m, place_id: best.place_id || null, address: best.formatted_address || null, lat: best.geometry?.location?.lat ?? null, lng: best.geometry?.location?.lng ?? null, googleRating: best.rating ?? null, googleReviewCount: best.user_ratings_total ?? null };
    } catch { return { ...m, place_id: null, address: null, lat: null, lng: null, googleRating: null, googleReviewCount: null }; }
  });

  MICHELIN_RESOLVED = resolved.filter(Boolean);
  MICHELIN_RESOLVED_AT = Date.now();
  console.log(`\u2705 Michelin resolved: ${MICHELIN_RESOLVED.filter(x => x.place_id).length}/${MICHELIN_RESOLVED.length}`);
  return MICHELIN_RESOLVED;
}

function getBibGourmandPlaces() {
  if (!BIB_GOURMAND_BASE?.length) return [];
  return BIB_GOURMAND_BASE.filter(b => b.lat != null && b.lng != null);
}

function getPopularPlaces() {
  if (!POPULAR_BASE?.length) return [];
  return POPULAR_BASE.filter(p => p.lat != null && p.lng != null);
}

function attachMichelinBadges(candidates, michelinResolved) {
  if (!candidates?.length || !michelinResolved?.length) return;
  const byId = new Map(), byName = new Map();
  for (const m of michelinResolved) { if (m?.place_id) byId.set(m.place_id, m); if (m?.name) byName.set(normalizeName(m.name), m); }
  let matched = 0;
  for (const c of candidates) {
    const m = (c?.place_id && byId.get(c.place_id)) || (normalizeName(c?.name) && byName.get(normalizeName(c.name)));
    if (m) {
      c.michelin = { stars: m.stars || 0, distinction: m.distinction || 'star' };
      c.booking_platform = m.booking_platform || null;
      c.booking_url = m.booking_url || null;
      matched++;
    }
  }
  console.log(`\u2705 Michelin badges: ${matched}`);
}

const resultCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
function getCacheKey(loc, q, c, o) { return `${loc}_${q}_${String(c||'any').toLowerCase().trim()}_${o?'open':'any'}`; }
function getFromCache(key) { const c = resultCache.get(key); if (!c) return null; if (Date.now()-c.timestamp > CACHE_TTL_MS) { resultCache.delete(key); return null; } return c.data; }
function setCache(key, data) { resultCache.set(key, { data, timestamp: Date.now() }); if (resultCache.size > 100) { const o = Array.from(resultCache.entries()).sort((a,b)=>a[1].timestamp-b[1].timestamp)[0]; resultCache.delete(o[0]); } }

function normalizeQualityMode(q) {
  q = String(q||'any').toLowerCase().trim();
  // 'all' = All Restaurants, no rating floor
  if (q === 'all') return 'all';
  // New tier system: Very Good 4.4+ | Great 4.6+ | Exceptional 4.8+
  if (q === 'very_good' || q === 'any') return 'very_good';
  if (q === 'great') return 'great';
  if (q === 'exceptional') return 'exceptional';
  // Legacy mappings (keep for backward compat)
  if (q === 'recommended_44') return 'very_good';
  if (q === 'elite_45') return 'great';
  if (q === 'strict_elite_46' || q === 'strict_elite_47') return 'exceptional';
  if (q === 'five_star') return 'exceptional';
  if (q === 'top_rated_and_above' || q === 'top_rated') return 'very_good';
  // Special filters
  if (q === 'michelin') return 'michelin';
  if (q === 'bib_gourmand') return 'bib_gourmand';
  if (q === 'michelin_rec') return 'michelin_rec';
  if (q === 'chase_sapphire') return 'chase_sapphire';
  if (q === 'rakuten') return 'rakuten';
  if (q === 'new_rising' || q === 'new_and_rising') return 'new_rising';
  if (q === 'coming_soon') return 'coming_soon';
  return 'very_good';
}

function filterRestaurantsByTier(candidates, qualityMode) {
  const elite = [], moreOptions = [], excluded = [];
  // 'all' = no floor, everything passes
  if (qualityMode === 'all') {
    candidates.forEach(p => elite.push(p));
    return { elite, moreOptions, excluded };
  }
  // New tier system: Very Good 4.4+ | Great 4.6+ | Exceptional 4.8+
  let eliteMin = 4.0, moreMin = 999;
  if (qualityMode === 'exceptional') { eliteMin = 4.8; moreMin = 999; }
  else if (qualityMode === 'great') { eliteMin = 4.6; moreMin = 4.0; }
  else if (qualityMode === 'very_good') { eliteMin = 4.4; moreMin = 999; }

  for (const place of candidates) {
    try {
      const reviews = Number(place.user_ratings_total ?? place.googleReviewCount ?? 0) || 0;
      const rating = Number(place.googleRating ?? place.rating ?? 0) || 0;

      // MICHELIN BYPASS: Michelin restaurants always pass all filters
      if (place.michelin) { elite.push(place); continue; }

      // BUZZ BYPASS: press-covered restaurants always pass (Eater, Infatuation, NYT etc)
      if (isBuzzRestaurant(place.name) || (place.buzz_sources && place.buzz_sources.length > 0)) { elite.push(place); continue; }

      // INSTAGRAM BUZZ BYPASS: influencer-tagged restaurants always pass
      if (place.instagram_buzz && place.instagram_buzz.length > 0) { elite.push(place); continue; }

      // CHASE SAPPHIRE BYPASS: Chase partner restaurants always pass filters
      if (place.chase_sapphire) { moreOptions.push(place); continue; }

      // 5.0 with under 500 reviews — likely inflated, cap at 4.8 instead of excluding
      if (rating >= 5.0 && reviews < 500) { place.googleRating = 4.8; place.rating = 4.8; }
      // 4.9 needs 50+ reviews
      if (rating >= 4.9 && reviews < 50) { excluded.push(place); continue; }
      // 4.7-4.8 needs 50+ reviews
      if (rating >= 4.7 && reviews < 50) { excluded.push(place); continue; }
      // Everything else needs 150+ reviews
      if (reviews < 150) { excluded.push(place); continue; }

      // DEFAULT HOT SPOTS: buzz-credentialed OR truly amazing reviews only
      // Michelin, press, instagram buzz, NYT already bypassed above — this catches
      // pure crowd favorites: 4.7+ with 750+ reviews
      if (qualityMode === 'very_good') {
        const isAmazingReviews = rating >= 4.7 && reviews >= 750;
        if (isAmazingReviews) elite.push(place);
        else excluded.push(place);
        continue;
      }

      if (rating >= eliteMin) elite.push(place);
      else if (rating >= moreMin) moreOptions.push(place);
      else excluded.push(place);
    } catch (err) { excluded.push({ name: place?.name, reason: `error: ${err.message}` }); }
  }
  console.log(`FILTER ${qualityMode}: Elite(>=${eliteMin}):${elite.length} | More:${moreOptions.length} | Excl:${excluded.length}`);
  return { elite, moreOptions, excluded };
}

async function newApiNearbyRings(lat, lng, KEY) {
  const rings = [1000, 2000, 3500, 5500, 8000];
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types,places.websiteUri';
  const all = [], seen = new Set();

  await runWithConcurrency(rings, 5, async (radius) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          includedTypes: ['restaurant'], maxResultCount: 20, rankPreference: 'POPULARITY',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
          minRating: 4.3,
          languageCode: 'en'
        })
      });
      if (!resp.ok) { console.log(`\u26a0\ufe0f Nearby ${radius}m: HTTP ${resp.status}`); return; }
      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const id = p.id || ''; if (!id || seen.has(id)) continue; seen.add(id); added++;
        all.push({ place_id: id, name: p.displayName?.text || '', vicinity: p.formattedAddress || '', formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0, user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPrice(p.priceLevel), opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [], websiteUri: p.websiteUri || null, _source: 'new_nearby' });
      }
      console.log(`\u2705 Nearby ${radius}m: ${(data.places||[]).length} ret, ${added} new`);
    } catch (err) { console.log(`\u26a0\ufe0f Nearby ${radius}m: ${err.message}`); }
  });
  return all;
}

async function newApiTextByCuisine(lat, lng, userCuisine, KEY) {
  let queries;
  if (userCuisine) {
    queries = [`best ${userCuisine} restaurants`, `top rated ${userCuisine} restaurants`];
  } else {
    queries = [
      'best italian restaurants', 'best sushi restaurants',
      'best mexican restaurants', 'best mediterranean restaurants',
      'best american restaurants', 'best french restaurants'
    ];
  }

  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.types,places.websiteUri';
  const all = [], seen = new Set();

  await runWithConcurrency(queries, 6, async (query) => {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({
          textQuery: query, maxResultCount: 20,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 8000 } },
          minRating: 4.3,
          languageCode: 'en'
        })
      });
      if (!resp.ok) { console.log(`\u26a0\ufe0f Text "${query}": HTTP ${resp.status}`); return; }
      const data = await resp.json();
      let added = 0;
      for (const p of (data.places || [])) {
        const id = p.id || ''; if (!id || seen.has(id)) continue; seen.add(id); added++;
        all.push({ place_id: id, name: p.displayName?.text || '', vicinity: p.formattedAddress || '', formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null } },
          rating: p.rating ?? 0, user_ratings_total: p.userRatingCount ?? 0,
          price_level: convertPrice(p.priceLevel), opening_hours: p.currentOpeningHours ? { open_now: p.currentOpeningHours.openNow === true } : null,
          types: p.types || [], websiteUri: p.websiteUri || null, _source: 'new_text' });
      }
      console.log(`\u2705 Text "${query}": ${(data.places||[]).length} ret, ${added} new`);
    } catch (err) { console.log(`\u26a0\ufe0f Text "${query}": ${err.message}`); }
  });
  return all;
}

function convertPrice(str) {
  if (!str) return null;
  return { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 }[str] ?? null;
}

function buildGrid(cLat, cLng) {
  const sp = 0.75 / 69;
  const rings = 2;
  const pts = [];
  for (let dy = -rings; dy <= rings; dy++)
    for (let dx = -rings; dx <= rings; dx++) {
      if (Math.sqrt(dy*dy + dx*dx) > rings + 0.5) continue;
      pts.push({ lat: cLat + dy*sp, lng: cLng + dx*sp });
    }
  console.log(`\ud83d\uddfa\ufe0f Grid: ${pts.length} points (2 rings, no pagination)`);
  return pts;
}

exports.handler = async (event) => {
  const stableResponse = (elite=[], more=[], stats={}, error=null, excluded=[]) => {
    // Slim each restaurant to only the fields the frontend needs.
    // This keeps responses well under the 6MB Netlify payload limit.
    const slimRecord = (r) => {
      if (!r) return null;
      const _bp = (r.booking_platform || '').toLowerCase();
      const _rp = _bp === 'resy' || _bp === 'opentable' || _bp === 'tock' || _bp === 'sevenrooms';
      return {
        name: r.name || null,
        place_id: r.place_id || null,
        vicinity: r.vicinity || r.formatted_address || r.address || null,
        lat: r.lat ?? r.geometry?.location?.lat ?? null,
        lng: r.lng ?? r.geometry?.location?.lng ?? null,
        googleRating: r.googleRating ?? r.rating ?? null,
        googleReviewCount: r.googleReviewCount ?? r.user_ratings_total ?? null,
        price_level: r.price_level ?? null,
        distanceMiles: r.distanceMiles ?? null,
        walkMinEstimate: r.walkMinEstimate ?? null,
        driveMinEstimate: r.driveMinEstimate ?? null,
        transitMinEstimate: r.transitMinEstimate ?? null,
        seatwizeScore: r.seatwizeScore ?? null,
        booking_platform: r.booking_platform || null,
        booking_url: r.booking_url || null,
        deposit_type: r.deposit_type || getDepositType(r.name),
        michelin: r.michelin || null,
        bib_gourmand: r.bib_gourmand || null,
        chase_sapphire: r.chase_sapphire || null,
        rakuten: r.rakuten || null,
        bilt_dining: r.bilt_dining || null,
        inkind: r.inkind || null,
        cuisine: r.cuisine || null,
        instagram: r.instagram || null,
        website: r.website || null,
        buzz_sources: r.buzz_sources?.length ? r.buzz_sources : undefined,
        nyt_stars: r.nyt_stars || null,
        pete_wells: r.pete_wells || null,
        nyt_top_100: r.nyt_top_100 || null,
        pete_wells_rank: r.pete_wells_rank || null,
        instagram_buzz: r.instagram_buzz || null,
        avail_tier: _rp ? (r.avail_tier || null) : null,
        avail_slots: _rp ? (r.avail_slots || null) : null,
        has_early: _rp ? (r.has_early || null) : null,
        has_prime: _rp ? (r.has_prime || null) : null,
        has_late: _rp ? (r.has_late || null) : null,
        early: _rp ? (r.early || null) : null,
        prime: _rp ? (r.prime || null) : null,
        late: _rp ? (r.late || null) : null,
        opens_in: _rp ? (r.opens_in || null) : null,
        fully_locked: _rp ? (r.fully_locked || false) : false,
        sunday_only: _rp ? (r.sunday_only || false) : false,
        walk_in_only: _rp ? (r.walk_in_only || false) : false,
        future_dates: _rp ? (r.future_dates || null) : null,
        prepaid_price: r.prepaid_price || null,
        vibe_tags: r.vibe_tags?.length ? r.vibe_tags : undefined,
        velocity: r.velocity || null,
        new_rising: r.new_rising || null,
        coming_soon: r.coming_soon || null,
        michelin_recommended: r.michelin_recommended || null,
      };
    };
    const slim = (arr) => (arr || []).map(slimRecord).filter(Boolean);
    const payload = JSON.stringify({ elite: slim(elite), moreOptions: slim(more), confirmedAddress: stats.confirmedAddress||null, userLocation: stats.userLocation||null, stats, error, likelihood_modifiers: { time: LIKELIHOOD_TIME_MODS, party: LIKELIHOOD_PARTY_MODS } });
    if (payload.length > 5000000) return compressResponse(200, payload);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: payload };
  };

  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };

    const t0 = Date.now();
    const timings = { legacy_ms: 0, new_nearby_ms: 0, new_text_ms: 0, filtering_ms: 0, total_ms: 0 };
    const body = JSON.parse(event.body || '{}');
    const { location, cuisine, openNow, quality, broadCity, transport, hotSpotsOnly } = body;

    // ── Book Ahead shortcut: return all booked restaurants with future availability ──
    if (body.bookAhead) {
      const results = [];
      // Build from availability side (more complete) and look up MASTER for enrichment
      const masterLookup = {};
      const masterNormLookup = {};
      for (const [mk, mv] of Object.entries(MASTER_BOOK)) {
        masterLookup[mk.toLowerCase()] = { name: mk, entry: mv };
        masterNormLookup[availNorm(mk)] = { name: mk, entry: mv };
      }
      // Fuzzy match: handles "tatiana" → "tatiana by kwame onwuachi", "daniel" → "restaurant daniel"
      function findMaster(aName) {
        const al = aName.toLowerCase();
        if (masterLookup[al]) return masterLookup[al];
        const an = availNorm(aName);
        if (masterNormLookup[an]) return masterNormLookup[an];
        // Try prefix/suffix/contains match
        for (const [mk, mv] of Object.entries(masterLookup)) {
          if (mk.startsWith(al + ' ') || mk.endsWith(' ' + al) || mk.startsWith(al + ' by ')) return mv;
        }
        // Try normalized contains
        for (const [mk, mv] of Object.entries(masterNormLookup)) {
          if (mk.startsWith(an + ' ') || mk.endsWith(' ' + an)) return mv;
        }
        return null;
      }

      for (const [aName, avail] of Object.entries(AVAILABILITY_BOOK)) {
        if (aName.startsWith('_')) continue;
        if (avail.tier !== 'booked' || !avail.opens_in || avail.opens_in > 14 || avail.not_bookable) continue;
        const ml0 = findMaster(aName);
        const plat0 = ml0?.entry?.platform || '';
        if (plat0 === 'website' || plat0 === 'walk_in') continue;
        const ml = findMaster(aName);
        const name = ml?.name || aName;
        const entry = ml?.entry || {};
        results.push({
          name,
          vicinity: entry.address || '',
          formatted_address: entry.address || '',
          lat: entry.lat || null,
          lng: entry.lng || null,
          googleRating: entry.google_rating || null,
          googleReviewCount: entry.google_reviews || null,
          price_level: entry.price_level || null,
          cuisine: entry.cuisine || CUISINE_LOOKUP[name] || null,
          booking_platform: entry.platform || null,
          booking_url: entry.url || entry.booking_url || null,
          website: entry.website || null,
          michelin: entry.michelin || null,
          michelin_recommended: entry.michelin_recommended || null,
          bib_gourmand: entry.bib_gourmand || null,
          vibe_tags: entry.vibe_tags || [],
          buzz_sources: entry.buzz_sources || [],
          instagram_buzz: INSTAGRAM_BUZZ[name] || null,
          new_rising: entry.new_rising || null,
          coming_soon: entry.coming_soon || null,
          coming_soon: entry.coming_soon || null,
          avail_tier: avail.tier,
          avail_slots: avail.dinner_slots || 0,
          has_early: avail.has_early || false,
          has_prime: avail.has_prime || false,
          has_late: avail.has_late || false,
          early: avail.early || null,
          prime: avail.prime || null,
          late: avail.late || null,
          opens_in: avail.opens_in,
          future_dates: avail.future_dates || null,
          fully_locked: avail.fully_locked || false,
          sunday_only: avail.sunday_only || false,
          walk_in_only: avail.walk_in_only || false,
        });
      }
      results.sort((a,b) => (a.opens_in||99) - (b.opens_in||99));
      return stableResponse(results, [], { bookAhead: true, count: results.length });
    }

    const allNYCMode = !!body.allNYC || body.broadCity === true || body.broadCity === 'true' || body.transport === 'all_nyc';
    const qualityMode = normalizeQualityMode(quality || 'any');
    const KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!KEY) return stableResponse([], [], {}, 'API key not configured');

    const cacheKey = getCacheKey(location, qualityMode, cuisine, openNow) + '_v25';
    const cached = getFromCache(cacheKey);
    if (cached) { timings.total_ms = Date.now()-t0; return stableResponse(cached.elite, cached.moreOptions, { ...cached.stats, cached: true, performance: { ...timings, cache_hit: true } }); }

    // Geocode — skip for All NYC mode, use NYC center as default
    let lat, lng, confirmedAddress = null;
    if (allNYCMode) {
      // Try to geocode the actual address for accurate distance calculations
      const locStr = String(location||'').trim();
      const cm = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (cm) {
        lat = +cm[1]; lng = +cm[2]; confirmedAddress = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      } else if (locStr && locStr.toLowerCase() !== 'new york, ny' && locStr.toLowerCase() !== 'nyc') {
        try {
          const gd = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${KEY}`).then(r=>r.json());
          if (gd.status === 'OK') {
            lat = gd.results[0].geometry.location.lat; lng = gd.results[0].geometry.location.lng;
            confirmedAddress = gd.results[0].formatted_address;
          } else { lat = 40.7580; lng = -73.9855; confirmedAddress = 'New York, NY, USA'; }
        } catch(e) { lat = 40.7580; lng = -73.9855; confirmedAddress = 'New York, NY, USA'; }
      } else { lat = 40.7580; lng = -73.9855; confirmedAddress = 'New York, NY, USA'; }
    } else {
      const locStr = String(location||'').trim();
      const cm = locStr.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (cm) { lat = +cm[1]; lng = +cm[2]; confirmedAddress = `(${lat.toFixed(5)}, ${lng.toFixed(5)})`; }
      else {
        const gd = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locStr)}&key=${KEY}`).then(r=>r.json());
        if (gd.status !== 'OK') return stableResponse([],[],{ performance: { total_ms: Date.now()-t0 } }, `Geocode failed: ${gd.status}`);
        lat = gd.results[0].geometry.location.lat; lng = gd.results[0].geometry.location.lng;
        confirmedAddress = gd.results[0].formatted_address;
      }
    }
    const gLat = Math.round(lat*10000)/10000, gLng = Math.round(lng*10000)/10000;

    // Build Chase name lookup for tagging
    const chaseNameLookup = new Set();
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (c?.name) chaseNameLookup.add(normalizeName(c.name));
    }

    const rakutenNameLookup = new Set();
    for (const r of RAKUTEN_BASE) {
      if (r?.name) rakutenNameLookup.add(normalizeName(r.name));
    }

    // Michelin mode — pull directly from BOOKING_MASTER (michelin_stars >= 1)
    if (qualityMode === 'michelin') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

      // Build list from MASTER_BOOK entries that have michelin_stars >= 1
      const michelinEntries = [];
      for (const [name, entry] of Object.entries(MASTER_BOOK)) {
        if (!entry || typeof entry !== 'object') continue;
        const stars = entry.michelin_stars || 0;
        if (stars < 1) continue;
        if (!entry.lat || !entry.lng) continue;
        michelinEntries.push({ name, entry, stars });
      }
      console.log(`⭐ Michelin from MASTER_BOOK: ${michelinEntries.length}`);

      const allResults = michelinEntries.map(({ name, entry, stars }) => {
        const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
        return {
          place_id: entry.place_id || null,
          name,
          vicinity: entry.address || entry.neighborhood || '',
          formatted_address: entry.address || '',
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat: entry.lat, lng: entry.lng } },
          googleRating: entry.google_rating || entry.googleRating || null,
          googleReviewCount: entry.google_reviews || entry.googleReviewCount || null,
          distanceMiles: Math.round(d * 10) / 10,
          walkMinEstimate: Math.round(d * 15),
          driveMinEstimate: Math.round(d * 4),
          transitMinEstimate: Math.round(d * 6),
          michelin: { stars, distinction: 'star' },
          cuisine: entry.cuisine || CUISINE_LOOKUP[name] || null,
          booking_platform: entry.platform || entry.booking_platform || null,
          booking_url: entry.url || entry.booking_url || null,
          website: entry.website || null,
          instagram: entry.instagram || null,
          bib_gourmand: entry.bib_gourmand || null,
          chase_sapphire: chaseNameLookup.has(normalizeName(name)),
          rakuten: rakutenNameLookup.has(normalizeName(name)),
          bilt_dining: entry.bilt_dining || null,
          inkind: entry.inkind || null,
          vibe_tags: entry.vibe_tags || [],
          buzz_sources: entry.buzz_sources || [],
          nyt_stars: entry.nyt_stars || null,
          pete_wells: entry.pete_wells || false,
          nyt_top_100: entry.nyt_top_100 || false,
          pete_wells_rank: entry.pete_wells_rank || null,
          instagram_buzz: INSTAGRAM_BUZZ[name] || null,
          deposit_type: DEPOSIT_LOOKUP[normalizeName(name)] || null,
          new_rising: entry.new_rising || null,
          coming_soon: entry.coming_soon || null,
          velocity: entry.velocity || null,
          avail_tier:  (getAvail(name) || {}).tier || null,
          avail_slots: (getAvail(name) || {}).dinner_slots || 0,
          has_early:   (getAvail(name) || {}).has_early || false,
          has_prime:   (getAvail(name) || {}).has_prime || false,
          has_late:    (getAvail(name) || {}).has_late || false,
          early:       (getAvail(name) || {}).early || null,
          prime:       (getAvail(name) || {}).prime || null,
          late:        (getAvail(name) || {}).late || null,
          opens_in: (getAvail(name) || {}).opens_in || null,
          future_dates: (getAvail(name) || {}).future_dates || null,
          fully_locked:(getAvail(name) || {}).fully_locked || false,
          sunday_only:(getAvail(name) || {}).sunday_only || false,
          walk_in_only:(getAvail(name) || {}).walk_in_only || false,
          prepaid_price:(getAvail(name) || {}).prepaid_price || null,
        };
      });

      // Distance filter — respect transport/radius param from frontend
      const maxDist = allNYCMode ? 999 :
        body.transport === 'radius' ? (parseFloat(body.radiusMiles) || 15) :
        body.transport === 'walk' ? ((parseFloat(body.walkTime) || 15) / 15) :
        body.transport === 'drive' ? ((parseFloat(body.driveTime) || 15) / 4) : 15;

      const filtered = allResults
        .filter(r => r.distanceMiles <= maxDist)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));

      filtered.forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });
      filtered.sort((a, b) =>
        (b.michelin?.stars || 0) - (a.michelin?.stars || 0) ||
        (b.seatwizeScore || 0) - (a.seatwizeScore || 0) ||
        a.distanceMiles - b.distanceMiles
      );

      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, michelinMode: true, count: filtered.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: filtered, moreOptions: [], stats });
      return stableResponse(filtered, [], stats);
    }

    // Bib Gourmand mode — pull directly from BOOKING_MASTER (bib_gourmand === true)
    if (qualityMode === 'bib_gourmand') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

      const bibEntries = [];
      for (const [name, entry] of Object.entries(MASTER_BOOK)) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.bib_gourmand) continue;
        if (!entry.lat || !entry.lng) continue;
        bibEntries.push({ name, entry });
      }
      console.log(`🍽️ Bib Gourmand from MASTER_BOOK: ${bibEntries.length}`);

      const allResults = bibEntries.map(({ name, entry }) => {
        const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
        return {
          place_id: entry.place_id || null,
          name,
          vicinity: entry.address || entry.neighborhood || '',
          formatted_address: entry.address || '',
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat: entry.lat, lng: entry.lng } },
          googleRating: entry.google_rating || entry.googleRating || null,
          googleReviewCount: entry.google_reviews || entry.googleReviewCount || null,
          distanceMiles: Math.round(d * 10) / 10,
          walkMinEstimate: Math.round(d * 15),
          driveMinEstimate: Math.round(d * 4),
          transitMinEstimate: Math.round(d * 6),
          michelin: { stars: 0, distinction: 'bib_gourmand' },
          cuisine: entry.cuisine || CUISINE_LOOKUP[name] || null,
          booking_platform: entry.platform || entry.booking_platform || null,
          booking_url: entry.url || entry.booking_url || null,
          website: entry.website || null,
          instagram: entry.instagram || null,
          bib_gourmand: true,
          chase_sapphire: chaseNameLookup.has(normalizeName(name)),
          rakuten: rakutenNameLookup.has(normalizeName(name)),
          bilt_dining: entry.bilt_dining || null,
          inkind: entry.inkind || null,
          vibe_tags: entry.vibe_tags || [],
          buzz_sources: entry.buzz_sources || [],
          nyt_stars: entry.nyt_stars || null,
          pete_wells: entry.pete_wells || false,
          nyt_top_100: entry.nyt_top_100 || false,
          pete_wells_rank: entry.pete_wells_rank || null,
          instagram_buzz: INSTAGRAM_BUZZ[name] || null,
          deposit_type: DEPOSIT_LOOKUP[normalizeName(name)] || null,
          new_rising: entry.new_rising || null,
          coming_soon: entry.coming_soon || null,
          velocity: entry.velocity || null,
          avail_tier:  (getAvail(name) || {}).tier || null,
          avail_slots: (getAvail(name) || {}).dinner_slots || 0,
          has_early:   (getAvail(name) || {}).has_early || false,
          has_prime:   (getAvail(name) || {}).has_prime || false,
          has_late:    (getAvail(name) || {}).has_late || false,
          early:       (getAvail(name) || {}).early || null,
          prime:       (getAvail(name) || {}).prime || null,
          late:        (getAvail(name) || {}).late || null,
          opens_in: (getAvail(name) || {}).opens_in || null,
          future_dates: (getAvail(name) || {}).future_dates || null,
          fully_locked:(getAvail(name) || {}).fully_locked || false,
          sunday_only:(getAvail(name) || {}).sunday_only || false,
          walk_in_only:(getAvail(name) || {}).walk_in_only || false,
          prepaid_price:(getAvail(name) || {}).prepaid_price || null,
        };
      });

      const maxDist = allNYCMode ? 999 :
        body.transport === 'radius' ? (parseFloat(body.radiusMiles) || 15) :
        body.transport === 'walk' ? ((parseFloat(body.walkTime) || 15) / 15) :
        body.transport === 'drive' ? ((parseFloat(body.driveTime) || 15) / 4) : 15;

      const filtered = allResults
        .filter(r => r.distanceMiles <= maxDist)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));

      filtered.forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });
      filtered.sort((a, b) => (b.seatwizeScore || 0) - (a.seatwizeScore || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, bibGourmandMode: true, count: filtered.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: filtered, moreOptions: [], stats });
      return stableResponse(filtered, [], stats);
    }

    // Michelin Recommended mode — pull from BOOKING_MASTER (michelin_recommended === true, no stars)
    if (qualityMode === 'michelin_rec') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

      const recEntries = [];
      for (const [name, entry] of Object.entries(MASTER_BOOK)) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.michelin_recommended && !entry.bib_gourmand) continue;
        if ((entry.michelin_stars || 0) >= 1) continue; // exclude starred — those are in Michelin Stars filter
        if (!entry.lat || !entry.lng) continue;
        recEntries.push({ name, entry });
      }
      console.log(`📖 Michelin Recommended from MASTER_BOOK: ${recEntries.length}`);

      const allResults = recEntries.map(({ name, entry }) => {
        const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
        return {
          place_id: entry.place_id || null,
          name,
          vicinity: entry.address || entry.neighborhood || '',
          formatted_address: entry.address || '',
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat: entry.lat, lng: entry.lng } },
          googleRating: entry.google_rating || entry.googleRating || null,
          googleReviewCount: entry.google_reviews || entry.googleReviewCount || null,
          distanceMiles: Math.round(d * 10) / 10,
          walkMinEstimate: Math.round(d * 15),
          driveMinEstimate: Math.round(d * 4),
          transitMinEstimate: Math.round(d * 6),
          michelin: { stars: 0, distinction: entry.bib_gourmand ? 'bib_gourmand' : 'recommended' },
          michelin_recommended: true,
          cuisine: entry.cuisine || CUISINE_LOOKUP[name] || null,
          booking_platform: entry.platform || entry.booking_platform || null,
          booking_url: entry.url || entry.booking_url || null,
          website: entry.website || null,
          instagram: entry.instagram || null,
          bib_gourmand: entry.bib_gourmand || null,
          chase_sapphire: chaseNameLookup.has(normalizeName(name)),
          rakuten: rakutenNameLookup.has(normalizeName(name)),
          bilt_dining: entry.bilt_dining || null,
          inkind: entry.inkind || null,
          vibe_tags: entry.vibe_tags || [],
          buzz_sources: entry.buzz_sources || [],
          nyt_stars: entry.nyt_stars || null,
          pete_wells: entry.pete_wells || false,
          nyt_top_100: entry.nyt_top_100 || false,
          pete_wells_rank: entry.pete_wells_rank || null,
          instagram_buzz: INSTAGRAM_BUZZ[name] || null,
          deposit_type: DEPOSIT_LOOKUP[normalizeName(name)] || null,
          new_rising: entry.new_rising || null,
          coming_soon: entry.coming_soon || null,
          velocity: entry.velocity || null,
          avail_tier:  (getAvail(name) || {}).tier || null,
          avail_slots: (getAvail(name) || {}).dinner_slots || 0,
          has_early:   (getAvail(name) || {}).has_early || false,
          has_prime:   (getAvail(name) || {}).has_prime || false,
          has_late:    (getAvail(name) || {}).has_late || false,
          early:       (getAvail(name) || {}).early || null,
          prime:       (getAvail(name) || {}).prime || null,
          late:        (getAvail(name) || {}).late || null,
          opens_in: (getAvail(name) || {}).opens_in || null,
          future_dates: (getAvail(name) || {}).future_dates || null,
          fully_locked:(getAvail(name) || {}).fully_locked || false,
          sunday_only:(getAvail(name) || {}).sunday_only || false,
          walk_in_only:(getAvail(name) || {}).walk_in_only || false,
          prepaid_price:(getAvail(name) || {}).prepaid_price || null,
        };
      });

      const maxDist = allNYCMode ? 999 :
        body.transport === 'radius' ? (parseFloat(body.radiusMiles) || 15) :
        body.transport === 'walk' ? ((parseFloat(body.walkTime) || 15) / 15) :
        body.transport === 'drive' ? ((parseFloat(body.driveTime) || 15) / 4) : 15;

      const filtered = allResults
        .filter(r => r.distanceMiles <= maxDist)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));

      filtered.forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });
      filtered.sort((a, b) => (b.seatwizeScore || 0) - (a.seatwizeScore || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, michelinRecMode: true, count: filtered.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: filtered, moreOptions: [], stats });
      return stableResponse(filtered, [], stats);
    }

    // Chase Sapphire Reserve mode — 15 mile radius from chase_sapphire_nyc.json
    if (qualityMode === 'chase_sapphire') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      console.log(`\ud83d\udcb3 Chase Sapphire: ${CHASE_SAPPHIRE_BASE.length} entries`);
      const within = CHASE_SAPPHIRE_BASE.filter(r => r.lat != null && r.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id || null, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating || 0, googleReviewCount: r.googleReviewCount || 0,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: null, cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null, website: (() => { const mk = (r.name||"").toLowerCase().trim(); return (MASTER_BOOK[mk] || MASTER_BOOK[mk.replace(/^the /,"")] || {}).website || null; })(), instagram: (() => { const mk2 = (r.name||"").toLowerCase().trim(); return (MASTER_BOOK[mk2] || MASTER_BOOK[mk2.replace(/^the /,"")] || {}).instagram || null; })(),
          chase_sapphire: true };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));
      within.forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });
      within.sort((a,b) => (b.seatwizeScore || 0) - (a.seatwizeScore || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, chaseSapphireMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // Rakuten mode — 15 mile radius from rakuten_nyc.json
    if (qualityMode === 'rakuten') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
      console.log('Rakuten: ' + RAKUTEN_BASE.length + ' entries');
      const within = RAKUTEN_BASE.filter(r => r.lat != null && r.lng != null).map(r => {
        const d = haversineMiles(gLat, gLng, r.lat, r.lng);
        return { place_id: r.place_id || null, name: r.name, vicinity: r.address||'', formatted_address: r.address||'',
          price_level: r.price_level || null, opening_hours: null, geometry: { location: { lat: r.lat, lng: r.lng } },
          googleRating: r.googleRating || 0, googleReviewCount: r.googleReviewCount || 0,
          distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
          michelin: null, cuisine: CUISINE_LOOKUP[r.name] || r.cuisine || null,
          booking_platform: r.booking_platform || null, booking_url: r.booking_url || null, website: (() => { const mk = (r.name||"").toLowerCase().trim(); return (MASTER_BOOK[mk] || MASTER_BOOK[mk.replace(/^the /,"")] || {}).website || null; })(), instagram: (() => { const mk2 = (r.name||"").toLowerCase().trim(); return (MASTER_BOOK[mk2] || MASTER_BOOK[mk2.replace(/^the /,"")] || {}).instagram || null; })(),
          rakuten: true };
      }).filter(r => r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));
      within.forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });
      within.sort((a,b) => (b.seatwizeScore || 0) - (a.seatwizeScore || 0) || a.distanceMiles - b.distanceMiles);
      timings.total_ms = Date.now()-t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, rakutenMode: true, count: within.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: within, moreOptions: [], stats });
      return stableResponse(within, [], stats);
    }

    // New & Rising mode — pull from REVIEW_SNAPSHOTS velocity data
    if (qualityMode === 'new_rising') {
      const cuisineFilter = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;

      // Pull from BOOKING_MASTER: restaurants tagged new_rising with 5-50 reviews and 4.0+ rating
      const allNycSource = MASTER_KEYS.length > 0 ? MASTER_BOOK : BOOKING_LOOKUP;
      const rising = [];

      for (const [key, entry] of Object.entries(allNycSource)) {
        // Must be tagged new_rising OR have Eater buzz + low reviews
        const isTagged = entry.new_rising === true;
        const hasEaterBuzz = (entry.buzz_sources || []).includes('Eater');
        const reviews = entry.google_reviews || entry.googleReviewCount || 0;
        const rating = entry.google_rating || entry.googleRating || 0;

        // Qualify: tagged new_rising, OR (Eater buzz + 5-50 reviews + 4.0+ rating)
        if (!isTagged && !(hasEaterBuzz && reviews >= 5 && reviews <= 50 && rating >= 4.0)) continue;

        // Hard filter: must be 5-50 reviews (graduated restaurants drop off)
        if (reviews < 5 || reviews > 50) continue;
        if (rating < 4.0) continue;

        const lat = entry.lat || entry.geometry?.location?.lat || 0;
        const lng = entry.lng || entry.geometry?.location?.lng || 0;
        const d = (lat && lng) ? haversineMiles(gLat, gLng, lat, lng) : 999;
        const mk = normalizeName(key);

        rising.push({
          place_id: entry.place_id || null,
          name: key,
          vicinity: entry.address || '',
          formatted_address: entry.address || '',
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat, lng } },
          googleRating: rating,
          googleReviewCount: reviews,
          distanceMiles: Math.round(d * 10) / 10,
          walkMinEstimate: Math.round(d * 15),
          driveMinEstimate: Math.round(d * 4),
          transitMinEstimate: Math.round(d * 6),
          booking_platform: entry.platform || entry.booking_platform || null,
          booking_url: entry.url || entry.booking_url || null,
          website: entry.website || null,
          instagram: entry.instagram || null,
          cuisine: entry.cuisine || CUISINE_LOOKUP[mk] || null,
          bib_gourmand: entry.bib_gourmand || null,
          michelin: entry.michelin_stars ? { stars: entry.michelin_stars, distinction: 'star' } : entry.michelin_recommended ? { stars: 0, distinction: 'recommended' } : entry.bib_gourmand ? { stars: 0, distinction: 'bib_gourmand' } : null,
          buzz_sources: entry.buzz_sources || [],
          new_rising: true,
          _source: 'new_rising'
        });
      }

      // Sort by rating (best first), then fewest reviews (newest first)
      rising.sort((a, b) => (b.googleRating || 0) - (a.googleRating || 0) || (a.googleReviewCount || 0) - (b.googleReviewCount || 0));

      // Apply distance + cuisine filters
      const isAllNycRising = (transport === 'all_nyc' || broadCity === true || broadCity === 'true');
      const filtered = rising
        .filter(r => isAllNycRising || r.distanceMiles <= 15)
        .filter(r => !cuisineFilter || cuisineLookupMatches(r.name, cuisineFilter, r.cuisine));

      console.log(`✨ New & Rising: ${filtered.length} qualifying (from ${rising.length} tagged)`);
      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, newRisingMode: true, count: filtered.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: filtered, moreOptions: [], stats });
      return stableResponse(filtered, [], stats);
    }

    // Coming Soon mode — pull from BOOKING_MASTER
    if (qualityMode === 'coming_soon') {
      const allNycSource = MASTER_KEYS.length > 0 ? MASTER_BOOK : BOOKING_LOOKUP;
      const comingSoon = [];

      for (const [key, entry] of Object.entries(allNycSource)) {
        if (!entry.coming_soon) continue;
        const lat = entry.lat || entry.geometry?.location?.lat || 0;
        const lng = entry.lng || entry.geometry?.location?.lng || 0;
        const d = (lat && lng) ? haversineMiles(gLat, gLng, lat, lng) : 999;
        const mk = normalizeName(key);

        comingSoon.push({
          place_id: entry.place_id || null,
          name: key,
          vicinity: entry.address || '',
          formatted_address: entry.address || '',
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat, lng } },
          googleRating: entry.google_rating || entry.googleRating || 0,
          googleReviewCount: entry.google_reviews || entry.googleReviewCount || 0,
          distanceMiles: Math.round(d * 10) / 10,
          walkMinEstimate: Math.round(d * 15),
          driveMinEstimate: Math.round(d * 4),
          transitMinEstimate: Math.round(d * 6),
          booking_platform: entry.platform || null,
          booking_url: entry.url || null,
          website: entry.website || null,
          cuisine: entry.cuisine || CUISINE_LOOKUP[mk] || null,
          neighborhood: entry.neighborhood || null,
          coming_soon: true,
          coming_soon_source: entry.coming_soon_source || null,
          new_rising: entry.new_rising || null,
          _source: 'coming_soon'
        });
      }

      console.log(`🚀 Coming Soon: ${comingSoon.length} restaurants`);
      timings.total_ms = Date.now() - t0;
      const stats = { confirmedAddress, userLocation: { lat: gLat, lng: gLng }, comingSoonMode: true, count: comingSoon.length, performance: { ...timings, cache_hit: false } };
      setCache(cacheKey, { elite: comingSoon, moreOptions: [], stats });
      return stableResponse(comingSoon, [], stats);
    }

    // =========================================================================
    // ALL NYC FAST PATH — skip Google API entirely, use booking_lookup only
    // =========================================================================
    const cuisineStr = (cuisine && String(cuisine).toLowerCase().trim() !== 'any') ? cuisine : null;
    const isAllNYC = (transport === 'all_nyc' || broadCity === true || broadCity === 'true');

    const allNycSource = MASTER_KEYS.length > 0 ? MASTER_BOOK : BOOKING_LOOKUP;
    const allNycKeys = MASTER_KEYS.length > 0 ? MASTER_KEYS : BOOKING_KEYS;
    if (isAllNYC && allNycKeys.length > 0) {
      console.log(`🗽 ALL NYC MODE — using ${allNycKeys.length} master book entries`);
      const injected = [];
      for (const [key, entry] of Object.entries(allNycSource)) {
        if (!entry.lat || !entry.lng) continue;

        // ALL NYC SPEED FILTER: skip low quality entries to reduce payload size
        // Full data is preserved in BOOKING_MASTER — this only affects All NYC display
        const rating = entry.google_rating || 0;
        const reviews = entry.google_reviews || 0;
        const hasInstaBuzz = !!INSTAGRAM_BUZZ[key] || !!INSTAGRAM_BUZZ[key.toLowerCase()];
        const isBuzz = !!(entry.buzz_sources && entry.buzz_sources.length > 0);
        const isMichelin = !!entry.michelin_stars || !!entry.michelin_recommended || !!entry.bib_gourmand;
        const isKosher = (entry.cuisine || '').toLowerCase() === 'kosher';
        if (!isMichelin && !isBuzz && !hasInstaBuzz && !isKosher) {
          if (rating < 4.3 || reviews < 100) continue;
        }

        // Cuisine filter
        if (cuisineStr) {
          const entryCuisine = CUISINE_LOOKUP[key] || entry.cuisine || null;
          if (!cuisineLookupMatches(key, cuisineStr, entryCuisine)) continue;
        }

        const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
        injected.push({
          name: key,
          place_id: entry.place_id || null,
          address: entry.address || entry.neighborhood || null,
          lat: entry.lat, lng: entry.lng,
          rating: entry.google_rating || entry.resy_rating || 0,
          user_ratings_total: entry.google_reviews || 0,
          price_level: entry.price || null,
          opening_hours: null,
          geometry: { location: { lat: entry.lat, lng: entry.lng } },
          types: ['restaurant'],
          booking_platform: entry.platform || entry.booking_platform || null,
          booking_url: entry.url || entry.booking_url || null,
          distanceMiles: Math.round(d*10)/10,
          walkMinEstimate: Math.round(d*20),
          driveMinEstimate: Math.round(d*4),
          transitMinEstimate: Math.round(d*6),
          googleRating: entry.google_rating || 0,
          googleReviewCount: entry.google_reviews || 0,
          michelin: entry.michelin_stars ? { stars: entry.michelin_stars, distinction: 'star' } : entry.bib_gourmand ? { stars: 0, distinction: 'bib_gourmand' } : entry.michelin_recommended ? { stars: 0, distinction: 'recommended' } : null,
          bib_gourmand: entry.bib_gourmand || null,
          michelin_recommended: entry.michelin_recommended || null,
          chase_sapphire: chaseNameLookup.has(normalizeName(key)) || entry.chase_sapphire || null,
          rakuten: rakutenNameLookup.has(normalizeName(key)) || entry.rakuten || null,
          bilt_dining: entry.bilt_dining || null,
          inkind: entry.inkind || null,
          vibe_tags: entry.vibe_tags || [],
          cuisine: entry.cuisine || CUISINE_LOOKUP[key] || null,
          instagram: entry.instagram || null,
          // ── Availability: from tonight_availability.json ──
          avail_tier:  (getAvail(key) || {}).tier || null,
          avail_slots: (getAvail(key) || {}).dinner_slots || 0,
          has_early:   (getAvail(key) || {}).has_early || false,
          has_prime:   (getAvail(key) || {}).has_prime || false,
          has_late:    (getAvail(key) || {}).has_late || false,
          early:       (getAvail(key) || {}).early || null,
          prime:       (getAvail(key) || {}).prime || null,
          late:        (getAvail(key) || {}).late || null,
          opens_in: (getAvail(key) || {}).opens_in || null,
          future_dates: (getAvail(key) || {}).future_dates || null,
          fully_locked:(getAvail(key) || {}).fully_locked || false,
          sunday_only:(getAvail(key) || {}).sunday_only || false,
          walk_in_only:(getAvail(key) || {}).walk_in_only || false,
          website: entry.website || null,
          buzz_sources: entry.buzz_sources || [],
          nyt_stars: entry.nyt_stars || null,
          pete_wells: entry.pete_wells || false,
          nyt_top_100: entry.nyt_top_100 || false,
          pete_wells_rank: entry.pete_wells_rank || null,
          instagram_buzz: INSTAGRAM_BUZZ[key] || INSTAGRAM_BUZZ[key.toLowerCase()] || null,
          new_rising: entry.new_rising || null,
          coming_soon: entry.coming_soon || null,
          _source: 'master_book',
        });
      }
      console.log(`🗽 ALL NYC MODE: ${injected.length} restaurants from master book`);

      // Apply quality filter
      const { elite, moreOptions, excluded } = filterRestaurantsByTier(injected, qualityMode);
      console.log(`FILTER ${qualityMode}: Elite(>=4.5):${elite.length} | More:${moreOptions.length} | Excl:${excluded.length}`);

      // Compute SeatWize scores
      [...elite, ...moreOptions, ...excluded].forEach(r => enrichNYT(r));
      [...elite, ...moreOptions, ...excluded].forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });

      // Detect booking platforms
      detectBookingPlatforms(elite);
      detectBookingPlatforms(moreOptions);
      detectBookingPlatforms(excluded);

      const stats = {
        confirmedAddress, userLocation: { lat: gLat, lng: gLng },
        allNYCMode: true, count: elite.length + moreOptions.length,
        performance: { ...timings, cache_hit: false }
      };
      setCache(cacheKey, { elite, moreOptions, excluded, stats });
      return stableResponse(elite, moreOptions, stats, null, excluded);
    }

    // =========================================================================
    // THREE-LAYER PARALLEL SEARCH (speed-optimized) — for non-All-NYC searches
    // =========================================================================

    const [legacyFlat, nearbyResults, textResults] = await Promise.all([

      // LAYER 1: Legacy grid — NO PAGINATION (just page 1 = 20 results per point)
      (async () => {
        const start = Date.now();
        const grid = buildGrid(gLat, gLng);
        const results = await runWithConcurrency(grid, 10, async (pt) => {
          let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${pt.lat},${pt.lng}&radius=800&type=restaurant&key=${KEY}`;
          if (cuisineStr) url += `&keyword=${encodeURIComponent(cuisineStr)}`;
          if (openNow) url += `&opennow=true`;
          const data = await fetch(url).then(r => r.json());
          return (data.status === 'OK') ? (data.results || []) : [];
        });
        timings.legacy_ms = Date.now() - start;
        return results.flat();
      })(),

      // LAYER 2: New Nearby rings (skip for Hot Spots — curated only)
      hotSpotsOnly ? [] : (async () => { const s = Date.now(); const r = await newApiNearbyRings(gLat, gLng, KEY); timings.new_nearby_ms = Date.now()-s; return r; })(),

      // LAYER 3: New Text Search by cuisine (skip for Hot Spots — curated only)
      hotSpotsOnly ? [] : (async () => { const s = Date.now(); const r = await newApiTextByCuisine(gLat, gLng, cuisineStr, KEY); timings.new_text_ms = Date.now()-s; return r; })()
    ]);

    // Cuisine type mapping: our dropdown value -> Google place types that match
    const CUISINE_TYPE_MAP = {
      'american': ['american_restaurant', 'hamburger_restaurant', 'steak_house', 'breakfast_restaurant', 'brunch_restaurant'],
      'barbecue': ['barbecue_restaurant'],
      'chinese': ['chinese_restaurant'],
      'french': ['french_restaurant'],
      'greek': ['greek_restaurant'],
      'indian': ['indian_restaurant'],
      'italian': ['italian_restaurant'],
      'japanese': ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'],
      'korean': ['korean_restaurant'],
      'mediterranean': ['mediterranean_restaurant', 'greek_restaurant', 'middle_eastern_restaurant', 'lebanese_restaurant', 'turkish_restaurant'],
      'mexican': ['mexican_restaurant'],
      'seafood': ['seafood_restaurant'],
      'spanish': ['spanish_restaurant'],
      'steakhouse': ['steak_house'],
      'sushi': ['sushi_restaurant', 'japanese_restaurant'],
      'thai': ['thai_restaurant'],
      'vietnamese': ['vietnamese_restaurant']
    };

    // Types to EXCLUDE — not real sit-down restaurants
    const HARD_JUNK_TYPES = [
      'ice_cream_shop', 'coffee_shop', 'cafe', 'bakery', 'sandwich_shop',
      'bagel_shop', 'donut_shop', 'juice_shop', 'smoothie_shop',
      'dessert_shop', 'dessert_restaurant', 'pizza_takeout',
      'food_court', 'fast_food_restaurant', 'convenience_store',
      'grocery_store', 'supermarket', 'liquor_store', 'night_club',
      'meal_delivery', 'meal_takeaway',
      'shopping_mall', 'department_store', 'tourist_attraction',
      'amusement_park', 'museum', 'park', 'stadium', 'movie_theater',
      'observation_deck', 'visitor_center', 'event_venue', 'market',
      'clothing_store', 'shoe_store', 'electronics_store',
      'deli', 'food_stand', 'kiosk'
    ];

    const ALWAYS_JUNK_TYPES = [
      'ice_cream_shop', 'coffee_shop', 'bakery', 'bagel_shop', 'donut_shop',
      'juice_shop', 'smoothie_shop', 'dessert_shop', 'food_court',
      'convenience_store', 'grocery_store', 'supermarket', 'liquor_store',
      'shopping_mall', 'department_store', 'clothing_store', 'shoe_store',
      'electronics_store', 'museum', 'amusement_park', 'stadium',
      'movie_theater', 'observation_deck', 'visitor_center', 'night_club'
    ];

    const EXCLUDED_NAME_PATTERNS = [
      /\bstarbucks\b/i, /\bdunkin\b/i, /\bmcdonald/i, /\bsubway\b/i,
      /\bchipotle\b/i, /\bshake shack\b/i, /\bsweetgreen\b/i,
      /\bpanera\b/i, /\bpret a manger\b/i, /\bchick-fil-a\b/i,
      /\bwendy'?s\b/i, /\bburger king\b/i, /\btaco bell\b/i,
      /\bpopeyes\b/i, /\bfive guys\b/i, /\bpapa john/i, /\bdomino/i,
      /\bpizza hut\b/i, /\blittle caesars\b/i, /\bjack in the box\b/i,
      /\bkfc\b/i, /\barby'?s\b/i, /\bsonic drive/i, /\bwhataburger\b/i,
      /\bdeli\b/i, /\bbodega\b/i, /\bice cream\b/i, /\bgelato\b/i,
      /\bfrozen yogurt\b/i, /\bfroyo\b/i, /\bjuice\b/i, /\bsmoothie\b/i,
      /\bboba\b/i, /\bbubble tea\b/i, /\btea shop\b/i,
      /\bcoffee\b/i, /\bespresso\b/i, /\bcaf\u00e9\b(?!\s*(otro|spaghetti|mars|zaffri|mado|rue))/i,
      /\bbakery\b/i, /\bdonut\b/i, /\bdoughnut\b/i, /\bbagel\b/i,
      /\bcake shop\b/i, /\bcupcake\b/i, /\bpastry\b/i, /\bdessert\b/i,
      /\bcreperie\b/i, /\bpatisserie\b/i,
      /\bfood truck\b/i, /\bfood cart\b/i, /\bfood stand\b/i,
      /\bhalal cart\b/i, /\bkiosk\b/i,
      /\bgrill & deli\b/i, /\bgrill and deli\b/i,
      /\bpizza by the slice\b/i, /\b\$1 pizza\b/i, /\bdollar pizza\b/i,
      /\bwestfield\b/i, /\bobservatory\b/i, /\bpier \d+\b/i,
      /\bworld trade center\b/i, /\btimes square\b/i,
      /\bjazz club\b/i, /\bcomedy club\b/i, /\bkaraoke\b/i,
      /\bbowling\b/i, /\barcade\b/i, /\bbilliard/i, /\bpool hall\b/i,
      /\bnight ?club\b/i, /\bdisco\b/i, /\bhookah\b/i, /\bshisha\b/i,
      /\bwine bar\b$/i, /\bcocktail bar\b$/i, /\bsports bar\b$/i,
      /\btaproom\b/i, /\bbeer hall\b/i, /\bbrewery\b/i, /\bbrew pub\b/i,
      /\bpub\b$/i, /\btavern\b$/i
    ];

    const RESTAURANT_WORDS = /restaurant|grill|kitchen|bistro|trattoria|osteria|ristorante|brasserie|steakhouse|sushi|ramen|taqueria|pizzeria|diner|eatery|cuisine|bbq|barbecue|seafood|noodle|dumpling|dim sum|omakase|izakaya|cantina|chophouse|taverna/i;

    // Merge & deduplicate
    const seen = new Set(), all = [];
    let legacyN = 0, nearbyN = 0, textN = 0, rawN = 0;

    for (const p of legacyFlat) { rawN++; if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); legacyN++; } }
    for (const p of nearbyResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); nearbyN++; } }
    for (const p of textResults) { if (p?.place_id && !seen.has(p.place_id)) { seen.add(p.place_id); all.push(p); textN++; } }

    console.log(`\ud83d\udcca MERGE: Legacy=${legacyN} + Nearby=+${nearbyN} + Text=+${textN} = ${all.length}`);

    // Filter out non-restaurants
    const beforeExclude = all.length;
    const cleaned = all.filter(p => {
      const pTypes = (p.types || []).map(t => t.toLowerCase());
      const pName = (p.name || '');
      const hasRestaurantType = pTypes.some(t => t.includes('restaurant'));

      // HARD KILL: these types are NEVER restaurants, even if Google also tags them "restaurant"
      if (pTypes.some(t => ALWAYS_JUNK_TYPES.includes(t))) return false;

      // SOFT KILL: these types get removed unless they also have restaurant type AND restaurant name
      const hasJunkType = pTypes.some(t => HARD_JUNK_TYPES.includes(t));
      if (hasJunkType && !hasRestaurantType) return false;
      if (hasJunkType && hasRestaurantType && !RESTAURANT_WORDS.test(pName)) return false;

      // Name-based exclusions — always applied
      if (EXCLUDED_NAME_PATTERNS.some(rx => rx.test(pName))) return false;

      // Bars without restaurant type or restaurant-like name
      if (pTypes.includes('bar') && !hasRestaurantType && !RESTAURANT_WORDS.test(pName)) return false;

      // Fast food with restaurant type still gets cut unless it has a restaurant name
      if (pTypes.includes('fast_food_restaurant') && !RESTAURANT_WORDS.test(pName)) return false;
      if (pTypes.includes('hamburger_restaurant') && !RESTAURANT_WORDS.test(pName)) return false;

      return true;
    });
    if (cleaned.length < beforeExclude) console.log(`\ud83e\uddf9 Excluded ${beforeExclude - cleaned.length} non-restaurants (chains/delis/coffee/bars/venues)`);

    // Post-filter by cuisine type
    let cuisineFiltered = cleaned;
    if (cuisineStr) {
      const allowedTypes = CUISINE_TYPE_MAP[cuisineStr.toLowerCase()] || [];
      if (allowedTypes.length > 0) {
        const beforeCount = cuisineFiltered.length;
        cuisineFiltered = cuisineFiltered.filter(p => {
          // Check our cuisine lookup first (most accurate)
          const lookupResult = cuisineLookupMatches(p.name, cuisineStr, p.cuisine);
          if (lookupResult) return true;   // matched via lookup or fallback cuisine
          // Not matched — fall back to Google types and name
          const pTypes = (p.types || []).map(t => t.toLowerCase());
          const matches = allowedTypes.some(at => pTypes.includes(at));
          const nameMatch = (p.name || '').toLowerCase().includes(cuisineStr.toLowerCase());
          return matches || nameMatch;
        });
        console.log(`\ud83c\udf55 Cuisine filter "${cuisineStr}": ${beforeCount} \u2192 ${cuisineFiltered.length} (removed ${beforeCount - cuisineFiltered.length})`);
      }
    }

    // Exclude cheap ($) spots — price_level 1 is fast food / takeout tier
    const beforePrice = cuisineFiltered.length;
    cuisineFiltered = cuisineFiltered.filter(p => {
      const pl = p.price_level ?? p.priceLevel ?? null;
      if (pl === 1) return false;
      return true;
    });
    if (cuisineFiltered.length < beforePrice) console.log(`\ud83d\udcb0 Price filter: removed ${beforePrice - cuisineFiltered.length} cheap ($) spots`);

    // Distance
    const withDist = cuisineFiltered.map(p => {
      const pLat = p.geometry?.location?.lat, pLng = p.geometry?.location?.lng;
      const d = (pLat != null && pLng != null) ? haversineMiles(gLat, gLng, pLat, pLng) : 999;
      let bp = p.booking_platform || null;
      let bu = p.booking_url || null;
      if (!bp) {
        const bookingInfo = getBookingInfo(p.name);
        if (bookingInfo) { bp = bookingInfo.platform; bu = bookingInfo.url; }
      }
      if (!bp && p.websiteUri) {
        const w = (p.websiteUri || '').toLowerCase();
        if (w.includes('resy.com/cities/')) { bp = 'resy'; bu = p.websiteUri; }
        else if (w.includes('opentable.com/r/') || w.includes('opentable.com/restaurant/')) { bp = 'opentable'; bu = p.websiteUri; }
        else if ((w.includes('exploretock.com/') || w.includes('tock.com/')) && w.split('/').length > 3) { bp = 'tock'; bu = p.websiteUri; }
      }
      return {
        place_id: p.place_id, name: p.name,
        vicinity: p.vicinity || p.formatted_address || '', formatted_address: p.formatted_address || p.vicinity || '',
        price_level: p.price_level, opening_hours: p.opening_hours, geometry: p.geometry, types: p.types || [],
        googleRating: p.rating || p.googleRating || 0, googleReviewCount: p.user_ratings_total || p.googleReviewCount || 0,
        distanceMiles: Math.round(d*10)/10, walkMinEstimate: Math.round(d*20), driveMinEstimate: Math.round(d*4), transitMinEstimate: Math.round(d*6),
        booking_platform: bp, booking_url: bu,
        website: (() => { const mk = (p.name||'').toLowerCase().trim(); return (MASTER_BOOK[mk] || MASTER_BOOK[(mk).replace(/^the /,'')] || {}).website || null; })(),
        instagram: (() => { const mk = (p.name||'').toLowerCase().trim(); return (MASTER_BOOK[mk] || MASTER_BOOK[(mk).replace(/^the /,'')] || {}).instagram || null; })(),
        websiteUri: p.websiteUri || null,
        cuisine: CUISINE_LOOKUP[p.name] || p.cuisine || null,
        velocity: getReviewVelocity(p.place_id),
        likelihood: getReservationLikelihood(p.place_id),
        _source: p._source || 'legacy'
      };
    });

    const maxDistMiles = body.transport === 'radius' ? (parseFloat(body.radiusMiles) || 7.0) :
      body.transport === 'walk' ? ((parseFloat(body.walkTime) || 15) / 15) :
      body.transport === 'drive' ? ((parseFloat(body.driveTime) || 15) / 4) : 7.0;
    const googleResults = withDist.filter(r => r.distanceMiles <= maxDistMiles);
    console.log(`\ud83d\udcca Within 7mi (Google): ${googleResults.length}`);

    // =========================================================================
    // BUILD `within` FROM MASTER_BOOK FIRST — Google fills in at the end
    // =========================================================================
    const within = [];
    const existingIds = new Set();
    const existingNames = new Set();

    let masterInjected = 0;
    for (const [mk, entry] of Object.entries(MASTER_BOOK)) {
      if (!entry.lat || !entry.lng) continue;
      if (entry.place_id && existingIds.has(entry.place_id)) continue;
      if (existingNames.has(normalizeName(mk))) continue;
      if (cuisineStr) {
        const entryCuisine = CUISINE_LOOKUP[mk] || entry.cuisine || null;
        if (!entryCuisine) continue;
        const c = entryCuisine.toLowerCase(), cs = cuisineStr.toLowerCase();
        if (!c.includes(cs) && !cs.includes(c)) continue;
      }
      // Filter junk by name — same chains/non-restaurants as Google filter
      const MASTER_JUNK_NAMES = [
        /\bstarbucks\b/i, /\bdunkin\b/i, /\bmcdonald/i, /\bsubway\b/i,
        /\bchipotle\b/i, /\bshake shack\b/i, /\bsweetgreen\b/i,
        /\bpanera\b/i, /\bpret a manger\b/i, /\bchick-fil-a\b/i,
        /\bwendy'?s\b/i, /\bburger king\b/i, /\btaco bell\b/i,
        /\bpopeyes\b/i, /\bfive guys\b/i, /\bpapa john/i, /\bdomino/i,
        /\bpizza hut\b/i, /\blittle caesars\b/i, /\bkfc\b/i, /\barby'?s\b/i,
        /\bdunkin/i, /\bwingstop\b/i, /\bpanda express\b/i,
      ];
      if (MASTER_JUNK_NAMES.some(rx => rx.test(mk))) continue;
      // Filter junk by cuisine tag
      const JUNK_CUISINES = ['bakery', 'coffee', 'cafe', 'fast food', 'deli', 'juice bar', 'smoothie', 'dessert', 'ice cream', 'donut', 'bagel'];
      const entryCuisineRaw = (entry.cuisine || '').toLowerCase();
      if (JUNK_CUISINES.some(j => entryCuisineRaw.includes(j))) continue;
      const d = haversineMiles(gLat, gLng, entry.lat, entry.lng);
      if (d > maxDistMiles) continue;
      within.push({
        place_id: entry.place_id || null,
        name: mk,
        vicinity: entry.address || entry.neighborhood || '',
        formatted_address: entry.address || entry.neighborhood || '',
        price_level: entry.price || null,
        opening_hours: null,
        geometry: { location: { lat: entry.lat, lng: entry.lng } },
        types: ['restaurant'],
        googleRating: entry.google_rating || 0,
        googleReviewCount: entry.google_reviews || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 15),
        driveMinEstimate: Math.round(d * 4),
        transitMinEstimate: Math.round(d * 6),
        booking_platform: entry.platform || entry.booking_platform || null,
        booking_url: entry.url || entry.booking_url || null,
        website: entry.website || null,
        cuisine: entry.cuisine || CUISINE_LOOKUP[mk] || null,
        vibe_tags: entry.vibe_tags || [],
        instagram: entry.instagram || null,
        bib_gourmand: entry.bib_gourmand || null,
        michelin: entry.michelin_stars ? { stars: entry.michelin_stars, distinction: 'star' } : entry.michelin_recommended ? { stars: 0, distinction: 'recommended' } : null,
        chase_sapphire: chaseNameLookup.has(normalizeName(mk)) || null,
        rakuten: rakutenNameLookup.has(normalizeName(mk)) || null,
        bilt_dining: entry.bilt_dining || null,
        inkind: entry.inkind || null,
        avail_tier:  (getAvail(mk) || {}).tier || null,
        avail_slots: (getAvail(mk) || {}).dinner_slots || 0,
        has_early:   (getAvail(mk) || {}).has_early || false,
        has_prime:   (getAvail(mk) || {}).has_prime || false,
        has_late:    (getAvail(mk) || {}).has_late || false,
        early:       (getAvail(mk) || {}).early || null,
        prime:       (getAvail(mk) || {}).prime || null,
        late:        (getAvail(mk) || {}).late || null,
        opens_in: (getAvail(mk) || {}).opens_in || null,
          future_dates: (getAvail(mk) || {}).future_dates || null,
        fully_locked:(getAvail(mk) || {}).fully_locked || false,
        sunday_only:(getAvail(mk) || {}).sunday_only || false,
        walk_in_only:(getAvail(mk) || {}).walk_in_only || false,
        velocity: getReviewVelocity(entry.place_id || null),
        likelihood: getReservationLikelihood(entry.place_id || null),
        buzz_sources: entry.buzz_sources || [],
        nyt_stars: entry.nyt_stars || null,
        pete_wells: entry.pete_wells || false,
        nyt_top_100: entry.nyt_top_100 || false,
        pete_wells_rank: entry.pete_wells_rank || null,
        instagram_buzz: INSTAGRAM_BUZZ[mk] || null,
        new_rising: entry.new_rising || null,
        coming_soon: entry.coming_soon || null,
        _source: 'master_book',
      });
      if (entry.place_id) existingIds.add(entry.place_id);
      existingNames.add(normalizeName(mk));
      masterInjected++;
    }
    console.log(`\u2705 MASTER_BOOK base: ${masterInjected} restaurants within ${maxDistMiles}mi`);

    const michelin = await resolveMichelinPlaces(KEY);
    attachMichelinBadges(within, michelin);

    // Attach Bib Gourmand booking data
    const bibAll = getBibGourmandPlaces();
    const bibByName = new Map();
    for (const b of bibAll) { if (b?.name) bibByName.set(normalizeName(b.name), b); }
    for (const c of within) {
      const b = normalizeName(c?.name) && bibByName.get(normalizeName(c.name));
      if (b && !c.michelin) {
        c.michelin = { stars: 0, distinction: 'bib_gourmand' };
        c.booking_platform = b.booking_platform || null;
        c.booking_url = b.booking_url || null;
      }
    }
    let injected = 0;
    for (const m of michelin) {
      if (!m?.lat || !m?.lng) continue;
      if (m.place_id && existingIds.has(m.place_id)) continue;
      if (m.name && existingNames.has(normalizeName(m.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(m.name, cuisineStr, m.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, m.lat, m.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: m.place_id, name: m.name,
        vicinity: m.address || '', formatted_address: m.address || '',
        price_level: m.price_level || null, opening_hours: null,
        geometry: { location: { lat: m.lat, lng: m.lng } },
        types: [], googleRating: m.googleRating || 0, googleReviewCount: m.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 15), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: { stars: m.stars || 0, distinction: m.distinction || 'star' },
        cuisine: CUISINE_LOOKUP[m.name] || m.cuisine || null,
        booking_platform: m.booking_platform || null,
        booking_url: m.booking_url || null,
        _source: 'michelin_inject'
      });
      if (m.place_id) existingIds.add(m.place_id);
      existingNames.add(normalizeName(m.name));
      injected++;
    }
    if (injected) console.log(`\u2705 Injected ${injected} Michelin restaurants not in Google results`);

    // INJECT Bib Gourmand restaurants not in Google results
    const bibPlaces = getBibGourmandPlaces();
    let bibInjected = 0;
    for (const b of bibPlaces) {
      if (!b?.lat || !b?.lng) continue;
      if (b.name && existingNames.has(normalizeName(b.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(b.name, cuisineStr, b.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, b.lat, b.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: null, name: b.name,
        vicinity: b.address || '', formatted_address: b.address || '',
        price_level: b.price_level || null, opening_hours: null,
        geometry: { location: { lat: b.lat, lng: b.lng } },
        types: [], googleRating: 0, googleReviewCount: 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 15), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: { stars: 0, distinction: 'bib_gourmand' }, cuisine: CUISINE_LOOKUP[b.name] || b.cuisine || null,
        booking_platform: b.booking_platform || null,
        booking_url: b.booking_url || null,
        _source: 'bib_inject'
      });
      existingNames.add(normalizeName(b.name));
      bibInjected++;
    }
    if (bibInjected) console.log(`\u2705 Injected ${bibInjected} Bib Gourmand restaurants not in Google results`);

    // INJECT Popular 4.4+ restaurants not in Google results
    const popularPlaces = getPopularPlaces();
    let popularInjected = 0;
    for (const p of popularPlaces) {
      if (!p?.lat || !p?.lng) continue;
      if (p.place_id && existingIds.has(p.place_id)) continue;
      if (p.name && existingNames.has(normalizeName(p.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(p.name, cuisineStr, p.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, p.lat, p.lng);
      if (d > 7.0) continue;
      within.push({
        place_id: p.place_id || null, name: p.name,
        vicinity: p.address || '', formatted_address: p.address || '',
        price_level: p.price_level || null, opening_hours: null,
        geometry: { location: { lat: p.lat, lng: p.lng } },
        types: [], googleRating: p.googleRating || 0, googleReviewCount: p.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 15), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: null, cuisine: CUISINE_LOOKUP[p.name] || p.cuisine || null,
        booking_platform: p.booking_platform || null,
        booking_url: p.booking_url || null,
        _source: 'popular_inject'
      });
      if (p.place_id) existingIds.add(p.place_id);
      existingNames.add(normalizeName(p.name));
      popularInjected++;
    }
    if (popularInjected) console.log(`\u2705 Injected ${popularInjected} popular 4.4+ restaurants not in other results`);

    // TAG + INJECT Chase Sapphire restaurants
    const chaseNameSet = new Set();
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (c?.name) chaseNameSet.add(normalizeName(c.name));
    }
    for (const r of within) {
      if (r?.name && chaseNameSet.has(normalizeName(r.name))) {
        r.chase_sapphire = true;
      }
    }
    let chaseInjected = 0;
    for (const c of CHASE_SAPPHIRE_BASE) {
      if (!c?.lat || !c?.lng) continue;
      if (c.name && existingNames.has(normalizeName(c.name))) continue;
      if (cuisineStr && !cuisineLookupMatches(c.name, cuisineStr, c.cuisine)) continue;
      const d = haversineMiles(gLat, gLng, c.lat, c.lng);
      if (d > 15.0) continue;
      within.push({
        place_id: null, name: c.name,
        vicinity: c.address || '', formatted_address: c.address || '',
        price_level: c.price_level || null, opening_hours: null,
        geometry: { location: { lat: c.lat, lng: c.lng } },
        types: [], googleRating: c.googleRating || 0, googleReviewCount: c.googleReviewCount || 0,
        distanceMiles: Math.round(d * 10) / 10,
        walkMinEstimate: Math.round(d * 15), driveMinEstimate: Math.round(d * 4), transitMinEstimate: Math.round(d * 6),
        michelin: null, cuisine: CUISINE_LOOKUP[c.name] || c.cuisine || null,
        booking_platform: c.booking_platform || null,
        booking_url: c.booking_url || null,
        chase_sapphire: true,
        _source: 'chase_inject'
      });
      existingNames.add(normalizeName(c.name));
      chaseInjected++;
    }
    if (chaseInjected) console.log(`\u2705 Injected ${chaseInjected} Chase Sapphire restaurants not in other results`);

    // INJECT Google results last — fills in anything MASTER_BOOK missed
    // 250+ review minimum — below that is likely noise already covered by master
    let googleInjected = 0;
    for (const g of googleResults) {
      if (!g.place_id && !g.name) continue;
      if ((g.googleReviewCount || g.user_ratings_total || 0) < 250) continue;
      if (g.place_id && existingIds.has(g.place_id)) continue;
      if (g.name && existingNames.has(normalizeName(g.name))) continue;
      const gmk = (g.name||'').toLowerCase().trim();
      const gmaster = MASTER_BOOK[gmk] || MASTER_BOOK[gmk.replace(/^the /,'')] || {};
      within.push({ ...g, _source: g._source || 'google', instagram: g.instagram || gmaster.instagram || null, website: g.website || gmaster.website || null });
      if (g.place_id) existingIds.add(g.place_id);
      if (g.name) existingNames.add(normalizeName(g.name));
      googleInjected++;
    }
    if (googleInjected) console.log(`\u2705 Injected ${googleInjected} restaurants from Google not in MASTER_BOOK`);

    // Final dedup pass — catch any duplicates from multiple inject paths
    const deduped = [];
    const dedupSeen = new Set();
    for (const r of within) {
      const key = r.place_id || normalizeName(r.name);
      if (!key || dedupSeen.has(key)) continue;
      dedupSeen.add(key);
      // Also dedupe by normalized name if place_id was the key
      if (r.place_id && r.name) {
        const nk = normalizeName(r.name);
        if (nk && dedupSeen.has(nk)) continue;
        dedupSeen.add(nk);
      }
      deduped.push(r);
    }
    if (deduped.length < within.length) console.log(`\ud83e\uddf9 Deduped: removed ${within.length - deduped.length} duplicate restaurants`);
    within.length = 0;
    within.push(...deduped);

    const fStart = Date.now();
    const { elite, moreOptions, excluded } = filterRestaurantsByTier(within, qualityMode);
    timings.filtering_ms = Date.now() - fStart;

    // DETECT BOOKING PLATFORMS for visible restaurants
    const detectStart = Date.now();
    const visibleRestaurants = [...elite, ...moreOptions];
    await detectBookingPlatforms(visibleRestaurants, KEY);
    timings.booking_detect_ms = Date.now() - detectStart;

    timings.total_ms = Date.now() - t0;

    // Enrich all results with NYT data from MASTER_BOOK
    [...elite, ...moreOptions].forEach(r => enrichNYT(r));

    // Compute SeatWize scores for all visible restaurants
    [...elite, ...moreOptions].forEach(r => { r.seatwizeScore = computeSeatWizeScore(r); });

    const sortFn = (a,b) => {
      const rA = Number(a.googleRating||0), rB = Number(b.googleRating||0);
      if (rB !== rA) return rB - rA;
      if ((b.seatwizeScore||0) !== (a.seatwizeScore||0)) return (b.seatwizeScore||0) - (a.seatwizeScore||0);
      return String(a.name||'').localeCompare(String(b.name||''));
    };
    elite.sort(sortFn); moreOptions.sort(sortFn);

    const stats = {
      totalRaw: rawN, uniquePlaceIds: all.length, withinMiles: within.length,
      eliteCount: elite.length, moreOptionsCount: moreOptions.length, excluded: excluded.length,
      sources: { legacy: legacyN, newNearby: nearbyN, newText: textN },
      confirmedAddress, userLocation: { lat: gLat, lng: gLng }, qualityMode,
      performance: { ...timings, cache_hit: false }
    };

    setCache(cacheKey, { elite, moreOptions, stats });
    return stableResponse(elite, moreOptions, stats);

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ elite: [], moreOptions: [], stats: {}, error: error.message }) };
  }
};
