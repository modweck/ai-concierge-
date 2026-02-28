/**
 * ot-avail-v3.js — OpenTable Availability Checker (Fixed)
 * ===========================================================
 * 
 * RUN:   node ot-avail-v3.js --date 2026-03-01
 * FLAGS: --date YYYY-MM-DD   Date to check (default: tomorrow)
 *        --quick             First 50 only
 *        --debug             Verbose output
 * 
 * COOKIES: Update the COOKIES string below when they expire.
 *          Get fresh ones from Chrome DevTools → Network → copy as cURL
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUICK_MODE = args.includes('--quick');
const DEBUG = args.includes('--debug');

let CHECK_DATE;
const dateIdx = args.indexOf('--date');
if (dateIdx !== -1 && args[dateIdx + 1]) {
  CHECK_DATE = args[dateIdx + 1];
} else {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  CHECK_DATE = tomorrow.toISOString().split('T')[0];
}

const CHECK_TIME = '19:00';
const PARTY_SIZE = 2;
const BASE_HOUR = 19; // 7pm

const OT_FILE = path.join(__dirname, 'ot_full.json');
const AVAIL_FILE = path.join(__dirname, 'ot_availability.json');
const RID_CACHE_FILE = path.join(__dirname, 'ot_rid_cache.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════
// PASTE COOKIES HERE — get fresh ones from Chrome DevTools
// ═══════════════════════════════════════════════════════════════════
const COOKIES = `otuvid=916E769E-D060-4828-A115-73889178A77C; _ga=GA1.1.1985501581.1771677992; _gcl_au=1.1.723513279.1771677992; _fbp=fb.1.1771677992365.1988344458128620; ha_userSession=lastModified=2026-02-25T16%3A55%3A49.000Z&origin=prod-sc2; OT-Interactive-SessionId=f25c27fd-000e-4cc9-bbfe-caa704c52bc7; OT-SessionId=f25c27fd-000e-4cc9-bbfe-caa704c52bc7; bm_ss=ab8e18ef4e; bm_so=EF0EB18C51E7954FAC487CCD7A379C12B87D9494564FC7DC90DEB6DB68133B9B~YAAQxykhF6s9SZ+cAQAA5EUipQZTmvXjF0U6Q0S+GHMNgRCsXCD1WXlSZ5yypIP63E3oFKahPGmVxz9uuIT5F6xJULbHSkP/LkSdhSSAeIEmAQXsX5AhQN/VIQV6dhIxsNhpt5xox7Klq1gvaigDoS49Boyv0JXWzhLIQ2q1Faj1lv1XFagVoudLny6+JTICf+0iXtkdc5ouWT7xwfyG2fMmMJ7+nRUpnYvRm/iYn9ehBXo5pnswxFa0sN3plxqH9uZ+3e3IoU20x/EXyV+VZhclI4zx6BjGr77DVUAOpyhfTe5dm3DAQ48w7AtujYGJCT6+Aybu5GM1PcokpnIQZr6QAOqcAnghktfuyIIt/LdVS3T+yIfyohBDyqMPwDbNf5xGqWv+YOr2VXt9/RGwt62lLYhzGYi/wHehUtQZXV95lpU2cNWJ+wc+hsxjLnjs7Pf8i3JzVIX7OTj5dyzq; _abck=7BC400138D190AF51517DAB7A46343CF~0~YAAQxykhF909SZ+cAQAA20YipQ+ZRZf85ViFWuywCMBppqUGCAHzd+D+2Hc1LuIjF+rtjkUkooFyR9pEAKGvlC/7KNT92FHOW2Z7tuKQ8VLxfeU+JkP2FchhJKGBdMO0byFCL3q9NqbNv9n04AJ6ZUORF+FdXmS6y53+HoONNX4cGqyDsXNW2oL1VNvaHyZZML3gvM42pTbw9xxRbWRzdh46YGZfPXUXaIsZiCZ213ub5fZozGZKfJyF7AexIu2DktJNee/Lc5JvXTNg3ToHNbhApfWkNB8z67S8yvDErmGrcUQ4s+NUy19He31anG1CxtNB5jvl+rXQVtlJB+bsRK4uAi/EfwGI7wD46N3LB7ZGnBBl7hxIRprEI4I9f0DRtnv9/qA2zPnElQD0TCFy3cg58DvxHRSwwciYMERAMvdEuzmnTLd7I5V0rNaNKxKPva8MacN8piqsEcN7OgV1lZOCmBDM8rFFqYa6zQE0umOgBAWsbavsrwXe/TvXhXv6SIC9at/K5PIlRyqM20PNXSz1pTtrE9oqmmFaSqueh27gv8i1wnq3TIrNeHerD7gNv7ZWWtjOKIEBpzSvTkp1Ve7uVrYqAg3tEwuAutDaRZ1wgXafmKs7jDxENrzIIkUYD9fMykg=~-1~-1~-1~AAQAAAAF%2f%2f%2f%2f%2fxbdsnlycw46fNZ2x8UwbwBh%2fpWAANjkhwPOdsJIhSEHRm7fAR%2f7grcVWnYKXW2Y47PmMiNPwVtTjtUrQzNKbOWmNg4K589PeJV9~-1; ak_bmsc=4DE570F0CEB7FFFAC8256F3CA863DDCF~000000000000000000000000000000~YAAQxykhF04+SZ+cAQAAYUkipR7oXu84rlZPJgUohPvpJhTIc+23BMouJv9XDLGmz94UyPeN2e1Q6RnlaldJEGi7lP847Ewz9X/rCuSU16gMKkQdNm7r3jB2FpR3KPoE8di4cTTTGArWeJFqRB3a9X+49LZ/dzFXdvsSUbbm1n3Wy9vFLGPJmVwH6B5pFWqI5zZmLse0435LxhQqqOQDFNxEBEsPuAibuGrwSHMdZBLHsV9MLumqpzOOcNG/zs5s9aZJj9zx3kIPLMOQcpU0mpg+dKk8AZ7US7y67qBEdIyT8qznUDzb8IJe5GYG48AI7eiwXteTgy+iaV0SupULpwC3wK5v+QiYt11IhnQmNyPURmNpAJNI0PFxAYjYO41XRNKiH030+ssjQxOzaY7fobUw3MQMo9UyJPDU5Fhld+cGsnOS6Is2gwalwQoRYqIaQB8BKiXLL6W/iDaOj7xY; bm_lso=EF0EB18C51E7954FAC487CCD7A379C12B87D9494564FC7DC90DEB6DB68133B9B~YAAQxykhF6s9SZ+cAQAA5EUipQZTmvXjF0U6Q0S+GHMNgRCsXCD1WXlSZ5yypIP63E3oFKahPGmVxz9uuIT5F6xJULbHSkP/LkSdhSSAeIEmAQXsX5AhQN/VIQV6dhIxsNhpt5xox7Klq1gvaigDoS49Boyv0JXWzhLIQ2q1Faj1lv1XFagVoudLny6+JTICf+0iXtkdc5ouWT7xwfyG2fMmMJ7+nRUpnYvRm/iYn9ehBXo5pnswxFa0sN3plxqH9uZ+3e3IoU20x/EXyV+VZhclI4zx6BjGr77DVUAOpyhfTe5dm3DAQ48w7AtujYGJCT6+Aybu5GM1PcokpnIQZr6QAOqcAnghktfuyIIt/LdVS3T+yIfyohBDyqMPwDbNf5xGqWv+YOr2VXt9/RGwt62lLYhzGYi/wHehUtQZXV95lpU2cNWJ+wc+hsxjLnjs7Pf8i3JzVIX7OTj5dyzq~1772297013574; ftc=x=2026-02-28T17%3A43%3A45&c=1&pt1=1&pt2=1&er=0; bm_sz=38F4C063D2D0913B12ADE9C1339E0393~YAAQxykhF1pHSZ+cAQAAwHgipR6G/HInkZxlZ2tSoVyzbtbYSh2k74821gGev5ipAiaN5eYs3d75nv0RlHjB5/bIPGxTIAVqYF21RwdMLR6v6+Kj8oCwe1x5Pa35T+mgcKrQXqrmnvvZh9ZTwhHXxEWMWqQTiRdhqS01+Y8OqcwvdyhFZwr69Lpkvdzj7L7XW8aNRPvgJa7v1z+7P6hzXG68ewdg96t4JQkhToe18BKbMIoVhr4hLotGAyuVIKn8dv5GsIEZkNaaq+zmgqhRfs26DwSy60CzbY0ErLmJHuSao8JZxUdHMojHf6JX/mHgP1gQgdtamezW8db+9tfA/gbqvU1Kgu57DLWKu6A1m83QD6GQAZ93f45Tlaws2yiBJ5nde9Sgy1WMg2UFNeY1QcpYEWxsA+jEgjIcHF5gTlrwPAw=~4604739~3752761; OptanonConsent=isGpcEnabled=0&datestamp=Sat+Feb+28+2026+11%3A43%3A47+GMT-0500+(Eastern+Standard+Time)&version=202503.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=13e7c605-5ee5-4510-a6eb-19ae2f1af041&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&AwaitingReconsent=false; bm_s=YAAQxykhF3dISZ+cAQAAUH8ipQTsxlbLr7OiwjAds7JQccmfzBMo5zi1lBJlYKzyaciJSn0hlMJKf6wo9WVv/lHccOh4UT+oz2aF3YdG9geMY1jtnAi1onRzRkWycqTWK3m4I4q7S8A3AglXR1GiZbkz3FyEZJdZ0m1/d3iHJCP/ZcHO+MBA9DRNhdq6NxZQwioKc9D4boVqRa3v9Unz3lfzMNU/Uy/L6KhgadHkjTG78XR+kr0ThWN2TS5ekYF4A7/yWE/NU/YHjyWBrr9PekAd35ceGacTObQ3tkfp2oXFPUHoCWgi4LO3mhFi1IiMVk2xGrFKKv4DFxm4OxnNcxvnv827TlrHh4IxO9n3oVp7KozjiD4JDbhZJ9WreOL4QsR1r+LJUDydXiYXjCIrv/CYGsSYJ2poiT23b+n5SGcXenJX31e7PamPvLmZn//XJqSC4Y7hxx6WR/Kyv7Zq7fL2v9J1NjV7ubTjMqsNrSFQpcTOV1OiwvDu8Q/UdQWR/90/YyNwJa53/xk1JBIWnDl2EhRliGYIut+qX0U78NolDA6piMk3CbiAqZKiwTj0NJfkdmJrsgnoKCQrHZe70Q7pwABrh2suEGSPTYAJpzGpL/3gqIP0E7iZq7Qqb38ahd3Kjysl6kbDOyGoDGPsnP6G0NIHTvh0FZ/mkGemkTkLv49tBrgwJ7UZwyIg2OolS9AprzoytRTOrZhRApxM6xmWsnLrcVg6JWuyq7CXLDVvHOMsE0HYmZQx715JGfqAEzf7gtk=; _uetsid=d1251df0125b11f196b22182f15e00df; _uetvid=20d25ff0c19d11f097e9693c8f466329; _ga_Y77FR7F6XF=GS2.1.s1772297018$o22$g1$t1772297041$j46$l0$h0; otuvid_f=0433cca6-6cb2-4493-9c01-c63a17b2a240; otuvid_p=507e43bd-ef14-47e1-aa7a-d1069ce2ad30; otuvid_t=507b3263-29ac-430f-805c-5f0fd2bbcad8; OT-Session-Update-Date=1772297054; bm_sv=3FB7527E84D881197B4151527DAC3098~YAAQxykhFwxiSZ+cAQAA7+4ipR7IMjlipBQOAIEPJ1MJv6U2L6i6ukBcCXIH0FAKsNmMWM9HB1snB78hAPMfKL0v6KP/Wr0yK1VTuxTiLs46uqEppFuz7PG+1cp9JRNZ5OahbGbfyvEGZXljNsCNe9sC98Y9B0+gK34d6d75jSbSn/oT1FON67c76nHnVYp5Hi/XZV0VEfASKP5+/uddG4ZPg2vN6GR+JNBf5a1IXtymW91l7q7KpbORkTEStt3bBH4Qxg==~1`;

const CSRF_TOKEN = 'b9a7fdd9-61f1-4ba6-9926-702b074078cf';
const GQL_HASH = 'b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af';

const HEADERS = {
  'accept': '*/*',
  'content-type': 'application/json',
  'cookie': COOKIES,
  'origin': 'https://www.opentable.com',
  'referer': 'https://www.opentable.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'x-csrf-token': CSRF_TOKEN,
  'x-query-timeout': '5500'
};

