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
      // Handle both formats: info.tier OR info.availability_tier
      const tier = info.tier || info.availability_tier || 'unknown';
      
      // Handle both formats: info.windows (pre-processed) OR info.time_windows (raw)
      let windows = null;
      if (info.windows) {
        windows = info.windows;
      } else if (info.time_windows) {
        windows = {};
        for (const slot of ['early', 'prime', 'late']) {
          if (info.time_windows[slot]) {
            windows[slot] = windowTier(info.time_windows[slot].count || 0);
          }
        }
        if (Object.keys(windows).length === 0) windows = null;
      }

      slim[name] = { tier, windows };
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
