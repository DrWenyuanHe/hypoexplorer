// The WRITE side of the bundle naming convention. Builders compose payloads;
// this module owns filenames, global keys, wire slimming, pathway sibling shape,
// and the pathway-name union. All names come from the same Dataset value and
// bundle locators that readers use.
//
// Deliberate limitation: like the builders it replaces, this writer does not
// delete stale files. An in-place rebuild after a default-track/pathway change
// can therefore strand obsolete siblings; detecting those is an offline-checker
// concern, not part of this byte-preserving refactor.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { getDataset } from '../../src/data/datasets';
import type {
  CpmMatrix,
  Dataset,
  GeneDERecord,
  PathwayDatabase,
  TimeSeriesBundle,
  TrackMeta,
  TrackQC,
} from '../../src/types';
import { slimPathwayBlock, slimTrackObject } from './bundleSlim.mjs';

/** Builder-side DE rows before bundleSlim removes null logCPM and private ids. */
export type PreSlimGeneDERecord = Omit<GeneDERecord, 'logCPM'> & {
  logCPM?: number | null;
  ens?: string;
};

export interface ContrastBinding {
  id: string;
  baseline: string;
  case: string;
}

/**
 * The registry's default contrast: the `isDefault` entry, else the first —
 * the same PICK rule getActiveContrast applies at read time. Not identical to
 * it: getActiveContrast additionally resolves a self-comparison contrast
 * (baseline === case) to null, which this helper does not reject — a registry
 * default authored that way would build bundles every reader resolves to
 * nothing. Throws on an empty contrast list, which for a builder is always a
 * registry bug.
 */
export function registryDefaultContrast(dataset: Dataset): Dataset['contrasts'][number] {
  const contrast = dataset.contrasts.find((c) => c.isDefault) ?? dataset.contrasts[0];
  if (!contrast) throw new Error(`${dataset.id}: registry has no contrast`);
  return contrast;
}

/**
 * Binding for the table a builder serializes in `de`: the registry's default
 * contrast id over the manifest's ordered arm keys (baseline first).
 */
export function defaultContrastBinding(
  dataset: Dataset,
  armKeys: readonly [string, string],
): ContrastBinding {
  return { id: registryDefaultContrast(dataset).id, baseline: armKeys[0], case: armKeys[1] };
}

export interface TrackBundlePayload {
  trackId: string;
  /** Ordered pooled-arm keys supplied by the builder manifest. */
  armKeys: readonly [string, string];
  /** The builder's meaning for the table serialized in `de`. */
  defaultContrastBinding: ContrastBinding;
  /** Builder meanings for tables serialized in `deByContrast`, before object keys can hide duplicates. */
  extraContrastBindings?: readonly ContrastBinding[];
  color: string;
  nSig: number;
  meta: TrackMeta;
  qc: TrackQC;
  de: PreSlimGeneDERecord[];
  deByContrast?: Record<string, PreSlimGeneDERecord[]>;
  cpm: CpmMatrix;
  pathways?: PathwayDatabase | null;
  pathwaysByContrast?: Record<string, PathwayDatabase>;
}

export interface WriteBundleOptions {
  /** Root standing in for public/. Defaults to this repository's public/. */
  outRoot?: string;
}

export interface WrittenBundle {
  dir: string;
  files: string[];
}

const DEFAULT_OUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

