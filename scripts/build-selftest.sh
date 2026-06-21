#!/usr/bin/env bash
# Build the sandbox self-test widget into a clean, installable dist/ folder
# (only manifest.json + index.html + bundle.js — the install allowlist rejects src/*.tsx).
set -e
cd "$(dirname "$0")/.."
OUT=examples/sandbox-selftest/dist
mkdir -p "$OUT"
node_modules/.bin/esbuild examples/sandbox-selftest/src/index.tsx \
  --bundle --format=iife --jsx=automatic --outfile="$OUT/bundle.js"
cp examples/sandbox-selftest/manifest.json examples/sandbox-selftest/index.html \
  examples/sandbox-selftest/preview.svg "$OUT/"
echo "built $OUT — install this folder via Settings → Widgets → Install widget…"
