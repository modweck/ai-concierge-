#!/usr/bin/env node
/**
 * Restaurant.com Checker v3 - NYC Only (Manhattan, Brooklyn, Queens)
 */

const fs = require('fs');
const path = require('path');

const DELAY_MS = 2000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const SEARCH_CONFIGS = [
  { name: 'Manhattan', address: 'Manhattan, New York, NY, USA', lat: 40.71451, lng: -74.00602 },
  { name: 'Brooklyn', address: 'Brooklyn, New York, NY, USA', lat: 40.6782, lng: -73.9442 },
  { name: 'Queens', address: 'Queens, New York, NY, USA', lat: 40.7282, lng: -73.7949 },
];

function parseRestaurants(text) {
  const restaurants = [];
  const seen = new Set();

  const md1 = /###\s*\[([^\]]+)\]\((https?:\/\/[^)]*\/locations\/[^)]+)\)/g;
  let m;
  while ((m = md1.exec(text)) !== null) addResult(m[1], m[2]);

  const md2 = /\[([^\]]+)\]\((https?:\/\/[^)]*\/locations\/[^)]+)\)/g;
  while ((m = md2.exec(text)) !== null) addResult(m[1], m[2]);

  const html1 = /href="([^"]*\/locations\/[^"]+)"[^>]*>(?:<[^>]*>)*([^<]+)/g;
  while ((m = html1.exec(text)) !== null) addResult(m[2], m[1]);

  const slugs = text.match(/\/locations\/[\w-]+/g);
  if (slugs) {
    for (const slugPath of slugs) {
      const slug = slugPath.replace('/locations/', '');
      if (!seen.has(slug) && slug.length > 2) {
        const nameParts = slug.replace(/-\d+$/, '').split('-');
        const name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        addResult(name, `https://www.restaurant.com/locations/${slug}`);
      }
    }
  }

  function addResult(name, url) {
    name = name.trim();
    url = url.trim().replace('/index.php/', '/');
    const slug = url.split('/locations/')[1];
    if (slug && name && !seen.has(slug) &&
        !name.includes('Restaurant.com') && !name.includes('logo') &&
        !name.includes('Cart') && name.length > 1 && name.length < 100) {
      seen.add(slug);
      restaurants.push({ name, slug, url: `https://www.restaurant.com/locations/${slug}` });
    }
  }

  return restaurants;
}

async function fetchPage(address, lat, lng, page) {
  const url = `https://www.restaurant.com/search?address=${encodeURIComponent(address)}&lat=${lat}&lng=${lng}&sort=distance&dir=asc&page=${page}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    if (!response.ok) return { restaurants: [], raw: '' };
    const raw = await response.text();
    return { restaurants: parseRestaurants(raw), raw };
  } catch (err) {
    console.log(`    ❌ ${err.message}`);
    return { restaurants: [], raw: '' };
  }
}

async function scrapeArea(config) {
  console.log(`\n📍 ${config.name}`);
  const all = [];
  const slugs = new Set();
  let emptyStreak = 0;

  for (let page = 1; page <= 60; page++) {
    await sleep(DELAY_MS);
    const { restaurants, raw } = await fetchPage(config.address, config.lat, config.lng, page);

    if (raw.includes("aren't many great matches")) {
      console.log(`  📄 Page ${page}: End of results`);
      break;
    }

    if (restaurants.length === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) { console.log(`  📄 Page ${page}: Empty x2, stopping`); break; }
      console.log(`  📄 Page ${page}: 0 parsed`);
      continue;
    }

    emptyStreak = 0;
    let newCount = 0;
    for (const r of restaurants) {
      if (!slugs.has(r.slug)) { slugs.add(r.slug); all.push(r); newCount++; }
    }

    console.log(`  📄 Page ${page}: ${restaurants.length} found, ${newCount} new (total: ${all.length})`);
    if (restaurants.length < 8) break;
  }

  return all;
}

function normalize(name) {
  return name.toLowerCase().replace(/[''""`]/g, '').replace(/[&+]/g, 'and')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function fuzzyMatch(name1, name2) {
  const n1 = normalize(name1);
  const n2 = normalize(name2);
  if (n1 === n2) return 1.0;
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;

  const ignore = new Set(['restaurant','bar','grill','cafe','kitchen','nyc','ny','brooklyn',
    'queens','new york','the','and','of','at','in','on','bistro','ristorante','trattoria','pizzeria']);
  const w1 = n1.split(' ').filter(w => !ignore.has(w) && w.length > 1);
  const w2 = n2.split(' ').filter(w => !ignore.has(w) && w.length > 1);
  if (!w1.length || !w2.length) return 0;

  const shorter = w1.length <= w2.length ? w1 : w2;
  const longer = w1.length <= w2.length ? w2 : w1;
  const matched = shorter.filter(w => longer.some(lw => lw === w || (lw.length > 3 && (lw.includes(w) || w.includes(lw)))));

  if (matched.length === shorter.length && shorter.length >= 1) return 0.8;
  if (matched.length >= 2) return 0.7;
  return 0;
}

