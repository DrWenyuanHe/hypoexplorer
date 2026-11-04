// The index-backed loader for the cross-dataset Compare view (one gene's
// baseline-vs-case bars, one chart per dataset).
//
// WHY THIS EXISTS
// ---------------
// That view used to load every registered dataset's DEFAULT track in full —
// 43 requests, 148.4 MB measured on the shipping corpus — to read one gene's
// row out of each. It could not use the existing gene index because a bar is
// not a statistic: it needs the PER-SAMPLE values behind the mean and the SEM,
// and a gene row carries only [logFC, pval, fdr, se].
//
// So the index grew an expression family (scripts/build_query_index.mts, pass
// 1.5) and this module reads it: manifest + one gene shard + one expr shard,
// three requests, ~220 KB raw.
//
// THE SAME BARGAIN AS crossDataset.ts
// -----------------------------------
// Resolve null — never a partial answer — whenever anything about the index is
// unusable, so the caller falls back to reading the bundles. A STALE INDEX MUST
// DEGRADE TO SLOW, NEVER TO WRONG. That is not a slogan here: every failure
// this guards against renders as a *plausible chart*, not as an error. A
// dataset missing from the manifest reads as "gene not detected in this
// dataset" — a claim of absence about bundles nobody opened. A sample list that
// no longer matches the values plots the right numbers against the wrong
// animals. Neither throws, neither logs, and both look exactly like a result.
//
// WHY buildPopData RATHER THAN A HAND-BUILT PopData
// -------------------------------------------------
// The obvious shortcut is to assemble the PopData object literally, since only
// a handful of its fields are read here today. That shortcut is a second,
// silent implementation of ./buildPopData that drifts the moment a chart starts
// reading a field this file forgot. Instead this assembles the MINIMAL RawTrack
// the transform already knows how to read — one gene's DE row, one gene's cpm
// column, the track's sample scaffolding — and lets the one transform produce
// the rest. Whatever BarSEMChart reads next is then already correct.

import { getActiveContrast } from './contrasts';
import { buildPopData } from './buildPopData';
import { manifestFreshness, REBUILD_HINT } from './indexFreshness';
import {
  loadQueryManifest, loadExprRows, loadGeneRows, manifestSupportsExpr,
  type DatasetSummary, type ExprIndexRow, type GeneIndexRow, type QueryManifest,
} from './queryIndex';
import type { Dataset, PopData, RawTrack, ResolvedContrast } from '../types';

/** One dataset's chart, however it was loaded. Mirrors the view's own shape. */
export interface CompareEntry {
  dataset: Dataset;
  contrast: ResolvedContrast | null;
  popData: PopData;
}

/**
 * Refuse an index that cannot answer for EVERY dataset the view will render.
 *
 * The view lists the registry, so a dataset the index does not cover would get
 * a card reading "not detected" rather than no card at all. Bail out whole
 * rather than serve a report that is quietly missing a study.
 *
 * Returns the summaries keyed by dataset id, or null. A MAP rather than an
 * index-aligned array: the caller pairs each dataset with its summary by id, so
 * a future early-`continue` here cannot silently shift every later pairing by
 * one — which would attribute one dataset's samples to another's values.
 */
function summariesFor(manifest: QueryManifest, datasets: Dataset[]): Map<string, DatasetSummary> | null {
  const fresh = manifestFreshness(manifest, datasets, ['defaultTrack', 'contrast', 'exprScaffold']);
  if (!fresh.ok) {
    console.warn(
      '[crossDatasetCompare] the query index cannot serve the compare view for '
      + `${fresh.problems.length} problem(s) — using the full-download path instead:\n  `
      + `${fresh.problems.join('\n  ')}\n${REBUILD_HINT}`,
    );
    return null;
  }
  return new Map((manifest.datasets ?? []).map((summary) => [summary.ds, summary]));
}

/** The manifest track index of a dataset's default track, or -1. */
function defaultTrackIdx(manifest: QueryManifest, summary: DatasetSummary): number {
  return manifest.tracks.findIndex((t) => t.ds === summary.ds && t.trackId === summary.defaultTrack);
}

/**
 * One gene across every dataset's default track, from the index.
 *
 * Resolves null when the index is unavailable or untrustworthy, so the caller
 * falls back to the full download. Resolves a (possibly empty) entry list when
 * the index WAS consulted — an empty list then honestly means the gene is in no
 * default track.
 */
