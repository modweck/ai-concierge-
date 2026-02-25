const puppeteer = require('puppeteer');
async function main() {
  console.log('\n🔍 OpenTable Card Inspector\n');
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
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  const cards = await page.evaluate(() => {
    const results = [];
    const cardEls = document.querySelectorAll('[data-test="pinned-restaurant-card"], [data-test="restaurant-card"], .multiSearchRestaurantCard');
    for (const card of cardEls) {
      const ci = { dataTest: card.getAttribute('data-test'), dataRid: card.getAttribute('data-rid'), links: [], slotTexts: [], text: card.innerText.substring(0,200) };
      const links = card.querySelectorAll('a[href]');
      for (const l of links) { ci.links.push({ href: l.getAttribute('href'), text: l.textContent.trim().substring(0,80), dt: l.getAttribute('data-test') }); }
      const slotContainer = card.querySelector('ul[data-test="time-slots"]');
      if (slotContainer) { ci.slotTexts = [...slotContainer.querySelectorAll('li[data-test^="time-slot"]')].map(s => s.textContent.trim()); }
      const timePattern = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
      ci.timeButtons = [...card.querySelectorAll('button, a')].filter(b => timePattern.test(b.textContent.trim())).map(b => b.textContent.trim());
      results.push(ci);
    }
    return results;
  });
  console.log('Found', cards.length, 'cards:\n');
  cards.forEach((c, i) => {
    console.log('--- Card', i+1, '---');
    console.log('  data-test:', c.dataTest, '| data-rid:', c.dataRid);
    console.log('  Links:');
    c.links.forEach(l => console.log('    [' + (l.dt||'none') + '] "' + l.text + '" ->', l.href));
    console.log('  Slots (data-test):', c.slotTexts.length ? c.slotTexts.join(', ') : 'NONE');
    console.log('  Time buttons:', c.timeButtons.length ? c.timeButtons.join(', ') : 'NONE');
    console.log('  Text:', c.text.substring(0,120));
    console.log('');
  });
  await browser.close();
  console.log('Done!');
}
main();
