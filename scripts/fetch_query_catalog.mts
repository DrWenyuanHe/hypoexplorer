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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/query');
const base = (process.env.VITE_BUNDLE_BASE_URL || 'https://data.hypoexplorer.com').replace(/\/+$/, '');

async function fetchText(relative: string): Promise<string> {
  const response = await fetch(`${base}/query/${relative}`);
  if (!response.ok) throw new Error(`${base}/query/${relative}: HTTP ${response.status}`);
  return response.text();
}

function save(relative: string, text: string): void {
  const target = path.join(OUT, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote public/query/${relative} (${text.length.toLocaleString()} bytes)`);
}

const tracks = await fetchText('tracks.js');
const pointer = await fetchText('expression-manifest.js');
const buildId = pointer.match(/"buildId":"([a-f0-9]{64})"/)?.[1];
if (!buildId) throw new Error('expression-manifest.js names no expression build');
const immutable = await fetchText(`expression/${buildId}/manifest.js`);

save('tracks.js', tracks);
save('expression-manifest.js', pointer);
save(`expression/${buildId}/manifest.js`, immutable);

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
