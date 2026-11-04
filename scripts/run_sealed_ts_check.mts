/**
 * Run a sealed TypeScript producer in --check mode against the bytes it pins.
 *
 *   npx tsx scripts/run_sealed_ts_check.mts <producer.mts> --check
 *
 * The TypeScript counterpart of scripts/run_historical_check.py. The producer
 * must be listed below with its SHA-256, so it stays byte-identical. The R 4.6.0
 * regeneration replaced outputs and ledgers such producers pin. While the
 * producer runs, every read of exactly those paths returns the verified
 * pre-regeneration bytes: fs.readFileSync, fs.promises.readFile, a file
 * descriptor from fs.openSync (fs.readSync, fs.fstatSync, fs.readFileSync(fd)),
 * and the size reported by fs.statSync, fs.lstatSync and fs.promises.stat/lstat:
 *
 * - an output, only when readSupersededInput proves the current bytes are the
 *   recorded regeneration and the pre-swap git blob is the recorded old one;
 * - a ledger, only when readSupersededLedger proves the rewrite touched nothing
 *   but regenerated datasets and their derived inventory.
 *
 * Module imports follow the same rule (scripts/lib/sealedModuleHooks.mts): a
 * JSON module whose path is superseded is loaded from those verified bytes, and
 * src/data/datasets.ts is loaded with the registry edits the regeneration made
 * reverted, once scripts/lib/registryEdits.mts proves the reverted registry is
 * the recorded pre-swap registry. An allow-listed sealed Python producer that the
 * producer spawns runs through scripts/run_historical_check.py.
 *
 * Every other read, and every check the producer makes, stays current. A file
 * changed during the check is rejected. Until the supersession manifest is
 * finalized and pinned, nothing is served.
 */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { register, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { supersededPaths, supersession } from './lib/historicalEvidence.mjs';
import { REGISTRY_EDITS_SHA256 } from './lib/registryEdits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Producer path -> SHA-256 of its sealed source. */
export const PRODUCERS: Record<string, string> = {
  'data/internal-qc/intake-replication-2026-09-11/registry_snapshot.mts': '6a2897d32c370e7f4f75f1c4191aa820450cef5f2f45f04bd290847d156066ac',
  'data/internal-qc/replication-2026-09-05/remaining-a/validate_fragment.mts': '83e2a252adfaaf63370d9ff239dc07626db4271b6ec9661fee0adf963e6ac193',
  'data/internal-qc/replication-2026-09-05/remaining-b/registry_snapshot.mts': 'af75a5bb6a0cfa36b600cab0a45f3f7b17ab70e1c6d72f515abe80afbdb7e9bc',
  'data/internal-qc/replication-2026-09-05/remaining-b/validate_fragment.mts': 'ec671fa6ab9d2803dba26bd88bc74a747ab588d60404496dd8e97b407ab45b94',
  'data/internal-qc/replication-2026-09-05/round4-c/validate_fragment.mts': 'b9fc063960cf2fa2f2f00c8a504a3010394bce9eb471f543f70bfe1c9a993e78',
  'data/internal-qc/replication-2026-09-05/round5-e/validate_fragment.mts': 'f8f61be38f9abdd568d2e29be2a83ba50baa462d1647229da21e1f740c38ed34',
  'data/internal-qc/source-authenticity-2026-09-05/audit_scoped_sources.mts': '52dde873bc34866fcfb82d957a3c6f44f5789782ed00290ef46cc7bbab107593',
  'data/internal-qc/source-authenticity-2026-09-05/round4/audit_relationships.mts': '17ee65c6b363bc6e5612237bf201341797a17894dc5d90c157a570e8a3997c28',
  'data/internal-qc/source-authenticity-2026-09-05/round5/audit_relationships.mts': '7bec1b7e2d07af6c57036ca7cd5e8b09757ec267e7cb7d753c830e6a80686dba',
  'data/internal-qc/source-authenticity-2026-09-05/round5-keyed/audit_relationship.mts': '9acb225d27faef85cf6a8285043da421707152c2291ff28bc4215a47b804fdda',
  'data/internal-qc/source-recovery-2026-09-11/audit_recovery.mts': 'f06fa646bda4ff17cadcd3c0e19fc1393a3955112f565b4e87bafe8bba6d1b68',
  'data/author-validation/continuation-round2-2026-09-11/original-author/GSE102471/comparison.test.mts': 'd90f0bbfcb5813ba4cbde328df37ce24b82241eb6ab26d1cebf07d3091370d84',
  'scripts/audit_recovered_direction_sources.mts': '755fc10b49fc079457fa4d12115df8f4c58bf680b355a7180e27be11b727b34f',
  'scripts/prepare_author_sources_b.mts': 'cfba3fe3589e4277326a98b7721dc60edff82975d3a68b40feb7b362ce6ca9fc',
  'data/internal-qc/intake-replication-2026-09-11/validate_reader.mts': '46b09ba9677bfab177fa9a69245eedc9406fac25e70395f4e76c116c3acc8181',
  'scripts/audit_replication_evidence.mts': '0131d139067e12bde801598f5003529dadaf50a0cb3b3bb071477587bdbcfce0',
  // Superseded by scripts/audit_macaque_internal_qc_r460.mts; checks the September 5 atlas evidence.
  'scripts/audit_macaque_internal_qc.mts': 'ad5a7fed9e77489baa957265b86911a4526a2d81b63dd78d4ddb900af9cc91d7',
  // Source relationships of the replaced inputs; their successors are in
  // data/internal-qc/advancement-r460-2026-09-25/source-relationship-evidence.json.
  'data/internal-qc/source-authenticity-2026-09-05/round2/audit_round2.mts': '55a2b77da9d18617b107900f43ef2ba9e59bfd571cbb266901036e263ba5e366',
  'data/internal-qc/intake-numeric-2026-09-11/validate_reader.mts': 'd7cf938af7f73c264fdc7a14c328f7c7c8a389c81d1707645226df6705fb7fd4',
  'data/internal-qc/conservation-round2-2026-09-11/check.mts': '956a3e0d1d8a437841d1052c56db8db7d24c7fa362453f9e3cae4b5916663307',
  // Round-2 node:test suites pinned by their independent reviews; they read the replaced
  // GSE282067/GSE236077 raw inputs and the GSE262407 sample sheet. Run with --check like
  // GSE102471/comparison.test.mts: importing the file runs its tests under the projection.
  'data/internal-qc/conservation-round2-2026-09-11/conservation.test.mts': '47e93a52ef2b5642c67474326d1a93a85f79b20769aa2065d8d43669a558290a',
  'data/internal-qc/replication-round2-2026-09-11/glucoseReplication.test.mts': '222548ac636d23e0bd58b654855c706d1ae416f53b6e96f3ea276518d8c28d09',
  // Imports the internal-QC and author ledgers as modules and the registry.
  'data/quality/pipeline-separation-2026-09-11/audit.mts': '3abd8bacb80796b5e456e4e8069ee71e188745835629c36ef2c437bafab6e980',
  // Spawns round4-d/build_fragment.py (SEALED_CHILDREN).
  'data/internal-qc/replication-2026-09-05/round4-d/verify_fragment.mts': 'dc93f0b0f0de86a4be57319ea3aec88dee8a90b24ac03b9317cddb0851765f7c',
};

/**
 * Sealed Python producers a sealed TypeScript producer spawns as `<python> <producer> --check`.
 * The command is run through the named runner, which pins the producer's SHA-256
 * and applies its own verified projections.
 */
export const SEALED_CHILDREN: Record<string, string> = {
  'data/internal-qc/replication-2026-09-05/round4-d/build_fragment.py': 'scripts/run_historical_check.py',
};

const key = (file: string) => {
  const absolute = resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};
const toPath = (file: unknown): string | null => {
  if (typeof file === 'string') return file;
  if (file instanceof URL) return file.protocol === 'file:' ? fileURLToPath(file) : null;
  if (Buffer.isBuffer(file)) return file.toString('utf8');
  return null;
};
const decode = (bytes: Buffer, options: unknown): Buffer | string => {
  const encoding = (typeof options === 'string' ? options : (options as { encoding?: string } | undefined)?.encoding) as BufferEncoding | undefined;
  return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
};

/**
 * Patch fs so reads of superseded paths return verified pre-regeneration bytes:
 * whole-file reads, reads through a file descriptor, and reported sizes. `observe`
 * is called with each superseded path as it is first served.
 * Returns a function that restores fs.
 */
export function projectSuperseded(root: string, manifestSha?: string | null, observe?: (name: string) => void): () => void {
  const options = manifestSha === undefined ? {} : { manifestSha };
  const actual = {
    readFileSync: fs.readFileSync, readFile: fs.promises.readFile, statSync: fs.statSync, lstatSync: fs.lstatSync,
    fstatSync: fs.fstatSync, openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync,
    stat: fs.promises.stat, lstat: fs.promises.lstat,
  };
  const read = (file: string) => actual.readFileSync(file) as Buffer;
  const names = supersededPaths(root, { ...options, read });
  if (!names.size) return () => {};
  const state = supersession(root, { ...options, read });
  const targets = new Map([...names].map((name) => [key(resolve(root, name)), name]));
  const views = new Map<string, { bytes: Buffer; size: number; mtimeNs: bigint }>();
  const nameOf = (file: unknown): string | undefined => {
    const path = toPath(file);
    return path === null ? undefined : targets.get(key(path));
  };

  const view = (file: unknown): Buffer | null => {
    const name = nameOf(file);
    if (name === undefined) return null;
    const stat = actual.statSync.call(fs, resolve(root, name), { bigint: true }) as fs.BigIntStats;
    const seen = views.get(name);
    if (seen) {
      assert.ok(stat.size === BigInt(seen.size) && stat.mtimeNs === seen.mtimeNs, `Superseded input changed during historical check: ${name}`);
      return seen.bytes;
    }
    const current = read(resolve(root, name));
    const bytes = state.records.has(name) ? state.readOutput(name, state.servedPin(name), current) : state.ledger(name, current);
    views.set(name, { bytes, size: current.length, mtimeNs: stat.mtimeNs });
    observe?.(name);
    return bytes;
  };
  // A copy of the current stats that reports the size of the served bytes.
  const sized = <T extends fs.Stats | fs.BigIntStats | undefined>(stats: T, bytes: Buffer | null): T => {
    if (!stats || bytes === null) return stats;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats);
    copy.size = typeof stats.size === 'bigint' ? BigInt(bytes.length) : bytes.length;
    return copy;
  };

  // Node's own fs functions call the exported ones (readFileSync calls fs.openSync),
  // so everything the projection itself calls runs unprojected.
  let inside = 0;
  const guarded = <F extends (...args: any[]) => any>(body: F, passthrough: (...args: any[]) => any): F => function (this: unknown, ...args: any[]) {
    if (inside) return passthrough.apply(fs, args);
    inside++;
    try { return body.apply(this, args); } finally { inside--; }
  } as F;
  const unprojected = <T,>(body: () => T): T => {
    inside++;
    try { return body(); } finally { inside--; }
  };

  // Descriptors opened read-only on a superseded path read the served bytes.
  const descriptors = new Map<number, { bytes: Buffer; position: number }>();
  const readOnly = (flags: unknown) => flags === undefined || flags === null || flags === 'r' || flags === 'rs' || flags === 'sr'
    || flags === fs.constants.O_RDONLY;
  const openSync = guarded((file: any, flags?: any, mode?: any) => {
    if (!readOnly(flags) || nameOf(file) === undefined) return actual.openSync.call(fs, file, flags, mode);
    const bytes = view(file)!;
    const descriptor = actual.openSync.call(fs, file, flags, mode);
    descriptors.set(descriptor, { bytes, position: 0 });
    return descriptor;
  }, actual.openSync) as typeof fs.openSync;
  const readSync = guarded((descriptor: number, buffer: NodeJS.ArrayBufferView, ...rest: any[]) => {
    const entry = descriptors.get(descriptor);
    if (!entry) return (actual.readSync as any).call(fs, descriptor, buffer, ...rest);
    const [first, second, third] = rest;
    const request = first !== null && typeof first === 'object' ? first : { offset: first, length: second, position: third };
    const offset = Number(request.offset ?? 0);
    const length = Number(request.length ?? buffer.byteLength - offset);
    const position = request.position === undefined || request.position === null || Number(request.position) === -1
      ? null : Number(request.position);
    const start = position ?? entry.position;
    const count = Math.max(0, Math.min(length, entry.bytes.length - start));
    entry.bytes.copy(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength), offset, start, start + count);
    if (position === null) entry.position = start + count;
    return count;
  }, actual.readSync) as typeof fs.readSync;
  const fstatSync = guarded((descriptor: number, opts?: any) => sized(actual.fstatSync.call(fs, descriptor, opts), descriptors.get(descriptor)?.bytes ?? null), actual.fstatSync) as typeof fs.fstatSync;
  const closeSync = guarded((descriptor: number) => {
    descriptors.delete(descriptor);
    return actual.closeSync.call(fs, descriptor);
  }, actual.closeSync) as typeof fs.closeSync;
  const statSync = guarded((file: any, opts?: any) => {
    const stats = actual.statSync.call(fs, file, opts);
    return stats === undefined ? stats : sized(stats, view(file));
  }, actual.statSync) as typeof fs.statSync;
  const lstatSync = guarded((file: any, opts?: any) => {
    const stats = actual.lstatSync.call(fs, file, opts);
    return stats === undefined ? stats : sized(stats, view(file));
  }, actual.lstatSync) as typeof fs.lstatSync;
  const stat = (async (file: any, opts?: any) => {
    const stats = await actual.stat.call(fs.promises, file, opts);
    return sized(stats, unprojected(() => view(file)));
  }) as typeof fs.promises.stat;
  const lstat = (async (file: any, opts?: any) => {
    const stats = await actual.lstat.call(fs.promises, file, opts);
    return sized(stats, unprojected(() => view(file)));
  }) as typeof fs.promises.lstat;

  const readFileSync = guarded((file: any, options?: any) => {
    if (typeof file === 'number' && descriptors.has(file)) {
      const entry = descriptors.get(file)!;
      const rest = entry.bytes.subarray(entry.position);
      entry.position = entry.bytes.length;
      return decode(rest, options);
    }
    const bytes = view(file);
    return bytes === null ? actual.readFileSync.call(fs, file, options) : decode(bytes, options);
  }, actual.readFileSync) as typeof fs.readFileSync;
  const readFile = (async (file: any, options?: any) => {
    const bytes = unprojected(() => view(file));
    return bytes === null ? actual.readFile.call(fs.promises, file, options) : decode(bytes, options);
  }) as typeof fs.promises.readFile;
  Object.assign(fs, { readFileSync, statSync, lstatSync, fstatSync, openSync, readSync, closeSync });
  Object.assign(fs.promises, { readFile, stat, lstat });
  syncBuiltinESMExports();
  return () => {
    const { readFile: _readFile, stat: _stat, lstat: _lstat, ...sync } = actual;
    Object.assign(fs, sync);
    Object.assign(fs.promises, { readFile: _readFile, stat: _stat, lstat: _lstat });
    syncBuiltinESMExports();
  };
}

