import json, urllib.request, time, re

# Load the full lookup to get OT slugs
lookup = json.load(open('booking_lookup_full.json'))

# Get OT entries without instagram
ot_entries = []
for name, v in lookup.items():
    if 'opentable' in v.get('url', '') and not v.get('instagram'):
        ot_entries.append({'name': name, 'url': v['url'], 'slug': v.get('slug', '')})

print(f'OT restaurants needing Instagram: {len(ot_entries)}')

hits = []
errors = 0

for i, r in enumerate(ot_entries):
    slug = r['slug'] or r['url'].split('/')[-1]
    try:
        url = f"https://www.opentable.com/r/{slug}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        resp = urllib.request.urlopen(req, timeout=15)
        html = resp.read().decode('utf-8', errors='ignore')
        
        # Search for Instagram links
        ig = ''
        patterns = [
            r'instagram\.com/([A-Za-z0-9_.]+)',
            r'"instagram"\s*:\s*"([^"]+)"',
            r'@([A-Za-z0-9_.]+)\s*(?:on\s+)?instagram',
        ]
        for p in patterns:
            m = re.search(p, html, re.I)
            if m:
                ig = m.group(1).strip().rstrip('/')
                if ig and ig not in ['p', 'reel', 'explore', 'accounts', 'stories']:
                    break
                ig = ''
        
        if ig:
            hits.append({'name': r['name'], 'instagram': ig})
            print(f'[{i+1}/{len(ot_entries)}] IG: {r["name"]} -> @{ig}')
        else:
            if (i+1) % 100 == 0:
                print(f'[{i+1}/{len(ot_entries)}] ... {len(hits)} found so far')
    except Exception as e:
        errors += 1
        if (i+1) % 100 == 0:
            print(f'[{i+1}/{len(ot_entries)}] ... {len(hits)} found, {errors} errors')
    
    time.sleep(0.5)

# Save results
with open('ot-instagram-results.json', 'w') as f:
    json.dump(hits, f, indent=2)

print(f'\nDONE! {len(hits)} Instagram handles found out of {len(ot_entries)}')
print(f'Errors: {errors}')
print('Saved: ot-instagram-results.json')
