#!/usr/bin/env bash
set -euo pipefail

SRC="${1:?Usage: ./build.sh <bearfile.md>}"
BASE="${SRC%.md}"

# 1. Markdown → Djot via Pandoc + djot.js
pandoc "$SRC" -f markdown -t json | djot -f pandoc -t djot > "${BASE}.djot"

# 2. Inject citations and generate CSL-JSON bibliography
node doi2citum.mjs "${BASE}.djot" \
  --output "${BASE}-cited.djot" \
  --bib "${BASE}-ref.json"

# 3. Convert CSL-JSON bibliography to Citum-native YAML
citum convert refs "${BASE}-ref.json" -o "${BASE}-ref.yaml"

# 4. Render to Typst
citum render doc "${BASE}-cited.djot" \
  -b "${BASE}-ref.yaml" \
  -s apa-7th \
  -f typst \
  -o "${BASE}-cited.typ"

echo "Done. Next: hand-edit ${BASE}-cited.typ, then: typst compile ${BASE}-cited.typ"
