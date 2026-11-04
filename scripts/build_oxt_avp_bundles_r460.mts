// Build only the source-reviewed OXT/AVP intake. Analysis values and provenance
// come from this intake's R 4.6.0 producer; there is no historical overlay.
// Run after merging config.generated.tsv and running run_fgsea_r460.R.
//   npx tsx scripts/build_oxt_avp_bundles_r460.mts [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineDataset, type DatasetDefinition } from '../src/data/datasets';
import type { Dataset, GeneDERecord, PathwayDatabase } from '../src/types';
import { writeDatasetBundles } from './lib/bundleWriter.mjs';
import { rankScore } from './lib/deTable.mjs';
import { readVerifiedFgseaSet } from './lib/fgseaProvenance.mjs';
import { readAdditiveIntake } from './lib/historicalEvidence.mjs';
import { assertUniqueKeys, readSymbolDe, readSymbolMatrix, readSymbolSe, readTsv } from './lib/regenTables.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTAKE = 'data/intake/oxt-avp-2026-10-19';
const MANIFEST = `${INTAKE}/studies.json`;
const ANALYSES = `${INTAKE}/analyses.json`;
const REGISTRY = 'src/data/oxtAvpStudies.generated.json';
const PRODUCER = 'scripts/regen-r460/run_oxt_avp_r460.R';
const CHECK = process.argv.includes('--check');
assert.ok(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');

interface Group { key: string; label: string; color?: string }
interface Comparison { id: string; baseline: string; case: string; label?: string; description?: string; exploratory?: boolean }
interface Study {
  id: string; accession: string; dir: string; organism: string; name: string; category: Dataset['category'];
  region: Dataset['region']; preparation: Dataset['preparation']; perturbation: Dataset['perturbation']; modality: string;
  expressionUnit: string; note: string; doi?: string; pmid?: string; groups: Group[]; contrasts: Comparison[];
  tracks: Array<{ id: string; label: string; analysisId: string; matrix: string; samplesheet: string; kind: string }>;
  designReview: { replicationStatus: string; biologicalUnit: string; note: string; evidencePaths: string[] };
}
interface Analysis {
  studyId: string; accession: string; track: string; contrast: string; analysisId: string;
  inputKind: string; counts: string; cpm: string; samplesheet: string; analysisSamplesheet: string;
  provenance: string; sourceSha256: string; deSha256: string; expressionSha256: string; replicationStatus: string;
  samples: string[]; control: number; case: number; nGenes: number;
}
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const studies = readJson<Study[]>(MANIFEST);
const analyses = readJson<Analysis[]>(ANALYSES);
const intakeIds = readAdditiveIntake(ROOT).datasetIds;
assert.ok(studies.length > 0 && studies.every(study => intakeIds.has(study.id)), 'No declared source-reviewed intake studies');
assertUniqueKeys(analyses.map(row => row.analysisId), 'OXT/AVP analysis IDs');
assert.ok(analyses.every(row => intakeIds.has(row.studyId)), 'Analysis belongs to an unregistered or held study');
const colors = ['#3775BA', '#B64342', '#44996B', '#9765AE'];

function local(path: string): string {
  assert.ok(path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.' || part === ''), `Unsafe intake path: ${path}`);
  const target = resolve(ROOT, path), rel = relative(ROOT, target);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `Intake path escaped the repository: ${path}`);
  return target;
}
const hash = (path: string): string => createHash('sha256').update(readFileSync(local(path))).digest('hex');
function table(path: string): Record<string, string>[] {
  const { header, rows } = readTsv(local(path));
  assertUniqueKeys(header, `${path} header`);
  return rows.map(row => Object.fromEntries(header.map((name, index) => [name, row[index]])));
}
function definition(study: Study): DatasetDefinition {
  return {
    id: study.id, name: study.name, organism: study.organism, category: study.category,
    region: study.region, preparation: study.preparation, perturbation: study.perturbation, modality: study.modality,
    featureType: 'gene', featureLabel: 'Gene', supportsPathways: true, isDefault: false,
    defaultTrack: study.tracks[0].id, trackNoun: 'track', trackCategoryOrder: ['Tissue'], expressionUnit: study.expressionUnit,
    citation: study.note, geo: study.accession, doi: study.doi ?? '', pmid: study.pmid ?? '',
    groups: study.groups.map((group, index) => ({ ...group, color: group.color ?? colors[index % colors.length] })),
    contrasts: study.contrasts.map((contrast, index) => ({ ...contrast, isDefault: index === 0 })),
  };
}
function verifyProvenance(study: Study, track: Study['tracks'][number], comparison: Comparison, analysis: Analysis): void {
  const expectedId = comparison === study.contrasts[0] ? track.analysisId : `${track.analysisId}_${comparison.id}`;
  assert.equal(analysis.analysisId, expectedId, 'Analysis ID/contrast binding changed');
  const prefix = `${study.dir}/processed/${analysis.analysisId}`;
  assert.equal(analysis.provenance, `${prefix}_provenance.tsv`);
  assert.equal(analysis.counts, `${study.dir}/processed/${track.analysisId}_model_input.tsv.gz`);
  assert.equal(analysis.cpm, `${study.dir}/processed/${track.analysisId}_expression.tsv.gz`);
  assert.equal(analysis.samplesheet, track.samplesheet);
  assert.equal(analysis.sourceSha256, hash(track.matrix), 'Prepared matrix differs from the fitted input');
  assert.equal(analysis.deSha256, hash(`${prefix}_DE.tsv`));
  assert.equal(analysis.expressionSha256, hash(analysis.cpm));
  const rows = table(analysis.provenance);
  assertUniqueKeys(rows.map(row => row.key), analysis.provenance);
  const provenance = Object.fromEntries(rows.map(row => [row.key, row.value]));
  for (const [key, value] of Object.entries({ generator: PRODUCER, generator_sha256: hash(PRODUCER),
    generator_2: 'scripts/lib/de_common.R', generator_2_sha256: hash('scripts/lib/de_common.R'),
    input_manifest: MANIFEST, input_manifest_sha256: hash(MANIFEST), input_matrix: track.matrix,
    input_matrix_sha256: hash(track.matrix), input_samplesheet: track.samplesheet, input_samplesheet_sha256: hash(track.samplesheet),
    accession: study.accession, track: track.id, contrast: comparison.id, expression_unit: study.expressionUnit,
    input_kind: 'matrix_log', method: 'limma', limma_version: '3.68.4', replication_status: study.designReview.replicationStatus })) {
    assert.equal(provenance[key], value, `${analysis.analysisId}: stale or incompatible provenance ${key}`);
  }
  assert.match(provenance.r_version ?? '', /^R version 4\.6\.0(?: |$)/, 'Analysis did not use R 4.6.0');
  assert.equal(provenance.output_de_sha256, hash(`${prefix}_DE.tsv`));
  assert.equal(provenance.output_se_sha256, hash(`${prefix}_SE.tsv`));
  assert.equal(provenance.output_expression_sha256, hash(analysis.cpm));
  assert.equal(provenance.output_model_input_sha256, hash(analysis.counts));
  const declaredEvidenceKeys = study.designReview.evidencePaths.map((_, index) => `input_design_evidence_${index + 1}`);
  assert.deepEqual(Object.keys(provenance).filter(key => key.startsWith('input_design_evidence_') && !key.endsWith('_sha256')), declaredEvidenceKeys,
    'Provenance does not cover the complete reviewed design evidence');
  study.designReview.evidencePaths.forEach((path, index) => { assert.equal(provenance[declaredEvidenceKeys[index]], path); });
  for (const [key, path] of Object.entries(provenance)) {
    if (key.startsWith('input_design_evidence_') && !key.endsWith('_sha256')) {
      assert.equal(provenance[`${key}_sha256`], hash(path), 'Reviewed design evidence is stale');
    }
  }
}

// Stage the complete writer output, then either compare or publish. A malformed
// later contrast cannot leave partially rewritten public bundles behind.
const temporaryBase = resolve(ROOT, '.tmp');
mkdirSync(temporaryBase, { recursive: true });
const temporary = mkdtempSync(resolve(temporaryBase, 'oxt-avp-bundles-'));
const registry: DatasetDefinition[] = [];
const files: string[] = [];
try {
  for (const study of studies) {
    assert.ok(['pass', 'pass_with_notes'].includes(study.designReview?.replicationStatus), `${study.accession}: independent replication remains on hold`);
    assert.ok(study.expressionUnit?.trim() && study.note?.trim(), 'Study needs its source scale and interpretation');
    assert.equal(study.tracks.length, 1, 'The reviewed SON intake has one track per study');
    const track = study.tracks[0];
    assert.equal(track.kind, 'matrix_log');
    const first = study.contrasts[0];
    assert.ok(first && study.groups[0].key === first.baseline && study.groups[1].key === first.case, 'Group order must begin with the default baseline and case');
    const sheet = table(track.samplesheet).filter(row => row.included === undefined || row.included.toLowerCase() === 'true');
    assertUniqueKeys(sheet.map(row => row.sample), `${study.accession} samples`);
    assertUniqueKeys(sheet.map(row => row.biological_unit), `${study.accession} biological units`);
    assert.ok(sheet.every(row => row.biological_unit?.trim() && study.groups.some(group => group.key === row.group)), 'Samples lack independently reviewed units or declared groups');
    const groupSamples = Object.fromEntries(study.groups.map(group => [group.key, sheet.filter(row => row.group === group.key).map(row => row.sample)]));
    const sampleOrder = Object.values(groupSamples).flat();
    const bindings = analyses.filter(row => row.studyId === study.id && row.track === track.id);
    assert.equal(bindings.length, study.contrasts.length, `${study.accession}: incomplete or extra analysis bindings`);
    const deByContrast: Record<string, GeneDERecord[]> = {};
    const pathwaysByContrast: Record<string, PathwayDatabase> = {};
    let expression: Map<string, number[]> | undefined;
    for (const comparison of study.contrasts) {
      const matching = bindings.filter(row => row.contrast === comparison.id);
      assert.equal(matching.length, 1, `${study.accession}: missing or duplicate ${comparison.id}`);
      const analysis = matching[0];
      assert.equal(analysis.accession, study.accession);
      assert.equal(analysis.inputKind, 'matrix');
      verifyProvenance(study, track, comparison, analysis);
      const baseline = groupSamples[comparison.baseline], cases = groupSamples[comparison.case];
      assert.ok(baseline?.length >= 3 && cases?.length >= 3, 'Contrast lacks reviewed sample support');
      assert.equal(analysis.control, baseline.length); assert.equal(analysis.case, cases.length);
      assert.deepEqual(new Set(analysis.samples), new Set([...baseline, ...cases]), 'Fitted samples differ from the declared contrast');
      expression ??= readSymbolMatrix(local(analysis.cpm), sampleOrder);
      const dePath = `${study.dir}/processed/${analysis.analysisId}_DE.tsv`;
      const se = readSymbolSe(local(`${study.dir}/processed/${analysis.analysisId}_SE.tsv`));
      const rows = readSymbolDe(local(dePath)).map(row => {
        assert.ok(expression!.has(row.gene) && se.has(row.gene), `${analysis.analysisId}/${row.gene}: expression or SE is missing`);
        assert.ok(Number.isFinite(row.logFC) && Number.isFinite(row.PValue) && row.PValue >= 0 && row.PValue <= 1
          && Number.isFinite(row.FDR) && row.FDR >= 0 && row.FDR <= 1 && row.method === 'limma', 'Invalid limma DE values');
        const logFC = +row.logFC.toFixed(4);
        return { gene: row.gene, logFC, PValue: row.PValue, FDR: row.FDR, se: se.get(row.gene)!, rank_score: rankScore(logFC, row.FDR) } as GeneDERecord;
      }).sort((a, b) => b.rank_score - a.rank_score);
      assert.equal(rows.length, analysis.nGenes);
      assert.ok(rows.length >= 100, 'No transcriptome-wide public DE table');
      deByContrast[comparison.id] = rows;
      pathwaysByContrast[comparison.id] = readVerifiedFgseaSet(local(dePath), { expectedSpecies: study.organism }).publicBlock;
    }
    const de = deByContrast[first.id], pathways = pathwaysByContrast[first.id];
    delete deByContrast[first.id]; delete pathwaysByContrast[first.id];
    const genes = new Set([de, ...Object.values(deByContrast)].flat().map(row => row.gene));
    const metadata = definition(study), dataset = defineDataset(metadata);
    const result = writeDatasetBundles(dataset, [{
      trackId: track.id, armKeys: [first.baseline, first.case], defaultContrastBinding: first,
      extraContrastBindings: study.contrasts.slice(1), color: colors[0], nSig: de.filter(row => row.FDR < .05).length,
      meta: { code: track.id, label: track.label, type: 'Tissue', nGenes: de.length, sampleOrder, groupSamples, expressionUnit: study.expressionUnit },
      qc: { cluster: track.id, clusterLabel: track.label, minCells: 0, nNormal: groupSamples[first.baseline].length,
        nObese: groupSamples[first.case].length, is3v3: groupSamples[first.baseline].length === 3 && groupSamples[first.case].length === 3, samplesKept: sampleOrder },
      de, deByContrast, cpm: Object.fromEntries([...genes].map(gene => [gene, expression!.get(gene)!])), pathways, pathwaysByContrast,
    }], { outRoot: temporary });
    files.push(...result.files);
    registry.push(metadata);
    console.log(`${study.accession}: ${genes.size} genes, ${sampleOrder.length} reviewed units, ${study.contrasts.length} comparisons`);
  }
  const registryBody = `${JSON.stringify(registry, null, 2)}\n`;
  for (const staged of files) {
    const target = resolve(ROOT, 'public', relative(temporary, staged));
    const body = readFileSync(staged, 'utf8');
    if (CHECK) assert.ok(existsSync(target) && readFileSync(target, 'utf8').replace(/\r\n/g, '\n') === body, `Missing or stale bundle: ${relative(ROOT, target)}`);
    else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body); }
  }
  if (CHECK) assert.equal(readFileSync(resolve(ROOT, REGISTRY), 'utf8').replace(/\r\n/g, '\n'), registryBody, 'OXT/AVP registry sidecar is stale');
  else writeFileSync(resolve(ROOT, REGISTRY), registryBody);
  console.log(`OXT/AVP bundles and registry ${CHECK ? 'current' : 'written'}: ${studies.length} studies`);
} finally {
  const contained = relative(temporaryBase, temporary);
  assert.ok(contained && !contained.startsWith('..') && !isAbsolute(contained), 'Temporary cleanup escaped its workspace directory');
  rmSync(temporary, { recursive: true, force: true });
}
