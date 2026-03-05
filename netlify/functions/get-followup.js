const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const p = path.join(__dirname, 'ot_followup_results.json');
    const raw = fs.readFileSync(p, 'utf8');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
      body: raw,
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
