import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allAtlasProblems, ATLAS_DIRS, atlasFiles, atlasProblems } from '../../scripts/lib/deployInputs.mjs';
import { KEGG_NOTE, keggCollections, PUBLIC_RELEASE_MARKER, reducedBundleFindings } from '../../scripts/lib/publicDataRelease.mjs';
import { EXTERNAL_LOOKUP_SHARDS } from '../expression-survey/externalReferenceFormat';

const roots: string[] = [];
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'hypoexplorer-deploy-guards-'));
  roots.push(root);
  return root;
}
function put(root: string, relative: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function writeAtlas(root: string, dir: string, options: { skip?: string } = {}): void {
  const manifest = { lookupShardCount: EXTERNAL_LOOKUP_SHARDS, valueShardCount: 2, validationPath: 'validation.json' };
  put(root, `expression/${dir}/manifest.json`, JSON.stringify(manifest));
  for (const file of atlasFiles(manifest)) if (file !== options.skip) put(root, `expression/${dir}/${file}`, '{}');
}

describe('deploy inputs: reference atlases', () => {
  it('names the three atlas directories the app loads', () => {
    expect([...ATLAS_DIRS].sort()).toEqual(['allen-human', 'gtex', 'hpa']);
  });

  it('lists the validation report and every lookup and value shard', () => {
    const files = atlasFiles({ lookupShardCount: 2, valueShardCount: 3, validationPath: 'validation.json' });
    expect(files).toEqual(['validation.json', 'lookup/l0000.json', 'lookup/l0001.json', 'values/v0000.json', 'values/v0001.json', 'values/v0002.json']);
  });

  it('accepts complete atlases and reports missing or partial ones', () => {
    const root = scratch();
    for (const dir of ATLAS_DIRS) writeAtlas(root, dir);
    expect(allAtlasProblems(root, 'dist')).toEqual([]);

    const partial = scratch();
    writeAtlas(partial, 'gtex', { skip: 'values/v0001.json' });
    writeAtlas(partial, 'hpa');
    const problems = allAtlasProblems(partial, 'dist');
    expect(problems).toEqual([
      expect.stringContaining('dist/expression/gtex/ is missing 1 of'),
      'dist/expression/allen-human/manifest.json is missing',
    ]);
  });

  it('rejects an unreadable manifest', () => {
    const root = scratch();
    put(root, 'expression/gtex/manifest.json', 'not json');
    expect(atlasProblems(path.join(root, 'expression/gtex'), 'gtex')).toEqual(['gtex/manifest.json does not parse']);
  });
});

describe('upload guard: public data release bundles', () => {
  const pathways = (kegg: string) => `var POP_PATHWAYS = {"GO_BP":[{"pathway":"GOBP_X"}],"KEGG":${kegg}};\n`;

  it('counts empty and populated KEGG collections', () => {
    expect(keggCollections(pathways('[]'))).toEqual({ total: 1, empty: 1 });
    expect(keggCollections(pathways('[{"pathway":"KEGG_RIBOSOME"}]'))).toEqual({ total: 1, empty: 0 });
    expect(keggCollections('var X = {"default":{"KEGG":[ ]},"byContrast":{"b":{"KEGG":[{"pathway":"KEGG_A"}]}}};')).toEqual({ total: 2, empty: 1 });
  });

  it('finds nothing in full bundles', async () => {
    const root = scratch();
    put(root, 'datasets/gse1/track_a.pathways.js', pathways('[{"pathway":"KEGG_RIBOSOME"}]'));
    put(root, 'datasets/gse2/track_b.pathways.js', pathways('[]'));
    put(root, 'datasets/macaque_snrna/track_Ast1.js', 'var POP = {"genes":[],"cpm":{"OXT":[1,2]}};\n');
    expect(await reducedBundleFindings(root)).toEqual([]);
  });

  it('recognizes the marker, the KEGG note, withheld CPM and an all-empty KEGG corpus', async () => {
    const root = scratch();
    put(root, PUBLIC_RELEASE_MARKER, JSON.stringify({ tag: 'data-2026-11-06' }));
    put(root, KEGG_NOTE, '# KEGG is not included\n');
    put(root, 'datasets/gse1/track_a.pathways.js', pathways('[]'));
    put(root, 'datasets/macaque_snrna/track_Ast1.js', '// header\nvar POP = {"genes":[],"cpm":{}};\n');
    put(root, 'datasets/macaque_snrna/track_Ast1.pathways.js', pathways('[]'));
    const findings = await reducedBundleFindings(root);
    expect(findings).toHaveLength(4);
    expect(findings[0]).toContain('data-2026-11-06');
    expect(findings[2]).toContain('1 of 1 datasets/macaque_snrna track bundles');
    expect(findings[3]).toContain('all 2 KEGG collections');
  });

  it('judges a single-dataset upload by the markers and that dataset only', async () => {
    const root = scratch();
    put(root, 'datasets/gse1/track_a.pathways.js', pathways('[]'));
    put(root, 'datasets/macaque_snrna/track_Ast1.js', 'var POP = {"cpm":{}};\n');
    // A single study can legitimately have no KEGG results.
    expect(await reducedBundleFindings(root, { only: 'gse1' })).toEqual([]);
    expect(await reducedBundleFindings(root, { only: 'macaque_snrna' })).toHaveLength(1);
    put(root, PUBLIC_RELEASE_MARKER, '{}');
    expect(await reducedBundleFindings(root, { only: 'gse1' })).toHaveLength(1);
  });
});
