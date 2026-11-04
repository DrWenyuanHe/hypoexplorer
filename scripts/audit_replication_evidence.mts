/** Review-backed, read-only biological-replication audit. Writes only its own evidence directory. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import XLSX from 'xlsx';
import { DATASETS } from '../src/data/datasets';
import type { RawTrack } from '../src/types';
import type { QualityStatus } from '../src/data/qualityChecks';
import { parseTsv } from './lib/internalQc.mjs';
import { assessReplicationUnits, validateReviewedReplicationMapping, validateDedicatedReplicationBinding, replicationDecision, reviewedRemainingMappings, type BiologicalUnitMapping, type DedicatedReplicationBinding, type ReplicationDecisions } from './lib/replicationEvidence.mjs';
import { validateArrayExpressReplicationMapping } from '../data/internal-qc/replication-2026-09-05/round5-e/arrayExpressMapping.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'data/internal-qc/replication-2026-09-05';
const SPEC_PATH = `${DIR}/reviewed-specifications.json`;
const CHECK = process.argv.includes('--check');
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const read = (path: string): Buffer => readFileSync(resolve(ROOT, path));
const normal = (text: string): string => text.replace(/<\/?[A-Za-z][^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
interface Source { path: string; sourceUrl: string; sha256: string; bytes: number; kind: string; selector?: string; quote?: string }
interface Spec {
  datasetId: string; accession: string; configId: string; config?: Record<string, string>;
  dedicatedBinding?: DedicatedReplicationBinding; contrastDecisions?: ReplicationDecisions;
  sheet: { path: string; sha256: string; bytes: number }; contrasts: string[];
  proposedStatus: QualityStatus; unitType: BiologicalUnitMapping['unitType']; mappingMethod: string; mappingSha256: string;
  sources: Source[]; note: string;
}
interface GeoSample { accession: string; title: string; description: string[]; characteristics: Record<string, string> }
function geoSamples(text: string): GeoSample[] {
  return text.split(/^\^SAMPLE = /m).slice(1).map(block => {
    const lines = block.split(/\r?\n/);
    const field = (name: string): string[] => lines.filter(line => line.startsWith(`!Sample_${name} = `)).map(line => line.split(' = ').slice(1).join(' = '));
    return { accession: lines[0].trim(), title: field('title')[0], description: field('description'),
      characteristics: Object.fromEntries(field('characteristics_ch1').map(value => { const offset = value.indexOf(':'); return [value.slice(0, offset).trim().toLowerCase(), value.slice(offset + 1).trim()]; })) };
  });
}
function pinned(source: Source | Spec['sheet']): Buffer {
  const bytes = read(source.path);
  if (bytes.length !== source.bytes || sha(bytes) !== source.sha256) throw new Error(`Reviewed evidence changed: ${source.path}`);
  return bytes;
}
function output(name: string, content: string): void {
  const path = `${DIR}/${name}`;
  if (CHECK) { if (read(path).toString('utf8') !== content) throw new Error(`Stale replication evidence: ${path}`); }
  else writeFileSync(resolve(ROOT, path), content);
}
const specs = JSON.parse(read(SPEC_PATH).toString('utf8')) as { schemaVersion: number; records: Spec[] };
if (specs.schemaVersion !== 1 || new Set(specs.records.map(row => row.datasetId)).size !== specs.records.length) throw new Error('Invalid replication specifications');
const configs = parseTsv(read('geo_replication/config/datasets.tsv').toString('utf8'));
const records = specs.records.map(spec => {
  const dataset = DATASETS.find(row => row.id === spec.datasetId);
  if (!dataset) throw new Error(`Unregistered dataset: ${spec.datasetId}`);
  const config = configs.find(row => row.id === spec.configId);
  if (JSON.stringify(config) !== JSON.stringify(spec.config)) throw new Error(`Reviewed configuration changed: ${spec.datasetId}`);
  const fingerprints: Record<string, string> = { [spec.sheet.path]: spec.sheet.sha256 };
  if (spec.dedicatedBinding) {
    if (config !== undefined || spec.config !== undefined) throw new Error('A dedicated analysis cannot substitute a configuration row');
    for (const pin of validateDedicatedReplicationBinding(spec.dedicatedBinding, spec.datasetId, spec.configId, spec.sheet.path, spec.contrasts, read)) fingerprints[pin.path] = pin.sha256;
  } else if (!config) throw new Error(`Missing analysis configuration: ${spec.datasetId}`);
  const sheet = parseTsv(pinned(spec.sheet).toString('utf8')).filter(row => ['control', 'case'].includes(row.group));
  if (new Set(sheet.map(row => row.sample)).size !== sheet.length) throw new Error(`Duplicate local samples: ${spec.datasetId}`);
  let samples: GeoSample[] = [];
  for (const source of spec.sources) {
    if (!/^https?:\/\//.test(source.sourceUrl)) throw new Error(`Missing primary URL: ${source.path}`);
    const bytes = pinned(source);
    fingerprints[source.path] = source.sha256;
    const text = source.path.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    if (source.quote && !normal(text).includes(normal(source.quote))) throw new Error(`Reviewed quotation missing: ${source.path}: ${source.quote}`);
    if (source.kind === 'geo_soft') samples = geoSamples(text);
  }
  const arrayExpress = spec.mappingMethod === 'reviewed_arrayexpress_mapping';
  if (!arrayExpress && (!samples.length || new Set(samples.map(row => row.accession)).size !== samples.length)) throw new Error(`Invalid GEO samples: ${spec.datasetId}`);
  const poolSource = spec.sources.find(source => source.kind === 'pool_table');
  const poolRows = poolSource ? XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(read(poolSource.path), { type: 'buffer' }).Sheets.Sheet3, { header: 1, defval: null }).slice(3, 13) : [];
  const reviewedMapping = spec.sources.filter(source => source.kind === 'reviewed_mapping');
  if ((spec.mappingMethod === 'reviewed_mapping' || arrayExpress) && reviewedMapping.length !== 1) throw new Error(`Missing unique reviewed mapping: ${spec.datasetId}`);
  let arrayExpressMappings: BiologicalUnitMapping[] | undefined;
  const remainingMappings = reviewedRemainingMappings(spec, read);
  if (arrayExpress && !remainingMappings) {
    if (spec.accession !== 'E-MTAB-6929' || samples.length) throw new Error('Unreviewed ArrayExpress accession or mixed GEO source');
    const source = (kind: string) => {
      const rows = spec.sources.filter(row => row.kind === kind);
      if (rows.length !== 1) throw new Error(`Missing unique ArrayExpress ${kind}`);
      return rows[0];
    };
    const validator = source('mapping_validator');
    if (validator.path !== 'data/internal-qc/replication-2026-09-05/round5-e/arrayExpressMapping.mts') throw new Error('Unpinned ArrayExpress validator');
    arrayExpressMappings = validateArrayExpressReplicationMapping(JSON.parse(pinned(reviewedMapping[0]).toString('utf8')),
      pinned(source('arrayexpress_sdrf')).toString('utf8'), pinned(source('arrayexpress_idf')).toString('utf8'),
      sheet, spec.unitType, spec.sources.map(row => row.path));
  }
  const partitionSources = spec.sources.filter(source => source.kind === 'animal_partitions');
  let partitionEvidence: Parameters<typeof validateReviewedReplicationMapping>[5];
  if (partitionSources.length) {
    const path = 'data/internal-qc/replication-2026-09-05/round3-b/partitions.json';
    const script = 'data/internal-qc/replication-2026-09-05/round3-b/audit_spatial_partitions.py';
    if (spec.accession !== 'GSE273038' || partitionSources.length !== 1 || partitionSources[0].path !== path) throw new Error('Unsupported animal partition source');
    const artifact = JSON.parse(pinned(partitionSources[0]).toString('utf8'));
    if (artifact.datasetId !== spec.datasetId || artifact.script.path !== script || !Array.isArray(artifact.pins)) throw new Error('Animal partition identity changed');
    for (const pin of [artifact.script, ...artifact.pins]) {
      const source = spec.sources.find(source => source.path === pin.path) ?? (spec.sheet.path === pin.path ? spec.sheet : undefined);
      if (!source || source.sha256 !== pin.sha256 || source.bytes !== pin.bytes) throw new Error(`Missing animal partition dependency: ${pin.path}`);
      pinned(source);
    }
    execFileSync(process.env.PYTHON || 'python', [resolve(ROOT, script), '--check'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    partitionEvidence = { path, artifact };
  }
  const mappings: BiologicalUnitMapping[] = remainingMappings ?? arrayExpressMappings ?? (spec.mappingMethod === 'reviewed_mapping'
    ? validateReviewedReplicationMapping(JSON.parse(pinned(reviewedMapping[0]).toString('utf8')), samples, sheet,
      spec.unitType, spec.sources.map(source => source.path), partitionEvidence)
    : sheet.map(row => {
    const sourceIds = (row.source_samples || row.geo_accession || row.gsm || '').split(';').filter(Boolean);
    const matches = sourceIds.length ? sourceIds.map(id => samples.find(sample => sample.accession === id))
      : samples.filter(sample => sample.accession === row.sample || sample.description.includes(row.sample) || sample.title === row.sample);
    // Celastrol's deposited columns have explicit treatment/ordinal names, without animal IDs.
    if (!matches.length && spec.accession === 'GSE252779') {
      const label = row.sample.replace(/^Hypo-/, 'DIO-Hypothelamus-').replace(/-(\d+)$/, ' $1');
      matches.push(...samples.filter(sample => sample.title === label));
    }
    if (!matches.length || matches.some(sample => !sample)) throw new Error(`Unmapped source sample: ${spec.datasetId}/${row.sample}`);
    const geo = matches as GeoSample[];
    const mapping: BiologicalUnitMapping = { sample: row.sample, group: row.group, sourceSamples: geo.map(sample => sample.accession),
      sourceLabels: geo.map(sample => sample.title), unitType: spec.unitType, unitKey: null, identityBasis: 'unresolved',
      sourceUnitIdentifiers: [], constituentIdentifiers: [], independenceDeclared: false, sourcePaths: spec.sources.map(source => source.path) };
    if (spec.mappingMethod === 'source_alias') {
      if (geo.length !== 1) throw new Error(`Ambiguous source alias: ${row.sample}`);
      mapping.unitKey = geo[0].title;
      mapping.identityBasis = 'source_replicate_alias';
      mapping.independenceDeclared = true;
    } else if (spec.mappingMethod === 'source_matched_pool') {
      const ordinal = row.pair.match(/^pool(\d+)$/)?.[1];
      if (spec.accession !== 'GSE306829' || geo.length !== 1 || !ordinal
        || !geo[0].title.endsWith(`rep${ordinal}`)
        || (row.group === 'control' ? !geo[0].title.includes('input RNA') : !geo[0].title.includes('PNOC neuron ribosome IP RNA'))
        || row.pooled_animals !== '3') throw new Error(`Unresolved matched pool: ${row.sample}`);
      mapping.unitKey = row.pair;
      mapping.identityBasis = 'source_replicate_alias';
      mapping.independenceDeclared = true;
    } else if (spec.mappingMethod === 'source_litter') {
      const treatments = new Set(geo.map(sample => sample.characteristics.treatment));
      const litters = new Set(geo.map(sample => sample.characteristics.litter));
      if (treatments.size !== 1 || litters.size !== 1 || !litters.has(row.litter) || Number(row.source_animal_count) !== geo.length) throw new Error(`Mixed litter aggregation: ${row.sample}`);
      const treatment = [...treatments][0];
      if (row.group === 'case' ? treatment !== 'Benzene' : treatment !== 'Control') throw new Error(`Wrong maternal treatment: ${row.sample}/${treatment}`);
      mapping.unitKey = `${treatment}/litter:${row.litter}`;
      mapping.identityBasis = 'source_identifier';
      mapping.sourceUnitIdentifiers = [`treatment: ${treatment}`, `litter: ${row.litter}`];
      mapping.constituentIdentifiers = geo.map(sample => sample.accession);
      mapping.independenceDeclared = true;
    } else if (spec.mappingMethod === 'bird_pool_table') {
      const match = row.sample.match(/^(Low|High)RFI_[LH](\d)$/);
      if (!match) throw new Error(`Unsupported pool alias: ${row.sample}`);
      const key = `${match[1] === 'Low' ? 'L' : 'H'}RFI_Pool${match[2]}`;
      const authorRows = poolRows.filter(pool => pool[1] === key);
      if (authorRows.length !== 1 || authorRows[0][0] !== `${match[1]} RFI`) throw new Error(`Ambiguous author pool: ${key}`);
      mapping.unitKey = key;
      mapping.identityBasis = 'source_identifier';
      mapping.sourceUnitIdentifiers = [key];
      mapping.constituentIdentifiers = [String(authorRows[0][2]), String(authorRows[0][4])];
      mapping.independenceDeclared = true;
    }
    return mapping;
  }));
  if (!/^[a-f0-9]{64}$/.test(spec.mappingSha256) || sha(JSON.stringify(mappings)) !== spec.mappingSha256) throw new Error(`Reviewed biological mapping changed: ${spec.datasetId}`);
  const bundlePath = `public/${dataset.bundleFileTemplate.replace('{trackId}', dataset.defaultTrack).replace(/^\//, '')}`;
  const bytes = read(bundlePath);
  const bundleText = bytes.toString('utf8').replace(/^(?:var|let|const)\s+\w+\s*=\s*/, '').replace(/;\s*$/, '');
  const raw = JSON.parse(bundleText) as RawTrack;
  // Bind only the exact group-to-sample metadata; unrelated effect-table changes are outside this audit.
  const groupSamples = raw.meta?.groupSamples;
  const contrasts = Object.fromEntries(spec.contrasts.map(id => {
    const contrast = dataset.contrasts.find(row => row.id === id);
    if (!contrast) throw new Error(`Unregistered contrast: ${spec.datasetId}/${id}`);
    const baseline = groupSamples?.[contrast.baseline] ?? [];
    const cases = groupSamples?.[contrast.case] ?? [];
    const decision = replicationDecision(spec, id);
    const check = assessReplicationUnits(mappings, baseline, cases, decision.status, decision.note, [SPEC_PATH, ...Object.keys(fingerprints)]);
    if (decision.status === 'pass' && check.status !== 'pass') throw new Error(`Source evidence does not support proposed pass: ${spec.datasetId}/${id}: ${check.note}`);
    return [id, { baseline, cases, check }];
  }));
  return { datasetId: spec.datasetId, accession: spec.accession, configId: spec.configId, config: spec.config, sheet: spec.sheet.path,
    ...(spec.dedicatedBinding ? { dedicatedBinding: spec.dedicatedBinding } : {}),
    ...(spec.contrastDecisions ? { contrastDecisions: spec.contrastDecisions } : {}),
    bundlePath, groupSamplesSha256: sha(JSON.stringify(groupSamples)), fingerprints, sources: spec.sources, unitType: spec.unitType,
    mappingMethod: spec.mappingMethod, proposedStatus: spec.proposedStatus, note: spec.note, mappings, contrasts };
});
const artifact = { schemaVersion: 1, policyVersion: 'internal-replication-evidence-v1', reviewedAt: '2026-09-05',
  script: 'scripts/audit_replication_evidence.mts', scriptSha256: sha(read('scripts/audit_replication_evidence.mts')),
  helper: 'scripts/lib/replicationEvidence.mts', helperSha256: sha(read('scripts/lib/replicationEvidence.mts')),
  specifications: SPEC_PATH, specificationsSha256: sha(read(SPEC_PATH)),
  scope: 'Reviewed replication evidence for the exact listed contrasts. Source alias labels denote explicitly declared biological sampling units; no unpublished participant IDs or additional replicates are invented.', records };
