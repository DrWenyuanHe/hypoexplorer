// Read one query generation (both pointers and the immutable expression
// manifest the expression pointer names) from a data origin: a local public/
// directory or the published origin over HTTP. The layout and every validity
// rule come from src/data/dataOriginLayout.ts; this module only fetches.
//
// Used by prepare_deploy.mts (does the checkout hold the generation the origin
// serves?), fetch_query_catalog.mts (copy the origin's generation into public/)
// and upload_bundles_r2.mts (which generation is about to be published?).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  expressionManifestKey, parsePointer, POINTER_NAMES, POINTERS, verifyExpressionManifest, type Pointer, type QueryGeneration,
} from '../../src/data/dataOriginLayout';

/** Where a generation is read from. */
export interface OriginReader {
  /** Prefix for messages: `public` or the origin URL. */
  readonly label: string;
  /** The object's text, or null when the origin does not hold it. Other failures throw. */
  read(key: string): Promise<string | null>;
}

/** A public/ directory (or any directory laid out like the origin). */
export function diskOrigin(root: string, label = 'public'): OriginReader {
  return {
    label,
    read: (key) => readFile(path.join(root, ...key.split('/')), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
  };
}

/** A data origin over HTTP. A 404 is an absent object; any other non-2xx status throws. */
export function httpOrigin(base: string, options: { headers?: Record<string, string>; fetch?: typeof fetch } = {}): OriginReader {
  const origin = base.replace(/\/+$/, '');
  const get = options.fetch ?? fetch;
  return {
    label: origin,
    async read(key) {
      const url = `${origin}/${key}`;
      const response = await get(url, options.headers ? { headers: options.headers } : undefined);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.text();
    },
  };
}

export interface QueryGenerationRead {
  /** Null when the read was asked for the expression side alone. */
  tracks: Pointer | null;
  expression: Pointer;
  /** The immutable manifest the expression pointer names, verified to hold the pointer's payload. */
  expressionManifest: { key: string; text: string };
}

async function required(origin: OriginReader, key: string): Promise<string> {
  const text = await origin.read(key);
  if (text === null) throw new Error(`${origin.label}/${key} is missing`);
  return text;
}

/**
 * Read and validate a generation. Throws, naming the origin and key, on a
 * missing object, a malformed pointer or build id, or an expression pointer
 * that disagrees with its immutable manifest.
 */
export async function readQueryGeneration(origin: OriginReader, options: { tracks?: boolean } = {}): Promise<QueryGenerationRead> {
  const names = options.tracks === false ? (['expression'] as const) : POINTER_NAMES;
  const pointers = new Map(await Promise.all(names.map(async (name) =>
    [name, parsePointer(name, await required(origin, POINTERS[name].key))] as const)));
  const expression = pointers.get('expression')!;
  const key = expressionManifestKey(expression.buildId);
  const text = await required(origin, key);
  verifyExpressionManifest(expression, text);
  return { tracks: pointers.get('tracks') ?? null, expression, expressionManifest: { key, text } };
}

/** The build ids a read pins. */
export function generationOf(read: QueryGenerationRead): QueryGeneration {
  return { tracks: read.tracks?.buildId ?? null, expression: read.expression.buildId };
}

/** Every file of the read as (key, exact text): what a checkout needs to bind to the generation. */
export function generationFiles(read: QueryGenerationRead): Array<{ key: string; text: string }> {
  return [
    ...(read.tracks ? [read.tracks] : []), read.expression, read.expressionManifest,
  ].map(({ key, text }) => ({ key, text }));
}
