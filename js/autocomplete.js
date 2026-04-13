// ─── GOOGLE PLACES AUTOCOMPLETE ─────────────────────────────────────────────

async function initAC() {
  try {
    const d = await (await fetch('/.netlify/functions/get-maps-key')).json();
    if (!d.key) return;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${d.key}&libraries=places&callback=setupAC`;
    s.async = true;
    document.head.appendChild(s);
  } catch(e) {}
}

function setupAC() {
  const nycBounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(40.477, -74.259),
    new google.maps.LatLng(40.918, -73.700)
  );

  ['addressInput', 'arAddrInput', 'barAddrInput', 'homeAddrInput'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    const ac = new google.maps.places.Autocomplete(input, {
      bounds: nycBounds,
      strictBounds: false,
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'name', 'geometry']
    });
    ac.addListener('place_changed', () => {
      const p = ac.getPlace();
      if (p?.formatted_address) input.value = p.formatted_address;
      else if (p?.name) input.value = p.name;
    });
  });
}

initAC();
