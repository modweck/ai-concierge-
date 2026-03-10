const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const p = path.join(__dirname, 'outlook_data.json');
    const raw = fs.readFileSync(p, 'utf8');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: raw
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    };
  }
};