output('replication-evidence.json', `${JSON.stringify(artifact, null, 2)}\n`);
const lines = ['# Biological-replication evidence — 2026-09-05', '',
  `${records.length} selected datasets were inspected against primary manuscripts, GEO sample metadata and current registered sample sheets. The audit writes only derived evidence; scientific inputs, sample assignments and differential-expression results remain unchanged.`, '',
  'Pass requires at least three independently supported biological units in each arm. A cell, library or GSM accession alone cannot establish a unit. A source alias is retained only when the paper or GEO explicitly establishes the biological replication represented by those profiles. Pools count once, and litter-based interventions are assessed at litter level.', '',
  '| Dataset | Proposed replication check | Units / samples | Finding |', '|---|---|---|---|'];
for (const record of records) {
  for (const [contrastId, contrast] of Object.entries(record.contrasts)) {
    lines.push(`| ${record.datasetId} / ${contrastId} | ${contrast.check.status} | ${contrast.baseline.length} baseline / ${contrast.cases.length} case ${record.unitType} profiles | ${replicationDecision({ ...record, contrasts: Object.keys(record.contrasts) }, contrastId).note} |`);
  }
}
lines.push('', '## Reproduction and integration', '',
  '`npx tsx scripts/audit_replication_evidence.mts --check` verifies every pinned original source, quoted declaration, sample sheet, selected config row, source-sample join and generated mapping. The generator also checks current application contrast membership and records its hash. The extractor for the bird-pool workbook requires an exact named author pool and disjoint constituent membership.', '',
  'The parent can integrate `replication-evidence.json` only after verifying its script/helper/specification fingerprints, every per-record source fingerprint, the selected configuration row, and current group-to-sample metadata. Use only the listed contrast and its mapping; rerun the shared unit assessor against current baseline/case arrays. Missing or stale evidence must not pass. The artifact is an evidence proposal and does not itself overwrite the shared QC ledger.', '',
  '## Unresolved source access and identity limits', '',
  '- GSE252779: official GEO metadata was inspected; its ordinal libraries do not independently establish animal identity. The cited Cell Metabolism paper has no open PMC manuscript linked in PubMed.',
  '- GSE264350: the final PMC13031583 XML endpoint returned HTTP 404. The retrieved original Research Square preprint describes housing five mice per cage, but does not resolve the registered RNA samples to animals/cages.',
  '- GSE229440: PMC10199724 XML returned HTTP 404. The official GEO source provides the necessary explicit dam count and per-GSM litter/treatment fields; the mapping is independently checked against those fields.',
  '- GSE301692: the paper\'s seventeen independent induction experiments describe image-model training. They do not certify independence of the registered day-15 RNA profiles. The experiment-like labels shared across success/failure remain unresolved.',
  '- GSE201408 and GSE245146: published maternal/litter structure is preserved as a model-review requirement, not replaced with unique specimen IDs.',
  '- GSE49540: the discrepancy between six published control animals and seven deposited/local control profiles is retained.', '',
  'Further primary-source reviews and unresolved candidates are documented in `round2/README.md`. GSE175461 includes a clearly identified short excerpt transcribed from the publisher page returned by web retrieval; it is not represented as an original manuscript download.', '',
  '## Sources', '');
for (const source of [...new Map(records.flatMap(record => record.sources).map(source => [source.path, source])).values()]) {
  lines.push(`- [${source.path}](${source.sourceUrl}) — SHA-256 \`${source.sha256}\`${source.quote ? `; verified excerpt: “${source.quote}”.` : '.'}`);
}
output('README.md', `${lines.join('\n')}\n`);
console.log(JSON.stringify({ reviewed: records.length, proposed: records.reduce((counts, record) => { counts[record.proposedStatus] = (counts[record.proposedStatus] ?? 0) + 1; return counts; }, {} as Record<string, number>), samplesMapped: records.reduce((total, record) => total + record.mappings.length, 0) }));
