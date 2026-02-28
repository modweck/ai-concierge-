/**
 * check-infatuation-reserve.js
 * 
 * Checks which Infatuation restaurants have Google Reserve.
 * Adds any found to booking_lookup.json
 * 
 * RUN: node check-infatuation-reserve.js
 */

const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY';
const BOOKING_FILE = path.join(__dirname, 'booking_lookup.json');
const OUTPUT_FILE = path.join(__dirname, 'infatuation_google_reserve.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const RESTAURANTS = [
  "95 South Soul Food","Abuqir","Aguachiles Factory","Akara House","Aldama",
  "Allegretto Al Forno","Amor Y Amargo","Amore Pizzeria","Anthonys Paninoteca",
  "Apous Taste","Asano Greenwich Village","Aunt Jenny","Ba Xuyen","Babysips",
  "Balkan Streat West Village","Bamontes","Baos Pastry","Bar A Part","Bar Bete",
  "Bar Bolinas","Bar Ferdinando","Bar Maeda","Barbaco Tio","Bark Barbecue",
  "Bark Barbecue Bushwick","Bazu By Superwow","Betos Carnitas And Guisados",
  "Birria Landia","Blazers Sports Bar","Bobbis Italian Beef","Bodega Nights",
  "Body Shop","Boil And Bite","Bojangles","Bolivian Llama Party","Bolzot",
  "Bonbon","Boong S Korean Fried Chicken","Boongs Cafe","Boongs Grab And Go",
  "Border Town","Bordertown","Brancaccios Food Shop","Brookiez","Buddy Buddy",
  "Bukas Cafe","Bunna Cafe","Burgerhead","Burgerhead East Village",
  "Burmese Bites Mona Kitchen Market","Butterfield Market Lic",
  "Caracas Arepa Bar","Caravan Chicken","Carmentas","Casa Adela",
  "Casa Della Mozzarella","Ceres Pizza","Chim Chim",
  "Chrissys Pizza Bushwick","Chrissys Pizza Greenpoint","Chuan Bistro",
  "Cocoron","Cocotazo","Copperleaf Bakery","Croft Alley 6th Ave","Cup",
  "Cuts And Slices","Cuts And Slices Lower East Side","Daily Sprouts",
  "Danang Tea","Danny And Coops","Defontes","Destefanos","Diljan",
  "Doener Haus","Dok","Dokodemo","Dollys Swing And Dive","Dolores Nyc",
  "Don Pepe Tortas Y Jugos","Donohues Steak House","Ediths","Emilios Ballato",
  "Enso Cafe","Esperanto","Esse Taco","F And F Restaurant",
  "Faiccos Italian Specialities","Fermento","First Cup","Fish And Chicks",
  "Fontys Bodega","Fulgurances Laundromat","Gees Caribbean Restaurant",
  "Geo Si Gi","Gigi Curry And Noodle Bar","Gnihton","Gogyo Gramercy",
  "Good Time Country Buffet","Hahm Ji Bach","Hainan Jones","Hampton Chutney Co",
  "Has Dac Biet","Herbies Burgers","High Beam","Himawari","Ho Won On Forsyth",
  "Homies Donuts","Hots Pizza","Huli Huli","Huong Xuan","Ippudo",
  "J G Melon","Jerk Pan","Joe And Sals Pizza","Joe Pats East Village",
  "Joenise Restaurant","Johnnys Reef","Joy Flower Pot","Justins Salt Bread",
  "Kabab Cafe","Kaia Wine Bar","Kamasu","Katsu Hama","Katzs Deli",
  "Killers Kiss","Kimchi Kooks","Kohokuku Ramen","Kolachi",
  "Kong Sihk Tong Flushing","Kum Sung Bbq","Kustom","La Abuelita",
  "Lazy Bulldog","Lb Spumoni Gardens","Le Cafe Louis Vuitton",
  "Lechonera La Isla","Lechonera La Pirana","Lees Tavern","Lil Sweet Treat",
  "Lillo","L'industrie Pizzeria West Village","Lioni Italian Heroes",
  "Little Big","Little Flower Cafe","Lloyds Carrot Cake Shop","Los Mariscos",
  "Los Tacos No 1","Louie Ernies Pizza","Lucia Pizza Of Avenue X",
  "Lukes Lobster Park Slope","Lumo Ombro","Madison Fare","Madradio",
  "Malta Coffee","Mama Lupitas Bistro","Mama Yoshi Mini Mart","Mamas Too",
  "Margon","Mariscos El Submarino Park Slope","Matter","Maxs Es Ca",
  "Milk And Honey Coney Island","Minca","Miznon Rockefeller Plaza","Mo Co 575",
  "Mochi And Cream","Mogmog","Moon And Back","Moonrise Bagels",
  "Mr Taka","Nathans Famous","Nenes Deli Taqueria","Noaa Bakery",
  "Nong Geng Ji","Northern Territory","Ny Kimchi",
  "Okiboru House Of Tsukemen","Oresh","Oriana","Ortobellos","Ouma","Oyatte",
  "P J Clarkes","Parisi Bakery","Parkhouse Cafe","Parksanbal Babs",
  "Pata Cafe","Patsys Italian Restaurant","Peek In Cafe","Peppas Jerk Chicken",
  "Petit Paulette","Phe Nyc","Pho Pizzeria","Piadi La Piadineria",
  "Pierogi Boys","Plaza Ortega","Popup Bagels","Porter House","Pyo Chai",
  "Quality Eats","Radio Bakery","Rai Rai Ken","Randys Donuts",
  "Raouls","Rockmeisha","Rough Draft","Rowdy Rooster",
  "Sal Kris And Charlies","Salt Bread Ko","Sandplunch","Santo Taco",
  "Secchu Yokota","Shu Jiao Fu Zhou Cuisine","Shuya","Slicehaus","Slik",
  "Smor","Somedays Bakery","Sonnys Corner Bar","Spiga Lexington Ave",
  "Stars East Village","Strakers Nyc","Sub Mission","Suki","Suki Desu",
  "Sun Hing Lung","Sunday C And C Bakery","Sunday C And C Eatery",
  "Sunny Annie Gourmet Deli","Sushi Of Gari","Sushidokoro Mekumi",
  "Swell Dive","Sybils Bakery","Tacos El Bronco","Tacos La 36",
  "Tacoway Beach","Tamaleria La Madrina","Tamra Soondae","Taqueria Al Pastor",
  "Taqueria El Chato West Village","Teapulse","Thai Son","Thanh Da",
  "The Blue Light Speak Cheesy","The Cat","The Crabby Shack",
  "The Gentlemans Kitchen","The Mccarren","The Squared Circle","The View",
  "The Weekender","Thisbowl","Tlayuda Oaxaquena Sr San Pablo","Tobys Estate",
  "Tomi Jazz","Trinciti Roti Shop","Two Tigers","Una Pizza Napoletana",
  "Uncle Rogers","Uotora","Wo Hop","Wolfgangs Steakhouse Park Avenue",
  "Wylies","Yi Ji Shi Mo","Yin Ji Chang Fen","Zum Stammtisch"
];

