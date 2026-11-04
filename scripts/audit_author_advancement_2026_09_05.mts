/** Reproducible cohort/source recovery audit for the 28 pre-existing comparisons. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import XLSX from 'xlsx';
import { recoverSourceSymbols } from './lib/authorSourceRecovery.mjs';
import { assessAuthorConcordance, AUTHOR_CONCORDANCE_POLICY } from '../src/data/authorConcordance';
import type { AuthorValidationRecord } from '../src/data/authorValidation';
import { ACTIVE_CONCORDANCE_REVIEWS } from '../src/data/concordanceReviews';

const root = process.cwd();
const dir = 'data/author-validation/continued-sources/advancement-comparisons-2026-09-05';
const bytes = (path: string) => readFileSync(resolve(root, path));
const sha = (path: string) => createHash('sha256').update(bytes(path)).digest('hex');
const read = (path: string) => (path.endsWith('.gz') ? gunzipSync(bytes(path)) : bytes(path)).toString('utf8');
const json = (path: string) => JSON.parse(read(path));
const check = process.argv.includes('--check');
const write = (name: string, value: string) => {
  const path = resolve(root, dir, name);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== value) throw new Error(`${name}: advancement audit is stale`);
  } else writeFileSync(path, value);
};
const save = (name: string, value: unknown) => write(name, `${JSON.stringify(value, null, 2)}\n`);
type Row = Record<string, string | number | null>;
const tsv = (path: string): Row[] => {
  const lines = read(path).trimEnd().split(/\r?\n/);
  const header = lines.shift()!.split('\t');
  return lines.map(line => Object.fromEntries(line.split('\t').map((value, index) => [header[index], value])));
};
const wb = (path: string) => { const file = XLSX.readFile(resolve(root, path)); return { file, rows: XLSX.utils.sheet_to_json<Row>(file.Sheets[file.SheetNames[0]], { defval: null }) }; };
const same = (left: string[], right: string[], context: string) => {
  if (JSON.stringify([...left].sort()) !== JSON.stringify([...right].sort())) throw new Error(`${context}: cohort differs`);
};
const sources: { path: string; sourceUrl: string; sha256: string }[] = [];
const pin = (path: string, sourceUrl: string) => { sources.push({ path, sourceUrl, sha256: sha(path) }); return path; };

const agrpRaw = pin('geo_replication/datasets/GSE68177_mmus_agrp_fedfast/raw/GSE68177_Agrp.Pomc.fedfast.counts.txt.gz', 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE68nnn/GSE68177/suppl/GSE68177_Agrp.Pomc.fedfast.counts.txt.gz');
const agrpWorkbook = pin('geo_replication/datasets/_author_de/GSE68177_elife-09800-supp1-v2.xlsx', 'https://cdn.elifesciences.org/articles/09800/elife-09800-supp1-v2.xlsx');
const rawRows = tsv(agrpRaw);
const workbook = wb(agrpWorkbook);
const recovered = recoverSourceSymbols(workbook.rows, rawRows);
const labelRecovery = workbook.rows.flatMap((row, index) => typeof row.__EMPTY === 'number'
  ? [{ stored: row.__EMPTY, recovered: recovered[index].__EMPTY, ensemblId: row.ensembl_id, locus: row.locus,
    effectsUnchanged: row['adj.lfc.agrp'] === recovered[index]['adj.lfc.agrp'] && row['adj.lfc.pomc'] === recovered[index]['adj.lfc.pomc'] }] : []);
if (labelRecovery.length !== 27 || labelRecovery.some(row => !row.effectsUnchanged)) throw new Error('Reviewed gene-label recovery changed');
const cohorts: Record<string, unknown> = {};
for (const [prefix, id, sheet] of [
  ['Agrp', 'mouse_agrp_fedfast_gse68177', 'geo_replication/datasets/GSE68177_mmus_agrp_fedfast/metadata/GSE68177_samplesheet.tsv'],
  ['Pomc', 'mouse_pomc_fedfast_gse68177', 'geo_replication/datasets/GSE68177_mmus_pomc_fedfast/metadata/GSE68177_POMC_samplesheet.tsv'],
]) {
  pin(sheet, '');
  const local = tsv(sheet);
  const sourceSamples = Object.keys(rawRows[0]).filter(key => key.startsWith(`${prefix}.`));
  const workbookSamples = Object.keys(workbook.rows[0]).filter(key => new RegExp(`^${prefix}\\.(FD|fed)\\.\\d+$`).test(key));
  same(sourceSamples, local.map(row => String(row.sample)), `${id}: original counts`);
  same(workbookSamples.map(name => name.replace('.FD.', '.fast.')), sourceSamples, `${id}: author workbook`);
  if (local.some(row => row.group !== (String(row.sample).includes('.fast.') ? 'case' : 'control'))) throw new Error(`${id}: direction changed`);
  cohorts[id] = { samples: local, sourceSamples, workbookSamples, authorSampleIdentityMatched: true,
    biologicalReplicationEvidence: 'PMC4595745: transcriptomics uses individual animals as replicates, with cell populations collected from single adult mouse brains.' };
}

const chickenBase = 'geo_replication/datasets/GSE202003_ggal_hypothalamus_lcitrulline';
const chickenSheet = pin(`${chickenBase}/metadata/GSE202003_samplesheet.tsv`, '');
const chickenSoft = pin(`${chickenBase}/metadata/GSE202003_family.soft.gz`, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE202nnn/GSE202003/soft/GSE202003_family.soft.gz');
const chickenExpression = pin(`${chickenBase}/raw/GSE202003_Expression.xlsx`, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE202nnn/GSE202003/suppl/GSE202003_Expression.xlsx');
const chickenLocal = tsv(chickenSheet);
const chickenHeaders = Object.keys(wb(chickenExpression).rows[0]);
const chickenSelected = chickenHeaders.filter(key => /^(CON|A)\d+:read count$/.test(key));
same(chickenSelected, chickenLocal.map(row => String(row.source_column)), 'GSE202003 source count columns');
const softSamples = read(chickenSoft).split(/^\^SAMPLE = /m).slice(1).map(block => ({ accession: block.split(/\r?\n/)[0],
  title: block.match(/^!Sample_title = (.*)$/m)?.[1].replace(/\s+/g, '') }));
const selectedSoft = softSamples.filter(row => /^(CON|A)\d+$/.test(row.title ?? ''));
same(selectedSoft.map(row => row.accession), chickenLocal.map(row => String(row.geo_accession)), 'GSE202003 GEO cohort');
if (chickenLocal.length !== 12 || chickenLocal.some(row => row.group !== (String(row.source_column).startsWith('CON') ? 'control' : 'case'))) throw new Error('GSE202003 groups changed');
cohorts.chicken_hypo_lcitrulline_gse202003 = { samples: chickenLocal, sourceCountColumns: chickenSelected,
  geoSamples: selectedSoft, authorSampleIdentityMatched: true,
  biologicalReplicationEvidence: 'GEO and PMC10585647: six independent replicates per treatment, one bird per replicate sampled at day 42. Exact CON/A comparison at thermoneutral 24 C.' };

const ratBase = 'geo_replication/datasets/GSE169296_rnor_pvn_adolescent_stress';
const ratSheet = pin(`${ratBase}/metadata/GSE169296_samplesheet.tsv`, '');
const ratSoft = pin(`${ratBase}/metadata/GSE169296_family.soft.gz`, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE169nnn/GSE169296/soft/GSE169296_family.soft.gz');
const ratSource = pin(`${ratBase}/raw/GSE169296_Male_control_and_stress_PVN.csv.gz`, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE169nnn/GSE169296/suppl/GSE169296_Male_control_and_stress_PVN.csv.gz');
const ratLocal = tsv(ratSheet);
const ratHeaders = read(ratSource).split(/\r?\n/)[0].split(',');
const ratColumns = ratHeaders.filter(header => header.endsWith(' - Expression values'));
same(ratColumns, ratLocal.map(row => String(row.source_column)), 'GSE169296 exact retained source cohort');
const ratGeo = read(ratSoft).split(/^\^SAMPLE = /m).slice(1).filter(block => /^!Sample_title = M\d+ PVN_/m.test(block))
  .map(block => ({ accession: block.split(/\r?\n/)[0], title: block.match(/^!Sample_title = (.*)$/m)?.[1] }));
same(ratGeo.map(row => row.accession), ratLocal.map(row => String(row.geo_accession)), 'GSE169296 GEO cohort');
if (ratLocal.length !== 6 || new Set(ratLocal.map(row => row.animal)).size !== 6
  || ratLocal.some(row => !String(row.source_column).startsWith(row.group === 'case' ? 'stress - ' : 'control - '))) throw new Error('GSE169296 animal groups changed');
cohorts.rat_pvn_adolescent_stress_gse169296 = { samples: ratLocal, sourceCountColumns: ratColumns, geoSamples: ratGeo,
  authorSampleIdentityMatched: true, biologicalReplicationEvidence: 'PMC11444371: three biological replicates per sex, stress condition and subnucleus. Source columns retain exactly those six male PVN animals. Bootstrap pseudo-replicates are an inference method, not extra animals.' };
for (const pmc of ['PMC4595745', 'PMC11444371', 'PMC10585647']) pin(`${dir}/${pmc}.xml`, `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmc}/fullTextXML`);

const manual = json('data/author-validation/manual-review.json').records;
const verification = json('data/author-validation/verification-review.json').records;
const comparisons = json('data/author-validation/direct-comparisons.generated.json').comparisons;
const records = json('data/author-validation/validation-records.generated.json').records as AuthorValidationRecord[];
const proposed: Record<string, unknown> = {};
const cohortNote = (id: string) => id === 'chicken_hypo_lcitrulline_gse202003'
  ? 'All 12 thermoneutral source samples match: GSM6086522–6086527 / CON 1–6 controls and GSM6086528–6086533 / A1–6 L-citrulline. The original expression workbook, GEO sample titles and registered sheet agree; one bird from each of six independent replicates per group was sampled at day 42. See advancement-comparisons-2026-09-05/cohort-and-recovery-audit.json.'
  : id === 'rat_pvn_adolescent_stress_gse169296'
    ? 'The retained CLC export and registered sheet contain exactly six male PVN animals: controls M9/M17/M24 and stressed M2/M11/M12, with matching GEO accessions and3 biological replicates per group. Author bootstrap pseudo-replicates are confined to inference. See advancement-comparisons-2026-09-05/cohort-and-recovery-audit.json.'
    : `The author workbook, original counts and registered sheet contain the same ${id.includes('_agrp_') ? 'six fasted and five fed AgRP' : 'five fasted and five fed POMC'} samples; FD/fast is an explicit naming translation. The primary manuscript states individual animals are replicates. See advancement-comparisons-2026-09-05/cohort-and-recovery-audit.json.`;
for (const id of Object.keys(cohorts)) {
  const record = records.find(row => row.datasetId === id)!;
  const comparison = comparisons.find((row: { datasetId: string }) => row.datasetId === id);
  const review = structuredClone(record.verification.comparability);
  review.dimensions.cohort = { status: 'matched', note: cohortNote(id) };
  if (id.includes('gse68177')) {
    const m = comparison.metrics;
    review.dimensions.features = { status: 'compatible', note: `All 27 Excel-date labels are recovered unambiguously using the original counts' Ensembl ID plus genomic locus, including both Marc2/March2. ${m.sharedGenes} unique finite effect pairs cover ${(m.localCoverage * 100).toFixed(2)}% of registered genes. Effects and source bytes are unchanged; unmatched genes remain explicit filtering coverage limits.` };
    review.dimensions.effects = { status: 'compatible', note: `Both registered edgeR-QL and author limma-voom coefficients are log2 fold changes for fasting minus fed neurons. Whole-table Pearson is ${m.pearsonLogFC}; the separately declared ${m.expressedGeneCount}-gene expressed subset has Pearson ${m.expressedPearsonLogFC}. Whole-table policy checks are not replaced by the expressed subset.` };
    review.dimensions.coverage = { status: 'limited', note: `${m.sharedGenes} of ${m.localGenes} local and ${m.authorGenes} finite author effects join after source-ID recovery. Filtering leaves ${m.localGenes - m.sharedGenes} local and ${m.authorGenes - m.sharedGenes} author effects unpaired. Full-table and expressed-subset metrics retain their separate denominators.` };
    review.dimensions.inference = { status: 'different', note: `Paper-rule calls are ${m.paperFilteredAuthorGenes} author and ${m.paperFilteredLocalGenes} local, with ${m.paperFilteredInBoth} shared. Unfiltered shared-gene FDR calls are ${m.authorSignificantGenes} author and ${m.localSignificantGenes} local, with ${m.significantInBoth} shared. Model-specific P/FDR differences remain contextual to effect concordance.` };
  }
  if (id === 'rat_pvn_adolescent_stress_gse169296') review.dimensions.effects = { status: 'compatible', note: 'Registered edgeR log2FC and deposited bROC log2-scale fold change both measure stress minus control in the same male PVN cohort. The paper documents log2 transformation and MMV normalization for bROC. Quantitative differences are evaluated independently; GINI confidence is not an adjusted P value.' };
  review.conclusion = id.includes('_pomc_') ? 'Cohort and identifier gaps resolved. Whole-table correlation remains below the unchanged biological-effect policy; expressed-subset support is separately scoped.' : 'Cohort/identifier evidence now supports the biological-effect comparison. Historical inference and full-author-result coverage limits remain explicit; no exact-reproduction sign-off is inferred.';
  const note = `${cohortNote(id)} ${id.includes('gse68177') ? review.dimensions.features.note : ''} Current paired effects: ${comparison.metrics.sharedGenes} genes, Pearson ${comparison.metrics.pearsonLogFC}, Spearman ${comparison.metrics.spearmanLogFC}, same-gene direction ${comparison.metrics.signConcordance}, median absolute log2FC delta ${comparison.metrics.medianAbsLogFCDelta}, paired RMS scale ${comparison.metrics.effectScaleRatio}. ${review.conclusion}`;
  proposed[id] = { manualReview: { ...manual[id],
    ...(id.includes('gse68177') ? { summary: id.includes('_pomc_') ? 'POMC cohort and identifier recovery complete; whole-table effects still need review' : 'AgRP fasting effect concordance supported after source-ID recovery' } : {}),
    note, reviewedAt: '2026-09-05' },
    verificationReview: { ...verification[id], resultAvailability: 'available', comparisonOutcome: 'method_differences',
      reason: note, nextStep: id.includes('_pomc_') ? 'Investigate whole-table effect disagreement without substituting the expressed-gene subset for the registered universe. Keep edgeR/limma inference differences explicit.'
        : 'Effect-concordance evidence is complete for the registered contrast. Retain independent internal QC requirements and document inference/coverage differences; exact-author-reproduction sign-off remains separate.', fullyVerifiedContrasts: [] },
    comparabilityReview: review };
}
save('proposed-ledger-updates.json', { schemaVersion: 1, reviewedAt: '2026-09-05', records: proposed });
save('cohort-and-recovery-audit.json', { schemaVersion: 1, sources, labelRecovery, cohorts });

const assignments: string[] = json('data/quality/advancement-2026-09-05/assignments.json').comparisons;
const baseline = json('data/quality/advancement-2026-09-05/baseline.json').quality.records;
const results = assignments.map(id => {
  const record = structuredClone(records.find(row => row.datasetId === id)!);
  const comparison = comparisons.find((row: { datasetId: string }) => row.datasetId === id);
  if (!comparison || !record) throw new Error(`${id}: expected existing comparison absent`);
  for (const source of comparison.references) if (sha(source.path) !== source.sha256) throw new Error(`${id}: comparison source changed`);
  const patch = proposed[id] as { comparabilityReview: AuthorValidationRecord['verification']['comparability'] } | undefined;
  if (patch) record.verification.comparability = patch.comparabilityReview;
  record.directComparison = { ...record.directComparison!, metrics: comparison.metrics,
    evidenceFingerprint: createHash('sha256').update(JSON.stringify(comparison)).digest('hex') };
  const assessment = assessAuthorConcordance(record, undefined, ACTIVE_CONCORDANCE_REVIEWS);
  return { datasetId: id, before: baseline.find((row: { datasetId: string }) => row.datasetId === id).authorConcordance.status,
    afterProposedReview: assessment.status, metrics: comparison.metrics, scope: assessment.scope,
    checks: assessment.checks, remainingBlockers: assessment.checks.filter(check => check.required !== false && !['pass', 'not_applicable'].includes(check.status)),
    contextualChecks: assessment.checks.filter(check => check.required === false),
    comparisonReferences: comparison.references, detailedReviewNextStep: record.verification.nextStep };
});
save('comparison-review-results.json', { schemaVersion: 1, reviewedAt: '2026-09-05', policy: AUTHOR_CONCORDANCE_POLICY.version,
  policyImpactEvidence: 'data/quality/round2-2026-09-05/policy-only-impact.json', results });
const promotions = results.filter(row => row.before !== 'pass' && row.afterProposedReview === 'pass');
const fmt = (value: unknown) => typeof value === 'number' ? value.toFixed(5) : 'not assessed';
const report = [
  '# Existing author-comparison advancement — 2026-09-05', '',
  'All 28 pre-existing direct/reconstructed comparisons were remeasured from retained sources and registered outputs. Acceptance thresholds, contrast direction and original DE tables were preserved. Each retained comparison source hash was verified. This report covers the comparison-agent assignment; new comparisons elsewhere in the corpus are documented in the parent advancement report.', '',
  `Current evaluation under ${AUTHOR_CONCORDANCE_POLICY.version} yields ${promotions.length} passing assessments beyond the original baseline: ${promotions.map(row => row.datasetId).join(', ')}. These are cumulative changes from source-backed reviews and the requested correlation-or-direction policy correction. The policy-only gains for GSE68177 POMC and GSE231617 are recorded separately in data/quality/round2-2026-09-05/policy-only-impact.json. The ten prior passing assessments remain supported. Four cohorts gained explicit source-column/animal membership checks. One reconstructed comparison remains reconstructed. No exact-author-reproduction sign-off was granted.`, '',
  '## Newly resolved evidence', '',
  '- **GSE68177 AgRP/POMC:** the original deposited counts retain Ensembl IDs and genomic loci. Joining both identifiers recovers all 27 Excel-date-damaged symbols without changing effects. This also disambiguates Marc2/March2 and Marc1/March1. Source counts, result-workbook sample columns and registered sheets agree exactly (AgRP: 6 fasted/5 fed; POMC: 5/5). All recovered rows are listed in cohort-and-recovery-audit.json. Both pass the current effect-concordance policy; POMC passes the matched-gene direction route while its below-threshold correlation remains visible as context.',
  '- **GSE202003:** the exact 12 CON/A sample columns in the source expression workbook match the registered cohort and GEO titles. The manuscript and GEO describe one bird per independent replicate, six per treatment. Close effect agreement can now be assessed against a supported cohort.',
  '- **GSE169296:** the six retained source columns, animal IDs and GEO samples agree exactly (three male PVN rats per group). The old bootstrap concern is an inference-method difference. Author bROC log2 effects can be compared while confidence remains distinct from adjusted P.',
  '- **Inference correction:** bROC confidence was previously transformed to 1-confidence inside fields displayed as adjusted P/FDR. Those author FDR and overlap fields now remain unavailable. The real confidence >=0.95 direction count is computed and reported separately. Zero local edgeR discoveries cannot imply disagreement with bROC inference.', '',
  '## Remaining assessments', '',
  '| Dataset | Before | After proposed review | Paired genes | Pearson | Spearman | Same-gene sign | Median abs delta | RMS local/author | Remaining checks |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---|',
  ...results.map(row => `| ${row.datasetId} | ${row.before} | ${row.afterProposedReview} | ${row.metrics.sharedGenes} | ${fmt(row.metrics.pearsonLogFC)} | ${fmt(row.metrics.spearmanLogFC)} | ${fmt(row.metrics.signConcordance)} | ${fmt(row.metrics.medianAbsLogFCDelta)} | ${fmt(row.metrics.effectScaleRatio)} | ${row.remainingBlockers.map(check => check.label).join('; ') || 'None for recorded effect scope'} |`), '',
  '## Per-dataset evidence and blockers', '',
  ...results.flatMap(row => [`### ${row.datasetId}`, '', `Scope: ${row.scope}`, '',
    ...(row.remainingBlockers.length ? row.remainingBlockers.map(check => `- **${check.label}:** ${check.note}`) : ['All required author-effect checks pass within the recorded scope.']), '',
    `References: ${row.comparisonReferences.map((ref: { path: string; sourceUrl: string }) => ref.sourceUrl ? `[${ref.path}](${ref.sourceUrl})` : ref.path).join('; ')}.`, '']),
  '## Reproduce and inspect', '',
  '1. Run `npx tsx scripts/compare_author_results.mts` to remeasure the effect comparisons.',
  '2. Run `npx tsx scripts/audit_author_advancement_2026_09_05.mts` to remeasure sample/source recovery and regenerate the proposed reviews and this report.',
  '3. Integrate the exact per-dataset entries in `proposed-ledger-updates.json` into the three shared review ledgers, then regenerate author validation and quality reports. Re-run this audit after shared record regeneration; `--check` then checks freshness.',
  '4. `npx vitest run src/__tests__/authorSourceRecovery.test.ts` verifies date-collision recovery, ambiguous-source rejection, preservation of effect values and duplicate-key rejection.', '',
  'The new central additional-comparison specification adapter independently pins original and normalized author sources, re-reads the current local result, rejects duplicate identifiers, requires explicit effect orientation, and keeps unavailable adjusted P out of call-set metrics. Derived input extraction is separately checked by each preparation script. No separate reconstruction or selected list gains wider scope by entering the adapter.', '',
  '## Primary-source access record', '',
  'Live GEO GSE202003 was readable. Direct PMC rendered browser-check pages and eLife returned403; these responses were not accepted as scientific files. The official Europe PMC fullTextXML endpoint supplied all three authentic primary manuscripts under the listed PMC IDs. Original XML bytes and their SHA-256 hashes are retained in cohort-and-recovery-audit.json. Local scientific source tables were re-read, not downloaded again or edited.', '',
  '- [GSE202003 official cohort and comparison inventory](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE202003)',
  '- [GSE68177 primary manuscript, PMC4595745](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4595745/fullTextXML)',
  '- [GSE169296 primary manuscript, PMC11444371](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11444371/fullTextXML)',
  '- [GSE202003 primary manuscript, PMC10585647](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10585647/fullTextXML)', '',
].join('\n');
write('README.md', report);
console.log(JSON.stringify({ auditedComparisons: results.length, recoveredLabels: labelRecovery.length,
  promotions: promotions.map(row => row.datasetId) }));
