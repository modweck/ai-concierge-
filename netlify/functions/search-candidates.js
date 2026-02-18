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

    // Generate fixed 7-point grid within 1 mile (hexagonal pattern + center)
    // 1 mile = 1609 meters, we use 600m radius per node
    const gridRadius = 600; // meters per search node
    const offsetMiles = 0.5; // half mile offset for grid points
    const offsetDegrees = offsetMiles / 69;
    
    const gridPoints = [
      { lat, lng, label: 'Center' },
      { lat: lat + offsetDegrees, lng, label: 'North' },
      { lat: lat - offsetDegrees, lng, label: 'South' },
      { lat, lng: lng + offsetDegrees, label: 'East' },
      { lat, lng: lng - offsetDegrees, label: 'West' },
      { lat: lat + (offsetDegrees * 0.5), lng: lng + (offsetDegrees * 0.866), label: 'NE' },
      { lat: lat - (offsetDegrees * 0.5), lng: lng - (offsetDegrees * 0.866), label: 'SW' }
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
    console.log('Unique place_ids:', allCandidates.length);

    // Calculate straight-line distance for sorting
    const candidatesWithDistance = allCandidates.map(place => {
      const R = 3959; // miles
      const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
      const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
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

    // Deterministic sort: rating DESC, reviews DESC, distance ASC, name ASC
    within1Mile.sort((a, b) => {
      if (b.googleRating !== a.googleRating) return b.googleRating - a.googleRating;
      if (b.googleReviewCount !== a.googleReviewCount) return b.googleReviewCount - a.googleReviewCount;
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
      return a.name.localeCompare(b.name);
    });

    console.log('Returning', within1Mile.length, 'restaurants (deterministic sort)');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: within1Mile,
        confirmedAddress,
        userLocation: { lat, lng },
        totalCandidates: within1Mile.length,
        stats: {
          totalRaw,
          uniquePlaceIds: allCandidates.length,
          within1Mile: within1Mile.length
        }
      })
    };

  } catch (error) {
    console.error('ERROR:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message, stack: error.stack }) };
  }
};
