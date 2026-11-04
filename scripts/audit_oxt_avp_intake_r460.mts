// Source-bound value/model/output audit for the new OXT/AVP microarray intake.
// npx tsx scripts/audit_oxt_avp_intake_r460.mts [--check]
// A missing source, unresolved unit, changed model or stale provenance fails.
// This verifies unadjusted group effects, not a separate empirical-Bayes refit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DATASETS } from '../src/data/datasets';
import { strictSiblingPathwaysFor } from '../src/data/rawTrack';
import type { PathwaySibling, RawTrack } from '../src/types';
import { roundEffect, roundProb } from './lib/bundleSlim.mjs';
import { readVerifiedFgseaSet } from './lib/fgseaProvenance.mjs';
import { normalizeGene } from './lib/geneSymbol.mjs';
import { readAdditiveIntake } from './lib/historicalEvidence.mjs';
import { OXT_AVP_AUDIT, OXT_AVP_AUDIT_DEPENDENCIES, OXT_AVP_INTAKE } from './lib/oxtAvpIntakeEvidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = `${OXT_AVP_INTAKE}/studies.json`, ANALYSES = `${OXT_AVP_INTAKE}/analyses.json`;
const PRODUCER = 'scripts/regen-r460/run_oxt_avp_r460.R';
const fingerprints: Record<string, string> = {};
assert.ok(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');
function bytes(path: string): Buffer {
  assert.ok(path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(part => part === '' || part === '..' || part === '.'), `Unsafe evidence path: ${path}`);
  const body = readFileSync(resolve(ROOT, path));
  fingerprints[path] = createHash('sha256').update(body).digest('hex');
  return body;
}
const sha = (path: string): string => { bytes(path); return fingerprints[path]; };
function table(path: string): Record<string, string>[] {
  const body = bytes(path), lines = (path.endsWith('.gz') ? gunzipSync(body) : body).toString('utf8').trimEnd().split(/\r?\n/);
  const header = lines.shift()!.split('\t');
  assert.equal(new Set(header).size, header.length, `Duplicate header: ${path}`);
  return lines.filter(Boolean).map((line, index) => {
    const cells = line.split('\t');
    assert.equal(cells.length, header.length, `Malformed row ${index + 2}: ${path}`);
    return Object.fromEntries(header.map((name, column) => [name, cells[column]]));
  });
}
function number(value: string | undefined): number {
  assert.ok(value !== undefined && value !== '' && value !== 'NA', 'Missing numeric value');
  const out = Number(value); assert.ok(Number.isFinite(out), 'Nonfinite numeric value'); return out;
}
function near(actual: number, expected: number, note: string): void {
  assert.ok(Math.abs(actual - expected) <= 1e-9 + 1e-8 * Math.abs(expected), `${note}: ${actual} != ${expected}`);
}
function unique(rows: Record<string, string>[], key: string, label: string): Map<string, Record<string, string>> {
  assert.ok(rows.every(row => row[key]), `Missing ${key}: ${label}`);
  const out = new Map(rows.map(row => [row[key], row]));
  assert.equal(out.size, rows.length, `Duplicate ${key}: ${label}`); return out;
}
function jsonp<T>(path: string): T {
  return JSON.parse(bytes(path).toString('utf8').replace(/^var [A-Za-z0-9_$]+ = /, '').replace(/;\s*$/, ''));
}
for (const path of OXT_AVP_AUDIT_DEPENDENCIES) sha(path);
const studies: any[] = JSON.parse(bytes(MANIFEST).toString('utf8'));
const analyses: any[] = JSON.parse(bytes(ANALYSES).toString('utf8'));
const declared = readAdditiveIntake(ROOT);
assert.ok(studies.length > 0 && studies.every(study => declared.datasetIds.has(study.id)), 'Undeclared or held source study');
assert.equal(new Set(analyses.map(row => row.analysisId)).size, analyses.length, 'Duplicate analysis ID');
const configs = table('geo_replication/config/datasets.tsv');
const report: any[] = [];
for (const study of studies) {
  const dataset = DATASETS.find(row => row.id === study.id);
  assert.ok(dataset, `Study is not registered: ${study.id}`);
  assert.ok(['pass', 'pass_with_notes'].includes(study.designReview?.replicationStatus), `${study.id}: independent replication is unresolved`);
  assert.equal(dataset.expressionUnit, study.expressionUnit);
  assert.equal(dataset.geo, study.accession);
  assert.deepEqual(dataset.groups.map(({ key, label }) => ({ key, label })), study.groups.map((group: any) => ({ key: group.key, label: group.label })));
  assert.deepEqual(dataset.contrasts.map(({ id, baseline, case: caseGroup }) => ({ id, baseline, case: caseGroup })),
    study.contrasts.map((contrast: any) => ({ id: contrast.id, baseline: contrast.baseline, case: contrast.case })));
  const sourceManifest = `${study.dir}/metadata/${study.accession}_source_files.tsv`;
  const sources = table(sourceManifest);
  assert.ok(sources.length > 0, 'Empty source manifest');
  for (const source of sources) {
    const path = source.local_path || source.file, url = source.source_url || source.source;
    assert.match(url, /^https:\/\//, 'Original source needs an HTTPS repository URL');
    assert.match(source.sha256, /^[a-f0-9]{64}$/i, 'Original source needs an explicit checksum');
    assert.equal(sha(path), source.sha256.toLowerCase(), `Original source changed: ${path}`);
    assert.equal(bytes(path).length, number(source.bytes), `Original source byte count changed: ${path}`);
  }
  for (const path of study.designReview.evidencePaths) sha(path);
  for (const track of study.tracks) {
    assert.equal(track.kind, 'matrix_log');
    const sheet = table(track.samplesheet).filter(row => row.included === undefined || row.included.toLowerCase() === 'true');
    unique(sheet, 'sample', track.samplesheet); unique(sheet, 'biological_unit', track.samplesheet);
    const modelPath = `${study.dir}/processed/${track.analysisId}_model_input.tsv.gz`;
    const expressionPath = `${study.dir}/processed/${track.analysisId}_expression.tsv.gz`;
    const prepared = table(track.matrix), mapping = unique(table(`${study.dir}/processed/${track.analysisId}_feature_map.tsv.gz`), 'feature_id', 'Feature map');
    // An independent extraction of the original deposited table verifies every
    // prepared expression cell. CEL-derived preparations need their own replay
    // before this audit can admit them; checksums alone do not establish values.
    const originalMatrices = sources.map(source => source.local_path || source.file).filter(path => /_series_matrix\.txt(?:\.gz)?$/.test(path));
    assert.equal(originalMatrices.length, 1, 'A unique deposited normalized series matrix is required; CEL-derived preparation remains on hold pending a dedicated normalization replay');
    const originalPath = originalMatrices[0], originalBytes = bytes(originalPath);
    const originalLines = (originalPath.endsWith('.gz') ? gunzipSync(originalBytes) : originalBytes).toString('utf8').split(/\r?\n/);
    const begin = originalLines.indexOf('!series_matrix_table_begin');
    const end = originalLines.indexOf('!series_matrix_table_end');
    assert.ok(begin >= 0 && end > begin + 1, 'Deposited normalized matrix table is absent');
    const cells = (line: string) => line.split('\t').map(value => value.replace(/^"|"$/g, ''));
    const originalHeader = cells(originalLines[begin + 1]);
    assert.equal(new Set(originalHeader).size, originalHeader.length, 'Deposited sample columns are ambiguous');
    const columns = sheet.map(row => originalHeader.indexOf(row.sample));
    assert.ok(columns.every(column => column > 0), 'Prepared samples cannot be bound to the deposited matrix');
    const originalRows = new Map(originalLines.slice(begin + 2, end).filter(Boolean).map(line => { const row = cells(line); return [row[0], row] as const; }));
    assert.equal(originalRows.size, end - begin - 2, 'Deposited feature IDs are duplicated or malformed');
    assert.equal(prepared.length, originalRows.size, 'Prepared source omits or adds deposited features');
    const platformPaths = sources.map(source => source.local_path || source.file).filter(path => /GPL1355\.annot\.gz$/.test(path));
    assert.equal(platformPaths.length, 1, 'The source-bound GPL1355 annotation is required');
    const platformLines = gunzipSync(bytes(platformPaths[0])).toString('utf8').split(/\r?\n/);
    const platformStart = platformLines.indexOf('!platform_table_begin'), platformEnd = platformLines.indexOf('!platform_table_end');
    assert.ok(platformStart >= 0 && platformEnd > platformStart + 1, 'Original platform annotation table is absent');
    const platformHeader = cells(platformLines[platformStart + 1]);
    const symbolColumn = platformHeader.indexOf('Gene symbol'), entrezColumn = platformHeader.indexOf('Gene ID');
    assert.ok(symbolColumn > 0 && entrezColumn > 0, 'Original annotation lacks symbol/Entrez evidence');
    const annotation = new Map(platformLines.slice(platformStart + 2, platformEnd).filter(Boolean).map(line => { const row = cells(line); return [row[0], row] as const; }));
    for (const row of prepared) {
      const deposited = originalRows.get(row.gene_id); assert.ok(deposited, 'Prepared feature is absent from the official matrix');
      sheet.forEach((sample, index) => { assert.equal(number(row[sample.sample]), number(deposited[columns[index]]), `${row.gene_id}/${sample.sample}: official matrix value changed`); });
      const platform = annotation.get(row.gene_id), sourceSymbol = platform?.[symbolColumn]?.trim() ?? '', sourceEntrez = platform?.[entrezColumn]?.trim() ?? '';
      const unambiguous = sourceSymbol.split('///').length === 1 && sourceEntrez.split('///').length === 1
        && !['', '---'].includes(sourceSymbol) && !['', '---'].includes(sourceEntrez);
      assert.equal(row.symbol, unambiguous ? sourceSymbol : '', `${row.gene_id}: symbol was guessed or rebound from original platform evidence`);
    }
    const expected = new Map<string, { values: number[]; count: number; published: boolean }>();
    assert.equal(mapping.size, prepared.length, 'Feature map does not cover prepared source');
    unique(prepared, 'gene_id', track.matrix);
    for (const source of prepared) {
      const feature = mapping.get(source.gene_id); assert.ok(feature, `Missing source feature: ${source.gene_id}`);
      const published = feature.status === 'mapped' || feature.status.startsWith('disambiguated_by_');
      if (published && !feature.status.startsWith('disambiguated_by_')) assert.equal(feature.symbol, normalizeGene(source.symbol), 'Prepared source symbol was rebound');
      const key = published ? feature.symbol : feature.feature_id;
      const entry = expected.get(key) ?? { values: sheet.map(() => 0), count: 0, published };
      assert.equal(entry.published, published, 'Ambiguous fit-row collision needs a dedicated source review');
      sheet.forEach((sample, index) => { entry.values[index] += number(source[sample.sample]); });
      entry.count++; expected.set(key, entry);
    }
    const model = unique(table(modelPath), 'gene_id', modelPath);
    assert.equal(model.size, expected.size, 'Extra or missing model features');
    for (const [key, entry] of expected) {
      const row = model.get(key); assert.ok(row, `Prepared feature missing from model: ${key}`);
      sheet.forEach((sample, index) => { near(number(row[sample.sample]), entry.values[index] / entry.count, `${key}/${sample.sample}: pre-fit log averaging`); });
    }
    const expression = unique(table(expressionPath), 'gene_id', expressionPath);
    const publishedKeys = [...expected].filter(([, entry]) => entry.published).map(([key]) => key);
    assert.deepEqual(new Set(expression.keys()), new Set(publishedKeys), 'Public expression has extra or missing symbols');
    for (const [key, row] of expression) for (const sample of sheet) near(number(row[sample.sample]), number(model.get(key)![sample.sample]), 'Public expression changed from model input');
    const bundlePath = `public/datasets/${dataset.id}/track_${track.id}.js`;
    const pathwayPath = `public/datasets/${dataset.id}/track_${track.id}.pathways.js`;
    const raw = jsonp<RawTrack>(bundlePath), sibling = jsonp<PathwaySibling>(pathwayPath);
    assert.equal(raw.meta?.sampleOrder?.length, sheet.length);
    assert.deepEqual(new Set(raw.meta?.sampleOrder), new Set(sheet.map(row => row.sample)));
    assert.equal(raw.meta?.expressionUnit, study.expressionUnit);
    for (const group of study.groups) assert.deepEqual(raw.meta?.groupSamples?.[group.key], sheet.filter(row => row.group === group.key).map(row => row.sample));
    for (const [gene, values] of Object.entries(raw.cpm ?? {})) {
      const row = expression.get(gene); assert.ok(row, 'Bundle expression has a nonpublic feature');
      assert.deepEqual(values, raw.meta!.sampleOrder!.map(sample => number(row[sample])), `${gene}: bundled expression changed`);
    }
    for (let index = 0; index < study.contrasts.length; index++) {
      const contrast = study.contrasts[index];
      assert.ok(!contrast.covariate, 'Covariate-adjusted effects require a dedicated independent model replay');
      const matching = analyses.filter(row => row.studyId === study.id && row.track === track.id && row.contrast === contrast.id);
      assert.equal(matching.length, 1, 'Missing or duplicate analysis binding');
      const analysis = matching[0], prefix = `${study.dir}/processed/${analysis.analysisId}`;
      const controls = sheet.filter(row => row.group === contrast.baseline), cases = sheet.filter(row => row.group === contrast.case);
      assert.ok(controls.length >= 3 && cases.length >= 3, 'Insufficient reviewed independent units');
      assert.equal(analysis.control, controls.length); assert.equal(analysis.case, cases.length);
      assert.deepEqual(analysis.samples, sheet.filter(row => row.group === contrast.baseline || row.group === contrast.case).map(row => row.sample));
      const config = configs.filter(row => row.id === analysis.analysisId); assert.equal(config.length, 1, 'Configuration missing or duplicated');
      assert.deepEqual({ dir: config[0].dir, organism: config[0].organism, input_kind: config[0].input_kind,
        input_path: config[0].input_path, samplesheet: config[0].samplesheet, batch_var: config[0].batch_var },
      { dir: study.dir.replace(/^geo_replication\//, ''), organism: study.organism, input_kind: 'matrix',
        input_path: modelPath.replace(/^geo_replication\//, ''), samplesheet: analysis.analysisSamplesheet.replace(/^geo_replication\//, ''), batch_var: 'NA' });
      const fitSheet = table(analysis.analysisSamplesheet);
      assert.deepEqual(fitSheet.map(row => ({ sample: row.sample, group: row.group })), sheet.filter(row => row.group === contrast.baseline || row.group === contrast.case)
        .map(row => ({ sample: row.sample, group: row.group === contrast.case ? 'case' : 'control' })));
      const provenance = Object.fromEntries(table(analysis.provenance).map(row => [row.key, row.value]));
      for (const [key, expectedValue] of Object.entries({ generator: PRODUCER, generator_sha256: sha(PRODUCER), generator_2: 'scripts/lib/de_common.R',
        generator_2_sha256: sha('scripts/lib/de_common.R'), input_manifest: MANIFEST, input_manifest_sha256: sha(MANIFEST),
        input_matrix: track.matrix, input_matrix_sha256: sha(track.matrix), input_samplesheet: track.samplesheet, input_samplesheet_sha256: sha(track.samplesheet),
        contrast: contrast.id, track: track.id, accession: study.accession, expression_unit: study.expressionUnit, limma_version: '3.68.4',
        input_kind: 'matrix_log', method: 'limma', coef: 'groupcase', design: '(Intercept) + groupcase' })) {
        assert.equal(provenance[key], expectedValue, `${analysis.analysisId}: stale or incompatible provenance ${key}`);
      }
      assert.match(provenance.r_version ?? '', /^R version 4\.6\.0(?: |$)/);
      assert.equal(number(provenance.design_rank), 2); assert.equal(number(provenance.residual_df), controls.length + cases.length - 2);
      for (const [key, value] of Object.entries(provenance)) {
        if (key.startsWith('input_') && key.endsWith('_sha256')) assert.equal(sha(provenance[key.slice(0, -7)]), value, 'Pinned model/source input changed');
        if (key.startsWith('output_') && key.endsWith('_sha256')) assert.equal(sha(`${study.dir}/processed/${provenance[key.slice(0, -7)]}`), value, 'Pinned analysis output changed');
      }
      assert.equal(analysis.sourceSha256, sha(track.matrix)); assert.equal(analysis.deSha256, sha(`${prefix}_DE.tsv`));
      assert.equal(analysis.expressionSha256, sha(expressionPath));
      const sourceDe = unique(table(`${prefix}_DE.tsv`), 'symbol', `${prefix}_DE.tsv`), se = unique(table(`${prefix}_SE.tsv`), 'id', `${prefix}_SE.tsv`);
      const outputDe = index === 0 ? raw.de : raw.deByContrast?.[contrast.id]; assert.ok(outputDe, 'Missing public contrast');
      assert.equal(outputDe.length, sourceDe.size); assert.equal(new Set(outputDe.map(row => row.gene)).size, outputDe.length);
      const mean = (row: Record<string, string>, samples: Record<string, string>[]) => samples.reduce((sum, sample) => sum + number(row[sample.sample]), 0) / samples.length;
      for (const output of outputDe) {
        const source = sourceDe.get(output.gene), coefficientSe = se.get(output.gene), input = model.get(output.gene);
        assert.ok(source && coefficientSe && input, 'DE/SE/input feature binding changed');
        assert.ok(raw.cpm?.[output.gene], 'A displayed DE gene has no sample values');
        assert.equal(source.id, source.symbol); assert.equal(source.method, 'limma');
        near(number(source.logFC), mean(input, cases) - mean(input, controls), `${output.gene}: independently computed group effect`);
        assert.ok(number(coefficientSe.se) > 0); near(number(source.stat), number(source.logFC) / number(coefficientSe.se), `${output.gene}: moderated t/SE`);
        // JSON serializes a rounded negative zero as zero.
        assert.equal(output.logFC, +number(source.logFC).toFixed(4) || 0); assert.equal(output.PValue, roundProb(number(source.pvalue)));
        assert.equal(output.FDR, roundProb(number(source.padj))); assert.equal(output.se, roundEffect(number(coefficientSe.se)));
      }
      const verified = readVerifiedFgseaSet(resolve(ROOT, `${prefix}_DE.tsv`), { expectedSpecies: study.organism });
      const publicPathways = strictSiblingPathwaysFor(sibling, contrast.id, study.contrasts[0].id);
      assert.ok(publicPathways.db, 'Pathway sibling cannot be attributed to this contrast'); assert.deepEqual(publicPathways.db, verified.publicBlock);
      for (const suffix of ['FGSEA_HALLMARK', 'FGSEA_KEGG', 'FGSEA_GO_BP', 'FGSEA_REACTOME', 'FGSEA_provenance', 'fgsea']) sha(`${prefix}_${suffix}.tsv`);
      report.push({ datasetId: study.id, track: track.id, contrast: contrast.id, analysisId: analysis.analysisId,
        sourceIntegrity: 'pass', preparedInputTrace: 'pass', expressionTrace: 'pass', deTrace: 'pass', pathwayProvenance: 'pass', modelEffectTrace: 'pass',
        sampleCount: controls.length + cases.length, publicGenes: outputDe.length, biologicalUnit: study.designReview.biologicalUnit });
    }
  }
}
assert.equal(report.length, analyses.length, 'Unclaimed intake analysis');
const document = `${JSON.stringify({ schemaVersion: 1,
  scope: 'Checksummed sources, reviewed independent units, all prepared-to-model log-expression values and public outputs. Group effects are independently recomputed. Empirical-Bayes hyperparameter estimation, raw CEL normalization and author-result concordance are outside this audit.',
  fingerprints, analyses: report }, null, 2)}\n`;
if (process.argv.includes('--check')) assert.equal(readFileSync(resolve(ROOT, OXT_AVP_AUDIT), 'utf8').replace(/\r\n/g, '\n'), document, 'OXT/AVP intake audit is stale');
else writeFileSync(resolve(ROOT, OXT_AVP_AUDIT), document);
console.log(`OXT/AVP source/model/output audit ${process.argv.includes('--check') ? 'current' : 'written'}: ${studies.length} studies, ${report.length} comparisons`);
