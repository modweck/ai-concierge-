const fs = require('fs');
const https = require('https');

const broken = JSON.parse(fs.readFileSync('broken_resy_entries.json','utf8'));
const entries = Object.entries(broken);
console.log('Testing', entries.length, 'broken Resy entries...\n');

function testUrl(url) {
  return new Promise((resolve) => {
    const slug = url.split('resy.com/cities/')[1] || '';
    const parts = slug.split('/');
    let city, venue;
    if (parts.includes('venues')) {
      city = parts[0];
      venue = parts[parts.length - 1];
    } else {
      city = parts[0];
      venue = parts[parts.length - 1];
    }
    const apiUrl = 'https://api.resy.com/3/venue?url_slug=' + venue + '&location=' + city;
    const options = {
      headers: {
        'authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        'x-origin': 'https://resy.com',
        'origin': 'https://resy.com',
        'referer': 'https://resy.com/',
        'accept': 'application/json, text/plain, */*'
      }
    };
    https.get(apiUrl, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const j = JSON.parse(data);
            resolve({ status: 'found', name: j.name || '', slug: venue });
          } catch(e) { resolve({ status: 'bad_json', code: res.statusCode }); }
        } else {
          resolve({ status: 'not_found', code: res.statusCode });
        }
      });
    }).on('error', () => resolve({ status: 'error' }));
  });
}

async function main() {
  let found = 0, notFound = 0;
  for (let i = 0; i < Math.min(5, entries.length); i++) {
    const [name, info] = entries[i];
    const r = await testUrl(info.url);
    console.log('[' + (i+1) + '] ' + name + ' -> ' + r.status + (r.code ? ' (' + r.code + ')' : '') + (r.name ? ' = ' + r.name : ''));
    if (r.status === 'found') found++; else notFound++;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('\nFound:', found, '| Not found:', notFound);
}
main();
