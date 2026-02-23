#!/usr/bin/env node

/**
 * apply_fixes_to_html.js
 * 
 * Reads smart_fix_report.json and applies the confirmed fixes to index.html
 * Only run this AFTER reviewing the report and confirming the fixes are correct.
 * 
 * Usage: node apply_fixes_to_html.js
 */

const fs = require('fs');

// Load the fix report
let report;
try {
  report = JSON.parse(fs.readFileSync('smart_fix_report.json', 'utf8'));
  console.log(`✅ Loaded smart_fix_report.json (${report.fixed.length} fixes to apply)`);
} catch (err) {
  console.error('❌ Could not load smart_fix_report.json');
  console.error('   Run smart_fix_buzz_links.js first');
  process.exit(1);
}

if (report.fixed.length === 0) {
  console.log('ℹ️  No fixes to apply');
  process.exit(0);
}

// Load index.html
let html;
try {
  html = fs.readFileSync('index.html', 'utf8');
  console.log(`✅ Loaded index.html (${html.length} chars)`);
} catch (err) {
  // Try parent directory
  try {
    html = fs.readFileSync('../index.html', 'utf8');
    console.log(`✅ Loaded ../index.html (${html.length} chars)`);
  } catch (err2) {
    console.error('❌ Could not find index.html');
    process.exit(1);
  }
}

// Backup
const indexPath = fs.existsSync('index.html') ? 'index.html' : '../index.html';
fs.writeFileSync(indexPath.replace('index.html', 'index.pre_smart_fix.html'), html);
console.log('📦 Backup saved');

// Apply fixes
let fixCount = 0;
for (const fix of report.fixed) {
  if (html.includes(fix.old_url)) {
    html = html.split(fix.old_url).join(fix.new_url);
    fixCount++;
    console.log(`  ✅ ${fix.name}: ${fix.old_url} → ${fix.new_url}`);
  }
}

fs.writeFileSync(indexPath, html);
console.log(`\n✅ Applied ${fixCount} fixes to ${indexPath}`);
