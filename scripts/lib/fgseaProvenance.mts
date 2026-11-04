import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbName, PathwayDatabase } from '../../src/types';
import { slimPathwayBlock } from './bundleSlim.mjs';

export const FGSEA_DATABASES = ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'] as const;
export const FGSEA_FULL_SCHEMA = ['pathway', 'pval', 'padj', 'NES', 'size', 'leadingEdge'] as const;
export const FGSEA_FOCAL_SCHEMA = ['pathway', 'pval', 'padj', 'log2err', 'ES', 'NES', 'size', 'leadingEdge', 'dataset'] as const;
const PROVENANCE_DATABASES = ['HALLMARK', 'KEGG', 'GO_BP', 'REACTOME'] as const;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Generators whose schema-3 output is accepted: the original producer and its
 * R 4.6.0 regeneration successor (2026-09-25), which writes the same schema and
 * policy. The recorded generator_sha256 is checked against the file it names.
 */
const ACCEPTED_GENERATORS = new Set(['scripts/run_mouse_fgsea.R', 'scripts/regen-r460/run_fgsea_r460.R']);
const DEFAULT_CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'geo_replication/config/datasets.tsv');

const POLICY = {
  schema_version: '3',
  msigdb_authority: 'HS',
  rank_statistic: 'DE.stat',
  tie_seed: '42',
  fgsea_seed: '42',
  seed_policy: 'tie seed once; FGSEA seed reset before each collection',
  tie_jitter: 'runif(0,1e-7) before descending sort',
  ortholog_cache_policy: 'clear target-species msigdbr ortholog cache before every collection fetch',
  output_hash_policy: 'SHA-256 of exact published TSV bytes',
  min_pathway_size: '15',
  max_pathway_size: '500',
} as const;

const PROVENANCE_KEYS = [
  'schema_version', 'generator', 'generator_sha256', 'r_version', 'fgsea_version',
  'msigdbr_version', 'babelgene_version', 'msigdb_authority', 'msigdb_db_version',
  'target_species', 'de_sha256', 'rank_gene_count', 'rank_statistic', 'tie_seed',
  'fgsea_seed', 'seed_policy', 'tie_jitter', 'ortholog_cache_policy', 'output_hash_policy',
  'min_pathway_size', 'max_pathway_size',
  ...PROVENANCE_DATABASES.flatMap((db) => [
    'source_collection', 'source_subcollection', 'pathway_count', 'membership_sha256',
    'result_rows', 'result_sha256',
  ].map((suffix) => `${db.toLowerCase()}_${suffix}`)),
  'focal_result_rows', 'focal_result_sha256',
];

export type FgseaRawRow = Record<string, string>;

/** Strict generated-TSV parser, also usable for historical FGSEA comparisons. */
export function parseFgseaTable(
  text: string,
  label: string,
  schema: readonly string[] = FGSEA_FULL_SCHEMA,
): FgseaRawRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines[lines.length - 1] === '') lines.pop();
  const header = (lines.shift() ?? '').split('\t');
  if (header.length !== schema.length || header.some((cell, i) => cell !== schema[i])) {
    throw new Error(`${label}: expected TSV schema ${schema.join(', ')}`);
  }
  return lines.map((line, index) => {
    const cells = line.split('\t');
    if (cells.length !== schema.length) {
      throw new Error(`${label}: row ${index + 2} has ${cells.length} cells, expected ${schema.length}`);
    }
    return Object.fromEntries(schema.map((key, i) => [key, cells[i]]));
  });
}

/** Match run_mouse_fgsea.R's configuredOrganism, including projected species. */
export function resolveConfiguredFgseaSpecies(
  dePath: string,
  options: { configPath?: string } = {},
): string {
  const prefix = basename(dePath).replace(/_DE\.tsv$/, '');
  const configPath = options.configPath ?? DEFAULT_CONFIG;
  const text = readFileSync(configPath, 'utf8');
  const schema = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split('\t');
  if (!schema.includes('id') || !schema.includes('organism')) {
    throw new Error(`${configPath}: species configuration requires id and organism`);
  }
  const configured = [...new Set(parseFgseaTable(text, configPath, schema)
    .filter((row) => row.id === prefix && row.organism && row.organism !== 'NA')
    .map((row) => row.organism))];
  if (configured.length === 1) return configured[0];
  const codeMap: Record<string, string> = {
    mmus: 'Mus musculus', rnor: 'Rattus norvegicus', hsap: 'Homo sapiens',
    btaur: 'Bos taurus', drer: 'Danio rerio', ggal: 'Gallus gallus',
    sscro: 'Sus scrofa', mmul: 'Macaca mulatta',
  };
  const normalized = realpathSync(dePath).replace(/\\/g, '/').toLowerCase();
  const matched = Object.keys(codeMap).filter((code) => normalized.includes(`_${code}_`));
  if (matched.length === 1) return codeMap[matched[0]];
  throw new Error(`${dePath}: organism is not uniquely configured and has no unique canonical directory-code fallback`);
}

