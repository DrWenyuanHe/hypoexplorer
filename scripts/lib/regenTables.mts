// Readers for the symbol-keyed analysis tables of the R 4.6.0 regeneration
// (2026-09-25; scripts/regenerate_bulk_de.R, scripts/regen-r460/, de_common.R).
//
// What changed upstream, and why the builders read through here:
//
//   * Duplicate symbols are aggregated BEFORE testing (counts rowsum, log
//     matrices avereps, linear matrices linear sum), so every published table —
//     `<stem>_DE.tsv`, `<stem>_SE.tsv`, `<stem>_CPM_TMM.tsv.gz`,
//     `<stem>_expression.tsv.gz` — already has exactly one row per public
//     symbol. The builders' old "dedupe keep lowest p" and "sum expression by
//     symbol" steps are replaced by the uniqueness assertions below: a duplicate
//     is now an upstream bug, not something to paper over.
//   * The DE `id` column is the symbol. Raw feature ids live only in the
//     `<stem>_feature_map.tsv.gz` sidecar; features without a public symbol are
//     fitted but not published (status != mapped), so they are hidden here.
//   * Count datasets publish `<stem>_CPM_TMM.tsv.gz`: counts / (filtered library
//     size x the DE fit's own TMM factor) x 1e6. The browser shows it as
//     CPM_TMM_UNIT. Matrix-input datasets publish `<stem>_expression.tsv.gz` on
//     the deposited scale, and keep their deposited unit.
//
// The symbols were produced by an R mirror of normalizeGene, so a published
// symbol must be a fixed point of it; anything else throws.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { normalizeGene } from './geneSymbol.mjs';
import { deStats, indexDeHeader, numCell } from './deTable.mjs';

export { CPM_TMM_UNIT } from '../../src/data/expressionUnits';

export function readText(path: string): string {
  const buf = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
}

/** Tab-separated table with a header; strips one layer of surrounding quotes. */
export function readTsv(path: string): { header: string[]; rows: string[][] } {
  const lines = readText(path).split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) throw new Error(`${path}: empty table`);
  const split = (line: string) => line.split('\t').map((f) =>
    f.length > 1 && f.charCodeAt(0) === 34 && f.charCodeAt(f.length - 1) === 34 ? f.slice(1, -1) : f);
  const header = split(lines[0]);
  const rows = lines.slice(1).map(split);
  for (const [i, row] of rows.entries()) {
    if (row.length !== header.length) {
      throw new Error(`${path}: row ${i + 2} has ${row.length} fields, header has ${header.length}`);
    }
  }
  return { header, rows };
}

/** Throw on the first key seen twice. */
export function assertUniqueKeys(keys: Iterable<string>, label: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`${label}: "${key}" appears more than once; the regenerated tables are unique `
        + 'per public symbol (aggregation happens before testing), so a duplicate is an upstream bug');
    }
    seen.add(key);
  }
}

/**
 * A published symbol, checked: non-empty and a fixed point of normalizeGene.
 * Returns null for a key normalizeGene hides (an unmapped raw id that reached a
 * matrix), throws when normalizeGene would RENAME it.
 */
export function publicSymbol(key: string, label: string): string | null {
  const gene = normalizeGene(key);
  if (gene === null) return null;
  if (gene !== key) {
    throw new Error(`${label}: "${key}" is not a public symbol (normalizeGene gives "${gene}")`);
  }
  return gene;
}

export interface SymbolDeRow {
  gene: string;
  logFC: number;
  PValue: number;
  FDR: number;
  stat: number;
  method: string;
}

/**
 * A regenerated `<stem>_DE.tsv`: one row per public symbol, `id` === `symbol`.
 * Rows whose symbol normalizeGene hides are dropped (none are expected; the R
 * side excludes unmapped features from published tables).
 */
