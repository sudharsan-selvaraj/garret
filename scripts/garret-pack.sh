#!/usr/bin/env bash
# Pack a built widget dist/ folder into a single installable .garret file.
#
#   scripts/garret-pack.sh <dist-dir> <output.garret>
#
# The dist/ CONTENTS go at the archive root (manifest.json must be top-level), excluding
# dotfiles / macOS cruft (the installer's extension allowlist would reject them anyway).
set -e
SRC="${1:?usage: garret-pack.sh <dist-dir> <output.garret>}"
OUT="${2:?usage: garret-pack.sh <dist-dir> <output.garret>}"
[ -f "$SRC/manifest.json" ] || { echo "error: $SRC has no manifest.json" >&2; exit 1; }
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT_ABS"
( cd "$SRC" && zip -r -X "$OUT_ABS" . -x '.*' -x '*/.*' -x '__MACOSX*' >/dev/null )
echo "packed $OUT_ABS"
