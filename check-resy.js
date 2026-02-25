const fs = require('fs');
const BK = JSON.parse(fs.readFileSync('netlify/functions/booking_lookup.json','utf8'));
const resy = Object.entries(BK).filter(([,v]) => (v.url||'').includes('resy.com'));
const guessed = resy.filter(([,v]) => v.url.includes('/venues/'));
const curated = resy.filter(([,v]) => v.url.indexOf('/venues/') === -1);
console.log('Curated Resy (original):', curated.length);
console.log('Guessed Resy (from script):', guessed.length);
console.log('\nFirst 10 guessed:');
guessed.slice(0,10).forEach(([k,v]) => console.log(' ', k, '->', v.url));
