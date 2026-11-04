// The browse catalog: what the dataset library renders a card from.
//
// WHY THIS MODULE EXISTS
// ---------------------
// A card needs facts from two places. The registry (./datasets) owns identity —
// name, organism, modality, arms, contrast, accession, the browse facets. The
// bundles own measurement — replicate counts per arm, genes detected, how many
// tracks there actually are. Naively, showing the full registry means reading
// one `meta.js` file per card before the first card can claim an N.
//
// So the numbers are precomputed into the query manifest the app already
// fetches (see scripts/build_query_index.mts), and this module is the JOIN. It
// is the ONLY thing the library imports for data. The library does not know
// there is a manifest, does not know about JSONP, and cannot be tempted into
// fanning out over meta.js — which is the failure mode this seam exists to
// prevent.
//
// DEGRADATION IS PART OF THE CONTRACT
// -----------------------------------
// The manifest lives beside the bundles, which may be served off-origin from R2
// (see ./bundleBase) and may lag an app deploy. A manifest that is missing,
// stale, or predates the `datasets` field must NOT blank the library: every card
// still renders from the registry alone, with the measured fields absent rather
// than wrong. `catalogState` says which of the two happened so the UI can be
// honest about it — a dash that means "not loaded" must not be readable as a
// dash that means "zero".

import { loadQueryManifest, type DatasetSummary, type DiscoverySummary } from './queryIndex';
import { queryCatalogContent } from './queryCatalogIdentity';
import { listDatasets } from './datasets';
import { getActiveContrast } from './contrasts';
import { datasetFreshnessProblems, REBUILD_HINT } from './indexFreshness';
import { requireAuthorValidation, type AuthorValidationRecord } from './authorValidation';
import type { Dataset, Group } from '../types';

/** How much of a card's numbers are real. */
export type CatalogState =
  /** Registry cards are on screen; the measured fields have not arrived yet. */
  | 'loading'
  /** Every registered dataset got its measured fields. */
  | 'complete'
  /**
   * Some datasets got measured fields and some did not.
   *
   * This is the version-skew case, and it is the likely one: the bundles and the
   * manifest are served off-origin from R2 and deploy on their own schedule, so
   * a registry that ships a dataset before its index rebuild reaches the CDN
   * leaves exactly one card with dashes. Reporting that as 'complete' would let
   * the UI imply the dashes mean something about the study rather than about the
   * deploy.
   */
  | 'partial'
  /** Registry only — the manifest was absent, stale, or predates `datasets`. */
  | 'registry-only';

export interface DatasetCard {
  dataset: Dataset;
  /** Author-source/result validation is bundled with the registry, so it is
   *  present on the first frame and cannot drift with the remote query index. */
  validation: AuthorValidationRecord;
  /** Baseline and case groups of the dataset's DEFAULT contrast, resolved so the
   *  card can name arms in the dataset's own vocabulary ("Chow"/"HFD"), never
   *  the `nNormal`/`nObese` the bundles happen to key them by. */
  baselineGroup: Group | null;
  caseGroup: Group | null;
  /** Replicates in each arm of the default track. Null when unmeasured. */
  nBaseline: number | null;
  nCase: number | null;
  /** True when other tracks in this dataset disagree with those counts — the
   *  macaque atlas is 3v3 on 55 of 60 populations and 3v2 or 2v3 on five. A card
   *  showing a flat N without this flag is overclaiming. */
  nVaries: boolean;
  /** Tracks with an arm below n=3. */
  lowPowerTracks: number;
  /** Browsable tracks. Null when unmeasured (NOT 1 — that would be a claim). */
  trackCount: number | null;
  /** The default track's label: the tissue actually analysed. */
  trackLabel: string | null;
  /** Features detected in the default track. */
  nGenes: number | null;
  /**
   * What the default track FOUND, at the app's FDR cutoff, or null when the
   * index predates the field.
   *
   * Null is not zero and the card must not conflate them. Zero genes at FDR 0.05
   * is the answer for 38% of single-track datasets and is worth printing; a null
   * means this deploy's index is older than the feature and the card has nothing
   * to say. Rendering the second as the first would invent a result.
   */
  discoveries: DiscoverySummary | null;
}

export interface DatasetCatalog {
  cards: DatasetCard[];
  state: CatalogState;
}