function sameOrdered(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function sameContrast(a: ContrastBinding, b: ContrastBinding): boolean {
  return a.id === b.id && a.baseline === b.baseline && a.case === b.case;
}

function assertTrackContract(dataset: Dataset, track: TrackBundlePayload): void {
  if (track.trackId !== dataset.defaultTrack) {
    throw new Error(
      `${dataset.id}: manifest trackId "${track.trackId}" does not match registry defaultTrack `
      + `"${dataset.defaultTrack}"`,
    );
  }
  if (track.meta.code !== track.trackId) {
    throw new Error(`${dataset.id}/${track.trackId}: meta.code must equal trackId`);
  }
  if (track.qc.cluster !== track.trackId) {
    throw new Error(`${dataset.id}/${track.trackId}: qc.cluster must equal trackId`);
  }

  if (new Set(track.armKeys).size !== track.armKeys.length) {
    throw new Error(`${dataset.id}: pooled arm keys must be unique (${track.armKeys.join(', ')})`);
  }
  const groupSamples = track.meta.groupSamples;
  if (!groupSamples) throw new Error(`${dataset.id}/${track.trackId}: meta.groupSamples is required`);
  const writtenKeys = Object.keys(groupSamples);
  if (!sameOrdered(writtenKeys.slice(0, 2), track.armKeys)) {
    throw new Error(
      `${dataset.id}: groupSamples must begin with the manifest arm keys in order `
      + `(${track.armKeys.join(', ')})`,
    );
  }
  const registryKeys = dataset.groups.map((group) => group.key);
  if (new Set(registryKeys).size !== registryKeys.length || !sameSet(writtenKeys, registryKeys)) {
    throw new Error(
      `${dataset.id}: groupSamples keys (${writtenKeys.join(', ')}) do not exactly match registry group keys `
      + `(${registryKeys.join(', ')})`,
    );
  }

  const defaultContrast = registryDefaultContrast(dataset);
  if (!sameContrast(track.defaultContrastBinding, defaultContrast)) {
    throw new Error(
      `${dataset.id}: default contrast binding (${track.defaultContrastBinding.id}: `
      + `${track.defaultContrastBinding.baseline} -> ${track.defaultContrastBinding.case}) does not match registry`,
    );
  }

  const extraBindings = [...(track.extraContrastBindings ?? [])];
  const extraIds = extraBindings.map((binding) => binding.id);
  if (new Set(extraIds).size !== extraIds.length) {
    throw new Error(`${dataset.id}: extra contrast ids must be unique (${extraIds.join(', ')})`);
  }
  const registeredExtras = dataset.contrasts.filter((contrast) => contrast.id !== defaultContrast.id);
  const registeredExtraIds = registeredExtras.map((contrast) => contrast.id);
  if (!sameSet(extraIds, registeredExtraIds)) {
    throw new Error(
      `${dataset.id}: manifest extra contrasts (${extraIds.join(', ')}) do not exactly match registry `
      + `non-default contrasts (${registeredExtraIds.join(', ')})`,
    );
  }
  for (const binding of extraBindings) {
    const registered = registeredExtras.find((contrast) => contrast.id === binding.id);
    if (!registered || !sameContrast(binding, registered)) {
      throw new Error(
        `${dataset.id}: extra contrast binding (${binding.id}: ${binding.baseline} -> ${binding.case}) `
        + 'does not match registry',
      );
    }
  }
  // One row per feature in every DE table. buildPopData keys rows by gene, so a
  // duplicate would silently overwrite; the regenerated inputs are unique per
  // public symbol, and builders no longer dedupe, so refuse rather than ship.
  for (const [label, rows] of [['de', track.de] as const,
    ...Object.entries(track.deByContrast ?? {}).map(([id, rows]) => [`deByContrast.${id}`, rows] as const)]) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.gene)) {
        throw new Error(`${dataset.id}/${track.trackId}: ${label} lists "${row.gene}" more than once`);
      }
      seen.add(row.gene);
    }
  }
  const deIds = Object.keys(track.deByContrast ?? {});
  if (!sameSet(deIds, extraIds)) {
    throw new Error(`${dataset.id}: deByContrast keys do not match the asserted extra contrast ids`);
  }
  if (track.pathwaysByContrast && !sameSet(Object.keys(track.pathwaysByContrast), extraIds)) {
    throw new Error(`${dataset.id}: pathwaysByContrast keys do not match the asserted extra contrast ids`);
  }
  if (Object.keys(track.pathwaysByContrast ?? {}).length > 0 && !track.pathways) {
    throw new Error(`${dataset.id}: pathwaysByContrast requires a default pathways block`);
  }
}

function localDatasetFile(outRoot: string, url: string): string {
  if (!url.startsWith('/datasets/') || url.includes('\\') || url.includes('?') || url.includes('#')) {
    throw new Error(`bundle locator returned non-local dataset path: ${url}`);
  }
  const segments = url.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`bundle locator returned unsafe dataset path: ${url}`);
  }
  const reservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment)
    || segment.endsWith('.') || reservedWindowsName.test(segment))) {
    throw new Error(`bundle locator returned unsupported dataset path component: ${url}`);
  }
  const root = resolve(outRoot);
  const file = resolve(root, ...segments);
  const rel = relative(root, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`bundle locator escaped outRoot: ${url}`);
  }
  return file;
}

function writeJsonp(file: string, key: string, payload: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `var ${key} = ${JSON.stringify(payload)};\n`);
}

function pathwayNames(blocks: PathwayDatabase[]): string[] {
  return [...new Set(
    blocks.flatMap((block) => Object.values(block).flat().map((row) => String(row.pathway))),
  )].sort();
}

interface BundleIdentity {
  label: string;
  file: string;
  key: string;
}

export interface PlannedBundleFile {
  file: string;
  key: string;
  body: string;
}

const RESERVED_IDENTIFIERS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected',
  'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield',
]);

