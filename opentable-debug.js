const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  console.log('\n🔍 OpenTable Debug\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--window-size=1280,800','--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
  const url = 'https://www.opentable.com/s?term=nobu+downtown&dateTime=2026-02-26T19%3A00%3A00&covers=2&metroId=8';
  console.log('Loading:', url);
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Status:', resp.status());
    console.log('URL:', page.url());
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'opentable-debug.png', fullPage: true });
    console.log('Screenshot: opentable-debug.png');
    const title = await page.title();
    console.log('Title:', title);
    const info = await page.evaluate(() => {
      const body = document.body ? document.body.innerText.substring(0,500) : 'NO BODY';
      const cards = document.querySelectorAll('[data-test="pinned-restaurant-card"],[data-test="restaurant-card"],.multiSearchRestaurantCard').length;
      const links = document.querySelectorAll('a[data-test^="restaurant-card-profile-link"]').length;
      const slots = document.querySelectorAll('ul[data-test="time-slots"]').length;
      const dt = [...new Set([...document.querySelectorAll('[data-test]')].map(e=>e.getAttribute('data-test')))].slice(0,30);
      return { body, cards, links, slots, dt, total: document.querySelectorAll('*').length };
    });
    console.log('Cards:', info.cards, '| Links:', info.links, '| Slots:', info.slots);
    console.log('DOM elements:', info.total);
    console.log('data-test attrs:', info.dt.join(', ') || 'NONE');
    console.log('Body preview:', info.body);
  } catch(e) { console.log('Error:', e.message); }
  await browser.close();
  console.log('Done!');
}
main();
