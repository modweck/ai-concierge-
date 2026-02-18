// Step 2: Enrich with debug error handling
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
    console.log('TransportMode:', transportMode);

    // Validation
    if (!candidates || !Array.isArray(candidates)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid candidates array', receivedType: typeof candidates }) };
    }

    if (candidates.length === 0) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Empty candidates array' }) };
    }

    if (!userLocation || !userLocation.lat || !userLocation.lng) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid userLocation', received: userLocation }) };
    }

    // Skip Distance Matrix for radius mode
    if (transportMode === 'radius') {
      console.log('Radius mode - returning estimates only');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrichedCandidates: candidates })
      };
    }

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // Sort and take closest 80
    const sorted = [...candidates].sort((a, b) => a.distanceMiles - b.distanceMiles);
    const shortlist = sorted.slice(0, 80);
    
    console.log('Enriching', shortlist.length, 'candidates');

    const batchSize = 25;
    const enriched = [];

    const modeMap = {
      'walk': 'walking',
      'drive': 'driving',
      'transit': 'transit'
    };
    const apiMode = modeMap[transportMode] || 'walking';

    for (let i = 0; i < shortlist.length; i += batchSize) {
      const batch = shortlist.slice(i, i + batchSize);
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      
      const modeData = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json());

      batch.forEach((place, idx) => {
        let walkMin = place.walkMinEstimate;
        let driveMin = place.driveMinEstimate;
        let transitMin = place.transitMinEstimate;
        let distMiles = place.distanceMiles;

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
          distanceMiles: distMiles,
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
    // Return full error details for debugging
    return { 
      statusCode: 500, 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        error: 'Failed', 
        message: error.message, 
        stack: error.stack 
      }) 
    };
  }
};
