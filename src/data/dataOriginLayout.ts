// The layout of the data origin (the R2 bucket behind data.hypoexplorer.com).
// THE single definition of which trees it holds, which two objects are mutable
// pointers, what build id each pointer names and how that id is read, which
// prefixes one query generation occupies, and, for any key, how the object is
// stored, cached, purged and admitted by the edge path rule.
//
// Deliberately pure and DOM-free, like bundleBase.ts and queryWire.ts: the app
// (originHealth.ts), vite.config.ts and the Node scripts (uploader, edge rules,
// purge, deploy preparation and verification) all import it, so none of them
// spells a pointer key, a build-id pattern or a cache lifetime of its own.
//
// What this module does NOT own: the query index's file names inside a
// generation (queryWire.ts), the expression index's (expressionIndexFormat.ts),
// the HypoMap release's integrity checks (scripts/lib/hypomapAtlas.mts), and the
// Cloudflare expression syntax the path rule is rendered in (edgeRules.mts).
import release from '../../hypomap-release.json';
import { EXPRESSION_INDEX_POINTER_GLOBAL, expressionIndexGlobal } from '../expression-survey/expressionIndexFormat';
import { MANIFEST_FILE, MANIFEST_GLOBAL } from './queryWire';

// ── Trees ──────────────────────────────────────────────────────────────────
// Object keys mirror the app's request paths without the leading slash:
// `${BUNDLE_BASE}/datasets/<id>/meta.js` is the key `datasets/<id>/meta.js`.

/**
 * The bundle trees: the dataset bundles, the query index and the QC report PDFs.
 * The edge admits them by prefix and extension, so every bundle tree shares one
 * extension list.
 */
export const BUNDLE_TREES = ['datasets', 'query', 'qc'] as const;
/** The extensions the edge admits under a bundle tree, and so the only ones the uploader publishes there. */
export const BUNDLE_EXTENSIONS = ['.js', '.pdf'] as const;
const ORIGIN_TREES = [...BUNDLE_TREES, 'hypomap'] as const;
export type OriginTree = (typeof ORIGIN_TREES)[number];

/** Longest request path the edge admits, in UTF-8 bytes. */
export const MAX_PATH_LENGTH = 256;

// ── HypoMap atlas ──────────────────────────────────────────────────────────
// The pinned release (hypomap-release.json) under `hypomap/<tag>/`: three fixed
// files and gene shards `genes-NNNN.json.gz`. Only the pinned tag is on the
// edge's allow-list; a new tag changes the path rule.

// A tag is interpolated into object keys and a firewall expression; refuse
// anything but a plain release name rather than escape it.
if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(release.tag)) throw new Error(`hypomap-release.json has an invalid tag: ${release.tag}`);

export const HYPOMAP_TAG: string = release.tag;
/** Key prefix of the pinned atlas (no leading slash). Its request path is `/${HYPOMAP_KEY_PREFIX}`. */
export const HYPOMAP_KEY_PREFIX = `hypomap/${HYPOMAP_TAG}/`;
export const HYPOMAP_FIXED_FILES = ['manifest.json', 'metadata.json.gz', 'search-index.json.gz'] as const;
export const HYPOMAP_SHARD_PREFIX = 'genes-';
export const HYPOMAP_SHARD_DIGITS = 4;
export const HYPOMAP_SHARD_SUFFIX = '.json.gz';

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/**
 * The atlas branch of the edge path rule, as request paths: the fixed files by
 * exact path, and a shard as start + suffix + exact byte length. Free-plan
 * rules have no regex, so the edge cannot require the four characters to be
 * digits; hypomapAtlas.mts applies that stricter check before upload.
 */
export const HYPOMAP_PATH_RULE = {
  exactPaths: HYPOMAP_FIXED_FILES.map((file) => `/${HYPOMAP_KEY_PREFIX}${file}`),
  shardStart: `/${HYPOMAP_KEY_PREFIX}${HYPOMAP_SHARD_PREFIX}`,
  shardSuffix: HYPOMAP_SHARD_SUFFIX,
  shardPathLength: byteLength(`/${HYPOMAP_KEY_PREFIX}${HYPOMAP_SHARD_PREFIX}`) + HYPOMAP_SHARD_DIGITS + byteLength(HYPOMAP_SHARD_SUFFIX),
} as const;

// ── Pointers ───────────────────────────────────────────────────────────────
// The only mutable objects on the origin. Each is a classic script assigning
// one global whose `buildId` names an immutable generation; everything else is
// written once under a content-derived key.

export type PointerName = 'tracks' | 'expression';

interface PointerSpec {
  key: string;
  global: string;
  /** The build id's whole format. A pointer naming anything else is not read. */
  buildId: RegExp;
  buildIdFormat: string;
}

