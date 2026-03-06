// Netlify function: get-outlook.js
const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  try {
    const possiblePaths = [
      path.join(__dirname, 'outlook_data.json'),                              // same folder as function (most reliable)
      path.join(process.cwd(), 'netlify', 'functions', 'outlook_data.json'), // repo root/netlify/functions/
      path.join(process.cwd(), 'outlook_data.json'),                         // repo root
      '/var/task/netlify/functions/outlook_data.json',
      '/var/task/outlook_data.json'
    ];

    let rawData = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        rawData = fs.readFileSync(p, 'utf8');
        console.log('outlook_data.json found at:', p);
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: rawData
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
