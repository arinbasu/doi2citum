## What it does
 * doi2citum.mjs
 *
 * Extracts DOIs from a Markdown or Djot document, resolves them to CSL-JSON
 * via citation-js, generates stable citation keys, replaces each DOI with
 * a Citum-compatible [+@key] marker, and writes a bibliography file
 * (CSL-JSON or Citum-native YAML) for use with Citum.
 *
 * Usage:
 *   node doi2citum.mjs input.md --output out.md --bib refs.json [--format csl|yaml]
 *   node doi2citum.mjs input.dj --output out.dj --bib refs.yaml --format yaml
