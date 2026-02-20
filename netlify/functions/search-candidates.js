function filterRestaurantsByTier(candidates) {
  const elite = [];
  const moreOptions = [];
  const excluded = [];

  candidates.forEach(place => {
    try {
      const reviewsRaw = place.user_ratings_total ?? place.googleReviewCount ?? 0;
      const ratingRaw = place.googleRating ?? place.rating ?? 0;

      const reviews = Number(reviewsRaw) || 0;
      const rating = Number(ratingRaw) || 0;

      // Fake 5.0 prevention
      if (rating >= 4.9 && reviews < 50) {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: '',
          reason: `fake_5.0_prevention (${rating}⭐ with only ${reviews} reviews)`
        });
        return;
      }

      // IMPORTANT: Use 4.5+ so your “4.6+” bucket actually returns a lot more
      if (rating >= 4.5) elite.push(place);
      else if (rating >= 4.4) moreOptions.push(place);
      else {
        excluded.push({
          place_id: place.place_id,
          name: place.name,
          rating,
          reviews,
          types: '',
          reason: 'rating_below_4.4'
        });
      }
    } catch (err) {
      excluded.push({
        place_id: place?.place_id,
        name: place?.name,
        rating: 0,
        reviews: 0,
        types: '',
        reason: `filter_error: ${err.message}`
      });
    }
  });

  console.log('SIMPLIFIED FILTER RESULTS:');
  console.log(`  Elite (4.5+): ${elite.length}`);
  console.log(`  More Options (4.4+): ${moreOptions.length}`);
  console.log(`  Excluded: ${excluded.length}`);

  return { elite, moreOptions, excluded };
}
