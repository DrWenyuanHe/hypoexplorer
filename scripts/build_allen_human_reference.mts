/** Exact, expression-only import of Allen Human Brain Atlas hypothalamic microarray samples.
 *
 * Six donors' normalized microarray zips (1.68 GB) are not committed. The builder
 * retains, per donor, the hypothalamic sample annotation rows and the matching
 * expression columns, plus the shared probe and ontology tables, each pinned by
 * hash. Offline by default: verifies the retained files, writes the generated
 * products under public/expression/allen-human/ and reads every value back.
 *   --check         byte-compare existing products instead of writing them
 *   --fetch         download the pinned zips and the API checkpoints, refuse any
 *                   byte change, and rewrite the retained extracts
 *   --from <dir>    with --fetch: read the zips from a local directory instead
 *   --record        with --fetch: record original and retained hashes in the manifest
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ExternalColumn, ExternalSample, ExternalValidationCheckpoint } from '../src/expression-survey/externalReferenceFormat';
import type { ExpressionSource } from '../src/types';
import {
  assertSameApiAnswer, buildProducts, productDir, readRetained, replay, sha256, sourceNumber, unzipMembers, writeOrCheck,
  type ExternalFeature, type ManifestInput, type PinnedInput,
} from './lib/externalReference.mjs';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'data/expression/allen-human');
const VALUE_SHARDS = 2048;
const HYPOTHALAMUS = 4540;
const SOURCE_ID = 'allen-human-hypothalamus-microarray';
const API = 'https://api.brain-map.org/api/v2/data/query.json?criteria=';
const CHECKPOINT_GENES = ['POMC', 'AGRP', 'HCRT', 'OXT'];

interface Retained { file: string; bytes: number; sha256: string }
interface DonorInput extends PinnedInput { donor: string; retained: { samples: Retained; expression: Retained } }
interface SourceManifest {
  schemaVersion: 1; provider: 'allen'; release: string; retrieved: string;
  donors: DonorInput[];
  shared: { probes: Retained & { member: string }; ontology: Retained & { member: string } };
  api: Retained & { rule: string };
}

/** Minimal RFC 4180 field split; quotes are decoded, everything else is kept as text. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { fields.push(field); field = ''; } else field += char;
  }
  assert.equal(quoted, false, 'Unclosed CSV quote');
  fields.push(field);
  return fields;
}

/** Physical lines with their original terminator bytes removed only for parsing. */
function csvLines(text: string, name: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.ok(lines.length > 0, `${name} is empty`);
  return lines;
}

const strip = (line: string): string => line.replace(/\r$/, '');

function csvObjects(text: string, name: string): Record<string, string>[] {
  const [head, ...rows] = csvLines(text, name).map(strip);
  const header = csvFields(head);
  return rows.map((row) => {
    const fields = csvFields(row);
    assert.equal(fields.length, header.length, `Ragged row in ${name}`);
    return Object.fromEntries(header.map((key, index) => [key, fields[index]]));
  });
}

/** Hypothalamic structure IDs from the atlas's own ontology. */
function hypothalamicStructures(ontology: string): Set<number> {
  const rows = csvObjects(ontology, 'Ontology.csv');
  const root = rows.find((row) => Number(row.id) === HYPOTHALAMUS);
  assert.ok(root, 'Hypothalamus 4540 missing from the ontology');
  return new Set(rows.filter((row) => row.structure_id_path.split('/').includes(String(HYPOTHALAMUS))).map((row) => Number(row.id)));
}

/** Header plus HY rows of SampleAnnot.csv, unmodified; returns the kept column indexes too. */
function extractSamples(text: string, hy: Set<number>): { bytes: Buffer; columns: number[] } {
  const lines = csvLines(text, 'SampleAnnot.csv');
  const header = csvFields(strip(lines[0]));
  const at = header.indexOf('structure_id');
  const columns: number[] = [];
  const kept = [lines[0]];
  lines.slice(1).forEach((line, index) => {
    if (hy.has(Number(csvFields(strip(line))[at]))) { columns.push(index); kept.push(line); }
  });
  return { bytes: gzipSync(Buffer.from(`${kept.join('\n')}\n`, 'utf8'), { level: 9 }), columns };
}

/** Probe ID plus the HY sample columns of MicroarrayExpression.csv, values as their source text.
 * The member is up to 966 MB, past V8's string limit, so it is scanned line by line. */
