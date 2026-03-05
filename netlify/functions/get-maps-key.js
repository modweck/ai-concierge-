// Netlify function: get-maps-key
// Returns the Google API key so the frontend can load Maps autocomplete
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: process.env.GOOGLE_PLACES_API_KEY || '' })
  };
};
