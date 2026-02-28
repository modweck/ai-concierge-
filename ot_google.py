import json, urllib.request, time, urllib.parse

lookup = json.load(open('bfull.json'))
KEY = 'AIzaSyCWop5FPwG4DtTXP5M3B3M8vrAQFctQJoY'

# Get OT entries without coordinates
ot_entries = []
for name, v in lookup.items():
    if 'opentable' in v.get('url', '') and not v.get('lat'):
        ot_entries.append(name)

print(f'OT restaurants needing Google data: {len(ot_entries)}')

hits = 0
errors = 0

for i, name in enumerate(ot_entries):
    try:
        q = urllib.parse.quote(f'{name} restaurant NYC')
        url = f'https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input={q}&inputtype=textquery&fields=place_id,name,geometry,rating,user_ratings_total&key={KEY}'
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=10)
        d = json.loads(resp.read())
        
        if d.get('candidates') and len(d['candidates']) > 0:
            c = d['candidates'][0]
            loc = c.get('geometry', {}).get('location', {})
            entry = lookup[name]
            entry['lat'] = loc.get('lat')
            entry['lng'] = loc.get('lng')
            entry['google_rating'] = c.get('rating')
            entry['google_reviews'] = c.get('user_ratings_total')
            entry['place_id'] = c.get('place_id')
            hits += 1
            if (i+1) % 50 == 0:
                print(f'[{i+1}/{len(ot_entries)}] {hits} found, {errors} errors')
        else:
            if (i+1) % 50 == 0:
                print(f'[{i+1}/{len(ot_entries)}] {hits} found, {errors} errors')
    except Exception as e:
        errors += 1
        if (i+1) % 50 == 0:
            print(f'[{i+1}/{len(ot_entries)}] {hits} found, {errors} errors - {e}')
    
    time.sleep(0.2)

with open('bfull.json', 'w') as f:
    json.dump(lookup, f, indent=2)

print(f'\nDONE! {hits} Google results out of {len(ot_entries)}')
print(f'Errors: {errors}')
print('Updated bfull.json with coords + ratings')