function extractExpression(bytes: Buffer, columns: number[], sampleCount: number): Buffer {
  const out: string[] = [];
  for (let start = 0; start < bytes.length;) {
    const end = bytes.indexOf(0x0a, start);
    const stop = end < 0 ? bytes.length : end;
    const line = bytes.toString('latin1', start, stop);
    start = stop + 1;
    assert.ok(/^[\x20-\x7e\r]*$/.test(line), 'MicroarrayExpression.csv holds non-ASCII bytes');
    const fields = strip(line).split(',');
    assert.equal(fields.length, sampleCount + 1, 'MicroarrayExpression.csv row width differs from SampleAnnot.csv');
    out.push([fields[0], ...columns.map((column) => fields[column + 1])].join(','));
  }
  assert.ok(out.length > 0, 'MicroarrayExpression.csv is empty');
  return gzipSync(Buffer.from(`${out.join('\n')}\n`, 'utf8'), { level: 9 });
}

async function fetchApi(donors: DonorInput[]): Promise<Buffer> {
  const query = async (criteria: string) => {
    const url = `${API}${encodeURIComponent(criteria).replace(/%2C/g, ',').replace(/%24/g, '$').replace(/%5B/g, '[').replace(/%5D/g, ']').replace(/%3A/g, ':')}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    assert.ok(response.ok, `Allen API failed (${response.status})`);
    const body = (await response.json()) as { success: boolean; msg: unknown };
    assert.equal(body.success, true, `Allen API query failed: ${criteria}`);
    return { url, msg: body.msg };
  };
  const donorInfo = await query("model::Donor,rma::criteria,products[id$eq2],rma::include,age,rma::options[only$eq'donors.id,donors.name,donors.sex,donors.race_only,ages.name,ages.days']");
  const samples = [];
  for (const donor of donors) {
    const result = await query(`model::Sample,rma::criteria,tissue_sample_data_set(specimen(donor[id$eq${donor.donor}])),structure[structure_id_path$il'*/${HYPOTHALAMUS}/*'],rma::include,structure,rma::options[num_rows$eqall][only$eq'samples.id,samples.structure_id,samples.rna_integrity_number,structures.acronym']`);
    samples.push({ donor: donor.donor, ...result });
  }
  return Buffer.from(`${JSON.stringify({ retrieved: new Date().toISOString(), donors: donorInfo, samples }, null, 2)}\n`, 'utf8');
}

async function acquire(manifest: SourceManifest, record: boolean, from: string | null): Promise<void> {
  let probes: Buffer | null = null;
  let ontology: Buffer | null = null;
  const put = async (target: Retained, bytes: Buffer) => {
    if (record) { target.bytes = bytes.length; target.sha256 = sha256(bytes); }
    else assert.equal(sha256(bytes), target.sha256, `Retained ${target.file} would change; use --record deliberately`);
    await writeFile(path.join(SOURCE, target.file), bytes);
  };
  for (const donor of manifest.donors) {
    const zip = from
      ? await readFile(path.join(from, `normalized_microarray_donor${donor.donor}.zip`))
      : Buffer.from(await (await fetch(donor.url, { signal: AbortSignal.timeout(3_600_000) })).arrayBuffer());
    assert.equal(zip.length, donor.bytes, `Zip size changed: donor ${donor.donor}`);
    if (record && !donor.sha256) donor.sha256 = sha256(zip);
    assert.equal(sha256(zip), donor.sha256, `Zip bytes changed: donor ${donor.donor}`);
    const members = unzipMembers(zip);
    for (const name of ['MicroarrayExpression.csv', 'SampleAnnot.csv', 'Probes.csv', 'Ontology.csv']) {
      assert.ok(members.has(name), `donor ${donor.donor} zip lacks ${name}`);
    }
    const p = members.get('Probes.csv')!();
    const o = members.get('Ontology.csv')!();
    // The probe and ontology tables must be identical in every donor zip.
    if (probes) assert.ok(p.equals(probes), `Probes.csv differs in donor ${donor.donor}`); else probes = p;
    if (ontology) assert.ok(o.equals(ontology), `Ontology.csv differs in donor ${donor.donor}`); else ontology = o;
    const annot = members.get('SampleAnnot.csv')!().toString('utf8');
    const sampleCount = csvLines(annot, 'SampleAnnot.csv').length - 1;
    const { bytes, columns } = extractSamples(annot, hypothalamicStructures(o.toString('utf8')));
    await put(donor.retained.samples, bytes);
    await put(donor.retained.expression, extractExpression(members.get('MicroarrayExpression.csv')!(), columns, sampleCount));
  }
  await put(manifest.shared.probes, gzipSync(probes!, { level: 9 }));
  await put(manifest.shared.ontology, gzipSync(ontology!, { level: 9 }));
  const api = await fetchApi(manifest.donors);
  if (record) {
    manifest.api.bytes = api.length;
    manifest.api.sha256 = sha256(api);
    await writeFile(path.join(SOURCE, manifest.api.file), api);
  } else {
    await assertSameApiAnswer(api, path.join(SOURCE, manifest.api.file), manifest.api);
  }
  if (record) {
    manifest.retrieved = new Date().toISOString().slice(0, 10);
    await writeFile(path.join(SOURCE, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const fetchSource = process.argv.includes('--fetch');
  const record = process.argv.includes('--record');
  const fromIndex = process.argv.indexOf('--from');
  const from = fromIndex > 0 ? process.argv[fromIndex + 1] : null;
  assert.ok(!(check && fetchSource), '--check is offline and cannot be combined with --fetch');
  assert.ok(!record || fetchSource, '--record requires --fetch');
  assert.ok(!from || fetchSource, '--from requires --fetch');
  const manifest = JSON.parse(await readFile(path.join(SOURCE, 'source-manifest.json'), 'utf8')) as SourceManifest;
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.provider, 'allen');
  if (fetchSource) await acquire(manifest, record, from);

  const read = async (target: Retained) => gunzipSync(await readRetained(path.join(SOURCE, target.file), target)).toString('utf8');
  const probeRows = csvObjects(await read(manifest.shared.probes), 'Probes.csv');
  const hy = hypothalamicStructures(await read(manifest.shared.ontology));
  const api = JSON.parse((await readRetained(path.join(SOURCE, manifest.api.file), manifest.api)).toString('utf8')) as {
    donors: { msg: Array<{ id: number; name: string; sex: string; race_only: string; age: { name: string } }> };
    samples: Array<{ donor: string; msg: Array<{ structure_id: number }> }>;
  };
  const donorInfo = new Map(api.donors.msg.map((donor) => [String(donor.id), donor]));

  const samples: ExternalSample[] = [];
  const columns: ExternalColumn[] = [];
  const valueTexts: string[][] = probeRows.map(() => []);
  const probeIds = probeRows.map((row) => row.probe_id);
  const conditionNotes: string[] = [];
  const apiNotes: string[] = [];
  for (const donor of manifest.donors) {
    const info = donorInfo.get(donor.donor);
    assert.ok(info, `Donor ${donor.donor} missing from the API donor list`);
    const annot = csvObjects(await read(donor.retained.samples), 'SampleAnnot.csv');
    assert.ok(annot.length > 0 && annot.every((row) => hy.has(Number(row.structure_id))), `Non-hypothalamic sample retained for ${donor.donor}`);
    // Independent agreement: the API lists the same hypothalamic structures for this donor.
    const fromApi = api.samples.find((entry) => entry.donor === donor.donor)!.msg.map((sample) => sample.structure_id).sort((a, b) => a - b);
    const fromZip = annot.map((row) => Number(row.structure_id)).sort((a, b) => a - b);
    assert.deepEqual(fromZip, fromApi, `Hypothalamic samples for donor ${donor.donor} differ from the Allen API`);
    apiNotes.push(`${info.name}: ${annot.length} hypothalamic samples, matching the Allen API structure by structure.`);
    const group = `donor-${info.name}`;
    const sex = info.sex === 'F' ? 'female' : info.sex === 'M' ? 'male' : info.sex;
    conditionNotes.push(`${info.name}: ${sex}, ${info.age.name}`);
    for (const row of annot) {
      const id = `${SOURCE_ID}:${info.name}:${row.well_id}`;
      const side = /, left$/.test(row.structure_name) ? 'left' : /, right$/.test(row.structure_name) ? 'right' : 'not lateralized';
      samples.push({ id, label: `${row.structure_acronym} · well ${row.well_id}`, sourceId: SOURCE_ID, groupId: group, metadata: {
        donor: info.name, structure: row.structure_name, acronym: row.structure_acronym, hemisphere: side,
        slab: row.slab_num, mniX: row.mni_x, mniY: row.mni_y, mniZ: row.mni_z } });
      columns.push({ group, sample: id });
    }
    const lines = csvLines(await read(donor.retained.expression), 'expression extract');
    assert.equal(lines.length, probeRows.length, `Probe count differs for donor ${donor.donor}`);
    lines.forEach((line, index) => {
      const [probe, ...values] = line.split(',');
      assert.equal(probe, probeIds[index], `Probe order differs for donor ${donor.donor} at row ${index}`);
      assert.equal(values.length, annot.length, `Column count differs for donor ${donor.donor}`);
      valueTexts[index].push(...values);
    });
  }
  assert.equal(new Set(samples.map((sample) => sample.id)).size, samples.length, 'Duplicate sample identity');

  const checkpoints: ExternalValidationCheckpoint[] = [];
  const features: ExternalFeature[] = probeRows.map((row, index) => {
    const texts = valueTexts[index];
    const values = texts.map((text, column) => sourceNumber(text, `${row.probe_name}/${columns[column].sample}`, { allowNegative: true }));
    if (CHECKPOINT_GENES.includes(row.gene_symbol) && checkpoints.filter((point) => point.symbol === row.gene_symbol).length < 2) {
      for (const column of [0, columns.length - 1]) {
        checkpoints.push({ source: SOURCE_ID, feature: row.probe_name, symbol: row.gene_symbol, column: columns[column].sample!, sourceText: texts[column], value: values[column] });
      }
    }
    const symbol = /^(?:na|n\/a)$/i.test(row.gene_symbol) ? '' : row.gene_symbol;
    return { source: SOURCE_ID, id: row.probe_name, symbol, ensemblId: '', values };
  });
  assert.equal(new Set(features.map((feature) => feature.id)).size, features.length, 'Duplicate probe name');
  for (const gene of CHECKPOINT_GENES) assert.ok(checkpoints.some((point) => point.symbol === gene), `Checkpoint gene ${gene} has no probe`);

  const groups = [...new Set(columns.map((column) => column.group))];
  const notes = [
    'Values are the Allen Human Brain Atlas normalized microarray expression (log2), imported per probe without renormalization, rounding or probe collapsing.',
    'Each profile is one dissected tissue sample (well); conditions are donors. n counts tissue samples within one donor, never people.',
    'A gene query returns every probe of that gene as its own row. Probes of one gene can disagree; no probe is preferred.',
    'Donors are six adults sampled postmortem; feeding and circadian state are unknown, so no group is eligible for the fed/reference filter.',
    'Allen Institute data are used under its terms of use for noncommercial purposes, with attribution under its citation policy.',
  ];
  const source: ExpressionSource = {
    id: SOURCE_ID, label: 'Human hypothalamus · Allen microarray', collection: 'external', scope: 'tissue',
    populationId: SOURCE_ID, populationLabel: 'Human hypothalamus (Allen Human Brain Atlas)', region: 'Hypothalamus',
    species: 'Homo sapiens', assay: 'Microarray (Agilent custom 8x60K) of dissected postmortem tissue samples',
    rnaFraction: 'Total RNA', unit: 'log2 normalized intensity',
    normalization: 'Allen Human Brain Atlas normalized microarray values (log2; within- and cross-donor normalization by the Allen Institute), as distributed',
    replicateUnit: 'One dissected tissue sample (well) per profile; groups are donors',
    identityMethod: `Samples annotated to structures under the hypothalamus (structure ${HYPOTHALAMUS}) in the atlas ontology`,
    featureLevel: 'probe', valueKind: 'samples', sampleCount: samples.length, sourceGroupIds: groups,
    conditions: manifest.donors.map((donor, index) => {
      const info = donorInfo.get(donor.donor)!;
      const count = columns.filter((column) => column.group === groups[index]).length;
      return { key: groups[index], label: `${info.name} · ${conditionNotes[index].split(': ')[1]}`, referenceEligible: false,
        feedingState: 'not applicable (postmortem donor)', sampleCount: count, sex: info.sex === 'F' ? 'female' : 'male', age: info.age.name,
        notes: `${count} tissue samples from one donor; structures and hemispheres are in the sample metadata.` };
    }),
    sourceUrl: 'https://human.brain-map.org/',
    citation: 'Hawrylycz MJ, et al. An anatomically comprehensive atlas of the adult human brain transcriptome. Nature 2012;489(7416):391–399. Allen Human Brain Atlas, Allen Institute for Brain Science.',
    notes: notes.join(' '),
    provider: {
      name: 'Allen Institute for Brain Science', release: 'Allen Human Brain Atlas, normalized microarray (2013 release files)',
      license: 'Allen Institute terms of use (noncommercial)', licenseUrl: 'https://alleninstitute.org/terms-of-use/',
      attribution: `Allen Institute for Brain Science. Allen Human Brain Atlas. Available from human.brain-map.org. Data retrieved ${manifest.retrieved}.`,
    },
  };
  const productManifest: ManifestInput = {
    provider: 'allen', title: 'Allen Human Brain Atlas · hypothalamus microarray', release: source.provider!.release,
    sources: [source], columns: { [SOURCE_ID]: columns }, samples, valueShardCount: VALUE_SHARDS, notes,
  };
  const files = buildProducts({
    manifest: productManifest, features, checkpoints,
    inputs: manifest.donors.map(({ name, url, bytes, sha256: hash }) => ({ name, url, bytes, sha256: hash })),
    numericalPolicy: 'Exact parsed IEEE-754 values of the published normalized expression text; no recomputation, rounding or probe aggregation.',
    validationNotes: [...apiNotes, ...notes],
  });
  const dir = productDir(ROOT, 'allen');
  await writeOrCheck(dir, files, check);
  const compared = await replay(dir, productManifest, features);
  console.log(`${check ? 'Verified' : 'Built'} Allen human hypothalamus: ${features.length} probes × ${samples.length} samples from ${groups.length} donors; ${compared} exact values; ${apiNotes.length} donors match the API sample lists.`);
}

await main();
