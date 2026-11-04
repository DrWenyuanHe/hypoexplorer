/**
 * Supersession manifest for the corpus-wide R 4.6.0 regeneration (2026-09-25).
 *
 *   npx tsx scripts/regen-r460/build_supersession_manifest.mts --capture
 *     Before the swap. Records every tracked output the regeneration may rewrite,
 *     as committed at the pre-swap commit (SHA-256, bytes, git blob), marks the
 *     ones any tracked evidence pins (exact bytes or CRLF rendering), and archives
 *     the ledgers the swap rewrites under preserved-inputs/<sha256>.json.gz.
 *   npx tsx scripts/regen-r460/build_supersession_manifest.mts --finalize [--accept <path>]...
 *     After the swap. Fills newSha256/newBytes from the working tree, drops
 *     records whose bytes did not change, refuses any other changed file whose
 *     pre-swap bytes are pinned (unless explicitly accepted), and writes the
 *     manifest SHA-256 into scripts/historical_evidence.py and
 *     scripts/lib/historicalEvidence.mts.
 *   npx tsx scripts/regen-r460/build_supersession_manifest.mts --check
 *     Re-verifies the manifest against git, the archives and, once finalized,
 *     the working tree and both pinned constants.
 *
 * See data/quality/regeneration-r460-2026-09-25/README.md.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DATASETS } from '../../src/data/datasets';
import { crlfRendering, isRecordedCurrentOutput, SUPERSESSION_DIR, SUPERSESSION_MANIFEST } from '../lib/historicalEvidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** main at 83acab30, before any output was regenerated. */
const PRE_SWAP = '83acab3059fdd8cc024702ec7c9cf7f3d6d14c3e';
const TAG = 'superseded/r441-2026-09-25';
const ARCHIVE = `${SUPERSESSION_DIR}/preserved-inputs`;
const MACAQUE = 'macaque_snrna';
const PY_CONSTANT = 'scripts/historical_evidence.py';
const TS_CONSTANT = 'scripts/lib/historicalEvidence.mts';
const MAX_BATCH = 192 * 1024 * 1024;