/** The arguments of `<python> <sealed producer> --check` routed through its pinned runner; any other arguments unchanged. */
export function routeSealedChild(root: string, args: unknown): unknown {
  if (!Array.isArray(args) || args.length !== 2 || args[1] !== '--check' || typeof args[0] !== 'string') return args;
  const name = relative(root, resolve(root, args[0])).replaceAll('\\', '/');
  return Object.hasOwn(SEALED_CHILDREN, name) ? [resolve(root, SEALED_CHILDREN[name]), name, '--check'] : args;
}

/** Route `<python> <sealed producer> --check` through its pinned runner (SEALED_CHILDREN). */
export function projectSealedChildren(root: string): () => void {
  const actual = { execFileSync: childProcess.execFileSync, spawnSync: childProcess.spawnSync };
  const route = (args: unknown): unknown => routeSealedChild(root, args);
  const execFileSync = ((file: any, args?: any, ...rest: any[]) => (actual.execFileSync as any).call(childProcess, file, route(args), ...rest)) as typeof childProcess.execFileSync;
  const spawnSync = ((file: any, args?: any, ...rest: any[]) => (actual.spawnSync as any).call(childProcess, file, route(args), ...rest)) as typeof childProcess.spawnSync;
  Object.assign(childProcess, { execFileSync, spawnSync });
  syncBuiltinESMExports();
  return () => {
    Object.assign(childProcess, actual);
    syncBuiltinESMExports();
  };
}

