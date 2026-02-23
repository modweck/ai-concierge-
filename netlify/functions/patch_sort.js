#!/usr/bin/env node
/**
 * Patches index.html sorting to remove michelinRank priority
 * Sort by: googleRating first, then googleReviewCount as tiebreaker
 * Run from project root: node patch_sort.js
 */
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let changes = 0;

// 1. Fix RATING sort
const oldRating = `if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const ma = michelinRank(a), mb = michelinRank(b);
        if (ma !== mb) return mb - ma;
        return (b.googleRating || 0) - (a.googleRating || 0);
      });`;

const newRating = `if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
      });`;

if (html.includes(oldRating)) {
  html = html.replace(oldRating, newRating);
  changes++;
  console.log('✅ Fixed rating sort');
} else {
  console.log('⚠️ Rating sort pattern not found — may already be patched');
}

// 2. Fix DISTANCE sort
const oldDistance = `} else if (sortBy === 'distance') {
      sorted.sort((a, b) => {
        const da = a.distanceMiles ?? 999999;
        const db = b.distanceMiles ?? 999999;
        if (da !== db) return da - db;
        const ma = michelinRank(a), mb = michelinRank(b);
        if (ma !== mb) return mb - ma;
        if ((b.googleRating || 0) !== (a.googleRating || 0)) return (b.googleRating || 0) - (a.googleRating || 0);
        return String(a.name || '').localeCompare(String(b.name || ''));`;

const newDistance = `} else if (sortBy === 'distance') {
      sorted.sort((a, b) => {
        const da = a.distanceMiles ?? 999999;
        const db = b.distanceMiles ?? 999999;
        if (da !== db) return da - db;
        const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
        if (ra !== rb) return rb - ra;
        if ((b.googleReviewCount || 0) !== (a.googleReviewCount || 0)) return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
        return String(a.name || '').localeCompare(String(b.name || ''));`;

if (html.includes(oldDistance)) {
  html = html.replace(oldDistance, newDistance);
  changes++;
  console.log('✅ Fixed distance sort');
} else {
  console.log('⚠️ Distance sort pattern not found');
}

// 3. Fix PRICE sort (priced array)
const oldPriced = `priced.sort((a, b) => {
      if (a.price_level !== b.price_level) return a.price_level - b.price_level;
      const ma = michelinRank(a), mb = michelinRank(b);
      if (ma !== mb) return mb - ma;
      return (b.googleRating || 0) - (a.googleRating || 0);
    });`;

const newPriced = `priced.sort((a, b) => {
      if (a.price_level !== b.price_level) return a.price_level - b.price_level;
      const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
      if (ra !== rb) return rb - ra;
      return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
    });`;

if (html.includes(oldPriced)) {
  html = html.replace(oldPriced, newPriced);
  changes++;
  console.log('✅ Fixed price sort (priced)');
} else {
  console.log('⚠️ Price sort (priced) pattern not found');
}

// 4. Fix PRICE sort (noPrice array)
const oldNoPrice = `noPrice.sort((a, b) => {
      const ma = michelinRank(a), mb = michelinRank(b);
      if (ma !== mb) return mb - ma;
      return (b.googleRating || 0) - (a.googleRating || 0);
    });`;

const newNoPrice = `noPrice.sort((a, b) => {
      const ra = (a.googleRating || 0), rb = (b.googleRating || 0);
      if (ra !== rb) return rb - ra;
      return (b.googleReviewCount || 0) - (a.googleReviewCount || 0);
    });`;

if (html.includes(oldNoPrice)) {
  html = html.replace(oldNoPrice, newNoPrice);
  changes++;
  console.log('✅ Fixed price sort (noPrice)');
} else {
  console.log('⚠️ Price sort (noPrice) pattern not found');
}

fs.writeFileSync('index.html', html);
console.log('\n' + changes + ' changes applied to index.html');
if (changes > 0) {
  console.log('Next: git add index.html && git commit -m "Sort by Google rating + review count, remove Michelin priority" && git push');
}
