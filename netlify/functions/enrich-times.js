// Step 2: Enrich with SINGLE transport mode only (not all 3)
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { candidates, userLocation, transportMode } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    console.log('=== STEP 2: ENRICH TIMES ===');
    console.log('Received candidates:', candidates?.length);
    console.log('Mode:', transportMode);
    console.log('UserLocation:', userLocation);

    if (!candidates || !Array.isArray(candidates)) {
      throw new Error('Invalid candidates array');
    }

    if (!userLocation || !userLocation.lat || !userLocation.lng) {
      throw new Error('Invalid userLocation');
    }

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // Sort by distance and take closest 80
    const sorted = [...candidates].sort((a, b) => a.distanceMiles - b.distanceMiles);
    const shortlist = sorted.slice(0, 80);
    
    console.log('Enriching', shortlist.length, 'candidates');

    const batchSize = 25;
    const enriched = [];

    // Only fetch the selected transport mode (saves 66% API calls!)
    const modeMap = {
      'walk': 'walking',
      'drive': 'driving',
      'transit': 'transit'
    };
    const apiMode = modeMap[transportMode] || 'walking';

    for (let i = 0; i < shortlist.length; i += batchSize) {
      const batch = shortlist.slice(i, i + batchSize);
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      
      // Single API call instead of 3!
      const modeData = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json());

      batch.forEach((place, idx) => {
        let walkMin = place.walkMinEstimate;
        let driveMin = place.driveMinEstimate;
        let transitMin = place.transitMinEstimate;
        let distMiles = place.distanceMiles;

        // Update the selected mode with real data
        if (modeData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          const realMin = Math.round(modeData.rows[0].elements[idx].duration.value / 60);
          const realDist = Math.round((modeData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
          
          if (transportMode === 'walk') {
            walkMin = realMin;
            distMiles = realDist;
          } else if (transportMode === 'drive') {
            driveMin = realMin;
          } else if (transportMode === 'transit') {
            transitMin = realMin;
          }
        }

        enriched.push({
          ...place,
          distanceMiles,
          walkMinutes: walkMin,
          driveMinutes: driveMin,
          transitMinutes: transitMin
        });
      });
    }

    console.log('Enriched', enriched.length);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrichedCandidates: enriched })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
