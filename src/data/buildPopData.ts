// Pure transform from the raw track data shape produced by
// data/scripts/preprocess_multi.py (and the migration generator) into the
// React-friendly shape consumed by components.
//
// buildPopData(rawTrack, dataset, contrast) → transformed popData
//
// `dataset` is REQUIRED. It used to default to the macaque snRNA dataset when
// omitted, which meant a caller that forgot it (CompareTab did) silently got a
// macaque transform — the wrong expression unit and the wrong contrast's DE
// table — with no error. Requiring it is also what keeps this a pure transform:
// the module no longer imports the dataset registry to look up a fallback.
// `contrast` stays nullable, since a dataset can legitimately resolve none.
import { DB_NAMES } from './constants';
import { CPM_TMM_UNIT } from './expressionUnits';
import { deTableFor, strictDeTableFor, groupSamplesOf } from './rawTrack';
import type {
  Dataset,
  GeneDERecord,
  PathwayRecordWithDb,
  PopData,
  RawTrack,
  ResolvedContrast,
} from '../types';

// buildPopData runs on every render of every track, so a bare console.warn here
// would print thousands of identical lines and bury the message it is trying to
// deliver. Keyed by dataset/track/contrast: one line per affected CONTRAST per
// session — bounded by the manifest's contrast count, and each contrast is its
// own fault with its own remedy, so collapsing them would hide which are broken.
const warnedKeys = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

/** Test-only: forget which bundles have already warned. */
export function _resetBuildPopDataWarnings(): void {
  warnedKeys.clear();
}

export function buildPopData(
  rawTrack: RawTrack | null | undefined,
  dataset: Dataset,
  contrast: ResolvedContrast | null,
): PopData | null {
  if (!rawTrack) return null;

  const contrastId = contrast?.id;
  const defaultContrastId =
    (dataset.contrasts?.find((c) => c.isDefault) ?? dataset.contrasts?.[0])?.id;
  const isNonDefault = Boolean(contrastId && contrastId !== defaultContrastId);

  // Legacy unkeyed tables belong only to the registered default. Missing
  // non-default results must stay empty, including in across-comparison views.
  const de = contrastId
    ? strictDeTableFor(rawTrack, contrastId, defaultContrastId)
    : deTableFor(rawTrack, contrastId);
  const pathwaysBlock =
    (contrastId ? rawTrack.pathwaysByContrast?.[contrastId] : undefined)
    ?? (isNonDefault ? undefined : rawTrack.pathways);

  // A MULTI-contrast dataset served a bundle with no table for the active
  // contrast is the one back-compat fallback that lies: `de` is the default
  // contrast's table, so every contrast would render identical numbers under
  // different arm labels — a stale deploy (bundles not re-uploaded after a
  // dataset gained contrasts) looks exactly like a real null result. The
  // fallback is refused, and the warning identifies the table to rebuild.
  // Single-contrast datasets are the legitimate legacy case and never warn.
  //
  // The DEFAULT contrast never warns either, and that exemption is load-bearing
  // rather than a courtesy: the bundle format deliberately keeps the default
  // contrast's table in `de` and only the OTHERS in `deByContrast` — exactly as
  // the pathway sibling splits `{ default, byContrast }`. So on the default
  // contrast the fallback is the format working, not a stale deploy. Without
  // this the warning fired on every correct multi-contrast bundle, on the
  // contrast that loads first (verified against the shipped GSE135639 bundle),
  // which is precisely the cry-wolf that makes a real stale-bundle warning
  // unreadable.
  //
  // An EMPTY per-contrast table is the second half of the same fault and needs
  // its own sentence: deTableFor coalesces with `??`, so [] counts as present
  // and there is NO fallback — the explorer renders a blank volcano. Silent
  // either way without this, and the two causes want different fixes.
  const contrastTable = contrastId ? rawTrack.deByContrast?.[contrastId] : undefined;
  if (
    contrastId
    && contrastId !== defaultContrastId
    && dataset.contrasts?.length > 1
    && !contrastTable?.length
  ) {
    const prefix = `buildPopData: "${dataset.id}" declares ${dataset.contrasts.length} contrasts, but its `;
    warnOnce(
      `${dataset.id}/${rawTrack.meta?.code ?? '?'}/${contrastId}`,
      contrastTable
        ? prefix
          + `track bundle carries an EMPTY DE table for "${contrastId}" — this contrast will `
          + 'render no genes at all, and no fallback applies. The bundle builder wrote a table '
          + 'it could not parse; rebuild it and check the DE writer\'s column names.'
        : prefix
          + `track bundle carries no DE table for "${contrastId}" — results are unavailable for `
          + 'this contrast. The default contrast\'s numbers are not substituted; rebuild and redeploy the bundle.',
    );
  }

  // allPathways: empty when the dataset doesn't support pathways, or when the
  // raw track simply has no pathways block (e.g. a miRNA modality).
  const allPathways: PathwayRecordWithDb[] = [];
  if (dataset.supportsPathways && pathwaysBlock) {
    for (const db of DB_NAMES) {
      const list = pathwaysBlock[db];
      if (!list) continue;
      for (const p of list) allPathways.push({ ...p, db });
    }
  }

  // groupSamples: resolved by the raw-track reader (migration-added
  // meta.groupSamples, else the legacy normalSamples/obeseSamples pair). The
  // "declares neither" default is THIS caller's: popData.groupSamples is
  // non-optional and its consumers index it by group key, so the two empty
  // macaque arms stand in — the reader itself returns null there.
  const meta = rawTrack.meta ?? {};
  const groupSamples: Record<string, string[]> =
    groupSamplesOf(rawTrack) ?? { normal: [], obese: [] };
  // sampleOrder: prefer meta.sampleOrder; else the legacy sampleNames.
  const sampleOrder = meta.sampleOrder ?? meta.sampleNames ?? [];

  // groups: the two ordered group objects [baseline, caseGroup].
  const groups = contrast ? [contrast.baseline, contrast.caseGroup] : [];

  return {
    dataset,
    de,
    deByGene: Object.fromEntries(de.map((d) => [d.gene, d])) as Record<string, GeneDERecord>,
    geneNames: de.map((d) => d.gene),
    cpm: rawTrack.cpm,
    qc: rawTrack.qc ?? null,
    volcanoPts: de.map((d) => ({
      gene: d.gene,
      logfc: d.logFC,
      pval: d.PValue,
      fdr: d.FDR,
      yPval: -Math.log10(d.PValue + 1e-300),
      // null FDR (small-n designs, serialized from R's NA) means UNKNOWN, not
      // zero: `?? 0` here used to yield yFdr = 300 — plotting an unknown-FDR
      // gene as the most significant point on the volcano. Unknown plots at 0.
      yFdr: d.FDR == null ? 0 : -Math.log10(d.FDR + 1e-300),
    })),
    allPathways,
    meta: rawTrack.meta,
    contrast,
    groups,
    groupSamples,
    sampleOrder,
    // Per-dataset expression unit for honest axis labelling (count datasets =
    // CPM (TMM-normalized), GSE220533 = log2-normalized). Manifest is
    // authoritative; fall back to the count-dataset unit.
    expressionUnit: dataset.expressionUnit ?? rawTrack.meta?.expressionUnit ?? CPM_TMM_UNIT,
  };
}
