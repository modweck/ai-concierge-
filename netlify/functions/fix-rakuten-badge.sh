#!/bin/bash
# Run this from your ai-concierge project folder:
#   bash fix_rakuten_badge.sh
#
# This fixes the Rakuten badge so ALL restaurants show it when in Rakuten search mode.

FILE="index.html"

if [ ! -f "$FILE" ]; then
  echo "❌ index.html not found. Make sure you run this from your project folder."
  exit 1
fi

# Check if already fixed
if grep -q "state.rewardsFilter === 'rakuten' || isRakutenRestaurant" "$FILE"; then
  echo "✅ Already fixed! The Rakuten badge fix is already in your code."
  exit 0
fi

# Check the line exists
if ! grep -q "isRakutenRestaurant(r.name)" "$FILE"; then
  echo "❌ Could not find 'isRakutenRestaurant(r.name)' in index.html"
  exit 1
fi

# Make the replacement
sed -i.bak "s/const rakutenHtml = isRakutenRestaurant(r.name)/const rakutenHtml = (state.rewardsFilter === 'rakuten' || isRakutenRestaurant(r.name))/" "$FILE"

# Verify it worked
if grep -q "state.rewardsFilter === 'rakuten' || isRakutenRestaurant" "$FILE"; then
  echo "✅ Fixed! Now push to GitHub:"
  echo "   git add index.html"
  echo "   git commit -m 'fix: show Rakuten badge on all restaurants in Rakuten mode'"
  echo "   git push"
  rm -f "$FILE.bak"
else
  echo "❌ Something went wrong. Restoring backup."
  mv "$FILE.bak" "$FILE"
fi