function assertBundleIdentities(identities: BundleIdentity[]): void {
  const files = new Map<string, string>();
  for (const identity of identities) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identity.key) || RESERVED_IDENTIFIERS.has(identity.key)) {
      throw new Error(`${identity.label}: invalid JSONP global key "${identity.key}"`);
    }
    const comparable = process.platform === 'win32' ? identity.file.toLowerCase() : identity.file;
    const existing = files.get(comparable);
    if (existing) {
      throw new Error(`${identity.label}: output path collides with ${existing} (${identity.file})`);
    }
    files.set(comparable, identity.label);
  }
}

/** Plan only pathway siblings/indexes, using the same wire contract as the full writer. */
export function planPathwayBundles(
  dataset: Dataset,
  trackId: string,
  pathwaysByContrast: Record<string, PathwayDatabase>,
  opts: WriteBundleOptions = {},
): PlannedBundleFile[] {
  if (trackId !== dataset.defaultTrack) {
    throw new Error(`${dataset.id}: pathway trackId does not match registry defaultTrack`);
  }
  const contrastIds = dataset.contrasts.map((contrast) => contrast.id);
  if (new Set(contrastIds).size !== contrastIds.length
    || !sameSet(Object.keys(pathwaysByContrast), contrastIds)) {
    throw new Error(`${dataset.id}: pathway blocks must map exactly once to every registered contrast`);
  }
  const defaultId = registryDefaultContrast(dataset).id;
  const defaultBlock = structuredClone(pathwaysByContrast[defaultId]);
  const extras = Object.fromEntries(contrastIds.filter((id) => id !== defaultId)
    .map((id) => [id, structuredClone(pathwaysByContrast[id])]));
  for (const block of [defaultBlock, ...Object.values(extras)]) {
    slimPathwayBlock(block as Record<string, unknown>);
  }
  const located = sameOriginDataset(dataset);
  const outRoot = resolve(opts.outRoot ?? DEFAULT_OUT_ROOT);
  const sibling: BundleIdentity = {
    label: `${dataset.id}/${trackId} pathways`,
    file: localDatasetFile(outRoot, resolvePathwayUrl(located, trackId)),
    key: resolvePathwayGlobalKey(dataset, trackId),
  };
  const index: BundleIdentity = {
    label: `${dataset.id} pathway index`,
    file: localDatasetFile(outRoot, resolvePathwayIndexUrl(located)),
    key: resolvePathwayIndexGlobalKey(dataset),
  };
  assertBundleIdentities([
    { label: `${dataset.id} metadata`, file: localDatasetFile(outRoot, located.metaFile), key: dataset.metaGlobalKey },
    { label: `${dataset.id} QC`, file: localDatasetFile(outRoot, located.qcFile), key: dataset.qcGlobalKey },
    { label: `${dataset.id}/${trackId} track`, file: localDatasetFile(outRoot, resolveTrackUrl(located, trackId)), key: resolveTrackGlobalKey(dataset, trackId) },
    { label: `${dataset.id}/${trackId} time series`, file: localDatasetFile(outRoot, resolveTimeSeriesUrl(located, trackId)), key: resolveTimeSeriesGlobalKey(dataset, trackId) },
    sibling,
    index,
  ]);
  const payload = Object.keys(extras).length ? { default: defaultBlock, byContrast: extras } : defaultBlock;
  return [
    { file: sibling.file, key: sibling.key, body: `var ${sibling.key} = ${JSON.stringify(payload)};\n` },
    { file: index.file, key: index.key, body: `var ${index.key} = ${JSON.stringify(pathwayNames([defaultBlock, ...Object.values(extras)]))};\n` },
  ];
}

