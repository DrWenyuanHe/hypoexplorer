// Query-index freshness is a scientific-correctness boundary, not merely a
// cache check. Every disagreement guarded here can otherwise render as a
// plausible answer: an absence claim for a bundle never read, or statistics
// built for one contrast under another contrast's labels. A stale index must
// therefore degrade to slow, never to wrong.
//
// Contrast ids alone cannot witness the complete contrast definition. New
// manifests also carry baseline/case arm keys and those are checked whenever
// present. Older committed manifests do not carry them, so a same-id arm edit
// remains unverifiable until the next index rebuild; contrastId is still strict.

import { getActiveContrast } from './contrasts';
import type { Dataset } from '../types';

interface SummaryShape {
  ds: string;
  defaultTrack: string;
  contrastId?: string | null;
  armKeys?: string[] | null;
  sampleOrder?: string[];
  groupSamples?: Record<string, string[]>;
}

interface ManifestShape {
  tracks: Array<{ ds: string; trackId: string }>;
  trackCounts?: Record<string, number>;
  datasets?: SummaryShape[];
}

export type Need = 'coverage' | 'trackCounts' | 'defaultTrack' | 'contrast' | 'exprScaffold';

/** The minimum of DatasetMeta read by the predicates. */
export interface MetaShape { populations?: string[] }

export interface FreshnessOptions {
  /** Opportunistic browser lookup. undefined means unknown, not stale. */
  metaFor?: (ds: Dataset) => MetaShape | undefined;
}

export interface FreshnessReport { ok: boolean; problems: string[] }

export const REBUILD_HINT =
  'Rebuild with `npx tsx scripts/build_query_index.mts` and redeploy public/query/.';

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function summaryFor(manifest: ManifestShape, ds: Dataset): SummaryShape | undefined {
  return manifest.datasets?.find((summary) => summary.ds === ds.id);
}

/** Problems for one dataset against one manifest. An empty array means fresh. */
export function datasetFreshnessProblems(
  manifest: ManifestShape,
  ds: Dataset,
  needs: readonly Need[],
  opts: FreshnessOptions = {},
): string[] {
  const requested = new Set(needs);
  const problems: string[] = [];
  const indexedTracks = manifest.tracks.filter((track) => track.ds === ds.id).map((track) => track.trackId);

  if (requested.has('coverage') && indexedTracks.length === 0) {
    problems.push(`${ds.id}: no tracks in the manifest`);
  }

  if (requested.has('trackCounts')) {
    const recorded = manifest.trackCounts?.[ds.id];
    if (manifest.trackCounts && recorded !== indexedTracks.length) {
      problems.push(
        `${ds.id}: trackCounts records ${recorded ?? '(missing)'} but the manifest contains ${indexedTracks.length}`,
      );
    }

    const populations = opts.metaFor?.(ds)?.populations;
    if (populations && !sameStrings(indexedTracks, populations)) {
      problems.push(
        `${ds.id}: index tracks [${indexedTracks.join(', ')}], meta.js declares [${populations.join(', ')}]`,
      );
    }
  }

  const needsSummary = requested.has('defaultTrack') || requested.has('contrast') || requested.has('exprScaffold');
  if (!needsSummary) return problems;

  const summary = summaryFor(manifest, ds);
  if (!summary) {
    problems.push(`${ds.id}: no browse summary in the manifest`);
    return problems;
  }

  if (requested.has('defaultTrack') && summary.defaultTrack !== ds.defaultTrack) {
    problems.push(
      `${ds.id}: index has default track "${summary.defaultTrack}", registry declares "${ds.defaultTrack}"`,
    );
  }

  const contrast = getActiveContrast(ds);
  if (requested.has('contrast')) {
    if (typeof summary.contrastId !== 'string' || summary.contrastId !== contrast?.id) {
      problems.push(
        `${ds.id}: index built for contrast "${summary.contrastId ?? '(none)'}", registry declares "${contrast?.id ?? '(none)'}"`,
      );
    }

    if (summary.armKeys !== undefined) {
      const expected = contrast ? [contrast.baseline.key, contrast.caseGroup.key] : [];
      if (!Array.isArray(summary.armKeys) || !sameStrings(summary.armKeys, expected)) {
        problems.push(
          `${ds.id}: index contrast arms [${Array.isArray(summary.armKeys) ? summary.armKeys.join(', ') : '(invalid)'}], registry declares [${expected.join(', ')}]`,
        );
      }
    }
  }

  if (requested.has('exprScaffold')) {
    const sampleOrder = summary.sampleOrder;
    const groupSamples = summary.groupSamples;
    if (!sampleOrder?.length || !groupSamples) {
      problems.push(`${ds.id}: summary carries no expression scaffolding`);
      return problems;
    }
    if (new Set(sampleOrder).size !== sampleOrder.length) {
      problems.push(`${ds.id}: sampleOrder has duplicate sample ids`);
      return problems;
    }
    const armKeys = [contrast?.baseline.key, contrast?.caseGroup.key].filter(Boolean) as string[];
    const emptyArm = armKeys.find((key) => !Array.isArray(groupSamples[key]) || groupSamples[key].length === 0);
    if (armKeys.length !== 2 || emptyArm) {
      problems.push(`${ds.id}: groupSamples has no non-empty entry for arm "${emptyArm ?? '(unresolved)'}"`);
      return problems;
    }
    const order = new Set(sampleOrder);
    const orphan = armKeys.flatMap((key) => groupSamples[key]).find((sample) => !order.has(sample));
    if (orphan) {
      problems.push(`${ds.id}: arm sample "${orphan}" is not in sampleOrder`);
      return problems;
    }
    const baselineSamples = new Set(groupSamples[armKeys[0]]);
    const overlap = groupSamples[armKeys[1]].find((sample) => baselineSamples.has(sample));
    if (overlap) problems.push(`${ds.id}: arm sample "${overlap}" belongs to both active arms`);
  }

  return problems;
}

/** Aggregate freshness for all datasets. Never throws or logs. */
export function manifestFreshness(
  manifest: ManifestShape,
  datasets: readonly Dataset[],
  needs: readonly Need[],
  opts: FreshnessOptions = {},
): FreshnessReport {
  const problems = datasets.flatMap((ds) => datasetFreshnessProblems(manifest, ds, needs, opts));
  return { ok: problems.length === 0, problems };
}
