// Deterministic 1-mile grid coverage with full pagination
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, cuisine, openNow } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    console.log('=== DETERMINISTIC 1-MILE GRID SEARCH ===');

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidates: [], confirmedAddress: null }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Normalize coordinates to 4 decimal places (~11 meters precision)
    // This ensures same location = same grid, even with GPS drift
    const normalizedLat = Math.round(lat * 10000) / 10000;
    const normalizedLng = Math.round(lng * 10000) / 10000;
    
    console.log('=== COORDINATE DEBUG ===');
    console.log('1) RAW ORIGIN:', { lat, lng });
    console.log('2) NORMALIZED ORIGIN:', { lat: normalizedLat, lng: normalizedLng });
    console.log('Address:', confirmedAddress);
    console.log('========================');

    // Use normalized coords for grid generation
    const gridLat = normalizedLat;
    const gridLng = normalizedLng;

    // Generate fixed 7-point grid within 1 mile (hexagonal pattern + center)
    // 1 mile = 1609 meters, we use 600m radius per node
    const gridRadius = 600; // meters per search node
    const offsetMiles = 0.5; // half mile offset for grid points
    const offsetDegrees = offsetMiles / 69;
    
    const gridPoints = [
      { lat: gridLat, lng: gridLng, label: 'Center' },
      { lat: gridLat + offsetDegrees, lng: gridLng, label: 'North' },
      { lat: gridLat - offsetDegrees, lng: gridLng, label: 'South' },
      { lat: gridLat, lng: gridLng + offsetDegrees, label: 'East' },
      { lat: gridLat, lng: gridLng - offsetDegrees, label: 'West' },
      { lat: gridLat + (offsetDegrees * 0.5), lng: gridLng + (offsetDegrees * 0.866), label: 'NE' },
      { lat: gridLat - (offsetDegrees * 0.5), lng: gridLng - (offsetDegrees * 0.866), label: 'SW' }
    ];

    console.log('Grid: 7 fixed points, 600m radius per node');

    // Fetch with FULL pagination and retry logic
    async function fetchWithFullPagination(searchLat, searchLng, label) {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${gridRadius}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) url += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) url += `&opennow=true`;

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`${label}: API error ${data.status}`);
        return [];
      }
      
      let allResults = data.results || [];
      let nextPageToken = data.next_page_token;
      let pageCount = 1;

      // Paginate until no more pages
      while (nextPageToken) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Required delay
        
        let retries = 0;
        let pageData = null;
        
        // Retry logic for INVALID_REQUEST
        while (retries < 5) {
          const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`;
          const pageResponse = await fetch(pageUrl);
          pageData = await pageResponse.json();
          
          if (pageData.status === 'INVALID_REQUEST') {
            retries++;
            console.log(`${label}: INVALID_REQUEST retry ${retries}/5`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          break;
        }
        
        if (pageData && pageData.results) {
          allResults = allResults.concat(pageData.results);
          pageCount++;
        }
        
        nextPageToken = pageData?.next_page_token;
        
        // Safety: max 3 pages per node
        if (pageCount >= 3) break;
      }

      console.log(`${label}: ${allResults.length} results (${pageCount} pages)`);
      return allResults;
    }

    // Fetch from all grid points in parallel
    const gridFetches = gridPoints.map(point => 
      fetchWithFullPagination(point.lat, point.lng, point.label)
    );
    const gridResults = await Promise.all(gridFetches);

    // Merge and dedupe by place_id ONLY
    const seenIds = new Set();
    const allCandidates = [];
    let totalRaw = 0;

    gridResults.forEach(results => {
      totalRaw += results.length;
      results.forEach(place => {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allCandidates.push(place);
        }
      });
    });

    console.log('Total raw results:', totalRaw);
    console.log('3) UNIQUE PLACES (after dedupe, BEFORE filters):', allCandidates.length);
    
    // Log first 10 place_ids for comparison
    console.log('Sample place_ids:', allCandidates.slice(0, 10).map(p => p.place_id).join(', '));

    // Calculate straight-line distance for sorting (using normalized origin)
    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959; // miles
      const dLat = (place.geometry.location.lat - gridLat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - gridLng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(gridLat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distMiles = R * c;

      return {
        place_id: place.place_id,
        name: place.name,
        vicinity: place.vicinity,
        formatted_address: place.formatted_address,
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0,
        distanceMiles: Math.round(distMiles * 10) / 10,
        walkMinEstimate: Math.round(distMiles * 20),
        driveMinEstimate: Math.round(distMiles * 4),
        transitMinEstimate: Math.round(distMiles * 6)
      };
    });

    // Filter: within 1 mile
    const within1Mile = candidatesWithDistance.filter(r => r.distanceMiles <= 1.0);
    console.log('Within 1 mile:', within1Mile.length);
    
    // Count by rating BEFORE sorting
    const rating46Plus = within1Mile.filter(r => r.googleRating >= 4.6).length;
    const rating44Plus = within1Mile.filter(r => r.googleRating >= 4.4).length;
    console.log('4) AFTER rating >= 4.6 filter:', rating46Plus);
    console.log('   After rating >= 4.4 filter:', rating44Plus);

    // Deterministic sort: rating DESC, reviews DESC, distance ASC, name ASC
    within1Mile.sort((a, b) => {
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
      return a.name.localeCompare(b.name);
    });

    console.log('Returning', within1Mile.length, 'restaurants (deterministic sort)');
    console.log('5) ALL PLACE_IDs (within 1 mile):', within1Mile.map(r => r.place_id).join(','));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: within1Mile,
        confirmedAddress,
        userLocation: { lat: gridLat, lng: gridLng }, // Use normalized coords
        totalCandidates: within1Mile.length,
        stats: {
          totalRaw,
          uniquePlaceIds: allCandidates.length,
          within1Mile: within1Mile.length,
          normalizedCoords: { lat: gridLat, lng: gridLng },
          rawCoords: { lat, lng }
        }
      })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message, stack: error.stack }) };
  }
};