async function checkReservable(name) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name + ' NYC')}&inputtype=textquery&fields=place_id,name,formatted_address&key=${API_KEY}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();
    
    if (!searchData.candidates || !searchData.candidates.length) {
      return { found: false };
    }
    
    const placeId = searchData.candidates[0].place_id;
    const foundName = searchData.candidates[0].name;
    const address = searchData.candidates[0].formatted_address;
    
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,reservable,rating,user_ratings_total,geometry,price_level,url&key=${API_KEY}`;
    const detailResp = await fetch(detailUrl);
    const detailData = await detailResp.json();
    
    if (!detailData.result) return { found: true, reservable: false };
    
    const r = detailData.result;
    return {
      found: true,
      placeId,
      name: r.name || foundName,
      address,
      reservable: r.reservable === true,
      rating: r.rating || null,
      reviews: r.user_ratings_total || null,
      lat: r.geometry?.location?.lat || null,
      lng: r.geometry?.location?.lng || null,
      price_level: r.price_level || null,
      google_maps_url: r.url || null
    };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

async function main() {
  let bookingLookup = {};
  try { bookingLookup = JSON.parse(fs.readFileSync(BOOKING_FILE, 'utf8')); }
  catch (e) { console.log('⚠️ No booking_lookup found, will create output only'); }

  // Skip ones already in booking_lookup
  const toCheck = RESTAURANTS.filter(name => {
    const key = name.toLowerCase().trim();
    return !bookingLookup[key];
  });

  console.log(`\n🔍 INFATUATION → GOOGLE RESERVE CHECKER`);
  console.log(`📊 Total: ${RESTAURANTS.length} | Already in booking: ${RESTAURANTS.length - toCheck.length} | To check: ${toCheck.length}`);
  console.log(`⏱️  Estimated time: ~${Math.round(toCheck.length * 0.5 / 60)} minutes\n`);

  const reservable = [];
  const notReservable = [];
  let added = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const name = toCheck[i];
    process.stdout.write(`  [${i+1}/${toCheck.length}] ${name.substring(0,45).padEnd(45)} `);

    const result = await checkReservable(name);

    if (!result.found) {
      console.log(`❌ Not found`);
    } else if (result.reservable) {
      console.log(`✅ RESERVABLE (⭐${result.rating} | ${result.reviews} reviews)`);
      reservable.push(result);

      // Add to booking_lookup
      const key = name.toLowerCase().trim();
      if (!bookingLookup[key]) {
        bookingLookup[key] = {
          platform: 'google',
          url: result.google_maps_url || '',
          lat: result.lat,
          lng: result.lng,
          google_rating: result.rating,
          google_reviews: result.reviews,
          place_id: result.placeId,
          address: result.address,
          infatuation: true
        };
        added++;
      }
    } else {
      console.log(`⛔ Not reservable`);
      notReservable.push({ name, ...result });
    }

    await sleep(200);
  }

  // Save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reservable, null, 2));
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(bookingLookup, null, 2));

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   ✅ Reservable:     ${reservable.length}`);
  console.log(`   ⛔ Not reservable: ${notReservable.length}`);
  console.log(`   📗 Added to booking_lookup: ${added}`);
  console.log(`\nTo deploy:`);
  console.log(`  cp booking_lookup.json netlify/functions/booking_lookup.json`);
  console.log(`  git add -A && git commit -m "infatuation google reserve" && git push`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
