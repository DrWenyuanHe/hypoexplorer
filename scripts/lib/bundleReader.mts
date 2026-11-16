// The READ side of the bundle naming convention: the Node twin of the browser's
// bundle loaders, and the read twin of ./bundleWriter.mts.
//
// Two layers, deliberately separate:
//
//   1. Bytes → value. `readJsonp(file, expectedGlobal)` parses one JSONP bundle
//      WITHOUT evaluating it and refuses a file that assigns any other global
//      than the one its locator names (a bundle copied into the wrong folder is
//      otherwise read as the wrong study). `datasetBundlePaths` maps every
//      bundle of a registry `Dataset` onto public/ through the same locators the
//      browser and the writer use, so no script hand-spells `track_<id>.js`.
//      Producers that round-trip published bytes (refresh, audits) use only
//      this layer: it applies no display rule.
//
//   2. Disk → what the browser shows. `readDatasetFromDisk(dataset)` returns
//      the dataset as the explorer resolves it: reviewed display corrections
//      applied to the metadata (as loadDatasetMeta does), the registry's
//      expression unit winning over the bundle's, the one low-power rule, and
//      the STRICT contrast rules the query index uses for DE tables and
//      pathway siblings. A script that publishes what the site shows (the
//      agent export) reads through this layer and restates none of those rules.

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  resolvePathwayGlobalKey,
  resolvePathwayIndexGlobalKey,
  resolvePathwayIndexUrl,
  resolvePathwayUrl,
  resolveTimeSeriesGlobalKey,
  resolveTimeSeriesUrl,
  resolveTrackGlobalKey,
  resolveTrackUrl,
  sameOriginDataset,
} from '../../src/data/bundleLocators';
import { getActiveContrast } from '../../src/data/contrasts';
import { trackLabel } from '../../src/data/datasetMeta';
import { resolveExpressionUnit } from '../../src/data/expressionUnits';
import {
  groupSamplesOf,
  strictDeTableFor,
  strictSiblingPathwaysFor,
  type StrictSiblingSource,
} from '../../src/data/rawTrack';
import { reviewedMetadata } from '../../src/data/reviewedTrackLabels';
import { isLowPower } from '../../src/utils/qcFlags';
import type {
  Dataset,
  DatasetMeta,
  GeneDERecord,
  PathwayDatabase,
  PathwaySibling,
  QCFlags,
  QcGlobal,
  RawTrack,
  TimeSeriesBundle,
} from '../../src/types';
import { DEFAULT_OUT_ROOT, localDatasetFile } from './bundleWriter.mjs';

export type BundleReadFailure = 'missing' | 'malformed' | 'wrong-global';

/**
 * A bundle that could not be read. The message names the file; `reason` and
 * `detail` (the message without the file) let checkers word the failure.
 */
export class BundleReadError extends Error {
  constructor(readonly file: string, readonly reason: BundleReadFailure, readonly detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'BundleReadError';
  }
}

// A bundle is optional leading `//` or `/* */` comments (the macaque
// generator's header), then `var NAME =` or `window.NAME =`. Everything after
// `=` must be one JSON value, optionally followed by `;` and whitespace — no
// slicing to the first brace. Comments are skipped by a linear scan rather
// than a repeated regex group, which could backtrack exponentially.
const ASSIGNMENT = /(?:var\s+|window\.)([A-Za-z_$][\w$]*)\s*=/y;

/** Index of the first character after any leading BOM, whitespace and comments; -1 for an unclosed block comment. */
function afterLeadingComments(source: string): number {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (at < source.length && /\s/.test(source[at])) at++;
    if (source.startsWith('//', at)) {
      const newline = source.indexOf('\n', at);
      at = newline < 0 ? source.length : newline + 1;
    } else if (source.startsWith('/*', at)) {
      const close = source.indexOf('*/', at + 2);
      if (close < 0) return -1;
      at = close + 2;
    } else {
      return at;
    }
  }
}

