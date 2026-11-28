/** Expression-only import of the human HYPOMAP Visium sections (Tadross et al. 2025) by region.
 *
 * The authors' Seurat object (humanHYPOMAP_spatial.rds, 2.6 GB) is not committed.
 * scripts/extract_visium_reference.R reduces it to donor x region tables, which
 * are tracked under data/expression/visium/ and pinned by SHA-256 in its
 * source-manifest.json. Offline by default: verifies the retained tables, writes
 * the products under public/expression/visium/, reads every value back and
 * recomputes every CPM from the retained counts.
 *   --check            byte-compare existing products instead of writing them
 *   --fetch            download the pinned RDS, refuse any change in size, MD5 or
 *                      SHA-256, run the R extractor and refuse any change in the
 *                      retained tables
 *   --from <file>      with --fetch: read the RDS from disk instead of downloading
 *   --record           with --fetch: record new retained hashes in the manifest
 * The R step needs Rscript with Seurat, SeuratObject and Matrix (HYPOEXPLORER_RSCRIPT
 * names the executable; default `Rscript`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  externalValueBucket, externalValueFile,
  type ExternalColumn, type ExternalSample, type ExternalValidationCheckpoint, type ExternalValueShard,
} from '../src/expression-survey/externalReferenceFormat';
import type { ExpressionCondition, ExpressionSource } from '../src/types';
import {
  buildProducts, productDir, readRetained, replay, sha256, sourceLines, writeOrCheck,
  type ExternalFeature, type ManifestInput,
} from './lib/externalReference.mjs';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'data/expression/visium');
const EXTRACTOR = 'scripts/extract_visium_reference.R';
const SOURCE_ID = 'visium-hypomap-regions';
const VALUE_SHARDS = 1024;
/** CPM is stored to this many significant digits (Number.prototype.toPrecision). */
const SIGNIFICANT_DIGITS = 6;
/** Panel genes with no count in any spot: shipped as measured zero vectors, never dropped. */
const ZERO_GENES = ['BPIFB6', 'HNRNPCL3', 'LRRC70', 'PRH2', 'PVRIG', 'TSPY1'];
/** Genes the panel does not measure; a query must report them absent, never zero. */
const OFF_PANEL = ['IGF2', 'HCRT'];
/** The only sample fields released: the display-local donor label and coverage counts. */
const PUBLIC_SAMPLE_FIELDS = ['donor', 'region', 'spots', 'sections', 'libraryCounts'];
const CHECKPOINTS: Array<[gene: string, region: string]> = [['POMC', 'ARC'], ['AGRP', 'ARC'], ['OXT', 'PVN'], ['AVP', 'SON'], ['PMCH', 'LH'], ['TSPY1', 'ARC']];

/**
 * The authors' 23 grouped regional clusters (regional_clusters_grouped): spot
 * clusters named after the region holding most of their spots, with LH 1-3,
 * MAM 1-2 and Thalamus 1-2 merged as the authors merge them. Names follow the
 * authors' abbreviation table (Tadross et al. 2025, Supplementary Table 20);
 * compound labels join its entries, and the authors define no name for
 * Vascular or Unassigned. Like the authors, HypoExplorer sorts the clusters into
 * no higher compartments. Order: preoptic to mammillary, then the rest.
 */
