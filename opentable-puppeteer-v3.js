const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const args = process.argv.slice(2);
const MODE_SEARCH = args.includes('--search') || args.includes('--both');
const MODE_AVAIL = args.includes('--availability') || args.includes('--both');
const QUICK = args.includes('--quick');
if (!MODE_SEARCH && !MODE_AVAIL) { console.log('Usage: node opentable-puppeteer-v3.js --search|--availability|--both [--quick]'); process.exit(0); }
const BOOKING_FILE = path.join(__dirname, 'netlify/functions/booking_lookup.json');
const GOOGLE_FILE = path.join(__dirname, 'google_restaurants.json');
const AVAIL_FILE = path.join(__dirname, 'netlify/functions/availability_data.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const DATE_STR = tomorrow.toISOString().split('T')[0];
const STOP = ['the','and','restaurant','bar','grill','cafe','kitchen','nyc','new','york'];
function matchScore(search, found) {
  const c = s => s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const sc = c(search), fc = c(found);
  if (sc === fc) return 1.0;
  if (fc.includes(sc) || sc.includes(fc)) return 0.9;
  const sw = sc.split(' ').filter(w => w.length > 2 && !STOP.includes(w));
  const fw = fc.split(' ').filter(w => w.length > 2 && !STOP.includes(w));
  if (sw.length === 0) return 0;
  const overlap = sw.filter(w => fw.some(f => f.includes(w) || w.includes(f)));
  return overlap.length / sw.length;
}
async function searchOT(page, name) {
  const clean = name.replace(/\(.*\)/g,'').replace(/[^\w\s'-]/g,'').replace(/\s+/g,' ').trim();
  const url = `https://www.opentable.com/s?term=${encodeURIComponent(clean)}&dateTime=${DATE_STR}T19%3A00%3A00&covers=2&metroId=8`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await sleep(2500);
    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"]');
      const seen = new Set(), out = [];
      for (const card of cards) {
        const rid = card.getAttribute('data-rid') || '';
        if (seen.has(rid)) continue; seen.add(rid);
        const nl = card.querySelector('a[data-test="res-card-name"]');
        const pl = card.querySelector('a[data-test^="restaurant-card-profile-link"]');
        const n = nl ? nl.textContent.trim() : '';
        const u = pl ? pl.getAttribute('href') : '';
        if (!n || !u) continue;
        const slots = [];
        const sc = card.querySelector('ul[data-test="time-slots"]');
        if (sc) { for (const li of sc.querySelectorAll('li[data-test^="time-slot"]')) { const m = li.textContent.trim().match(/^(\d{1,2}:\d{2}\s*[AP]M)/i); if (m) slots.push(m[1]); } }
        out.push({ name: n, url: u, rid, slots });
      }
      return out;
    });
    let best = null, bestS = 0;
    for (const it of items) { const s = matchScore(clean, it.name); if (s > bestS) { bestS = s; best = { ...it, score: s }; } }
    return best && bestS >= 0.5 ? best : null;
  } catch(e) { return null; }
}
async function searchMode(browser) {
  const BK = JSON.parse(fs.readFileSync(BOOKING_FILE,'utf8'));
  const GG = JSON.parse(fs.readFileSync(GOOGLE_FILE,'utf8'));
  const has = n => { const c = n.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); return Object.keys(BK).some(k => { const kc = k.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); return kc === c && (BK[k].url||'').match(/resy|opentable/); }); };
  let list = GG.filter(r => r.name && r.name.length > 2 && !/^\d/.test(r.name) && !has(r.name));
  if (QUICK) list = list.slice(0, 10);
  console.log(`\n🔍 OPENTABLE SEARCH v3\n📊 ${list.length} restaurants | 📅 ${DATE_STR}\n`);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
  let found = 0, nf = 0; const ne = {};
  for (let i = 0; i < list.length; i++) {
    const nm = list[i].name; process.stdout.write(`  [${i+1}/${list.length}] ${nm}...`);
    const r = await searchOT(page, nm);
    if (r && r.url) { const fu = r.url.startsWith('http') ? r.url : `https://www.opentable.com${r.url}`; const si = r.slots.length > 0 ? ` (${r.slots.length} slots: ${r.slots.slice(0,3).join(', ')})` : ''; console.log(` ✅ ${r.name}${si}`); ne[nm.toLowerCase().trim()] = { platform: 'opentable', url: fu }; found++; }
    else { console.log(` ❌`); nf++; }
    await sleep(2000);
  }
  await page.close();
  console.log(`\n${'═'.repeat(50)}\n✅ Found: ${found} | ❌ Not found: ${nf}`);
  if (Object.keys(ne).length > 0) { const m = { ...BK, ...ne }; fs.writeFileSync(BOOKING_FILE, JSON.stringify(m, null, 2)); console.log(`💾 booking_lookup: ${Object.keys(BK).length} → ${Object.keys(m).length}`); }
}
async function availMode(browser) {
  const BK = JSON.parse(fs.readFileSync(BOOKING_FILE,'utf8'));
  let av = {}; try { av = JSON.parse(fs.readFileSync(AVAIL_FILE,'utf8')); } catch(e) {}
  const ot = Object.entries(BK).filter(([,v]) => (v.url||'').includes('opentable.com')).map(([n,v]) => ({ name: n, url: v.url }));
  let list = QUICK ? ot.slice(0, 10) : ot;
  console.log(`\n🔴 OPENTABLE AVAILABILITY v3\n📊 ${list.length} restaurants | 📅 ${DATE_STR}\n`);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
  let ok = 0, so = 0, err = 0;
  for (let i = 0; i < list.length; i++) {
    const { name, url } = list[i]; process.stdout.write(`  [${i+1}/${list.length}] ${name}...`);
    const r = await searchOT(page, name);
    if (r && r.slots.length > 0) { console.log(` 🟢 ${r.slots.length} slots (${r.slots.slice(0,4).join(', ')})`); ok++; av[name] = { platform:'opentable', status:'available', total_slots:r.slots.length, prime_slots:r.slots.length, slots:r.slots, url, checked_date:DATE_STR, checked_at:new Date().toISOString() }; }
    else if (r && r.url) { console.log(` 🔴 No slots`); so++; av[name] = { platform:'opentable', status:'sold_out', total_slots:0, prime_slots:0, slots:[], url, checked_date:DATE_STR, checked_at:new Date().toISOString() }; }
    else { console.log(` ❌ Not found`); err++; }
    await sleep(2000);
  }
  await page.close();
  console.log(`\n${'═'.repeat(50)}\n🟢 Available: ${ok} | 🔴 Sold out: ${so} | ❌ Errors: ${err}`);
  fs.writeFileSync(AVAIL_FILE, JSON.stringify(av, null, 2)); console.log(`💾 Saved availability_data.json`);
}
async function main() {
  console.log('\n🚀 OpenTable Puppeteer v3 - Fixed selectors');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--window-size=1280,800','--disable-blink-features=AutomationControlled'] });
  try { if (MODE_SEARCH) await searchMode(browser); if (MODE_AVAIL) await availMode(browser); } finally { await browser.close(); }
  console.log('✅ All done!\n');
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
