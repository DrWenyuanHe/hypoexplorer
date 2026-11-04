/** Exact, expression-only import of the authors' GSE147092 CENSUS matrix.
 * Offline by default; --fetch restores pinned original bytes, --check compares
 * every browser product and every expression value with the retained source.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { ExpressionSource } from '../src/types';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'data/expression/oxt-reference');
const PUBLIC = path.join(ROOT, 'public/expression/oxt-reference');
const BASE = '/expression/oxt-reference';
const UNIT = 'CENSUS estimated mRNA copies/cell';
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

interface SourceFile {
  name: string;
  path: string;
  url: string;
  bytes: number;
  sha256: string;
  gitBlobSha1: string;
  archive: string;
  archiveSha256: string;
  /** Original GEO gzip, when available; otherwise a deterministic local gzip. */
  archiveUrl?: string;
}
interface SourceManifest {
  schemaVersion: 1;
  accession: string;
  repository: string;
  commit: string;
  retrievedDate: string;
  files: SourceFile[];
}
interface Sample {
  id: string;
  label: string;
  sourceId: string;
  groupId: string;
  sourceAnimalLabel: string;
  age: string;
  fluorogold: string;
  sourcePlate: string;
  originalCellTypeGuess: string;
  cellType: string;
  sex: string;
  feedingState: string;
  referenceEligible: false;
}
interface GeneRow { id: string; symbol: string; ensemblId: string; values: number[] }

/** TSV quoting is decoded, but source field text and feature IDs are preserved. */
function splitTsv(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === '\t' && !quoted) { fields.push(field); field = ''; }
    else field += char;
  }
  assert.equal(quoted, false, 'Unclosed TSV quote');
  fields.push(field);
  return fields;
}

function table(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const header = splitTsv(lines[0]);
  const rows = lines.slice(1).map(splitTsv);
  assert.ok(rows.every((row) => row.length === header.length), 'Ragged TSV source');
  return { header, rows };
}

function objects(text: string): Record<string, string>[] {
  const { header, rows } = table(text);
  assert.equal(new Set(header).size, header.length, 'Duplicate TSV headers');
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}

