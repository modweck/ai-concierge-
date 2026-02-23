const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let changes = 0;

// 1. Rename "Any Quality" to "All Rated 4.4+"
const oldAny = `<option value="any" selected>Any Quality</option>`;
const newAny = `<option value="any" selected>All Rated 4.4+</option>`;
if (html.includes(oldAny)) {
  html = html.replace(oldAny, newAny);
  changes++;
  console.log('✅ Renamed "Any Quality" to "All Rated 4.4+"');
}

// 2. Remove "Recommended (4.4+)" option
const old44 = `          <option value="recommended_44">Recommended (4.4+)</option>\n`;
if (html.includes(old44)) {
  html = html.replace(old44, '');
  changes++;
  console.log('✅ Removed Recommended (4.4+) option');
}

// 3. Remove "Elite (4.5+)" option
const old45 = `          <option value="elite_45">Elite (4.5+)</option>\n`;
if (html.includes(old45)) {
  html = html.replace(old45, '');
  changes++;
  console.log('✅ Removed Elite (4.5+) option');
}

// 4. Rename "Strict Elite (4.7+)" to "Top Rated (4.7+)"
const old47 = `<option value="strict_elite_47">Strict Elite (4.7+)</option>`;
const new47 = `<option value="strict_elite_47">Top Rated (4.7+)</option>`;
if (html.includes(old47)) {
  html = html.replace(old47, new47);
  changes++;
  console.log('✅ Renamed "Strict Elite (4.7+)" to "Top Rated (4.7+)"');
}

// 5. Remove transit transport button
const transitBtn = `          <button class="toggle-btn" onclick="setTransport(event,'transit')">🚇 Transit</button>\n`;
if (html.includes(transitBtn)) {
  html = html.replace(transitBtn, '');
  changes++;
  console.log('✅ Removed Transit transport button');
}

// 6. Remove transit distance selector div
const transitDiv = `      <div id="transitDistance" style="margin-bottom:20px;display:none">
        <label>🚇 Max Transit</label>
        <select id="transitTime">
          <option value="15">15 min</option>
          <option value="20" selected>20 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
        </select>
      </div>`;
if (html.includes(transitDiv)) {
  html = html.replace(transitDiv, '');
  changes++;
  console.log('✅ Removed Transit distance selector');
}

// 7. Remove transit badge from renderCard
const transitBadge = `  if (r.transitMinutes != null) distanceHtml += \`<span class="badge distance">🚇 \${r.transitMinutes} min</span>\`;\n`;
if (html.includes(transitBadge)) {
  html = html.replace(transitBadge, '');
  changes++;
  console.log('✅ Removed transit badge from cards');
}

fs.writeFileSync('index.html', html);
console.log('\n' + changes + ' changes applied');
console.log('\nNext: git add index.html && git commit -m "UI cleanup: simplify quality options, remove transit" && git push');
