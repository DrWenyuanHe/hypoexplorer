import { createHash } from 'node:crypto';
import { aggregateQualityChecks, type QualityAssessment, type QualityCheck } from '../../src/data/qualityChecks';
import { roundProb } from './bundleSlim.mjs';
import { INTERNAL_QC_POLICY, assessment, numeric, qualityCheck, splitCells, type EvidenceRow } from './internalQc.mjs';

export const MACAQUE_AUDIT_VERSION = 'macaque-saved-output-v2';
export const MACAQUE_HASH_SCHEME = 'sha256-utf8-crlf-to-lf-v1';
/** Atlas evidence contains text only. Preserve every character except CRLF line-ending form. */
export function atlasFingerprint(bytes: Uint8Array | string): string {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
export const MACAQUE_SAMPLES = Array.from({ length: 6 }, (_, i) => `HCA_Macaque001_S00${i + 1}`);
export const MACAQUE_SOURCE_PATHS = [
  'data/raw/scripts/run_all_clusters.R', 'data/scripts/preprocess_multi.py',
  'scripts/migrate_macaque_bundles.mts', 'scripts/lib/bundleSlim.mts', 'scripts/add_macaque_se.mts',
  'scripts/lib/internalQc.mts', 'src/data/qualityChecks.ts', 'scripts/lib/macaqueQc.mts',
  'scripts/audit_macaque_internal_qc.mts', 'public/datasets/macaque_snrna/meta.js',
  'data/raw/results/_global/composition/cell_counts_by_sample_and_cluster_long.csv',
  'data/raw/results/_global/summary/run_status.csv',
];
export const MACAQUE_CHECK_IDS = ['source_integrity', 'sample_assignment', 'independent_replication', 'retained_sample_support',
  'matrix_values', 'library_detection', 'count_conservation', 'normalization', 'model_validity', 'design_identifiability',
  'output_integrity', 'normalized_output_integrity', 'run_completion'];

/** Parse one JSON assignment without executing downloaded or generated JavaScript. */
export function parseMacaqueBundle(text: string): any {
  const source = text.replace(/^(?:\s*\/\/[^\n]*(?:\n|$))*/, '').trim();
  const match = source.match(/^(?:var|let|const)\s+\w+\s*=\s*/);
  if (!match) throw new Error('Expected one JSON bundle assignment');
  return JSON.parse(source.slice(match[0].length).replace(/;\s*$/, ''));
}

export function parseMacaqueCsv(text: string): { header: string[]; rows: EvidenceRow[] } {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = splitCells(lines[0], ',');
  if (new Set(header).size !== header.length) throw new Error('Duplicate CSV columns');
  return { header, rows: lines.slice(1).map((line) => {
    const cells = splitCells(line, ',');
    if (cells.length !== header.length) throw new Error('Malformed CSV row');
    return Object.fromEntries(header.map((column, i) => [column, cells[i]]));
  }) };
}

export interface MacaqueProtocol {
  groups: Record<string, string>;
  minimumCells: number;
  aliases: Record<string, string>;
  valid: boolean;
}

/** Read the explicit condition/cluster map; a changed scientific protocol invalidates the audit. */
export function macaqueProtocol(script: string): MacaqueProtocol {
  const conditionBlock = script.match(/cond_map\s*<-\s*c\(([\s\S]*?)\)/)?.[1] ?? '';
  const groups = Object.fromEntries([...conditionBlock.matchAll(/(HCA_Macaque001_S\d{3})\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const minimumCells = Number(script.match(/MIN_CELLS\s*<-\s*(\d+)/)?.[1]);
  const aliases = Object.fromEntries([...script.matchAll(/list\(meta="([^"]+)",\s*id="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  return { groups, minimumCells, aliases, valid: minimumCells === 15 && Object.keys(groups).length === 6
    && MACAQUE_SAMPLES.every((sample, i) => groups[sample] === (i < 3 ? 'Normal' : 'Obese'))
    && /design\s*<-\s*model.matrix\(~ grp\)/.test(script) && /coef\s*=\s*"grpObese"/.test(script) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a: string[], b: string[]): boolean => {
  const aSet = new Set(a), bSet = new Set(b);
  return a.length === b.length && aSet.size === a.length && bSet.size === b.length && a.every((item) => bSet.has(item));
};
const rounded4 = (a: unknown, b: unknown): boolean => numeric(a) != null && numeric(b) != null && Math.abs(Number(a) - Number(b)) <= 0.000050001;

export interface MacaqueTrackInput {
  id: string;
  bundle: any;
  datasetMeta: any;
  de: EvidenceRow[];
  cpm: { header: string[]; rows: EvidenceRow[] };
  groupRows: EvidenceRow[];
  composition: EvidenceRow[];
  runRows: EvidenceRow[];
  protocol: MacaqueProtocol;
  evidence: string[];
}

export interface MacaqueTrackAudit {
  trackId: string;
  samplesKept: string[];
  normalSamples: string[];
  obeseSamples: string[];
  cells: Record<string, number>;
  droppedSamples: string[];
  deRows: number;
  cpmValues: number;
  designRank: number;
  residualDf: number;
  problems: Record<string, number>;
  assessment: QualityAssessment;
  paths?: string[];
}

export function auditMacaqueTrack(input: MacaqueTrackInput): MacaqueTrackAudit {
  const { id, bundle, datasetMeta, de, cpm, groupRows, composition, runRows, protocol, evidence } = input;
  const qc = groupRows[0] ?? {};
  const kept = (qc.samples_kept ?? '').split(';').filter(Boolean);
  const normal = kept.filter((sample) => protocol.groups[sample] === 'Normal');
  const obese = kept.filter((sample) => protocol.groups[sample] === 'Obese');
  const dropped = MACAQUE_SAMPLES.filter((sample) => !kept.includes(sample));
  const cells: Record<string, number> = Object.fromEntries(MACAQUE_SAMPLES.map((sample) => [sample, 0]));
  const compositionRows = composition.filter((row) => (protocol.aliases[row.cluster.toLowerCase()] ?? row.cluster) === id);
  let compositionProblems = new Set(compositionRows.map((row) => row.sample)).size === compositionRows.length ? 0 : 1;
  for (const row of compositionRows) {
    const value = numeric(row.n_cells);
    if (!MACAQUE_SAMPLES.includes(row.sample) || value == null || value <= 0 || !Number.isInteger(value)) compositionProblems++;
    else cells[row.sample] = value;
  }
  const expectedKept = MACAQUE_SAMPLES.filter((sample) => cells[sample] >= protocol.minimumCells);
  const flag = datasetMeta.qcFlags?.[id];
  const assignmentValid = protocol.valid && groupRows.length === 1 && qc.cluster === id && Number(qc.min_cells) === protocol.minimumCells
    && Number(qc.n_normal) === normal.length && Number(qc.n_obese) === obese.length && sameSet(kept, expectedKept)
    && qc.is_3v3 === String(normal.length === 3 && obese.length === 3).toUpperCase()
    && bundle.meta?.code === id && same(bundle.meta.sampleNames, MACAQUE_SAMPLES) && same(bundle.meta.sampleOrder, MACAQUE_SAMPLES)
    && same(bundle.meta.normalSamples, MACAQUE_SAMPLES.slice(0, 3)) && same(bundle.meta.obeseSamples, MACAQUE_SAMPLES.slice(3))
    && same(bundle.meta.groupSamples, { normal: MACAQUE_SAMPLES.slice(0, 3), obese: MACAQUE_SAMPLES.slice(3) })
    && same(bundle.meta.samplesKept, kept) && same(bundle.qc?.samplesKept, kept)
    && bundle.qc?.cluster === id && bundle.qc?.nNormal === normal.length && bundle.qc?.nObese === obese.length
    && bundle.qc?.minCells === protocol.minimumCells && bundle.qc?.is3v3 === (normal.length === 3 && obese.length === 3)
    && flag?.nNormal === normal.length && flag?.nObese === obese.length && flag?.minCells === protocol.minimumCells && flag?.is3v3 === bundle.qc.is3v3
    && same(cpm.header, ['gene', ...kept]) && !compositionProblems;

  const source = new Map(de.map((row) => [row.gene, row]));
  const display = Array.isArray(bundle.de) ? bundle.de : [];
  const displayGenes = display.map((row: any) => row.gene);
  let statisticalProblems = !de.length || source.size !== de.length || !sameSet(displayGenes, [...source.keys()]) ? 1 : 0;
  let bhProblems = 0;
  // Recompute BH from the saved complete tested universe, independently of the fitted model.
  const ordered = [...de].sort((a, b) => Number(a.PValue) - Number(b.PValue));
  let adjusted = 1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const row = ordered[i];
    const p = numeric(row.PValue), fdr = numeric(row.FDR), effect = numeric(row.logFC), logcpm = numeric(row.logCPM), f = numeric(row.F);
    if (!row.gene || p == null || p < 0 || p > 1 || fdr == null || fdr < 0 || fdr > 1 || effect == null || logcpm == null || f == null || f < 0) statisticalProblems++;
    adjusted = Math.min(adjusted, Number(p) * ordered.length / (i + 1));
    if (fdr == null || Math.abs(adjusted - fdr) > 1e-10) bhProblems++;
  }
  for (const row of display) {
    const original = source.get(row.gene);
    if (!original || !rounded4(row.logFC, original.logFC) || !rounded4(row.logCPM, original.logCPM)
      || row.PValue !== roundProb(Number(original.PValue)) || row.FDR !== roundProb(Number(original.FDR)) || row.se !== null) statisticalProblems++;
  }
  if (bundle.meta?.nGenes !== de.length || datasetMeta.nGenes?.[id] !== de.length) statisticalProblems++;

  const cpmGenes = cpm.rows.map((row) => row.gene);
  let cpmProblems = !sameSet(cpmGenes, [...source.keys()]) || !sameSet(Object.keys(bundle.cpm ?? {}), cpmGenes) ? 1 : 0;
  let cpmValues = 0;
  for (const row of cpm.rows) {
    const values = bundle.cpm?.[row.gene];
    if (!Array.isArray(values) || values.length !== 6) { cpmProblems++; continue; }
    for (let i = 0; i < MACAQUE_SAMPLES.length; i++) {
      const sample = MACAQUE_SAMPLES[i];
      if (!kept.includes(sample)) { if (values[i] !== null) cpmProblems++; continue; }
      const value = numeric(row[sample]);
      if (value == null || value < 0 || !rounded4(values[i], value)) cpmProblems++;
      cpmValues++;
    }
  }
  const run = runRows.filter((row) => row.cluster === id);
  const rank = normal.length && obese.length ? 2 : kept.length ? 1 : 0;
  const residualDf = kept.length - rank;
  const checks: QualityCheck[] = [
    qualityCheck('source_integrity', 'Source file integrity', 'not_assessed', 'Saved result hashes bind this audit to current local outputs. The original Seurat count objects and their authenticated source manifest are absent.', evidence),
    qualityCheck('sample_assignment', 'Sample and group assignments', assignmentValid ? 'pass' : 'fail', `${normal.length} Normal and ${obese.length} Obese retained samples. Checked the R condition map, MIN_CELLS=15, saved composition counts, group_sizes.csv, bundle metadata, canonical six-slot CPM layout and null padding for excluded samples. These are local analysis assignments; animal identities need an external link.`, evidence),
    qualityCheck('independent_replication', 'Independent biological replication', 'not_assessed', 'Lei Data S4 names animals M1-M6. No original object metadata or source crosswalk linking those animals to HCA_Macaque001_S001-S006 is available here. Distinct local sample names do not prove independent animals.', evidence),
    qualityCheck('retained_sample_support', 'Retained sample support', !assignmentValid ? 'fail' : Math.min(normal.length, obese.length) < 2 ? 'fail' : Math.min(normal.length, obese.length) < 3 ? 'review' : 'pass', `${normal.length} Normal and ${obese.length} Obese samples have at least ${protocol.minimumCells} recorded nuclei each. ${dropped.length ? `Excluded: ${dropped.join(', ')}. Two samples in one arm require review.` : 'All six samples are retained.'} This checks recorded sample support, not animal independence or upstream nucleus QC.`, evidence),
    qualityCheck('matrix_values', 'Input matrix values', 'not_assessed', 'Raw per-sample pseudobulk counts were constructed in memory and not saved. Normalized CPM cannot verify raw input values.', evidence),
    qualityCheck('library_detection', 'Library size and detected features', 'not_assessed', 'Raw pseudobulk library totals and pre-filter feature detection cannot be recovered from rounded normalized CPM alone.', evidence),
    qualityCheck('count_conservation', 'Count conservation', 'not_assessed', 'Original nucleus count matrices and pseudobulk count matrices are both required to remeasure row-sum conservation.', evidence),
    qualityCheck('normalization', 'Normalization and transformation', 'not_assessed', 'The script declares filterByExpr and TMM, but counts, filtered library sizes and TMM factors were not persisted. Matching the saved CPM export is not a normalization replay.', evidence),
    qualityCheck('model_validity', 'Model design and input scale', 'not_assessed', 'The declared Normal-to-Obese edgeR QL model is identifiable from the retained sample assignments, but its raw input scale, dispersions and fit cannot be independently replayed without the original counts.', evidence),
    qualityCheck('design_identifiability', 'Declared design identifiability', protocol.valid && assignmentValid && rank === 2 && residualDf > 0 ? 'pass' : 'fail', `Recomputed the declared intercept + Obese indicator design: rank ${rank}/2, residual degrees of freedom ${residualDf}. This does not establish a confound-free biological design or replay the fitted model.`, evidence),
    qualityCheck('output_integrity', 'Result integrity and statistical values', statisticalProblems || bhProblems ? 'fail' : 'pass', `${de.length} saved DE rows compared with every displayed gene. Checked finite logFC/logCPM and nonnegative F, P/FDR bounds, complete gene coverage, four-decimal effect export, guarded probability rounding and null standard errors. Independently recomputed BH FDR over all tested genes. ${statisticalProblems} output discrepancies; ${bhProblems} BH discrepancies.`, evidence),
    qualityCheck('normalized_output_integrity', 'Normalized expression export integrity', cpmProblems ? 'fail' : 'pass', `${cpmValues} retained-sample CPM values checked across ${cpm.rows.length} genes; nonnegative finite source values match the four-decimal display. Excluded samples must remain null in the six-slot layout. ${cpmProblems} discrepancies. This validates export integrity, not TMM normalization.`, evidence),
    qualityCheck('run_completion', 'Recorded analysis completion', run.length === 1 && run[0].status === 'ok' ? 'pass' : 'fail', 'The current track must have exactly one successful entry in run_status.csv. Failed populations outside the app are listed separately in the atlas audit.', evidence),
  ];
  return { trackId: id, samplesKept: kept, normalSamples: normal, obeseSamples: obese, cells, droppedSamples: dropped, deRows: de.length, cpmValues, designRank: rank, residualDf,
    problems: { assignment: assignmentValid ? 0 : 1, composition: compositionProblems, statistics: statisticalProblems, bh: bhProblems, cpm: cpmProblems },
    assessment: assessment(checks, `macaque_snrna/obese_vs_normal; track ${id}; saved output and local sample assignments`) };
}

export function aggregateMacaqueTracks(tracks: MacaqueTrackAudit[]): QualityAssessment {
  if (!tracks.length) return assessment([qualityCheck('audit_scope', 'Atlas audit coverage', 'not_assessed', 'No atlas tracks were assessed.')], 'macaque_snrna; no tracks');
  const checks = tracks[0].assessment.checks.map((check) => {
    const entries = tracks.map((track) => ({ ...track.assessment.checks.find((entry) => entry.id === check.id)!, trackId: track.trackId }));
    const status = aggregateQualityChecks(entries);
    const nonpassing = entries.filter((entry) => entry.status === status).map((entry) => entry.trackId);
    return { ...check, status, evidence: ['data/internal-qc/advancement-2026-09-05/macaque/atlas-evidence.json'],
      note: `${entries.filter((entry) => entry.status === 'pass').length}/${tracks.length} app tracks pass. ${status === 'review' || status === 'fail' ? `Tracks requiring ${status}: ${nonpassing.join(', ')}. ` : ''}${entries.find((entry) => entry.status === status)?.note ?? check.note}` };
  });
  return assessment(checks, `macaque_snrna/obese_vs_normal; all ${tracks.length} app tracks; saved outputs and local sample assignments; upstream count processing remains unverified`);
}

export function macaqueEvidenceCurrent(evidence: { auditVersion: string; fingerprintScheme: string; trackIds: string[]; tracks: MacaqueTrackAudit[]; fingerprints: Record<string, string> }, trackIds: string[], current: Record<string, string>): boolean {
  if (!Array.isArray(trackIds) || !Array.isArray(evidence.trackIds) || !Array.isArray(evidence.tracks) || !evidence.fingerprints) return false;
  const validTrack = (track: MacaqueTrackAudit): boolean => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(track.trackId) || !Array.isArray(track.paths) || track.paths.length !== 4) return false;
    const [bundle, de, cpm, groups] = track.paths;
    const folder = de.endsWith('/de/DE_all.csv') ? de.slice(0, -'/de/DE_all.csv'.length) : '';
    const checks = track.assessment?.checks;
    return bundle === `public/datasets/macaque_snrna/track_${track.trackId}.js`
      && folder.startsWith(`data/raw/results/${track.trackId}__`) && /^data\/raw\/results\/[^/]+$/.test(folder)
      && cpm === `${folder}/de/normcpm.csv` && groups === `${folder}/qc/group_sizes.csv`
      && track.paths.every((path) => !!current[path])
      && Array.isArray(checks) && sameSet(checks.map((check) => check?.id), MACAQUE_CHECK_IDS)
      && checks.every((check) => check && typeof check.label === 'string' && typeof check.note === 'string'
        && check.required !== false && ['pass', 'review', 'fail', 'not_assessed', 'not_applicable'].includes(check.status))
      && track.assessment.policyVersion === INTERNAL_QC_POLICY && typeof track.assessment.scope === 'string'
      && track.assessment.status === aggregateQualityChecks(checks);
  };
  return evidence.auditVersion === MACAQUE_AUDIT_VERSION && evidence.fingerprintScheme === MACAQUE_HASH_SCHEME && sameSet(evidence.trackIds, trackIds)
    && sameSet(evidence.tracks.map((track) => track.trackId), trackIds)
    && sameSet(Object.keys(evidence.fingerprints), Object.keys(current))
    && sameSet(Object.keys(current), [...new Set([...MACAQUE_SOURCE_PATHS, ...evidence.tracks.flatMap((track) => track.paths ?? [])])])
    && evidence.tracks.every(validTrack)
    && Object.entries(current).every(([path, hash]) => !!hash && hash === evidence.fingerprints[path]);
}
