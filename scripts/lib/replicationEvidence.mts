import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { QualityCheck, QualityStatus } from '../../src/data/qualityChecks';
import { parseTsv } from './internalQc.mjs';
import { validateArrayExpressReplicationMapping } from '../../data/internal-qc/replication-2026-09-05/round5-e/arrayExpressMapping.mjs';
import { validateArrayExpress12340Mapping, validateSra128148Mapping, validateRemainingGeoMapping } from '../../data/internal-qc/replication-2026-09-05/remaining-a/sourceMapping.mjs';

export interface BiologicalUnitMapping {
  sample: string;
  group: string;
  sourceSamples: string[];
  sourceLabels: string[];
  unitType: 'animal' | 'pool' | 'litter' | 'culture' | 'unresolved';
  unitKey: string | null;
  identityBasis: 'source_identifier' | 'source_replicate_alias' | 'unresolved';
  sourceUnitIdentifiers: string[];
  constituentIdentifiers: string[];
  independenceDeclared: boolean;
  sourcePaths: string[];
  sourcePartition?: { sourceSample: string; key: string; animalId: string; evidencePath: string; membershipSha256: string };
}

export interface AnimalPartitionEvidence {
  schemaVersion: number; policyVersion: string; sourceSample: string;
  allMetadataRows: number; selectedMetadataRows: number;
  allRowsAssignedExactlyOnce: boolean; selectedRowsAssignedExactlyOnce: boolean;
  partitions: { sample: string; group: string; sourceSample: string; partitionKey: string; sourceUnitIdentifier: string;
    allRows: number; selectedRows: number; allRowIdentifiersSha256: string }[];
}

export interface GeoReplicationSample {
  accession: string; title: string; description: string[]; characteristics: Record<string, string>;
}
export interface ReviewedReplicationMapping {
  schemaVersion: number;
  mappings: BiologicalUnitMapping[];
  joins: { sample: string; sourceSample: string; field: string; value: string }[];
}

const remainingSourceBindings: Record<string, readonly [string, string, string, string]> = {
  "rat_pvn_adolescent_stress_gse169296": [
    "GSE169296",
    "GSE169296",
    "geo_replication/datasets/GSE169296_rnor_pvn_adolescent_stress/metadata/GSE169296_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE169296.json"
  ],
  "rat_rph_noise_stress_gse229159": [
    "GSE229159",
    "GSE229159",
    "geo_replication/datasets/GSE229159_rnor_rph_noise_stress/metadata/GSE229159_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE229159.json"
  ],
  "mouse_hypo_puberty_emtab12340": [
    "E-MTAB-12340",
    "E-MTAB-12340",
    "geo_replication/datasets/EMTAB12340_mmus_hypothalamus_puberty/metadata/E-MTAB-12340_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/E-MTAB-12340.json"
  ],
  "mouse_arc_corticosterone_gse128148": [
    "GSE128148",
    "GSE128148",
    "geo_replication/datasets/GSE128148_mmus_arc_corticosterone/metadata/GSE128148_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE128148.json"
  ],
  "rat_fetal_hypo_ozone_gse156859": [
    "GSE156859",
    "GSE156859",
    "geo_replication/datasets/GSE156859_rnor_fetal_hypothalamus_ozone/metadata/GSE156859_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE156859.json"
  ],
  "mouse_hypo_thrb_k146q_gse167105": [
    "GSE167105",
    "GSE167105",
    "geo_replication/datasets/GSE167105_mmus_hypothalamus_thrb/metadata/GSE167105_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE167105.json"
  ],
  "mouse_arc_neun_development_gse189945": [
    "GSE189945",
    "GSE189945",
    "geo_replication/datasets/GSE189945_mmus_arc_development/metadata/GSE189945_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE189945.json"
  ],
  "hamster_tanycyte_photoperiod_gse204883": [
    "GSE204883",
    "GSE204883",
    "geo_replication/datasets/GSE204883_psun_tanycyte_photoperiod/metadata/GSE204883_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-a/mappings/GSE204883.json"
  ],
  "hamster_hypo_torpor_gse179663": [
    "GSE179663",
    "GSE179663",
    "geo_replication/datasets/GSE179663_psun_hypothalamus_torpor/metadata/GSE179663_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE179663.json"
  ],
  "pig_hypo_mia_gse227725": [
    "GSE227725",
    "GSE227725",
    "geo_replication/datasets/GSE227725_sscr_hypothalamus_mia/metadata/GSE227725_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE227725.json"
  ],
  "hamster_mbh_photoperiod_gse274003": [
    "GSE274003",
    "GSE274003",
    "geo_replication/datasets/GSE274003_psun_mbh_photoperiod/metadata/GSE274003_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE274003.json"
  ],
  "dormouse_hypo_torpor_gse207494": [
    "GSE207494",
    "GSE207494",
    "geo_replication/datasets/GSE207494_eque_hypothalamus_hibernation/metadata/GSE207494_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE207494.json"
  ],
  "pig_hypo_formula_gse281726": [
    "GSE281726",
    "GSE281726",
    "geo_replication/datasets/GSE281726_sscr_hypothalamus/metadata/GSE281726_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE281726.json"
  ],
  "cattle_hypo_nutrition_gse153495": [
    "GSE153495",
    "GSE153495",
    "geo_replication/datasets/GSE153495_btau_hypothalamus_nutrition/metadata/GSE153495_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE153495.json"
  ],
  "cattle_arc_nutrition_gse153498": [
    "GSE153498",
    "GSE153498",
    "geo_replication/datasets/GSE153498_btau_arcuate_nutrition/metadata/GSE153498_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE153498.json"
  ],
  "pig_hypo_low_growth_gse324226": [
    "GSE324226",
    "GSE324226",
    "geo_replication/datasets/GSE324226_sscr_hypothalamus_adg/metadata/GSE324226_samplesheet.tsv",
    "data/internal-qc/replication-2026-09-05/remaining-b/mappings/GSE324226.json"
  ]
};

