/**
 * Macaque atlas internal QC after the R 4.6.0 regeneration (September 25, 2026).
 *
 * data/raw/scripts/run_atlas_r460.R now persists what run_all_clusters.R kept in
 * memory: the per-animal pseudobulk counts (data/raw/pseudobulk), filtered and
 * effective library sizes with TMM factors (qc/library_sizes.csv) and per-run
 * provenance. This successor of the saved-output audit in macaqueQc.mts (which
 * stays byte-identical, pinned by retained evidence) therefore adds a refit of
 * every app population from the committed pseudobulk
 * (scripts/audit_macaque_normalization_r460.R). The saved-output checks are the
 * ones in macaqueQc.mts; only the checks the refit can now measure are replaced.
 */
import { createHash } from 'node:crypto';
import { aggregateQualityChecks, type QualityAssessment, type QualityCheck } from '../../src/data/qualityChecks';
import { INTERNAL_QC_POLICY, assessment, qualityCheck } from './internalQc.mjs';
import { provenanceHashMatches } from './internalQcR460.mjs';
import { MACAQUE_CHECK_IDS, MACAQUE_HASH_SCHEME, atlasFingerprint, type MacaqueTrackAudit } from './macaqueQc.mjs';

export { provenanceHashMatches };
export const MACAQUE_R460_AUDIT_VERSION = 'macaque-pseudobulk-refit-r460-v1';
/** Text inputs: MACAQUE_HASH_SCHEME from macaqueQc.mts. The gzip pseudobulk archives: exact bytes. */
export const MACAQUE_R460_HASH_SCHEME = `${MACAQUE_HASH_SCHEME}+gzip-exact`;
export const MACAQUE_R460_EVIDENCE = 'data/internal-qc/advancement-r460-2026-09-25/macaque/atlas-evidence.json';
export const MACAQUE_R460_REPLAY = 'data/internal-qc/advancement-r460-2026-09-25/macaque/pseudobulk-refit.json';
export const MACAQUE_R460_SOURCE_PATHS = [
  'data/raw/scripts/run_atlas_r460.R', 'data/scripts/preprocess_multi.py',
  'scripts/migrate_macaque_bundles.mts', 'scripts/lib/bundleSlim.mts', 'scripts/add_macaque_se.mts',
  'scripts/lib/internalQc.mts', 'src/data/qualityChecks.ts', 'scripts/lib/macaqueQc.mts', 'scripts/lib/macaqueQcR460.mts',
  'scripts/audit_macaque_internal_qc_r460.mts', 'scripts/audit_macaque_normalization_r460.R', 'public/datasets/macaque_snrna/meta.js',
  'data/raw/results/_global/composition/cell_counts_by_sample_and_cluster_long.csv',
  'data/raw/results/_global/summary/run_status.csv', 'data/raw/results/_global/RUN_provenance.tsv',
  'data/raw/pseudobulk/samples.tsv', 'data/raw/pseudobulk/PSEUDOBULK_provenance.tsv',
];
/** Per-track files, in order: bundle, DE table, TMM CPM, group sizes, pseudobulk counts, library sizes, DE provenance. */
export function macaqueTrackPaths(trackId: string, folder: string): string[] {
  const base = `data/raw/results/${folder}`;
  return [`public/datasets/macaque_snrna/track_${trackId}.js`, `${base}/de/DE_all.csv`, `${base}/de/normcpm.csv`, `${base}/qc/group_sizes.csv`,
    `data/raw/pseudobulk/${folder}.counts.tsv.gz`, `${base}/qc/library_sizes.csv`, `${base}/de/DE_provenance.tsv`];
}

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** Text files use MACAQUE_HASH_SCHEME (CRLF read as LF); gzip archives use their exact bytes. */
export function macaqueR460Fingerprint(path: string, bytes: Uint8Array): string {
  return path.endsWith('.gz') ? sha(bytes) : atlasFingerprint(bytes);
}

export interface MacaqueRefit {
  trackId: string;
  status: 'pass' | 'review' | 'not_assessed';
  note?: string;
  matrix?: { genes: number; sharedGenes: number; samples: string[]; integerNonnegative: boolean; libraryTotals: Record<string, number>; detectedGenes: Record<string, number> };
  filteredGenes?: number;
  librariesMatch?: boolean;
  libraryDeltas?: Record<string, number>;
  cpm?: { rows: number; matchedRows: number; match: boolean };
  de?: { rows: number; matchedRows: number; match: boolean; maxAbsoluteDeltas: Record<string, number> };
  designRank?: number;
  residualDf?: number;
}

