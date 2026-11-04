import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FGSEA_DATABASES,
  FGSEA_FOCAL_SCHEMA,
  FGSEA_FULL_SCHEMA,
  parseFgseaTable,
  readVerifiedFgseaSet,
  resolveConfiguredFgseaSpecies,
} from '../../scripts/lib/fgseaProvenance.mjs';
import { roundProb } from '../../scripts/lib/bundleSlim.mjs';

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tsv = (schema: readonly string[], rows: Record<string, string>[]) =>
  `${schema.join('\t')}\n${rows.map((row) => schema.map((key) => row[key] ?? '').join('\t')).join('\n')}${rows.length ? '\n' : ''}`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'fgsea-provenance-'));
  tempDirs.push(dir);
  const prefix = 'GSE_TEST';
  const dePath = join(dir, `${prefix}_DE.tsv`);
  const generatorPath = join(dir, 'run_mouse_fgsea.R');
  writeFileSync(generatorPath, '# synthetic current generator\n');
  writeFileSync(dePath, `symbol\tstat\n${Array.from({ length: 20 }, (_, i) => `Gene${i}\t${i + 1}`).join('\n')}\n`);
  const provenance: Record<string, string> = {
    schema_version: '3',
    generator: 'scripts/run_mouse_fgsea.R',
    generator_sha256: hash(generatorPath),
    r_version: 'R version fixture',
    fgsea_version: '1.38.0',
    msigdbr_version: '26.1.0',
    babelgene_version: '22.9',
    msigdb_authority: 'HS',
    msigdb_db_version: '2026.1.Hs',
    target_species: 'Mus musculus',
    de_sha256: hash(dePath),
    rank_gene_count: '20',
    rank_statistic: 'DE.stat',
    tie_seed: '42',
    fgsea_seed: '42',
    seed_policy: 'tie seed once; FGSEA seed reset before each collection',
    tie_jitter: 'runif(0,1e-7) before descending sort',
    ortholog_cache_policy: 'clear target-species msigdbr ortholog cache before every collection fetch',
    output_hash_policy: 'SHA-256 of exact published TSV bytes',
    min_pathway_size: '15',
    max_pathway_size: '500',
  };
  const paths: Record<string, string> = {};
  const base = { pval: '0.123456789', padj: '0.234567891', NES: '1.2345678', size: '15', leadingEdge: 'Gene1;Gene2' };
  for (const db of ['HALLMARK', 'KEGG', 'GO_BP', 'REACTOME']) {
    paths[db] = join(dir, `${prefix}_FGSEA_${db}.tsv`);
    writeFileSync(paths[db], tsv(FGSEA_FULL_SCHEMA, [
      { pathway: db === 'REACTOME' ? 'REACTOME_IGF_TRANSPORT_AND_UPTAKE' : `${db}_VALID`, ...base },
      { pathway: `${db}_UNBALANCED`, ...base, pval: '', padj: '', NES: '' },
    ]));
    const key = db.toLowerCase();
    provenance[`${key}_source_collection`] = db === 'HALLMARK' ? 'H' : db === 'GO_BP' ? 'C5' : 'C2';
    provenance[`${key}_source_subcollection`] = db === 'HALLMARK' ? '(all)' : db === 'GO_BP' ? 'GO:BP' : db === 'KEGG' ? 'CP:KEGG_LEGACY' : 'CP:REACTOME';
    provenance[`${key}_pathway_count`] = '2';
    provenance[`${key}_membership_sha256`] = 'a'.repeat(64);
    provenance[`${key}_result_rows`] = '2';
    provenance[`${key}_result_sha256`] = hash(paths[db]);
  }
  paths.focal = join(dir, `${prefix}_fgsea.tsv`);
  writeFileSync(paths.focal, tsv(FGSEA_FOCAL_SCHEMA, [{
    pathway: 'REACTOME_IGF_TRANSPORT_AND_UPTAKE', ...base, log2err: '0.1', ES: '0.2', dataset: prefix,
  }]));
  provenance.focal_result_rows = '1';
  provenance.focal_result_sha256 = hash(paths.focal);
  const provenancePath = join(dir, `${prefix}_FGSEA_provenance.tsv`);
  const save = () => writeFileSync(provenancePath, tsv(['key', 'value'], Object.entries(provenance).map(([key, value]) => ({ key, value }))));
  save();
  const read = () => readVerifiedFgseaSet(dePath, { generatorPath, expectedSpecies: 'Mus musculus' });
  return { dir, dePath, generatorPath, provenancePath, paths, provenance, save, read };
}

describe('parseFgseaTable', () => {
  it('preserves raw probability text and trailing missing cells', () => {
    const rows = parseFgseaTable('pathway\tpval\tpadj\tNES\tsize\tleadingEdge\nP\t1e-30\t\t\t15\t\n', 'fixture');
    expect(rows).toEqual([{ pathway: 'P', pval: '1e-30', padj: '', NES: '', size: '15', leadingEdge: '' }]);
  });
  it('rejects drifted headers and ragged rows', () => {
    expect(() => parseFgseaTable('pathway\tqvalue\nP\t0.2\n', 'fixture')).toThrow(/expected TSV schema/);
    expect(() => parseFgseaTable(`${FGSEA_FULL_SCHEMA.join('\t')}\nP\t0.1\n`, 'fixture')).toThrow(/expected 6/);
  });
});

