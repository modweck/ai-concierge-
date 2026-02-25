// Netlify function: get-availability.js
// Serves the availability_data.json file to the frontend
const fs = require('fs');
const path = require('path');

exports.handler = async function(event, context) {
  try {
    const dataPath = path.join(__dirname, 'availability_data.json');
    
    if (!fs.existsSync(dataPath)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: '{}'
      };
    }

    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    // Transform: { "Restaurant Name": { tier, total_slots, prime_slots, ... } }
    // Frontend just needs: { "Restaurant Name": { tier, slots, primeSlots } }
    const slim = {};
    for (const [name, data] of Object.entries(raw)) {
      if (data.tier) {
        slim[name] = {
          tier: data.tier,
          slots: data.total_slots || 0,
          primeSlots: data.prime_slots || 0
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300' // cache 5 min
      },
      body: JSON.stringify(slim)
    };
  } catch(e) {
    console.error('Error loading availability:', e);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: '{}'
    };
  }
};
