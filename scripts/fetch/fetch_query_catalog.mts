// Download the published query catalog that `vite build` and `vite` bind to.
//
// vite.config.ts reads public/query/tracks.js and public/query/expression-manifest.js
// (plus the immutable expression/<buildId>/manifest.js it points at) to stamp the
// catalog and expression-index build identities into the app. Those files are
// generated from public/datasets by build:query-index and build:expression-index,
// and public/query/ is gitignored. A checkout without the dataset bundles (the
// public repository, or a fresh clone that only works on the app) cannot build
// them, so this fetches the three small files the data origin already serves,
// plus the Dataset Tracker catalog from the app host.
//
// The app then reads every bundle and query shard from the same origin, so run
// dev and build with VITE_BUNDLE_BASE_URL set to it (see .env.example).
//
//   pnpm run fetch:query            # from https://data.hypoexplorer.com
//   VITE_BUNDLE_BASE_URL=... pnpm run fetch:query

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generationFiles, httpOrigin, readQueryGeneration } from '../lib/queryGeneration.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = (process.env.VITE_BUNDLE_BASE_URL || 'https://data.hypoexplorer.com').replace(/\/+$/, '');

// Read and validate the whole generation before writing any of it, so a
// malformed or half-published origin leaves public/query untouched.
const generation = await readQueryGeneration(httpOrigin(base));
for (const { key, text } of generationFiles(generation)) {
  const target = path.join(ROOT, 'public', ...key.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote public/${key} (${text.length.toLocaleString()} bytes)`);
}

// The Dataset Tracker's catalog is generated from survey notes this repository
// does not carry, so the deployed copy is fetched from the app host.
const app = (process.env.HYPOEXPLORER_APP_ORIGIN || 'https://hypoexplorer.com').replace(/\/+$/, '');
const tracker = await fetch(`${app}/tracker/catalog.js`);
if (!tracker.ok) throw new Error(`${app}/tracker/catalog.js: HTTP ${tracker.status}`);
const trackerText = await tracker.text();
mkdirSync(path.join(ROOT, 'public/tracker'), { recursive: true });
writeFileSync(path.join(ROOT, 'public/tracker/catalog.js'), trackerText);
console.log(`wrote public/tracker/catalog.js (${trackerText.length.toLocaleString()} bytes) from ${app}`);
console.log(`query catalog from ${base}; set VITE_BUNDLE_BASE_URL=${base} for dev and build`);
