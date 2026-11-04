/** Exact, expression-only import of GTEx v10 Brain - Hypothalamus per-sample TPM.
 *
 * Offline by default: verifies the retained sources, writes the generated
 * products under public/expression/gtex/ and reads every value back.
 *   --check   byte-compare existing products instead of writing them
 *   --fetch   re-download the pinned originals and the Portal API medians,
 *             refuse any byte change, and rewrite the retained files
 *   --record  with --fetch only: record retained-file hashes in the manifest
 *             (first acquisition, or a deliberate source update)
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ExternalColumn, ExternalSample, ExternalValidationCheckpoint } from '../src/expression-survey/externalReferenceFormat';
import type { ExpressionSource } from '../src/types';
import {
  assertSameApiAnswer, buildProducts, fetchPinned, productDir, readRetained, replay, sha256, sourceNumber, writeOrCheck,
  type ExternalFeature, type ManifestInput, type PinnedInput,
} from './lib/externalReference.mjs';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'data/expression/gtex');
const TISSUE = 'Brain - Hypothalamus';
const SAMPLES = 257;
const GENES = 59033;
const VALUE_SHARDS = 2048;
const SOURCE_ID = 'gtex-v10-brain-hypothalamus';
const GROUP = 'all-donors';
const CHECKPOINT_GENES = ['POMC', 'AGRP', 'HCRT', 'NPY'];
const API = 'https://gtexportal.org/api/v2/expression/medianGeneExpression';

interface Retained { file: string; kind: 'original' | 'extract' | 'gzip' | 'api'; rule: string; bytes: number; sha256: string }
interface SourceInput extends PinnedInput { retained: Retained }
interface SourceManifest { schemaVersion: 1; provider: 'gtex'; release: string; retrieved: string; inputs: SourceInput[] }
interface ApiCheckpoint { gene: string; gencodeId: string; url: string; response: unknown }

const SEX: Record<string, string> = { 1: 'male', 2: 'female' };

function lines(text: string): string[] {
  assert.ok(!text.includes('\r'), 'GTEx sources are LF-only; a CR means the bytes were altered');
  const rows = text.split('\n');
  assert.equal(rows.pop(), '', 'Expected a final newline');
  return rows;
}

function tsvObjects(text: string): Record<string, string>[] {
  const [head, ...rows] = lines(text);
  const header = head.split('\t');
  assert.equal(new Set(header).size, header.length, 'Duplicate TSV headers');
  return rows.map((row) => {
    const fields = row.split('\t');
    assert.equal(fields.length, header.length, 'Ragged TSV row');
    return Object.fromEntries(header.map((key, index) => [key, fields[index]]));
  });
}

/** Header plus the rows whose SAMPID is a GCT sample column, in source order. */
function extractAttributes(original: Buffer, sampleIds: Set<string>): Buffer {
  const rows = lines(original.toString('utf8'));
  const kept = [rows[0], ...rows.slice(1).filter((row) => sampleIds.has(row.slice(0, row.indexOf('\t'))))];
  return gzipSync(Buffer.from(`${kept.join('\n')}\n`, 'utf8'), { level: 9 });
}

function gctSampleIds(gct: Buffer): string[] {
  const text = gunzipSync(gct).toString('utf8');
  const third = text.split('\n', 3)[2];
  return third.split('\t').slice(2);
}

async function fetchApiMedians(gencodeIds: Map<string, string>): Promise<Buffer> {
  const checkpoints: ApiCheckpoint[] = [];
  for (const gene of CHECKPOINT_GENES) {
    const gencodeId = gencodeIds.get(gene);
    assert.ok(gencodeId, `Checkpoint gene ${gene} missing from the GCT`);
    const url = `${API}?gencodeId=${gencodeId}&datasetId=gtex_v10&tissueSiteDetailId=Brain_Hypothalamus`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `GTEx API failed for ${gene} (${response.status})`);
    checkpoints.push({ gene, gencodeId, url, response: await response.json() });
  }
  return Buffer.from(`${JSON.stringify({ retrieved: new Date().toISOString(), checkpoints }, null, 2)}\n`, 'utf8');
}

