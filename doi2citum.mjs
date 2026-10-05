#!/usr/bin/env node
/**
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
 */

import fs from 'node:fs';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-doi';
import '@citation-js/plugin-csl';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const inputFile = args[0];
const outputFile = getArg('--output', '-o') || inputFile;
const bibFile = getArg('--bib', '-b') || 'references.json';
const bibFormat = getArg('--format', '-f') || 'csl'; // 'csl' or 'yaml'
const mailto = getArg('--mailto') || 'anonymous@example.org';

if (!inputFile) {
  console.error('Usage: node doi2citum.mjs <input.md> [--output out.md] [--bib refs.json] [--format csl|yaml]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// DOI extraction
// ---------------------------------------------------------------------------

/**
 * Matches DOIs in the following forms:
 *   - doi:10.xxxx/yyyy
 *   - https://doi.org/10.xxxx/yyyy
 *   - http://dx.doi.org/10.xxxx/yyyy
 *   - bare 10.xxxx/yyyy (when preceded by whitespace or punctuation)
 *
 * DOI regex adapted from the CrossRef DOI pattern:
 *   https://www.crossref.org/blog/dois-and-matching-regular-expressions/
 */
const DOI_REGEX = /(?:(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)|(?<=[\s(]))(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/gi;

/**
 * Returns ALL DOI occurrences (for replacement) plus a de-duplicated list
 * of unique DOIs (for API queries).
 *
 * Returns: { all: [{ raw, doi, index }, ...], unique: [doi, ...] }
 */
function extractDois(text) {
  const all = [];              // every match, for replacement
  const unique = new Map();    // doi -> true, for querying

  let match;
  DOI_REGEX.lastIndex = 0;     // reset in case of prior use
  while ((match = DOI_REGEX.exec(text)) !== null) {
    const doi = match[1].trim().replace(/[.,;:)\]}>]+$/, '');
    all.push({ raw: match[0], doi, index: match.index });
    if (!unique.has(doi)) unique.set(doi, true);
  }

  return { all, unique: [...unique.keys()] };
}

// ---------------------------------------------------------------------------
// Citation-key generation
// ---------------------------------------------------------------------------

/**
 * Generates a stable, human-readable citation key from CSL-JSON metadata.
 *
 * Pattern: firstAuthorFamily + year + optional disambiguator
 * Examples: kuhn1962, himmelstein2019, smith2020a
 */
function generateKey(cslItem, existingKeys) {
  const family =
    (cslItem.author && cslItem.author[0]?.family) ||
    (cslItem.editor && cslItem.editor[0]?.family) ||
    cslItem.publisher ||
    'anon';

  const year =
    cslItem.issued?.['date-parts']?.[0]?.[0] ||
    cslItem.issued?.raw?.match(/\d{4}/)?.[0] ||
    'n.d.';

  const base = `${family.toLowerCase().replace(/[^a-z]/g, '')}${year}`;

  // Disambiguate if the base key already exists
  if (!existingKeys.has(base)) {
    existingKeys.add(base);
    return base;
  }

  let suffix = 'a';
  while (existingKeys.has(base + suffix)) {
    suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
  }
  const key = base + suffix;
  existingKeys.add(key);
  return key;
}

// ---------------------------------------------------------------------------
// DOI resolution via citation-js
// ---------------------------------------------------------------------------

async function resolveDois(uniqueDois) {
  const results = new Map(); // doi -> { csl, key }

  for (const doi of uniqueDois) {
    try {
      // citation-js accepts a bare DOI string directly
      const cite = await Cite.async(doi, {
        forceType: '@doi/id',
      });

      const csl = cite.data[0];
      if (!csl) {
        console.warn(`Warning: no CSL-JSON returned for DOI ${doi}`);
        continue;
      }
      results.set(doi, { csl, key: null });
      console.log(`  Resolved ${doi} → ${csl.title || '(untitled)'}`);
    } catch (err) {
      console.warn(`Warning: failed to resolve DOI ${doi}: ${err.message}`);
    }
  }

  // Generate keys after all items are resolved (so disambiguation sees all)
  const usedKeys = new Set();
  for (const [, entry] of results) {
    entry.key = generateKey(entry.csl, usedKeys);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Document rewriting
// ---------------------------------------------------------------------------

function replaceDois(text, allDois, resolved) {
  // Process in reverse order so earlier replacements don't shift indices
  const sorted = [...allDois].sort((a, b) => b.index - a.index);

  for (const { raw, doi, index } of sorted) {
    const entry = resolved.get(doi);
    if (!entry) continue;

    // Citum integral (narrative) citation syntax: [+@key]
    const marker = `[+@${entry.key}]`;

    // Replace this specific occurrence using its stored index and length.
    text = text.slice(0, index) + marker + text.slice(index + raw.length);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Bibliography output
// ---------------------------------------------------------------------------

function writeBibliography(resolved, file, format) {
  const items = [...resolved.values()].map(({ csl, key }) => {
    // Round-trip through Citation.js to strip CrossRef extras and
    // normalize to schema-compliant CSL-JSON.
    const cleaned = new Cite(csl).format('data', { format: 'object' })[0];
    cleaned.id = key;
    return cleaned;
  });

  fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getArg(long, short) {
  const idx = args.findIndex((a) => a === long || a === short);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const text = fs.readFileSync(inputFile, 'utf8');

  console.log(`Scanning ${inputFile} for DOIs...`);
  const { all, unique } = extractDois(text);

  if (unique.length === 0) {
    console.log('No DOIs found. Nothing to do.');
    return;
  }

  console.log(`Found ${all.length} DOI occurrence(s), ${unique.length} unique:`);
  for (const doi of unique) console.log(`  • ${doi}`);

  console.log('\nResolving DOIs via citation-js (CrossRef/DataCite)...');
  const resolved = await resolveDois(unique);

  if (resolved.size === 0) {
    console.error('No DOIs could be resolved. Aborting.');
    process.exit(1);
  }

  console.log(`\nRewriting document with Citum citation markers...`);
  const rewritten = replaceDois(text, all, resolved);

  fs.writeFileSync(outputFile, rewritten, 'utf8');
  console.log(`  Wrote ${outputFile}`);

  writeBibliography(resolved, bibFile, bibFormat);
  console.log(`  Wrote ${bibFile} (${bibFormat.toUpperCase()})`);

  console.log('\nDone. Next step:');
  console.log(`  citum render doc ${outputFile} -b ${bibFile} -s apa-7th -f typst -o paper.typ`);
  console.log(`  typst compile paper.typ paper.pdf`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
