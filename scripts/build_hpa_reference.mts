/** Exact, expression-only import of Human Protein Atlas 25 hypothalamus data.
 *
 * Four sources: human hypothalamic subregions and human single-nucleus clusters
 * (published summaries), and mouse and pig hypothalamus (per animal). Offline by
 * default: verifies the retained hypothalamic extracts, writes the generated
 * products under public/expression/hpa/ and reads every value back.
 *   --check   byte-compare existing products instead of writing them
 *   --fetch   re-download the pinned v25 originals and the API checkpoints,
 *             refuse any byte change, and rewrite the retained extracts
 *   --record  with --fetch only: record retained-file hashes in the manifest
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ExternalColumn, ExternalSample, ExternalValidationCheckpoint } from '../src/expression-survey/externalReferenceFormat';
import type { ExpressionCondition, ExpressionProvider, ExpressionSource } from '../src/types';
import {
  assertSameApiAnswer, buildProducts, fetchPinned, productDir, readRetained, replay, sha256, sourceLines, sourceNumber, unzipSingle, writeOrCheck,
  type ExternalFeature, type ManifestInput, type PinnedInput,
} from './lib/externalReference.mjs';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'data/expression/hpa');
const VALUE_SHARDS = 1024;
const RELEASE = 'HPA version 25';
const CHECKPOINT_GENES: Array<[symbol: string, ensembl: string]> = [
  ['POMC', 'ENSG00000115138'], ['HCRT', 'ENSG00000161610'], ['AGRP', 'ENSG00000159723'], ['OXT', 'ENSG00000101405'],
];

interface Filter { column: string; values: string[] }
interface Retained { file: string; kind: 'extract' | 'gzip' | 'api' | 'repository'; rule: string; bytes: number; sha256: string; member?: string; filter?: Filter }
interface SourceInput extends PinnedInput { retained: Retained }
interface SourceManifest { schemaVersion: 1; provider: 'hpa'; release: string; retrieved: string; inputs: SourceInput[] }

type Table = { header: string[]; rows: string[][] };

function table(text: string, name: string): Table {
  const [head, ...lines] = sourceLines(text, name);
  const header = head.split('\t');
  assert.equal(new Set(header).size, header.length, `Duplicate headers in ${name}`);
  const rows = lines.map((line) => line.split('\t'));
  assert.ok(rows.every((row) => row.length === header.length), `Ragged row in ${name}`);
  return { header, rows };
}

function column(t: Table, name: string): number {
  const index = t.header.indexOf(name);
  assert.ok(index >= 0, `Missing column ${name}`);
  return index;
}

/** Header plus the unmodified rows whose filter column is one of the listed values. */
function extract(text: string, name: string, filter: Filter): Buffer {
  const lines = sourceLines(text, name);
  const index = lines[0].split('\t').indexOf(filter.column);
  assert.ok(index >= 0, `Missing filter column ${filter.column} in ${name}`);
  const keep = new Set(filter.values);
  const kept = [lines[0], ...lines.slice(1).filter((line) => keep.has(line.split('\t')[index]))];
  assert.ok(kept.length > 1, `Filter kept no rows from ${name}`);
  return gzipSync(Buffer.from(`${kept.join('\n')}\n`, 'utf8'), { level: 9 });
}

async function fetchApi(): Promise<Buffer> {
  const checkpoints = [];
  for (const [symbol, ensembl] of CHECKPOINT_GENES) {
    const url = `https://www.proteinatlas.org/api/search_download.php?search=${symbol}&format=json&columns=g,eg,brain_RNA_hypothalamus&compress=no`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `HPA API failed for ${symbol} (${response.status})`);
    const rows = (await response.json()) as Array<Record<string, string>>;
    const row = rows.find((candidate) => candidate.Ensembl === ensembl);
    assert.ok(row, `HPA API returned no row for ${symbol} / ${ensembl}`);
    checkpoints.push({ symbol, ensembl, url, response: row });
  }
  return Buffer.from(`${JSON.stringify({ retrieved: new Date().toISOString(), checkpoints }, null, 2)}\n`, 'utf8');
}

