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
    if (parts.includes('venues')) { city = parts[0]; venue = parts[parts.length - 1]; }
    else { city = parts[0]; venue = parts[parts.length - 1]; }
    const apiUrl = 'https://api.resy.com/3/venue?url_slug=' + venue + '&location=' + city;
    const options = { headers: { 'authorization': 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"', 'x-origin': 'https://resy.com', 'origin': 'https://resy.com', 'referer': 'https://resy.com/', 'accept': 'application/json, text/plain, */*' } };
    https.get(apiUrl, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { const j = JSON.parse(data); resolve({ status: 'found', name: j.name || '', slug: venue }); }
          catch(e) { resolve({ status: 'bad_json', code: res.statusCode }); }
        } else { resolve({ status: 'not_found', code: res.statusCode }); }
      });
    }).on('error', () => resolve({ status: 'error' }));
  });
}
async function main() {
  let found = 0, notFound = 0;
  const dead = [], alive = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, info] = entries[i];
    const r = await testUrl(info.url);
    if (r.status === 'found') { console.log('[' + (i+1) + '/' + entries.length + '] ' + name + ' ✅ ' + r.name); found++; alive.push({ key: name, url: info.url, resyName: r.name }); }
    else { console.log('[' + (i+1) + '/' + entries.length + '] ' + name + ' ❌ (' + (r.code||'err') + ')'); notFound++; dead.push({ key: name, url: info.url }); }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('\n✅ Found on Resy:', found);
  console.log('❌ Not on Resy:', notFound);
  fs.writeFileSync('resy_alive.json', JSON.stringify(alive, null, 2));
  fs.writeFileSync('resy_dead.json', JSON.stringify(dead, null, 2));
  console.log('💾 resy_alive.json + resy_dead.json saved');
}
main();