/**
 * Load superseded JSON modules from their verified pre-regeneration bytes, and the
 * registry with the recorded regeneration edits reverted (scripts/lib/sealedModuleHooks.mts).
 * Loader hooks stay registered for the life of the process.
 */
export function projectSupersededModules(root: string, manifestSha?: string | null, registryEditsSha: string | null = REGISTRY_EDITS_SHA256): void {
  const folder = fs.mkdtempSync(resolve(tmpdir(), 'sealed-modules-'));
  process.once('exit', () => fs.rmSync(folder, { recursive: true, force: true }));
  register(pathToFileURL(resolve(ROOT, 'scripts/lib/sealedModuleHooks.mts')).href, import.meta.url, {
    data: { root: resolve(root), folder, manifestSha, registryEditsSha },
  });
}

export async function main(args: string[]): Promise<void> {
  assert.ok(args.length === 2 && args[1] === '--check', 'Only a sealed producer with --check is allowed');
  const relative = args[0].replaceAll('\\', '/');
  assert.ok(Object.hasOwn(PRODUCERS, relative), 'Producer is outside the sealed TypeScript scope');
  const producer = resolve(ROOT, relative);
  assert.equal(createHash('sha256').update(fs.readFileSync(producer)).digest('hex'), PRODUCERS[relative], 'Historical producer changed');
  projectSupersededModules(ROOT);
  const restore = projectSuperseded(ROOT);
  const restoreChildren = projectSealedChildren(ROOT);
  const previousArgv = process.argv;
  process.argv = [process.argv[0], producer, '--check'];
  try {
    await import(pathToFileURL(producer).href);
  } finally {
    process.argv = previousArgv;
    // Asynchronous work the producer leaves behind still reads through the projection.
    process.once('beforeExit', () => { restore(); restoreChildren(); });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
