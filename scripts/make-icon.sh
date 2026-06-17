#!/usr/bin/env bash
# Regenerate build/icon.icns from the generated 1024² PNG.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/make-icon.cjs

ICONSET=build/icon.iconset
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" build/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" build/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/icon.icns
rm -rf "$ICONSET"
echo "wrote build/icon.icns"