export const POINTERS: Readonly<Record<PointerName, PointerSpec>> = {
  // build_query_index.mts: two FNV-style 32-bit hashes in base 36 (2–14
  // characters today); up to 64 lowercase base-36 characters are accepted.
  tracks: { key: `query/${MANIFEST_FILE}`, global: MANIFEST_GLOBAL, buildId: /^[a-z0-9]{1,64}$/, buildIdFormat: '1-64 lowercase base-36 characters' },
  // build_expression_index.mts: the SHA-256 of the index content.
  expression: { key: 'query/expression-manifest.js', global: EXPRESSION_INDEX_POINTER_GLOBAL, buildId: /^[a-f0-9]{64}$/, buildIdFormat: '64 lowercase hex characters' },
};
/** Publication order: the expression pointer after the track pointer. */
export const POINTER_NAMES: readonly PointerName[] = ['tracks', 'expression'];
const POINTER_KEYS: ReadonlySet<string> = new Set(POINTER_NAMES.map((name) => POINTERS[name].key));

export const isPointerKey = (key: string): boolean => POINTER_KEYS.has(key);

/**
 * True for a request to either pointer (any origin, any query string). Kept
 * SELF-CONTAINED on purpose: workbox serializes the service-worker route
 * matcher with toString(), so this body may not refer to anything outside
 * itself. dataOriginLayout.test.ts pins it to POINTERS.
 */
export function isPointerRequest({ url }: { url: URL }): boolean {
  return /(^|\/)query\/(?:tracks|expression-manifest)\.js$/.test(url.pathname);
}

/**
 * Pointer lifetime in seconds, at the edge, in the browser and in the service
 * worker. It bounds how long a client can keep resolving a superseded build.
 */
export const POINTER_MAX_AGE_SECONDS = 300;
const POINTER_CACHE_CONTROL = `public, max-age=${POINTER_MAX_AGE_SECONDS}`;
/** Everything but the pointers: written once under a key that never changes content. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Whether `value` is a build id of the format the pointer declares. */
export function isBuildId(name: PointerName, value: unknown): value is string {
  return typeof value === 'string' && POINTERS[name].buildId.test(value);
}

/** The build id, or a thrown error naming the pointer and its format. THE one build-id rule. */
export function parseBuildId(name: PointerName, value: unknown): string {
  if (!isBuildId(name, value)) {
    throw new Error(`${POINTERS[name].key} names an invalid build id ${JSON.stringify(value) ?? 'undefined'} (expected ${POINTERS[name].buildIdFormat})`);
  }
  return value;
}

export interface Pointer {
  name: PointerName;
  key: string;
  buildId: string;
  /** The parsed payload the pointer assigns. */
  manifest: Record<string, unknown>;
  /** The exact source text, for callers that compare or copy bytes. */
  text: string;
}