export function writeDatasetBundles(
  dataset: Dataset,
  tracks: TrackBundlePayload[],
  opts: WriteBundleOptions = {},
): WrittenBundle {
  const outRoot = resolve(opts.outRoot ?? DEFAULT_OUT_ROOT);
  const locatedDataset = sameOriginDataset(dataset);
  const files: string[] = [];

  for (const track of tracks) assertTrackContract(dataset, track);

  const metaIdentity: BundleIdentity = {
    label: `${dataset.id} metadata`,
    file: localDatasetFile(outRoot, locatedDataset.metaFile),
    key: dataset.metaGlobalKey,
  };
  const qcIdentity: BundleIdentity = {
    label: `${dataset.id} QC`,
    file: localDatasetFile(outRoot, locatedDataset.qcFile),
    key: dataset.qcGlobalKey,
  };
  const trackPlans = tracks.map((track) => ({
    track,
    trackIdentity: {
      label: `${dataset.id}/${track.trackId} track`,
      file: localDatasetFile(outRoot, resolveTrackUrl(locatedDataset, track.trackId)),
      key: resolveTrackGlobalKey(dataset, track.trackId),
    },
    pathwayIdentity: track.pathways ? {
      label: `${dataset.id}/${track.trackId} pathways`,
      file: localDatasetFile(outRoot, resolvePathwayUrl(locatedDataset, track.trackId)),
      key: resolvePathwayGlobalKey(dataset, track.trackId),
    } : null,
    pathwayIndexIdentity: track.pathways ? {
      label: `${dataset.id} pathway index`,
      file: localDatasetFile(outRoot, resolvePathwayIndexUrl(locatedDataset)),
      key: resolvePathwayIndexGlobalKey(dataset),
    } : null,
  }));
  assertBundleIdentities([
    metaIdentity,
    qcIdentity,
    ...trackPlans.flatMap((plan) => [
      plan.trackIdentity,
      ...(plan.pathwayIdentity ? [plan.pathwayIdentity] : []),
      ...(plan.pathwayIndexIdentity ? [plan.pathwayIndexIdentity] : []),
    ]),
  ]);

  // The one track carrying factorial design cells (>2 groupSamples groups),
  // whose per-cell sample counts become the manifest's groupN. Today's bulk
  // studies are single-track, so "the first such track" and "the track" are
  // the same thing; if a multi-track dataset ever declares design cells on
  // more than one track, deriving groupN from just the first would silently
  // describe the wrong track — so refuse and make the author decide.
  const factorialTracks = tracks.filter(
    (track) => Object.keys(track.meta.groupSamples ?? {}).length > 2,
  );
  if (factorialTracks.length > 1) {
    throw new Error(
      `${dataset.id}: ${factorialTracks.length} tracks declare factorial design cells — groupN assumes exactly one; teach writeDatasetBundles which track owns the manifest groupN`,
    );
  }
  const factorialTrack = factorialTracks[0];

  const metaPayload = {
    populations: tracks.map((track) => track.trackId),
    labels: Object.fromEntries(tracks.map((track) => [track.trackId, track.meta.label])),
    types: Object.fromEntries(tracks.map((track) => [track.trackId, track.meta.type])),
    nGenes: Object.fromEntries(tracks.map((track) => [track.trackId, track.meta.nGenes])),
    colors: Object.fromEntries(tracks.map((track) => [track.trackId, track.color])),
    qcFlags: Object.fromEntries(tracks.map((track) => [track.trackId, {
      is3v3: track.qc.is3v3,
      nNormal: track.qc.nNormal,
      nObese: track.qc.nObese,
      minCells: track.qc.minCells ?? 0,
      status: 'ok',
    }])),
    ...(factorialTrack
      ? {
        groupN: Object.fromEntries(
          Object.entries(factorialTrack.meta.groupSamples ?? {})
            .map(([key, samples]) => [key, samples.length]),
        ),
      }
      : {}),
    qaReportFilenames: {},
  };
  const qcPayload = {
    runStatus: tracks.map((track) => ({
      cluster: track.qc.cluster,
      clusterLabel: track.qc.clusterLabel,
      status: 'ok',
      nNormal: track.qc.nNormal,
      nObese: track.qc.nObese,
    })),
    deSummary: tracks.map((track) => ({
      cluster: track.qc.cluster,
      clusterLabel: track.qc.clusterLabel,
      nGenes: track.meta.nGenes,
      nSig: track.nSig,
    })),
    fgseaSummary: [],
    composition: {
      countsLong: [], countsWide: [], propsLong: [], propsWide: [],
      daQuasiAll: [], daPropellerVsQuasi: [],
    },
  };

  const metaFile = metaIdentity.file;
  writeJsonp(metaFile, metaIdentity.key, metaPayload);
  files.push(metaFile);
  const qcFile = qcIdentity.file;
  writeJsonp(qcFile, qcIdentity.key, qcPayload);
  files.push(qcFile);

  for (const { track, trackIdentity, pathwayIdentity, pathwayIndexIdentity } of trackPlans) {
    const trackObject = {
      meta: track.meta,
      qc: track.qc,
      de: track.de,
      ...(track.deByContrast && Object.keys(track.deByContrast).length
        ? { deByContrast: track.deByContrast }
        : {}),
      cpm: track.cpm,
    };
    slimTrackObject(trackObject as unknown as Record<string, unknown>);
    const trackFile = trackIdentity.file;
    writeJsonp(trackFile, trackIdentity.key, trackObject);
    files.push(trackFile);

    if (track.pathways) {
      slimPathwayBlock(track.pathways as unknown as Record<string, unknown>);
      for (const block of Object.values(track.pathwaysByContrast ?? {})) {
        slimPathwayBlock(block as unknown as Record<string, unknown>);
      }
      const hasExtra = Object.keys(track.pathwaysByContrast ?? {}).length > 0;
      const sibling = hasExtra
        ? { default: track.pathways, byContrast: track.pathwaysByContrast as Record<string, PathwayDatabase> }
        : track.pathways;
      const siblingFile = pathwayIdentity!.file;
      writeJsonp(siblingFile, pathwayIdentity!.key, sibling);
      files.push(siblingFile);

      const indexFile = pathwayIndexIdentity!.file;
      writeJsonp(
        indexFile,
        pathwayIndexIdentity!.key,
        pathwayNames([track.pathways, ...Object.values(track.pathwaysByContrast ?? {})]),
      );
      files.push(indexFile);
    }
  }

  return { dir: dirname(metaFile), files };
}