function sourceId(cellType: string): string {
  assert.ok(['Magnocellular', 'Parvocellular'].includes(cellType), `Unexpected cell identity ${cellType}`);
  return `gse147092-${cellType.toLowerCase()}-oxt`;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const fetchSource = process.argv.includes('--fetch');
  assert.ok(!(check && fetchSource), '--check is offline and cannot be combined with --fetch');
  const sourceManifest = JSON.parse(await readFile(path.join(SOURCE, 'source-manifest.json'), 'utf8')) as SourceManifest;
  assert.equal(sourceManifest.schemaVersion, 1);
  assert.equal(sourceManifest.accession, 'GSE147092');
  assert.match(sourceManifest.commit, /^[a-f0-9]{40}$/);
  const inputs = new Map<string, string>();
  for (const file of sourceManifest.files) {
    assert.equal(path.basename(file.archive), file.archive, 'Source archive must be local');
    assert.ok(file.url.startsWith(`https://raw.githubusercontent.com/gofflab/OT_neuron_study_2020/${sourceManifest.commit}/`));
    if (fetchSource) {
      if (file.archiveUrl) assert.equal(file.archiveUrl, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE147nnn/GSE147092/suppl/GSE147092_expression_matrix.tsv.gz');
      const response = await fetch(file.archiveUrl ?? file.url, { signal: AbortSignal.timeout(600_000) });
      assert.ok(response.ok, `Source fetch failed: ${file.name} (${response.status})`);
      const responseBytes = Buffer.from(await response.arrayBuffer());
      const original = file.archiveUrl ? gunzipSync(responseBytes) : responseBytes;
      assert.equal(original.length, file.bytes, `Source size changed: ${file.name}`);
      assert.equal(sha256(original), file.sha256, `Source bytes changed: ${file.name}`);
      const archived = file.archiveUrl ? responseBytes : gzipSync(original, { level: 9 });
      assert.equal(sha256(archived), file.archiveSha256, `Source archive changed: ${file.name}`);
      await writeFile(path.join(SOURCE, file.archive), archived);
    }
    const archived = await readFile(path.join(SOURCE, file.archive));
    assert.equal(sha256(archived), file.archiveSha256, `Source archive hash changed: ${file.name}`);
    const original = gunzipSync(archived);
    assert.equal(original.length, file.bytes, `Source size changed: ${file.name}`);
    assert.equal(sha256(original), file.sha256, `Source bytes changed: ${file.name}`);
    const gitHash = createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');
    assert.equal(gitHash, file.gitBlobSha1, `Source does not match the pinned Git blob: ${file.name}`);
    inputs.set(file.name, original.toString('utf8'));
  }
  const annotations = objects(inputs.get('cellAnnotation.tsv')!);
  const features = objects(inputs.get('featureAnnotation.tsv')!);
  const matrix = table(inputs.get('expression_matrix.tsv')!);
  assert.equal(matrix.header[0], 'gene_id');
  const sampleIds = matrix.header.slice(1);
  assert.equal(sampleIds.length, 146);
  assert.equal(new Set(sampleIds).size, sampleIds.length);
  assert.equal(annotations.length, sampleIds.length);
  const annotationById = new Map(annotations.map((row) => [row.cell_id, row]));
  assert.equal(annotationById.size, annotations.length);
  const samples: Sample[] = sampleIds.map((id) => {
    const row = annotationById.get(id);
    assert.ok(row, `No cell annotation for ${id}`);
    assert.equal(row.index, id);
    assert.equal(row.region, 'PVN');
    assert.equal(row.age, 'P25');
    assert.ok(['M3', 'M4', 'M1-5'].includes(row['sample_id.y']));
    assert.ok(['FG_negative', 'FG_positive'].includes(row.Fluorogold));
    const population = sourceId(row.CellType);
    return {
      id, label: id, sourceId: population,
      groupId: `${population}-${row['sample_id.y'].toLowerCase()}-${row.Fluorogold.toLowerCase()}`,
      sourceAnimalLabel: row['sample_id.y'], age: row.age, fluorogold: row.Fluorogold,
      sourcePlate: row.source_plate.trim(), originalCellTypeGuess: row.Cell_Type_guess,
      cellType: row.CellType, sex: 'male (paper; absent from per-cell annotation)', feedingState: 'not reported', referenceEligible: false,
    };
  });
  assert.equal(samples.filter((sample) => sample.cellType === 'Magnocellular').length, 125);
  assert.equal(samples.filter((sample) => sample.cellType === 'Parvocellular').length, 21);
  const featureById = new Map(features.map((row) => [row.index, row]));
  assert.equal(featureById.size, features.length);
  assert.equal(matrix.rows.length, features.length);
  const rows: GeneRow[] = matrix.rows.map((row) => {
    const id = row[0];
    const feature = featureById.get(id);
    assert.ok(feature, `No feature annotation for ${id}`);
    assert.equal(feature.gene_id, id);
    const values = row.slice(1).map((value) => {
      assert.ok(value.trim() !== '', `Missing measurement for ${id}`);
      const number = Number(value);
      assert.ok(Number.isFinite(number) && number >= 0, `Invalid expression for ${id}`);
      return number;
    });
    return { id, symbol: feature.gene_short_name, ensemblId: id, values };
  });
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'Duplicate source feature');
  const notes = [
    'These are the authors\' Monocle2 CENSUS estimates of mRNA copies per cell, imported without renormalization or rounding; they are not raw read counts, UMI counts, CPM, or TPM.',
    'The 146 profiles are individual cells, not 146 independent animals. Source animal/pool labels M3, M4 and M1-5, plates and Fluorogold labeling are retained for each cell.',
    'All retained cells are annotated P25 in the authors\' cellular annotation; GEO sample records describe P23. This discrepancy is retained rather than resolved by inference. The paper describes male mice, while per-cell annotation lacks sex. Feeding state is unreported. No group is eligible for the reference-only filter.',
    'Source final CellType labels are preserved. They may differ from the provisional Cell_Type_guess and the Fluorogold labeling; those source fields are retained separately.',
    'This expression-only reference supplies no differential-expression comparison, significance test, or cross-study mean.',
  ];
  const sources: ExpressionSource[] = ['Magnocellular', 'Parvocellular'].map((cellType) => {
    const id = sourceId(cellType);
    const selected = samples.filter((sample) => sample.sourceId === id);
    const groups = [...new Set(selected.map((sample) => sample.groupId))];
    return {
      id, label: `PVN ${cellType.toLowerCase()} OXT · GSE147092`, collection: 'reference', scope: 'population',
      populationId: `oxt-${cellType.toLowerCase()}`, populationLabel: `PVN ${cellType.toLowerCase()} OXT`,
      region: 'PVN', species: 'Mus musculus', assay: 'Single-cell RNA-seq', rnaFraction: 'Total RNA',
      unit: UNIT, normalization: 'Author-published Monocle2 CENSUS estimates from CuffNorm gene abundances; mm10 / GENCODE vM8',
      replicateUnit: 'Individual cells, not independent animal replicates; source labels M3, M4 and M1-5 (animal/pool identity retained)',
      identityMethod: 'Source final transcriptional CellType assignment; original provisional identity and Fluorogold labeling retained',
      driverOrMarker: 'Oxytocin neurons; source final CellType',
      conditions: groups.map((groupId) => {
        const group = selected.filter((sample) => sample.groupId === groupId);
        const first = group[0];
        return {
          key: groupId, label: `${first.sourceAnimalLabel} · ${first.fluorogold.replace('_', ' ')} · P25`,
          referenceEligible: false, feedingState: 'not reported', sampleCount: group.length,
          age: 'P25 in cell annotation; P23 in GEO', sex: first.sex, treatment: first.fluorogold,
          notes: `Source animal/pool label ${first.sourceAnimalLabel}; ${first.sourcePlate}. Profiles are cells. Feeding state is unreported; Fluorogold labeling is retained.`,
        };
      }),
      sourceUrl: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE147092',
      citation: 'Lewis et al., Neuron 2020;108(4):659–675.e6, DOI 10.1016/j.neuron.2020.10.002. Parallel social information processing circuits are differentially impacted in autism; GSE147092; Goff Lab source matrix.',
      notes: notes.join(' '), sampleCount: selected.length, sourceGroupIds: groups,
    };
  });
  const manifest = {
    schemaVersion: 1, id: 'gse147092-oxt-census', title: 'PVN OXT neuron reference · GSE147092',
    unit: UNIT, organism: 'Mus musculus', geneCount: rows.length, sampleCount: samples.length,
    sourceCount: sources.length, geneIndexPath: `${BASE}/gene-index.json`, validationPath: `${BASE}/validation.json`,
    sources, samples, source: { accession: 'GSE147092', repository: sourceManifest.repository, commit: sourceManifest.commit }, notes,
  };
  const shards = new Map<string, Record<string, GeneRow>>();
  const geneIndex = rows.map((row) => {
    const bucket = sha256(row.id).slice(0, 2);
    if (!shards.has(bucket)) shards.set(bucket, {});
    shards.get(bucket)![row.id] = row;
    return { id: row.id, symbol: row.symbol, ensemblId: row.ensemblId, shard: `${BASE}/shards/${bucket}.json` };
  });
  const checkpoints = ['Oxt', 'Avp', 'Gnai3'].flatMap((symbol) => {
    const gene = rows.find((row) => row.symbol === symbol);
    assert.ok(gene, `Required checkpoint gene ${symbol} missing`);
    return [0, 48, 95].map((index) => ({ gene: symbol, geneId: gene.id, sampleId: samples[index].id, value: gene.values[index] }));
  });
  const validation = {
    schemaVersion: 1, status: 'verified', accession: 'GSE147092',
    sourceCommit: sourceManifest.commit, geneCount: rows.length, sampleCount: samples.length,
    comparedValues: rows.length * samples.length, exactMatches: rows.length * samples.length,
    maxAbsoluteDifference: 0, unit: UNIT, numericalPolicy: 'Exact parsed IEEE-754 values; no recomputation, rounding, or aggregation.',
    populations: sources.map((source) => ({ sourceId: source.id, cellCount: source.sampleCount })),
    sourceAnimalLabels: [...new Set(samples.map((sample) => sample.sourceAnimalLabel))],
    sources: sourceManifest.files.map(({ name, url, bytes, sha256, gitBlobSha1, archiveSha256, archiveUrl }) => ({ name, url, bytes, sha256, gitBlobSha1, archiveSha256, archiveUrl })),
    checkpoints, notes,
  };
  const products = new Map<string, string>([
    ['manifest.json', json(manifest)], ['gene-index.json', json({ schemaVersion: 1, genes: geneIndex })],
    ['validation.json', json(validation)],
  ]);
  for (const [bucket, genes] of shards) products.set(`shards/${bucket}.json`, json({ schemaVersion: 1, genes }));
  if (check) {
    const files = await readdir(path.join(PUBLIC, 'shards'));
    assert.deepEqual(files.sort(), [...shards.keys()].map((bucket) => `${bucket}.json`).sort(), 'Gene shard closure differs');
    for (const [file, expected] of products) assert.equal(await readFile(path.join(PUBLIC, file), 'utf8'), expected, `Stale OXT reference product: ${file}`);
    // Read each emitted vector back independently and compare every source cell.
    const emitted = new Map<string, GeneRow>();
    for (const bucket of shards.keys()) {
      const shard = JSON.parse(await readFile(path.join(PUBLIC, 'shards', `${bucket}.json`), 'utf8')) as { genes: Record<string, GeneRow> };
      for (const [id, row] of Object.entries(shard.genes)) emitted.set(id, row);
    }
    let compared = 0;
    for (const sourceRow of matrix.rows) {
      const imported = emitted.get(sourceRow[0]);
      assert.ok(imported);
      for (let index = 1; index < sourceRow.length; index++) {
        assert.equal(imported.values[index - 1], Number(sourceRow[index]), `Expression mismatch ${sourceRow[0]} / ${sampleIds[index - 1]}`);
        compared++;
      }
    }
    assert.equal(compared, validation.comparedValues);
  } else {
    await mkdir(path.join(PUBLIC, 'shards'), { recursive: true });
    for (const [file, value] of products) await writeFile(path.join(PUBLIC, file), value, 'utf8');
  }
  console.log(`${check ? 'Verified' : 'Built'} GSE147092 OXT reference: ${rows.length} genes × ${samples.length} cells; ${validation.comparedValues} exact values, 2 populations, no synthetic DE contrast.`);
}

await main();
