const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let changes = 0;

// Add a helper function to detect broad city-level searches
const broadCityFunc = `
function isBroadCitySearch(location) {
  if (!location) return false;
  const loc = location.toLowerCase().trim().replace(/[,\\.]/g, '').replace(/\\s+/g, ' ');
  const broadTerms = ['new york ny', 'new york new york', 'nyc', 'manhattan ny', 'manhattan new york', 'brooklyn ny', 'brooklyn new york', 'queens ny', 'queens new york', 'bronx ny', 'bronx new york', 'new york city'];
  return broadTerms.some(t => loc === t || loc.startsWith(t + ' '));
}
`;

// Insert after the michelinRank function
const insertAfter = `function michelinRank(r) {
  if (!r.michelin) return 0;
  const d = r.michelin.distinction || '';
  const s = r.michelin.stars || 0;
  if (s >= 1) return 100 + s;
  if (d === 'bib_gourmand' || d === 'bib') return 50;
  if (d === 'recommended') return 25;
  return 10;
}`;

if (html.includes(insertAfter)) {
  html = html.replace(insertAfter, insertAfter + '\n' + broadCityFunc);
  changes++;
  console.log('✅ Added isBroadCitySearch function');
}

// Now modify the distance filter to skip when broad city search
// Find the distance filtering block after enrichment
const oldFilter = `    let realTimeFiltered = allRestaurants;
    if (state.rewardsFilter === 'any') {
      if (state.transport === 'walk' && maxWalkMinutes) realTimeFiltered = realTimeFiltered.filter(r => r.walkMinutes != null && r.walkMinutes <= maxWalkMinutes);
      else if (state.transport === 'drive' && maxDriveMinutes) realTimeFiltered = realTimeFiltered.filter(r => r.driveMinutes != null && r.driveMinutes <= maxDriveMinutes);
      else if (state.transport === 'transit' && maxTransitMinutes) realTimeFiltered = realTimeFiltered.filter(r => r.transitMinutes != null && r.transitMinutes <= maxTransitMinutes);
    }`;

const newFilter = `    let realTimeFiltered = allRestaurants;
    const userLocation = document.getElementById('addressInput').value;
    if (state.rewardsFilter === 'any' && !isBroadCitySearch(userLocation)) {
      if (state.transport === 'walk' && maxWalkMinutes) realTimeFiltered = realTimeFiltered.filter(r => r.walkMinutes != null && r.walkMinutes <= maxWalkMinutes);
      else if (state.transport === 'drive' && maxDriveMinutes) realTimeFiltered = realTimeFiltered.filter(r => r.driveMinutes != null && r.driveMinutes <= maxDriveMinutes);
    }`;

if (html.includes(oldFilter)) {
  html = html.replace(oldFilter, newFilter);
  changes++;
  console.log('✅ Skip distance filter for broad NYC searches');
} else {
  console.log('⚠️ Distance filter block not found');
}

fs.writeFileSync('index.html', html);
console.log('\n' + changes + ' changes applied');
console.log('\nNext: git add index.html && git commit -m "Show all restaurants for broad NYC searches" && git push');
