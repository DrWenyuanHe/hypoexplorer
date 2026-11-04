// Contract test for the downloadable agent export (scripts/build_agent_export.mts).
// Builds a small subset twice from the committed bundles and checks the archive
// is reproducible, valid, matches its manifest, follows the documented schema
// and carries the same numbers as the bundles under the strict contrast rules.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLUMN_DOCS, CONTRAST_COLUMNS, DATASET_COLUMNS, DE_COLUMNS, FGSEA_COLUMNS, SAMPLE_COLUMNS, TRACK_COLUMNS,
  TRACK_CONTRAST_COLUMNS,
} from '../../scripts/lib/agentExport.mjs';
import { getActiveContrast } from '../data/contrasts';
import { DATASET_CATEGORIES } from '../data/datasetCategories';
import { DATASET_PERTURBATIONS } from '../data/datasetFacets';
import { getDataset } from '../data/datasets';
import { strictDeTableFor } from '../data/rawTrack';
import type { RawTrack } from '../types';

// Single and multi-contrast bundles, overlapping factorial arms and a time course.
const SUBSET = ['emtab15488', 'gse135007', 'mouse_pomc_maternal_hfd_gse135639', 'mouse_scn_hfd_gse157077'];
const root = process.cwd();
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version as string;
const stem = `hypoexplorer-data-v${version}-subset`;
let work: string;

function build(out: string, ...extra: string[]): void {
  execFileSync(process.execPath, [
    resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'scripts/build_agent_export.mts'),
    '--datasets', SUBSET.join(','), '--out', out, ...extra,
  ], { cwd: root, stdio: 'pipe', windowsHide: true });
}

/** Reads a ZIP through its central directory, checking each entry's CRC. */
function readZip(file: string): Map<string, Buffer> {
  const zip = readFileSync(file);
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(dataAt, dataAt + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data), name).toBe(crc);
    out.set(name.slice(stem.length + 1), data);
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  return rows;
}

function table(files: Map<string, Buffer>, name: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(files.get(name)!.toString('utf8'));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function header(files: Map<string, Buffer>, name: string): string[] {
  return parseCsv(`${files.get(name)!.toString('utf8').split('\n')[0]}\n`)[0];
}

function readBundle<T>(file: string): T {
  const src = readFileSync(file, 'utf8');
  return JSON.parse(src.slice(src.indexOf('{', src.indexOf('var '))).replace(/;\s*$/, '')) as T;
}

let files: Map<string, Buffer>;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'hx-agent-export-'));
  build(join(work, 'a'));
  build(join(work, 'b'));
  build(join(work, 'stats'), '--kegg', 'stats', '--no-zip', '--unpacked');
  files = readZip(join(work, 'a', `${stem}.zip`));
}, 240_000);

afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }); });

