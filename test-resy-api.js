const https = require('https');

const tests = [
  { name: 'tatiana', slug: 'tatiana', city: 'ny' },
  { name: 'lilia', slug: 'lilia', city: 'ny' },
  { name: 'peter luger', slug: 'peter-luger-steak-house', city: 'ny' }
];

for (const t of tests) {
  const url = 'https://api.resy.com/3/venue?url_slug=' + t.slug + '&location=' + t.city;
  console.log('Testing:', t.name, '->', url);
  https.get(url, { headers: { authorization: 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5', 'x-origin': 'https://resy.com' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('  Status:', res.statusCode, '| Body:', data.substring(0, 150));
      console.log('');
    });
  }).on('error', e => console.log('  Error:', e.message));
}