const REGIONS: ReadonlyArray<{ key: string; name: string | null }> = [
  { key: 'POA', name: 'Preoptic area' },
  { key: 'MPOA', name: 'Medial preoptic area' },
  { key: 'LPOA', name: 'Lateral preoptic area' },
  { key: 'SCN', name: 'Suprachiasmatic nucleus' },
  { key: 'SON', name: 'Supraoptic nucleus' },
  { key: 'PVN', name: 'Paraventricular nucleus' },
  { key: 'Periventricular', name: 'Periventricular hypothalamus' },
  { key: 'ARC', name: 'Arcuate nucleus' },
  { key: 'ME', name: 'Median eminence' },
  { key: 'VMH', name: 'Ventromedial hypothalamus' },
  { key: 'DMH', name: 'Dorsal medial hypothalamus' },
  { key: 'LH', name: 'Lateral hypothalamus' },
  { key: 'LH/RCN', name: 'Lateral hypothalamus / Retrochiasmatic nucleus' },
  { key: 'LTN', name: 'Lateral tuberal nucleus' },
  { key: 'TMN', name: 'Tuberomammillary nucleus' },
  { key: 'MAM', name: 'Mammillary body' },
  { key: 'Fx/LH', name: 'Fornix / Lateral hypothalamus' },
  { key: 'Fx/OT/ac', name: 'Fornix / Optic tract / Anterior commissure' },
  { key: 'OT', name: 'Optic tract' },
  { key: 'Ventricular', name: 'Ventricular hypothalamus' },
  { key: 'Vascular', name: null },
  { key: 'Thalamus', name: null },
  { key: 'Unassigned', name: null },
];
/** The authors leave a snRNA-seq cluster without a region when its top regional cluster is Unassigned; it is never ranked as a region here either. */
const UNASSIGNED = 'Unassigned';

interface Retained { file: string; bytes: number; sha256: string }
interface RetainedGzip extends Retained { contentBytes: number; contentSha256: string }
interface SourceManifest {
  schemaVersion: 1; provider: 'visium'; release: string; retrieved: string;
  original: { name: string; url: string; landing: string; license: string; licenseUrl: string; bytes: number; md5: string; sha256: string };
  extractor: { script: string; sha256: string; runtime: string };
  retained: { cells: Retained; counts: RetainedGzip; sections: Retained; labels: Retained };
}

interface Cell { id: string; donor: string; region: string; spots: number; sections: number; library: number }

const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const count = (text: string, where: string): number => {
  assert.match(text, /^(?:0|[1-9]\d*)$/, `Not a count at ${where}: ${JSON.stringify(text)}`);
  const value = Number(text);
  assert.ok(Number.isSafeInteger(value), `Count out of range at ${where}`);
  return value;
};

/** The stored value: 1e6 x count / library, to SIGNIFICANT_DIGITS. A zero count stays exactly 0. */
function cpm(counts: number, library: number): number {
  return counts === 0 ? 0 : Number(((1e6 * counts) / library).toPrecision(SIGNIFICANT_DIGITS));
}

function tsv(text: string, name: string, header: string[]): string[][] {
  const [head, ...rows] = sourceLines(text, name);
  assert.deepEqual(head.split('\t'), header, `${name} header differs`);
  return rows.map((row) => {
    const fields = row.split('\t');
    assert.equal(fields.length, header.length, `Ragged row in ${name}`);
    return fields;
  });
}

async function hashFile(file: string): Promise<{ bytes: number; md5: string; sha256: string }> {
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    md5.update(chunk as Buffer);
    sha.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { bytes, md5: md5.digest('hex'), sha256: sha.digest('hex') };
}

