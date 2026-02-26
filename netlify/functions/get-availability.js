// Netlify function: get-availability.js
// Serves overall tier + per-window tiers
// Window thresholds: 0 = hard, 1-3 = medium, 4+ = easy
const fs = require('fs');
const path = require('path');

function windowTier(count) {
  if (count === 0) return 'hard';
  if (count <= 3) return 'medium';
  return 'easy';
}

exports.handler = async function(event, context) {
  try {
    const possiblePaths = [
      path.join(__dirname, 'availability_data.json'),
      path.resolve(__dirname, 'availability_data.json'),
      path.join(process.cwd(), 'netlify', 'functions', 'availability_data.json'),
      '/var/task/netlify/functions/availability_data.json',
      '/var/task/availability_data.json'
    ];

    let rawData = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        rawData = fs.readFileSync(p, 'utf8');
        break;
      }
    }

    if (!rawData) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({})
      };
    }

    const full = JSON.parse(rawData);
    const slim = {};

    for (const [name, info] of Object.entries(full)) {
      const tier = info.availability_tier || 'unknown';
      const tw = info.time_windows || {};
      const windows = {};

      for (const slot of ['early', 'prime', 'late']) {
        if (tw[slot]) {
          windows[slot] = windowTier(tw[slot].count || 0);
        }
      }

      slim[name] = {
        tier: tier,
        windows: Object.keys(windows).length > 0 ? windows : null
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(slim)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
