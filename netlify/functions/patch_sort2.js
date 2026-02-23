const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let changes = 0;

// Fix 1: Show Google rating for Michelin restaurants too
const oldRating = `const ratingHtml = r.michelin
    ? ''
    : (r.googleRating`;
const newRating = `const ratingHtml = (r.googleRating`;

if (html.includes(oldRating)) {
  html = html.replace(oldRating, newRating);
  changes++;
  console.log('Fixed: Show Google rating for Michelin/Bib');
} else {
  console.log('Rating display pattern not found');
}

// Fix 2: Rating sort — same rating? Michelin wins, then review count
const oldSort = `if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
      });`;
const newSort = `if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        const ma = michelinRank(a), mb = michelinRank(b);
        if (ma !== mb) return mb - ma;
        return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
      });`;

if (html.includes(oldSort)) {
  html = html.replace(oldSort, newSort);
  changes++;
  console.log('Fixed: Michelin as tiebreaker in rating sort');
} else {
  console.log('Rating sort pattern not found');
}

// Fix 3: Distance sort — same distance+rating? Michelin wins
const oldDist = `} else if (sortBy === 'distance') {
      sorted.sort((a, b) => {
        const da = a.distanceMiles ?? 999999;
        const db = b.distanceMiles ?? 999999;
        if (da !== db) return da - db;
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        if ((b.googleReviewCount || 0) !== (a.googleReviewCount || 0)) return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);`;
const newDist = `} else if (sortBy === 'distance') {
      sorted.sort((a, b) => {
        const da = a.distanceMiles ?? 999999;
        const db = b.distanceMiles ?? 999999;
        if (da !== db) return da - db;
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        const ma = michelinRank(a), mb = michelinRank(b);
        if (ma !== mb) return mb - ma;
        if ((b.googleReviewCount || 0) !== (a.googleReviewCount || 0)) return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);`;

if (html.includes(oldDist)) {
  html = html.replace(oldDist, newDist);
  changes++;
  console.log('Fixed: Michelin as tiebreaker in distance sort');
} else {
  console.log('Distance sort pattern not found');
}

// Fix 4: Price sort — same price+rating? Michelin wins
const oldPrice = `priced.sort((a, b) => {
      if (a.price_level !== b.price_level) return a.price_level - b.price_level;
      const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
      if (ra !== rb) return rb - ra;
      return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
    });`;
const newPrice = `priced.sort((a, b) => {
      if (a.price_level !== b.price_level) return a.price_level - b.price_level;
      const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
      if (ra !== rb) return rb - ra;
      const ma = michelinRank(a), mb = michelinRank(b);
      if (ma !== mb) return mb - ma;
      return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
    });`;

if (html.includes(oldPrice)) {
  html = html.replace(oldPrice, newPrice);
  changes++;
  console.log('Fixed: Michelin as tiebreaker in price sort');
} else {
  console.log('Price sort pattern not found');
}

fs.writeFileSync('index.html', html);
console.log('\n' + changes + ' changes applied');
console.log('Next: git add index.html && git commit -m "Show ratings for Michelin, use as tiebreaker" && git push');
