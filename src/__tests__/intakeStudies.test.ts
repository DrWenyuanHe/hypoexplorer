import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackBundlePayload } from '../../scripts/lib/bundleWriter.mjs';
import {
  buildIntakeStudies,
  intakeArgs,
  intakePath,
  readIntakeTable,
  type IntakeHooks,
} from '../../scripts/lib/intakeStudies.mjs';
import type { DatasetDefinition } from '../data/datasets';

// A two-study fixture intake on disk: a manifest, per-study sample sheets and
// DE tables, a hook that reads them, and an empty public root. It exercises
// the shared pipeline the September 5 builder runs on: staging, publish,
// --check, --only and the value-compared registry sidecar.

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface FixtureStudy {
  id: string;
  accession: string;
  tracks: Array<{ id: string; label: string }>;
}

const MANIFEST: FixtureStudy[] = [
  { id: 'fixture_one', accession: 'GSE1', tracks: [{ id: 'whole', label: 'Whole tissue' }] },
  { id: 'fixture_two', accession: 'GSE2', tracks: [{ id: 'arc', label: 'Arcuate' }, { id: 'pvn', label: 'PVN' }] },
];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intake-fixture-'));
  roots.push(root);
  for (const study of MANIFEST) {
    for (const track of study.tracks) {
      const dir = resolve(root, 'intake', study.accession);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${track.id}_samples.tsv`),
        'sample\tgroup\nC1\tcontrol\nC2\tcontrol\nC3\tcontrol\nK1\tcase\nK2\tcase\nK3\tcase\n');
      writeFileSync(resolve(dir, `${track.id}_DE.tsv.gz`), gzipSync(
        'gene\tlogFC\tPValue\tFDR\nA\t1.5\t0.001\t0.02\nB\t-0.5\t0.03\t0.2\nC\t0.1\t0.009\t0.06\n',
      ));
    }
  }
  return root;
}

function definition(study: FixtureStudy): DatasetDefinition {
  return {
    id: study.id, name: `Fixture ${study.accession}`, organism: 'Mus musculus', category: 'Diet-induced obesity',
    region: 'Whole hypothalamus', preparation: 'Bulk tissue', perturbation: 'Diet & obesity', modality: 'bulk RNA-seq',
    featureType: 'gene', featureLabel: 'Gene', supportsPathways: true, isDefault: false,
    defaultTrack: study.tracks[0].id, trackCategoryOrder: ['Tissue'], expressionUnit: 'CPM',
    citation: 'Synthetic fixture intake (café)', geo: study.accession, doi: '', pmid: '',
    groups: [
      { key: 'control', label: 'Control', color: '#3775BA' },
      { key: 'case', label: 'Case', color: '#B64342' },
    ],
    contrasts: [{ id: 'case_vs_control', baseline: 'control', case: 'case', isDefault: true }],
  };
}

function hooks(root: string, fail?: string): IntakeHooks<FixtureStudy> {
  return {
    name: 'Fixture intake',
    registryPath: 'registry.generated.json',
    studies: MANIFEST,
    id: (study) => study.id,
    key: (study) => study.accession,
    build(study) {
      if (study.accession === fail) throw new Error(`${study.accession}: malformed fixture`);
      const tracks: TrackBundlePayload[] = study.tracks.map((track, index) => {
        const sheet = readIntakeTable(root, `intake/${study.accession}/${track.id}_samples.tsv`);
        const groupSamples = {
          control: sheet.filter((row) => row.group === 'control').map((row) => row.sample),
          case: sheet.filter((row) => row.group === 'case').map((row) => row.sample),
        };
        const sampleOrder = [...groupSamples.control, ...groupSamples.case];
        const de = readIntakeTable(root, `intake/${study.accession}/${track.id}_DE.tsv.gz`).map((row, rank) => ({
          gene: row.gene, logFC: Number(row.logFC), PValue: Number(row.PValue), FDR: Number(row.FDR), rank_score: -rank,
        }));
        return {
          trackId: track.id,
          armKeys: ['control', 'case'],
          defaultContrastBinding: { id: 'case_vs_control', baseline: 'control', case: 'case' },
          color: ['#4C78A8', '#F58518'][index],
          meta: {
            code: track.id, label: track.label, type: 'Tissue', nGenes: de.length,
            sampleOrder, groupSamples, expressionUnit: 'CPM',
          },
          qc: { cluster: track.id, clusterLabel: track.label, minCells: 0, samplesKept: sampleOrder },
          de,
          cpm: Object.fromEntries(de.map((row) => [row.gene, sampleOrder.map((_, i) => i)])),
          pathways: { HALLMARK: [{ pathway: `HALLMARK_${track.id.toUpperCase()}`, pval: 0.01, padj: 0.02, NES: 1.5, size: 2, leadingEdge: ['A'] }] },
        };
      });
      return { definition: definition(study), tracks, log: [`${study.accession}: ${tracks.length} tracks`] };
    },
  };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name).slice(dir.length + 1).replace(/\\/g, '/'))
    .sort();
}

const quiet = { log: () => {} };

describe('buildIntakeStudies fixture intake', () => {
  it('publishes every track of every study, then checks current', () => {
    const root = fixtureRoot();
    const publicRoot = resolve(root, 'public');
    const result = buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet });
    expect(result.studies).toEqual(['fixture_one', 'fixture_two']);
    expect(result.registryChanged).toBe(true);
    expect(listFiles(publicRoot)).toEqual([
      'datasets/fixture_one/meta.js',
      'datasets/fixture_one/pathways_index.js',
      'datasets/fixture_one/qc_global.js',
      'datasets/fixture_one/track_whole.js',
      'datasets/fixture_one/track_whole.pathways.js',
      'datasets/fixture_two/meta.js',
      'datasets/fixture_two/pathways_index.js',
      'datasets/fixture_two/qc_global.js',
      'datasets/fixture_two/track_arc.js',
      'datasets/fixture_two/track_arc.pathways.js',
      'datasets/fixture_two/track_pvn.js',
      'datasets/fixture_two/track_pvn.pathways.js',
    ]);
    const qc = readFileSync(resolve(publicRoot, 'datasets/fixture_two/qc_global.js'), 'utf8');
    // FDR<0.05 counts only A (0.02); C has P 0.009 but FDR 0.06.
    expect(qc).toContain('"deSummary":[{"cluster":"arc","clusterLabel":"Arcuate","nGenes":3,"nSig":1}');
    expect(readFileSync(resolve(publicRoot, 'datasets/fixture_two/pathways_index.js'), 'utf8'))
      .toContain('["HALLMARK_ARC","HALLMARK_PVN"]');
    const registry = JSON.parse(readFileSync(resolve(root, 'registry.generated.json'), 'utf8'));
    expect(registry.map((entry: DatasetDefinition) => entry.id)).toEqual(['fixture_one', 'fixture_two']);

    const again = buildIntakeStudies(hooks(root), { root, publicRoot, check: true, ...quiet });
    expect(again.registryChanged).toBe(false);
    expect(again.files).toHaveLength(12);
    expect(listFiles(resolve(root, '.tmp'))).toEqual([]);
  });

  it('reports stale and missing bundles in check mode without writing', () => {
    const root = fixtureRoot();
    const publicRoot = resolve(root, 'public');
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, check: true, ...quiet }))
      .toThrow(/missing or stale bundles:[\s\S]*fixture_one[/\\]meta\.js/);
    expect(listFiles(publicRoot)).toEqual([]);
    expect(existsSync(resolve(root, 'registry.generated.json'))).toBe(false);

    buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet });
    const track = resolve(publicRoot, 'datasets/fixture_two/track_pvn.js');
    // CRLF checkouts are current; a changed byte is not.
    writeFileSync(track, readFileSync(track, 'utf8').replace(/\n/g, '\r\n'));
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, check: true, ...quiet })).not.toThrow();
    writeFileSync(track, readFileSync(track, 'utf8').replace('"nGenes":3', '"nGenes":4'));
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, check: true, ...quiet }))
      .toThrow(/fixture_two[/\\]track_pvn\.js/);
  });

  it('publishes nothing when a later study fails', () => {
    const root = fixtureRoot();
    const publicRoot = resolve(root, 'public');
    expect(() => buildIntakeStudies(hooks(root, 'GSE2'), { root, publicRoot, ...quiet })).toThrow(/malformed fixture/);
    expect(listFiles(publicRoot)).toEqual([]);
    expect(existsSync(resolve(root, 'registry.generated.json'))).toBe(false);
    expect(listFiles(resolve(root, '.tmp'))).toEqual([]);
  });

  it('builds --only studies and keeps every other registry entry in manifest order', () => {
    const root = fixtureRoot();
    const publicRoot = resolve(root, 'public');
    buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet });
    const before = readFileSync(resolve(root, 'registry.generated.json'));
    const partial = buildIntakeStudies(hooks(root), { root, publicRoot, only: ['GSE2'], ...quiet });
    expect(partial.studies).toEqual(['fixture_two']);
    expect(partial.registryChanged).toBe(false);
    expect(readFileSync(resolve(root, 'registry.generated.json'))).toEqual(before);
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, only: ['GSE9'], ...quiet }))
      .toThrow(/unknown studies \(GSE9\)/);
  });

  it('compares the registry by value, so pinned escaped bytes are not re-spelled', () => {
    const root = fixtureRoot();
    const publicRoot = resolve(root, 'public');
    buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet });
    const file = resolve(root, 'registry.generated.json');
    const escaped = readFileSync(file, 'utf8').replace(/café/g, 'caf\\u00e9');
    writeFileSync(file, escaped);
    expect(buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet }).registryChanged).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(escaped);

    writeFileSync(file, '[]\n');
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, check: true, ...quiet }))
      .toThrow(/registry\.generated\.json is stale/);
    writeFileSync(file, `${JSON.stringify([{ ...definition(MANIFEST[0]), id: 'stray' }])}\n`);
    expect(() => buildIntakeStudies(hooks(root), { root, publicRoot, ...quiet })).toThrow(/unknown study/);
  });
});

describe('intake path and table guards', () => {
  it('keeps manifest paths inside the root', () => {
    const root = fixtureRoot();
    expect(intakePath(root, 'intake/GSE1/whole_samples.tsv')).toBe(resolve(root, 'intake/GSE1/whole_samples.tsv'));
    for (const unsafe of ['../outside.tsv', 'intake/../x.tsv', './x.tsv', 'a//b.tsv', 'a\\b.tsv', resolve(root, 'x.tsv'), '']) {
      expect(() => intakePath(root, unsafe)).toThrow(/Unsafe intake path/);
    }
  });

  it('reads gzipped tables and refuses duplicate headers', () => {
    const root = fixtureRoot();
    expect(readIntakeTable(root, 'intake/GSE1/whole_DE.tsv.gz')[0]).toEqual({ gene: 'A', logFC: '1.5', PValue: '0.001', FDR: '0.02' });
    writeFileSync(resolve(root, 'dup.tsv'), 'gene\tgene\nA\tB\n');
    expect(() => readIntakeTable(root, 'dup.tsv')).toThrow(/dup\.tsv header/);
  });

  it('parses only --check and --only', () => {
    expect(intakeArgs([])).toEqual({ check: false, only: undefined });
    expect(intakeArgs(['--check', '--only=GSE1,GSE2'])).toEqual({ check: true, only: ['GSE1', 'GSE2'] });
    expect(() => intakeArgs(['--force'])).toThrow(/Unsupported argument/);
    expect(() => intakeArgs(['--only='])).toThrow(/Unsupported argument/);
  });
});
