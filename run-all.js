const { execSync } = require('child_process');
const run = (cmd, label) => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 STEP: ' + label);
  console.log('='.repeat(60) + '\n');
  try { execSync(cmd, { stdio: 'inherit', cwd: __dirname }); }
  catch(e) { console.log('⚠️ ' + label + ' had errors, continuing...\n'); }
};
console.log('\n🏁 MASTER RUN - All batches\n');
const start = Date.now();
run('node google-grid-search.js', 'Google Grid Search (37 zones, 4.4+ rated)');
run('node -e "const fs=require(\'fs\'); const f=\'google_restaurants_expanded.json\'; if(fs.existsSync(f)){fs.copyFileSync(f,\'google_restaurants.json\');console.log(\'Copied expanded -> google_restaurants.json\');}"', 'Update google_restaurants.json');
run('node find-booking-links.js', 'Find Resy links for new restaurants');
run('node opentable-puppeteer-v3.js --search', 'OpenTable search for new restaurants');
run('node netlify/functions/availability-checker.js --full', 'Resy availability check');
run('node opentable-puppeteer-v3.js --availability', 'OpenTable availability check');
run('git add -A && git commit -m "Auto-update: new restaurants + availability data" && git push', 'Git commit and push');
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log('\n' + '='.repeat(60));
console.log('🏁 ALL DONE in ' + mins + ' minutes');
console.log('='.repeat(60) + '\n');