export function readSymbolDe(path: string, label = path): SymbolDeRow[] {
  const { header, rows } = readTsv(path);
  const di = indexDeHeader(header, label, ['id']);
  const out: SymbolDeRow[] = [];
  for (const row of rows) {
    const id = row[di.id];
    const symbol = row[di.symbol];
    if (id !== symbol) {
      throw new Error(`${label}: id "${id}" differs from symbol "${symbol}"; the regenerated DE tables are `
        + 'keyed by symbol (raw ids live in the feature map)');
    }
    const gene = publicSymbol(symbol, label);
    if (!gene) continue;
    const stats = deStats(row, di);
    out.push({ gene, ...stats });
  }
  assertUniqueKeys(out.map((row) => row.gene), label);
  return out;
}

/** `<stem>_SE.tsv` (id = symbol, se), unique; non-positive/NA SEs are omitted. */
export function readSymbolSe(path: string, label = path): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(path)) return out;
  const { header, rows } = readTsv(path);
  const idx = header.indexOf('id');
  const sei = header.indexOf('se');
  if (idx < 0 || sei < 0) throw new Error(`${label}: SE table needs id and se columns (${header.join(', ')})`);
  assertUniqueKeys(rows.map((row) => row[idx]), label);
  for (const row of rows) {
    const value = numCell(row[sei]);
    if (Number.isFinite(value) && value > 0) out.set(row[idx], value);
  }
  return out;
}

/**
 * A symbol x sample matrix (`<stem>_CPM_TMM.tsv.gz` or `<stem>_expression.tsv.gz`):
 * header `gene_id` + sample ids. Returns values in `sampleOrder`, keyed by the
 * public symbol; every requested sample must be a column; rows must be unique.
 */
export function readSymbolMatrix(
  path: string,
  sampleOrder: readonly string[],
  label = path,
): Map<string, number[]> {
  const { header, rows } = readTsv(path);
  const col = new Map(header.map((name, i) => [name, i]));
  const missing = sampleOrder.filter((sample) => !col.has(sample));
  if (missing.length) {
    throw new Error(`${label}: sample(s) not in the matrix header: ${missing.slice(0, 5).join(', ')}`);
  }
  assertUniqueKeys(sampleOrder, `${label} sample order`);
  assertUniqueKeys(rows.map((row) => row[0]), label);
  const out = new Map<string, number[]>();
  for (const row of rows) {
    const gene = publicSymbol(row[0], label);
    if (!gene) continue;
    out.set(gene, sampleOrder.map((sample) => {
      const value = numCell(row[col.get(sample)!]);
      if (!Number.isFinite(value)) throw new Error(`${label}: non-numeric value for ${row[0]}/${sample}`);
      return value;
    }));
  }
  return out;
}

export type ExpressionSource =
  | { kind: 'cpm_tmm'; path: string }
  | { kind: 'matrix'; path: string };

/**
 * Where a regenerated dataset's per-sample values live: the TMM CPM for a count
 * input, the deposited-scale matrix otherwise. Throws when the expected file is
 * absent, so a stale processed/ directory cannot fall back to old values.
 */
export function expressionSource(processedDir: string, stem: string, inputKind: string): ExpressionSource {
  const kind = inputKind === 'matrix' ? 'matrix' : 'cpm_tmm';
  const path = resolve(processedDir, kind === 'matrix' ? `${stem}_expression.tsv.gz` : `${stem}_CPM_TMM.tsv.gz`);
  if (!existsSync(path)) throw new Error(`${stem}: missing ${path} (input_kind=${inputKind})`);
  return { kind, path };
}

/** `<stem>_feature_map.tsv.gz`: raw feature id -> symbol, for mapped features only. */
export function readFeatureMap(path: string, label = path): Map<string, string> {
  const { header, rows } = readTsv(path);
  const fi = header.indexOf('feature_id');
  const si = header.indexOf('symbol');
  const st = header.indexOf('status');
  if (fi < 0 || si < 0 || st < 0) throw new Error(`${label}: feature map needs feature_id, symbol, status`);
  assertUniqueKeys(rows.map((row) => row[fi]), label);
  const out = new Map<string, string>();
  for (const row of rows) {
    if (row[st] !== 'mapped') continue;
    const gene = publicSymbol(row[si], label);
    if (gene) out.set(row[fi], gene);
  }
  return out;
}
