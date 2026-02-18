// Backend with Pagination + Multi-location search for broader coverage
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { location, radius, cuisine, openNow, broaderCoverage } = body;
    const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_API_KEY) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // Geocode
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurants: [], confirmedAddress: null }) };
    }

    const { lat, lng } = geocodeData.results[0].geometry.location;
    const confirmedAddress = geocodeData.results[0].formatted_address;

    // Helper function to fetch paginated results
    async function fetchPaginatedResults(searchLat, searchLng, maxPages = 3) {
      let placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${searchLat},${searchLng}&radius=${radius || 3000}&type=restaurant&key=${GOOGLE_API_KEY}`;
      if (cuisine) placesUrl += `&keyword=${encodeURIComponent(cuisine)}`;
      if (openNow) placesUrl += `&opennow=true`;

      const response = await fetch(placesUrl);
      const data = await response.json();
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      
      let allResults = data.results || [];
      let pageCount = 1;
      let nextPageToken = data.next_page_token;

      // Get additional pages
      while (nextPageToken && pageCount < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Required delay
        const pageResponse = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_API_KEY}`);
        const pageData = await pageResponse.json();
        
        if (pageData.results) allResults = allResults.concat(pageData.results);
        nextPageToken = pageData.next_page_token;
        pageCount++;
      }

      return allResults;
    }

    let allRestaurants = [];

    if (broaderCoverage) {
      // Multi-location search: center + N/S/E/W offsets
      const offsetDegrees = 0.02; // ~1.4 miles
      const searchLocations = [
        { lat, lng }, // Center
        { lat: lat + offsetDegrees, lng }, // North
        { lat: lat - offsetDegrees, lng }, // South
        { lat, lng: lng + offsetDegrees }, // East
        { lat, lng: lng - offsetDegrees }  // West
      ];

      const searchPromises = searchLocations.map(loc => fetchPaginatedResults(loc.lat, loc.lng, 2));
      const searchResults = await Promise.all(searchPromises);
      
      // Combine and dedupe by place_id
      const seenIds = new Set();
      searchResults.forEach(results => {
        results.forEach(place => {
          if (!seenIds.has(place.place_id)) {
            seenIds.add(place.place_id);
            allRestaurants.push(place);
          }
        });
      });

      // Cap at 250 candidates
      allRestaurants = allRestaurants.slice(0, 250);
    } else {
      // Standard search with 3 pages of pagination
      allRestaurants = await fetchPaginatedResults(lat, lng, 3);
    }

    // Calculate distances for first 30
    const first30 = allRestaurants.slice(0, 30);
    const origin = `${lat},${lng}`;

    const batch1 = first30.slice(0, 25);
    const batch2 = first30.slice(25, 30);

    const destinations1 = batch1.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
    const [walk1, drive1, transit1] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
      fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations1}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
    ]);

    let walk2, drive2, transit2;
    if (batch2.length > 0) {
      const destinations2 = batch2.map(p => `${p.geometry.location.lat},${p.geometry.location.lng}`).join('|');
      [walk2, drive2, transit2] = await Promise.all([
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=walking&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=driving&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json()),
        fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations2}&mode=transit&departure_time=now&key=${GOOGLE_API_KEY}`).then(r=>r.json())
      ]);
    }

    const enriched = allRestaurants.map((place, idx) => {
      let walkMin = null, driveMin = null, transitMin = null, distMiles = null;

      // Only first 30 have API distance data
      if (idx < 30) {
        const batchIdx = idx < 25 ? idx : idx - 25;
        const walkData = idx < 25 ? walk1 : walk2;
        const driveData = idx < 25 ? drive1 : drive2;
        const transitData = idx < 25 ? transit1 : transit2;

        if (walkData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
          walkMin = Math.round(walkData.rows[0].elements[batchIdx].duration.value / 60);
          distMiles = Math.round((walkData.rows[0].elements[batchIdx].distance.value / 1609.34) * 10) / 10;
        }
        if (driveData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
          driveMin = Math.round(driveData.rows[0].elements[batchIdx].duration.value / 60);
        }
        if (transitData?.rows?.[0]?.elements?.[batchIdx]?.status === 'OK') {
          transitMin = Math.round(transitData.rows[0].elements[batchIdx].duration.value / 60);
        }
      }

      // Calculate straight-line distance as fallback
      if (!distMiles) {
        const R = 3959;
        const dLat = (place.geometry.location.lat - lat) * Math.PI / 180;
        const dLon = (place.geometry.location.lng - lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat * Math.PI / 180) * Math.cos(place.geometry.location.lat * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        distMiles = Math.round(R * c * 10) / 10;
      }

      // Estimate walk time if not available
      if (!walkMin && distMiles) {
        walkMin = Math.round(distMiles * 20);
      }

      return {
        name: place.name,
        vicinity: place.vicinity,
        formatted_address: place.formatted_address,
        price_level: place.price_level,
        opening_hours: place.opening_hours,
        geometry: place.geometry,
        place_id: place.place_id,
        distanceMiles: distMiles,
        walkMinutes: walkMin,
        driveMinutes: driveMin,
        transitMinutes: transitMin,
        googleRating: place.rating || 0,
        googleReviewCount: place.user_ratings_total || 0
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurants: enriched, confirmedAddress })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed', message: error.message }) };
  }
};
