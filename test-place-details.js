/**
 * test-place-details.js
 * Quick test to see what Google Place Details returns
 * RUN: node test-place-details.js
 */

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';

async function test() {
  // Test with a known restaurant place_id (Nobu Downtown)
  const testIds = [
    { name: 'Nobu Downtown', id: 'ChIJZc-EthlawokRIRUvwpkpltI' },
  ];

  // First, find a place_id if we don't have one
  const findResp = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=Peter+Luger+Steakhouse+NYC&inputtype=textquery&fields=place_id,name,types&key=${API_KEY}`);
  const findData = await findResp.json();
  console.log('=== FIND PLACE (Peter Luger) ===');
  console.log(JSON.stringify(findData, null, 2));

  if (findData.candidates?.[0]?.place_id) {
    testIds.push({ name: 'Peter Luger', id: findData.candidates[0].place_id });
  }

  for (const test of testIds) {
    console.log(`\n=== PLACE DETAILS: ${test.name} ===`);
    
    // Try with many fields
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${test.id}&fields=name,types,website,url,editorial_summary&key=${API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    console.log(JSON.stringify(data, null, 2));
  }

  // Also try the new Places API (v1)
  console.log('\n=== NEW PLACES API (v1) - Peter Luger ===');
  const newResp = await fetch(`https://places.googleapis.com/v1/places/${testIds[0].id}?fields=displayName,types,websiteUri,primaryType,primaryTypeDisplayName`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'displayName,types,websiteUri,primaryType,primaryTypeDisplayName'
    }
  });
  const newData = await newResp.json();
  console.log(JSON.stringify(newData, null, 2));
}

test().catch(console.error);
