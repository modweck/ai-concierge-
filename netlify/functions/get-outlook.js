// Netlify function: get-outlook.js
const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  try {
    const possiblePaths = [
      path.join(__dirname, 'outlook_data.json'),
      path.resolve(__dirname, 'outlook_data.json'),
      path.join(process.cwd(), 'netlify', 'functions', 'outlook_data.json'),
      '/var/task/netlify/functions/outlook_data.json',
      '/var/task/outlook_data.json'
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