/**
 * Replace the checks that the saved-output audit could not measure, using the
 * pseudobulk refit and the producer's provenance record. `provenanceCurrent`
 * says every file hash the DE provenance records matches the current file.
 */
export function refitTrackAudit(base: MacaqueTrackAudit, refit: MacaqueRefit | undefined, provenanceCurrent: boolean, evidence: string[]): MacaqueTrackAudit {
  const measured = !!refit && refit.status !== 'not_assessed' && !!refit.matrix && provenanceCurrent;
  const why = !refit ? 'No pseudobulk refit is recorded for this population.' : !provenanceCurrent
    ? 'The DE provenance record does not match the current pseudobulk, DE or CPM files.' : refit.note ?? '';
  const m = refit?.matrix;
  const totals = m ? Object.values(m.libraryTotals) : [];
  const detected = m ? Object.values(m.detectedGenes) : [];
  const replace: Record<string, QualityCheck> = {
    source_integrity: qualityCheck('source_integrity', 'Source file integrity', 'not_assessed', 'The pseudobulk counts are committed and bound to this audit by SHA-256, and data/raw/pseudobulk/samples.tsv records the size and SHA-256 of the six source Seurat objects. Those objects are not in the repository, so their bytes cannot be remeasured here.', evidence),
    matrix_values: qualityCheck('matrix_values', 'Input matrix values', !measured ? 'not_assessed' : m!.integerNonnegative ? 'pass' : 'fail', !measured ? why
      : `The committed per-animal pseudobulk (${m!.genes.toLocaleString('en-US')} genes, ${m!.sharedGenes.toLocaleString('en-US')} complete across the ${m!.samples.length} retained samples) ${m!.integerNonnegative ? 'holds finite, nonnegative integer counts' : 'holds non-integer, negative or non-finite values'}.`, evidence),
    library_detection: qualityCheck('library_detection', 'Library size and detected features', !measured ? 'not_assessed' : totals.every((v) => v > 0) && detected.every((v) => v > 0) ? 'pass' : 'fail', !measured ? why
      : `Retained pseudobulk libraries total ${Math.min(...totals).toLocaleString('en-US')} to ${Math.max(...totals).toLocaleString('en-US')} counts with ${Math.min(...detected).toLocaleString('en-US')} to ${Math.max(...detected).toLocaleString('en-US')} detected genes. This is an integrity gate, not a sequencing-depth threshold.`, evidence),
    count_conservation: qualityCheck('count_conservation', 'Count conservation', 'not_assessed', 'The pseudobulk sums nucleus counts from the six source Seurat objects, which are not in the repository; nucleus-to-pseudobulk conservation cannot be remeasured here. The pseudobulk-to-model library totals are checked under normalization.', evidence),
    normalization: qualityCheck('normalization', 'Normalization and transformation', !measured ? 'not_assessed' : refit!.librariesMatch && refit!.cpm?.match ? 'pass' : 'review', !measured ? why
      : refit!.librariesMatch && refit!.cpm?.match ? `An independent refit from the committed pseudobulk reproduces the saved unfiltered and filtered library sizes, TMM factors and effective library sizes, and all ${refit!.cpm!.rows.toLocaleString('en-US')} saved TMM-normalized CPM rows within absolute 1e-6 + relative 1e-6 tolerance.`
        : 'The pseudobulk refit does not reproduce the saved library sizes, TMM factors or normalized CPM.', evidence),
    model_validity: qualityCheck('model_validity', 'Model design and input scale', !measured ? 'not_assessed' : refit!.de?.match && refit!.designRank === 2 && (refit!.residualDf ?? 0) > 0 ? 'pass' : 'review', !measured ? why
      : refit!.de?.match ? `The declared intercept + Obese edgeR QL model on raw pseudobulk counts refits with rank ${refit!.designRank}/2 and ${refit!.residualDf} residual degrees of freedom, and reproduces all ${refit!.de!.rows.toLocaleString('en-US')} saved DE rows (logFC, logCPM, F, P value and FDR) within absolute 1e-6 + relative 1e-6 tolerance. This does not establish a confound-free biological design.`
        : 'The pseudobulk refit does not reproduce every saved DE statistic.', evidence),
  };
  const checks = base.assessment.checks.map((check) => replace[check.id] ?? check);
  return { ...base, assessment: assessment(checks, `macaque_snrna/obese_vs_normal; track ${base.trackId}; saved outputs, committed pseudobulk refit and local sample assignments`) };
}