export function writeTimeSeriesBundle(
  dataset: Dataset,
  trackId: string,
  bundle: TimeSeriesBundle,
  opts: WriteBundleOptions & { dry?: boolean } = {},
): { file: string; bytes: number } {
  if (trackId !== dataset.defaultTrack) {
    throw new Error(
      `${dataset.id}: manifest trackId "${trackId}" does not match registry defaultTrack "${dataset.defaultTrack}"`,
    );
  }
  const descriptor = dataset.timeSeries;
  if (!descriptor || !sameOrdered(descriptor.tracks, [trackId])) {
    throw new Error(`${dataset.id}: timeSeries.tracks must exactly match the written track`);
  }
  if (bundle.meta.trackId !== trackId) {
    throw new Error(`${dataset.id}: time-series bundle meta.trackId must equal trackId`);
  }
  if (bundle.meta.cycleHours !== descriptor.cycleHours) {
    throw new Error(`${dataset.id}: time-series cycleHours does not match registry`);
  }
  if (bundle.meta.timeUnit !== descriptor.timeUnit) {
    throw new Error(`${dataset.id}: time-series timeUnit does not match registry`);
  }
  const armKeys = bundle.meta.arms.map((arm) => arm.key);
  const registryKeys = dataset.groups.map((group) => group.key);
  if (new Set(armKeys).size !== armKeys.length || !sameOrdered(armKeys, registryKeys)) {
    throw new Error(`${dataset.id}: time-series arm keys do not exactly match registry group keys`);
  }
  const locatedDataset = sameOriginDataset(dataset);
  const outRoot = resolve(opts.outRoot ?? DEFAULT_OUT_ROOT);
  const identity: BundleIdentity = {
    label: `${dataset.id}/${trackId} time series`,
    file: localDatasetFile(outRoot, resolveTimeSeriesUrl(locatedDataset, trackId)),
    key: resolveTimeSeriesGlobalKey(dataset, trackId),
  };
  const siblingPaths = [
    { label: `${dataset.id} metadata`, file: localDatasetFile(outRoot, locatedDataset.metaFile), key: dataset.metaGlobalKey },
    { label: `${dataset.id} QC`, file: localDatasetFile(outRoot, locatedDataset.qcFile), key: dataset.qcGlobalKey },
    { label: `${dataset.id}/${trackId} track`, file: localDatasetFile(outRoot, resolveTrackUrl(locatedDataset, trackId)), key: resolveTrackGlobalKey(dataset, trackId) },
    { label: `${dataset.id}/${trackId} pathways`, file: localDatasetFile(outRoot, resolvePathwayUrl(locatedDataset, trackId)), key: resolvePathwayGlobalKey(dataset, trackId) },
    { label: `${dataset.id} pathway index`, file: localDatasetFile(outRoot, resolvePathwayIndexUrl(locatedDataset)), key: resolvePathwayIndexGlobalKey(dataset) },
    identity,
  ];
  assertBundleIdentities(siblingPaths);
  const file = identity.file;
  const body = `var ${identity.key} = ${JSON.stringify(bundle)};\n`;
  if (!opts.dry) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return { file, bytes: Buffer.byteLength(body) };
}

export function outDirFromArgv(argv: string[] = process.argv.slice(2)): string | undefined {
  const index = argv.indexOf('--out-dir');
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--out-dir requires a directory');
  return resolve(value);
}

export function requireDataset(id: string): Dataset {
  const dataset = getDataset(id);
  if (!dataset) {
    throw new Error(`${id}: no registry entry; add it to src/data/datasets.ts before building bundles`);
  }
  return dataset;
}
