// Step 2: Enrich with performance optimization (Distance Matrix)
// Progressive enrichment + early stop + concurrency waves

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const startTime = Date.now();

    const body = JSON.parse(event.body || '{}');
    const {
      candidates,
      userLocation,
      transportMode,
      targetMinResults = 20,
      cuisineFilter = null,
      walkTimeLimit = null
    } = body;

    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    console.log('=== STEP 2: PROGRESSIVE ENRICHMENT ===');
    console.log('Received candidates:', candidates?.length);
    console.log('TransportMode:', transportMode);
    console.log('Cuisine filter:', cuisineFilter || 'none');
    console.log('Walk time limit:', walkTimeLimit || 'none');

    if (!GOOGLE_API_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'API key not configured (GOOGLE_PLACES_API_KEY)' })
      };
    }

    // Validation
    if (!candidates || !Array.isArray(candidates)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid candidates array', receivedType: typeof candidates })
      };
    }

    if (candidates.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrichedCandidates: [],
          performance: { distance_matrix_ms: 0, total_ms: Date.now() - startTime }
        })
      };
    }

    if (!userLocation || typeof userLocation.lat !== 'number' || typeof userLocation.lng !== 'number') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid userLocation', received: userLocation })
      };
    }

    // Skip DM for radius mode
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

    // Adaptive DM budget
    // Key change: in WALK mode, we want to enrich more + closest-first
    let maxDmBudget = 50;
    if (transportMode === 'walk') maxDmBudget = 120;
    if (cuisineFilter) maxDmBudget = 150;
    maxDmBudget = Math.min(maxDmBudget, candidates.length);

    console.log(`DM Budget: ${maxDmBudget} destinations`);

    const { lat, lng } = userLocation;
    const origin = `${lat},${lng}`;

    // Deterministic ordering:
    // Key change: when walking, prioritize closest first so we don’t waste DM calls on far “top rated” places.
    const sortedCandidates = [...candidates].sort((a, b) => {
      if (transportMode === 'walk') {
        const da = Number(a.distanceMiles ?? 999999);
        const db = Number(b.distanceMiles ?? 999999);
        if (da !== db) return da - db;
      }

      const ra = Number(a.googleRating || 0);
      const rb = Number(b.googleRating || 0);
      if (rb !== ra) return rb - ra;

      const rca = Number(a.googleReviewCount || 0);
      const rcb = Number(b.googleReviewCount || 0);
      if (rcb !== rca) return rcb - rca;

      return String(a.place_id || '').localeCompare(String(b.place_id || ''));
    });

    const modeMap = { walk: 'walking', drive: 'driving', transit: 'transit' };
    const apiMode = modeMap[transportMode] || 'walking';

    const dmStartTime = Date.now();
    const batchSize = 25;

    const candidatesToEnrich = sortedCandidates.slice(0, maxDmBudget);
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

      const wavePromises = waveBatches.map(async (batch, relativeIdx) => {
        const batchIndex = waveStart + relativeIdx;

        const destinations = batch
          .map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`)
          .join('|');

        try {
          const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&mode=${apiMode}&key=${GOOGLE_API_KEY}`;
          const modeData = await fetch(url).then(r => r.json());

          const batchEnriched = batch.map((place, idx) => {
            let walkMin = place.walkMinEstimate;
            let driveMin = place.driveMinEstimate;
            let transitMin = place.transitMinEstimate;
            let distMiles = place.distanceMiles;

            let walkSeconds = null;
            let driveSeconds = null;
            let transitSeconds = null;

            const el = modeData?.rows?.[0]?.elements?.[idx];
            if (el?.status === 'OK') {
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

        } catch (err) {
          console.error(`Batch ${batchIndex + 1} failed:`, err);

          // Never drop candidates — fallback to estimates
          const fallback = batch.map(place => ({
            ...place,
            distanceMiles: place.distanceMiles,
            walkMinutes: place.walkMinEstimate,
            driveMinutes: place.driveMinEstimate,
            transitMinutes: place.transitMinEstimate,
            walkDurationSeconds: null,
            driveDurationSeconds: null,
            transitDurationSeconds: null
          }));

          enriched.push(...fallback);
          return fallback;
        }
      });

      await Promise.all(wavePromises);

      if (walkTimeLimit && withinWalkCount >= targetMinResults) {
        console.log(`Early stop after wave ${waveNum}: Found ${withinWalkCount} within ${walkTimeLimit} min`);
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
      body: JSON.stringify({
        error: 'Failed',
        message: error.message,
        stack: error.stack
      })
    };
  }
};