/** `var GLOBAL = {...};`, optionally after `//` comment lines: the generators' whole output, with nothing else around it. */
function readAssignment(source: string, global: string, what: string): Record<string, unknown> {
  const match = source.match(new RegExp(`^(?:\\s|//[^\\n]*\\n)*var ${global}\\s*=\\s*(\\{[\\s\\S]*\\})\\s*;\\s*$`));
  if (!match) throw new Error(`${what} is not a single \`var ${global} = {...};\` assignment`);
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]); } catch { throw new Error(`${what} does not hold a JSON object`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${what} does not hold a JSON object`);
  return parsed as Record<string, unknown>;
}

/** Read a pointer's source into its validated build id and payload. Throws on any other shape. */
export function parsePointer(name: PointerName, source: string): Pointer {
  const { key, global } = POINTERS[name];
  const manifest = readAssignment(source, global, key);
  return { name, key, buildId: parseBuildId(name, manifest.buildId), manifest, text: source };
}

// ── Generations ────────────────────────────────────────────────────────────

/** The build ids one publication pins. `tracks` is null for an expression-only publication. */
export interface QueryGeneration {
  tracks: string | null;
  expression: string;
}

/** `query/<tracks build id>/`: every query shard of one build. */
export const trackGenerationPrefix = (buildId: string): string => `query/${parseBuildId('tracks', buildId)}/`;
/** `query/expression/<expression build id>/`: the lossless expression index of one build. */
export const expressionGenerationPrefix = (buildId: string): string => `query/expression/${parseBuildId('expression', buildId)}/`;
/** The immutable copy of the expression pointer inside its generation. */
export const expressionManifestKey = (buildId: string): string => `${expressionGenerationPrefix(buildId)}manifest.js`;

/**
 * The prefixes (ending in `/`) and exact keys a generation occupies: each
 * build's directory and the pointer that names it.
 */
export function generationPrefixes(generation: QueryGeneration): string[] {
  const expression = [expressionGenerationPrefix(generation.expression), POINTERS.expression.key];
  return generation.tracks === null ? expression : [trackGenerationPrefix(generation.tracks), POINTERS.tracks.key, ...expression];
}

export function inGeneration(key: string, generation: QueryGeneration): boolean {
  return generationPrefixes(generation).some((prefix) => (prefix.endsWith('/') ? key.startsWith(prefix) : key === prefix));
}

/** Throws unless the immutable manifest the expression pointer names holds exactly the pointer's payload. */
export function verifyExpressionManifest(pointer: Pointer, immutableSource: string): void {
  const key = expressionManifestKey(pointer.buildId);
  const immutable = readAssignment(immutableSource, expressionIndexGlobal(pointer.buildId, 'manifest'), key);
  if (JSON.stringify(immutable) !== JSON.stringify(pointer.manifest)) throw new Error(`${pointer.key} does not match its immutable manifest ${key}`);
}

// ── Objects ────────────────────────────────────────────────────────────────

/** How the origin holds one key. */
export interface OriginObject {
  /** The key without a leading slash. */
  key: string;
  /** The tree the key sits in, or null outside every tree. */
  tree: OriginTree | null;
  /** True only for the two pointers. */
  mutable: boolean;
  cacheControl: string;
  /** The stored Content-Type: the source file's type, whatever the stored encoding. */
  contentType: string;
  /** Text worth storing brotli-encoded when large enough. */
  compressible: boolean;
  /**
   * The narrowest edge-cache purge prefix that covers the key: one directory per
   * dataset, query build or atlas release, one for the QC pool, the exact key
   * for top-level files such as the pointers.
   */
  purgePrefix: string;
  /** Whether the edge path rule lets a GET of this key through to the origin. */
  wafAllowed: boolean;
}

// Exactly the types the edge admits: .js and .pdf under the bundle trees,
// .json and .json.gz in the atlas. A gzip atlas file is stored as-is with no
// Content-Encoding, so neither the edge nor the browser decodes it before the
// app checks its SHA-256.
const CONTENT_TYPES: Readonly<Record<string, { contentType: string; compressible: boolean }>> = {
  '.js': { contentType: 'application/javascript; charset=utf-8', compressible: true },
  '.json': { contentType: 'application/json; charset=utf-8', compressible: true },
  '.pdf': { contentType: 'application/pdf', compressible: false },
  '.gz': { contentType: 'application/gzip', compressible: false },
};

/** The JavaScript twin of the edge path rule (edgeRules.mts renders the same lists). */
function admitted(path: string): boolean {
  const bundle = BUNDLE_TREES.some((tree) => path.startsWith(`/${tree}/`)) && BUNDLE_EXTENSIONS.some((ext) => path.endsWith(ext));
  const atlas = HYPOMAP_PATH_RULE.exactPaths.includes(path) || (path.startsWith(HYPOMAP_PATH_RULE.shardStart)
    && path.endsWith(HYPOMAP_PATH_RULE.shardSuffix) && byteLength(path) === HYPOMAP_PATH_RULE.shardPathLength);
  return (bundle || atlas) && !path.includes('..') && !path.includes('//') && byteLength(path) <= MAX_PATH_LENGTH;
}

function purgePrefix(key: string): string {
  const parts = key.split('/');
  if (parts[0] === 'qc') return 'qc/';
  if (parts[0] === 'query' && parts[1] === 'expression' && parts.length >= 4) return `${parts.slice(0, 3).join('/')}/`;
  if (parts.length >= 3) return `${parts.slice(0, 2).join('/')}/`;
  return key;
}

/** Everything the origin, the edge and the uploader agree on about one key. A leading `/` (a request path) is accepted. */
export function originObject(keyOrPath: string): OriginObject {
  const path = keyOrPath.startsWith('/') ? keyOrPath : `/${keyOrPath}`;
  const key = path.replace(/^\/+/, '');
  const first = key.split('/')[0];
  const tree = key.includes('/') && (ORIGIN_TREES as readonly string[]).includes(first) ? first as OriginTree : null;
  const mutable = isPointerKey(key);
  const name = key.slice(key.lastIndexOf('/') + 1);
  const type = CONTENT_TYPES[name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''];
  return {
    key, tree, mutable,
    cacheControl: mutable ? POINTER_CACHE_CONTROL : IMMUTABLE_CACHE_CONTROL,
    contentType: type?.contentType ?? 'application/octet-stream',
    compressible: type?.compressible ?? false,
    purgePrefix: purgePrefix(key),
    wafAllowed: admitted(path),
  };
}

/**
 * What the uploader does with a local file at `key`, given the query generation
 * it publishes (null: none). Only `selected` keys are published; `refused` names
 * a file the edge would answer with 403, which the uploader reports instead of
 * publishing. Dotfiles are leftover server config (public/datasets/.htaccess)
 * or local markers, never data.
 */
export type UploadDecision = 'selected' | 'dotfile' | 'refused' | 'other-generation' | 'outside';

export function uploadDecision(key: string, generation: QueryGeneration | null): UploadDecision {
  if (key.split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..')) return 'dotfile';
  const object = originObject(key);
  if (object.tree === null) return 'outside';
  if (object.tree === 'query' && (generation === null || !inGeneration(object.key, generation))) return 'other-generation';
  return object.wafAllowed ? 'selected' : 'refused';
}