/** Parse JSONP source text that must assign `expectedGlobal`. `file` only labels errors. */
export function parseJsonp<T>(source: string, expectedGlobal: string, file = '(bundle)'): T {
  const start = afterLeadingComments(source);
  ASSIGNMENT.lastIndex = Math.max(start, 0);
  const head = start < 0 ? null : ASSIGNMENT.exec(source);
  if (!head) throw new BundleReadError(file, 'malformed', 'is not a `var NAME = <json>;` bundle');
  if (head[1] !== expectedGlobal) {
    throw new BundleReadError(file, 'wrong-global', `assigns ${head[1]}; expected ${expectedGlobal}`);
  }
  let payload = source.slice(ASSIGNMENT.lastIndex).trimEnd();
  if (payload.endsWith(';')) payload = payload.slice(0, -1);
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new BundleReadError(
      file, 'malformed', `payload is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/** Read a required JSONP bundle that must assign `expectedGlobal`. */
export function readJsonp<T>(file: string, expectedGlobal: string): T {
  if (!existsSync(file)) throw new BundleReadError(file, 'missing', 'is missing');
  return parseJsonp<T>(readFileSync(file, 'utf8'), expectedGlobal, file);
}

/** Like readJsonp, but an ABSENT file is null. A present-but-broken file still throws. */
export function readOptionalJsonp<T>(file: string, expectedGlobal: string): T | null {
  return existsSync(file) ? parseJsonp<T>(readFileSync(file, 'utf8'), expectedGlobal, file) : null;
}

// ── Locators → files ─────────────────────────────────────────────────────────

/** One bundle on disk: its file and the window global it must assign. */
export interface DiskBundle {
  file: string;
  global: string;
}

export interface DatasetBundlePaths {
  /** The dataset's bundle directory (the folder holding meta.js). */
  dir: string;
  meta: DiskBundle;
  qc: DiskBundle;
  pathwayIndex: DiskBundle;
  track(trackId: string): DiskBundle;
  pathways(trackId: string): DiskBundle;
  timeSeries(trackId: string): DiskBundle;
}

export interface DiskReadOptions {
  /** Root standing in for public/. Defaults to this repository's public/. */
  publicRoot?: string;
}

/** Every bundle of `dataset` under public/, named by the shared locators. */
export function datasetBundlePaths(dataset: Dataset, opts: DiskReadOptions = {}): DatasetBundlePaths {
  const root = opts.publicRoot ?? DEFAULT_OUT_ROOT;
  const located = sameOriginDataset(dataset);
  const at = (url: string, global: string): DiskBundle => ({ file: localDatasetFile(root, url), global });
  const meta = at(located.metaFile, dataset.metaGlobalKey);
  return {
    dir: dirname(meta.file),
    meta,
    qc: at(located.qcFile, dataset.qcGlobalKey),
    pathwayIndex: at(resolvePathwayIndexUrl(located), resolvePathwayIndexGlobalKey(dataset)),
    track: (trackId) => at(resolveTrackUrl(located, trackId), resolveTrackGlobalKey(dataset, trackId)),
    pathways: (trackId) => at(resolvePathwayUrl(located, trackId), resolvePathwayGlobalKey(dataset, trackId)),
    timeSeries: (trackId) => at(resolveTimeSeriesUrl(located, trackId), resolveTimeSeriesGlobalKey(dataset, trackId)),
  };
}

// ── Disk → what the browser shows ────────────────────────────────────────────

export interface ResolvedPathways {
  db: PathwayDatabase | null;
  source: StrictSiblingSource;
}

/** One declared track, read once, with the browser's display rules applied. */
export interface DiskTrack {
  id: string;
  raw: RawTrack;
  /** The label the explorer shows (reviewed corrections applied; bare id when unlabelled). */
  label: string;
  /** The registry's unit when it states one, else the bundle's, else CPM (TMM-normalized). */
  expressionUnit: string;
  qcFlags: QCFlags | null;
  lowPower: boolean;
  /** Per-arm sample ids (legacy normal/obese pair folded in); null when the track declares none. */
  groupSamples: Record<string, string[]> | null;
  /** The STRICT DE table for a contrast: legacy `de` serves only the registered default. */
  deFor(contrastId: string): GeneDERecord[];
  /** The STRICT pathway block for a contrast from the sibling bundle (read on first use). */
  pathwaysFor(contrastId: string): ResolvedPathways;
}

export interface DiskDataset {
  dataset: Dataset;
  paths: DatasetBundlePaths;
  /** Dataset metadata as loadDatasetMeta resolves it (reviewed corrections applied). */
  meta: DatasetMeta;
  qc(): QcGlobal;
  /** Read a track meta.populations declares; throws for an undeclared one. Not cached. */
  track(trackId: string): DiskTrack;
  /** A declared track's time course, or null when it has none on disk. Reads no track bundle. */
  timeSeries(trackId: string): TimeSeriesBundle | null;
}

/**
 * Open `dataset`'s published bundles as the browser sees them. Reads meta.js
 * now (it must declare at least one track); QC, tracks, pathway siblings and
 * time courses are read on demand, so a whole-corpus sweep holds one track at
 * a time.
 */
export function readDatasetFromDisk(dataset: Dataset, opts: DiskReadOptions = {}): DiskDataset {
  const paths = datasetBundlePaths(dataset, opts);
  const meta = reviewedMetadata(dataset.id, readJsonp<DatasetMeta>(paths.meta.file, paths.meta.global));
  if (!Array.isArray(meta.populations) || meta.populations.length === 0) {
    throw new BundleReadError(paths.meta.file, 'malformed', 'declares no tracks (meta.populations is empty)');
  }
  const declared = new Set(meta.populations);
  const registeredDefaultId = getActiveContrast(dataset)?.id;

  function requireDeclared(trackId: string): void {
    if (!declared.has(trackId)) throw new Error(`${dataset.id}: track "${trackId}" is not declared by meta.populations`);
  }

  function track(trackId: string): DiskTrack {
    requireDeclared(trackId);
    const bundle = paths.track(trackId);
    const raw = readJsonp<RawTrack>(bundle.file, bundle.global);
    const qcFlags = meta.qcFlags?.[trackId] ?? null;
    let sibling: PathwaySibling | null | undefined;
    return {
      id: trackId,
      raw,
      label: trackLabel(meta, trackId),
      expressionUnit: resolveExpressionUnit(dataset, raw),
      qcFlags,
      lowPower: isLowPower(qcFlags),
      groupSamples: groupSamplesOf(raw),
      deFor: (contrastId) => strictDeTableFor(raw, contrastId, registeredDefaultId),
      pathwaysFor(contrastId) {
        if (sibling === undefined) {
          const file = paths.pathways(trackId);
          sibling = readOptionalJsonp<PathwaySibling>(file.file, file.global);
        }
        return strictSiblingPathwaysFor(sibling, contrastId, registeredDefaultId);
      },
    };
  }

  return {
    dataset,
    paths,
    meta,
    qc: () => readJsonp<QcGlobal>(paths.qc.file, paths.qc.global),
    track,
    timeSeries(trackId) {
      requireDeclared(trackId);
      const file = paths.timeSeries(trackId);
      return readOptionalJsonp<TimeSeriesBundle>(file.file, file.global);
    },
  };
}
