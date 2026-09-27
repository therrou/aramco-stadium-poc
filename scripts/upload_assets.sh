#!/usr/bin/env bash
# Upload the non-git web files to Vercel Blob and point the deployment at them (option C).
#
#   BLOB_READ_WRITE_TOKEN=... scripts/upload_assets.sh [version]
#
# Uploads web/public/{assets,brand,fonts} under <version>/ (default: v4-<git short sha>), so each export
# gets its own folder and the 30-day CDN cache never serves stale lightmaps. Prints the base URL; set it
# as VITE_ASSET_BASE on the Vercel project (Production) and redeploy.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BLOB_READ_WRITE_TOKEN:?set BLOB_READ_WRITE_TOKEN (vercel env pull)}"
VERSION="${1:-v4-$(git rev-parse --short HEAD)}"
PUB=web/public
n=0; url=""
while IFS= read -r f; do
  rel=${f#"$PUB/"}
  out=$(vercel blob put "$f" --pathname "$VERSION/$rel" --force true --rw-token "$BLOB_READ_WRITE_TOKEN" 2>&1) || { echo "$out"; exit 1; }
  u=$(printf '%s\n' "$out" | grep -Eo 'https://[^ ]+' | head -1)
  [ -z "$url" ] && url=$u
  n=$((n + 1)); printf '.'
done < <(find "$PUB/assets" "$PUB/brand" "$PUB/fonts" -type f ! -name ".*" | sort)
echo
base=${url%%"/$VERSION/"*}/$VERSION/
echo "uploaded $n files"
echo "VITE_ASSET_BASE=$base"
