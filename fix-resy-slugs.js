const fs = require('fs');
const https = require('https');

const BK = JSON.parse(fs.readFileSync('netlify/functions/booking_lookup.json','utf8'));
const AVAIL = JSON.parse(fs.readFileSync('netlify/functions/availability_data.json','utf8'));

// Find Resy entries that failed availability check
// These are entries in booking_lookup with resy URLs but NOT in availability_data (or with error status)
const resy = Object.entries(BK).filter(([,v]) => (v.url||'').includes('resy.com'));
const working = Object.keys(AVAIL).filter(k => AVAIL[k].platform === 'resy' && AVAIL[k].status !== 'error');

console.log('Total Resy entries:', resy.length);
console.log('Working Resy (in availability):', working.length);

// Find ones that aren't working
const workingSet = new Set(working.map(w => w.toLowerCase().trim()));
const broken = resy.filter(([k]) => {
  return workingSet.has(k.toLowerCase().trim()) === false;
});

console.log('Broken/unchecked Resy:', broken.length);
console.log('\nFirst 20:');
broken.slice(0,20).forEach(([k,v]) => console.log(' ', k, '->', v.url));

// Save the list
fs.writeFileSync('broken_resy_entries.json', JSON.stringify(
  Object.fromEntries(broken), null, 2
));
console.log('\n💾 Saved broken_resy_entries.json');
