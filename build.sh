#!/usr/bin/env bash
set -euo pipefail

SRC="${1:?Usage: ./build.sh <input.md>}"
if [[ ! -f "$SRC" ]]; then
  echo "Error: file not found: $SRC" >&2
  exit 1
fi

# Strip the last extension (whatever it is), preserve the directory
DIR="$(dirname "$SRC")"
NAME="$(basename "$SRC")"
BASE="${NAME%.*}"
STEM="${DIR}/${BASE}"

echo "Building from: $SRC"
echo "Output stem:   $STEM"
echo

# 1. Markdown → Djot via Pandoc + djot.js
pandoc "$SRC" -f markdown -t json | djot -f pandoc -t djot > "${STEM}.djot"

# 2. Inject citations and generate CSL-JSON bibliography
node doi2citum.mjs "${STEM}.djot" \
  --output "${STEM}-cited.djot" \
  --bib "${STEM}-ref.json"

# 3. Convert CSL-JSON bibliography to Citum-native YAML
citum convert refs "${STEM}-ref.json" -o "${STEM}-ref.yaml"

# 4. Render to Typst
citum render doc "${STEM}-cited.djot" \
  -b "${STEM}-ref.yaml" \
  -s apa-7th \
  -f typst \
  -o "${STEM}-cited.typ"

echo "Done. Next: hand-edit ${STEM}-cited.typ, then: typst compile ${STEM}-cited.typ"