// ═══════════════════════════════════════════════════════════════════
// Get restaurant ID from OT page
// ═══════════════════════════════════════════════════════════════════
async function getRestaurantId(slug) {
  // Try direct URL first (most OT URLs don't have /r/)
  const urls = [
    `https://www.opentable.com/${slug}`,
    `https://www.opentable.com/r/${slug}`
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': HEADERS['user-agent'], 'Cookie': COOKIES },
        redirect: 'follow'
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      const match = html.match(/"rid"\s*:\s*(\d+)/) ||
                    html.match(/"restaurantId"\s*:\s*(\d+)/) ||
                    html.match(/restaurantId[=:](\d+)/) ||
                    html.match(/restref\/client\?rid=(\d+)/) ||
                    html.match(/"restId"\s*:\s*(\d+)/);

      if (match) return parseInt(match[1]);
    } catch (e) {
      if (DEBUG) console.log(`  ⚠️ ${e.message}`);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Check availability via GraphQL (batch of 3)
// ═══════════════════════════════════════════════════════════════════
async function checkBatch(rids, date) {
  const token = 'eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjoxLCJuIjowfQ';
  const body = {
    operationName: 'RestaurantsAvailability',
    variables: {
      onlyPop: false, forwardDays: 0, requireTimes: false, requireTypes: [],
      privilegedAccess: [], restaurantIds: rids,
      date, time: CHECK_TIME, partySize: PARTY_SIZE, databaseRegion: 'NA',
      restaurantAvailabilityTokens: rids.map(() => token),
      slotDiscovery: rids.map(() => 'on'),
      loyaltyRedemptionTiers: [], attributionToken: ''
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: GQL_HASH } }
  };

  try {
    const resp = await fetch('https://www.opentable.com/dapi/fe/gql?optype=query&opname=RestaurantsAvailability', {
      method: 'POST', headers: HEADERS, body: JSON.stringify(body)
    });
    if (!resp.ok) { if (DEBUG) console.log(`  ⚠️ HTTP ${resp.status}`); return null; }
    return await resp.json();
  } catch (e) {
    if (DEBUG) console.log(`  ⚠️ ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Parse the real OT GraphQL response
// ═══════════════════════════════════════════════════════════════════
function parseOTAvailability(restaurantData) {
  if (!restaurantData || !restaurantData.availabilityDays) {
    return { score: 'unknown', total_slots: 0, early: 0, prime: 0, late: 0, slots: [] };
  }

  const day = restaurantData.availabilityDays[0]; // first day (dayOffset: 0)
  if (!day || !day.slots) {
    return { score: 'sold_out', total_slots: 0, early: 0, prime: 0, late: 0, slots: [] };
  }

  let early = 0, prime = 0, late = 0;
  const slotTimes = [];

  for (const slot of day.slots) {
    if (!slot.isAvailable) continue;

    // timeOffsetMinutes is offset from the search time (19:00)
    const offsetMin = slot.timeOffsetMinutes || 0;
    const actualHour = BASE_HOUR + (offsetMin / 60);

    // Convert to readable time
    const h = Math.floor(actualHour);
    const m = Math.round((actualHour - h) * 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    const timeStr = `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    slotTimes.push(timeStr);

    // Categorize (5-6:30pm early, 6:30-8:30pm prime, 8:30-10pm late)
    if (actualHour >= 17 && actualHour < 18.5) early++;
    else if (actualHour >= 18.5 && actualHour < 20.5) prime++;
    else if (actualHour >= 20.5 && actualHour <= 22) late++;
  }

  const total = slotTimes.length;
  let score;
  if (total === 0) score = 'sold_out';
  else if (total <= 2) score = 'nearly_full';
  else if (total <= 5) score = 'limited';
  else if (total <= 10) score = 'moderate';
  else score = 'available';

  return { score, total_slots: total, early, prime, late, slots: slotTimes };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  let otList;
  try { otList = JSON.parse(fs.readFileSync(OT_FILE, 'utf8')); }
  catch (e) { console.error('❌ Cannot load', OT_FILE); process.exit(1); }

  // Load OT-specific availability file (separate from Resy)
  let otAvail = {};
  try { otAvail = JSON.parse(fs.readFileSync(AVAIL_FILE, 'utf8')); }
  catch (e) { /* fresh */ }

  let ridCache = {};
  try { ridCache = JSON.parse(fs.readFileSync(RID_CACHE_FILE, 'utf8')); }
  catch (e) { /* fresh */ }

  // Deduplicate
  const seen = new Set();
  const unique = otList.filter(r => {
    const slug = r.url.replace(/\?.*$/, '').replace(/\/$/, '').split('/').pop();
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    r._slug = slug;
    return true;
  });

  let toProcess = unique;
  if (QUICK_MODE) toProcess = toProcess.slice(0, 50);

  console.log(`\n🍽️  OPENTABLE AVAILABILITY CHECKER v3`);
  console.log(`📅 Date: ${CHECK_DATE} | Time: ${CHECK_TIME} | Party: ${PARTY_SIZE}`);
  console.log(`📊 Total: ${otList.length} | Unique: ${unique.length} | Checking: ${toProcess.length}`);
  console.log(`🔑 Cached RIDs: ${Object.keys(ridCache).length}`);

  // Phase 1: Get restaurant IDs
  const needRid = toProcess.filter(r => !ridCache[r._slug]);
  if (needRid.length) {
    console.log(`\n🔑 Phase 1: Getting ${needRid.length} restaurant IDs...\n`);
    let found = 0;
    for (let i = 0; i < needRid.length; i++) {
      const r = needRid[i];
      process.stdout.write(`  [${i+1}/${needRid.length}] ${r.name.substring(0,40).padEnd(40)} `);
      const rid = await getRestaurantId(r._slug);
      if (rid) {
        ridCache[r._slug] = rid;
        found++;
        console.log(`✅ rid=${rid}`);
      } else {
        console.log(`❌`);
      }
      await sleep(800);

      if ((i + 1) % 50 === 0) {
        fs.writeFileSync(RID_CACHE_FILE, JSON.stringify(ridCache, null, 2));
        console.log(`  💾 Saved (${found} found so far)`);
      }
    }
    fs.writeFileSync(RID_CACHE_FILE, JSON.stringify(ridCache, null, 2));
    console.log(`\n  💾 Phase 1 done: ${found}/${needRid.length} IDs found`);
  }

  // Phase 2: Check availability in batches of 3
  const withRid = toProcess.filter(r => ridCache[r._slug]);
  console.log(`\n📊 Phase 2: Checking availability for ${withRid.length} restaurants...`);
  console.log(`   ⏱️  Estimated: ~${Math.round(withRid.length / 3 * 2.5 / 60)} minutes\n`);

  const BATCH = 3;
  let checked = 0, avail = 0, soldOut = 0, failed = 0;

  for (let i = 0; i < withRid.length; i += BATCH) {
    const batch = withRid.slice(i, i + BATCH);
    const rids = batch.map(r => ridCache[r._slug]);

    process.stdout.write(`  [${i+1}-${Math.min(i+BATCH, withRid.length)}/${withRid.length}] `);

    const result = await checkBatch(rids, CHECK_DATE);

    if (result?.data?.availability) {
      const availArray = result.data.availability;

      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const nameKey = r.name.toLowerCase().trim();
        const rData = availArray.find(a => a.restaurantId === ridCache[r._slug]) || availArray[j];
        const parsed = parseOTAvailability(rData);

        otAvail[nameKey] = {
          name: r.name,
          platform: 'opentable',
          url: r.url,
          rid: ridCache[r._slug],
          ...parsed,
          date: CHECK_DATE,
          checked: new Date().toISOString()
        };

        checked++;
        if (parsed.score === 'sold_out') soldOut++;
        else avail++;
      }

      // Print summary for batch
      const batchSummary = batch.map(r => {
        const k = r.name.toLowerCase().trim();
        const d = otAvail[k];
        return `${d.score}(${d.total_slots})`;
      }).join(' | ');
      console.log(`✅ ${batchSummary}`);
    } else {
      console.log(`❌ batch failed`);
      failed += batch.length;
    }

    await sleep(2000);

    if ((i + BATCH) % 30 === 0) {
      fs.writeFileSync(AVAIL_FILE, JSON.stringify(otAvail, null, 2));
    }
  }

  fs.writeFileSync(AVAIL_FILE, JSON.stringify(otAvail, null, 2));

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Checked:     ${checked}`);
  console.log(`   🟢 Available:   ${avail}`);
  console.log(`   🔴 Sold out:    ${soldOut}`);
  console.log(`   ❌ Failed:      ${failed}`);
  console.log(`\n💾 Saved to ${AVAIL_FILE}`);
  console.log(`\nNext: merge into availability_data.json and deploy`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
