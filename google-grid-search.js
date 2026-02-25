const fs = require('fs');
const path = require('path');
const https = require('https');
const API_KEY = 'AIzaSyBX275d7cDYs9Q2rXWocvpCGXLg171gEPU';
const QUICK = process.argv.includes('--quick');
const MIN_RATING = 4.4;
const GOOGLE_FILE = path.join(__dirname, 'google_restaurants.json');
const OUTPUT_FILE = path.join(__dirname, 'google_restaurants_expanded.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GRID = [
  { name: 'Financial District', lat: 40.7075, lng: -74.0089 },
  { name: 'Chinatown/LES', lat: 40.7158, lng: -73.9970 },
  { name: 'SoHo/NoLita', lat: 40.7233, lng: -73.9985 },
  { name: 'West Village', lat: 40.7340, lng: -74.0030 },
  { name: 'East Village', lat: 40.7265, lng: -73.9838 },
  { name: 'Gramercy/Flatiron', lat: 40.7395, lng: -73.9867 },
  { name: 'Chelsea', lat: 40.7465, lng: -74.0014 },
  { name: 'Midtown South', lat: 40.7484, lng: -73.9856 },
  { name: 'Midtown East', lat: 40.7551, lng: -73.9712 },
  { name: 'Midtown West', lat: 40.7590, lng: -73.9893 },
  { name: 'UES South', lat: 40.7650, lng: -73.9650 },
  { name: 'UES North', lat: 40.7750, lng: -73.9570 },
  { name: 'UWS South', lat: 40.7750, lng: -73.9800 },
  { name: 'UWS North', lat: 40.7870, lng: -73.9760 },
  { name: 'Harlem', lat: 40.8100, lng: -73.9500 },
  { name: 'Washington Heights', lat: 40.8400, lng: -73.9400 },
  { name: 'DUMBO/Brooklyn Heights', lat: 40.6980, lng: -73.9900 },
  { name: 'Williamsburg North', lat: 40.7170, lng: -73.9570 },
  { name: 'Williamsburg South', lat: 40.7090, lng: -73.9630 },
  { name: 'Greenpoint', lat: 40.7270, lng: -73.9510 },
  { name: 'Park Slope', lat: 40.6720, lng: -73.9790 },
  { name: 'Prospect Heights/Crown Heights', lat: 40.6740, lng: -73.9620 },
  { name: 'Cobble Hill/Carroll Gardens', lat: 40.6850, lng: -73.9960 },
  { name: 'Fort Greene/Clinton Hill', lat: 40.6880, lng: -73.9710 },
  { name: 'Bushwick', lat: 40.6940, lng: -73.9210 },
  { name: 'Bed-Stuy', lat: 40.6870, lng: -73.9420 },
  { name: 'Bay Ridge', lat: 40.6350, lng: -74.0280 },
  { name: 'Sunset Park', lat: 40.6460, lng: -74.0050 },
  { name: 'Flatbush', lat: 40.6530, lng: -73.9620 },
  { name: 'Astoria West', lat: 40.7720, lng: -73.9270 },
  { name: 'Astoria East', lat: 40.7700, lng: -73.9100 },
  { name: 'Long Island City', lat: 40.7440, lng: -73.9530 },
  { name: 'Jackson Heights', lat: 40.7475, lng: -73.8830 },
  { name: 'Flushing', lat: 40.7630, lng: -73.8300 },
  { name: 'Forest Hills', lat: 40.7180, lng: -73.8440 },
  { name: 'Woodside/Sunnyside', lat: 40.7430, lng: -73.9130 },
  { name: 'Bayside', lat: 40.7680, lng: -73.7770 },
];
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}
async function searchNearby(lat, lng, radius, pageToken) {
  let url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=' + lat + ',' + lng + '&radius=' + radius + '&type=restaurant&key=' + API_KEY;
  if (pageToken) url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=' + pageToken + '&key=' + API_KEY;
  return fetchJSON(url);
}
async function searchGrid(point, radius) {
  const all = [];
  let data = await searchNearby(point.lat, point.lng, radius);
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') { console.log(' ⚠️ ' + data.status); return all; }
  if (data.results) all.push(...data.results);
  let pg = 1;
  while (data.next_page_token && pg < 3) {
    await sleep(2000);
    data = await searchNearby(null, null, null, data.next_page_token);
    if (data.results) all.push(...data.results);
    pg++;
  }
  return all;
}
async function main() {
  console.log('\n🗽 NYC Restaurant Grid Search');
  console.log('Grid points: ' + GRID.length + ' | Min rating: ' + MIN_RATING);
  console.log('Mode: ' + (QUICK ? 'QUICK (3 points)' : 'FULL') + '\n');
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(GOOGLE_FILE, 'utf8')); } catch(e) {}
  const existIds = new Set(existing.map(r => r.place_id).filter(Boolean));
  const existNames = new Set(existing.map(r => (r.name || '').toLowerCase().trim()));
  console.log('Existing: ' + existing.length + ' | IDs: ' + existIds.size + '\n');
  const grid = QUICK ? GRID.slice(0, 3) : GRID;
  const allNew = [];
  let tFound = 0, tHigh = 0, tNew = 0;
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    process.stdout.write('[' + (i+1) + '/' + grid.length + '] ' + p.name + '...');
    const results = await searchGrid(p, 1500);
    const high = results.filter(r => r.rating && r.rating >= MIN_RATING);
    const fresh = high.filter(r => {
      if (existIds.has(r.place_id)) return false;
      if (existNames.has((r.name||'').toLowerCase().trim())) return false;
      return true;
    });
    for (const r of fresh) { existIds.add(r.place_id); existNames.add((r.name||'').toLowerCase().trim()); }
    tFound += results.length; tHigh += high.length; tNew += fresh.length;
    for (const r of fresh) {
      allNew.push({ name: r.name, place_id: r.place_id, rating: r.rating, user_ratings_total: r.user_ratings_total, price_level: r.price_level, vicinity: r.vicinity, lat: r.geometry?.location?.lat, lng: r.geometry?.location?.lng, types: r.types, source: 'grid_search', grid_zone: p.name });
    }
    console.log(' ' + results.length + ' found | ' + high.length + ' @ 4.4+ | ' + fresh.length + ' new');
    await sleep(500);
  }
  console.log('\n' + '='.repeat(50));
  console.log('Total found: ' + tFound);
  console.log('Rated 4.4+: ' + tHigh);
  console.log('New: ' + tNew);
  const merged = [...existing, ...allNew];
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  console.log('\nSaved ' + OUTPUT_FILE);
  console.log('Was: ' + existing.length + ' -> Now: ' + merged.length);
  fs.writeFileSync('new_google_restaurants.json', JSON.stringify(allNew, null, 2));
  console.log('New only: new_google_restaurants.json (' + allNew.length + ')');
  console.log('\nDone!\n');
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