async function acquire(manifest: SourceManifest, record: boolean): Promise<void> {
  for (const input of manifest.inputs) {
    if (input.retained.kind === 'repository') continue;
    let bytes: Buffer;
    if (input.retained.kind === 'api') bytes = await fetchApi();
    else {
      const { name, bytes: member } = unzipSingle(await fetchPinned(input));
      assert.equal(name, input.retained.member, `Unexpected zip member in ${input.name}`);
      bytes = input.retained.kind === 'gzip' ? gzipSync(member, { level: 9 })
        : extract(member.toString('utf8'), input.name, input.retained.filter!);
    }
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const fetchSource = process.argv.includes('--fetch');
  const record = process.argv.includes('--record');
  assert.ok(!(check && fetchSource), '--check is offline and cannot be combined with --fetch');
  assert.ok(!record || fetchSource, '--record requires --fetch');
  const sourceManifest = JSON.parse(await readFile(path.join(SOURCE, 'source-manifest.json'), 'utf8')) as SourceManifest;
  assert.equal(sourceManifest.schemaVersion, 1);
  assert.equal(sourceManifest.provider, 'hpa');
  if (fetchSource) await acquire(sourceManifest, record);

  const text = new Map<string, string>();
  const raw = new Map<string, Buffer>();
  for (const input of sourceManifest.inputs) {
    const file = input.retained.kind === 'repository' ? path.join(ROOT, input.retained.file) : path.join(SOURCE, input.retained.file);
    if (input.retained.kind !== 'repository') assert.equal(path.basename(input.retained.file), input.retained.file, 'Retained files must be local');
    const bytes = await readRetained(file, input.retained);
    raw.set(input.name, bytes);
    if (input.retained.kind === 'extract' || input.retained.kind === 'gzip') text.set(input.name, gunzipSync(bytes).toString('utf8'));
  }
  const get = (name: string): Table => table(text.get(name)!, name);
  const filterOf = (name: string): Filter => sourceManifest.inputs.find((input) => input.name === name)!.retained.filter!;

  // Subregion membership comes from HPA's own table, and must equal the extract filter.
  const subregionTable = get('rna_brain_hpa_subregions.tsv.zip');
  const hySubregions = subregionTable.rows.filter((row) => row[1] === 'hypothalamus').map((row) => row[0]);
  assert.deepEqual([...hySubregions].sort(), [...filterOf('rna_brain_hpa.tsv.zip').values].sort(), 'Subregion filter differs from HPA membership');
  assert.equal(hySubregions.length, 8);

  const features: ExternalFeature[] = [];
  const checkpoints: ExternalValidationCheckpoint[] = [];
  const checkpointIds = new Map(CHECKPOINT_GENES.map(([symbol, ensembl]) => [ensembl, symbol]));
  const provider: ExpressionProvider = {
    name: 'Human Protein Atlas', release: RELEASE, license: 'CC BY 4.0',
    licenseUrl: 'https://www.proteinatlas.org/about/licence',
    attribution: `Data from the Human Protein Atlas version 25 (v25.proteinatlas.org), retrieved ${sourceManifest.retrieved}.`,
  };

  // 1. Human hypothalamic subregions: one published nTPM per subregion.
  const brain = get('rna_brain_hpa.tsv.zip');
  const [bGene, bName, bSub, bN] = ['Gene', 'Gene name', 'Subregion', 'nTPM'].map((name) => column(brain, name));
  const subregionOrder = [...hySubregions].sort();
  const humanSub = 'hpa-human-hypothalamic-subregions';
  const subValues = new Map<string, { symbol: string; values: Array<number | null> }>();
  for (const row of brain.rows) {
    const slot = subregionOrder.indexOf(row[bSub]);
    assert.ok(slot >= 0, `Unexpected subregion ${row[bSub]}`);
    const entry = subValues.get(row[bGene]) ?? { symbol: row[bName], values: subregionOrder.map(() => null) };
    assert.equal(entry.symbol, row[bName], `Symbol changes within ${row[bGene]}`);
    assert.equal(entry.values[slot], null, `Duplicate subregion row ${row[bGene]}/${row[bSub]}`);
    entry.values[slot] = sourceNumber(row[bN], `${row[bGene]}/${row[bSub]}`);
    subValues.set(row[bGene], entry);
    const symbol = checkpointIds.get(row[bGene]);
    if (symbol && (row[bSub] === 'arcuate nucleus' || row[bSub] === 'paraventricular nucleus')) {
      checkpoints.push({ source: humanSub, feature: row[bGene], symbol, column: row[bSub], sourceText: row[bN], value: Number(row[bN]) });
    }
  }
  for (const [id, entry] of subValues) {
    assert.ok(entry.values.every((value) => value !== null), `Missing subregion value for ${id}`);
    assert.match(id, /^ENSG\d{11}$/);
    features.push({ source: humanSub, id, symbol: entry.symbol, ensemblId: id, values: entry.values });
  }

  // HPA's hypothalamus region value is the maximum of these subregions; verified, not shipped.
  const region = get('rna_brain_region_hpa.tsv.zip');
  const [rGene, rN] = ['Gene', 'nTPM'].map((name) => column(region, name));
  assert.equal(region.rows.length, subValues.size, 'Region and subregion gene sets differ');
  for (const row of region.rows) {
    const values = subValues.get(row[rGene])?.values as number[] | undefined;
    assert.ok(values, `Region gene ${row[rGene]} has no subregions`);
    assert.equal(Number(row[rN]), Math.max(...values), `Region nTPM is not the subregion maximum for ${row[rGene]}`);
  }

  // Independent agreement: the HPA search API's hypothalamus nTPM for the checkpoint genes.
  const api = JSON.parse(raw.get('hpa-api-checkpoints.json')!.toString('utf8')) as {
    checkpoints: Array<{ symbol: string; ensembl: string; response: Record<string, string> }> };
  const apiNotes = api.checkpoints.map((point) => {
    const published = Number(point.response['Brain RNA - hypothalamus [nTPM]']);
    const values = subValues.get(point.ensembl)?.values as number[] | undefined;
    assert.ok(values, `API checkpoint ${point.ensembl} missing`);
    assert.equal(Math.max(...values), published, `${point.symbol}: HPA API hypothalamus nTPM ${published} differs`);
    return `${point.symbol} hypothalamus nTPM ${published} from the HPA API equals the maximum imported subregion value.`;
  });

  // 2. Human single-nucleus clusters (HPA cluster summaries of Siletti et al.).
  const nuclei = get('rna_single_nuclei_brain_cluster.tsv.zip');
  const [nGene, nName, nCluster, nType, nCpm] = ['Gene', 'Gene name', 'Cluster', 'Cluster type', 'nCPM'].map((name) => column(nuclei, name));
  const clusterTypes = new Map<string, string>();
  for (const row of nuclei.rows) {
    const known = clusterTypes.get(row[nCluster]);
    assert.ok(!known || known === row[nType], `Cluster ${row[nCluster]} changes type`);
    clusterTypes.set(row[nCluster], row[nType]);
  }
  const clusters = [...clusterTypes.keys()].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  assert.equal(clusters.length, 26);
  assert.ok(clusters.every((cluster, index) => cluster === `c-${index}`), 'Unexpected cluster labels');
  const humanNuclei = 'hpa-human-hypothalamus-snrna-clusters';
  const nucleiValues = new Map<string, { symbol: string; values: Array<number | null> }>();
  for (const row of nuclei.rows) {
    const slot = clusters.indexOf(row[nCluster]);
    const entry = nucleiValues.get(row[nGene]) ?? { symbol: row[nName], values: clusters.map(() => null) };
    assert.equal(entry.symbol, row[nName]);
    assert.equal(entry.values[slot], null, `Duplicate cluster row ${row[nGene]}/${row[nCluster]}`);
    entry.values[slot] = sourceNumber(row[nCpm], `${row[nGene]}/${row[nCluster]}`);
    nucleiValues.set(row[nGene], entry);
    const symbol = checkpointIds.get(row[nGene]);
    if (symbol && (row[nCluster] === 'c-1' || row[nCluster] === 'c-2')) {
      checkpoints.push({ source: humanNuclei, feature: row[nGene], symbol, column: row[nCluster], sourceText: row[nCpm], value: Number(row[nCpm]) });
    }
  }
  for (const [id, entry] of nucleiValues) {
    assert.ok(entry.values.every((value) => value !== null), `Missing cluster value for ${id}`);
    features.push({ source: humanNuclei, id, symbol: entry.symbol, ensemblId: id, values: entry.values });
  }
  const datasets = get('rna_single_nuclei_brain_datasets.tsv.zip');
  const hyDataset = datasets.rows.find((row) => row[0] === 'Hypothalamus');
  assert.ok(hyDataset, 'No hypothalamus single-nucleus dataset row');
  const [, technique, dataSource, cellCount] = hyDataset;

  // 3–4. Mouse and pig hypothalamus, per animal. Symbols come from pinned tables; IDs stay authoritative.
  const mouseSymbols = JSON.parse(raw.get('mmus_ens2sym.json')!.toString('utf8')) as Record<string, string>;
  const pigSymbols = new Map<string, Set<string>>();
  {
    const lines = sourceLines(gunzipSync(raw.get('Sus_scrofa.gene_info.gz')!).toString('utf8'), 'Sus_scrofa.gene_info');
    const header = lines[0].replace(/^#/, '').split('\t');
    const [symbolAt, xrefAt] = [header.indexOf('Symbol'), header.indexOf('dbXrefs')];
    for (const line of lines.slice(1)) {
      const fields = line.split('\t');
      for (const xref of fields[xrefAt].split('|')) {
        if (xref.startsWith('Ensembl:ENSSSCG')) {
          const id = xref.slice('Ensembl:'.length);
          pigSymbols.set(id, (pigSymbols.get(id) ?? new Set()).add(fields[symbolAt]));
        }
      }
    }
  }
  const animalSamples: ExternalSample[] = [];
  const animalSource = (species: 'mouse' | 'pig', name: string, pattern: RegExp, symbolOf: (id: string) => string) => {
    const t = get(name);
    const [idAt, regionAt, subAt, animalAt, nAt] = [t.header[0], 'Main_region', 'Subregion', 'Animal', 'nTPM'].map((c) => column(t, c));
    const animals = [...new Set(t.rows.map((row) => row[animalAt]))].sort();
    assert.deepEqual(animals, ['F 1', 'F 2', 'M 1', 'M 2'], `Unexpected ${species} animals`);
    const sourceId = `hpa-${species}-hypothalamus`;
    const samples = animals.map((animal) => ({
      id: `${sourceId}:${animal.replace(' ', '')}`, label: animal, sourceId, groupId: 'hypothalamus',
      metadata: { animal, sex: animal.startsWith('F') ? 'female' : 'male' },
    }));
    animalSamples.push(...samples);
    const rows = new Map<string, Array<number | null>>();
    for (const row of t.rows) {
      assert.equal(row[regionAt], 'hypothalamus');
      assert.equal(row[subAt], 'hypothalamus', `Unexpected ${species} subregion ${row[subAt]}`);
      assert.match(row[idAt], pattern);
      const values = rows.get(row[idAt]) ?? animals.map(() => null);
      const slot = animals.indexOf(row[animalAt]);
      assert.equal(values[slot], null, `Duplicate ${species} row ${row[idAt]}/${row[animalAt]}`);
      values[slot] = sourceNumber(row[nAt], `${row[idAt]}/${row[animalAt]}`);
      rows.set(row[idAt], values);
    }
    for (const [id, values] of rows) {
      assert.ok(values.every((value) => value !== null), `Missing ${species} animal value for ${id}`);
      features.push({ source: sourceId, id, symbol: symbolOf(id), ensemblId: id, values });
    }
    return { sourceId, samples, features: rows.size, mapped: [...rows.keys()].filter((id) => symbolOf(id)).length };
  };
  const mouse = animalSource('mouse', 'rna_mouse_brain_sample_hpa.tsv.zip', /^ENSMUSG\d{11}$/, (id) => mouseSymbols[id] ?? '');
  const pig = animalSource('pig', 'rna_pig_brain_sample_hpa.tsv.zip', /^ENSSSCG\d{11}$/, (id) => {
    const symbols = pigSymbols.get(id);
    return symbols?.size === 1 ? [...symbols][0] : '';
  });
  for (const point of [['hpa-mouse-hypothalamus', 'ENSMUSG00000020660', 'Pomc'], ['hpa-pig-hypothalamus', 'ENSSSCG00000021155', 'POMC']]) {
    const feature = features.find((candidate) => candidate.source === point[0] && candidate.id === point[1]);
    assert.ok(feature, `Missing animal checkpoint ${point[1]}`);
    const t = get(point[0] === 'hpa-mouse-hypothalamus' ? 'rna_mouse_brain_sample_hpa.tsv.zip' : 'rna_pig_brain_sample_hpa.tsv.zip');
    const row = t.rows.find((candidate) => candidate[0] === point[1] && candidate[column(t, 'Animal')] === 'F 1')!;
    checkpoints.push({ source: point[0], feature: point[1], symbol: point[2], column: 'F 1', sourceText: row[column(t, 'nTPM')], value: feature.values[0]! });
  }

  const common = 'Values are HPA-published nTPM or nCPM, imported without renormalization or rounding. Each source keeps its own scale; none is averaged with another study.';
  const summaryCondition = (key: string, label: string, notes: string): ExpressionCondition => ({
    key, label, referenceEligible: false, feedingState: 'not reported', notes });
  const sources: ExpressionSource[] = [
    {
      id: humanSub, label: 'Human hypothalamic subregions · HPA', collection: 'external', scope: 'tissue',
      populationId: 'hpa-human-hypothalamic-subregions', populationLabel: 'Human hypothalamic subregions (HPA)',
      region: 'Hypothalamic subregions', species: 'Homo sapiens', assay: 'Bulk RNA-seq of dissected postmortem brain subregions',
      rnaFraction: 'As published by HPA (brain dataset methods)', unit: 'nTPM',
      normalization: 'HPA normalized TPM (nTPM), version 25', replicateUnit: 'One published summary value per subregion; HPA does not distribute the underlying sample values in this table',
      identityMethod: 'HPA subregion dissection label', valueKind: 'summary', summaryStatistic: 'HPA subregion nTPM',
      conditions: subregionOrder.map((sub) => summaryCondition(slug(sub), sub, 'HPA published subregion value.')),
      sourceUrl: 'https://www.proteinatlas.org/humanproteome/brain', citation: 'Sjöstedt E, et al. An atlas of the protein-coding genes in the human, pig, and mouse brain. Science 2020;367(6482):eaay5947. Human Protein Atlas version 25.',
      notes: `${common} HPA's single "hypothalamus" region value equals the maximum of these eight subregion values for every gene, so it is not shown separately.`,
      provider,
    },
    {
      id: humanNuclei, label: 'Human hypothalamus snRNA clusters · HPA', collection: 'external', scope: 'population',
      populationId: 'hpa-human-hypothalamus-snrna', populationLabel: 'Human hypothalamus nuclei clusters (HPA)',
      region: 'Hypothalamus', species: 'Homo sapiens', assay: `Single-nucleus RNA-seq (${technique}), HPA cluster summary`,
      rnaFraction: 'Nuclear RNA', unit: 'nCPM', normalization: 'HPA normalized counts per million (nCPM) per cluster, version 25',
      replicateUnit: `One published summary value per cluster from ${Number(cellCount).toLocaleString('en-US')} hypothalamic nuclei`,
      identityMethod: 'HPA cluster and cluster-type labels from its whole-brain single-nucleus analysis', valueKind: 'summary',
      summaryStatistic: 'HPA cluster nCPM',
      conditions: clusters.map((cluster) => summaryCondition(cluster, `${cluster} · ${clusterTypes.get(cluster)}`,
        'HPA cluster within the hypothalamus dissection. The cluster type is HPA\'s whole-brain label and may name a cell type defined elsewhere in the brain.')),
      sourceUrl: 'https://www.proteinatlas.org/humanproteome/single+cell/single+nuclei+brain',
      citation: `HPA single-nucleus brain clusters, version 25; data source as credited by HPA: ${dataSource} (Siletti K, et al. Transcriptomic diversity of cell types across the adult human brain. Science 2023;382(6667):eadd7046).`,
      notes: `${common} Cluster-type labels are HPA's whole-brain labels as published, some of them cortical (for example "deep-layer intratelencephalic"); they are not hypothalamic cell-type assignments.`,
      provider,
    },
    ...[['mouse', 'Mus musculus', mouse, 'MGI MRK_ENSEMBL table (scripts/lib/mmus_ens2sym.json)'],
        ['pig', 'Sus scrofa', pig, 'NCBI Sus scrofa gene_info Ensembl cross-references (unique mappings only)']].map(([species, organism, built, symbols]) => {
      const info = built as typeof mouse;
      return {
        id: info.sourceId, label: `${species === 'mouse' ? 'Mouse' : 'Pig'} hypothalamus · HPA`, collection: 'external' as const, scope: 'tissue' as const,
        populationId: info.sourceId, populationLabel: `${species === 'mouse' ? 'Mouse' : 'Pig'} hypothalamus (HPA)`,
        region: 'Hypothalamus', species: organism as string, assay: 'Bulk RNA-seq of dissected brain regions',
        rnaFraction: 'As published by HPA (brain dataset methods)', unit: 'nTPM',
        normalization: 'HPA normalized TPM (nTPM), version 25; per-animal values as published',
        replicateUnit: 'One dissected hypothalamus per animal (4 animals)', identityMethod: 'HPA main region and subregion label "hypothalamus"',
        valueKind: 'samples' as const, sampleCount: 4, sourceGroupIds: ['hypothalamus'],
        conditions: [{ key: 'hypothalamus', label: 'Hypothalamus · 4 animals', referenceEligible: false, feedingState: 'not reported',
          notes: 'Two female and two male animals as labeled by HPA. Age and husbandry: see HPA brain methods.', sampleCount: 4, sex: '2 female, 2 male' }],
        sourceUrl: 'https://www.proteinatlas.org/humanproteome/brain',
        citation: 'Sjöstedt E, et al. An atlas of the protein-coding genes in the human, pig, and mouse brain. Science 2020;367(6482):eaay5947. Human Protein Atlas version 25.',
        notes: `${common} HPA publishes these animals by Ensembl ID only. Symbols are added from the ${symbols}; ${info.mapped} of ${info.features} IDs have one, and the rest are searchable by Ensembl ID.`,
        provider,
      } satisfies ExpressionSource;
    }),
  ];
  const columns: Record<string, ExternalColumn[]> = {
    [humanSub]: subregionOrder.map((sub) => ({ group: slug(sub), sample: null })),
    [humanNuclei]: clusters.map((cluster) => ({ group: cluster, sample: null })),
    [mouse.sourceId]: mouse.samples.map((sample) => ({ group: 'hypothalamus', sample: sample.id })),
    [pig.sourceId]: pig.samples.map((sample) => ({ group: 'hypothalamus', sample: sample.id })),
  };
  const notes = [
    common,
    'Human subregion and single-nucleus values are published summaries: the survey shows them as stated and computes no mean from them.',
    'Mouse and pig values are per animal; their mean is the arithmetic mean of the four published values.',
  ];
  const manifest: ManifestInput = {
    provider: 'hpa', title: 'Human Protein Atlas 25 · hypothalamus', release: RELEASE,
    sources, columns, samples: animalSamples, valueShardCount: VALUE_SHARDS, notes,
  };
  const files = buildProducts({
    manifest, features, checkpoints,
    inputs: sourceManifest.inputs.map(({ name, url, bytes, sha256: hash }) => ({ name, url, bytes, sha256: hash })),
    numericalPolicy: 'Exact parsed IEEE-754 values of the published nTPM/nCPM text; no recomputation, rounding or aggregation.',
    validationNotes: [...apiNotes, `Region nTPM equals the subregion maximum for all ${subValues.size} genes.`, ...notes],
  });
  const dir = productDir(ROOT, 'hpa');
  await writeOrCheck(dir, files, check);
  const compared = await replay(dir, manifest, features);
  console.log(`${check ? 'Verified' : 'Built'} HPA 25 hypothalamus: ${sources.length} sources, ${features.length} features; ${compared} exact values; ${apiNotes.length} API checkpoints agree.`);
}

await main();
