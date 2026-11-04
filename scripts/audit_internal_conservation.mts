/** Reconcile retained and excluded counts directly with pinned GEO archive members. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { approximatelyEqual, numeric, parseTsv, splitCells } from './lib/internalQc.mjs';

const ROOT = process.cwd();
const FOLDER = 'data/internal-qc/advancement-2026-09-05';
const SCRIPT = 'scripts/audit_internal_conservation.mts';
const hash = (path: string): string => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
const text = (path: string): string => { const b = readFileSync(resolve(ROOT, path)); return (path.endsWith('.gz') ? gunzipSync(b) : b).toString('utf8'); };
const configs = parseTsv(text('geo_replication/config/datasets.tsv'));
const bindings = JSON.parse(text('data/author-validation/mechanical-audit.generated.json')).datasets;
const targets = ['GSE179663', 'GSE204883', 'GSE207494', 'E-MTAB-12340', 'GSE128148'];
const sourceTables: Record<string, string> = {
  'E-MTAB-12340': 'raw/hypo_utr-seq_unfiltered_countmat.csv',
  GSE128148: 'raw/GSE128148_2019_Wray_4week_raw_counts.txt.gz',
};
function member(archive: Buffer, file: string): Buffer {
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('Invalid tar member boundary');
    if (name.replace(/^\.\//, '') === file) return archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Archive member absent: ${file}`);
}
const records = targets.map((id) => {
  const config = configs.find((c) => c.id === id)!;
  const binding = bindings.find((b: any) => b.configId === id);
  const inputPath = `geo_replication/${config.input_path}`;
  const sheetPath = `geo_replication/${config.samplesheet}`;
  const archivePath = `geo_replication/${config.dir}/${sourceTables[id] ?? `raw/${id}_RAW.tar`}`;
  const sheet = parseTsv(text(sheetPath)).filter((r) => ['control', 'case'].includes(r.group));
  const output = parseTsv(text(inputPath));
  const idColumn = Object.keys(output[0])[0];
  const outputIds = new Set(output.map((r) => r[idColumn]));
  if (outputIds.size !== output.length) throw new Error(`${id}: duplicate output feature ids`);
  const archive = readFileSync(resolve(ROOT, archivePath));
  const samples = sheet.map((sample) => {
    const isTable = !!sourceTables[id];
    const payload = isTable ? archive : member(archive, sample.file);
    const sourceText = isTable ? text(archivePath) : gunzipSync(payload).toString('utf8');
    // Preserve an empty first header cell; the Wray source uses CR-only records.
    const lines = sourceText.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((line) => line.trim());
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const header = splitCells(lines[0], delimiter);
    const valueIndex = isTable ? header.indexOf(sample.sample) : id === 'GSE204883' ? 1 : header.indexOf('expected_count');
    if (valueIndex < 0) throw new Error(`${id}: expected_count missing`);
    const source = new Map<string, number>();
    for (const line of lines.slice(1)) {
      const cells = splitCells(line, delimiter);
      const value = numeric(cells[valueIndex]);
      if (value == null || value < 0 || source.has(cells[0])) throw new Error(`${id}: invalid/duplicate source row`);
      source.set(cells[0], value);
    }
    let outputSum = 0;
    let maximumValueDelta = 0;
    for (const row of output) {
      const before = source.get(row[idColumn]);
      const after = numeric(row[sample.sample]);
      if (before == null || after == null || after < 0) throw new Error(`${id}: unmatched/invalid output row`);
      outputSum += after;
      maximumValueDelta = Math.max(maximumValueDelta, Math.abs(after - before));
    }
    const excluded = [...source].filter(([gene]) => !outputIds.has(gene));
    const badExclusions = id === 'GSE204883' ? excluded.length !== 30 || excluded.some(([gene]) => !gene.startsWith('transcript:ENSMUST'))
      : id === 'E-MTAB-12340' ? excluded.length !== 92 || excluded.some(([gene]) => !/^ERCC-[0-9]+$/.test(gene)) : excluded.length !== 0;
    if (badExclusions) throw new Error(`${id}: source exclusion policy changed`);
    const sourceSum = [...source.values()].reduce((a, b) => a + b, 0);
    const excludedSum = excluded.reduce((sum, [, value]) => sum + value, 0);
    const delta = outputSum + excludedSum - sourceSum;
    return { sample: sample.sample, source_file: sample.file ?? archivePath, source_sha256: createHash('sha256').update(payload).digest('hex'), source_rows: source.size, output_rows: output.length, excluded_rows: excluded.length, source_library_size: sourceSum, excluded_count_sum: excludedSum, output_library_size: outputSum, count_conservation_delta: delta, maximum_retained_count_delta: maximumValueDelta, status: approximatelyEqual(delta, 0) && maximumValueDelta <= 1e-6 ? 'pass' : 'fail' };
  });
  return { datasetId: binding.datasetId, configId: id, contrastId: binding.contrasts[0].contrastId, config, archivePath, fingerprints: Object.fromEntries([inputPath, sheetPath, archivePath].map((file) => [file, hash(file)])), scriptSha256: hash(SCRIPT), status: samples.every((s) => s.status === 'pass') ? 'pass' : 'fail', samples, note: `Retained gene counts compared by original feature identifier directly with ${sourceTables[id] ? 'the deposited source matrix' : 'GEO tar members'}. ${id === 'GSE204883' ? 'All 30 explicitly quarantined transcript-identifier rows are accounted for separately.' : id === 'E-MTAB-12340' ? 'All 92 technical ERCC spike-in rows are accounted for separately.' : 'No source rows are discarded.'}` };
});
writeFileSync(resolve(ROOT, `${FOLDER}/conservation-evidence.json`), `${JSON.stringify({ schemaVersion: 1, script: SCRIPT, records }, null, 2)}\n`);
process.stdout.write(`Reconciled ${records.length} count datasets directly against GEO source archives.\n`);
