// The query index's READ of the corpus (scripts/build_query_index.mts).
//
// Every byte comes through the bundle-reader seam (./bundleReader.mts): the
// registry decides which directories are studies (`listDiskCorpus`), the
// shared locators name every file and window global, and `readJsonp` parses
// without evaluating and refuses a bundle that assigns another global. What
// stays here is the index's POLICY for a bundle it cannot use, decided once on
// `BundleReadError.reason` instead of a parser that turned every failure into
// a silent null:
//
//   missing       skip the track (or dataset). Skips count against the
//                 builder's no-partial-index guard, so they are fatal unless
//                 --allow-partial is passed.
//   malformed     skip, naming the defect. A payload that parses but is not a
//                 track (DE rows, cpm or sample lists of the wrong shape) is
//                 malformed too.
//   wrong-global  THROW, regardless of --allow-partial. The folder holds
//                 another study's bytes; indexing around it would publish the
//                 misplaced file with an index that hides it.
//
// A pathway sibling is optional, so an absent one is no pathway analysis. A
// present-but-broken one used to be read as absent, indexing the track as if
// it had no pathways at all; it now skips the track, so a track is indexed
// whole or not at all.
//
// The read is raw (layer 1 of the reader): no reviewed display correction. The
// manifest carries the published labels and the client applies the reviewed
// corrections itself (src/data/queryIndex.ts), so the index bytes stay a
// function of the published bundles.

import { statSync } from 'node:fs';
import type { Dataset, DatasetMeta, GeneDERecord, PathwaySibling, RawTrack } from '../../src/types';
import {
  BundleReadError,
  listDiskCorpus,
  readJsonp,
  readOptionalJsonp,
  type CorpusDataset,
  type DatasetBundlePaths,
  type DiskCorpusOptions,
} from './bundleReader.mjs';

/** A skipped dataset or track: the guard's list entry and the line to warn with. */
export interface QueryCorpusSkip {
  /** `ds (reason)` or `ds/track (reason)`, as the partial-index refusal lists it. */
  entry: string;
  warning: string;
}

/** One declared track the index can read, with its pathway sibling. */
export interface QueryCorpusTrack {
  trackId: string;
  raw: RawTrack;
  /** The track bundle's size on disk (reported, never indexed). */
  bytes: number;
  /** The pathway sibling as published; null when the track has none. */
  pathways: PathwaySibling | null;
}

/** One dataset whose meta.js the index can read. */
export interface QueryCorpusDataset {
  dataset: Dataset;
  /** meta.js as published (no reviewed display correction). */
  meta: DatasetMeta;
  /** Its readable declared tracks, one at a time, in meta.populations order. */
  tracks(): Generator<QueryCorpusTrack>;
}

export type TrackRead = { raw: RawTrack; bytes: number } | { skip: string };

export interface QueryCorpus {
  /** Registered datasets with a bundle directory, in the index's emit order. */
  datasets: readonly CorpusDataset[];
  /** Directories under datasets/ that the registry does not name. Not indexed. */
  unregistered: readonly string[];
  /** Registered datasets with no bundle directory. Not indexed. */
  absent: readonly Dataset[];
  /**
   * Every dataset whose meta.js is readable, in emit order. Each unreadable
   * dataset, and each unreadable track while its `tracks` are iterated, goes
   * to `onSkip`.
   */
  read(onSkip: (skip: QueryCorpusSkip) => void): Generator<QueryCorpusDataset>;
  /** Re-open one declared track by dataset id, under the same policy. */
  track(datasetId: string, trackId: string): TrackRead;
}

/**
 * The index's decision on a bundle it could not read: the skip reason for a
 * missing or malformed bundle. Throws for a wrong-global bundle and for any
 * error that is not a BundleReadError.
 */
