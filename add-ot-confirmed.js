#!/usr/bin/env node
/**
 * ADD CONFIRMED OPENTABLE RESTAURANTS
 * These 25 restaurants were found by v2 with verified real IDs.
 * Just adds them directly to booking_lookup.json and popular_nyc.json.
 * 
 * RUN: cd ~/ai-concierge- && node add-ot-confirmed.js
 */

const fs = require('fs');
const path = require('path');

const FUNC_DIR = path.join(__dirname, 'netlify', 'functions');
const BOOKING_FILE = path.join(FUNC_DIR, 'booking_lookup.json');
const POPULAR_FILE = path.join(FUNC_DIR, 'popular_nyc.json');

let BOOKING = {}; try { BOOKING = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); } catch(e) {}
let POPULAR = []; try { POPULAR = JSON.parse(fs.readFileSync(POPULAR_FILE, 'utf8')); } catch(e) {}

const confirmed = [
  { name: 'Up Thai', rid: 334924, slug: 'up-thai' },
  { name: 'La Pecora Bianca Bryant Park', rid: 1207555, slug: 'la-pecora-bianca-bryant-park' },
  { name: 'La Pecora Bianca SoHo', rid: 1182799, slug: 'la-pecora-bianca-soho' },
  { name: 'La Pecora Bianca UWS', rid: 1293373, slug: 'la-pecora-bianca-uws' },
  { name: 'La Pecora Bianca UES', rid: 1208302, slug: 'la-pecora-bianca-ues' },
  { name: 'La Pecora Bianca Midtown', rid: 986275, slug: 'la-pecora-bianca-midtown' },
  { name: 'Thai Villa', rid: 334744, slug: 'thai-villa' },
  { name: 'Sala Thai', rid: 1023928, slug: 'sala-thai-nyc' },
  { name: 'Aqua Boil', rid: 1401595, slug: 'aqua-boil' },
  { name: 'Lucky Cat', rid: 1392808, slug: 'lucky-cat-nyc' },
  { name: 'ZOI MEDITERRANEAN UES', rid: 1201135, slug: 'zoi-mediterranean-ues' },
  { name: 'SUKH', rid: 1334422, slug: 'sukh' },
  { name: 'Broadstone Bar & Kitchen', rid: 1017223, slug: 'broadstone-bar-and-kitchen' },
  { name: 'Pure Thai Cookhouse', rid: 238921, slug: 'pure-thai-cookhouse' },
  { name: 'Toro Loco', rid: 1005613, slug: 'toro-loco-nyc' },
  { name: 'Skinos', rid: 1248067, slug: 'skinos' },
  { name: 'La Contenta', rid: 253987, slug: 'la-contenta' },
  { name: 'Carla', rid: 1259536, slug: 'carla-nyc' },
  { name: 'WOKUNI', rid: 986998, slug: 'wokuni' },
  { name: 'Copinette', rid: 1011319, slug: 'copinette' },
  { name: 'Hav & Mar', rid: 1259890, slug: 'hav-and-mar' },
  { name: 'Frida Midtown', rid: 139597, slug: 'frida-midtown' },
  { name: 'Zaytinya', rid: 1183219, slug: 'zaytinya-new-york' },
  { name: 'Twin Tails', rid: 1383292, slug: 'twin-tails' },
  { name: 'Crane Club', rid: 1387297, slug: 'crane-club' },
];

let added = 0;
let updated = 0;

for (const r of confirmed) {
  const url = `https://www.opentable.com/r/${r.slug}`;
  
  // Add to booking_lookup
  if (!BOOKING[r.name]) {
    BOOKING[r.name] = { platform: 'opentable', url, restaurant_id: r.rid };
    added++;
    console.log(`✅ Added: ${r.name} (ID: ${r.rid})`);
  } else {
    console.log(`⏭️  Already exists: ${r.name}`);
  }
  
  // Update popular_nyc
  const match = POPULAR.find(p => p.name?.toLowerCase().trim() === r.name.toLowerCase().trim());
  if (match && !match.booking_platform) {
    match.booking_platform = 'opentable';
    match.booking_url = url;
    updated++;
  }
}

fs.writeFileSync(BOOKING_FILE, JSON.stringify(BOOKING, null, 2));
fs.writeFileSync(POPULAR_FILE, JSON.stringify(POPULAR, null, 2));

console.log(`\n📊 Done!`);
console.log(`  📝 +${added} new booking links added`);
console.log(`  📝 ${updated} popular_nyc entries updated`);
console.log(`  📊 Total bookings: ${Object.keys(BOOKING).length}`);
