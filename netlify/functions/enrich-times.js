// Step 2: Enrich with performance optimization
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const startTime = Date.now();
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
        body: JSON.stringify({ 
          enrichedCandidates: candidates,
          performance: { distance_matrix_ms: 0, total_ms: Date.now() - startTime }
        })
      };
    }

    // PRE-RANK to reduce DM calls: Take top 40 by quality score
    const MAX_DM_CANDIDATES = 40;
    console.log('Pre-ranking candidates before DM...');
    
    // DETERMINISM: Sort by place_id first to ensure consistent order
    const sorted = [...candidates].sort((a, b) => a.place_id.localeCompare(b.place_id));
    
    const ranked = sorted.map(c => ({
      ...c,
      qualityScore: (c.googleRating || 0) * 1000 + Math.log10((c.googleReviewCount || 1) + 1) * 100
    })).sort((a, b) => {
      // Sort by quality score DESC, then place_id ASC for determinism
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return a.place_id.localeCompare(b.place_id);
    });
    
    const toEnrich = ranked.slice(0, MAX_DM_CANDIDATES);
    console.log(`Reduced from ${candidates.length} to ${toEnrich.length} for DM enrichment`);

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    console.log('Enriching', toEnrich.length, 'candidates with Distance Matrix');

    const dmStartTime = Date.now();
    const batchSize = 25;
    const enriched = [];

    const modeMap = {
      'walk': 'walking',
      'drive': 'driving',
      'transit': 'transit'
    };
    const apiMode = modeMap[transportMode] || 'walking';

    // Process batches in parallel
    const batches = [];
    for (let i = 0; i < toEnrich.length; i += batchSize) {
      batches.push(toEnrich.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches in parallel...`);
    
    const batchPromises = batches.map(async (batch) => {
      const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      const modeData = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json());

      return batch.map((place, idx) => {
        let walkMin = place.walkMinEstimate;
        let driveMin = place.driveMinEstimate;
        let transitMin = place.transitMinEstimate;
        let distMiles = place.distanceMiles;
        let walkSeconds = null;
        let driveSeconds = null;
        let transitSeconds = null;

        if (modeData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
          const realMin = Math.round(modeData.rows[0].elements[idx].duration.value / 60);
          const realSeconds = modeData.rows[0].elements[idx].duration.value;
          const realDist = Math.round((modeData.rows[0].elements[idx].distance.value / 1609.34) * 10) / 10;
          
          if (transportMode === 'walk') {
            walkMin = realMin;
            walkSeconds = realSeconds;
            distMiles = realDist;
          } else if (transportMode === 'drive') {
            driveMin = realMin;
            driveSeconds = realSeconds;
          } else if (transportMode === 'transit') {
            transitMin = realMin;
            transitSeconds = realSeconds;
          }
        }

        return {
          ...place,
          distanceMiles: distMiles,
          walkMinutes: walkMin,
          driveMinutes: driveMin,
          transitMinutes: transitMin,
          walkDurationSeconds: walkSeconds,
          driveDurationSeconds: driveSeconds,
          transitDurationSeconds: transitSeconds
        };
      });
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(batch => enriched.push(...batch));

    const dmTime = Date.now() - dmStartTime;
    const totalTime = Date.now() - startTime;

    console.log('=== PERFORMANCE ===');
    console.log('distance_matrix_ms:', dmTime);
    console.log('total_ms:', totalTime);
    console.log('candidates_enriched:', enriched.length);
    console.log('===================');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        enrichedCandidates: enriched,
        performance: {
          distance_matrix_ms: dmTime,
          total_ms: totalTime,
          candidates_before_dm: candidates.length,
          candidates_after_dm: enriched.length
        }
      })
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