/** Tracked outputs the regeneration and the bundle/index rebuild may rewrite. */
const SCOPE: [string, RegExp][] = [
  ['geo_replication/datasets/*/processed/**', /^geo_replication\/datasets\/[^/]+\/processed\//],
  ['geo_replication/archive/*/processed/**', /^geo_replication\/archive\/[^/]+\/processed\//],
  ['data/raw/results/**', /^data\/raw\/results\//],
  ['public/datasets/**', /^public\/datasets\//],
  ['public/expression/**', /^public\/expression\//],
  ['public/tracker/**', /^public\/tracker\//],
  ['public/nomenclature/**', /^public\/nomenclature\//],
  ['public/qc/**', /^public\/qc\//],
  ['public/pop_meta.js', /^public\/pop_meta\.js$/],
  ['src/data/tracker/reverseIndex.generated.js', /^src\/data\/tracker\/reverseIndex\.generated\.js$/],
  ['data/nomenclature/nomenclature.tsv', /^data\/nomenclature\/nomenclature\.tsv$/],
  ['data/nomenclature/sources.json', /^data\/nomenclature\/sources\.json$/],
];
/**
 * Tracked analysis inputs the regeneration re-prepared (gene/ID maps, source
 * tables, re-prepared count matrices). Each was copied from the frozen staging
 * tree over its tracked path; data/quality/regeneration-r460-2026-09-25/r460-inputs.json
 * records the staged and stored identities.
 */
const R460_INPUTS = `${SUPERSESSION_DIR}/r460-inputs.json`;
function regeneratedInputs(): Set<string> {
  const target = resolve(ROOT, R460_INPUTS);
  if (!existsSync(target)) return new Set();
  const document = JSON.parse(readFileSync(target, 'utf8'));
  return new Set(document.inputs.filter((row: any) => row.tracked).map((row: any) => row.storedPath));
}
const INPUT_AREA = `re-prepared inputs listed in ${R460_INPUTS}`;
const areaOf = (path: string, inputs: Set<string>) => (inputs.has(path) ? INPUT_AREA : SCOPE.find(([, pattern]) => pattern.test(path))?.[0]);
const inScope = (path: string, inputs: Set<string>) => areaOf(path, inputs) !== undefined;

/**
 * Ledgers the swap rewrites. Each is pinned by retained evidence, or read by a
 * sealed producer through read_sealed_input/readSealedHistoricalInput.
 */
const LEDGERS = [
  'data/internal-qc/assessments.generated.json',
  'data/quality/assessments.generated.json',
  'data/internal-qc/advancement-2026-09-05/normalization-evidence.json',
  'data/internal-qc/advancement-2026-09-05/macaque/atlas-evidence.json',
  'data/internal-qc/advancement-2026-09-05/conservation-evidence.json',
  'data/internal-qc/conservation-2026-09-05/conservation-evidence.json',
  'data/author-validation/validation-records.generated.json',
  'data/author-validation/direct-comparisons.generated.json',
  'data/author-validation/fgsea-migration.generated.json',
  'data/author-validation/mechanical-audit.generated.json',
  'data/author-validation/source-inventory.generated.json',
  'data/intake/hfd-2026-09-12/audit.generated.json',
  'data/intake/september5-2026/audit.generated.json',
];
/** Never scanned for pins: bulk outputs (they hold none) and this record itself. */
const PIN_SCAN_EXCLUDES = ['public/datasets', 'data/raw/results', SUPERSESSION_DIR];

type PinForm = 'exact' | 'crlf' | 'both' | null;
interface Entry { oid: string; size: number; path: string }
interface Blob { sha256: string; bytes: number; crlfSha256: string | null }
interface OutputRecord {
  path: string; datasetId: string | null; oldSha256: string; oldBytes: number; oldGitBlob: string;
  oldPinForm: PinForm; pinnedBy: string[]; newSha256: string | null; newBytes: number | null;
}
interface LedgerRecord { path: string; sha256: string; bytes: number; gitBlob: string; pinForm: PinForm; archivePath: string }

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const binary = (bytes: Buffer) => bytes.subarray(0, 8000).includes(0);

function git(args: string[], input?: string | Buffer, okStatus = [0]): Buffer {
  const result = spawnSync('git', args, { cwd: ROOT, input, maxBuffer: 2 ** 31 - 1 });
  assert.ok(result.status !== null && okStatus.includes(result.status), `git ${args.join(' ')} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

function lsTree(commit: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const line of git(['ls-tree', '-r', '-l', '-z', commit]).toString('utf8').split('\0')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const [, type, oid, size] = line.slice(0, tab).split(/\s+/);
    if (type === 'blob') entries.set(line.slice(tab + 1), { oid, size: Number(size), path: line.slice(tab + 1) });
  }
  return entries;
}

/** Stream blobs through `git cat-file --batch` in bounded batches. */
function eachBlob(entries: Entry[], visit: (entry: Entry, bytes: Buffer) => void): void {
  for (let start = 0; start < entries.length;) {
    let end = start, total = 0;
    while (end < entries.length && (end === start || total + entries[end].size <= MAX_BATCH)) total += entries[end++].size;
    const batch = entries.slice(start, end);
    const out = git(['cat-file', '--batch'], batch.map((entry) => `${entry.oid}\n`).join(''));
    let offset = 0;
    for (const entry of batch) {
      const newline = out.indexOf(10, offset);
      const [oid, kind, size] = out.subarray(offset, newline).toString('utf8').split(' ');
      assert.ok(oid === entry.oid && kind === 'blob' && Number(size) === entry.size, `Unexpected object for ${entry.path}`);
      visit(entry, out.subarray(newline + 1, newline + 1 + entry.size));
      offset = newline + 1 + entry.size + 1;
    }
    start = end;
  }
}

function describe(bytes: Buffer): Blob {
  return { sha256: sha(bytes), bytes: bytes.length, crlfSha256: bytes.includes(13) || binary(bytes) ? null : sha(crlfRendering(bytes)) };
}

/** SHA-256 tokens in tracked evidence at the pre-swap commit: token -> files that contain it. */
function scanPins(tree: Map<string, Entry>): { tokens: Map<string, Set<string>>; textFiles: number; archives: number } {
  const tokens = new Map<string, Set<string>>();
  const add = (token: string, file: string) => {
    if (!tokens.has(token)) tokens.set(token, new Set());
    tokens.get(token)!.add(file);
  };
  const excludes = PIN_SCAN_EXCLUDES.map((path) => `:!${path}`);
  const grep = git(['grep', '-I', '-o', '-E', '[0-9a-f]{64}', PRE_SWAP, '--', '.', ...excludes], undefined, [0, 1]).toString('utf8');
  const files = new Set<string>();
  for (const line of grep.split('\n')) {
    if (!line) continue;
    const first = line.indexOf(':'), last = line.lastIndexOf(':');
    const file = line.slice(first + 1, last);
    files.add(file);
    add(line.slice(last + 1), file);
  }
  // Retained evidence archives (preserved inputs, closed-input snapshots) also pin bytes.
  const archives = [...tree.values()].filter(({ path, size }) => /^data\/(?!raw\/).*\.gz$/.test(path) && !path.endsWith('.tar.gz')
    && !PIN_SCAN_EXCLUDES.some((excluded) => path.startsWith(`${excluded}/`)) && size <= 32 * 1024 * 1024);
  let scanned = 0;
  eachBlob(archives, (entry, bytes) => {
    let text: Buffer;
    try { text = gunzipSync(bytes); } catch { return; }
    if (text.subarray(0, 65536).includes(0)) return;
    scanned += 1;
    for (const match of text.toString('latin1').matchAll(/[0-9a-f]{64}/g)) add(match[0], entry.path);
  });
  return { tokens, textFiles: files.size, archives: scanned };
}

function pinsOf(blob: Blob, path: string, tokens: Map<string, Set<string>>): { form: PinForm; by: string[] } {
  const others = (token: string | null) => [...(token ? tokens.get(token) ?? [] : [])].filter((file) => file !== path);
  const exact = others(blob.sha256), rendered = others(blob.crlfSha256);
  const form: PinForm = exact.length && rendered.length ? 'both' : exact.length ? 'exact' : rendered.length ? 'crlf' : null;
  return { form, by: [...new Set([...exact, ...rendered])].sort() };
}

/** The registry dataset an output belongs to, or null for cross-dataset products. */
function datasetResolver(): (path: string) => string | null {
  const ids = new Set(DATASETS.map((dataset) => dataset.id));
  const normalize = (accession: string) => accession.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byAccession = new Map<string, string[]>();
  for (const dataset of DATASETS) {
    for (const accession of String((dataset as any).geo ?? '').split(/[,;/ ]+/).filter(Boolean)) {
      const key = normalize(accession);
      byAccession.set(key, [...(byAccession.get(key) ?? []), dataset.id]);
    }
  }
  return (path) => {
    const parts = path.split('/');
    if (path.startsWith('public/datasets/')) return ids.has(parts[2]) ? parts[2] : null;
    if (path.startsWith('data/raw/results/') || path.startsWith('public/qc/') || path === 'public/pop_meta.js') return MACAQUE;
    if (path.startsWith('geo_replication/datasets/') || path.startsWith('geo_replication/archive/')) {
      const directory = parts[2];
      const candidates = byAccession.get(normalize(directory.split('_')[0])) ?? [];
      if (candidates.length <= 1) return candidates[0] ?? null;
      // One accession, several registry datasets: the directory names its population.
      const words = directory.toLowerCase().split('_').slice(1);
      const named = candidates.filter((id) => words.some((word) => id.split('_').includes(word)
        && candidates.filter((other) => other.split('_').includes(word)).length === 1));
      assert.equal(named.length, 1, `Ambiguous dataset for ${directory}: ${candidates.join(', ')}`);
      return named[0];
    }
    return null;
  };
}

function loadManifest(): any {
  const target = resolve(ROOT, SUPERSESSION_MANIFEST);
  assert.ok(existsSync(target), `${SUPERSESSION_MANIFEST} is missing; run --capture first`);
  return JSON.parse(readFileSync(target, 'utf8'));
}

function writeManifest(manifest: unknown): string {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  mkdirSync(resolve(ROOT, SUPERSESSION_DIR), { recursive: true });
  writeFileSync(resolve(ROOT, SUPERSESSION_MANIFEST), body);
  return sha(body);
}

function totals(records: OutputRecord[]) {
  const pinned = records.filter((row) => row.oldPinForm);
  const byArea: Record<string, { records: number; pinned: number }> = {};
  for (const row of records) {
    const area = areaOf(row.path, regeneratedInputs())!;
    byArea[area] ??= { records: 0, pinned: 0 };
    byArea[area].records += 1;
    if (row.oldPinForm) byArea[area].pinned += 1;
  }
  return {
    records: records.length,
    pinnedRecords: pinned.length,
    oldBytes: records.reduce((sum, row) => sum + row.oldBytes, 0),
    pinnedOldBytes: pinned.reduce((sum, row) => sum + row.oldBytes, 0),
    pinForms: Object.fromEntries(['exact', 'crlf', 'both'].map((form) => [form, pinned.filter((row) => row.oldPinForm === form).length])),
    pinningFiles: new Set(pinned.flatMap((row) => row.pinnedBy)).size,
    changedRecords: records.filter((row) => row.newSha256 !== row.oldSha256).length,
    byArea,
  };
}

function capture(): void {
  const target = resolve(ROOT, SUPERSESSION_MANIFEST);
  if (existsSync(target)) assert.notEqual(JSON.parse(readFileSync(target, 'utf8')).state, 'finalized', 'Refusing to recapture a finalized manifest');
  const tree = lsTree(PRE_SWAP);
  console.error(`[supersession] scanning tracked evidence at ${PRE_SWAP.slice(0, 8)} for pins...`);
  const { tokens, textFiles, archives } = scanPins(tree);
  const datasetOf = datasetResolver();
  const inputs = regeneratedInputs();
  for (const path of inputs) assert.ok(tree.has(path), `Re-prepared input is not tracked at ${PRE_SWAP}: ${path}`);
  const outputs = [...tree.values()].filter(({ path }) => inScope(path, inputs)).sort((a, b) => a.path < b.path ? -1 : 1);
  const records: OutputRecord[] = [];
  eachBlob(outputs, (entry, bytes) => {
    const blob = describe(bytes);
    const pins = pinsOf(blob, entry.path, tokens);
    records.push({
      path: entry.path, datasetId: datasetOf(entry.path), oldSha256: blob.sha256, oldBytes: blob.bytes, oldGitBlob: entry.oid,
      oldPinForm: pins.form, pinnedBy: pins.by, newSha256: blob.sha256, newBytes: blob.bytes,
    });
  });
  const ledgers: LedgerRecord[] = [];
  const ledgerEntries = LEDGERS.map((path) => {
    const entry = tree.get(path);
    assert.ok(entry, `Ledger is not tracked at ${PRE_SWAP}: ${path}`);
    return entry;
  });
  eachBlob(ledgerEntries, (entry, bytes) => {
    const blob = describe(bytes);
    const archivePath = `${ARCHIVE}/${blob.sha256}.json.gz`;
    const archive = resolve(ROOT, archivePath);
    if (existsSync(archive)) {
      assert.equal(sha(gunzipSync(readFileSync(archive))), blob.sha256, `Archive does not hold its named bytes: ${archivePath}`);
    } else {
      mkdirSync(dirname(archive), { recursive: true });
      writeFileSync(archive, gzipSync(bytes, { level: 9 }));
    }
    const working = readFileSync(resolve(ROOT, entry.path));
    if (!working.equals(bytes) && !working.equals(crlfRendering(bytes))) {
      console.error(`[supersession] warning: working ${entry.path} already differs from ${PRE_SWAP.slice(0, 8)}; the committed bytes were archived`);
    }
    ledgers.push({ path: entry.path, sha256: blob.sha256, bytes: blob.bytes, gitBlob: entry.oid, pinForm: pinsOf(blob, entry.path, tokens).form, archivePath });
  });
  const manifest = {
    schemaVersion: 1,
    record: 'Tracked outputs and ledgers as committed before the corpus-wide R 4.6.0 regeneration (previously R 4.4.1). '
      + 'Sealed checks may read these bytes in place of the regenerated ones only through read_superseded / readSupersededInput.',
    state: 'captured',
    preSwapCommit: PRE_SWAP,
    tag: TAG,
    scope: [...SCOPE.map(([description]) => description), ...(inputs.size ? [`${INPUT_AREA} (${inputs.size})`] : [])],
    pinScan: { excluded: PIN_SCAN_EXCLUDES, textFilesWithPins: textFiles, archivesScanned: archives, distinctTokens: tokens.size },
    totals: totals(records),
    acceptedUnmanaged: [] as string[],
    ledgers,
    records,
  };
  const manifestSha = writeManifest(manifest);
  const summary = manifest.totals;
  console.log(`[supersession] captured ${summary.records} records (${summary.pinnedRecords} pinned by ${summary.pinningFiles} files; `
    + `${summary.oldBytes} old bytes, ${summary.pinnedOldBytes} pinned) and ${ledgers.length} ledgers; manifest ${manifestSha}`);
  for (const [area, counts] of Object.entries(summary.byArea)) console.log(`  ${area}: ${counts.records} records, ${counts.pinned} pinned`);
}

function finalize(accepted: string[]): void {
  const manifest = loadManifest();
  assert.equal(manifest.state, 'captured', 'Only a captured manifest can be finalized');
  assert.equal(manifest.preSwapCommit, PRE_SWAP);
  const kept: OutputRecord[] = [];
  const present = (manifest.records as OutputRecord[]).filter((row) => existsSync(resolve(ROOT, row.path)));
  // The blob git would commit (clean filter by path attributes) and the raw working bytes' blob.
  const hashObjects = (filters: boolean) => git(['hash-object', ...(filters ? [] : ['--no-filters']), '--stdin-paths'],
    present.map((row) => row.path).join('\n')).toString('utf8').trim().split('\n');
  const committed = hashObjects(true), raw = hashObjects(false);
  assert.ok(committed.length === present.length && raw.length === present.length, 'git hash-object returned the wrong count');
  const blobs = new Map(present.map((row, index) => [row.path, { committed: committed[index], raw: raw[index] }]));
  const unstable: string[] = [];
  for (const row of manifest.records as OutputRecord[]) {
    const blob = blobs.get(row.path);
    if (!blob) {
      kept.push({ ...row, newSha256: null, newBytes: null });
      continue;
    }
    if (blob.committed === row.oldGitBlob) continue; // unchanged, or checkout newlines only
    // The recorded bytes must be what a clean checkout reproduces, so git must store them unfiltered.
    if (blob.committed !== blob.raw) unstable.push(row.path);
    const current = readFileSync(resolve(ROOT, row.path));
    kept.push({ ...row, newSha256: sha(current), newBytes: current.length });
  }
  assert.equal(unstable.length, 0, `Changed files git would not commit byte-for-byte (line-ending attributes), so a clean checkout would not reproduce them:\n  ${unstable.join('\n  ')}`);
  // Any other tracked file whose pre-swap bytes are pinned must not change silently.
  const tree = lsTree(PRE_SWAP);
  const managed = new Set([...(manifest.records as OutputRecord[]).map((row) => row.path), ...manifest.ledgers.map((row: LedgerRecord) => row.path)]);
  const changed = git(['diff', '--name-only', '-z', PRE_SWAP]).toString('utf8').split('\0').filter((path) => path && !managed.has(path) && tree.has(path));
  const { tokens } = scanPins(tree);
  const unmanaged: string[] = [];
  eachBlob(changed.map((path) => tree.get(path)!), (entry, bytes) => {
    if (pinsOf(describe(bytes), entry.path, tokens).form) unmanaged.push(entry.path);
  });
  const refused = unmanaged.filter((path) => !accepted.includes(path));
  assert.equal(refused.length, 0, `Changed files whose pre-swap bytes are pinned but not superseded (add them to the scope or pass --accept):\n  ${refused.join('\n  ')}`);
  const final = { ...manifest, state: 'finalized', totals: totals(kept), acceptedUnmanaged: unmanaged.sort(), records: kept };
  const manifestSha = writeManifest(final);
  const py = resolve(ROOT, PY_CONSTANT), ts = resolve(ROOT, TS_CONSTANT);
  const pySource = readFileSync(py, 'utf8'), tsSource = readFileSync(ts, 'utf8');
  const pyPattern = /^SUPERSESSION_SHA = .*$/m, tsPattern = /^export const SUPERSESSION_SHA256: string \| null = .*;$/m;
  assert.ok(pyPattern.test(pySource) && tsPattern.test(tsSource), 'Pinned supersession constants not found');
  writeFileSync(py, pySource.replace(pyPattern, `SUPERSESSION_SHA = '${manifestSha}'`));
  writeFileSync(ts, tsSource.replace(tsPattern, `export const SUPERSESSION_SHA256: string | null = '${manifestSha}';`));
  console.log(`[supersession] finalized ${kept.length} changed records (${final.totals.pinnedRecords} pinned), ${unmanaged.length} accepted unmanaged; manifest ${manifestSha}`);
  console.log(`  pinned in ${PY_CONSTANT} and ${TS_CONSTANT}`);
}

function check(): void {
  const manifest = loadManifest();
  const body = readFileSync(resolve(ROOT, SUPERSESSION_MANIFEST));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.preSwapCommit, PRE_SWAP);
  assert.equal(manifest.tag, TAG);
  const tag = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${TAG}^{commit}`], { cwd: ROOT });
  if (tag.status === 0) assert.equal(tag.stdout.toString().trim(), PRE_SWAP, `${TAG} does not name ${PRE_SWAP}`);
  else console.error(`[supersession] note: tag ${TAG} does not exist yet`);
  const tree = lsTree(PRE_SWAP);
  const records = manifest.records as OutputRecord[];
  const byPath = new Map(records.map((row) => [row.path, row]));
  assert.equal(byPath.size, records.length, 'Duplicate record');
  eachBlob(records.map((row) => {
    const entry = tree.get(row.path);
    assert.ok(entry && entry.oid === row.oldGitBlob, `Record is not the pre-swap blob: ${row.path}`);
    return entry;
  }), (entry, bytes) => {
    const row = byPath.get(entry.path)!;
    assert.ok(sha(bytes) === row.oldSha256 && bytes.length === row.oldBytes, `Recorded old bytes are wrong: ${row.path}`);
  });
  for (const row of manifest.ledgers as LedgerRecord[]) {
    const entry = tree.get(row.path);
    assert.ok(entry && entry.oid === row.gitBlob, `Ledger is not the pre-swap blob: ${row.path}`);
    const archived = gunzipSync(readFileSync(resolve(ROOT, row.archivePath)));
    assert.ok(row.archivePath === `${ARCHIVE}/${row.sha256}.json.gz` && sha(archived) === row.sha256 && archived.length === row.bytes,
      `Archived ledger is wrong: ${row.path}`);
  }
  if (manifest.state === 'finalized') {
    const manifestSha = sha(body);
    assert.ok(readFileSync(resolve(ROOT, PY_CONSTANT), 'utf8').includes(`SUPERSESSION_SHA = '${manifestSha}'`), `${PY_CONSTANT} does not pin the manifest`);
    assert.ok(readFileSync(resolve(ROOT, TS_CONSTANT), 'utf8').includes(`SUPERSESSION_SHA256: string | null = '${manifestSha}'`), `${TS_CONSTANT} does not pin the manifest`);
    for (const row of records) {
      const target = resolve(ROOT, row.path);
      if (row.newSha256 === null) assert.ok(!existsSync(target), `Recorded as removed but present: ${row.path}`);
      else assert.ok(isRecordedCurrentOutput(ROOT, row.path, readFileSync(target), row as { datasetId?: string; newSha256: string; newBytes: number }), `Working tree is not the recorded regeneration or a verified successor: ${row.path}`);
    }
    console.log(`[supersession] finalized manifest ${manifestSha} verified: ${records.length} records, ${manifest.ledgers.length} ledgers`);
  } else {
    assert.equal(manifest.state, 'captured');
    console.log(`[supersession] captured manifest verified: ${records.length} records, ${manifest.ledgers.length} ledgers (not finalized)`);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--capture' && args.length === 1) capture();
else if (args[0] === '--finalize') {
  const accepted: string[] = [];
  for (let index = 1; index < args.length; index += 2) {
    assert.equal(args[index], '--accept', `Unknown argument ${args[index]}`);
    assert.ok(args[index + 1], '--accept needs a path');
    accepted.push(args[index + 1]);
  }
  finalize(accepted);
} else if (args[0] === '--check' && args.length === 1) check();
else throw new Error('Usage: build_supersession_manifest.mts --capture | --finalize [--accept <path>]... | --check');
