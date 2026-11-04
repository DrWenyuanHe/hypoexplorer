// Contrast resolution — pure functions of a Dataset VALUE. Turn the manifest's
// `contrasts` entries (which reference groups by key) into ResolvedContrasts
// carrying full group objects. Nothing here touches the DATASETS registry, so a
// caller can resolve a contrast against any dataset object (fixtures included).

import type { Contrast, Dataset, Group, QCFlags, ResolvedContrast } from '../types';
import { groupSampleTooltip, partitionGroupSamples } from '../utils/sampleIds';

// Resolve one manifest Contrast against a dataset into a ResolvedContrast whose
// baseline/case are FULL group objects (not just keys). The case-group field is
// named `caseGroup` (NOT `case`) so it's a safe JS identifier and never collides
// with the reserved word. Returns null for a self-comparison (see below).
function resolveContrast(
  dataset: Dataset | null | undefined,
  resolved: Contrast | undefined,
): ResolvedContrast | null {
  if (!resolved) return null;

  // A contrast comparing a group against itself ("X vs X") would render two
  // identical arms with identical values — almost certainly a manifest typo.
  // Treat it as no valid contrast (consistent with the null returned above) and
  // warn, rather than silently rendering a meaningless self-comparison. No
  // shipping dataset trips this; it guards future contrast authoring.
  if (resolved.baseline === resolved.case) {
    console.warn(
      `getActiveContrast: contrast "${resolved.id}" has baseline === case ` +
        `("${resolved.baseline}"); ignoring this self-comparison.`,
    );
    return null;
  }

  const groups = dataset?.groups ?? [];
  const groupByKey = (key: string): Group =>
    groups.find((g) => g.key === key) || { key, label: key, color: '#888888' };

  const baseline = groupByKey(resolved.baseline);
  const caseGroup = groupByKey(resolved.case);
  return {
    id: resolved.id,
    baseline,
    caseGroup,
    supportsPathways: !!dataset?.supportsPathways,
    // Authored label wins; else a derived "<case> vs <baseline>" (matches the
    // GeneReport heading convention).
    label: resolved.label ?? `${caseGroup.label} vs ${baseline.label}`,
    description: resolved.description,
    exploratory: resolved.exploratory,
    group: resolved.group,
  };
}

// Resolve the ACTIVE contrast (by id, else the isDefault one, else the first).
export function getActiveContrast(
  dataset: Dataset | null | undefined,
  contrastId?: string | null,
): ResolvedContrast | null {
  const contrasts = dataset?.contrasts ?? [];
  const resolved =
    (contrastId ? contrasts.find((c) => c.id === contrastId) : undefined) ||
    contrasts.find((c) => c.isDefault) ||
    contrasts[0];
  return resolveContrast(dataset, resolved);
}

// The common per-arm tier chain. Loaded membership is authoritative when it is
// non-empty; otherwise callers fall back through factorial-cell and legacy
// pooled counts independently for each arm.
function armCount(
  key: string | undefined,
  membership: { groupSamples?: Record<string, string[]>; samplesKept?: string[] } | null,
  groupN: Record<string, number> | undefined,
  legacy: number | null | undefined,
): number | null {
  if (!key) return legacy ?? null;
  if (membership?.groupSamples?.[key]?.length) {
    return partitionGroupSamples(membership.groupSamples, membership.samplesKept, key).kept.length;
  }
  return groupN?.[key] ?? legacy ?? null;
}

export interface ContrastArmCounts {
  /** null renders as '–' in ArmPills. */
  nBaseline: number | null;
  nCase: number | null;
  /** Undefined until the loaded track bundle resolves group membership. */
  baselineTitle: string | undefined;
  caseTitle: string | undefined;
}

/**
 * The ACTIVE contrast's arm sizes and sample-id tooltips for a loaded (or
 * loading) track. The per-arm tier order is membership ∩ QC-kept, groupN,
 * loaded track QC, then dataset-meta qcFlags.
 */
export function contrastArmCounts(
  contrast: ResolvedContrast | null,
  popData: {
    groupSamples?: Record<string, string[]>;
    qc?: { samplesKept?: string[]; nNormal?: number; nObese?: number } | null;
  } | null,
  meta: { groupN?: Record<string, number>; qcFlags?: Record<string, QCFlags> } | null | undefined,
  trackId: string,
): ContrastArmCounts {
  const baseline = contrast?.baseline;
  const caseGroup = contrast?.caseGroup;
  const membership = popData
    ? { groupSamples: popData.groupSamples, samplesKept: popData.qc?.samplesKept }
    : null;
  const trackQcFlags = meta?.qcFlags?.[trackId];
  return {
    nBaseline: armCount(
      baseline?.key, membership, meta?.groupN,
      popData?.qc?.nNormal ?? trackQcFlags?.nNormal,
    ),
    nCase: armCount(
      caseGroup?.key, membership, meta?.groupN,
      popData?.qc?.nObese ?? trackQcFlags?.nObese,
    ),
    baselineTitle: baseline
      ? groupSampleTooltip(popData?.groupSamples, popData?.qc?.samplesKept, baseline)
      : undefined,
    caseTitle: caseGroup
      ? groupSampleTooltip(popData?.groupSamples, popData?.qc?.samplesKept, caseGroup)
      : undefined,
  };
}

