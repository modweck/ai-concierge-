// Netlify function: get-availability.js (DEBUG VERSION)
const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  const debug = {
    __dirname: __dirname,
    cwd: process.cwd(),
    dirFiles: [],
    triedPaths: [],
    foundAt: null
  };

  try {
    // List files in __dirname
    try {
      debug.dirFiles = fs.readdirSync(__dirname).slice(0, 30);
    } catch(e) {
      debug.dirFiles = ['ERROR reading dir: ' + e.message];
    }

    // Try multiple possible paths
    const possiblePaths = [
      path.join(__dirname, 'availability_data.json'),
      path.resolve(__dirname, 'availability_data.json'),
      path.join(process.cwd(), 'netlify', 'functions', 'availability_data.json'),
      '/var/task/netlify/functions/availability_data.json',
      '/var/task/availability_data.json'
    ];

    let rawData = null;

    for (const p of possiblePaths) {
      debug.triedPaths.push(p);
      if (fs.existsSync(p)) {
        debug.foundAt = p;
        rawData = fs.readFileSync(p, 'utf8');
        break;
      }
    }

    if (!rawData) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ debug })
      };
    }

    const full = JSON.parse(rawData);
    const slim = {};
    for (const [name, info] of Object.entries(full)) {
      slim[name] = {
        tier: info.availability_tier || 'unknown',
        slots: info.available_slots || 0,
        primeSlots: info.prime_time_slots || 0
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify(slim)
    };
  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ debug, error: e.message })
    };
  }
};