async function main() {
  console.log('🔍 Restaurant.com Checker v3 (NYC only)');
  console.log('=========================================\n');

  const googlePath = path.join(__dirname, 'google_restaurants.json');
  if (!fs.existsSync(googlePath)) { console.error('❌ google_restaurants.json not found!'); process.exit(1); }

  const myRestaurants = JSON.parse(fs.readFileSync(googlePath, 'utf-8'));
  console.log(`📋 Your database: ${myRestaurants.length} restaurants`);

  const bookingPath = path.join(__dirname, 'booking_lookup.json');
  let bookingLookup = {};
  if (fs.existsSync(bookingPath)) {
    bookingLookup = JSON.parse(fs.readFileSync(bookingPath, 'utf-8'));
    console.log(`📋 Booking lookup: ${Object.keys(bookingLookup).length} entries`);
  }

  const allRDC = [];
  const globalSlugs = new Set();

  for (const config of SEARCH_CONFIGS) {
    const results = await scrapeArea(config);
    for (const r of results) {
      if (!globalSlugs.has(r.slug)) { globalSlugs.add(r.slug); allRDC.push(r); }
    }
    console.log(`  ✅ Running total: ${allRDC.length} unique listings`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Total Restaurant.com listings: ${allRDC.length}`);

  fs.writeFileSync(path.join(__dirname, 'restaurantcom_listings.json'), JSON.stringify(allRDC, null, 2));
  console.log('💾 Saved: restaurantcom_listings.json');

  console.log(`\n🔗 Cross-referencing with your ${myRestaurants.length} restaurants...\n`);

  const matches = [];
  for (const myR of myRestaurants) {
    const myName = myR.name || myR.restaurant_name || '';
    if (!myName) continue;
    let bestMatch = null, bestScore = 0;
    for (const rdcR of allRDC) {
      const score = fuzzyMatch(myName, rdcR.name);
      if (score > bestScore && score >= 0.7) { bestScore = score; bestMatch = rdcR; }
    }
    if (bestMatch) {
      matches.push({
        your_restaurant: myName,
        restaurantcom_name: bestMatch.name,
        restaurantcom_url: bestMatch.url,
        match_score: bestScore,
      });
    }
  }

  matches.sort((a, b) => b.match_score - a.match_score);
  console.log(`✅ Found ${matches.length} matches!\n`);

  if (matches.length > 0) {
    console.log('MATCHES:');
    console.log('-'.repeat(80));
    for (const m of matches) {
      const label = m.match_score >= 0.95 ? '🎯 EXACT' : m.match_score >= 0.85 ? '✅ STRONG' : '🟡 LIKELY';
      console.log(`${label} | ${m.your_restaurant} → ${m.restaurantcom_name}`);
      console.log(`       ${m.restaurantcom_url}\n`);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'restaurantcom_matches.json'), JSON.stringify(matches, null, 2));
  console.log(`💾 Saved: restaurantcom_matches.json`);
  console.log(`\nYour restaurants: ${myRestaurants.length}`);
  console.log(`Restaurant.com listings: ${allRDC.length}`);
  console.log(`Matches: ${matches.length}`);
  console.log(`\n💰 Affiliate: http://app.impact.com/campaign-campaign-info-v2/Restaurantcom.brand`);
}

main().catch(console.error);
