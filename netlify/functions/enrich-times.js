// Step 2: Enrich with performance optimization
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const startTime = Date.now();
    
    // ADAPTIVE DM BUDGET: Progressive enrichment based on filters
    const body = JSON.parse(event.body);
    const { candidates, userLocation, transportMode, targetMinResults = 20, cuisineFilter = null, walkTimeLimit = null } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    console.log('=== STEP 2: PROGRESSIVE ENRICHMENT ===');
    console.log('Received candidates:', candidates?.length);
    console.log('TransportMode:', transportMode);
    console.log('Cuisine filter:', cuisineFilter || 'none');
    console.log('Walk time limit:', walkTimeLimit || 'none');

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

    // ADAPTIVE DM BUDGET: Depends on filters
    let maxDmBudget = 50; // Default: no cuisine filter
    if (cuisineFilter) {
      maxDmBudget = 150; // Cuisine selected: allow more DM calls to ensure coverage
    }
    
    console.log(`DM Budget: ${maxDmBudget} destinations (cuisine filter: ${cuisineFilter ? 'yes' : 'no'})`);

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // DETERMINISTIC ORDERING: Sort by rating DESC, reviews DESC, place_id ASC
    console.log('Sorting candidates deterministically...');
    const sortedCandidates = [...candidates].sort((a, b) => {
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      return a.place_id.localeCompare(b.place_id);
    });

    console.log(`Progressive enrichment: Will enrich up to ${Math.min(sortedCandidates.length, maxDmBudget)} candidates in batches of 25`);

    const dmStartTime = Date.now();
    const batchSize = 25;
    const enriched = [];
    let withinWalkCount = 0;

    const modeMap = {
      'walk': 'walking',
      'drive': 'driving',
      'transit': 'transit'
    };
    const apiMode = modeMap[transportMode] || 'walking';

    // Progressive enrichment: Process batches with concurrency=2
    const candidatesToEnrich = sortedCandidates.slice(0, maxDmBudget);
    const batches = [];
    for (let i = 0; i < candidatesToEnrich.length; i += batchSize) {
      batches.push(candidatesToEnrich.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches with concurrency=2...`);
    
    // Process in waves of 2 concurrent batches
    for (let waveStart = 0; waveStart < batches.length; waveStart += 2) {
      const waveBatches = batches.slice(waveStart, waveStart + 2);
      const waveNum = Math.floor(waveStart / 2) + 1;
      console.log(`Wave ${waveNum}: Processing ${waveBatches.length} batches in parallel...`);
      
      const wavePromises = waveBatches.map(async (batch, relativeIdx) => {
        const batchIndex = waveStart + relativeIdx;
        console.log(`  Batch ${batchIndex + 1}/${batches.length}: ${batch.length} candidates`);
        
        const destinations = batch.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
        
        try {
          const modeData = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&key=${GOOGLE_API_KEY}`).then(r=>r.json());

          const batchEnriched = batch.map((place, idx) => {
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
              
              // Track how many are within walk limit
              if (walkTimeLimit && walkMin <= walkTimeLimit) {
                withinWalkCount++;
              }
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

        enriched.push(...batchEnriched);
        
        return batchEnriched;
      } catch (error) {
        console.error(`  Batch ${batchIndex + 1} failed:`, error);
        // STABILITY: Push batch with estimates only - never drop candidates
        const fallbackBatch = batch.map(place => ({
          ...place,
          distanceMiles: place.distanceMiles,
          walkMinutes: place.walkMinEstimate,
          driveMinutes: place.driveMinEstimate,
          transitMinutes: place.transitMinEstimate,
          walkDurationSeconds: null,
          driveDurationSeconds: null,
          transitDurationSeconds: null
        }));
        enriched.push(...fallbackBatch);
        console.log(`  Using estimates for batch ${batchIndex + 1}`);
        return fallbackBatch;
      }
    });

    await Promise.all(wavePromises);
    
    // Early stopping check after each wave
    if (walkTimeLimit && withinWalkCount >= targetMinResults) {
      console.log(`Early stop after wave ${waveNum}: Found ${withinWalkCount} within ${walkTimeLimit} min (target: ${targetMinResults})`);
      break;
    }
  }

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
