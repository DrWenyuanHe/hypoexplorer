// The query index's WIRE FORMAT: the shard counts and the hash that maps a key
// to its shard.
//
// These are part of the URL. The shard for a key is a pure function of the key,
// which is what lets a lookup fetch one file without first fetching a directory
// — and it means the generator (scripts/build_query_index.mts) and the client
// (./queryIndex.ts) must agree exactly. They used to agree by having the same
// code typed out twice under matching "MUST match the other side" comments,
// with golden vectors in the test suite as the only thing actually holding them
// together. The implementation now lives here and both sides import it; the
// golden vectors stay, because sharing the code stops ONE side drifting while
// goldens stop BOTH sides drifting together away from what is already published.
//
// Dependency-free on purpose: the Node build script imports this module, so it
// must not reach for the DOM, the dataset registry, or anything else.
//
// Changing any constant here invalidates every published shard URL.

/** Shards in the per-gene DE family. */
export const GENE_SHARDS = 512;

/** Shards in the per-pathway FGSEA family. */
export const PATHWAY_SHARDS = 256;

/**
 * Shards in the EXPRESSION family — per-sample values for each dataset's
 * default track, which is what the cross-dataset Compare view plots.
 *
 * Deliberately the same count as the gene shards: a gene's stats and its values
 * hash to the same-numbered slice, so a client that wants both makes two
 * predictable requests.
 */
export const EXPR_SHARDS = 512;

/**
 * FNV-1a (32-bit).
 *
 * Chosen for being a handful of lines with no dependencies and identical
 * results in both runtimes. The `>>> 0` after each step is load-bearing: JS
 * bitwise ops yield a signed int32, and without it `Math.imul`'s sign bit would
 * make two implementations diverge for some keys.
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const geneShard = (gene: string): number => fnv1a(gene) % GENE_SHARDS;
export const pathwayShard = (pathway: string): number => fnv1a(pathway) % PATHWAY_SHARDS;
export const exprShard = (gene: string): number => fnv1a(gene) % EXPR_SHARDS;

/** Shard numbers are zero-padded to three digits in every shard filename. */
export const padShard = (n: number): string => String(n).padStart(3, '0');

/**
 * The TRACK-PATHWAYS family: one file per pathway-capable track, named by the
 * track's position in the manifest (meaningful only under its build prefix),
 * holding that track's significant pathways. Path is relative to the build
 * prefix.
 */
export const trackPathwaysFile = (trackIdx: number): string => `trackpaths/t${padShard(trackIdx)}.js`;
export const trackPathwaysGlobal = (trackIdx: number): string => `HX_QUERY_TRACKPATHS_${padShard(trackIdx)}`;
