// Semantic equivalence gate for the macaque migration — HISTORICAL.
//
// This verified the pop_*.js → datasets/macaque_snrna/ relocation was verbatim.
// Two later, deliberate changes mean it no longer passes against current
// bundles: the pathway split (split_macaque_pathways.mts moved `pathways` into
// sibling files) and the wire-size optimization (scripts/optimize_bundles.mts
// rounds P/FDR under a threshold guard and drops rankPos/ens/null-logCPM; see
// scripts/lib/bundleSlim.mts). The optimizer's equivalent gate is the semantic
// diff run at optimization time: order/count identical, zero classification
// flips at 1e-4/1e-3/0.01/0.05, bounded rounding error, cpm/meta/qc untouched.
//
// For every population in POP_META: load the legacy POP_<ID> and the new
// HX_MACAQUE_SNRNA_<ID>, then assert:
//   - de, cpm, pathways, qc deep-equal
//   - meta core fields equal (code, label, type, sampleNames, samplesKept,
//     normalSamples, obeseSamples, nGenes)
//   - new meta has sampleOrder === sampleNames
//   - new meta has groupSamples === {normal:normalSamples, obese:obeseSamples}
//   - track count matches POP_META.populations.length
//
// Exits non-zero on any mismatch. Run after migrate_macaque_bundles.mjs.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'datasets', 'macaque_snrna');

// The 58 non-compat legacy public/pop_<id>.js bundles are git-deleted by the
// migration commit, so the verifier can no longer read them from the working
// tree. They DO still exist on the base branch (before this branch deleted
// them), so resolve them at the merge-base — NOT at HEAD. HEAD already contains
// the committed deletion, so `git show HEAD:<path>` fails for every deleted
// bundle (the original bug: it verified only the 1 surviving compat track).
// Returns the source text, or null if it can't be read at the working tree or base.
const LEGACY_BASE_REF = (() => {
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['merge-base', ref, 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch {
      // try the next candidate ref
    }
  }
  return 'HEAD'; // last-resort: behaves like the old fallback rather than crashing
})();

function readLegacySource(file) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
  try {
    return execFileSync('git', ['show', `${LEGACY_BASE_REF}:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const META_CORE_FIELDS = [
  'code',
  'label',
  'type',
  'sampleNames',
  'samplesKept',
  'normalSamples',
  'obeseSamples',
  'nGenes',
];

function loadGlobal(file: string, expectedKey: string, srcOverride?: string) {
  const src = srcOverride ?? fs.readFileSync(file, 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: file });
  if (!(expectedKey in ctx)) {
    throw new Error(`${path.basename(file)} did not define global ${expectedKey}`);
  }
  // Each bundle runs in its own VM realm, so its objects/arrays have prototypes
  // from that realm. assert.deepStrictEqual checks prototype identity and would
  // reject cross-realm values even when their data is identical. Re-hydrate
  // through JSON so both sides live in this realm with standard prototypes; the
  // bundles are pure JSON data (null, not undefined), so this is lossless.
  return JSON.parse(JSON.stringify(ctx[expectedKey]));
}

function main() {
  const errors = [];

  const metaFile = path.join(PUBLIC_DIR, 'pop_meta.js');
  const popMeta = loadGlobal(metaFile, 'POP_META', readLegacySource(metaFile));
  const populations = popMeta.populations;

  // Dataset meta.js must equal legacy POP_META verbatim.
  const newMeta = loadGlobal(path.join(OUT_DIR, 'meta.js'), 'HX_MACAQUE_SNRNA_META');
  try {
    assert.deepStrictEqual(newMeta, popMeta);
  } catch {
    errors.push('dataset meta.js (HX_MACAQUE_SNRNA_META) does not deep-equal legacy POP_META');
  }

  // Dataset qc_global.js must equal legacy QC_GLOBAL verbatim.
  const qcFile = path.join(PUBLIC_DIR, 'qc_global.js');
  const oldQc = loadGlobal(qcFile, 'QC_GLOBAL', readLegacySource(qcFile));
  const newQc = loadGlobal(path.join(OUT_DIR, 'qc_global.js'), 'HX_MACAQUE_SNRNA_QC');
  try {
    assert.deepStrictEqual(newQc, oldQc);
  } catch {
    errors.push('dataset qc_global.js (HX_MACAQUE_SNRNA_QC) does not deep-equal legacy QC_GLOBAL');
  }

  // Per-track equivalence.
  let checked = 0;
  let trackFiles = 0;
  for (const id of populations) {
    const oldFile = path.join(PUBLIC_DIR, `pop_${id}.js`);
    const newFile = path.join(OUT_DIR, `track_${id}.js`);
    if (!fs.existsSync(newFile)) {
      errors.push(`[${id}] missing new bundle ${path.relative(REPO_ROOT, newFile)}`);
      continue;
    }
    trackFiles += 1;
    // Legacy bundle: working tree if present, else last committed copy (HEAD).
    const oldSrc = readLegacySource(oldFile);
    if (oldSrc == null) {
      errors.push(`[${id}] legacy bundle ${path.relative(REPO_ROOT, oldFile)} not found in working tree or HEAD (cannot verify equivalence)`);
      continue;
    }
    const old = loadGlobal(oldFile, `POP_${id.toUpperCase()}`, oldSrc);
    const neu = loadGlobal(newFile, `HX_MACAQUE_SNRNA_${id.toUpperCase()}`);

    for (const field of ['de', 'cpm', 'pathways', 'qc']) {
      try {
        assert.deepStrictEqual(neu[field], old[field]);
      } catch {
        errors.push(`[${id}] field "${field}" differs from legacy`);
      }
    }

    for (const f of META_CORE_FIELDS) {
      try {
        assert.deepStrictEqual(neu.meta[f], old.meta[f]);
      } catch {
        errors.push(`[${id}] meta.${f} differs from legacy`);
      }
    }

    try {
      assert.deepStrictEqual(neu.meta.sampleOrder, old.meta.sampleNames);
    } catch {
      errors.push(`[${id}] meta.sampleOrder !== legacy meta.sampleNames`);
    }
    try {
      assert.deepStrictEqual(neu.meta.groupSamples, {
        normal: old.meta.normalSamples,
        obese: old.meta.obeseSamples,
      });
    } catch {
      errors.push(`[${id}] meta.groupSamples inconsistent with normalSamples/obeseSamples`);
    }

    checked += 1;
  }

  // Track-count assertion.
  if (trackFiles !== populations.length) {
    errors.push(
      `track count mismatch: ${trackFiles} new bundles vs ${populations.length} populations`,
    );
  }

  console.log('verify_macaque_equivalence summary');
  console.log(`  populations:    ${populations.length}`);
  console.log(`  tracks checked: ${checked}`);
  console.log(`  meta.js:        ${errors.some((e) => e.startsWith('dataset meta')) ? 'MISMATCH' : 'ok'}`);
  console.log(`  qc_global.js:   ${errors.some((e) => e.startsWith('dataset qc')) ? 'MISMATCH' : 'ok'}`);
  console.log(`  errors:         ${errors.length}`);

  if (errors.length) {
    console.error('\nEQUIVALENCE FAILED:');
    for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
    if (errors.length > 50) console.error(`  ...and ${errors.length - 50} more`);
    process.exit(1);
  }

  console.log('\nEQUIVALENCE PASSED: all tracks semantically identical.');
}

main();