export async function loadCompareEntriesViaIndex(
  gene: string,
  datasets: Dataset[],
): Promise<CompareEntry[] | null> {
  const manifest = await loadQueryManifest(datasets);
  if (!manifest || !manifestSupportsExpr(manifest)) return null;

  const summaries = summariesFor(manifest, datasets);
  if (!summaries) return null;

  // The two shards are independent files; ask for them together rather than in
  // series, since the whole point is a query that costs one round trip's wait.
  const [geneRows, exprRows] = await Promise.all([
    loadGeneRows(datasets, gene, manifest.buildId),
    loadExprRows(datasets, gene, manifest.buildId),
  ]);
  // null means the shard could not be read, which is NOT the same as "the gene
  // is in no track" — the difference is a fallback versus a claim of absence.
  if (geneRows === null || exprRows === null) return null;

  const deByTrack = new Map<number, GeneIndexRow>();
  for (const r of geneRows) deByTrack.set(r[0], r);
  const exprByTrack = new Map<number, ExprIndexRow>();
  for (const r of exprRows) exprByTrack.set(r[0], r);

  const entries: CompareEntry[] = [];
  for (const ds of datasets) {
    // Non-null by construction: summariesFor returns null unless every dataset
    // validated, so a miss here would mean it had let one through.
    const summary = summaries.get(ds.id);
    if (!summary) return null;
    const ti = defaultTrackIdx(manifest, summary);
    if (ti < 0) return null;   // summary and track list disagree: the whole index is suspect

    const expr = exprByTrack.get(ti);
    const de = deByTrack.get(ti);

    const values = expr?.[1];
    // A row whose length no longer matches the sample list cannot be read
    // positionally, and reading it anyway would attribute values to the wrong
    // animals. The shards and the manifest are stamped with the same build id,
    // so this should be unreachable; it is here because the failure is silent.
    if (expr && (!Array.isArray(values) || values.length !== summary.sampleOrder?.length)) {
      console.warn(
        `[crossDatasetCompare] ${ds.id}: expression row has ${Array.isArray(values) ? values.length : '?'} `
        + `value(s) but the summary declares ${summary.sampleOrder?.length} sample(s) — using the full-download path.`,
      );
      return null;
    }

    // The source symbol, so each chart prints its dataset's own spelling
    // (macaque POMC, mouse Pomc) even though the lookup was case-insensitive.
    const sym = expr?.[2] ?? gene.toUpperCase();
    const contrast = getActiveContrast(ds);

    // The minimal raw track: exactly the fields buildPopData reads, for one
    // gene. Everything downstream (deByGene, geneNames, groups, volcanoPts,
    // expressionUnit, the empty pathway list) is the real transform's output,
    // not a second guess at it.
    const raw: RawTrack = {
      meta: {
        code: summary.ds,
        label: summary.trackLabel,
        sampleOrder: summary.sampleOrder,
        groupSamples: summary.groupSamples,
      },
      // A gene with values but no statistics yields an empty DE table, which
      // the view reads as "not detected in this dataset" — the same answer the
      // full-download path gives, since detection there is also a deByGene
      // lookup. Deliberately NOT special-cased into a bar with a defaulted
      // p-value: the two paths must answer alike, and the picker cannot even
      // offer such a gene (gene_names.js is built from the DE tables, see
      // pickerGeneNames in the generator). Measured on this corpus: cpm and de
      // cover identical gene sets on all 43 default tracks, so this is a guard
      // against future drift, not a live branch.
      de: de && de[1] !== null && de[2] !== null
        ? [{ gene: sym, logFC: de[1], PValue: de[2], FDR: de[3], se: de[4] ?? undefined }]
        : [],
      cpm: values ? { [sym]: values } : {},
    };

    // Every dataset gets an entry, including one whose default track never
    // measured this gene: its popData simply has no row for it, and the view
    // sorts it into "not detected in N other datasets" — the same list, with
    // the same names, that the full-download path produces. Dropping it here
    // instead would quietly shorten that list, turning "we looked and it is
    // absent" into "we did not mention this study".
    const popData = buildPopData(raw, ds, contrast);
    if (popData) entries.push({ dataset: ds, contrast, popData });
  }
  return entries;
}
