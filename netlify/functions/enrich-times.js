// Step 2: Enrich with real Distance Matrix times
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { candidates, userLocation, maxCandidates } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    console.log('=== STEP 2: ENRICH TIMES START ===');
    console.log('Enriching', candidates.length, 'candidates');

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // Sort by distance and take closest N
    const sorted = [...candidates].sort((a, b) => a.distanceMiles - b.distanceMiles);
    const shortlist = sorted.slice(0, maxCandidates || 100);
    
    console.log('Processing', shortlist.length, 'closest candidates');

    const batchSize = 25;
    const enriched = [];

    for (let i = 0; i < shortlist.length; i += batchSize) {
      const batch = shortlist.slice(i, i + batchSize);
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      
      const [walkData, driveData, transitData] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
      ]);

      batch.forEach((place, idx) => {
        let walkMin = place.walkMinEstimate;
        let driveMin = place.driveMinEstimate;
        let transitMin = place.transitMinEstimate;
        let distMiles = place.distanceMiles;

        // Override with real data if available
        if (walkData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          walkMin = Math.round(walkData.rows[0].elements[idx].duration.value / 60);
          distMiles = Math.round((walkData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
        }
        if (driveData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          driveMin = Math.round(driveData.rows[0].elements[idx].duration.value / 60);
        }
        if (transitData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          transitMin = Math.round(transitData.rows[0].elements[idx].duration.value / 60);
        }

        enriched.push({
          ...place,
          distanceMiles: distMiles,
          walkMinutes: walkMin,
          driveMinutes: driveMin,
          transitMinutes: transitMin,
          needsEnrichment: false
        });
      });
    }

    console.log('Enriched', enriched.length, 'restaurants');
    console.log('=== STEP 2 COMPLETE ===');

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
