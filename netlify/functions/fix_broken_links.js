const fs = require("fs");
const path = require("path");

const BOOKING_PATH = path.join(__dirname, "booking_lookup.json");
const BUZZ_PATH = path.join(__dirname, "buzz_links.json");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---- Normalizers ----
function normalizeOpenTableUrl(url) {
  if (typeof url !== "string") return url;
  // examples we fix:
  //  - https://www.opentable.com/r/restaurant-name-new-york
  //  - https://www.opentable.com/restaurant-name-new-york
  return url
    .replace(/-new-york\b/g, "")
    .replace("/r/", "/");
}

function normalizeInfatuationUrl(url) {
  if (typeof url !== "string") return url;
  // fix: https://www.theinfatuation.com/new-york/reviews/... -> https://www.theinfatuation.com/reviews/...
  return url.replace("theinfatuation.com/new-york/", "theinfatuation.com/");
}

// ---- Fixers ----
function fixBookingLinks() {
  const booking = loadJSON(BOOKING_PATH);
  let fixedCount = 0;

  for (const key of Object.keys(booking)) {
    const entry = booking[key];
    if (!entry || typeof entry !== "object") continue;

    if (entry.platform === "opentable") {
      const before = entry.url;
      const after = normalizeOpenTableUrl(before);
      if (after !== before) {
        entry.url = after;
        fixedCount++;
      }
    }
  }

  saveJSON(BOOKING_PATH, booking);
  console.log(`Fixed ${fixedCount} booking URLs`);
}

function fixBuzzLinks() {
  const buzz = loadJSON(BUZZ_PATH);
  let fixedCount = 0;

  for (const key of Object.keys(buzz)) {
    const entry = buzz[key];

    // case A: value is a string URL
    if (typeof entry === "string") {
      const before = entry;
      const after = normalizeInfatuationUrl(before);
      if (after !== before) {
        buzz[key] = after;
        fixedCount++;
      }
      continue;
    }

    // case B: value is an object like { url: "..." }
    if (entry && typeof entry === "object" && typeof entry.url === "string") {
      const before = entry.url;
      const after = normalizeInfatuationUrl(before);
      if (after !== before) {
        entry.url = after;
        fixedCount++;
      }
      continue;
    }
  }

  saveJSON(BUZZ_PATH, buzz);
  console.log(`Fixed ${fixedCount} buzz URLs`);
}

function run() {
  console.log("Starting link normalization...");
  fixBookingLinks();
  fixBuzzLinks();
  console.log("Done.");
}

run();