export function indexSkipReason(error: unknown): string {
  if (!(error instanceof BundleReadError)) throw error;
  switch (error.reason) {
    case 'missing':
      return 'bundle missing';
    case 'malformed':
      return `bundle malformed: ${error.detail}`;
    case 'wrong-global':
      throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDeRow(value: unknown): value is GeneDERecord {
  if (!isRecord(value)) return false;
  return typeof value.gene === 'string'
    && typeof value.logFC === 'number'
    && typeof value.PValue === 'number'
    && (typeof value.FDR === 'number' || value.FDR === null)
    && (value.se === undefined || typeof value.se === 'number' || value.se === null);
}

/** The shape the index reads from a track bundle; anything else is malformed. */
export function isRawTrack(value: unknown): value is RawTrack {
  if (!isRecord(value)) return false;
  if (value.de !== undefined && (!Array.isArray(value.de) || !value.de.every(isDeRow))) return false;
  if (value.deByContrast !== undefined) {
    if (!isRecord(value.deByContrast)
      || !Object.values(value.deByContrast).every((rows) => Array.isArray(rows) && rows.every(isDeRow))) return false;
  }
  if (value.cpm !== undefined) {
    if (!isRecord(value.cpm) || !Object.values(value.cpm).every((values) => Array.isArray(values)
      && values.every((cell) => typeof cell === 'number' || cell === null))) return false;
  }
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) return false;
    for (const field of ['sampleOrder', 'sampleNames', 'normalSamples', 'obeseSamples'] as const) {
      if (value.meta[field] !== undefined && !isStringArray(value.meta[field])) return false;
    }
    if (value.meta.groupSamples !== undefined) {
      if (!isRecord(value.meta.groupSamples)
        || !Object.values(value.meta.groupSamples).every(isStringArray)) return false;
    }
  }
  return true;
}

function readTrack(paths: DatasetBundlePaths, trackId: string): TrackRead {
  const bundle = paths.track(trackId);
  let parsed: unknown;
  try {
    parsed = readJsonp<unknown>(bundle.file, bundle.global);
  } catch (error) {
    return { skip: indexSkipReason(error) };
  }
  if (!isRawTrack(parsed)) return { skip: 'bundle malformed: not a track bundle (DE rows, cpm or sample lists have the wrong shape)' };
  return { raw: parsed, bytes: statSync(bundle.file).size };
}

function readMeta(paths: DatasetBundlePaths): { meta: DatasetMeta } | { skip: string } {
  let meta: DatasetMeta;
  try {
    meta = readJsonp<DatasetMeta>(paths.meta.file, paths.meta.global);
  } catch (error) {
    return { skip: `meta.js ${indexSkipReason(error).replace(/^bundle /, '')}` };
  }
  if (!isRecord(meta) || !Array.isArray(meta.populations) || meta.populations.length === 0) {
    return { skip: 'meta.js declares no populations' };
  }
  return { meta };
}

/** Open the corpus under public/ for the query index. Reads no bundle until iterated. */
export function openQueryCorpus(opts: DiskCorpusOptions = {}): QueryCorpus {
  const disk = listDiskCorpus(opts);
  const byId = new Map(disk.datasets.map((entry) => [entry.dataset.id, entry]));

  function* tracksOf(ds: string, paths: DatasetBundlePaths, meta: DatasetMeta,
    onSkip: (skip: QueryCorpusSkip) => void): Generator<QueryCorpusTrack> {
    for (const trackId of meta.populations) {
      const read = readTrack(paths, trackId);
      if ('skip' in read) {
        onSkip({ entry: `${ds}/${trackId} (${read.skip})`, warning: `${ds}/${trackId}: track ${read.skip}` });
        continue;
      }
      const sibling = paths.pathways(trackId);
      let pathways: PathwaySibling | null;
      try {
        pathways = readOptionalJsonp<PathwaySibling>(sibling.file, sibling.global);
      } catch (error) {
        const reason = `pathway sibling ${indexSkipReason(error).replace(/^bundle /, '')}`;
        onSkip({ entry: `${ds}/${trackId} (${reason})`, warning: `${ds}/${trackId}: ${reason}` });
        continue;
      }
      yield { trackId, raw: read.raw, bytes: read.bytes, pathways };
    }
  }

  function* read(onSkip: (skip: QueryCorpusSkip) => void): Generator<QueryCorpusDataset> {
    for (const { dataset, paths } of disk.datasets) {
      const ds = dataset.id;
      const opened = readMeta(paths);
      if ('skip' in opened) {
        onSkip({ entry: `${ds} (${opened.skip})`, warning: `${ds}: ${opened.skip}` });
        continue;
      }
      const { meta } = opened;
      yield { dataset, meta, tracks: () => tracksOf(ds, paths, meta, onSkip) };
    }
  }

  function track(datasetId: string, trackId: string): TrackRead {
    const entry = byId.get(datasetId);
    if (!entry) return { skip: 'dataset is not in the corpus' };
    return readTrack(entry.paths, trackId);
  }

  return { datasets: disk.datasets, unregistered: disk.unregistered, absent: disk.absent, read, track };
}