export function aggregateMacaqueTracksR460(tracks: MacaqueTrackAudit[]): QualityAssessment {
  if (!tracks.length) return assessment([qualityCheck('audit_scope', 'Atlas audit coverage', 'not_assessed', 'No atlas tracks were assessed.')], 'macaque_snrna; no tracks');
  const checks = tracks[0].assessment.checks.map((check) => {
    const entries = tracks.map((track) => ({ ...track.assessment.checks.find((entry) => entry.id === check.id)!, trackId: track.trackId }));
    const status = aggregateQualityChecks(entries);
    const nonpassing = entries.filter((entry) => entry.status === status).map((entry) => entry.trackId);
    return { ...check, status, evidence: [MACAQUE_R460_EVIDENCE],
      note: `${entries.filter((entry) => entry.status === 'pass').length}/${tracks.length} app tracks pass. ${status === 'review' || status === 'fail' ? `Tracks requiring ${status}: ${nonpassing.join(', ')}. ` : ''}${entries.find((entry) => entry.status === status)?.note ?? check.note}` };
  });
  return assessment(checks, `macaque_snrna/obese_vs_normal; all ${tracks.length} app tracks; saved outputs and a refit from the committed pseudobulk; nucleus-level processing remains unverified`);
}

const sameSet = (a: string[], b: string[]): boolean => {
  const aSet = new Set(a), bSet = new Set(b);
  return a.length === b.length && aSet.size === a.length && bSet.size === b.length && a.every((item) => bSet.has(item));
};

/** Saved successor evidence is usable only for exactly the current tracks and file fingerprints. */
export function macaqueR460EvidenceCurrent(evidence: { auditVersion: string; fingerprintScheme: string; trackIds: string[]; tracks: MacaqueTrackAudit[]; fingerprints: Record<string, string> }, trackIds: string[], current: Record<string, string>): boolean {
  if (!Array.isArray(trackIds) || !Array.isArray(evidence.trackIds) || !Array.isArray(evidence.tracks) || !evidence.fingerprints) return false;
  const validTrack = (track: MacaqueTrackAudit): boolean => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(track.trackId) || !Array.isArray(track.paths) || track.paths.length !== 7) return false;
    const folder = track.paths[1].match(/^data\/raw\/results\/([^/]+)\/de\/DE_all\.csv$/)?.[1];
    const checks = track.assessment?.checks;
    return !!folder && folder.startsWith(`${track.trackId}__`) && JSON.stringify(track.paths) === JSON.stringify(macaqueTrackPaths(track.trackId, folder))
      && track.paths.every((path) => !!current[path])
      && Array.isArray(checks) && sameSet(checks.map((check) => check?.id), MACAQUE_CHECK_IDS)
      && checks.every((check) => check && typeof check.label === 'string' && typeof check.note === 'string'
        && check.required !== false && ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'].includes(check.status))
      && track.assessment.policyVersion === INTERNAL_QC_POLICY && typeof track.assessment.scope === 'string'
      && track.assessment.status === aggregateQualityChecks(checks);
  };
  return evidence.auditVersion === MACAQUE_R460_AUDIT_VERSION && evidence.fingerprintScheme === MACAQUE_R460_HASH_SCHEME && sameSet(evidence.trackIds, trackIds)
    && sameSet(evidence.tracks.map((track) => track.trackId), trackIds)
    && sameSet(Object.keys(evidence.fingerprints), Object.keys(current))
    && sameSet(Object.keys(current), [...new Set([...MACAQUE_R460_SOURCE_PATHS, MACAQUE_R460_REPLAY, ...evidence.tracks.flatMap((track) => track.paths ?? [])])])
    && evidence.tracks.every(validTrack)
    && Object.entries(current).every(([path, hash]) => !!hash && hash === evidence.fingerprints[path]);
}