describe('agent export archive', () => {
  it('is byte-for-byte reproducible and matches its manifest', () => {
    const a = readFileSync(join(work, 'a', `${stem}.zip`));
    expect(readFileSync(join(work, 'b', `${stem}.zip`)).equals(a)).toBe(true);
    const digest = createHash('sha256').update(a).digest('hex');
    expect(readFileSync(join(work, 'a', `${stem}.zip.sha256`), 'utf8')).toBe(`${digest}  ${stem}.zip\n`);

    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
    expect(manifest.files.map((f: { path: string }) => f.path).sort())
      .toEqual([...files.keys()].filter((n) => n !== 'manifest.json').sort());
    for (const entry of manifest.files) {
      const data = files.get(entry.path)!;
      expect(data.length, entry.path).toBe(entry.bytes);
      expect(createHash('sha256').update(data).digest('hex'), entry.path).toBe(entry.sha256);
    }
  });

  it('ships the agent documents and license notices', () => {
    for (const name of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE-DATA.md', 'CITATION.cff', 'reference/nomenclature.tsv']) {
      expect(files.has(name), name).toBe(true);
    }
    expect(files.get('CLAUDE.md')!.toString()).toContain('@AGENTS.md');
    const license = files.get('LICENSE-DATA.md')!.toString();
    expect(license).toContain('Kanehisa Laboratories');
    expect(license).toContain('creativecommons.org/licenses/by/4.0');
    expect(files.get('README.md')!.toString()).toContain('partial build');
  });

  it('writes every table with its documented header, and documents every column', () => {
    const contracts: Record<string, readonly string[]> = {
      'datasets.csv': DATASET_COLUMNS, 'contrasts.csv': CONTRAST_COLUMNS, 'tracks.csv': TRACK_COLUMNS,
      'track_contrasts.csv': TRACK_CONTRAST_COLUMNS, 'datasets/<id>/samples.csv': SAMPLE_COLUMNS,
      'datasets/<id>/de.csv': DE_COLUMNS, 'datasets/<id>/fgsea.csv': FGSEA_COLUMNS,
    };
    const readme = files.get('README.md')!.toString();
    for (const [name, columns] of Object.entries(contracts)) {
      expect(Object.keys(COLUMN_DOCS[name]), name).toEqual([...columns]);
      for (const column of columns) expect(readme).toContain(`| \`${column}\` |`);
      const paths = name.includes('<id>') ? SUBSET.map((id) => name.replace('<id>', id)).filter((p) => files.has(p)) : [name];
      expect(paths.length, name).toBeGreaterThan(0);
      for (const path of paths) expect(header(files, path), path).toEqual([...columns]);
    }
  });

  it('covers every registered contrast and track with the bundle numbers', () => {
    const contrasts = table(files, 'contrasts.csv');
    const trackContrasts = table(files, 'track_contrasts.csv');
    for (const id of SUBSET) {
      const dataset = getDataset(id)!;
      expect(contrasts.filter((c) => c.dataset_id === id).map((c) => c.contrast_id))
        .toEqual(dataset.contrasts.map((c) => c.id));
      const de = table(files, `datasets/${id}/de.csv`);
      const meta = readBundle<{ populations: string[] }>(resolve(root, 'public/datasets', id, 'meta.js'));
      for (const trackId of meta.populations) {
        const raw = readBundle<RawTrack>(resolve(root, 'public/datasets', id, `track_${trackId}.js`));
        for (const contrast of dataset.contrasts) {
          const expected = strictDeTableFor(raw, contrast.id, getActiveContrast(dataset)!.id);
          const rows = de.filter((r) => r.track_id === trackId && r.contrast_id === contrast.id);
          expect(rows.length, `${id}/${trackId}/${contrast.id}`).toBe(expected.length);
          const summary = trackContrasts.find((r) => r.dataset_id === id && r.track_id === trackId && r.contrast_id === contrast.id)!;
          expect(Number(summary.de_rows)).toBe(expected.length);
          expected.slice(0, 50).forEach((r, i) => {
            expect(rows[i].gene).toBe(r.gene);
            expect(Number(rows[i].logFC)).toBe(r.logFC);
            expect(rows[i].FDR === '' ? null : Number(rows[i].FDR)).toBe(r.FDR);
          });
          expect(Number(summary.de_fdr_sig)).toBe(expected.filter((r) => r.FDR != null && r.FDR < 0.05).length);
        }
        const matrix = files.get(`datasets/${id}/expression/${trackId}.csv`)!.toString().split('\n');
        expect(matrix.length - 2).toBe(Object.keys(raw.cpm).length);
      }
    }
  });

  it('lists overlapping factorial arms and ships time courses', () => {
    const samples = table(files, 'datasets/mouse_pomc_maternal_hfd_gse135639/samples.csv');
    expect(samples.some((s) => s.group_key.includes(';'))).toBe(true);
    expect(files.has('datasets/mouse_scn_hfd_gse157077/timeseries/scn.csv')).toBe(true);
    expect(header(files, 'datasets/mouse_scn_hfd_gse157077/timeseries/scn_samples.csv')).toContain('time');
  });

  it('keeps KEGG statistics but drops their leading edges in stats mode', () => {
    const full = table(files, 'datasets/gse135007/fgsea.csv').filter((r) => r.collection === 'KEGG');
    expect(full.length).toBeGreaterThan(0);
    expect(full.some((r) => r.leading_edge)).toBe(true);
    const stats = parseCsv(readFileSync(join(work, 'stats', stem, 'datasets/gse135007/fgsea.csv'), 'utf8'));
    const kegg = stats.filter((r) => r[3] === 'KEGG');
    expect(kegg.length).toBe(full.length);
    expect(kegg.every((r) => r[9] === '')).toBe(true);
  });

  it('documents a sample query using facet values that exist in the registry', () => {
    const readme = files.get('README.md')!.toString();
    expect(DATASET_PERTURBATIONS).toContain('Fasting & feeding');
    expect(DATASET_CATEGORIES).toContain('Feeding & fasting');
    expect(readme).toContain("d.perturbation = 'Fasting & feeding'");
    expect(readme).toContain("d.category = 'Feeding & fasting'");
  });
});