function gencodeIdsFrom(gct: Buffer): Map<string, string> {
  const ids = new Map<string, string>();
  for (const row of lines(gunzipSync(gct).toString('utf8')).slice(3)) {
    const [id, symbol] = row.split('\t', 2);
    if (CHECKPOINT_GENES.includes(symbol) && !id.includes('_PAR_Y')) ids.set(symbol, id);
  }
  return ids;
}

async function acquire(manifest: SourceManifest, record: boolean): Promise<void> {
  const byName = new Map(manifest.inputs.map((input) => [input.name, input]));
  const gctInput = byName.get('gene_tpm_v10_brain_hypothalamus.gct.gz')!;
  const gct = await fetchPinned(gctInput);
  const sampleIds = new Set(gctSampleIds(gct));
  const outputs = new Map<SourceInput, Buffer>();
  for (const input of manifest.inputs) {
    if (input.retained.kind === 'api') continue;
    const original = input === gctInput ? gct : await fetchPinned(input);
    outputs.set(input, input.retained.kind === 'original' ? original
      : input.retained.kind === 'gzip' ? gzipSync(original, { level: 9 })
      : extractAttributes(original, sampleIds));
  }
  const api = manifest.inputs.find((input) => input.retained.kind === 'api')!;
  outputs.set(api, await fetchApiMedians(gencodeIdsFrom(gct)));
  for (const [input, bytes] of outputs) {
    if (record) {
      input.retained.bytes = bytes.length;
      input.retained.sha256 = sha256(bytes);
      if (input.retained.kind === 'api') { input.bytes = bytes.length; input.sha256 = sha256(bytes); }
    } else if (input.retained.kind === 'api') {
      await assertSameApiAnswer(bytes, path.join(SOURCE, input.retained.file), input.retained);
      continue;
    } else {
      assert.equal(sha256(bytes), input.retained.sha256, `Retained ${input.retained.file} would change; use --record deliberately`);
    }
    await writeFile(path.join(SOURCE, input.retained.file), bytes);
  }
  if (record) {
    manifest.retrieved = new Date().toISOString().slice(0, 10);
    await writeFile(path.join(SOURCE, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const fetchSource = process.argv.includes('--fetch');
  const record = process.argv.includes('--record');
  assert.ok(!(check && fetchSource), '--check is offline and cannot be combined with --fetch');
  assert.ok(!record || fetchSource, '--record requires --fetch');
  const manifestPath = path.join(SOURCE, 'source-manifest.json');
  const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SourceManifest;
  assert.equal(sourceManifest.schemaVersion, 1);
  assert.equal(sourceManifest.provider, 'gtex');
  if (fetchSource) await acquire(sourceManifest, record);

  const retained = new Map<string, Buffer>();
  for (const input of sourceManifest.inputs) {
    assert.equal(path.basename(input.retained.file), input.retained.file, 'Retained files must be local');
    retained.set(input.name, await readRetained(path.join(SOURCE, input.retained.file), input.retained));
  }
  const gctLines = lines(gunzipSync(retained.get('gene_tpm_v10_brain_hypothalamus.gct.gz')!).toString('utf8'));
  assert.equal(gctLines[0], '#1.2');
  assert.equal(gctLines[1], `${GENES}\t${SAMPLES}`);
  const header = gctLines[2].split('\t');
  assert.deepEqual(header.slice(0, 2), ['Name', 'Description']);
  const sampleIds = header.slice(2);
  assert.equal(sampleIds.length, SAMPLES);
  assert.equal(new Set(sampleIds).size, SAMPLES, 'Duplicate GCT sample');

  const attributes = new Map(tsvObjects(gunzipSync(retained.get('GTEx_Analysis_v10_Annotations_SampleAttributesDS.txt')!).toString('utf8'))
    .map((row) => [row.SAMPID, row]));
  const subjects = new Map(tsvObjects(gunzipSync(retained.get('GTEx_Analysis_v10_Annotations_SubjectPhenotypesDS.txt')!).toString('utf8'))
    .map((row) => [row.SUBJID, row]));
  assert.equal(attributes.size, SAMPLES, 'Attribute extract must hold exactly the GCT samples');
  const samples: ExternalSample[] = sampleIds.map((id) => {
    const attribute = attributes.get(id);
    assert.ok(attribute, `No sample attributes for ${id}`);
    assert.equal(attribute.SMTSD, TISSUE, `${id} is not ${TISSUE}`);
    assert.equal(attribute.SMAFRZE, 'RNASEQ', `${id} is not in the RNA-seq freeze`);
    const subject = id.split('-').slice(0, 2).join('-');
    const phenotype = subjects.get(subject);
    assert.ok(phenotype, `No subject phenotypes for ${subject}`);
    assert.ok(phenotype.SEX in SEX, `Unexpected SEX code for ${subject}`);
    return {
      id, label: id, sourceId: SOURCE_ID, groupId: GROUP,
      metadata: {
        subject, sex: SEX[phenotype.SEX], ageBand: phenotype.AGE,
        hardyScale: phenotype.DTHHRDY === '' ? 'not reported' : phenotype.DTHHRDY,
        rin: attribute.SMRIN, ischemicTimeMinutes: attribute.SMTSISCH, uberon: attribute.SMUBRID,
      },
    };
  });
  assert.equal(new Set(samples.map((sample) => sample.metadata.subject)).size, SAMPLES, 'Expected one sample per donor');

  const checkpoints: ExternalValidationCheckpoint[] = [];
  const features: ExternalFeature[] = gctLines.slice(3).map((row, rowIndex) => {
    const fields = row.split('\t');
    assert.equal(fields.length, SAMPLES + 2, `Ragged GCT row ${rowIndex}`);
    const [id, symbol] = fields;
    const ensembl = /^(ENSG\d{11})\.\d+(?:_PAR_Y)?$/.exec(id);
    assert.ok(ensembl, `Unexpected GENCODE feature ID ${id}`);
    assert.ok(symbol, `Empty Description for ${id}`);
    const texts = fields.slice(2);
    const values = texts.map((text, index) => sourceNumber(text, `${id}/${sampleIds[index]}`));
    if (CHECKPOINT_GENES.includes(symbol) && !id.includes('_PAR_Y')) {
      for (const index of [0, 128, 256]) {
        checkpoints.push({ source: SOURCE_ID, feature: id, symbol, column: sampleIds[index], sourceText: texts[index], value: values[index] });
      }
    }
    return { source: SOURCE_ID, id, symbol, ensemblId: ensembl[1], values };
  });
  assert.equal(features.length, GENES);
  assert.equal(checkpoints.length, CHECKPOINT_GENES.length * 3, 'Every checkpoint gene must be present once');

  // Independent agreement: the Portal API's published median for each checkpoint gene.
  const api = JSON.parse(retained.get('portal-api-medians.json')!.toString('utf8')) as { retrieved: string; checkpoints: ApiCheckpoint[] };
  const apiNotes = api.checkpoints.map((point) => {
    const published = (point.response as { data: Array<{ median: number; gencodeId: string }> }).data;
    assert.equal(published.length, 1, `GTEx API returned no single median for ${point.gene}`);
    assert.equal(published[0].gencodeId, point.gencodeId);
    const feature = features.find((candidate) => candidate.id === point.gencodeId);
    assert.ok(feature, `API checkpoint ${point.gencodeId} is not in the GCT`);
    const computed = median(feature.values as number[]);
    assert.ok(Math.abs(computed - published[0].median) <= 1e-5 * Math.max(1, Math.abs(published[0].median)),
      `${point.gene}: imported median ${computed} differs from the Portal API median ${published[0].median}`);
    return `${point.gene} median ${computed} TPM over ${SAMPLES} samples; Portal API ${published[0].median}`;
  });

  const sex = { male: samples.filter((s) => s.metadata.sex === 'male').length, female: samples.filter((s) => s.metadata.sex === 'female').length };
  const ages = [...new Set(samples.map((s) => s.metadata.ageBand))].sort();
  const notes = [
    'Values are the GTEx Portal\'s published gene TPM (RNA-SeQC v2.4.2, GENCODE v39), imported without renormalization, rounding, version collapsing or symbol aggregation.',
    'Each profile is one postmortem tissue sample from a different donor. Sex, age band (decades), Hardy death-circumstance scale, RIN and ischemic time are retained per sample.',
    'GTEx donors are adults sampled postmortem; feeding and circadian state are unknown, so no group is eligible for the fed/reference filter.',
    'Two features on the Y pseudo-autosomal region (_PAR_Y) share a symbol and Ensembl ID with their X copy. Such queries report both as ambiguous; use the versioned GENCODE ID.',
    'This human bulk-tissue reference supplies no differential-expression comparison and is never averaged with rodent or other-study values.',
  ];
  const source: ExpressionSource = {
    id: SOURCE_ID, label: 'Human hypothalamus · GTEx v10', collection: 'external', scope: 'tissue',
    populationId: 'gtex-hypothalamus', populationLabel: 'Human hypothalamus (GTEx)', region: 'Hypothalamus',
    species: 'Homo sapiens', assay: 'Bulk RNA-seq of postmortem tissue', rnaFraction: 'PolyA+ RNA (Illumina TruSeq, unstranded)',
    unit: 'TPM', normalization: 'GTEx RNA-SeQC v2.4.2 gene TPM, GENCODE v39; published values as distributed',
    replicateUnit: `One tissue sample per postmortem donor (${SAMPLES} donors)`,
    identityMethod: `GTEx tissue site detail "${TISSUE}" (UBERON:0001898)`,
    conditions: [{
      key: GROUP, label: 'All donors', referenceEligible: false, feedingState: 'not applicable (postmortem donors)',
      notes: 'Postmortem adult donors. Death circumstances (Hardy scale), RIN and ischemic time vary by sample; see sample metadata.',
      sampleCount: SAMPLES, sex: `${sex.male} male, ${sex.female} female`, age: `${ages[0]} to ${ages.at(-1)} years (decade bands)`,
    }],
    sourceUrl: 'https://gtexportal.org/home/tissue/Brain_Hypothalamus',
    citation: 'GTEx Consortium. The GTEx Consortium atlas of genetic regulatory effects across human tissues. Science 2020;369(6509):1318–1330. GTEx Analysis Release V10.',
    notes: notes.join(' '), sampleCount: SAMPLES, sourceGroupIds: [GROUP], valueKind: 'samples',
    provider: {
      name: 'GTEx Portal', release: 'GTEx Analysis Release V10', license: 'GTEx open-access data',
      licenseUrl: 'https://gtexportal.org/home/license',
      attribution: `The Genotype-Tissue Expression (GTEx) Project was supported by the Common Fund of the Office of the Director of the National Institutes of Health, and by NCI, NHGRI, NHLBI, NIDA, NIMH, and NINDS. The data used here were obtained from the GTEx Portal on ${sourceManifest.retrieved}.`,
    },
  };
  const columns: ExternalColumn[] = sampleIds.map((sample) => ({ group: GROUP, sample }));
  const manifest: ManifestInput = {
    provider: 'gtex', title: `GTEx V10 · ${TISSUE}`, release: 'GTEx Analysis Release V10',
    sources: [source], columns: { [SOURCE_ID]: columns }, samples, valueShardCount: VALUE_SHARDS, notes,
  };
  const files = buildProducts({
    manifest, features, checkpoints,
    inputs: sourceManifest.inputs.map(({ name, url, bytes, sha256: hash }) => ({ name, url, bytes, sha256: hash })),
    numericalPolicy: 'Exact parsed IEEE-754 values of the published TPM text; no recomputation, rounding or aggregation.',
    validationNotes: [...apiNotes, ...notes],
  });
  const dir = productDir(ROOT, 'gtex');
  await writeOrCheck(dir, files, check);
  const compared = await replay(dir, manifest, features);
  assert.equal(compared, GENES * SAMPLES);
  console.log(`${check ? 'Verified' : 'Built'} GTEx V10 ${TISSUE}: ${GENES} features × ${SAMPLES} donors; ${compared} exact values; ${apiNotes.length} Portal API medians agree.`);
}

await main();