/** Recheck the final sixteen studies against their complete current source identities. */
export function reviewedRemainingMappings(spec: {
  datasetId: string; accession: string; configId: string; mappingMethod: string; unitType: BiologicalUnitMapping['unitType'];
  sheet: { path: string }; sources: { kind: string; path: string }[];
}, read: (path: string) => Buffer): BiologicalUnitMapping[] | undefined {
  const groupA = ['GSE169296', 'GSE229159', 'E-MTAB-12340', 'GSE128148', 'GSE156859', 'GSE167105', 'GSE189945', 'GSE204883'];
  const groupB = ['GSE179663', 'GSE227725', 'GSE274003', 'GSE207494', 'GSE281726', 'GSE153495', 'GSE153498', 'GSE324226'];
  const binding = remainingSourceBindings[spec.datasetId];
  const scoped = spec.sources.some(row => /\/remaining-[ab]\//.test(row.path));
  if (!binding) {
    assert.ok(!scoped && ![...groupA, ...groupB].includes(spec.accession), 'Remaining-study evidence cannot inherit another dataset identity');
    return undefined;
  }
  assert.deepEqual([spec.accession, spec.configId, spec.sheet.path], binding.slice(0, 3), 'Remaining-study identity or current sheet changed');
  const source = (kind: string) => {
    const found = spec.sources.filter(row => row.kind === kind);
    assert.equal(found.length, 1, `Missing unique remaining-study ${kind}`);
    return found[0].path;
  };
  const text = (path: string) => (path.endsWith('.gz') ? gunzipSync(read(path)) : read(path)).toString('utf8');
  const allSheet = parseTsv(text(spec.sheet.path));
  const sheet = allSheet.filter(row => ['control', 'case'].includes(row.group));
  assert.equal(source('reviewed_mapping'), binding[3], 'Remaining-study reviewed mapping path changed');
  const document = JSON.parse(text(source('reviewed_mapping')));
  const paths = spec.sources.map(row => row.path);
  if (groupA.includes(spec.accession)) assert.equal(source('mapping_validator'), 'data/internal-qc/replication-2026-09-05/remaining-a/sourceMapping.mts');
  if (spec.accession === 'E-MTAB-12340') {
    assert.equal(spec.mappingMethod, 'reviewed_arrayexpress_mapping');
    assert.ok(!spec.sources.some(row => row.kind === 'geo_soft' || row.kind === 'sra_xml'), 'Mixed ArrayExpress and GEO/SRA sources');
    return validateArrayExpress12340Mapping(document, text(source('arrayexpress_sdrf')), text(source('arrayexpress_idf')), sheet, spec.unitType, paths);
  }
  assert.equal(spec.mappingMethod, 'reviewed_mapping');
  assert.ok(!spec.sources.some(row => row.kind.startsWith('arrayexpress_')), 'Mixed GEO and ArrayExpress sources');
  const geoText = text(source('geo_soft'));
  assert.deepEqual(geoText.match(/^\^SERIES = .+$/gm)?.map(row => row.trim()), [`^SERIES = ${spec.accession}`]);
  const geo: GeoReplicationSample[] = geoText.split(/^\^SAMPLE = /m).slice(1).map(block => {
    const lines = block.split(/\r?\n/);
    const field = (name: string) => lines.filter(line => line.startsWith(`!Sample_${name} = `)).map(line => line.split(' = ').slice(1).join(' = '));
    return { accession: lines[0].trim(), title: field('title')[0], description: field('description'),
      characteristics: Object.fromEntries(field('characteristics_ch1').map(value => {
        const offset = value.indexOf(':'); return [value.slice(0, offset).trim().toLowerCase(), value.slice(offset + 1).trim()];
      })) };
  });
  if (spec.accession === 'GSE128148') {
    assert.equal(spec.unitType, 'animal');
    return validateSra128148Mapping(document, text(source('sra_xml')), geo, sheet, allSheet, paths);
  }
  assert.ok(!spec.sources.some(row => row.kind === 'sra_xml'), 'Unexpected SRA source bridge');
  if (groupA.includes(spec.accession)) return validateRemainingGeoMapping(spec.accession, document, geo, sheet, spec.unitType, paths);
  assert.equal(spec.unitType, 'animal');
  assert.equal(sheet.length, allSheet.length);
  for (const local of sheet) {
    assert.match(local.geo_accession, /^GSM\d+$/, 'Current sheet has no exact GSM');
    const mapped = document.mappings.filter((row: BiologicalUnitMapping) => row.sample === local.sample);
    assert.equal(mapped.length, 1);
    assert.deepEqual(mapped[0].sourceSamples, [local.geo_accession]);
    if (local.title) assert.deepEqual(mapped[0].sourceLabels, [local.title]);
  }
  const mappings = validateReviewedReplicationMapping(document, geo, sheet, spec.unitType, paths);
  assert.equal(document.observedSourceMetadata.length, mappings.length);
  for (const { sample, ...observed } of document.observedSourceMetadata) {
    assert.deepEqual(observed, geo.find(row => row.accession === observed.accession)!);
    assert.ok(document.joins.some((join: ReviewedReplicationMapping['joins'][number]) => join.sample === sample && join.sourceSample === observed.accession), 'Observed source lacks its exact local join');
  }
  return mappings;
}

/** Verify a reviewed alias crosswalk against whole fields in the pinned GEO source. */
export function validateReviewedReplicationMapping(document: ReviewedReplicationMapping,
  samples: GeoReplicationSample[], sheet: Record<string, string>[],
  unitType: BiologicalUnitMapping['unitType'], sourcePaths: string[],
  partitionEvidence?: { path: string; artifact: AnimalPartitionEvidence }): BiologicalUnitMapping[] {
  if (document.schemaVersion !== 1 || !Array.isArray(document.mappings) || !Array.isArray(document.joins)
    || document.mappings.length !== sheet.length || new Set(document.mappings.map(row => row.sample)).size !== sheet.length
    || new Set(samples.map(row => row.accession)).size !== samples.length) throw new Error('Incomplete or duplicate reviewed mappings');
  const joins = new Set<string>();
  const expected = new Set<string>();
  if (partitionEvidence) {
    const proof = partitionEvidence.artifact;
    const unique = (key: 'sample' | 'partitionKey' | 'sourceUnitIdentifier') => new Set(proof.partitions.map(row => row[key])).size === sheet.length;
    if (proof.schemaVersion !== 1 || proof.policyVersion !== 'reviewed-disjoint-animal-partitions-v1'
      || !proof.allRowsAssignedExactlyOnce || !proof.selectedRowsAssignedExactlyOnce
      || !Array.isArray(proof.partitions) || proof.partitions.length !== sheet.length
      || !unique('sample') || !unique('partitionKey') || !unique('sourceUnitIdentifier')
      || proof.partitions.some(row => !Number.isInteger(row.allRows) || !Number.isInteger(row.selectedRows)
        || row.selectedRows <= 0 || row.allRows < row.selectedRows || row.sourceSample !== proof.sourceSample)
      || proof.partitions.reduce((sum, row) => sum + row.allRows, 0) !== proof.allMetadataRows
      || proof.partitions.reduce((sum, row) => sum + row.selectedRows, 0) !== proof.selectedMetadataRows) throw new Error('Incomplete disjoint animal partition evidence');
  }
  for (const row of document.mappings) {
    const local = sheet.find(sample => sample.sample === row.sample);
    if (!local || row.group !== local.group || row.unitType !== unitType
      || JSON.stringify(row.sourcePaths) !== JSON.stringify(sourcePaths)
      || !row.sourceSamples.length || new Set(row.sourceSamples).size !== row.sourceSamples.length
      || row.sourceSamples.length !== row.sourceLabels.length
      || typeof row.independenceDeclared !== 'boolean'
      || !['source_identifier', 'source_replicate_alias', 'unresolved'].includes(row.identityBasis)
      || !(row.unitKey === null || typeof row.unitKey === 'string' && row.unitKey.trim())
      || !Array.isArray(row.sourceUnitIdentifiers) || !Array.isArray(row.constituentIdentifiers)) {
      throw new Error(`Invalid reviewed local mapping: ${row.sample}`);
    }
    if (row.sourcePartition || partitionEvidence) {
      const partition = row.sourcePartition;
      const proof = partitionEvidence?.artifact.partitions.find(item => item.sample === row.sample);
      if (!partition || !proof || partition.evidencePath !== partitionEvidence!.path || !sourcePaths.includes(partition.evidencePath)
        || row.unitType !== 'animal' || row.identityBasis !== 'source_identifier'
        || row.unitKey !== proof.sourceUnitIdentifier || JSON.stringify(row.sourceUnitIdentifiers) !== JSON.stringify([proof.sourceUnitIdentifier])
        || proof.group !== row.group || JSON.stringify(row.sourceSamples) !== JSON.stringify([proof.sourceSample])
        || partition.sourceSample !== proof.sourceSample || partition.key !== proof.partitionKey
        || partition.animalId !== proof.sourceUnitIdentifier || partition.membershipSha256 !== proof.allRowIdentifiersSha256
        || !/^[a-f0-9]{64}$/.test(partition.membershipSha256)) throw new Error(`Unproven multiplexed animal partition: ${row.sample}`);
    }
    row.sourceSamples.forEach((id, index) => {
      const source = samples.find(sample => sample.accession === id);
      if (!source || row.sourceLabels[index] !== source.title) throw new Error(`Changed reviewed GEO label: ${row.sample}/${id}`);
      expected.add(`${row.sample}\t${id}`);
    });
  }
  for (const join of document.joins) {
    const key = `${join.sample}\t${join.sourceSample}`;
    const source = samples.find(sample => sample.accession === join.sourceSample);
    const values = join.field === 'title' ? [source?.title] : join.field === 'description' ? source?.description
      : join.field.startsWith('characteristic:') ? [source?.characteristics[join.field.slice('characteristic:'.length)]] : [];
    if (joins.has(key) || !expected.has(key) || !join.value?.trim() || !values?.includes(join.value)) {
      throw new Error(`Unsupported or changed reviewed GEO join: ${key}`);
    }
    joins.add(key);
  }
  if (joins.size !== expected.size) throw new Error('Incomplete reviewed GEO joins');
  return sheet.map(local => document.mappings.find(row => row.sample === local.sample)!);
}

/** Count the experimental units, never GSM IDs, cells, or animals within a pool. */
export function assessReplicationUnits(
  mappings: BiologicalUnitMapping[], baseline: string[], cases: string[],
  reviewedStatus: QualityStatus, note: string, evidence: string[],
): QualityCheck {
  const result = (status: QualityStatus, detail: string): QualityCheck => ({
    id: 'independent_replication', label: 'Independent biological replication', status,
    note: `${detail} ${note}`, evidence,
  });
  const selected = [...baseline, ...cases];
  const rows = selected.map(sample => mappings.filter(row => row.sample === sample));
  if (!selected.length || new Set(selected).size !== selected.length || rows.some(found => found.length !== 1)) {
    return result('not_assessed', 'The source-to-biological-unit mapping does not uniquely cover every current contrast sample.');
  }
  if (reviewedStatus !== 'pass') return result(reviewedStatus, 'Primary-source replication review remains unresolved.');
  const bySample = new Map(rows.map(([row]) => [row.sample, row]));
  const values = [...bySample.values()];
  if (values.some(row => !row.unitKey || !row.independenceDeclared || !row.sourcePaths.length || row.identityBasis === 'unresolved' || row.unitType === 'unresolved')) {
    return result('not_assessed', 'A sample label alone is insufficient: every counted unit needs an explicit primary-source independence declaration.');
  }
  const a = new Set(baseline.map(sample => bySample.get(sample)!.unitKey!));
  const b = new Set(cases.map(sample => bySample.get(sample)!.unitKey!));
  const reused = a.size !== baseline.length || b.size !== cases.length || [...a].some(unit => b.has(unit));
  const memberToUnit = new Map<string, string>();
  const sourceToUnits = new Map<string, BiologicalUnitMapping[]>();
  const identifierToUnit = new Map<string, string>();
  let overlappingMembers = false;
  for (const row of values) {
    if (row.sourceUnitIdentifiers.length) {
      const signature = JSON.stringify([...new Set(row.sourceUnitIdentifiers)].sort());
      if (identifierToUnit.has(signature) && identifierToUnit.get(signature) !== row.unitKey) overlappingMembers = true;
      identifierToUnit.set(signature, row.unitKey!);
    }
    for (const source of row.sourceSamples) {
      for (const prior of sourceToUnits.get(source) ?? []) {
        const a = prior.sourcePartition;
        const b = row.sourcePartition;
        const valid = (item: BiologicalUnitMapping, partition: BiologicalUnitMapping['sourcePartition']) =>
          partition && partition.sourceSample === source && item.unitType === 'animal' && item.identityBasis === 'source_identifier'
          && partition.animalId === item.unitKey && JSON.stringify(item.sourceUnitIdentifiers) === JSON.stringify([partition.animalId])
          && item.sourcePaths.includes(partition.evidencePath) && /^[a-f0-9]{64}$/.test(partition.membershipSha256);
        const disjoint = valid(prior, a) && valid(row, b) && a!.evidencePath === b!.evidencePath
          && a!.key !== b!.key && a!.animalId !== b!.animalId && a!.membershipSha256 !== b!.membershipSha256;
        if (prior.unitKey !== row.unitKey && !disjoint) overlappingMembers = true;
      }
      sourceToUnits.set(source, [...(sourceToUnits.get(source) ?? []), row]);
    }
    for (const member of row.constituentIdentifiers) {
      if (memberToUnit.has(member) && memberToUnit.get(member) !== row.unitKey) overlappingMembers = true;
      memberToUnit.set(member, row.unitKey!);
    }
  }
  const minimum = Math.min(a.size, b.size);
  const status = minimum < 2 ? 'fail' : minimum < 3 || reused || overlappingMembers ? 'review' : 'pass';
  return result(status, `${a.size} baseline and ${b.size} case ${[...new Set(values.map(row => row.unitType))].join('/')} units are supported by primary sources.${reused ? ' Reused units require aggregation or paired-model review.' : ''}${overlappingMembers ? ' Biological constituents recur in different units; their dependence requires review.' : ''}${minimum < 3 ? ' Fewer than three units in an arm do not meet the passing threshold.' : ''} Source-replicate aliases identify the documented sampling units; unpublished animal or donor IDs are not invented.`);
}

interface FilePin { path: string; sha256: string; bytes: number }
export interface DedicatedReplicationBinding {
  evidencePath: string; recordSha256: string; replay: FilePin; pins: FilePin[];
}
export type ReplicationDecisions = Record<string, { status: QualityStatus; note: string }>;

/** Dedicated analyses have real script/input bindings, without a fabricated datasets.tsv row. */
export function validateDedicatedReplicationBinding(
  binding: DedicatedReplicationBinding, datasetId: string, configId: string, sheet: string, contrasts: string[],
  read: (path: string) => Buffer,
): FilePin[] {
  const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
  if (binding.evidencePath !== 'data/internal-qc/advancement-2026-09-05/dedicated-evidence.json') throw new Error('Unexpected dedicated evidence path');
  const artifact = JSON.parse(read(binding.evidencePath).toString('utf8'));
  const matches = artifact.records.filter((row: any) => row.datasetId === datasetId);
  if (artifact.schemaVersion !== 1 || matches.length !== 1 || sha(JSON.stringify(matches[0])) !== binding.recordSha256) throw new Error('Dedicated analysis record changed');
  const record = matches[0];
  const mechanical = JSON.parse(read('data/author-validation/mechanical-audit.generated.json').toString('utf8'));
  const analyses = mechanical.datasets.filter((row: any) => row.datasetId === datasetId);
  if (analyses.length !== 1 || analyses[0].configId !== null || record.configId !== configId || record.sheet !== sheet) throw new Error('Dedicated analysis identity changed');
  const required = [sheet, 'scripts/audit_internal_dedicated.R', `scripts/de_${configId.toLowerCase()}.R`,
    ...contrasts.map(id => {
      const tables = analyses[0].contrasts.filter((row: any) => row.contrastId === id);
      if (tables.length !== 1 || !record.contrasts[id]) throw new Error('Dedicated contrast binding missing');
      return tables[0].table;
    })];
  const paths = binding.pins.map(pin => pin.path);
  if (new Set(paths).size !== paths.length || paths.length !== Object.keys(record.fingerprints).length
    || !required.every(path => paths.includes(path)) || !paths.some(path => path.includes('/raw/'))
    || binding.replay.path !== record.replayFile || binding.replay.sha256 !== record.replaySha256) throw new Error('Incomplete dedicated file bindings');
  for (const pin of binding.pins) {
    if (record.fingerprints[pin.path] !== pin.sha256) throw new Error('Dedicated file pin changed');
  }
  for (const pin of [...binding.pins, binding.replay]) {
    const bytes = read(pin.path);
    if (!/^[a-f0-9]{64}$/.test(pin.sha256) || bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) throw new Error(`Dedicated evidence changed: ${pin.path}`);
  }
  const replay = JSON.parse(read(binding.replay.path).toString('utf8'));
  if (!['configId', 'measurement', 'designRank', 'designColumns', 'residualDf', 'contrasts'].every(key => JSON.stringify(record[key]) === JSON.stringify(replay[key]))) throw new Error('Dedicated replay differs from analysis record');
  return [...binding.pins, binding.replay];
}

export function replicationDecision(
  spec: { contrasts: string[]; proposedStatus: QualityStatus; note: string; contrastDecisions?: ReplicationDecisions }, contrastId: string,
): { status: QualityStatus; note: string } {
  if (!spec.contrasts.includes(contrastId) || new Set(spec.contrasts).size !== spec.contrasts.length) throw new Error('Unknown or duplicate reviewed contrast');
  const decisionKeys = Object.keys(spec.contrastDecisions ?? {});
  if (spec.contrastDecisions && (decisionKeys.length !== spec.contrasts.length
    || !spec.contrasts.every(id => decisionKeys.includes(id)))) throw new Error('Incomplete per-contrast decisions');
  const decision = spec.contrastDecisions?.[contrastId] ?? { status: spec.proposedStatus, note: spec.note };
  if (!['pass', 'review', 'fail', 'not_assessed', 'not_applicable'].includes(decision.status) || !decision.note?.trim()) throw new Error('Invalid replication decision');
  return decision;
}

interface ReviewedRecord {
  datasetId: string; accession: string; configId: string; config?: Record<string, string>; sheet: string;
  mappingMethod: string; unitType: BiologicalUnitMapping['unitType'];
  dedicatedBinding?: DedicatedReplicationBinding; contrastDecisions?: ReplicationDecisions;
  bundlePath: string; groupSamplesSha256: string; fingerprints: Record<string, string>;
  proposedStatus: QualityStatus; note: string; mappings: BiologicalUnitMapping[];
  contrasts: Record<string, { baseline: string[]; cases: string[] }>;
}
interface ReplicationArtifact {
  schemaVersion: number; script: string; scriptSha256: string; helper: string; helperSha256: string;
  specifications: string; specificationsSha256: string; records: ReviewedRecord[];
}

/** A stale reviewed record must replace, rather than fall back to, a label-derived pass. */
export function reviewedReplicationCheck(
  root: string, datasetId: string, contrastId: string, config: Record<string, string> | undefined,
  baseline: string[], cases: string[],
  readBytes: (absolutePath: string) => Buffer = path => readFileSync(path),
): QualityCheck | null {
  const artifactPath = 'data/internal-qc/replication-2026-09-05/replication-evidence.json';
  const failClosed = (reason: string): QualityCheck => ({ id: 'independent_replication', label: 'Independent biological replication',
    status: 'not_assessed', note: `Reviewed biological-replication evidence is unavailable or stale: ${reason}. Rerun the replication audit before a passing assessment.`, evidence: [artifactPath] });
  const unavailableForReviewedDataset = (reason: string): QualityCheck | null => {
    const specificationsPath = resolve(root, 'data/internal-qc/replication-2026-09-05/reviewed-specifications.json');
    if (!existsSync(specificationsPath)) return null;
    try {
      const specifications = JSON.parse(readBytes(specificationsPath).toString('utf8')) as { records: { datasetId: string }[] };
      return specifications.records.some(row => row.datasetId === datasetId) ? failClosed(reason) : null;
    } catch {
      return failClosed('the review specifications cannot be read');
    }
  };
  if (!existsSync(resolve(root, artifactPath))) return unavailableForReviewedDataset('the reviewed artifact is missing');
  try {
    const read = (path: string): Buffer => {
      const absolute = resolve(root, path);
      const within = relative(resolve(root), absolute);
      if (isAbsolute(path) || within === '..' || within.startsWith(`..\\`) || within.startsWith('../')) throw new Error('Evidence path escapes the repository');
      return readBytes(absolute);
    };
    const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
    const artifact = JSON.parse(read(artifactPath).toString('utf8')) as ReplicationArtifact;
    if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.records)) return failClosed('unsupported artifact schema');
    const matches = artifact.records.filter(row => row.datasetId === datasetId);
    if (!matches.length) return unavailableForReviewedDataset('the reviewed dataset row is missing');
    if (matches.length !== 1) return failClosed('duplicate dataset evidence');
    const record = matches[0];
    const contrast = record.contrasts[contrastId];
    if (!contrast) return failClosed('the requested contrast was not reviewed');
    const required = [
      ['scripts/audit_replication_evidence.mts', artifact.script, artifact.scriptSha256],
      ['scripts/lib/replicationEvidence.mts', artifact.helper, artifact.helperSha256],
      ['data/internal-qc/replication-2026-09-05/reviewed-specifications.json', artifact.specifications, artifact.specificationsSha256],
    ];
    for (const [expectedPath, path, expectedHash] of required) {
      if (path !== expectedPath || !/^[a-f0-9]{64}$/.test(expectedHash) || sha(read(path)) !== expectedHash) return failClosed(`changed ${expectedPath}`);
    }
    const specifications = JSON.parse(read(artifact.specifications).toString('utf8')) as {
      records: { datasetId: string; accession: string; configId: string; proposedStatus: QualityStatus; note: string; config?: Record<string, string>; mappingSha256: string; contrasts: string[];
        mappingMethod: string; unitType: BiologicalUnitMapping['unitType'];
        dedicatedBinding?: DedicatedReplicationBinding; contrastDecisions?: ReplicationDecisions;
        sheet: { path: string; sha256: string; bytes: number }; sources: { path: string; sha256: string; bytes: number; kind: string }[] }[];
    };
    const approved = specifications.records.filter(row => row.datasetId === datasetId);
    if (approved.length !== 1) return failClosed('missing unique reviewed specification');
    const spec = approved[0];
    if (record.accession !== spec.accession || record.mappingMethod !== spec.mappingMethod || record.unitType !== spec.unitType) return failClosed('the source type or biological unit changed');
    if (!spec.contrasts.includes(contrastId) || !/^[a-f0-9]{64}$/.test(spec.mappingSha256) || sha(JSON.stringify(record.mappings)) !== spec.mappingSha256) return failClosed('the mapping differs from its reviewed specification');
    if (record.proposedStatus !== spec.proposedStatus || record.note !== spec.note || record.sheet !== spec.sheet.path) return failClosed('the decision differs from its reviewed specification');
    if (JSON.stringify(record.contrastDecisions) !== JSON.stringify(spec.contrastDecisions)
      || JSON.stringify(record.dedicatedBinding) !== JSON.stringify(spec.dedicatedBinding)) return failClosed('the contrast decisions or dedicated analysis binding changed');
    const decision = replicationDecision(spec, contrastId);
    let dedicatedPins: FilePin[] = [];
    if (spec.dedicatedBinding) {
      if (config !== undefined || spec.config !== undefined || record.config !== undefined || record.configId !== spec.configId) return failClosed('a dedicated analysis cannot substitute a configuration row');
      dedicatedPins = validateDedicatedReplicationBinding(spec.dedicatedBinding, datasetId, spec.configId, spec.sheet.path, spec.contrasts, read);
    } else if (!config || JSON.stringify(config) !== JSON.stringify(record.config) || JSON.stringify(config) !== JSON.stringify(spec.config)) return failClosed('the selected analysis configuration changed');
    const pins = [spec.sheet, ...spec.sources, ...dedicatedPins];
    if (Object.keys(record.fingerprints).length !== new Set(pins.map(pin => pin.path)).size) return failClosed('source fingerprint coverage differs');
    for (const pin of pins) {
      const bytes = read(pin.path);
      if (!/^[a-f0-9]{64}$/.test(pin.sha256) || record.fingerprints[pin.path] !== pin.sha256 || bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) return failClosed(`changed source ${pin.path}`);
    }
    const remainingMappings = reviewedRemainingMappings(spec, read);
    if (remainingMappings && sha(JSON.stringify(remainingMappings)) !== spec.mappingSha256) return failClosed('the complete remaining-study source mapping changed');
    if (spec.mappingMethod === 'reviewed_arrayexpress_mapping' && !remainingMappings) {
      if (spec.accession !== 'E-MTAB-6929') return failClosed('the ArrayExpress accession was not reviewed');
      const source = (kind: string) => {
        const rows = spec.sources.filter(row => row.kind === kind);
        if (rows.length !== 1) throw new Error(`Missing unique ArrayExpress ${kind}`);
        return rows[0];
      };
      if (source('mapping_validator').path !== 'data/internal-qc/replication-2026-09-05/round5-e/arrayExpressMapping.mts'
        || spec.sources.some(row => row.kind === 'geo_soft')) return failClosed('the ArrayExpress validator or source type changed');
      const mapped = validateArrayExpressReplicationMapping(JSON.parse(read(source('reviewed_mapping').path).toString('utf8')),
        read(source('arrayexpress_sdrf').path).toString('utf8'), read(source('arrayexpress_idf').path).toString('utf8'),
        parseTsv(read(spec.sheet.path).toString('utf8')).filter(row => ['control', 'case'].includes(row.group)),
        spec.unitType, spec.sources.map(row => row.path));
      if (sha(JSON.stringify(mapped)) !== spec.mappingSha256) return failClosed('the complete ArrayExpress mapping changed');
    }
    const bundle = JSON.parse(read(record.bundlePath).toString('utf8').replace(/^(?:var|let|const)\s+\w+\s*=\s*/, '').replace(/;\s*$/, '')) as { meta?: { groupSamples?: Record<string, string[]> } };
    if (sha(JSON.stringify(bundle.meta?.groupSamples)) !== record.groupSamplesSha256) return failClosed('the displayed group membership changed');
    if (JSON.stringify(baseline) !== JSON.stringify(contrast.baseline) || JSON.stringify(cases) !== JSON.stringify(contrast.cases)) return failClosed('the requested sample membership changed');
    return assessReplicationUnits(record.mappings, baseline, cases, decision.status, decision.note,
      [artifactPath, artifact.specifications, ...Object.keys(record.fingerprints)]);
  } catch (error) {
    return failClosed(error instanceof Error ? error.message : String(error));
  }
}
