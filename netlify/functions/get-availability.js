// Netlify function: get-availability.js
const fs = require('fs');
const path = require('path');

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
    const result = {};

    for (const [name, info] of Object.entries(full)) {
      if (!info) continue;

      // Handle both data formats:
      // Format A (pre-processed): { tier: 'available', windows: { early: 'easy', ... } }
      // Format B (raw):           { availability_tier: 'available', time_windows: { early: { count: 5 }, ... } }

      let tier = info.tier || info.availability_tier || 'unknown';
      let windows = null;

      if (info.windows) {
        // Format A — already processed, use directly
        windows = info.windows;
      } else if (info.time_windows) {
        // Format B — need to convert counts to tiers
        windows = {};
        for (const slot of ['early', 'prime', 'late']) {
          if (info.time_windows[slot] != null) {
            const count = info.time_windows[slot].count != null
              ? info.time_windows[slot].count
              : info.time_windows[slot];
            if (count === 0) windows[slot] = 'hard';
            else if (count <= 3) windows[slot] = 'medium';
            else windows[slot] = 'easy';
          }
        }
        if (Object.keys(windows).length === 0) windows = null;
      }

      result[name] = { tier, windows };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(result)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