/**
 * The DEFAULT contrast's two arm sizes, for the browse surfaces that headline a
 * dataset without loading a track bundle.
 *
 * WHY THIS IS NOT `qcFlags.nNormal` / `qcFlags.nObese`.
 * `qcFlags` carries exactly one pair per track — the study's POOLED control and
 * case — while the labels rendered beside those numbers come from the resolved
 * default contrast. On a factorial dataset those are different arms, so the pair
 * read straight out of `qcFlags` describes groups the card is not naming. It is
 * the shape that had the GSE135639 library card reading "8 Chow · P21 vs 9 HFD ·
 * P21" when the P21 cells hold 3 and 4 — right labels, wrong numbers, and no
 * `nVaries` caveat to soften it, since a single-track study cannot vary.
 *
 * The bug was dormant while every dataset's default contrast happened to be its
 * pooled pair; removing GSE135639's age-adjusted contrast moved a default onto
 * design cells for the first time. `meta.groupN` already carries every arm.
 *
 * The pooled values stay as the FALLBACK, which is what keeps this a no-op for
 * every pooled-default dataset: there `groupN.control`/`groupN.case` equal
 * `nNormal`/`nObese`, and a bundle too old to carry `groupN` degrades to exactly
 * today's numbers rather than to nulls.
 *
 * Callers must agree on this derivation or the explorer and the library make
 * different claims about the same study — which is why it lives here once
 * instead of twice, in `factsFromMeta` and in the query-index generator.
 * It shares the groupN → legacy per-arm tiers with `contrastArmCounts`, while
 * remaining independent because its caller supplies the pooled fallback pair.
 */
export function defaultArmCounts(
  dataset: Dataset | null | undefined,
  meta: { groupN?: Record<string, number> } | null | undefined,
  pooled: { nNormal?: number | null; nObese?: number | null } | null | undefined,
): { nBaseline: number | null; nCase: number | null } {
  const contrast = getActiveContrast(dataset);
  return {
    nBaseline: armCount(contrast?.baseline?.key, null, meta?.groupN, pooled?.nNormal),
    nCase: armCount(contrast?.caseGroup?.key, null, meta?.groupN, pooled?.nObese),
  };
}

// Narrow a popData's nullable `contrast` for the views and exporters that only
// ever run for a track that HAS one (they render inside a loaded popData whose
// contrast the shell already resolved). States that assumption ONCE, instead of
// re-spelling `popData.contrast as ResolvedContrast` at every such site.
//
// Deliberately does NOT throw: the casts this replaces proceed regardless, and
// turning a null contrast into an exception would trade a mislabelled column for
// a blank page. If a null ever reaches here the caller degrades exactly as it
// does today.
export function requireContrast(contrast: ResolvedContrast | null | undefined): ResolvedContrast {
  return contrast as ResolvedContrast;
}

/**
 * The design's CONDITIONS: every group any declared contrast draws, deduplicated,
 * in the order the contrasts declare them.
 *
 * This is the axis of the multi-condition chart, and it is derived rather than
 * authored for one reason: a dataset's `groups` list is not the same thing as
 * its design cells. GSE135639 declares six groups — the two POOLED diet arms
 * plus the four diet × age cells — and the pooled arms CONTAIN the cells, so
 * drawing all six would plot every sample twice and invite a reader to compare
 * a cell against a pool it is part of. No contrast draws the pooled arms (they
 * are arms, not a comparison; see the manifest note), so the contrast-referenced
 * union is exactly the four cells, and it stays exactly right for any future
 * dataset without a second field to keep in sync.
 *
 * Returns fewer than 3 groups for every non-factorial dataset — which is how
 * callers gate the view: with two conditions the chart has nothing the contrast
 * chart does not already show.
 */
export function designCells(contrasts: ResolvedContrast[] | null | undefined): Group[] {
  const seen = new Map<string, Group>();
  for (const c of contrasts ?? []) {
    for (const g of [c.baseline, c.caseGroup]) {
      if (g && !seen.has(g.key)) seen.set(g.key, g);
    }
  }
  return [...seen.values()];
}

// Resolve EVERY contrast a dataset declares, for the contrast selector. Skips
// self-comparisons (resolveContrast returns null for them). Order follows the
// manifest's `contrasts` array.
export function listContrasts(dataset: Dataset | null | undefined): ResolvedContrast[] {
  const contrasts = dataset?.contrasts ?? [];
  const out: ResolvedContrast[] = [];
  for (const c of contrasts) {
    const r = resolveContrast(dataset, c);
    if (r) out.push(r);
  }
  return out;
}