const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const missingNumber = (value: string): boolean => value === '' || value === 'NA' || value === 'NaN';
const numberCell = (value: string): number => missingNumber(value) ? Number.NaN : Number(value);

function assertHash(path: string, expected: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(expected) || hashFile(path) !== expected) {
    throw new Error(`${label}: SHA-256 does not match schema-3 provenance`);
  }
}

function integerValue(value: string, label: string, minimum = 0): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label}: expected integer >= ${minimum}`);
  }
  return parsed;
}

function assertUniquePathways(rows: FgseaRawRow[], label: string): void {
  const names = rows.map((row) => row.pathway);
  if (names.some((name) => !name || name === 'NA') || new Set(names).size !== names.length) {
    throw new Error(`${label}: pathway identities are missing or duplicated`);
  }
}

export interface VerifiedFgseaSet {
  prefix: string;
  dePath: string;
  provenancePath: string;
  provenance: Record<string, string>;
  rawRows: Record<DbName, FgseaRawRow[]>;
  focalRows: FgseaRawRow[];
  publicBlock: PathwayDatabase;
  outputPaths: string[];
}

/**
 * Accept only a complete schema-3 generation tied to the current DE and R
 * generator. Membership hashes and package/database versions remain available
 * to callers; rebuilding the gene-set membership itself is the R gate's job.
 */
export function readVerifiedFgseaSet(
  dePath: string,
  options: { generatorPath?: string; expectedSpecies?: string } = {},
): VerifiedFgseaSet {
  const absoluteDePath = resolve(dePath);
  if (!absoluteDePath.endsWith('_DE.tsv')) throw new Error(`${dePath}: expected a canonical _DE.tsv path`);
  const prefix = basename(absoluteDePath).replace(/_DE\.tsv$/, '');
  const directory = dirname(absoluteDePath);
  const provenancePath = resolve(directory, `${prefix}_FGSEA_provenance.tsv`);
  const provenanceRows = parseFgseaTable(readFileSync(provenancePath, 'utf8'), provenancePath, ['key', 'value']);
  if (provenanceRows.length !== PROVENANCE_KEYS.length
    || provenanceRows.some((row, i) => row.key !== PROVENANCE_KEYS[i] || !row.value)) {
    throw new Error(`${provenancePath}: schema-3 provenance keys are missing, duplicated, out of order, or empty`);
  }
  const provenance = Object.fromEntries(provenanceRows.map((row) => [row.key, row.value]));
  for (const [key, value] of Object.entries(POLICY)) {
    if (provenance[key] !== value) throw new Error(`${provenancePath}: stale ${key}; expected ${value}`);
  }
  if (!ACCEPTED_GENERATORS.has(provenance.generator)) {
    throw new Error(`${provenancePath}: stale generator; expected one of ${[...ACCEPTED_GENERATORS].join(', ')}`);
  }
  if (options.expectedSpecies && provenance.target_species !== options.expectedSpecies) {
    throw new Error(`${provenancePath}: target_species does not match ${options.expectedSpecies}`);
  }
  assertHash(options.generatorPath ?? resolve(REPO, provenance.generator), provenance.generator_sha256, `${prefix} generator`);
  assertHash(absoluteDePath, provenance.de_sha256, `${prefix} DE input`);

  const deText = readFileSync(absoluteDePath, 'utf8');
  const deSchema = deText.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split('\t');
  if (!deSchema.includes('symbol') || !deSchema.includes('stat')) {
    throw new Error(`${absoluteDePath}: ranked DE input requires symbol and stat`);
  }
  const rankGenes = new Set(parseFgseaTable(deText, absoluteDePath, deSchema)
    .filter((row) => row.symbol && row.symbol !== 'NA' && Number.isFinite(numberCell(row.stat)))
    .map((row) => row.symbol));
  if (integerValue(provenance.rank_gene_count, `${prefix} rank_gene_count`, 15) !== rankGenes.size) {
    throw new Error(`${provenancePath}: rank_gene_count does not match the DE input`);
  }

  const rawRows = {} as Record<DbName, FgseaRawRow[]>;
  const publicBlock: PathwayDatabase = {};
  const outputPaths: string[] = [];
  for (const db of FGSEA_DATABASES) {
    const key = db.toLowerCase();
    const path = resolve(directory, `${prefix}_FGSEA_${db}.tsv`);
    assertHash(path, provenance[`${key}_result_sha256`], `${prefix} ${db} output`);
    const rows = parseFgseaTable(readFileSync(path, 'utf8'), path);
    assertUniquePathways(rows, path);
    if (integerValue(provenance[`${key}_result_rows`], `${prefix} ${db} result_rows`, 1) !== rows.length) {
      throw new Error(`${path}: result row count does not match provenance`);
    }
    if (integerValue(provenance[`${key}_pathway_count`], `${prefix} ${db} pathway_count`, 1) < rows.length
      || !/^[a-f0-9]{64}$/.test(provenance[`${key}_membership_sha256`])) {
      throw new Error(`${provenancePath}: invalid ${db} membership provenance`);
    }
    const expectedSource = db === 'HALLMARK' ? ['H', '(all)']
      : db === 'GO_BP' ? ['C5', 'GO:BP'] : ['C2', db === 'REACTOME' ? 'CP:REACTOME' : null];
    if (provenance[`${key}_source_collection`] !== expectedSource[0]
      || (expectedSource[1] && provenance[`${key}_source_subcollection`] !== expectedSource[1])
      || (db === 'KEGG' && !['CP:KEGG_LEGACY', 'CP:KEGG', 'CP:KEGG_MEDICUS'].includes(provenance[`${key}_source_subcollection`]))) {
      throw new Error(`${provenancePath}: invalid ${db} source collection`);
    }
    rawRows[db] = rows;
    publicBlock[db] = rows.map((row) => {
      for (const field of ['pval', 'padj', 'NES']) {
        const value = numberCell(row[field]);
        if (!missingNumber(row[field]) && (!Number.isFinite(value)
          || (field !== 'NES' && (value < 0 || value > 1)))) {
          throw new Error(`${path}/${row.pathway}: invalid ${field}`);
        }
      }
      const size = integerValue(row.size, `${path}/${row.pathway} size`, 15);
      if (size > 500) throw new Error(`${path}/${row.pathway}: size exceeds 500`);
      const nes = numberCell(row.NES);
      return {
        pathway: row.pathway,
        pval: numberCell(row.pval),
        padj: numberCell(row.padj),
        NES: Number.isFinite(nes) ? +nes.toFixed(4) : nes,
        size,
        leadingEdge: row.leadingEdge.split(';').filter(Boolean),
      };
    }).filter((row) => Number.isFinite(row.pval) && Number.isFinite(row.padj) && Number.isFinite(row.NES));
    outputPaths.push(path);
  }

  const focalPath = resolve(directory, `${prefix}_fgsea.tsv`);
  assertHash(focalPath, provenance.focal_result_sha256, `${prefix} focal output`);
  const focalRows = parseFgseaTable(readFileSync(focalPath, 'utf8'), focalPath, FGSEA_FOCAL_SCHEMA);
  assertUniquePathways(focalRows, focalPath);
  if (integerValue(provenance.focal_result_rows, `${prefix} focal_result_rows`) !== focalRows.length) {
    throw new Error(`${focalPath}: result row count does not match provenance`);
  }
  const expectedFocalNames = rawRows.REACTOME
    .filter((row) => /IGF_TRANSPORT_AND_UPTAKE|SIGNALING_BY_TYPE_1.*IGF1R|TYPE_1_INSULIN_LIKE_GROWTH_FACTOR_1_RECEPTOR/.test(row.pathway))
    .map((row) => row.pathway);
  if (expectedFocalNames.length !== focalRows.length
    || focalRows.some((row, index) => row.pathway !== expectedFocalNames[index])) {
    throw new Error(`${focalPath}: focal pathway selection is incomplete or changed`);
  }
  let previousIndex = -1;
  for (const focal of focalRows) {
    const index = rawRows.REACTOME.findIndex((row) => row.pathway === focal.pathway);
    if (index <= previousIndex || focal.dataset !== prefix
      || FGSEA_FULL_SCHEMA.some((key) => focal[key] !== rawRows.REACTOME[index]?.[key])) {
      throw new Error(`${focalPath}: focal rows do not exactly match the ordered full Reactome subset`);
    }
    previousIndex = index;
  }
  slimPathwayBlock(publicBlock as Record<string, unknown>);
  return {
    prefix, dePath: absoluteDePath, provenancePath, provenance, rawRows, focalRows, publicBlock,
    outputPaths: [...outputPaths, focalPath, provenancePath],
  };
}
