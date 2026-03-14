// Netlify function: get-availability.js
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
      path.join(__dirname, 'AVAILABILITY_MASTER.json'),
      path.join(process.cwd(), 'netlify', 'functions', 'AVAILABILITY_MASTER.json'),
      '/var/task/netlify/functions/AVAILABILITY_MASTER.json',
      '/var/task/AVAILABILITY_MASTER.json'
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
      // Support both old format (availability_tier) and new format (slots.tier / top-level tier)
      const tier = info.tier || info.slots?.tier || info.availability_tier || 'unknown';

      // Build time windows from slots
      const slots = info.slots || {};
      const windows = {};
      if (slots.early_slots !== undefined) windows.early = windowTier(slots.early_slots || 0);
      if (slots.prime_slots !== undefined) windows.prime = windowTier(slots.prime_slots || 0);
      if (slots.late_slots  !== undefined) windows.late  = windowTier(slots.late_slots  || 0);

      // Also support old time_windows format
      if (!Object.keys(windows).length && info.time_windows) {
        for (const slot of ['early', 'prime', 'late']) {
          if (info.time_windows[slot]) {
            windows[slot] = windowTier(info.time_windows[slot].count || 0);
          }
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
