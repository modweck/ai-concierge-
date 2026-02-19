// enrich-times.js (Netlify Function)
// Step 2: Enrich times via Distance Matrix
// SPECIAL: true 4.6+ walk mode => enrich ALL candidates (no budget cap)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const startTime = Date.now();

    const body = JSON.parse(event.body || '{}');
    const {
      candidates,
      userLocation,
      transportMode,
      qualityMode,              // NEW
      targetMinResults = 20,
      cuisineFilter = null,
      walkTimeLimit = null
    } = body;

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    console.log('=== STEP 2: ENRICH TIMES ===');
    console.log('Received candidates:', Array.isArray(candidates) ? candidates.length : 'INVALID');
    console.log('TransportMode:', transportMode);
    console.log('QualityMode:', qualityMode || 'none');
    console.log('Cuisine filter:', cuisineFilter || 'none');
    console.log('Walk time limit:', walkTimeLimit || 'none');

    if (!Array.isArray(candidates)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid candidates array' }) };
    }
    if (candidates.length === 0) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrichedCandidates: [], performance: { distance_matrix_ms: 0, total_ms: Date.now() - startTime } }) };
    }
    if (!userLocation || typeof userLocation.lat !== 'number' || typeof userLocation.lng !== 'number') {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid userLocation' }) };
    }
    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

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

    const isTrueEliteWalkMode = (transportMode === 'walk' && qualityMode === 'five_star');

    // DM budget rules
    let maxDmBudget = 50; // default cap
    if (cuisineFilter) maxDmBudget = 150;

    // SPECIAL: enrich everything for true elite walk
    if (isTrueEliteWalkMode) {
      maxDmBudget = candidates.length;
    }

    console.log(`DM Budget: ${maxDmBudget} destinations (trueEliteWalk=${isTrueEliteWalkMode})`);

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // Deterministic ordering
    const sortedCandidates = [...candidates].sort((a, b) => {
      if ((b.googleRating || 0) !== (a.googleRating || 0)) return (b.googleRating || 0) - (a.googleRating || 0);
      if ((b.googleReviewCount || 0) !== (a.googleReviewCount || 0)) return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
      return (a.place_id || '').localeCompare(b.place_id || '');
    });

    const candidatesToEnrich = sortedCandidates.slice(0, maxDmBudget);

    const modeMap = { walk: 'walking', drive: 'driving', transit: 'transit' };
    const apiMode = modeMap[transportMode] || 'walking';

    const dmStartTime = Date.now();
    const batchSize = 25;

    const batches = [];
    for (let i = 0; i < candidatesToEnrich.length; i += batchSize) {
      batches.push(candidatesToEnrich.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches with concurrency=2...`);

    const enriched = [];
    let withinWalkCount = 0;

    for (let waveStart = 0; waveStart < batches.length; waveStart += 2) {
      const waveBatches = batches.slice(waveStart, waveStart + 2);
      const waveNum = Math.floor(waveStart / 2) + 1;

      const wavePromises = waveBatches.map(async (batch, relIdx) => {
        const batchIndex = waveStart + relIdx;
        console.log(`Wave ${waveNum} - Batch ${batchIndex + 1}/${batches.length}: ${batch.length} candidates`);

        const destinations = batch
          .map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`)
          .join('|');

        try {
          const modeData = await fetch(
            `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&key=${GOOGLE_API_KEY}`
          ).then(r => r.json());

          const batchEnriched = batch.map((place, idx) => {
            let walkMin = place.walkMinEstimate;
            let driveMin = place.driveMinEstimate;
            let transitMin = place.transitMinEstimate;

            let distMiles = place.distanceMiles;

            let walkSeconds = null;
            let driveSeconds = null;
            let transitSeconds = null;

            if (modeData?.rows?.[0]?.elements?.[idx]?.status === 'OK') {
              const el = modeData.rows[0].elements[idx];
              const realMin = Math.round(el.duration.value / 60);
              const realSeconds = el.duration.value;
              const realDist = Math.round((el.distance.value / 1609.34) * 10) / 10;

              if (transportMode === 'walk') {
                walkMin = realMin;
                walkSeconds = realSeconds;
                distMiles = realDist;
                if (walkTimeLimit && walkMin <= walkTimeLimit) withinWalkCount++;
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
          console.error(`Batch ${batchIndex + 1} failed:`, error);

          // fallback to estimates
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
          return fallbackBatch;
        }
      });

      await Promise.all(wavePromises);

      // Early stopping ONLY for non-true mode (true mode must enrich all)
      if (!isTrueEliteWalkMode && walkTimeLimit && withinWalkCount >= targetMinResults) {
        console.log(`Early stop after wave ${waveNum}: withinWalk=${withinWalkCount} target=${targetMinResults}`);
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
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed', message: error.message, stack: error.stack })
    };
  }
};