/** Registry-only card: everything measured is null, nothing is guessed. */
function bareCard(dataset: Dataset): DatasetCard {
  const contrast = getActiveContrast(dataset);
  return {
    dataset,
    validation: requireAuthorValidation(dataset.id),
    baselineGroup: contrast?.baseline ?? null,
    caseGroup: contrast?.caseGroup ?? null,
    nBaseline: null,
    nCase: null,
    nVaries: false,
    lowPowerTracks: 0,
    trackCount: null,
    trackLabel: null,
    nGenes: null,
    discoveries: null,
  };
}

function merge(dataset: Dataset, summary: DatasetSummary): DatasetCard {
  const card = bareCard(dataset);
  return {
    ...card,
    nBaseline: summary.nBaseline,
    nCase: summary.nCase,
    nVaries: summary.nVaries,
    lowPowerTracks: summary.lowPowerTracks,
    trackCount: summary.trackCount,
    trackLabel: summary.trackLabel,
    nGenes: summary.nGenes,
    discoveries: summary.discoveries ?? null,
  };
}

/**
 * Every registered dataset as a card, from the bundled registry alone — no
 * request, no await.
 *
 * This is what the library renders FIRST. Blocking the whole view on a network
 * fetch would be the wrong trade twice over: the identity half of every card is
 * already in the JS bundle, and a request that stalls rather than fails (a slow
 * CDN, a captive portal) would leave a spinner on screen indefinitely. Names,
 * facets and filtering all work immediately; the measured numbers fill in.
 */
export function registryCards(): DatasetCard[] {
  return listDatasets().map(bareCard);
}

/**
 * Every registered dataset as a browse card, in registry order.
 *
 * The REGISTRY decides which datasets exist, not the manifest: a dataset the
 * manifest has no summary for still gets a card (registry-only), because the
 * user can reach it through a deep link or a report either way and a missing
 * card would read as "we don't have that study". The reverse — a summary for a
 * dataset the registry dropped — is ignored, since there is nothing to render.
 *
 * Never rejects. A failed manifest load resolves to `registry-only`.
 */
export function loadDatasetCatalog(): Promise<DatasetCatalog> {
  const datasets = listDatasets();
  return loadQueryManifest(datasets)
    .then((manifest) => {
      const summaries = manifest?.datasets;
      if (!manifest || !summaries?.length) return { cards: datasets.map(bareCard), state: 'registry-only' as const };
      // Matching dataset/contrast names does not detect changed sample membership.
      // Keep old remote counts out of cards carrying this build's QC assessments.
      const expectedBuild = typeof __QUERY_CATALOG_BUILD_ID__ === 'string' ? __QUERY_CATALOG_BUILD_ID__ : null;
      const expectedContent = typeof __QUERY_CATALOG_CONTENT__ === 'string' ? __QUERY_CATALOG_CONTENT__ : null;
      if (!expectedBuild || manifest.buildId !== expectedBuild || !expectedContent
        || queryCatalogContent(manifest) !== expectedContent) {
        console.warn(`[datasetCatalog] query catalog belongs to a different app data build; measured counts are unavailable. ${REBUILD_HINT}`);
        return { cards: datasets.map(bareCard), state: 'registry-only' as const };
      }
      const byId = new Map(summaries.map((s) => [s.ds, s]));
      const problems: string[] = [];
      const cards = datasets.map((d) => {
        const s = byId.get(d.id);
        // Matching on id alone is not enough to know the summary describes THIS
        // definition of the dataset. The bundles and the index deploy off-origin
        // on their own schedule, so an id can be shared across two corpora — and
        // if the registry has since changed which track is default, the measured
        // N and gene count belong to a different track than the one the card
        // names and "Open" would enter. Same id, wrong numbers, no error.
        //
        // The corpus identity above also guards changed N with unchanged names.
        const cardProblems = datasetFreshnessProblems(manifest, d, ['defaultTrack', 'contrast']);
        if (s && cardProblems.length === 0) return merge(d, s);
        problems.push(...cardProblems);
        return bareCard(d);
      });
      if (problems.length) {
        console.warn(
          '[datasetCatalog] some browse summaries are stale; those cards show no replicate or feature counts:\n  '
          + `${problems.join('\n  ')}\n${REBUILD_HINT}`,
        );
      }
      return { cards, state: problems.length ? ('partial' as const) : ('complete' as const) };
    })
    .catch(() => ({ cards: datasets.map(bareCard), state: 'registry-only' as const }));
}