describe('readVerifiedFgseaSet', () => {
  it('retains raw rows and follows the finite-only public builder wire contract', () => {
    const f = fixture();
    const verified = f.read();
    expect(Object.keys(verified.rawRows)).toEqual(FGSEA_DATABASES);
    expect(verified.rawRows.GO_BP).toHaveLength(2);
    expect(verified.publicBlock.GO_BP).toEqual([{
      pathway: 'GO_BP_VALID', pval: roundProb(0.123456789), padj: roundProb(0.234567891),
      NES: 1.2346, size: 15, leadingEdge: ['Gene1', 'Gene2'],
    }]);
    expect(verified.focalRows).toHaveLength(1);
    expect(verified.outputPaths).toHaveLength(6);
  });

  it.each(['de', 'generator', 'output'] as const)('rejects changed %s bytes', (which) => {
    const f = fixture();
    const path = which === 'de' ? f.dePath : which === 'generator' ? f.generatorPath : f.paths.KEGG;
    writeFileSync(path, `${readFileSync(path, 'utf8')}# tampered\n`);
    expect(f.read).toThrow(/SHA-256 does not match/);
  });

  it('rejects legacy schemas and missing or reordered provenance fields', () => {
    const f = fixture();
    f.provenance.schema_version = '2';
    f.save();
    expect(f.read).toThrow(/stale schema_version/);
    f.provenance.schema_version = '3';
    delete f.provenance.output_hash_policy;
    f.save();
    expect(f.read).toThrow(/provenance keys/);
  });

  it('rejects a species mismatch even when every artifact hash matches', () => {
    const f = fixture();
    f.provenance.target_species = 'Rattus norvegicus';
    f.save();
    expect(f.read).toThrow(/target_species does not match Mus musculus/);
  });

  it('rejects current-looking hashes when row counts or ranking provenance disagree', () => {
    const f = fixture();
    f.provenance.rank_gene_count = '19';
    f.save();
    expect(f.read).toThrow(/rank_gene_count does not match/);
    f.provenance.rank_gene_count = '20';
    f.provenance.go_bp_result_rows = '1';
    f.save();
    expect(f.read).toThrow(/result row count does not match/);
  });

  it('rejects an omitted focal result even when its updated hash and row count agree', () => {
    const f = fixture();
    writeFileSync(f.paths.focal, tsv(FGSEA_FOCAL_SCHEMA, []));
    f.provenance.focal_result_rows = '0';
    f.provenance.focal_result_sha256 = hash(f.paths.focal);
    f.save();
    expect(f.read).toThrow(/focal pathway selection is incomplete/);
  });

  it('rejects focal statistics that differ from full Reactome despite a valid hash', () => {
    const f = fixture();
    writeFileSync(f.paths.focal, readFileSync(f.paths.focal, 'utf8').replace('1.2345678', '2.2345678'));
    f.provenance.focal_result_sha256 = hash(f.paths.focal);
    f.save();
    expect(f.read).toThrow(/ordered full Reactome subset/);
  });
});

describe('resolveConfiguredFgseaSpecies', () => {
  it('uses the exact config id and preserves configured species projections', () => {
    const f = fixture();
    const configPath = join(f.dir, 'datasets.tsv');
    writeFileSync(configPath, 'id\torganism\nGSE_TEST\tMus musculus\nGSE_TEST\tMus musculus\n');
    const projected = join(f.dir, 'GSE_TEST_mmul_aging');
    mkdirSync(projected);
    const dePath = join(projected, 'GSE_TEST_DE.tsv');
    writeFileSync(dePath, readFileSync(f.dePath));
    expect(resolveConfiguredFgseaSpecies(dePath, { configPath })).toBe('Mus musculus');
  });

  it('falls back to the canonical directory code for an unconfigured contrast, not its parent config id', () => {
    const f = fixture();
    const configPath = join(f.dir, 'datasets.tsv');
    writeFileSync(configPath, 'id\torganism\nGSE_TEST\tRattus norvegicus\n');
    const older = join(f.dir, 'GSE_TEST_mmus_pomc');
    mkdirSync(older);
    const dePath = join(older, 'GSE_TEST_dietP0_DE.tsv');
    writeFileSync(dePath, readFileSync(f.dePath));
    expect(resolveConfiguredFgseaSpecies(dePath, { configPath })).toBe('Mus musculus');
  });

  it('refuses unresolved or ambiguous configuration without a canonical fallback', () => {
    const f = fixture();
    const configPath = join(f.dir, 'datasets.tsv');
    writeFileSync(configPath, 'id\torganism\nGSE_TEST\tMus musculus\nGSE_TEST\tRattus norvegicus\n');
    expect(() => resolveConfiguredFgseaSpecies(f.dePath, { configPath })).toThrow(/not uniquely configured/);
  });
});