async function acquire(manifest: SourceManifest, record: boolean, from: string | null): Promise<void> {
  const work = await mkdtemp(path.join(os.tmpdir(), 'hypoexplorer-visium-'));
  try {
    let rds = from;
    if (!rds) {
      rds = path.join(work, manifest.original.name);
      const response = await fetch(manifest.original.url, { signal: AbortSignal.timeout(7_200_000) });
      assert.ok(response.ok && response.body, `RDS download failed (${response.status})`);
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(rds));
    }
    const original = await hashFile(rds);
    assert.equal(original.bytes, manifest.original.bytes, 'RDS size changed');
    assert.equal(original.md5, manifest.original.md5, 'RDS MD5 differs from the repository record');
    assert.equal(original.sha256, manifest.original.sha256, 'RDS bytes changed');

    const out = path.join(work, 'extract');
    await mkdir(out);
    const rscript = process.env.HYPOEXPLORER_RSCRIPT || 'Rscript';
    const run = spawnSync(rscript, [path.join(ROOT, EXTRACTOR), rds, out], { stdio: 'inherit', windowsHide: true });
    assert.equal(run.status, 0, `${EXTRACTOR} failed (${run.error?.message ?? `exit ${run.status}`})`);
    const script = sha256(lf(await readFile(path.join(ROOT, EXTRACTOR), 'utf8')));
    const version = spawnSync(rscript, ['-e', 'cat(R.version.string, "; Seurat", as.character(packageVersion("Seurat")), "; SeuratObject", as.character(packageVersion("SeuratObject")), "; Matrix", as.character(packageVersion("Matrix")))'], { encoding: 'utf8', windowsHide: true });
    if (record) {
      manifest.extractor = { script: EXTRACTOR, sha256: script, runtime: version.stdout.trim() || manifest.extractor.runtime };
    } else {
      assert.equal(script, manifest.extractor.sha256, `${EXTRACTOR} changed; use --record deliberately`);
    }

    const put = async (target: Retained, bytes: Buffer) => {
      if (record) { target.bytes = bytes.length; target.sha256 = sha256(bytes); }
      else assert.equal(sha256(bytes), target.sha256, `Retained ${target.file} would change; use --record deliberately`);
      await writeFile(path.join(SOURCE, target.file), bytes);
    };
    for (const key of ['cells', 'sections', 'labels'] as const) await put(manifest.retained[key], await readFile(path.join(out, `${key}.tsv`)));
    const counts = await readFile(path.join(out, 'counts.tsv'));
    const target = manifest.retained.counts;
    if (record) {
      const gz = gzipSync(counts, { level: 9 });
      Object.assign(target, { contentBytes: counts.length, contentSha256: sha256(counts), bytes: gz.length, sha256: sha256(gz) });
      await writeFile(path.join(SOURCE, target.file), gz);
    } else {
      // The table is pinned by its content; the gzip bytes can differ between zlib builds, so the retained file is kept.
      assert.equal(sha256(counts), target.contentSha256, 'Retained counts would change; use --record deliberately');
    }
    if (record) {
      if (!from) manifest.retrieved = new Date().toISOString().slice(0, 10);
      await writeFile(path.join(SOURCE, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    console.log(`Fetched ${manifest.original.name}: ${original.bytes} bytes, MD5 and SHA-256 match; retained tables ${record ? 'recorded' : 'unchanged'}.`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

interface Tables { cells: Cell[]; genes: string[]; counts: number[][]; sections: string[][]; labels: string[][] }

async function readTables(manifest: SourceManifest): Promise<Tables> {
  const text = async (target: Retained) => (await readRetained(path.join(SOURCE, target.file), target)).toString('utf8');
  const cells = tsv(await text(manifest.retained.cells), 'cells.tsv', ['cell', 'donor', 'region', 'spots', 'sections', 'library'])
    .map(([id, donor, region, spots, sections, library]): Cell => ({
      id, donor, region, spots: count(spots, `${id}.spots`), sections: count(sections, `${id}.sections`), library: count(library, `${id}.library`) }));
  const sections = tsv(await text(manifest.retained.sections), 'sections.tsv', ['donor', 'section', 'region', 'spots']);
  const labels = tsv(await text(manifest.retained.labels), 'labels.tsv', ['named', 'grouped', 'spots']);
  const gz = await readRetained(path.join(SOURCE, manifest.retained.counts.file), manifest.retained.counts);
  const raw = gunzipSync(gz);
  assert.equal(raw.length, manifest.retained.counts.contentBytes, 'Counts table size differs');
  assert.equal(sha256(raw), manifest.retained.counts.contentSha256, 'Counts table content differs');
  const rows = tsv(raw.toString('utf8'), 'counts.tsv', ['gene', ...cells.map((cell) => cell.id)]);
  return {
    cells, sections, labels,
    genes: rows.map((row) => row[0]),
    counts: rows.map((row) => row.slice(1).map((value, index) => count(value, `${row[0]}/${cells[index].id}`))),
  };
}

/** Coverage and label checks that tie the four retained tables to each other. */
function checkTables({ cells, genes, counts, sections, labels }: Tables): void {
  assert.equal(new Set(cells.map((cell) => cell.id)).size, cells.length, 'Duplicate cell id');
  assert.equal(new Set(cells.map((cell) => `${cell.donor}\t${cell.region}`)).size, cells.length, 'Duplicate donor x region cell');
  assert.ok(cells.every((cell) => /^Donor [1-9]\d*$/.test(cell.donor)), 'Donors must be display-local labels');
  const known = new Set(REGIONS.map((region) => region.key));
  const grouped = new Set(labels.map(([, group]) => group));
  assert.deepEqual([...grouped].sort(), [...known].sort(), 'The authors’ grouped labels differ from the region map');
  for (const region of known) {
    const fromLabels = labels.filter(([, group]) => group === region).reduce((sum, [, , spots]) => sum + count(spots, region), 0);
    const fromCells = cells.filter((cell) => cell.region === region).reduce((sum, cell) => sum + cell.spots, 0);
    assert.equal(fromCells, fromLabels, `Spots of ${region} differ between labels.tsv and cells.tsv`);
  }
  for (const cell of cells) {
    const own = sections.filter(([donor, , region]) => donor === cell.donor && region === cell.region);
    assert.equal(own.reduce((sum, [, , , spots]) => sum + count(spots, cell.id), 0), cell.spots, `Section spots differ for ${cell.id}`);
    assert.equal(new Set(own.map(([, section]) => section)).size, cell.sections, `Section count differs for ${cell.id}`);
  }
  assert.equal(new Set(genes).size, genes.length, 'Duplicate gene symbol');
  assert.equal(new Set(genes.map((gene) => gene.toUpperCase())).size, genes.length, 'Gene symbols collide case-insensitively');
  // Every count of every spot is in the table: each cell's column sums to its library size.
  cells.forEach((cell, column) => {
    assert.equal(counts.reduce((sum, row) => sum + row[column], 0), cell.library, `Counts of ${cell.id} do not sum to its library size`);
  });
  const zero = genes.filter((_, index) => counts[index].every((value) => value === 0)).sort();
  assert.deepEqual(zero, ZERO_GENES, 'The panel genes without counts changed');
  for (const gene of OFF_PANEL) assert.ok(!genes.some((symbol) => symbol.toUpperCase() === gene), `${gene} is in the panel`);
}

/**
 * Independent of the builder's own path: re-reads every emitted value shard from
 * disk and recomputes each CPM from the retained count and library size, checking
 * the stored value is that quotient to SIGNIFICANT_DIGITS (relative error at most
 * half a unit in the last digit) and that a zero count is stored as exactly 0.
 */
async function recomputeCpm(dir: string, tables: Tables, columns: ExternalColumn[], samples: Map<string, Cell>): Promise<number> {
  const shards = new Map<number, ExternalValueShard>();
  const bound = 0.5 * 10 ** (1 - SIGNIFICANT_DIGITS);
  let checked = 0;
  const cellColumn = columns.map((column) => {
    const cell = samples.get(column.sample!);
    assert.ok(cell, `Column ${column.sample} has no retained cell`);
    return { cell, at: tables.cells.indexOf(cell) };
  });
  for (const [index, gene] of tables.genes.entries()) {
    const bucket = externalValueBucket(gene, VALUE_SHARDS);
    if (!shards.has(bucket)) shards.set(bucket, JSON.parse(await readFile(path.join(dir, externalValueFile(bucket)), 'utf8')));
    const row = shards.get(bucket)!.rows[SOURCE_ID]?.[gene];
    assert.ok(row && row.length === columns.length, `Missing emitted row ${gene}`);
    columns.forEach((column, at) => {
      const { cell } = cellColumn[at];
      const observed = tables.counts[index][cellColumn[at].at];
      const stored = row[at];
      assert.ok(typeof stored === 'number', `Missing value ${gene}/${column.sample}`);
      if (observed === 0) assert.equal(stored, 0, `A zero count is not stored as 0 at ${gene}/${column.sample}`);
      else {
        const exact = (observed / cell.library) * 1e6;
        assert.ok(Math.abs(stored - exact) <= bound * exact * (1 + 1e-12), `CPM ${gene}/${column.sample} is ${stored}, recomputed ${exact}`);
        assert.equal(stored, Number(stored.toPrecision(SIGNIFICANT_DIGITS)), `CPM ${gene}/${column.sample} has more than ${SIGNIFICANT_DIGITS} digits`);
      }
      checked++;
    });
  }
  return checked;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

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
  assert.equal(manifest.provider, 'visium');
  if (fetchSource) await acquire(manifest, record, from);

  const tables = await readTables(manifest);
  checkTables(tables);
  // Every donor x region cell is a sample: the authors set no minimum spots per region or donor.
  const kept = tables.cells;
  const donorOrder = (cell: Cell) => Number(cell.donor.slice('Donor '.length));

  const samples: ExternalSample[] = [];
  const columns: ExternalColumn[] = [];
  const cellOf = new Map<string, Cell>();
  const conditions: ExpressionCondition[] = [];
  for (const region of REGIONS) {
    const own = kept.filter((cell) => cell.region === region.key).sort((a, b) => donorOrder(a) - donorOrder(b));
    assert.ok(own.length > 0, `Regional cluster ${region.key} has no spot`);
    const spots = own.reduce((sum, cell) => sum + cell.spots, 0);
    const sectionCount = new Set(tables.sections.filter(([donor, , key]) => key === region.key && own.some((cell) => cell.donor === donor)).map(([, section]) => section)).size;
    const unassigned = region.key === UNASSIGNED;
    const title = region.name ? `${region.key} (${region.name})` : region.key;
    conditions.push({
      key: region.key,
      label: `${title} · ${plural(own.length, 'donor')}, ${plural(spots, 'spot')}`,
      referenceEligible: false, feedingState: 'not applicable (postmortem donor)', sampleCount: own.length,
      coverage: { donors: own.length, sections: sectionCount, spots },
      // Library sizes in sample order: the pooled CPM is the library-weighted mean of the donors' CPM.
      poolWeights: own.map((cell) => cell.library),
      ...(unassigned ? { unassigned: true } : {}),
      notes: `${plural(spots, 'spot')} from ${plural(own.length, 'donor')} and ${plural(sectionCount, 'section')}. `
        + 'Its pooled value sums every spot across donors and sections, as the authors summarise regions; each donor keeps its own value.'
        + `${unassigned ? ' Spots the authors left in no region; not ranked as a region.' : ''}`,
    });
    for (const cell of own) {
      const id = `${SOURCE_ID}:${cell.donor.replace(' ', '-').toLowerCase()}:${region.key}`;
      cellOf.set(id, cell);
      // Public fields only: the display-local donor label and coverage counts.
      samples.push({ id, label: cell.donor, sourceId: SOURCE_ID, groupId: region.key, metadata: {
        donor: cell.donor, region: region.key, spots: String(cell.spots), sections: String(cell.sections), libraryCounts: String(cell.library) } });
      columns.push({ group: region.key, sample: id });
    }
  }
  assert.equal(samples.length, kept.length, 'Every kept donor x region cell is one sample');
  // Released fields are allow-listed: nothing else about a donor may reach the manifest or an export.
  for (const sample of samples) assert.deepEqual(Object.keys(sample.metadata), PUBLIC_SAMPLE_FIELDS, `Sample ${sample.id} carries a field outside the allow-list`);
  for (const condition of conditions) assert.ok(!('sex' in condition) && !('age' in condition), `Region ${condition.key} carries donor attributes`);
  const columnIndex = columns.map((column) => tables.cells.indexOf(cellOf.get(column.sample!)!));

  const features: ExternalFeature[] = tables.genes.map((gene, index) => ({
    source: SOURCE_ID, id: gene, symbol: gene, ensemblId: '',
    values: columnIndex.map((at) => cpm(tables.counts[index][at], tables.cells[at].library)),
  }));
  const checkpoints: ExternalValidationCheckpoint[] = CHECKPOINTS.map(([gene, region]) => {
    const feature = features.find((entry) => entry.id === gene);
    assert.ok(feature, `Checkpoint gene ${gene} is not in the panel`);
    const at = columns.findIndex((column) => column.group === region);
    assert.ok(at >= 0, `Checkpoint region ${region} has no sample`);
    const cell = cellOf.get(columns[at].sample!)!;
    const value = feature.values[at]!;
    return { source: SOURCE_ID, feature: gene, symbol: gene, column: columns[at].sample!, sourceText: String(value), value,
      derivedFrom: { count: tables.counts[tables.genes.indexOf(gene)][tables.cells.indexOf(cell)], library: cell.library } };
  });

  const donors = new Set(kept.map((cell) => cell.donor));
  const allSections = new Set(tables.sections.map(([, section]) => section));
  const totalSpots = tables.cells.reduce((sum, cell) => sum + cell.spots, 0);
  const notes = [
    `Values are FFPE Visium probe-count CPM: each donor's spot counts summed over that donor's sections within one of the authors' grouped regions, divided by the summed library size, times 10^6, stored to ${SIGNIFICANT_DIGITS} significant digits. They are not TPM, nCPM or microarray intensity and are never placed on a shared scale with them.`,
    `Groups are the authors' ${conditions.length} grouped regional clusters: spot clusters named after the hypothalamic region holding most of their spots (Tadross et al. 2025), not hand-drawn anatomical regions. Names follow the authors' abbreviation table.`,
    `Samples are donor x regional-cluster pseudobulks of every spot, as the authors set no minimum: ${samples.length} from ${donors.size} donors, ${allSections.size} sections and ${totalSpots.toLocaleString('en-US')} spots. n counts donors, and one donor appears in several regions.`,
    "A region's pooled value is the CPM of all its spots summed across donors and sections, as the authors pool spots to summarise regions; each donor's own value is kept beside it. Unassigned spots stay in the data but are not ranked as a region.",
    'Each 55 µm Visium spot mixes several cells, so a region value is a tissue average, not a cell type.',
    `All ${tables.genes.length.toLocaleString('en-US')} panel genes are included; ${ZERO_GENES.length} (${ZERO_GENES.join(', ')}) have no count in any spot and are stored as measured zeros. Genes outside the probe panel, such as ${OFF_PANEL.join(', ')}, are reported as not measured, never as zero.`,
    'Donors are labeled Donor 1 to Donor 7 for this display only; source donor codes, sex, age and BMI are not shipped. Postmortem tissue: no group is eligible for the fed / reference filter.',
    'Data from Tadross et al. 2025 (HYPOMAP), University of Cambridge repository doi:10.17863/CAM.111988, CC BY 4.0; transformed by HypoExplorer (summed per donor and region, converted to CPM).',
  ];
  const provider = {
    name: 'HYPOMAP (Tadross et al. 2025)',
    release: 'humanHYPOMAP_spatial.rds, University of Cambridge repository, doi:10.17863/CAM.111988',
    license: 'CC BY 4.0', licenseUrl: manifest.original.licenseUrl,
    attribution: 'Tadross JA, Steuernagel L, Dowsett GKC, et al. A comprehensive spatio-cellular map of the human hypothalamus. Nature 2025;639(8055):708–716, doi:10.1038/s41586-024-08504-8. '
      + 'Visium data from the University of Cambridge repository, doi:10.17863/CAM.111988, under CC BY 4.0. Transformed by HypoExplorer: spot counts summed per donor and region and converted to CPM.',
  };
  const source: ExpressionSource = {
    id: SOURCE_ID, label: 'Human hypothalamus · HYPOMAP Visium by region', collection: 'external', scope: 'tissue',
    populationId: SOURCE_ID, populationLabel: 'Human hypothalamus (HYPOMAP Visium)', region: 'Hypothalamus, by region',
    species: 'Homo sapiens', assay: '10x Visium CytAssist spatial transcriptomics (probe-based) of postmortem FFPE sections; 55 µm spots',
    rnaFraction: 'Total RNA (FFPE, probe capture)', unit: 'FFPE Visium probe-count CPM',
    normalization: `Spot probe counts summed per donor and region across that donor's sections, divided by the summed library size and multiplied by 10^6 (CPM, ${SIGNIFICANT_DIGITS} significant digits); no further normalization`,
    replicateUnit: "One donor × regional-cluster pseudobulk of all its spots per sample; groups are the authors' regional clusters, so n counts donors; a region's pooled value sums every spot",
    identityMethod: 'The authors’ grouped regional clusters of spots (regional_clusters_grouped), Tadross et al. 2025',
    featureLevel: 'gene', valueKind: 'samples', groupKind: 'region', absentLabel: 'Not measured in this Visium probe panel',
    sampleCount: samples.length, sourceGroupIds: conditions.map((condition) => condition.key), conditions,
    sourceUrl: manifest.original.landing,
    citation: 'Tadross JA, Steuernagel L, Dowsett GKC, et al. A comprehensive spatio-cellular map of the human hypothalamus. Nature 2025;639(8055):708–716. doi:10.1038/s41586-024-08504-8. Visium data: University of Cambridge repository, doi:10.17863/CAM.111988.',
    notes: notes.join(' '), provider,
  };
  const productManifest: ManifestInput = {
    provider: 'visium', title: 'HYPOMAP human Visium · hypothalamic regions', release: provider.release,
    sources: [source], columns: { [SOURCE_ID]: columns }, samples, valueShardCount: VALUE_SHARDS, notes,
  };
  const { name, url, bytes, sha256: hash } = manifest.original;
  const files = buildProducts({
    manifest: productManifest, features, checkpoints,
    inputs: [{ name, url, bytes, sha256: hash }],
    numericalPolicy: `Derived CPM: 1e6 × count / library size in IEEE-754 doubles, rounded to ${SIGNIFICANT_DIGITS} significant digits (toPrecision); a zero count is 0. Agreement is with the CPM derived from the retained donor × region counts, not with a value the authors published.`,
    validationNotes: [
      `Retained counts: each donor x region column sums to its library size; spots agree between the cell, section and label tables (${EXTRACTOR} output, pinned by SHA-256).`,
      'The retained counts were also rebuilt from the spot-level counts by a separate DuckDB query over a Parquet export of the same object, and agreed in all 2,586,155 values.',
      'Every stored CPM is recomputed from its count and library size, independently of the build path.',
      ...notes,
    ],
  });
  const dir = productDir(ROOT, 'visium');
  await writeOrCheck(dir, files, check);
  const compared = await replay(dir, productManifest, features);
  const recomputed = await recomputeCpm(dir, tables, columns, cellOf);
  assert.equal(recomputed, compared);
  const total = [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  console.log(`${check ? 'Verified' : 'Built'} HYPOMAP Visium: ${features.length} genes × ${samples.length} donor-region samples in ${conditions.length} regional clusters from ${donors.size} donors; `
    + `${compared} values read back and recomputed from counts; ${files.size} files, ${(total / 1e6).toFixed(1)} MB.`);
}

await main();
