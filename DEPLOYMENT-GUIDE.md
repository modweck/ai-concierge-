# AI Concierge - Setup & Deployment Guide

## 🎯 What You Have

You now have a complete restaurant finder app with:
- ✅ Frontend (AI-Concierge.html)
- ✅ Backend API integration (search-restaurants.js)
- ✅ Google Places API integration
- ✅ Yelp Fusion API integration
- ✅ Automatic vibe detection from Yelp reviews (Loud/Quiet/Balanced)
- ✅ Real restaurant data

---

## 📋 Step 1: Get Your API Keys

### Google Places API Key
1. Go to: https://console.cloud.google.com
2. Create a new project (or select existing)
3. Click "Enable APIs and Services"
4. Search for "Places API" and enable it
5. Also enable "Geocoding API" (for address lookup)
6. Go to "Credentials" → "Create Credentials" → "API Key"
7. Copy your API key
8. **Recommended**: Restrict the key to only Places API and Geocoding API

### Yelp Fusion API Key
1. Go to: https://www.yelp.com/developers
2. Create a Yelp account (if you don't have one)
3. Click "Create App"
4. Fill out the form:
   - App Name: "AI Concierge"
   - Industry: "Food & Restaurants"
   - Description: "Restaurant recommendation and booking assistant"
5. Agree to terms and create app
6. Copy your API Key from the app page

---

## 📦 Step 2: Project Structure

Create this folder structure on your computer:

```
ai-concierge/
├── AI-Concierge.html          (your frontend)
├── netlify.toml               (configuration)
├── package.json               (dependencies)
├── .env                       (your API keys - create this)
├── .gitignore                 (don't commit secrets)
└── netlify/
    └── functions/
        └── search-restaurants.js  (backend API)
```

### Create .env file
Copy `.env.example` to `.env` and add your real keys:

```
GOOGLE_PLACES_API_KEY=AIzaSyC...your_actual_key
YELP_API_KEY=Bearer_xyz...your_actual_key
```

### Create .gitignore file
```
node_modules/
.env
.netlify/
```

---

## 🚀 Step 3: Deploy to Netlify (FREE)

### Option A: Deploy via Netlify UI (Easiest)

1. **Sign up for Netlify**: https://app.netlify.com/signup
2. **Install Netlify CLI** (optional but recommended):
   ```bash
   npm install -g netlify-cli
   ```

3. **Create GitHub repository** (recommended):
   - Go to https://github.com
   - Create new repository: "ai-concierge"
   - Upload all your files (EXCEPT .env)
   
4. **Connect to Netlify**:
   - In Netlify dashboard, click "Add new site" → "Import an existing project"
   - Choose "GitHub"
   - Select your ai-concierge repository
   - Build settings:
     - Build command: (leave empty)
     - Publish directory: `.`
     - Functions directory: `netlify/functions`
   
5. **Add Environment Variables**:
   - In Netlify site settings → "Environment variables"
   - Add:
     - `GOOGLE_PLACES_API_KEY` = your Google key
     - `YELP_API_KEY` = your Yelp key

6. **Deploy**: Click "Deploy site"

### Option B: Deploy via CLI (Faster for updates)

```bash
# In your project folder
netlify login
netlify init
netlify deploy --prod

# Add environment variables
netlify env:set GOOGLE_PLACES_API_KEY "your_google_key"
netlify env:set YELP_API_KEY "your_yelp_key"
```

---

## 🔧 Step 4: Update Frontend to Use Real API

The frontend (AI-Concierge.html) currently uses mock data. You need to update it to call your backend API.

Replace the `search()` function with this:

```javascript
async function search(){
  // Show loading state
  document.getElementById('list').innerHTML = '<div class="restaurant" style="text-align:center"><p>🔍 Searching for restaurants...</p></div>';
  document.getElementById('search').classList.add('hidden');
  document.getElementById('results').classList.remove('hidden');

  const party=+document.getElementById('party').value;
  const budgetRange=document.getElementById('budget').value.split('-');
  const budgetMin=+budgetRange[0];
  const budgetMax=+budgetRange[1];
  const location=document.getElementById('addressInput').value;
  
  let maxDistance;
  if(state.transport=='walk'){
    maxDistance=+document.getElementById('walkTime').value * 80; // meters
  }else if(state.transport=='drive'){
    maxDistance=+document.getElementById('driveTime').value * 800; // rough estimate
  }else{
    maxDistance=+document.getElementById('radiusMiles').value * 1609; // miles to meters
  }
  
  const cuisine=document.getElementById('cuisine').value;
  const timeSlot=document.getElementById('timewindow').value;
  const quality=document.getElementById('quality').value;
  const creditcard=document.getElementById('creditcard').value;
  
  try {
    // Call your Netlify function
    const response = await fetch('/.netlify/functions/search-restaurants', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        location: location,
        radius: maxDistance,
        cuisine: cuisine !== 'any' ? cuisine : null,
        openNow: state.timing === 'tonight'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Search failed');
    }
    
    // Filter and process results
    let results = data.restaurants.filter(r => {
      if(!r.name) return false;
      if(r.priceLevel && (r.priceLevel < budgetMin/50 || r.priceLevel > budgetMax/50)) return false;
      if(cuisine!="any"&&r.cuisine!=cuisine)return false;
      if(state.vibe!="any"&&r.vibe.toLowerCase()!=state.vibe)return false;
      if(quality!="any"&&r.qualityLevel!=quality)return false;
      return true;
    });
    
    // Calculate likelihood and sort
    results = results.map(r => ({
      ...r,
      likelihood: calculateLikelihood({base: r.isOpenNow ? "HIGH" : "MEDIUM"}, party, 0, timeSlot, new Date().getDay())
    }));
    
    const order={HIGH:3,MEDIUM:2,LOW:1};
    results.sort((a,b)=>order[b.likelihood]-order[a.likelihood]);
    
    displayResults(results);
    
  } catch (error) {
    console.error('Search error:', error);
    document.getElementById('list').innerHTML = `
      <div class="restaurant" style="text-align:center">
        <h3 style="color:#e53e3e">⚠️ Search Error</h3>
        <p style="color:#666;margin-top:12px">${error.message}</p>
        <p style="color:#666;margin-top:8px">Please check your API keys are configured correctly.</p>
      </div>
    `;
  }
}
```

---

## 🧪 Step 5: Test Locally

Before deploying, test locally:

```bash
# Install dependencies
npm install

# Run Netlify dev server
netlify dev
```

Open: http://localhost:8888

Try searching for restaurants!

---

## 📊 How the Vibe Detection Works

The backend analyzes Yelp reviews for keywords:

**Loud/Lively keywords**: loud, noisy, busy, energetic, lively, buzzing, vibrant, crowded, party, music

**Quiet keywords**: quiet, calm, peaceful, intimate, cozy, romantic, relaxed, chill, serene

**Algorithm**:
- If loud keywords appear 1.5x more → LIVELY
- If quiet keywords appear 1.5x more → QUIET  
- Otherwise → BALANCED

---

## 💰 API Costs

### Free Tier Limits:
- **Google Places**: 28,000 searches/month FREE
- **Yelp**: 5,000 calls/day FREE (150,000/month)

### Typical Usage:
- 1 search = 1 Google Places call + ~10 Yelp calls
- ~2,800 searches/month on free tier
- Good for ~100 daily users

---

## 🐛 Troubleshooting

### "No results found"
- Check that your API keys are added to Netlify environment variables
- Verify the address input is valid
- Check browser console for errors

### "API keys not configured"
- Make sure you added environment variables in Netlify dashboard
- Redeploy after adding variables

### Vibe not showing correctly
- This is normal - not all restaurants have enough reviews
- Default is BALANCED if reviews are insufficient

---

## 🎯 Next Steps

1. Get your API keys (Step 1)
2. Create the project structure (Step 2)
3. Deploy to Netlify (Step 3)
4. Update frontend code (Step 4)
5. Test it live!

---

## 📞 Need Help?

If you get stuck:
1. Check Netlify function logs (in Netlify dashboard → Functions)
2. Check browser console for errors (F12)
3. Verify API keys are correct
4. Make sure you enabled the right Google APIs (Places + Geocoding)

---

**You're ready to build a real, working restaurant finder! 🚀**
