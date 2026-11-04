/**
 * Quantify comparisons against author-deposited DE outputs for the subset of
 * datasets where the deposited result represents the explorer's exact contrast
 * (or, for GSE294478, can be reconstructed exactly from adjacent contrasts).
 *
 * This is deliberately separate from the corpus-wide processed-input audit:
 * absence from this file means no structured comparison is recorded here.
 * It does not establish unavailable author data or a failed validation;
 * explicit availability and review state live in the verification ledger.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { carriedForwardWarning, missingLocalInputs } from './lib/authorValidationAudit.mjs';
import { matchesReviewedTextSha256 } from './lib/reviewedTextEvidence.mjs';
import { recoverSourceSymbols, requireUniqueKeys } from './lib/authorSourceRecovery.mjs';
import {
  HISTORICAL_PINS, isRecordedCurrentOutput, readSealedHistoricalInput, readSupersededInput, supersession, supersessionNames,
} from './lib/historicalEvidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = resolve(ROOT, 'geo_replication');
const OUT_JSON = resolve(ROOT, 'data', 'author-validation', 'direct-comparisons.generated.json');
const OUT_TSV = resolve(ROOT, 'data', 'author-validation', 'direct-comparisons.generated.tsv');
const CHECK = process.argv.includes('--check');

type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

interface MineRow {
  key: string;
  logFC: number;
  padj: number | null;
}

interface AuthorRow {
  key: string;
  logFC: number;
  padj: number | null;
}

interface ReferenceFile {
  path: string;
  sourceUrl: string;
  bytes: number;
  sha256: string;
}

interface ComparisonMetrics {
  localGenes: number;
  authorGenes: number;
  sharedGenes: number;
  authorCoverage: number;
  localCoverage: number;
  pearsonLogFC: number;
  spearmanLogFC: number;
  medianAbsLogFCDelta: number;
  rootMeanSquareLogFCDelta: number;
  effectScaleRatio: number | null;
  effectScaleGenes: number;
  signComparableGenes: number;
  signConcordance: number;
  strongEffectGenes: number;
  strongEffectSignConcordance: number | null;
  authorSignificantGenes: number | null;
  localSignificantGenes: number;
  significantInBoth: number | null;
  significantSetJaccard: number | null;
  authorSignificantSignConcordance: number | null;
  oppositeDirectionAuthorSignificant: number | null;
  allAuthorSignificantGenes?: number;
  allLocalSignificantGenes?: number;
  allSignificantInBoth?: number;
  allSignificantSetJaccard?: number;
  expressedGeneCount?: number;
  expressedPearsonLogFC?: number;
  expressedMedianAbsLogFCDelta?: number;
  expressedSignConcordance?: number;
  expressedStrongEffectGenes?: number;
  expressedStrongEffectSignConcordance?: number | null;
  paperFilteredAuthorGenes?: number;
  paperFilteredLocalGenes?: number;
  paperFilteredInBoth?: number;
  paperFilteredSetJaccard?: number;
  paperFilteredDirectionConcordance?: number | null;
  authorPaperFilteredGenesMeetingLocalQAndEffect?: number;
}

interface Comparison {
  datasetId: string;
  accession: string;
  contrast: string;
  comparisonType: 'direct_author_result' | 'reconstructed_author_effect';
  interpretation:
    | 'effect_and_direction_match'
    | 'effect_match_inference_differs'
    | 'effect_disagreement_review'
    | 'effects_compared'
    | 'reconstructed_effect_match'
    | 'rank_direction_match_magnitude_review';
  localMethod: string;
  authorMethod: string;
  orientation: string;
  metrics: ComparisonMetrics;
  references: ReferenceFile[];
  paperFilterDefinition?: string;
  expressedSubsetDefinition?: string;
  note: string;
}

function text(path: string): string {
  const bytes = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

function readDelimited(path: string, delimiter: ',' | '\t'): Row[] {
  return parseDelimitedText(text(path), delimiter);
}

function parseDelimitedText(content: string, delimiter: ',' | '\t'): Row[] {
  const lines = content.replace(/^\uFEFF/, '').trim().split(/\r\n|\n|\r/);
  const header = parseDelimitedLine(lines[0], delimiter);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

function readCountsWithBlankRowHeader(path: string): Row[] {
  const lines = text(path).replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const header = parseDelimitedLine(lines[0], '\t');
  if (header[0] !== '') throw new Error(`${path}: expected an unnamed leading row-number column`);
  header[0] = '__row_number';
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseDelimitedLine(line, '\t');
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

function readWorkbook(path: string): Row[] {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
}

function readWorkbookSheet(path: string, sheetName: string): Row[] {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`${path}: missing workbook sheet ${sheetName}`);
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true });
}

function readWorkbookSheetFromHeader(path: string, sheetName: string, headerRow: number): Row[] {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`${path}: missing workbook sheet ${sheetName}`);
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true, range: headerRow - 1 });
}

function number(value: Cell): number {
  if (value == null || value === '' || value === 'NA' || value === 'NaN') return Number.NaN;
  return Number(value);
}

function nullableNumber(value: Cell): number | null {
  const parsed = number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localRows(path: string): MineRow[] {
  return readDelimited(path, '\t').map((row) => ({
    key: String(row.id),
    logFC: number(row.logFC),
    padj: nullableNumber(row.padj),
  })).filter((row) => row.key && Number.isFinite(row.logFC));
}

function localRowsByColumn(path: string, keyColumn: string): MineRow[] {
  return readDelimited(path, '\t').map((row) => ({
    key: String(row[keyColumn] ?? ''),
    logFC: number(row.logFC),
    padj: nullableNumber(row.padj),
  })).filter((row) => row.key && Number.isFinite(row.logFC));
}

/**
 * The R 4.6.0 outputs key every published row by its public symbol and sum the
 * features that share one before the fit (regeneration README, rule A2).
 * Comparisons reviewed on per-feature author identifiers keep that identity: a
 * published symbol backed by exactly one input feature is keyed by that feature
 * ID from the output's own feature map. A symbol summed over several features has
 * no per-feature estimate, so it stays keyed by its symbol and counts as an
 * unpaired local gene instead of being assigned to one of the author's rows.
 */
function featureMapPath(dePath: string): string {
  const path = dePath.replace(/_DE\.tsv$/, '_feature_map.tsv.gz');
  if (path === dePath || !existsSync(path)) throw new Error(`${relative(ROOT, dePath)}: no feature map beside the regenerated output`);
  return path;
}

function mappedFeatures(dePath: string): Map<string, string[]> {
  const bySymbol = new Map<string, string[]>();
  for (const row of readDelimited(featureMapPath(dePath), '\t')) {
    if (row.status !== 'mapped') continue;
    const symbol = String(row.symbol);
    bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), String(row.feature_id)]);
  }
  return bySymbol;
}

function symbolsWithSeveralFeatures(dePath: string): Set<string> {
  return new Set([...mappedFeatures(dePath)].filter(([, ids]) => ids.length > 1).map(([symbol]) => symbol));
}

function featureKeyedRows(dePath: string): MineRow[] {
  const features = mappedFeatures(dePath);
  return localRows(dePath).map((row) => {
    const ids = features.get(row.key);
    if (!ids) throw new Error(`${relative(ROOT, dePath)}: published symbol ${row.key} is absent from its feature map`);
    return ids.length === 1 ? { ...row, key: ids[0] } : row;
  });
}

/**
 * Rows of a regenerated output keyed by the IDs of the output it replaced, for an
 * author mapping that was prepared against those IDs. Each earlier ID resolves to
 * its input feature (the ID itself, or its earlier symbol when the input was keyed
 * by symbol) and then through the new feature map. A new row claimed by several
 * earlier IDs, or backed by several features, stays keyed by its symbol.
 */
function priorIdKeyedRows(dePath: string): MineRow[] {
  const path = relative(ROOT, dePath).replaceAll('\\', '/');
  const row = supersession(ROOT).records.get(path);
  if (!row?.newSha256) throw new Error(`${path}: not an output replaced by the R 4.6.0 regeneration`);
  const current = readFileSync(dePath);
  if (!isRecordedCurrentOutput(ROOT, path, current, row)) throw new Error(`${path}: current bytes are not the recorded R 4.6.0 regeneration or a verified successor`);
  const features = mappedFeatures(dePath);
  const featureSymbol = new Map([...features].flatMap(([symbol, ids]) => ids.map((id) => [id, symbol] as const)));
  const mine = localRows(dePath);
  const bySymbol = new Map(mine.map((entry) => [entry.key, entry]));
  const earlier = readSupersededInput(ROOT, path, row.oldSha256, { current }).toString('utf8');
  const claims = new Map<string, string[]>();
  for (const old of parseDelimitedText(earlier, '\t')) {
    const id = String(old.id);
    const feature = featureSymbol.has(id) ? id : featureSymbol.has(String(old.symbol)) ? String(old.symbol) : null;
    const symbol = feature == null ? undefined : featureSymbol.get(feature);
    if (symbol == null || features.get(symbol)!.length !== 1 || !bySymbol.has(symbol)) continue;
    claims.set(symbol, [...(claims.get(symbol) ?? []), id]);
  }
  return mine.map((entry) => {
    const ids = claims.get(entry.key);
    return ids?.length === 1 ? { ...entry, key: ids[0] } : entry;
  });
}

function mapping(path: string, source: string, output: string): Map<string, string> {
  return new Map(readDelimited(path, '\t').map((row) => [String(row[source]), String(row[output])]));
}

function authorRows(rows: Row[], key: string, effect: string, padj?: string): AuthorRow[] {
  return rows.map((row) => ({
    key: String(row[key] ?? ''),
    logFC: number(row[effect]),
    padj: padj ? nullableNumber(row[padj]) : null,
  })).filter((row) => row.key && Number.isFinite(row.logFC));
}

function signedRatioAuthorRows(
  rows: Row[], key: string, signedFoldChange: string, padj?: string,
): AuthorRow[] {
  return rows.map((row) => {
    const foldChange = number(row[signedFoldChange]);
    return {
      key: String(row[key] ?? ''),
      logFC: Number.isFinite(foldChange) && Math.abs(foldChange) >= 1
        ? Math.sign(foldChange) * Math.log2(Math.abs(foldChange))
        : Number.NaN,
      padj: padj ? nullableNumber(row[padj]) : null,
    };
  }).filter((row) => row.key && Number.isFinite(row.logFC));
}

function negativeTenLogAdjustedAuthorRows(
  rows: Row[], key: string, effect: string, negativeTenLogAdjustedP: string,
): AuthorRow[] {
  return rows.map((row) => {
    const transformed = number(row[negativeTenLogAdjustedP]);
    return {
      key: String(row[key] ?? ''),
      logFC: number(row[effect]),
      padj: Number.isFinite(transformed) ? 10 ** (-transformed / 10) : null,
    };
  }).filter((row) => row.key && Number.isFinite(row.logFC));
}

function trimmedAuthorRows(rows: Row[], key: string, effect: string, padj?: string): AuthorRow[] {
  return authorRows(rows, key, effect, padj)
    .map((row) => ({ ...row, key: row.key.trim() }))
    .filter((row) => row.key);
}

function clcAuthorRows(rows: Row[]): AuthorRow[] {
  return rows.map((row) => {
    const geneId = Object.entries(row).find(([name]) => name.endsWith(' - Gene ID'))?.[1];
    return {
      key: String(geneId ?? ''),
      logFC: number(row['bROC Analysis Results - Fold Change']),
      // CLC reports confidence rather than a multiple-testing-adjusted p-value.
      // Never encode 1-confidence as FDR: the shared UI labels these fields as
      // adjusted P statistics. The bROC selected count is reported separately.
      padj: null,
    };
  }).filter((row) => row.key && Number.isFinite(row.logFC));
}

function remap(rows: AuthorRow[], ids: Map<string, string>): AuthorRow[] {
  return rows.map((row) => ({ ...row, key: ids.get(row.key) ?? '' })).filter((row) => row.key);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function reference(path: string, sourceUrl: string): ReferenceFile {
  return {
    path: relative(ROOT, path).replaceAll('\\', '/'),
    sourceUrl,
    bytes: statSync(path).size,
    sha256: sha256(path),
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let numerator = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    numerator += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return numerator / Math.sqrt(da * db);
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && order[end].value === order[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[order[index].index] = rank;
    start = end;
  }
  return result;
}

function round(value: number | null, digits = 8): number | null {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function metrics(mine: MineRow[], author: AuthorRow[]): ComparisonMetrics {
  const mineByKey = new Map(mine.map((row) => [row.key, row]));
  const authorByKey = new Map(author.map((row) => [row.key, row]));
  const shared = [...authorByKey.values()]
    .map((row) => ({ mine: mineByKey.get(row.key), author: row }))
    .filter((row): row is { mine: MineRow; author: AuthorRow } => Boolean(row.mine));
  if (shared.length < 3) throw new Error(`only ${shared.length} shared author-result rows`);
  const localEffects = shared.map((row) => row.mine.logFC);
  const authorEffects = shared.map((row) => row.author.logFC);
  const absDelta = shared.map((row) => Math.abs(row.mine.logFC - row.author.logFC)).sort((a, b) => a - b);
  const median = absDelta.length % 2
    ? absDelta[(absDelta.length - 1) / 2]
    : (absDelta[absDelta.length / 2 - 1] + absDelta[absDelta.length / 2]) / 2;
  const signComparable = shared.filter((row) => row.mine.logFC !== 0 && row.author.logFC !== 0);
  const strong = shared.filter((row) => Math.abs(row.author.logFC) >= 0.5);
  const authorHasFdr = author.some((row) => row.padj != null);
  const authorSig = authorHasFdr ? shared.filter((row) => (row.author.padj ?? 1) < 0.05) : [];
  const localSig = shared.filter((row) => (row.mine.padj ?? 1) < 0.05);
  const bothSig = authorHasFdr
    ? shared.filter((row) => (row.author.padj ?? 1) < 0.05 && (row.mine.padj ?? 1) < 0.05)
    : [];
  const unionSig = authorHasFdr
    ? shared.filter((row) => (row.author.padj ?? 1) < 0.05 || (row.mine.padj ?? 1) < 0.05)
    : [];
  const signRate = (rows: typeof shared): number | null => rows.length
    ? rows.filter((row) => Math.sign(row.mine.logFC) === Math.sign(row.author.logFC)).length / rows.length
    : null;
  return {
    localGenes: mineByKey.size,
    authorGenes: authorByKey.size,
    sharedGenes: shared.length,
    authorCoverage: round(shared.length / authorByKey.size)!,
    localCoverage: round(shared.length / mineByKey.size)!,
    pearsonLogFC: round(pearson(localEffects, authorEffects))!,
    spearmanLogFC: round(pearson(ranks(localEffects), ranks(authorEffects)))!,
    medianAbsLogFCDelta: round(median)!,
    rootMeanSquareLogFCDelta: round(Math.sqrt(mean(shared.map((row) =>
      (row.mine.logFC - row.author.logFC) ** 2))))!,
    // Paired effects only. Correlation cannot detect a systematic rescaling.
    effectScaleRatio: round(Math.sqrt(mean(localEffects.map((value) => value ** 2)))
      / Math.sqrt(mean(authorEffects.map((value) => value ** 2)))),
    effectScaleGenes: shared.length,
    signComparableGenes: signComparable.length,
    signConcordance: round(signRate(signComparable))!,
    strongEffectGenes: strong.length,
    strongEffectSignConcordance: round(signRate(strong)),
    authorSignificantGenes: authorHasFdr ? authorSig.length : null,
    localSignificantGenes: localSig.length,
    significantInBoth: authorHasFdr ? bothSig.length : null,
    significantSetJaccard: authorHasFdr ? round(unionSig.length ? bothSig.length / unionSig.length : 1) : null,
    authorSignificantSignConcordance: authorHasFdr ? round(signRate(authorSig)) : null,
    oppositeDirectionAuthorSignificant: authorHasFdr
      ? authorSig.filter((row) => Math.sign(row.mine.logFC) !== Math.sign(row.author.logFC)).length
      : null,
  };
}

function metricsWithCompleteSignificantSets(mine: MineRow[], author: AuthorRow[]): ComparisonMetrics {
  const comparison = metrics(mine, author);
  const authorSignificant = author.filter((row) => (row.padj ?? 1) < 0.05);
  const localSignificant = mine.filter((row) => (row.padj ?? 1) < 0.05);
  const authorKeys = new Set(authorSignificant.map((row) => row.key));
  const localKeys = new Set(localSignificant.map((row) => row.key));
  const significantInBoth = [...authorKeys].filter((key) => localKeys.has(key)).length;
  const union = new Set([...authorKeys, ...localKeys]);
  return {
    ...comparison,
    authorSignificantGenes: authorSignificant.length,
    localSignificantGenes: localSignificant.length,
    significantInBoth,
    significantSetJaccard: round(union.size ? significantInBoth / union.size : 1),
  };
}

// Reviewed follow-ups retain all effect pairs, but compare FDR calls only where
// both results expose a finite adjusted P. An unavailable test is not negative.
function metricsWithFiniteInference(mine: MineRow[], author: AuthorRow[], ineligible = new Set<string>()): ComparisonMetrics {
  const all = metrics(mine, author);
  const testedAuthor = author.filter(row => row.padj != null && !ineligible.has(row.key));
  const testedIds = new Set(testedAuthor.map(row => row.key));
  const evaluated = metrics(mine.filter(row => row.padj != null && testedIds.has(row.key)), testedAuthor);
  return { ...all, authorSignificantGenes: evaluated.authorSignificantGenes,
    localSignificantGenes: evaluated.localSignificantGenes, significantInBoth: evaluated.significantInBoth,
    significantSetJaccard: evaluated.significantSetJaccard,
    authorSignificantSignConcordance: evaluated.authorSignificantSignConcordance,
    oppositeDirectionAuthorSignificant: evaluated.oppositeDirectionAuthorSignificant };
}

function callRuleMetrics(
  mine: MineRow[],
  author: AuthorRow[],
  localCall: (row: MineRow) => boolean,
  authorCall: (row: AuthorRow) => boolean,
): ComparisonMetrics {
  const mineByKey = new Map(mine.map((row) => [row.key, row]));
  const allAuthorSignificant = author.filter((row) => (row.padj ?? 1) < 0.05);
  const allLocalSignificant = mine.filter((row) => (row.padj ?? 1) < 0.05);
  const allAuthorSignificantKeys = new Set(allAuthorSignificant.map((row) => row.key));
  const allLocalSignificantKeys = new Set(allLocalSignificant.map((row) => row.key));
  const allSignificantInBoth = allAuthorSignificant.filter((row) => allLocalSignificantKeys.has(row.key));
  const allSignificantUnion = new Set([...allAuthorSignificantKeys, ...allLocalSignificantKeys]);
  const authorCalls = author.filter(authorCall);
  const localCalls = mine.filter(localCall);
  const authorCallKeys = new Set(authorCalls.map((row) => row.key));
  const localCallKeys = new Set(localCalls.map((row) => row.key));
  const inBoth = authorCalls.filter((row) => localCallKeys.has(row.key));
  const union = new Set([...authorCallKeys, ...localCallKeys]);
  const directionRate = inBoth.length
    ? inBoth.filter((row) => Math.sign(row.logFC) === Math.sign(mineByKey.get(row.key)?.logFC ?? 0)).length
      / inBoth.length
    : null;
  return {
    ...metrics(mine, author),
    allAuthorSignificantGenes: allAuthorSignificant.length,
    allLocalSignificantGenes: allLocalSignificant.length,
    allSignificantInBoth: allSignificantInBoth.length,
    allSignificantSetJaccard: round(
      allSignificantUnion.size ? allSignificantInBoth.length / allSignificantUnion.size : 1,
    )!,
    paperFilteredAuthorGenes: authorCalls.length,
    paperFilteredLocalGenes: localCalls.length,
    paperFilteredInBoth: inBoth.length,
    paperFilteredSetJaccard: round(union.size ? inBoth.length / union.size : 1)!,
    paperFilteredDirectionConcordance: round(directionRate),
    authorPaperFilteredGenesMeetingLocalQAndEffect: inBoth.length,
  };
}

function quantileType7(values: number[], probability: number): number {
  if (!values.length) throw new Error('cannot take a quantile of an empty array');
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
}

function tmmNormFactors(counts: number[][]): { libSizes: number[]; normFactors: number[] } {
  if (!counts.length || !counts[0].length) throw new Error('TMM requires a non-empty count matrix');
  const sampleCount = counts[0].length;
  if (counts.some((row) => row.length !== sampleCount || row.some((value) => !Number.isFinite(value) || value < 0))) {
    throw new Error('TMM count matrix contains an invalid row');
  }
  const libSizes = Array.from({ length: sampleCount }, (_, sample) =>
    counts.reduce((total, row) => total + row[sample], 0));
  if (libSizes.some((size) => size <= 0)) throw new Error('TMM count matrix contains an empty library');

  // This is edgeR's default TMM reference rule and weighted, doubly trimmed
  // log-ratio calculation. It is kept here so --check can reproduce the local
  // mean-CPM eligibility rule without requiring an R runtime.
  const upperQuartileFactors = Array.from({ length: sampleCount }, (_, sample) =>
    quantileType7(counts.map((row) => row[sample]), 0.75) / libSizes[sample]);
  const reference = quantileType7(upperQuartileFactors, 0.5) < 1e-20
    ? Array.from({ length: sampleCount }, (_, sample) =>
      counts.reduce((total, row) => total + Math.sqrt(row[sample]), 0))
      .reduce((best, value, sample, totals) => value > totals[best] ? sample : best, 0)
    : upperQuartileFactors.reduce((best, value, sample, factors) => {
      const target = mean(factors);
      return Math.abs(value - target) < Math.abs(factors[best] - target) ? sample : best;
    }, 0);

  const rawFactors = Array.from({ length: sampleCount }, (_, sample) => {
    const logRatios: number[] = [];
    const absoluteExpression: number[] = [];
    const variances: number[] = [];
    const observedLibrary = libSizes[sample];
    const referenceLibrary = libSizes[reference];
    for (const row of counts) {
      const observed = row[sample];
      const referenceCount = row[reference];
      if (observed <= 0 || referenceCount <= 0) continue;
      const observedRate = observed / observedLibrary;
      const referenceRate = referenceCount / referenceLibrary;
      const logRatio = Math.log2(observedRate / referenceRate);
      const averageExpression = (Math.log2(observedRate) + Math.log2(referenceRate)) / 2;
      const variance = (observedLibrary - observed) / observedLibrary / observed
        + (referenceLibrary - referenceCount) / referenceLibrary / referenceCount;
      if (Number.isFinite(logRatio) && Number.isFinite(averageExpression) && averageExpression > -1e10) {
        logRatios.push(logRatio);
        absoluteExpression.push(averageExpression);
        variances.push(variance);
      }
    }
    if (!logRatios.length || Math.max(...logRatios.map(Math.abs)) < 1e-6) return 1;
    const logRanks = ranks(logRatios);
    const expressionRanks = ranks(absoluteExpression);
    const count = logRatios.length;
    const lowerLogRank = Math.floor(count * 0.3) + 1;
    const upperLogRank = count + 1 - lowerLogRank;
    const lowerExpressionRank = Math.floor(count * 0.05) + 1;
    const upperExpressionRank = count + 1 - lowerExpressionRank;
    let weightedLogRatio = 0;
    let totalWeight = 0;
    for (let index = 0; index < count; index += 1) {
      if (logRanks[index] < lowerLogRank || logRanks[index] > upperLogRank
        || expressionRanks[index] < lowerExpressionRank || expressionRanks[index] > upperExpressionRank) continue;
      weightedLogRatio += logRatios[index] / variances[index];
      totalWeight += 1 / variances[index];
    }
    return 2 ** (totalWeight ? weightedLogRatio / totalWeight : 0);
  });
  const geometricMean = Math.exp(mean(rawFactors.map(Math.log)));
  return { libSizes, normFactors: rawFactors.map((factor) => factor / geometricMean) };
}

function localMeanCpmEligibleKeys(
  rawPath: string,
  sampleSheetPath: string,
  mine: MineRow[],
  threshold: number,
): Set<string> {
  const modeledKeys = new Set(mine.map((row) => row.key));
  const sampleRows = readDelimited(sampleSheetPath, '\t');
  const samples = sampleRows.map((row) => String(row.sample));
  const groups = sampleRows.map((row) => String(row.group));
  if (!samples.length || groups.some((group) => group !== 'control' && group !== 'case')) {
    throw new Error(`${sampleSheetPath}: invalid sample/group rows`);
  }
  const modeledRaw = readCountsWithBlankRowHeader(rawPath)
    .filter((row) => modeledKeys.has(String(row.symbol)));
  const rawKeys = modeledRaw.map((row) => String(row.symbol));
  if (new Set(rawKeys).size !== modeledKeys.size || rawKeys.length !== modeledKeys.size) {
    throw new Error(`${rawPath}: modeled-gene join is not one-to-one`);
  }
  const counts = modeledRaw.map((row) => samples.map((sample) => number(row[sample])));
  const { libSizes, normFactors } = tmmNormFactors(counts);
  const eligible = new Set<string>();
  for (let gene = 0; gene < counts.length; gene += 1) {
    const groupMeans = ['control', 'case'].map((group) => {
      const indices = groups.flatMap((value, index) => value === group ? [index] : []);
      return mean(indices.map((sample) => counts[gene][sample] * 1e6 / (libSizes[sample] * normFactors[sample])));
    });
    if (Math.max(...groupMeans) > threshold) eligible.add(rawKeys[gene]);
  }
  return eligible;
}

function paperFilteredMetrics(
  mine: MineRow[],
  author: AuthorRow[],
  authorExpressionEligible: Set<string>,
  localExpressionEligible: Set<string>,
): ComparisonMetrics {
  const mineByKey = new Map(mine.map((row) => [row.key, row]));
  const authorByKey = new Map(author.map((row) => [row.key, row]));
  const authorPaper = author.filter((row) => authorExpressionEligible.has(row.key)
    && (row.padj ?? 1) < 0.05 && Math.abs(row.logFC) > 1);
  const localPaper = mine.filter((row) => localExpressionEligible.has(row.key)
    && (row.padj ?? 1) < 0.05 && Math.abs(row.logFC) > 1);
  const authorPaperKeys = new Set(authorPaper.map((row) => row.key));
  const localPaperKeys = new Set(localPaper.map((row) => row.key));
  const inBoth = authorPaper.filter((row) => localPaperKeys.has(row.key));
  const union = new Set([...authorPaperKeys, ...localPaperKeys]);
  const directionRate = (rows: AuthorRow[]): number | null => rows.length
    ? rows.filter((row) => Math.sign(row.logFC) === Math.sign(mineByKey.get(row.key)?.logFC ?? 0)).length / rows.length
    : null;
  const expressed = metrics(mine, author.filter((row) => authorExpressionEligible.has(row.key)));
  const localQAndEffect = authorPaper.filter((row) => {
    const local = mineByKey.get(row.key);
    return local != null && (local.padj ?? 1) < 0.05 && Math.abs(local.logFC) > 1;
  });
  if (authorPaper.some((row) => !authorByKey.has(row.key))) throw new Error('author paper-filter join failed');
  return {
    ...metrics(mine, author),
    expressedGeneCount: expressed.sharedGenes,
    expressedPearsonLogFC: expressed.pearsonLogFC,
    expressedMedianAbsLogFCDelta: expressed.medianAbsLogFCDelta,
    expressedSignConcordance: expressed.signConcordance,
    expressedStrongEffectGenes: expressed.strongEffectGenes,
    expressedStrongEffectSignConcordance: expressed.strongEffectSignConcordance,
    paperFilteredAuthorGenes: authorPaper.length,
    paperFilteredLocalGenes: localPaper.length,
    paperFilteredInBoth: inBoth.length,
    paperFilteredSetJaccard: round(union.size ? inBoth.length / union.size : 1)!,
    paperFilteredDirectionConcordance: round(directionRate(inBoth)),
    authorPaperFilteredGenesMeetingLocalQAndEffect: localQAndEffect.length,
  };
}

const ds = (...parts: string[]) => resolve(GEO, 'datasets', ...parts);
const count = (value: number | null | undefined): string => (value ?? 0).toLocaleString('en-US');

/** Shared genes whose author adjusted P is missing, and the local calls among them. */
function missingAuthorInference(mine: MineRow[], author: AuthorRow[], threshold = 0.05) {
  const authorByKey = new Map(author.map((row) => [row.key, row]));
  const shared = mine.filter((row) => authorByKey.has(row.key));
  const missing = shared.filter((row) => authorByKey.get(row.key)!.padj == null);
  return {
    finitePairs: shared.filter((row) => row.padj != null && authorByKey.get(row.key)!.padj != null).length,
    missing: missing.length,
    missingLocalCalls: missing.filter((row) => (row.padj ?? 1) < threshold).length,
  };
}

const comparisons: Comparison[] = [];

/** The committed comparison for a dataset whose local inputs are incomplete on this machine. */
function committedComparison(datasetId: string): Comparison {
  if (!existsSync(OUT_JSON)) {
    throw new Error(`${datasetId}: local inputs are incomplete and ${relative(ROOT, OUT_JSON)} has no committed comparison to carry forward`);
  }
  const committed = JSON.parse(readFileSync(OUT_JSON, 'utf8')) as { comparisons: Comparison[] };
  const comparison = committed.comparisons.find((entry) => entry.datasetId === datasetId);
  if (!comparison) throw new Error(`${datasetId}: no committed comparison to carry forward`);
  return comparison;
}

{
  const authorPath = ds('_author_de', 'GSE68177_elife-09800-supp1-v2.xlsx');
  const rawPath = ds('GSE68177_mmus_agrp_fedfast', 'raw', 'GSE68177_Agrp.Pomc.fedfast.counts.txt.gz');
  const workbookRows = recoverSourceSymbols(
    readWorkbookSheet(authorPath, 'Agrp.Pomc.fedfast.tpm.withstats'),
    readCountsWithBlankRowHeader(rawPath),
  );
  const authorExpressionEligible = new Set(workbookRows
    .filter((row) => number(row['cpm.avg.max']) > 20)
    .map((row) => String(row.__EMPTY)));
  const configurations = [
    {
      datasetId: 'mouse_agrp_fedfast_gse68177',
      dir: 'GSE68177_mmus_agrp_fedfast',
      localResult: 'GSE68177_DE.tsv',
      sampleSheet: 'GSE68177_samplesheet.tsv',
      effectColumn: 'adj.lfc.agrp',
      qValueColumn: 'qval.agrp',
      cellType: 'AgRP',
    },
    {
      datasetId: 'mouse_pomc_fedfast_gse68177',
      dir: 'GSE68177_mmus_pomc_fedfast',
      localResult: 'GSE68177_POMC_DE.tsv',
      sampleSheet: 'GSE68177_POMC_samplesheet.tsv',
      effectColumn: 'adj.lfc.pomc',
      qValueColumn: 'qval.pomc',
      cellType: 'POMC',
    },
  ] as const;
  for (const configuration of configurations) {
    const mine = localRows(ds(configuration.dir, 'processed', configuration.localResult));
    const author = authorRows(
      workbookRows, '__EMPTY', configuration.effectColumn, configuration.qValueColumn,
    );
    requireUniqueKeys(author, `${configuration.datasetId}: recovered author effects`);
    const localExpressionEligible = localMeanCpmEligibleKeys(
      rawPath, ds(configuration.dir, 'metadata', configuration.sampleSheet), mine, 20,
    );
    comparisons.push({
      datasetId: configuration.datasetId,
      accession: 'GSE68177',
      contrast: `24-hour food-deprived versus fed ${configuration.cellType} neurons`,
      comparisonType: 'direct_author_result',
      interpretation: 'effect_match_inference_differs',
      localMethod: 'edgeR quasi-likelihood with TMM',
      authorMethod: 'limma-voom with TMM',
      orientation: 'Both positive for food-deprived minus fed neurons.',
      metrics: paperFilteredMetrics(mine, author, authorExpressionEligible, localExpressionEligible),
      references: [reference(
        authorPath,
        'https://cdn.elifesciences.org/articles/09800/elife-09800-supp1-v2.xlsx',
      ), reference(rawPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE68nnn/GSE68177/suppl/GSE68177_Agrp.Pomc.fedfast.counts.txt.gz')],
      paperFilterDefinition: 'Author: workbook cpm.avg.max > 20; local: max TMM-normalized group-mean CPM > 20; both: adjusted p-value/q-value < 0.05 and |log2 fold-change| > 1.',
      expressedSubsetDefinition: 'Author workbook cpm.avg.max > 20 in at least one of the four AgRP/POMC fed/food-deprived cell type/conditions.',
      note: `The official eLife workbook contains the exact ${configuration.cellType} food-deprived-minus-fed limma-voom result. All 27 Excel-date-damaged gene labels are recovered through unique matching Ensembl ID plus genomic locus in the original deposited counts, including distinct Marc2/March2 rows sharing date serial 40603. No effect, P value or original source bytes are changed. Sample columns match the registered cohort after explicit FD-to-fast name translation. Effect agreement is reported both across all modeled genes and across the paper's expressed subset. Paper-filtered calls apply each analysis's own TMM-normalized mean-CPM eligibility before q/FDR and effect-size thresholds; inferential differences remain because the local model uses edgeR-QL. See continued-sources/advancement-comparisons-2026-09-05/.`,
    });
  }
}

{
  const dir = 'GSE124693_mmus_agrp_ribotag_fasting';
  const authorPath = ds('_author_de', 'GSE124693_NIHMS1022948_TableS2.xlsx');
  const comparisonMetrics = metrics(
    localRows(ds(dir, 'processed', 'GSE124693_DE.tsv')),
    authorRows(
      readWorkbookSheetFromHeader(authorPath, 'Table S2D', 4),
      'Gene', 'Log2 Fold Change', 'P-adj',
    ),
  );
  // Table S2D is filtered to author-significant genes. Treat the 658 shared
  // calls as author-call recovery, not as a symmetric all-gene set Jaccard.
  comparisonMetrics.significantSetJaccard = null;
  comparisons.push({
    datasetId: 'mouse_agrp_fedfast_gse124693', accession: 'GSE124693',
    contrast: 'ZT14 fasted versus ad-libitum-fed AgRP RiboTag RNA',
    comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs',
    localMethod: 'limma on log2(DESeq2-normalized count + 1)',
    authorMethod: 'DESeq2 (author-significant genes only)',
    orientation: 'Both positive for ZT14 fasted minus ad-libitum-fed AgRP RiboTag RNA.',
    metrics: comparisonMetrics,
    references: [reference(
      authorPath,
      'https://ars.els-cdn.com/content/image/1-s2.0-S1550413119300634-mmc3.xlsx',
    )],
    note: 'The official Table S2D contains all 1,950 author-significant genes for the exact ZT14 AgRP-Cre::RiboTag fasted-versus-fed comparison, but not the nonsignificant gene rows. Effect agreement and recovery of author calls can therefore be measured directly; a symmetric all-gene FDR-set Jaccard cannot be computed from this filtered workbook. The local standardized pipeline uses limma on the deposited DESeq2-normalized expression rather than the authors\' unavailable raw-count DESeq2 fit.',
  });
}

{
  const dir = 'GSE292416_mmus_arc_pnoc_bactrap';
  const authorPath = ds('_author_de', 'GSE292416_deseq2_results.csv.gz');
  const rows = readDelimited(authorPath, ',');
  const symbolCounts = new Map<string, number>();
  for (const row of rows) {
    const symbol = String(row.external_gene_name ?? '');
    symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
  }
  const uniqueSymbols = rows.filter(row => symbolCounts.get(String(row.external_gene_name ?? '')) === 1);
  const registered = localRowsByColumn(ds(dir, 'processed', 'GSE292416_DE.tsv'), 'symbol')
    .filter(row => row.key !== 'NA' && row.key !== 'NaN');
  const reviewed = metricsWithFiniteInference(registered,
    authorRows(uniqueSymbols, 'external_gene_name', 'log2FoldChange_ko_vs_wt_in_ip', 'padj_ko_vs_wt_in_ip'));
  if (reviewed.sharedGenes !== 13116 || reviewed.authorSignificantGenes !== 993
    || reviewed.localSignificantGenes !== 77 || reviewed.significantInBoth !== 77) throw new Error('GSE292416 strict-symbol comparison changed');
  comparisons.push({
    datasetId: 'mouse_arc_pnoc_trap_gse292416', accession: 'GSE292416',
    contrast: 'PNOC-IP LepR KO versus WT', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for KO minus WT within PNOC-IP.',
    metrics: reviewed,
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE292nnn/GSE292416/suppl/GSE292416_deseq2_results.csv.gz')],
    note: `Eight registered IP libraries match four independent four-animal pools per genotype. The 24,405-row author four-contrast union has 13,989 finite KO-versus-WT IP effect/FDR pairs. Strict exact-symbol matching excludes all 13 author rows with six ambiguous symbols and one missing registered symbol: ${count(reviewed.sharedGenes)} finite pairs, ${count(reviewed.authorSignificantGenes)} author FDR calls versus ${count(reviewed.localSignificantGenes)} registered, all ${count(reviewed.significantInBoth)} shared. This replaces the legacy first-row symbol policy (13,121 pairs/994 author calls). Separate raw-count independent 4-vs-4 DESeq2 matches author effects within 0.000447 log2FC. Both whole tables have 1,052 observed calls but only 1,045 IDs overlap; missing FDR is not negative. GEO and indexed official publisher enrichment/genotype thresholds select 69 versus 236 enriched genotype-DE genes. Original settings and this source-rule conflict remain under review. The R 4.6.0 output sums the 123 features that share a symbol before the fit, which moves registered log2FC by a median ${reviewed.medianAbsLogFCDelta} from the author values; near-zero effects reverse, so sign concordance is ${reviewed.signConcordance} (0.99397682 on the R 4.4.1 output). See continued-sources/five-dataset-followup-2026-09-04/GSE292416.`,
  });
}

{
  const dir = 'GSE294478_mmus_hypothalamus_fasting';
  const fed24Path = ds('_author_de', 'GSE294478_Fedvs24hrFD_EdgeR.txt.gz');
  const day24to72Path = ds('_author_de', 'GSE294478_24hrFDvs72hrFD_EdgeR.txt.gz');
  const fed24 = new Map(authorRows(readDelimited(fed24Path, '\t'), 'ensembl_gene_id', 'logFC').map((row) => [row.key, row]));
  const day24to72 = new Map(authorRows(readDelimited(day24to72Path, '\t'), 'ensembl_gene_id', 'logFC').map((row) => [row.key, row]));
  const reconstructed = [...fed24.values()].flatMap((first) => {
    const second = day24to72.get(first.key);
    // Author tables are Fed-24h and 72h-24h respectively. Their difference
    // (-first + second) telescopes to the explorer's 72h-Fed coefficient.
    return second ? [{ key: first.key, logFC: -first.logFC + second.logFC, padj: null }] : [];
  });
  comparisons.push({
    datasetId: 'mouse_hypo_fasting_gse294478', accession: 'GSE294478',
    contrast: '72-hour fasted versus fed', comparisonType: 'reconstructed_author_effect',
    interpretation: 'reconstructed_effect_match', localMethod: 'edgeR quasi-likelihood', authorMethod: 'edgeR likelihood-ratio (adjacent contrasts)',
    orientation: 'Local 72h-Fed equals -(author Fed-24h) + (author 72h-24h).',
    metrics: metrics(featureKeyedRows(ds(dir, 'processed', 'GSE294478_DE.tsv')), reconstructed),
    references: [
      reference(fed24Path, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE294nnn/GSE294478/suppl/GSE294478_Fedvs24hrFD_EdgeR.txt.gz'),
      reference(day24to72Path, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE294nnn/GSE294478/suppl/GSE294478_24hrFDvs72hrFD_EdgeR.txt.gz'),
    ],
    note: 'The exact effect is reconstructable, but p-values and FDR are not algebraically reconstructable from two separately fitted adjacent contrasts.',
  });
}

{
  const dir = 'GSE104255_ggal_hypothalamus';
  const authorPath = ds(dir, 'raw', 'GSE104255_res.pod.csv.gz');
  const ids = mapping(ds(dir, 'metadata', 'GSE104255_identifier_mapping.tsv'), 'source_ensembl_id', 'output_label');
  comparisons.push({
    datasetId: 'chicken_hypo_development_gse104255', accession: 'GSE104255',
    contrast: '6-week versus 3-week male broiler hypothalamus', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for 6-week minus 3-week hypothalamus.',
    metrics: metrics(localRows(ds(dir, 'processed', 'GSE104255_DE.tsv')), remap(authorRows(readDelimited(authorPath, ','), 'ensembl_gene_id', 'log2FoldChange', 'padj'), ids)),
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104255/suppl/GSE104255_res.pod.csv.gz')],
    note: 'The authors deposited the same age contrast from the same processed counts. Method-specific p/q differences are reported separately from effect agreement.',
  });
}

{
  const dir = 'GSE167105_mmus_hypothalamus_thrb';
  const authorPath = ds(dir, 'raw', 'GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz');
  const mineRaw = readDelimited(ds(dir, 'processed', 'GSE167105_DE.tsv'), '\t');
  const mine = mineRaw.map((row) => ({ key: String(row.symbol), logFC: number(row.logFC), padj: nullableNumber(row.padj) }));
  const authorRaw = readDelimited(authorPath, '\t');
  const author = authorRows(authorRaw, 'Gene_symbol', 'logFC', 'FDR');
  const expressed = metrics(
    mine,
    authorRows(authorRaw.filter((row) => number(row.logCPM) >= 4), 'Gene_symbol', 'logFC', 'FDR'),
  );
  comparisons.push({
    datasetId: 'mouse_hypo_thrb_k146q_gse167105', accession: 'GSE167105',
    contrast: 'THRB K146Q mutant versus WT hypothalamus', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'limma on log2(author-normalized expression + 1)', authorMethod: 'edgeR on unavailable raw counts',
    orientation: 'Both positive for K146Q mutant minus WT.',
    metrics: {
      ...metrics(mine, author),
      expressedGeneCount: expressed.sharedGenes,
      expressedPearsonLogFC: expressed.pearsonLogFC,
      expressedMedianAbsLogFCDelta: expressed.medianAbsLogFCDelta,
      expressedSignConcordance: expressed.signConcordance,
    },
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE167nnn/GSE167105/suppl/GSE167105_Hypothalamus_3Hb_vs_3WT_all.txt.gz')],
    note: 'Ranks and directions agree strongly, including every author-significant and every strong author effect. Among author logCPM >= 4 genes, effect correlation is high and the median absolute delta is small; exact inference remains unavailable because only normalized expression—not the author count matrix—was deposited.',
  });
}

{
  const dir = 'GSE202003_ggal_hypothalamus_lcitrulline';
  const authorPath = ds('_author_de', 'GSE202003_CON_vs_A.DESeq.xlsx');
  const ids = mapping(ds(dir, 'metadata', 'GSE202003_identifier_mapping.tsv'), 'source_ensembl_id', 'output_label');
  comparisons.push({
    datasetId: 'chicken_hypo_lcitrulline_gse202003', accession: 'GSE202003',
    contrast: '1% L-citrulline versus basal diet at 24 C', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for L-citrulline group A minus control.',
    metrics: metrics(localRows(ds(dir, 'processed', 'GSE202003_DE.tsv')), remap(authorRows(readWorkbook(authorPath), 'id', 'log2FoldChange', 'padj'), ids)),
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE202nnn/GSE202003/suppl/GSE202003_CON_vs_A.DESeq.xlsx')],
    note: 'The exact deposited control-versus-A workbook matches the local effect estimates. Neither method calls a shared gene significant at FDR < 0.05.',
  });
}

{
  const dir = 'GSE175461_rnor_son_dehydration';
  const authorPath = ds('_author_de', 'GSE175461_author_DE.csv.gz');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE175461_DE.tsv'));
  const author = authorRows(readDelimited(authorPath, ','), 'ENSEMBL_gene.id', 'log2FoldChange', 'padj');
  const m = metricsWithFiniteInference(mine, author);
  const missing = missingAuthorInference(mine, author);
  comparisons.push({
    datasetId: 'rat_son_dehydration_gse175461', accession: 'GSE175461',
    contrast: '72-hour dehydrated versus euhydrated SON', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for dehydrated minus euhydrated SON.',
    metrics: m,
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE175nnn/GSE175461/suppl/GSE175461_Pauza_et_al_2021_J-Neuroendocrinology_DEseq2_output.csv.gz')],
    note: `${count(m.sharedGenes)} of ${count(m.localGenes)} registered genes join the deposited 32,402-row table (22,159 finite author effects); the others are symbols summed over several features, which have no per-feature author row. FDR comparisons use ${count(missing.finitePairs)} shared finite tests: ${count(m.authorSignificantGenes)} author and ${count(m.localSignificantGenes)} registered calls, with ${count(m.significantInBoth)} shared. ${count(missing.missing)} registered genes lack author FDR, including ${count(missing.missingLocalCalls)} registered discoveries; these are unavailable author tests, not negative calls. A separate DESeq2 ~condition reconstruction with results(alpha=.05) matches the six author statistics and 324,020 normalized-count cells within original CSV rounding precision, with identical missingness. It reproduces the paper's 2,247 discoveries. Two author adjusted P values round to .0500, so the exact total cannot be recovered from the rounded table alone. Registered edgeR-QL results remain distinct. See continued-sources/five-dataset-followup-2026-09-04/GSE175461.`,
  });
}

{
  const dir = 'GSE252779_mmus_hypo_celastrol';
  const authorPath = ds(dir, 'raw', 'GSE252779_Expression_data.xlsx');
  comparisons.push({
    datasetId: 'mouse_hypo_celastrol_gse252779', accession: 'GSE252779',
    contrast: 'Celastrol versus vehicle in DIO mouse hypothalamus', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for GEO-defined CS minus vehicle; the matching author result is in the shifted PF_v_Veh.deseq sheet.',
    metrics: metrics(
      localRows(ds(dir, 'processed', 'GSE252779_DE.tsv')),
      authorRows(readWorkbookSheet(authorPath, 'PF_v_Veh.deseq'), 'id', 'log2FoldChange', 'padj'),
    ),
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252779/suppl/GSE252779_Expression_data.xlsx')],
    note: 'The prior FPKM/limma route was wrong and has been replaced with the workbook\'s integer STRA-gee-count sheet. The adapter also recovers 27 Excel date-coerced historical gene symbols before modeling; 26 nonzero identifiers are independently present in the author workbook, while the all-zero Sept12 row is nomenclature-backed and never enters DE. Exhaustive all-pair validation shows that all five author-result sheet names systematically exchange PF and CS; effects and significant directions reproduce once the matching sheet is selected.',
  });
}

{
  const dir = 'GSE160467_mmus_gt17_mkrn3';
  const authorPath = ds('_author_de', 'GSE160467_author_DE.csv.gz');
  const mappingPath = resolve(ROOT, 'data/author-validation/continued-sources/ten-dataset-followup-2026-09-04/GSE160467/recovered-author-labels.json');
  if (!matchesReviewedTextSha256(readFileSync(mappingPath), 'cee7b27ad4de69a23eb2396c167677af797570d95307ebc1877331589285eb0f')) {
    throw new Error('GSE160467 reviewed count-vector identifier mapping changed');
  }
  const sourceRows = readDelimited(authorPath, ',');
  const recovered = JSON.parse(readFileSync(mappingPath, 'utf8')) as Array<{
    source_row_index: number; original_author_label: string; recovered_source_gene_id: string;
  }>;
  if (recovered.length !== 20) throw new Error('GSE160467 expected 20 recovered source labels');
  for (const row of recovered) {
    if (sourceRows[row.source_row_index]?.Gene !== row.original_author_label) {
      throw new Error('GSE160467 original source row no longer matches reviewed recovery');
    }
    sourceRows[row.source_row_index].Gene = row.recovered_source_gene_id;
  }
  const mine = localRows(ds(dir, 'processed', 'GSE160467_DE.tsv'));
  const author = authorRows(sourceRows, 'Gene', 'log2FoldChange', 'padj');
  if (new Set(author.map(row => row.key)).size !== author.length) throw new Error('GSE160467 recovered IDs must be unique');
  const testedKeys = new Set(author.filter(row => row.padj != null).map(row => row.key));
  const localKeys = new Set(mine.filter(row => row.padj != null).map(row => row.key));
  const finiteMine = mine.filter(row => row.padj != null && testedKeys.has(row.key));
  const finiteAuthor = author.filter(row => row.padj != null && localKeys.has(row.key));
  const paperCall = (row: MineRow | AuthorRow) => row.padj != null && row.padj <= .05 && Math.abs(row.logFC) >= 1;
  const pairedRule = callRuleMetrics(finiteMine, finiteAuthor, paperCall, paperCall);
  const m = {
    ...callRuleMetrics(mine, author, paperCall, paperCall),
    ...metricsWithFiniteInference(mine, author),
    paperFilteredAuthorGenes: pairedRule.paperFilteredAuthorGenes,
    paperFilteredLocalGenes: pairedRule.paperFilteredLocalGenes,
    paperFilteredInBoth: pairedRule.paperFilteredInBoth,
    paperFilteredSetJaccard: pairedRule.paperFilteredSetJaccard,
    paperFilteredDirectionConcordance: pairedRule.paperFilteredDirectionConcordance,
    authorPaperFilteredGenesMeetingLocalQAndEffect: pairedRule.authorPaperFilteredGenesMeetingLocalQAndEffect,
  };
  if (m.sharedGenes !== 6252 || m.authorSignificantGenes !== 760 || m.localSignificantGenes !== 1136
    || m.significantInBoth !== 758 || m.paperFilteredAuthorGenes !== 642 || m.paperFilteredLocalGenes !== 930
    || m.paperFilteredInBoth !== 635) throw new Error('GSE160467 reviewed finite comparison changed');
  comparisons.push({
    datasetId: 'mouse_gt17_mkrn3_gse160467', accession: 'GSE160467',
    contrast: 'MKRN3-overexpressing versus control GT1-7 cells', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for MKRN3 overexpression minus control.',
    metrics: m,
    references: [
      reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE160nnn/GSE160467/suppl/GSE160467_MKRN3_control_DEseq2.csv.gz'),
      reference(mappingPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE160nnn/GSE160467/suppl/GSE160467_MKRN3_control_DEseq2.csv.gz'),
    ],
    paperFilterDefinition: `Author rule: FDR<=0.05 and |log2FC|>=1. Paper-rule overlap uses ${count(m.sharedGenes)} shared finite tests: ${count(m.paperFilteredAuthorGenes)} author, ${count(m.paperFilteredLocalGenes)} Explorer, ${count(m.paperFilteredInBoth)} shared. Whole positive paper-rule lists contain ${count(author.filter(paperCall).length)} author and ${count(mine.filter(paperCall).length)} Explorer genes.`,
    note: `The 13,040-row author table has 9,500 finite FDRs. Twenty spreadsheet-date labels, including two distinct 2-Mar rows, are recovered from unique six-library integer count vectors, not date-name guesses. All ${count(m.sharedGenes)} shared effects have finite FDR: ${count(m.authorSignificantGenes)} author discoveries, ${count(m.localSignificantGenes)} Explorer discoveries, ${count(m.significantInBoth)} shared. Whole FDR lists contain ${count(m.allAuthorSignificantGenes)} author and ${count(m.allLocalSignificantGenes)} Explorer genes; ${count(m.allLocalSignificantGenes! - m.localSignificantGenes)} Explorer discoveries lack an author row and remain unassessed. A separate DESeq2 fit using recovered author normalization reproduces all 867 FDR and 749 paper-rule discovery IDs. Registered edgeR inference and gene filtering still differ.`,
  });
}

{
  const dir = 'GSE270378_mmus_mhypoa_cbd';
  const authorPath = ds('_author_de', 'GSE270378_13353_2025_970_MOESM3_ESM.xlsx');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE270378_DE.tsv'));
  const author = authorRows(
    readWorkbookSheet(authorPath, '24h'),
    'ensembl_ID',
    'CTR_24h_A-CBD3_24h_A_log2FC',
    'CTR_24h_A-CBD3_24h_A_adjPval',
  ).map((row) => ({ ...row, logFC: -row.logFC }));
  const finiteAuthor = author.filter(row => row.padj != null);
  const finiteAuthorKeys = new Set(finiteAuthor.map(row => row.key));
  const finiteMine = mine.filter(row => row.padj != null && finiteAuthorKeys.has(row.key));
  if (finiteMine.length !== 9343) throw new Error('GSE270378 finite inference coverage changed');
  const finiteRule = callRuleMetrics(finiteMine, finiteAuthor,
    row => row.padj != null && row.padj < .1, row => row.padj != null && row.padj < .1);
  const m = { ...finiteRule, ...metricsWithFiniteInference(mine, author) };
  const missing = missingAuthorInference(mine, author, 0.1);
  const calls = (value: number | undefined) => (value === 1 ? 'one' : count(value));
  comparisons.push({
    datasetId: 'mouse_mhypoa_cbd_gse270378', accession: 'GSE270378',
    contrast: '3 micromolar CBD versus vehicle after 24 hours in mHypoA-2/12 cells',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'The author workbook is labeled control minus CBD; its effect is negated so both results are positive for CBD minus vehicle.',
    metrics: m,
    references: [reference(
      authorPath,
      'https://pmc-oa-opendata.s3.amazonaws.com/PMC12605594.1/13353_2025_970_MOESM3_ESM.xlsx',
    )],
    paperFilterDefinition: `Adjusted p-value/FDR <0.1, matching the manuscript. Call overlap uses ${count(finiteMine.length)} shared genes with finite author and Explorer adjusted P; the ${count(m.sharedGenes)} effect pairs are a different denominator.`,
    note: `The 56,943-row author worksheet contains 20,510 finite CBD3 effects and 9,374 finite adjusted P values. Of ${count(m.sharedGenes)} shared effects, ${count(finiteMine.length)} have evaluable FDR in both results: ${calls(finiteRule.paperFilteredAuthorGenes)} author call${finiteRule.paperFilteredAuthorGenes === 1 ? '' : 's'}, ${calls(finiteRule.paperFilteredLocalGenes)} Explorer call${finiteRule.paperFilteredLocalGenes === 1 ? '' : 's'}, ${calls(finiteRule.paperFilteredInBoth)} overlap at FDR<0.1. The other ${count(missing.missing)} shared genes have missing author FDR and are unassessed, not negative tests; ${missing.missingLocalCalls ? `${count(missing.missingLocalCalls)} of them are Explorer FDR<0.1 discoveries` : 'none is an Explorer FDR<0.1 discovery'}. A separate 15-library, same-time model across dose groups reproduces all 13 author discoveries, while a six-library DESeq2 model gives only one. The joint dose-group model, not software family alone, explains the inference difference. Registered Explorer output is unchanged.`,
  });
}

{
  const dir = 'GSE270383_mmus_hypothalamus_spatial';
  const authorPath = resolve(
    ROOT,
    'data',
    'author-validation',
    'continued-sources',
    'GSE270383',
    '41593_2026_2293_MOESM3_ESM.xlsx',
  );
  const sourceRows = readWorkbookSheetFromHeader(authorPath, 'Table_S5', 2)
    .filter((row) => String(row.Region ?? '') === 'Hypothalamus');
  if (sourceRows.length !== 33 || sourceRows.some((row) => String(row.Section_ID ?? '') !== 'Section_3')) {
    throw new Error('GSE270383 Table_S5: expected 33 Hypothalamus rows, all from Section_3');
  }
  const author = sourceRows.map((row): AuthorRow => {
    const key = String(row.gene_short_name ?? '');
    const foldChange = number(row['fold.change']);
    const ageClass = String(row.class ?? '');
    if (!key || !Number.isFinite(foldChange) || foldChange <= 0 || !['Old', 'Young'].includes(ageClass)) {
      throw new Error(`GSE270383 Table_S5: invalid Hypothalamus row for ${key || '<blank gene>'}`);
    }
    return {
      key,
      logFC: (ageClass === 'Old' ? 1 : -1) * Math.log2(foldChange),
      // The workbook's profile-level p/q values are not comparable with animal-pseudobulk inference.
      padj: null,
    };
  });
  if (new Set(author.map((row) => row.key)).size !== 33) {
    throw new Error('GSE270383 Table_S5: expected 33 unique Hypothalamus genes');
  }
  const comparisonMetrics = metrics(
    localRowsByColumn(ds(dir, 'processed', 'GSE270383_DE.tsv'), 'symbol'),
    author,
  );
  if (
    comparisonMetrics.sharedGenes !== 33
    || comparisonMetrics.signComparableGenes !== 33
    || comparisonMetrics.signConcordance !== 1
    || comparisonMetrics.localSignificantGenes !== 10
    || comparisonMetrics.authorSignificantGenes !== null
  ) {
    throw new Error('GSE270383 Table_S5: expected 33/33 direction agreement, 10 local FDR calls, and no author significance metrics');
  }
  comparisons.push({
    datasetId: 'mouse_hypo_spatial_aging_gse270383', accession: 'GSE270383',
    contrast: '23-month versus 4-month female hypothalamus in Section 3',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'edgeR quasi-likelihood on animal pseudobulk',
    authorMethod: 'Monocle2 likelihood-ratio test on spatial profiles',
    orientation: 'Both positive for old (23-month) minus young (4-month); workbook fold changes are signed from the class column.',
    metrics: comparisonMetrics,
    references: [reference(
      authorPath,
      'https://pmc-oa-opendata.s3.amazonaws.com/PMC13337494.1/41593_2026_2293_MOESM3_ESM.xlsx',
    )],
    paperFilterDefinition: 'Table_S5 is an author-filtered list (q < 0.05, fold change > 3, and maximum TPM > 50); its profile-level p/q values are not imported as comparable author significance values.',
    note: `Official Supplementary Table S5 lists 33 aging-associated Hypothalamus genes from Section_3. All 33 map to the local result and agree in old-minus-young direction (Pearson r=${comparisonMetrics.pearsonLogFC}, Spearman rho=${comparisonMetrics.spearmanLogFC}); ${comparisonMetrics.localSignificantGenes}/33 pass local animal-pseudobulk FDR < 0.05. Author profile-level p/q values are intentionally excluded, so author significance metrics are null. This effect-size match does not resolve the unpublished final retained-profile cohort.`,
  });
}

{
  // The raw GEO workbook is deliberately outside Git (see .gitignore). When it,
  // or any other local input, is absent the committed comparison is carried
  // forward with a loud warning instead of failing the build.
  const datasetId = 'mouse_hypo_lps_gse281503';
  const missing = missingLocalInputs(ROOT, datasetId);
  if (missing.length) {
    process.stderr.write(carriedForwardWarning(datasetId, 'compare_author_results.mts', missing, relative(ROOT, OUT_JSON).replaceAll('\\', '/')));
    comparisons.push(committedComparison(datasetId));
  } else {
    const dir = 'GSE281503_mmus_hypo_lps';
    const sourcePath = ds(dir, 'raw', 'GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx');
    const authorResultPath = resolve(ROOT, 'data', 'author-validation', 'derived', 'GSE281503_author_EDGE.generated.tsv.gz');
    const paperPath = ds('_author_de', 'GSE281503_FSB2-40-e71408-s001.xlsx');
    const mine = featureKeyedRows(ds(dir, 'processed', 'GSE281503_DE.tsv'));
    const authorResultRows = readDelimited(authorResultPath, '\t');
    const author = signedRatioAuthorRows(
      authorResultRows,
      'Ensembl_gene_id',
      'signed_fold_change',
      'padj',
    );
    const featureToEnsembl = new Map<string, string>();
    for (const row of authorResultRows) {
      const featureId = String(row.feature_id ?? '');
      const ensemblId = String(row.Ensembl_gene_id ?? '');
      if (!featureId || !ensemblId || featureToEnsembl.has(featureId)) {
        throw new Error(`GSE281503 complete result has a missing or duplicate Feature ID: ${featureId || '<blank>'}`);
      }
      featureToEnsembl.set(featureId, ensemblId);
    }
    const paperRows = readWorkbookSheetFromHeader(paperPath, 'Table S1', 6);
    const paper = [
      ...signedRatioAuthorRows(paperRows, 'Name', 'Fold change', 'FDR p-value correction'),
      ...signedRatioAuthorRows(paperRows, 'Name_1', 'Fold change_1', 'FDR p-value correction_1'),
    ];
    const paperByEnsembl = remap(paper, featureToEnsembl);
    const paperMetrics = metrics(mine, paperByEnsembl);
    if (paper.length !== 214 || paperByEnsembl.length !== 214 || paperMetrics.sharedGenes !== 200) {
      throw new Error(
        `GSE281503 Table S1: expected 214 Feature-ID mappings and 202 local filter survivors, got `
        + `${paper.length} rows, ${paperByEnsembl.length} mappings, and ${paperMetrics.sharedGenes} joins`,
      );
    }
    const comparisonMetrics = callRuleMetrics(
      mine,
      author,
      (row) => (row.padj ?? 1) < 0.05 && Math.abs(row.logFC) >= 1,
      (row) => (row.padj ?? 1) < 0.05 && Math.abs(row.logFC) >= 1,
    );
    const mineByKey = new Map(mine.map((row) => [row.key, row]));
    const authorName = new Map(authorResultRows.map((row) => [String(row.Ensembl_gene_id), String(row.feature_id)]));
    const opposite = author.filter((row) => (row.padj ?? 1) < 0.05 && mineByKey.has(row.key)
      && Math.sign(row.logFC) !== Math.sign(mineByKey.get(row.key)!.logFC));
    const describe = (row: AuthorRow): string => {
      const local = mineByKey.get(row.key)!;
      return `${authorName.get(row.key)} (author log2FC ${row.logFC.toFixed(3)}, FDR ${row.padj!.toExponential(2)}; local log2FC ${local.logFC.toFixed(3)}, FDR ${local.padj!.toFixed(3)})`;
    };
    const oppositeNote = opposite.length === 1
      ? `${describe(opposite[0])} is the only shared author-FDR effect with an opposite local sign, and it ${Math.abs(opposite[0].logFC) >= 1 ? 'passes' : 'does not pass'} the paper's twofold rule.`
      : `${opposite.length} shared author-FDR effects have an opposite local sign${opposite.length ? `: ${opposite.map(describe).join('; ')}` : ''}.`;
    if (
      comparisonMetrics.allAuthorSignificantGenes !== 374
      || comparisonMetrics.authorSignificantGenes !== 350
      || comparisonMetrics.allSignificantInBoth !== 315
      || comparisonMetrics.paperFilteredAuthorGenes !== 265
      || comparisonMetrics.paperFilteredInBoth !== 223
    ) {
      throw new Error('GSE281503 complete-result call counts changed');
    }
    comparisons.push({
      datasetId: 'mouse_hypo_lps_gse281503', accession: 'GSE281503',
      contrast: 'LPS plus vehicle versus saline plus vehicle in whole hypothalamus',
      comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
      localMethod: 'edgeR quasi-likelihood on all four deposited animals per group',
      authorMethod: 'CLC Genomics Workbench EDGE tagwise-dispersion test',
      orientation: 'Both results are positive for LPS plus vehicle minus saline plus vehicle; signed CLC fold-change ratios are converted to signed log2 fold changes.',
      metrics: comparisonMetrics,
      references: [
        reference(
          sourcePath,
          'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE281nnn/GSE281503/suppl/GSE281503_Effects_of_daridorexant_on_LPS-induced_mice.xlsx',
        ),
        reference(
          paperPath,
          'https://pmc-oa-opendata.s3.amazonaws.com/PMC12785484.1/FSB2-40-e71408-s001.xlsx',
        ),
      ],
      paperFilterDefinition: 'Each complete four-versus-four result\'s FDR < 0.05 and absolute fold change >= 2 (absolute log2 fold change >= 1), matching Table S1.',
      note: `The official GEO workbook embeds the complete CLC result for the exact registered four-versus-four contrast; the streaming prep step extracts every gene and all four CLC statistics without changing them. The complete author table has ${comparisonMetrics.allAuthorSignificantGenes} FDR <0.05 calls, of which ${comparisonMetrics.authorSignificantGenes} pair with a registered gene; ${comparisonMetrics.allSignificantInBoth} overlap the ${comparisonMetrics.allLocalSignificantGenes} local calls (full-set Jaccard ${comparisonMetrics.allSignificantSetJaccard}; shared-gene Jaccard ${comparisonMetrics.significantSetJaccard}). ${oppositeNote} Official paper Table S1 is an author-significant-only view that displays two RPKM columns per group and reports different effect estimates from the complete deposited result. Its 214 names map uniquely and exactly through the same workbook's Feature ID and per-sample Ensembl ID columns; ${paperMetrics.sharedGenes} pair with a registered gene and ${214 - paperMetrics.sharedGenes} do not (filtered locally, or a symbol the R 4.6.0 output sums over several features). Across the ${paperMetrics.sharedGenes} comparable Table S1 calls, local-versus-paper effect Pearson correlation is ${paperMetrics.pearsonLogFC}, Spearman correlation is ${paperMetrics.spearmanLogFC}, and directional concordance is ${paperMetrics.signConcordance}.`,
    });
  }
}

{
  const dir = 'GSE169296_rnor_pvn_adolescent_stress';
  const authorPath = ds(dir, 'raw', 'GSE169296_Male_control_and_stress_PVN.csv.gz');
  const sourceRows = readDelimited(authorPath, ',');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE169296_DE.tsv'));
  const mineByKey = new Map(mine.map(row => [row.key, row]));
  const selected = sourceRows.filter(row => number(row['bROC Analysis Results - Conf']) >= 0.95)
    .map(row => clcAuthorRows([row])[0]).filter(row => row && mineByKey.has(row.key));
  const selectedSameDirection = selected.filter(row => Math.sign(row.logFC) === Math.sign(mineByKey.get(row.key)!.logFC)).length;
  comparisons.push({
    datasetId: 'rat_pvn_adolescent_stress_gse169296', accession: 'GSE169296',
    contrast: 'Adolescent restraint stress versus control in male PVN', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'CLC Genomics Workbench bROC',
    orientation: 'Both positive for stress minus control in male PVN.',
    metrics: metrics(mine, clcAuthorRows(sourceRows)),
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE169nnn/GSE169296/suppl/GSE169296_Male_control_and_stress_PVN.csv.gz')],
    note: `${selectedSameDirection}/${selected.length} shared CLC confidence >=0.95 effects agree in direction. CLC bROC GINI confidence is not a BH-adjusted p-value: author FDR and FDR-overlap metrics are unavailable, not zero. The six author source-expression columns match the six registered male PVN animals exactly; bootstrap pseudo-replicates affect inference and are not treated as independent animals.`,
  });
}

{
  const dir = 'GSE229799_mmus_hypo_clic1ko';
  const authorPath = ds('_author_de', 'GSE229799_author_DE.csv.gz');
  const m = metrics(featureKeyedRows(ds(dir, 'processed', 'GSE229799_DE.tsv')), authorRows(readDelimited(authorPath, ','), 'ENSEMBL', 'logFC', 'adj.P.Val'));
  comparisons.push({
    datasetId: 'mouse_hypo_clic1_gse229799', accession: 'GSE229799',
    contrast: 'Clic1 knockout versus wild-type hypothalamus', comparisonType: 'direct_author_result',
    interpretation: 'rank_direction_match_magnitude_review', localMethod: 'limma on deposited normalized expression', authorMethod: 'author limma result',
    orientation: 'Both positive for Clic1 knockout minus wild type.',
    metrics: m,
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE229nnn/GSE229799/suppl/GSE229799_clic1ko_rnaseq_differential_expression_KOvsWT_AllGenes.csv.gz')],
    note: `${m.sharedGenes === m.localGenes ? 'All modeled genes join' : `${count(m.sharedGenes)} of ${count(m.localGenes)} modeled genes join`} the exact author table${m.sharedGenes === m.localGenes ? '' : ' (the others are symbols averaged over several source rows)'}, and ${m.authorSignificantSignConcordance === 1 ? 'significant directions agree' : `significant-direction agreement is ${m.authorSignificantSignConcordance}`}, but effect correlation is moderate. The local analysis excludes one metadata-conflicted KO and one column absent from the GEO sample block.`,
  });
}

{
  const dir = 'GSE243287_mmus_hypothalamus_smc3cko';
  const authorPath = ds('_author_de', 'GSE243287_Top-et.Fix4.txt.gz');
  const mine = localRows(ds(dir, 'processed', 'GSE243287_DE.tsv'));
  const authorRaw = readDelimited(authorPath, '\t');
  const author = authorRows(authorRaw, 'genes', 'logFC', 'FDR');
  const expressed = metrics(
    mine,
    authorRows(authorRaw.filter((row) => number(row.logCPM) >= 0), 'genes', 'logFC', 'FDR'),
  );
  comparisons.push({
    datasetId: 'mouse_hypo_smc3_gse243287', accession: 'GSE243287',
    contrast: 'Hypothalamic Smc3 cKO versus wild type', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'limma-trend on log2(CPM + offset)', authorMethod: 'edgeR',
    orientation: 'Both positive for Smc3 cKO minus wild type.',
    metrics: {
      ...metrics(mine, author),
      expressedGeneCount: expressed.sharedGenes,
      expressedPearsonLogFC: expressed.pearsonLogFC,
      expressedMedianAbsLogFCDelta: expressed.medianAbsLogFCDelta,
      expressedSignConcordance: expressed.signConcordance,
    },
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE243nnn/GSE243287/suppl/GSE243287_Top-et.Fix4.txt.gz')],
    note: 'For 15,567 genes with author logCPM >= 0, Pearson log2FC is 0.963, median absolute delta is 0.0056, and sign concordance is 98.8%; all shared author-significant genes agree in direction. Extreme low-expression coefficients reduce all-gene Pearson correlation, and raw counts were not deposited.',
  });
}

{
  const dir = 'GSE95243_hsap_hypothalamic_neurons_obesity';
  const authorPath = ds('_author_de', 'GSE95243_author_DE.csv.gz');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE95243_DE.tsv'));
  const authorRaw = readDelimited(authorPath, ',');
  const author = authorRows(authorRaw, 'Ensembl', 'Obs-v-Ctr_log2FC', 'Obs-v-Ctr_padj');
  const expressed = metrics(
    mine,
    authorRows(
      authorRaw.filter((row) => number(row['Obs-v-Ctr_baseMean']) >= 1000),
      'Ensembl', 'Obs-v-Ctr_log2FC', 'Obs-v-Ctr_padj',
    ),
  );
  const m = metrics(mine, author);
  comparisons.push({
    datasetId: 'human_ipsc_hypo_obesity_gse95243', accession: 'GSE95243',
    contrast: 'Obesity-derived versus control iPSC hypothalamic neurons', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for obesity-derived minus control iPSC hypothalamic neurons.',
    metrics: {
      ...m,
      expressedGeneCount: expressed.sharedGenes,
      expressedPearsonLogFC: expressed.pearsonLogFC,
      expressedMedianAbsLogFCDelta: expressed.medianAbsLogFCDelta,
      expressedSignConcordance: expressed.signConcordance,
    },
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE95nnn/GSE95243/suppl/GSE95243_Sareen-HT-2017_data_for_GEO_-_Diff-expr.csv.gz')],
    note: `Author effects agree increasingly well after excluding the unstable low-expression tail, but the exact author contrast has ${count(m.authorSignificantGenes)} FDR-significant shared genes while local edgeR-QL, group-only edgeR, and rounded-count diagnostics have ${m.localSignificantGenes ? count(m.localSignificantGenes) : 'none'}. Validation is effect-level; the author inferential result needs exact version/filter details.`,
  });
}

{
  const dir = 'GSE98519_mmus_hypothalamus_lef1';
  const authorPath = ds('_author_de', 'GSE98519_P22_S6_Table.xlsx');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE98519_DE.tsv'));
  const author = negativeTenLogAdjustedAuthorRows(
    readWorkbookSheet(authorPath, 'Analyzed Genes'),
    'IGB HyperLink', 'Log2Ratio Mut_vs_WT', '-10lg(AdjP) Mut_vs_WT',
  );
  const ineligible = new Set(['ENSMUSG00000045999', 'ENSMUSG00000082697']);
  const m = metricsWithFiniteInference(mine, author, ineligible);
  const finitePaired = mine.filter(row => row.padj != null && author.some(entry => entry.key === row.key && entry.padj != null && !ineligible.has(entry.key))).length;
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const say = (value: number | null) => (value != null && value < words.length ? words[value] : count(value));
  comparisons.push({
    datasetId: 'mouse_hypo_lef1_gse98519', accession: 'GSE98519',
    contrast: 'P22 hypothalamic Lef1 conditional knockout versus control', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for P22 Lef1 conditional knockout minus littermate control.',
    metrics: m,
    references: [reference(
      authorPath,
      'https://journals.plos.org/plosbiology/article/file?type=supplementary&id=info:doi/10.1371/journal.pbio.2002257.s012',
    )],
    note: `Table S6 embeds 106,674 count values, all identical to the deposited six-library P22 matrix. ${count(m.sharedGenes)} of ${count(m.localGenes)} registered effects join; the others are symbols summed over several features, which have no per-feature author row. Inference uses ${count(finitePaired)} paired tests after excluding ambiguous historical USeq zero-score exports. ENSMUSG00000045999 and ENSMUSG00000082697 have zero transformed-FDR scores and missing raw P, so they remain unassessed rather than author-negative; ${mine.some(row => row.key === 'ENSMUSG00000082697') ? 'only the latter is registered' : 'neither is registered'}. Author calls ${say(m.authorSignificantGenes)} genes and Explorer ${say(m.localSignificantGenes)}. A separate DESeq2 fit recovers all four author discovery IDs, but historical numerical residuals and the registered inference difference remain.`,
  });
}

{
  const dir = 'GSE98690_mmus_vmh_thrb';
  const authorPath = ds('_author_de', 'GSE98690_Table_S1_RNAseq.xlsx');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE98690_DE.tsv'));
  const author = authorRows(
    readWorkbookSheet(authorPath, 'All diff expressed genes'),
    'Ens_ID', 'logFC (Cre vs GFP)', 'FDR (<0.05)',
  );
  const comparisonMetrics = metricsWithCompleteSignificantSets(mine, author);
  const mineKeys = new Set(mine.map(row => row.key));
  const featureSymbols = new Map([...mappedFeatures(ds(dir, 'processed', 'GSE98690_DE.tsv'))].flatMap(([symbol, ids]) => ids.map(id => [id, symbol] as const)));
  const omitted = author.filter(row => !mineKeys.has(row.key)).map(row => `${row.key} (${featureSymbols.get(row.key) ?? 'no public symbol'})`);
  if (comparisonMetrics.authorSignificantGenes !== 1960 ||
      comparisonMetrics.localSignificantGenes !== 1977 ||
      comparisonMetrics.significantInBoth !== 1633 ||
      comparisonMetrics.significantSetJaccard !== 0.70876736) {
    throw new Error('GSE98690 complete FDR-set closure changed');
  }
  comparisons.push({
    datasetId: 'mouse_vmh_thrb_gse98690', accession: 'GSE98690',
    contrast: 'VMH Thrb knockdown versus AAV-GFP control', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'limma on deposited log2-CPM', authorMethod: 'edgeR likelihood-ratio',
    orientation: 'Both positive for AAV-Cre VMH Thrb knockdown minus AAV-GFP control.',
    metrics: comparisonMetrics,
    references: [reference(
      authorPath,
      'https://ars.els-cdn.com/content/image/1-s2.0-S2211124717307234-mmc2.xlsx',
    )],
    note: `Official paper Table S1 provides the complete ${count(comparisonMetrics.authorSignificantGenes)}-gene author FDR-significant set for the exact three-control/four-knockdown contrast, but not the nonsignificant tail. Of those, ${count(comparisonMetrics.sharedGenes)} join the local table for effect comparison${comparisonMetrics.signConcordance === 1 ? ', with perfect directional agreement' : ` with directional agreement ${comparisonMetrics.signConcordance}`}. Across the complete call sets, local limma calls ${count(comparisonMetrics.localSignificantGenes)} genes, ${count(comparisonMetrics.significantInBoth)} overlap, and the symmetric Jaccard is ${comparisonMetrics.significantSetJaccard}. The omitted author effect rows are ${omitted.join(', ')}. The R 4.6.0 output publishes no row for a feature without a public symbol and averages source rows that share a symbol before the fit, so none of these has a per-feature estimate to pair.`,
  });
}

{
  const dir = 'GSE99690_mmus_gt17_orexin';
  const authorPath = ds(dir, 'raw', 'GSE99690_GT1-7-OxR1-RNA-Seq_mm10_Results.xlsx');
  const mine = localRows(ds(dir, 'processed', 'GSE99690_DE.tsv'));
  const author = trimmedAuthorRows(readWorkbookSheet(authorPath, 'Oxa3h_VS_Neg'), '\t', 'log2FoldChange', 'padj');
  const m = metricsWithFiniteInference(mine, author);
  const missing = missingAuthorInference(mine, author);
  const authorKeys = new Set(author.map(row => row.key));
  const missingNames = mine.filter(row => authorKeys.has(row.key) && author.find(entry => entry.key === row.key)!.padj == null);
  comparisons.push({
    datasetId: 'mouse_gt17_orexin_gse99690', accession: 'GSE99690',
    contrast: 'Three-hour orexin-A versus vehicle in GT1-7-OX1R cells', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'replicate-blocked edgeR quasi-likelihood', authorMethod: 'DESeq2',
    orientation: 'Both positive for three-hour orexin-A minus vehicle.',
    metrics: m,
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE99nnn/GSE99690/suppl/GSE99690_GT1-7-OxR1-RNA-Seq_mm10_Results.xlsx')],
    note: `Effects use ${count(m.sharedGenes)} shared genes; FDR comparison uses ${count(missing.finitePairs)} finite paired tests, excluding ${missingNames.map(row => row.key).join(', ')} whose author adjusted P is missing. There are ${count(m.authorSignificantGenes)} author and ${count(m.localSignificantGenes)} Explorer calls with ${count(m.significantInBoth)} shared. ${missingNames.filter(row => (row.padj ?? 1) < 0.05).map(row => row.key).join(', ') || 'No gene without an author test'} is a further Explorer discovery, not a confirmed negative author test. The author baseMean and normalized counts establish nine-library normalization including 8-hour samples and support a separate no-block three-condition diagnostic; the original formula was not located. Explorer uses only the six vehicle/3-hour libraries and blocks the three title-defined replicate series. Separate normalization reproduces the author values, but inference remains under review.`,
  });
}

{
  const dir = 'GSE306829_mmus_mpoa_pnoc_bactrap';
  const authorPath = ds(dir, 'raw', 'GSE306829_IPvsInput_deg.txt.gz');
  // These published padj=1 rows have no raw P either. The diagnostic identifies
  // their missing/filtered status; do not count them as negative author tests.
  const authorTable = readDelimited(authorPath, '\t');
  const unavailable = new Set(authorTable.filter(row => !Number.isFinite(number(row.pvalue))).map(row => String(row.gene_id)));
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE306829_DE.tsv'));
  const author = authorRows(authorTable, 'gene_id', 'log2FoldChange', 'padj');
  const reviewed = metricsWithFiniteInference(mine, author, unavailable);
  const authorKeys = new Set(author.map(row => row.key));
  const sharedUnavailable = mine.filter(row => authorKeys.has(row.key) && unavailable.has(row.key));
  const evaluable = mine.filter(row => authorKeys.has(row.key) && !unavailable.has(row.key) && row.padj != null).length;
  if (reviewed.localSignificantGenes !== 7500 || reviewed.significantInBoth !== 6409
    || reviewed.significantSetJaccard !== 0.84207069) throw new Error('GSE306829 reviewed finite-inference comparison changed');
  comparisons.push({
    datasetId: 'mouse_mpoa_pnoc_bactrap_gse306829', accession: 'GSE306829',
    contrast: 'PNOC-IP versus paired input', comparisonType: 'direct_author_result',
    interpretation: 'effect_match_inference_differs', localMethod: 'paired edgeR quasi-likelihood', authorMethod: 'DESeq2; group-only fitting context supported by separate reconstruction, original formula not located',
    orientation: 'Both positive for PNOC-IP minus matched input.',
    metrics: reviewed,
    references: [reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE306nnn/GSE306829/suppl/GSE306829_IPvsInput_deg.txt.gz')],
    note: `GEO confirms three independent three-animal pools with matched IP/input, not six independent animals. ${count(reviewed.sharedGenes)} of ${count(reviewed.localGenes)} final Explorer genes join; the others are symbols summed over several features, which have no per-feature author row. FDR comparison uses ${count(evaluable)} shared evaluable rows: ${count(reviewed.authorSignificantGenes)} author and ${count(reviewed.localSignificantGenes)} registered calls, overlap ${count(reviewed.significantInBoth)}, Jaccard ${reviewed.significantSetJaccard}. The remaining ${count(sharedUnavailable.length)} rows have missing author raw P but exported adjusted P=1; ${count(sharedUnavailable.filter(row => (row.padj ?? 1) < 0.05).length)} are registered discoveries and must not count as author-negative. A separate group-only DESeq2 default-alpha=.1 reconstruction recovers all 6,642 whole-author FDR<.05 IDs. Its 5,432 unavailable adjusted-P rows correspond to exported 1s, not finite tested negatives. This reconstruction does not replace paired edgeR, validate the six final-projection omissions or establish the unavailable original formula/version. See continued-sources/five-dataset-followup-2026-09-04/GSE306829.`,
  });
}

{
  const authorPath = resolve(ROOT, 'data/author-validation/continued-sources/GSE234483/mmc3_Table_S1.xlsx');
  const authorReference = reference(authorPath, 'https://www.cell.com/cms/10.1016/j.celrep.2025.116422/attachment/ee326c4d-afc8-4fc2-a770-38458df0a721/mmc3.xlsx');
  if (authorReference.sha256 !== 'bdaa33d6c0130c850070f27c79b5c62db9134859126040a12528654ec3f36474') {
    throw new Error('GSE234483 Figure 3 workbook differs from the reviewed author artifact');
  }
  const sheet = XLSX.readFile(authorPath).Sheets['Figure 3'];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
  const author: AuthorRow[] = [];
  for (const [column, label] of [[0, 'Figure 3A'], [6, 'Figure 3B']] as const) {
    if (!String(rows[0]?.[column]).startsWith(`${label}: Log fold changes`)
      || rows[1].slice(column + 1, column + 5).join(',') !== 'GL1,GL2,GL3,GL4') {
      throw new Error('GSE234483 Figure 3 sample/figure headings changed');
    }
    for (let i = 2; i < 23; i += 1) {
      const symbol = String(rows[i]?.[column] ?? '');
      if (!symbol) continue;
      const values = rows[i].slice(column + 1, column + 5).map(number);
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`GSE234483 Figure 3: incomplete sample effects for ${symbol}`);
      }
      // MGI:1353494 renamed Akr1b3 to Akr1b1; this mapping is also pinned in our nomenclature table.
      author.push({ key: symbol === 'Akr1b3' ? 'Akr1b1' : symbol, logFC: values.reduce((sum, value) => sum + value, 0) / 4, padj: null });
    }
  }
  if (author.length !== 32 || new Set(author.map((row) => row.key)).size !== 32) throw new Error('GSE234483: expected 32 unique selected author genes');
  const comparisonMetrics = metrics(localRowsByColumn(ds('GSE234483_mmus_hypo_glylow', 'processed', 'GSE234483_DE.tsv'), 'symbol'), author);
  if (comparisonMetrics.sharedGenes !== 32 || comparisonMetrics.signConcordance !== 1) throw new Error('GSE234483 selected-result agreement changed; review required');
  comparisons.push({
    datasetId: 'mouse_hypo_glylow_gse234483', accession: 'GSE234483',
    contrast: 'Four-month, one-week Gly-Low versus control; 32 selected Figure 3A/B genes',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'edgeR quasi-likelihood group effect', authorMethod: 'Mean of four author sample-level normalized log2 effects',
    orientation: 'Both positive for Gly-Low minus control; source cohort is four Gly-Low versus five controls.',
    metrics: comparisonMetrics, references: [authorReference],
    note: 'The 32 selected author effects agree in direction and closely in magnitude. Their mean sample effects are not exactly the modeled group effect. No author P/FDR values are supplied, so significance metrics remain null. This partial direct comparison does not resolve the published 1,407-gene total: independent edgeR, limma, and DESeq2 sensitivity results call approximately 10,000 genes at FDR<0.05; the exact author selection rule is unavailable. See continued-sources/GSE234483 for hash-pinned per-sample comparison and DESeq2 sensitivity evidence.',
  });
}

{
  const dir = 'GSE280030_mmus_mhypoa_palmitate';
  const authorPath = resolve(ROOT, 'data/author-validation/continued-sources/GSE280030/Data_Sheet_2.xlsx');
  const ref = reference(authorPath, 'https://public-pages-files-2025.frontiersin.org/articles/1518737/file/Data_Sheet_2.xlsx/1518737_data-sheet_2/3');
  if (ref.sha256 !== '1c08cd635c6bd027bd4058a10f7536da49dd842dd18b31d7daef323dc966a3d2') throw new Error('GSE280030 author workbook changed');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE280030_DE.tsv'));
  const author = authorRows(readWorkbookSheet(authorPath, 'Diff_expression_all_comparisons'), 'Row-names', 'PA-CTR___log2FoldChange', 'PA-CTR___padj');
  const m = metrics(mine, author);
  // Missing author adjusted P values are not negative calls. Effects use all
  // shared IDs; inferential metrics use only genes evaluable in both analyses.
  const testedAuthor = author.filter(row => row.padj != null);
  const testedIds = new Set(testedAuthor.map(row => row.key));
  const evaluated = metrics(mine.filter(row => row.padj != null && testedIds.has(row.key)), testedAuthor);
  Object.assign(m, {
    authorSignificantGenes: evaluated.authorSignificantGenes,
    localSignificantGenes: evaluated.localSignificantGenes,
    significantInBoth: evaluated.significantInBoth,
    significantSetJaccard: evaluated.significantSetJaccard,
  });
  if (m.sharedGenes !== 11253 || m.significantInBoth !== 796 || m.significantSetJaccard !== 0.5805981) throw new Error('GSE280030 comparison changed');
  const mineKeys = new Set(mine.map(row => row.key));
  const authorCalls = author.filter(row => row.padj != null && row.padj < 0.05);
  const missingAuthorP = author.filter(row => row.padj == null && mineKeys.has(row.key)).length;
  comparisons.push({
    datasetId: 'mouse_mhypoa_palmitate_gse280030', accession: 'GSE280030', contrast: 'Palmitate minus vehicle in mHypoA cultures',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'Seven-library pairwise edgeR-QL', authorMethod: 'DESeq2/iDEP across 15 cultures',
    orientation: 'Both positive for PA minus CTR; exact Ensembl IDs.', metrics: m, references: [ref],
    note: `Effect metrics use all ${count(m.sharedGenes)} shared IDs; significance metrics use the ${count(evaluated.sharedGenes)} with both adjusted P values (${count(m.authorSignificantGenes)} author and ${count(m.localSignificantGenes)} local calls, ${count(m.significantInBoth)} overlap). ${count(missingAuthorP)} author adjusted P values of shared IDs are missing, not nonsignificant. Full result lists contain ${count(authorCalls.length)} author and ${count(mine.filter(row => row.padj != null && row.padj < 0.05).length)} local calls; ${count(authorCalls.filter(row => !mineKeys.has(row.key)).length)} author calls have no registered per-feature row (filtered locally, or a symbol summed over several features). An independently recorded all-15-library author-compatible DESeq2 reconstruction reproduces the exact 1,418 author-significant gene set (Jaccard 1) and adjusted-P availability pattern. This is not an identical registered edgeR analysis. See continued-sources/GSE280030 for full results, model assumptions and the separate historical-package/annotation reproducibility limitation.`,
  });
}

{
  const dir = 'GSE128148_mmus_arc_corticosterone';
  const authorPath = ds(dir, 'metadata', 'GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz');
  const ref = reference(authorPath, 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE128nnn/GSE128148/suppl/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz');
  if (ref.sha256 !== '4cab6f64c93427b71fee49a00c821c01fbb1019dcf9d075018fec6fcecb9cfab') throw new Error('GSE128148 original result changed');
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE128148_DE.tsv'));
  const author = authorRows(readDelimited(authorPath, '\t'), 'gene_id', 'log2FoldChange', 'padj');
  const m = callRuleMetrics(mine, author, row => row.padj != null && row.padj < .1, row => row.padj != null && row.padj < .1);
  // No shared-universe Jaccard is presented across missing author adjusted P.
  // The separately named paper-rule metric describes full reported call lists.
  m.significantSetJaccard = null;
  if (m.sharedGenes !== 11173 || m.paperFilteredAuthorGenes !== 43 || m.paperFilteredInBoth !== 6) throw new Error('GSE128148 full-result comparison changed');
  const symbolOf = new Map(readDelimited(authorPath, '\t').map(row => [String(row.gene_id), String(row.symbol)]));
  const mineByKey = new Map(mine.map(row => [row.key, row]));
  const authorCalls = author.filter(row => row.padj != null && row.padj < .1);
  const tested = authorCalls.filter(row => mineByKey.get(row.key)?.padj != null);
  const sameDirection = tested.filter(row => Math.sign(row.logFC) === Math.sign(mineByKey.get(row.key)!.logFC)).length;
  const untested = authorCalls.filter(row => mineByKey.get(row.key)?.padj == null).map(row => symbolOf.get(row.key) ?? row.key);
  comparisons.push({
    datasetId: 'mouse_arc_corticosterone_gse128148', accession: 'GSE128148', contrast: 'Four-week corticosterone minus vehicle in male ARC',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'edgeR-QL', authorMethod: 'DESeq2; historical version/prior/filter unspecified',
    orientation: 'Both positive for corticosterone minus vehicle; exact Ensembl IDs.', metrics: m, references: [ref],
    paperFilterDefinition: `Reported FDR <0.1 gene lists: ${count(m.paperFilteredAuthorGenes)} author versus ${count(m.paperFilteredLocalGenes)} local, overlap ${count(m.paperFilteredInBoth)}. Missing author adjusted P values are not negative tests.`,
    note: `Full deposit contains 22,048 rows, including missing effects/tests; correlations use finite effects and ${count(m.sharedGenes)} of ${count(m.localGenes)} local genes. ${count(tested.length)} of ${count(authorCalls.length)} author calls are locally tested and ${sameDirection === tested.length ? `all ${count(tested.length)}` : count(sameDirection)} directions agree; ${untested.join(', ')} ${untested.length === 1 ? 'has' : 'have'} no registered per-feature row (filtered locally, or a symbol summed over several features). A betaPrior=TRUE DESeq2 sensitivity plus the observed original nonmissing-adjusted-P universe recovers the exact 43 original significant gene IDs. This conditional diagnostic substantially explains the method difference but does not identify historical settings; the registered edgeR result remains distinct. Figure 2C labels Npy raw P as adjusted P; benchmark deposited adjusted P=0.00046317. See continued-sources/GSE128148.`,
  });
}

{
  const dir = 'GSE201408_sscr_hypothalamus_weaning';
  const authorPath = resolve(ROOT, 'data/author-validation/continued-sources/availability-batch-2026-09-04/GSE201408_S4_genotype.xlsx');
  const ref = reference(authorPath, 'https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0272775.s005');
  if (ref.sha256 !== 'ba638af276803ec29f3c0e07112e854e626460dfe3b267db04d7c4583cff8b60') throw new Error('GSE201408 author S4 changed');
  const ids = mapping(ds(dir, 'metadata', 'GSE201408_identifier_mapping.tsv.gz'), 'source_ensembl', 'output_label');
  const author = remap(trimmedAuthorRows(readWorkbookSheetFromHeader(authorPath, 'Hoja1', 2), 'Gene', 'log2FoldChange', 'padj'), ids).map(row => ({ ...row, logFC: -row.logFC }));
  const mine = localRows(ds(dir, 'processed', 'GSE201408_DE.tsv'));
  const m = metrics(mine, author);
  m.significantSetJaccard = null; // A significant-only subset is not a full tested universe.
  if (m.sharedGenes !== 43 || m.signConcordance !== 1) throw new Error('GSE201408 author-subset comparison changed');
  const mineByKey = new Map(mine.map(row => [row.key, row]));
  const authorRule = author.filter(row => mineByKey.has(row.key)).filter(row => {
    const local = mineByKey.get(row.key)!;
    return local.padj != null && local.padj < 0.1 && Math.abs(local.logFC) >= Math.log2(1.2);
  }).length;
  const ruleCount = authorRule === 1 ? 'one' : count(authorRule);
  comparisons.push({
    datasetId: 'pig_hypo_genotype_gse201408', accession: 'GSE201408', contrast: 'Iberian minus crossbred pig hypothalamus',
    comparisonType: 'direct_author_result', interpretation: 'effect_match_inference_differs',
    localMethod: 'Sex-adjusted limma on log2 author-normalized expression', authorMethod: 'DESeq2 on counts',
    orientation: 'Author crossbred-minus-Iberian effects negated; exact Ensembl-to-retained-output-label map, no fuzzy join.',
    metrics: m, references: [ref],
    paperFilterDefinition: `Author significant-only S4: FDR <0.1 and absolute fold change >=1.2; 51 genes, ${count(m.sharedGenes)} registered, ${ruleCount} ${authorRule === 1 ? 'meets' : 'meet'} that rule locally.`,
    note: `${count(m.sharedGenes)} of the 51 published genes join and all agree in direction (Pearson ${m.pearsonLogFC}), but only ${ruleCount} ${authorRule === 1 ? 'remains' : 'remain'} locally significant under the author rule. The other ${51 - m.sharedGenes} map to Ensembl features without a public symbol, which the R 4.6.0 output keeps in the fit but no longer publishes. This does not establish genome-wide agreement. Author excludes one male Iberian (19 total); local uses all 20. The excluded identity is not recoverable from the inspected PCA, so no sample has been silently removed. Cohort and inferential differences remain unresolved; see continued-sources/availability-batch-2026-09-04.`,
  });
}

{
  const dir = 'GSE190389_mmus_scn_trf';
  const authorPath = resolve(ROOT, 'data/author-validation/continued-sources/GSE190389_DE_workbook.xlsx');
  const ref = reference(authorPath, 'https://data.mendeley.com/public-files/datasets/wc5wy48x93/files/9c2be9b9-8713-4c15-beaa-18605da93698/file_downloaded');
  if (ref.sha256 !== '98c26cdf39a18faf6c12fce64a76c6ea88313b4eddb41a4732438faed7b3f50c') throw new Error('GSE190389 original SCN workbook changed');
  const rows = readWorkbookSheet(authorPath, 'SCN');
  const author = authorRows(rows, 'external_gene_name', 'logFC (TRF/ALF)', 'FDR');
  const mine = localRowsByColumn(ds(dir, 'processed', 'GSE190389_DE.tsv'), 'symbol');
  if (author.length !== 18846 || new Set(author.map(row => row.key)).size !== author.length
    || new Set(mine.map(row => row.key)).size !== mine.length) throw new Error('GSE190389 exact unique-symbol join changed');
  const expressed = new Set(rows.filter(row => number(row.logCPM) > 0).map(row => String(row.external_gene_name)));
  const localCall = (row: MineRow) => row.padj != null && row.padj <= .05;
  const authorCall = (row: AuthorRow) => row.padj != null && row.padj <= .05 && expressed.has(row.key);
  const m = callRuleMetrics(mine, author, localCall, authorCall);
  const localByKey = new Map(mine.map(row => [row.key, row]));
  const evaluatedAuthor = author.filter(row => row.padj != null && localByKey.get(row.key)?.padj != null);
  const evaluatedIds = new Set(evaluatedAuthor.map(row => row.key));
  const evaluated = callRuleMetrics(mine.filter(row => evaluatedIds.has(row.key)), evaluatedAuthor, localCall, authorCall);
  const significantAuthor = evaluatedAuthor.filter(authorCall);
  const opposite = significantAuthor.filter(row => Math.sign(row.logFC) !== Math.sign(localByKey.get(row.key)!.logFC)).length;
  Object.assign(m, {
    authorSignificantGenes: evaluated.paperFilteredAuthorGenes,
    localSignificantGenes: evaluated.paperFilteredLocalGenes,
    significantInBoth: evaluated.paperFilteredInBoth,
    significantSetJaccard: evaluated.paperFilteredSetJaccard,
    authorSignificantSignConcordance: significantAuthor.length ? round(1 - opposite / significantAuthor.length) : null,
    oppositeDirectionAuthorSignificant: opposite,
  });
  if (m.localGenes !== 16997 || m.sharedGenes !== 16212 || evaluatedAuthor.length !== 16212
    || m.authorSignificantGenes !== 22 || m.localSignificantGenes !== 3 || m.significantInBoth !== 1
    || m.significantSetJaccard !== 0.04166667 || opposite !== 0) throw new Error('GSE190389 reviewed comparison changed');
  comparisons.push({
    datasetId: 'mouse_scn_trf_gse190389', accession: 'GSE190389', contrast: 'Time-restricted feeding minus ad-libitum feeding in SCN',
    comparisonType: 'direct_author_result', interpretation: 'rank_direction_match_magnitude_review',
    localMethod: 'ZT-adjusted edgeR quasi-likelihood', authorMethod: 'edgeR 3.26.7 mean-expression comparison without ZT adjustment',
    orientation: 'Both positive for TRF minus ALF; exact unique symbols, no inferred aliases.',
    metrics: m, references: [ref],
    paperFilterDefinition: 'Author FDR <=0.05 and logCPM >0; local FDR <=0.05 on the registered filterByExpr universe. Original adjusted P values are retained.',
    note: `The complete 18,846-row SCN worksheet supplies author results. Effects use ${count(m.sharedGenes)} exact shared symbols, all with both adjusted P values. All 22 author-significant genes map and agree in direction, but only ${m.significantInBoth === 1 ? 'one is' : `${count(m.significantInBoth)} are`} locally significant; the registered result has ${count(m.localSignificantGenes)} FDR <=0.05 genes. The ${count(m.localGenes - m.sharedGenes)} unmatched local symbols remain unresolved; continued-sources/GSE190389/comparison.summary.json lists the 807 unmatched on the R 4.4.1 output. The 45-library cohort matches the explicit author exclusions. No-ZT sensitivities do not reproduce the author results, and a separate source audit found 37 same-symbol expression discrepancies. The manuscript claims no SCN DE genes, unlike the deposited worksheet. These are available-data discrepancies requiring review, not access gaps or a demonstrated ZT-only explanation. See continued-sources/GSE190389/REVIEW_2026-09-04.md.`,
  });
}

{
  const dir = 'GSE224254_mouse_sst_neuron_sex';
  const authorPath = resolve(ROOT, 'data/author-validation/continued-sources/GSE224254_hypothalamus_FoverM.csv');
  const ref = reference(authorPath, 'https://drive.google.com/uc?export=download&id=19wI0sPFuFvj0yurcH_Cz2exf57fBj8cd');
  if (ref.sha256 !== '022cdf99360b2b9b98fd7ae04d44ccf28a25e6028b87d8439a0eaf25795f6ed8') throw new Error('GSE224254 original author CSV changed');
  const author = authorRows(readDelimited(authorPath, ','), 'EnsID', 'LogFC', 'adjP').map(row => ({ ...row, logFC: -row.logFC }));
  const mine = featureKeyedRows(ds(dir, 'processed', 'GSE224254_DE.tsv'));
  if (author.length !== 24909 || new Set(author.map(row => row.key)).size !== author.length
    || new Set(mine.map(row => row.key)).size !== mine.length) throw new Error('GSE224254 exact Ensembl-ID join changed');
  const m = metrics(mine, author);
  const testedAuthor = author.filter(row => row.padj != null);
  const testedIds = new Set(testedAuthor.map(row => row.key));
  const evaluated = metrics(mine.filter(row => row.padj != null && testedIds.has(row.key)), testedAuthor);
  Object.assign(m, {
    authorSignificantGenes: evaluated.authorSignificantGenes,
    localSignificantGenes: evaluated.localSignificantGenes,
    significantInBoth: evaluated.significantInBoth,
    significantSetJaccard: evaluated.significantSetJaccard,
    authorSignificantSignConcordance: evaluated.authorSignificantSignConcordance,
    oppositeDirectionAuthorSignificant: evaluated.oppositeDirectionAuthorSignificant,
    allAuthorSignificantGenes: author.filter(row => row.padj != null && row.padj < .05).length,
    allLocalSignificantGenes: mine.filter(row => row.padj != null && row.padj < .05).length,
  });
  if (m.localGenes !== 15110 || m.sharedGenes !== 15075 || testedAuthor.length !== 14478
    || evaluated.sharedGenes !== 14335 || m.authorSignificantGenes !== 499 || m.localSignificantGenes !== 25
    || m.significantInBoth !== 23 || m.significantSetJaccard !== 0.04590818
    || m.allAuthorSignificantGenes !== 505 || m.allLocalSignificantGenes !== 25
    || m.oppositeDirectionAuthorSignificant !== 2) throw new Error('GSE224254 reviewed comparison changed');
  const symbolOf = new Map(readDelimited(authorPath, ',').map(row => [String(row.EnsID), String(row.Gene)]));
  const mineByKey = new Map(mine.map(row => [row.key, row]));
  const authorKeys = new Set(author.map(row => row.key));
  const absent = author.filter(row => row.padj != null && row.padj < .05 && !mineByKey.has(row.key)).map(row => `${row.key}/${symbolOf.get(row.key)}`);
  const reversed = testedAuthor.filter(row => row.padj! < .05 && mineByKey.get(row.key)?.padj != null
    && Math.sign(row.logFC) !== Math.sign(mineByKey.get(row.key)!.logFC));
  const reversedLocal = reversed.map(row => mineByKey.get(row.key)!);
  const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('');
  comparisons.push({
    datasetId: 'mouse_sst_neuron_sex_gse224254', accession: 'GSE224254', contrast: 'Male minus female hypothalamic SST neurons',
    comparisonType: 'direct_author_result', interpretation: 'rank_direction_match_magnitude_review',
    localMethod: 'edgeR quasi-likelihood', authorMethod: 'Author DESeq2 Wald result; exact historical processing under review',
    orientation: 'Author female-minus-male LogFC negated to male-minus-female; exact Ensembl IDs, no fuzzy symbol matching.',
    metrics: m, references: [ref],
    paperFilterDefinition: 'Adjusted P <0.05 without an effect cutoff. Shared-universe significance metrics include only genes with finite adjusted P in both results.',
    note: `The public author CSV was linked from the publication code repository Leandromvelez/sex-specific-endocrine-signals. Effects use all ${count(m.sharedGenes)} shared IDs from 24,909 author and ${count(m.localGenes)} local rows. Significance metrics use only ${count(evaluated.sharedGenes)} evaluable shared IDs: ${count(m.authorSignificantGenes)} author calls, ${count(m.localSignificantGenes)} local calls, and ${count(m.significantInBoth)} overlaps. The ${count(m.sharedGenes - evaluated.sharedGenes)} shared genes with missing author adjusted P are not negative calls. Complete source lists contain ${count(m.allAuthorSignificantGenes)} author and ${count(m.allLocalSignificantGenes)} local calls. ${absent.length} author-significant IDs have no registered per-feature row: ${list(absent)}. Another ${count(m.localGenes - m.sharedGenes)} local genes are absent from the author table (the list for the R 4.4.1 output is in continued-sources/GSE224254/comparison.summary.json). Among matched author-significant genes, ${list(reversed.map(row => symbolOf.get(row.key) ?? row.key))} ${reversed.length === 1 ? 'has an opposite but tiny local effect' : 'have opposite but tiny local effects'}, all absolute log2FC <${Math.max(...reversedLocal.map(row => Math.abs(row.logFC))) < 0.04 ? '0.04' : '0.1'} and local FDR >${Math.min(...reversedLocal.map(row => row.padj!)).toFixed(2)}. These measured differences require review of processing and model details; this is not missing author evidence or full verification.`,
  });
}

// Declarative additions retain a source pin and re-read the registered output on
// every run. Scientific scope remains in the separately reviewed ledger.
const additionalSpecsPath = resolve(ROOT, 'data/author-validation/additional-comparison-specs.json');
if (existsSync(additionalSpecsPath)) {
  type AdditionalSpec = {
    datasetId: string; accession: string; contrast: string;
    localPath: string; localKey?: string; authorPath: string; sourceUrl: string; sha256: string;
    format: 'tsv' | 'csv' | 'xlsx'; sheetName?: string; headerRow?: number;
    authorKey: string; authorEffect: string; authorAdjustedP?: string;
    orientationSign: 1 | -1; orientation?: string; localMethod: string; authorMethod: string;
    note: string; interpretation: Comparison['interpretation'];
    originalReferences?: { path: string; sourceUrl: string; sha256: string; bytes?: number }[];
    localSnapshot?: { path: string; sha256: string; bytes?: number };
  };
  const document = JSON.parse(readFileSync(additionalSpecsPath, 'utf8')) as { schemaVersion: number; comparisons: AdditionalSpec[] };
  if (document.schemaVersion !== 1 || !Array.isArray(document.comparisons)) throw new Error('Invalid additional comparison specifications');
  const ids = new Set(comparisons.map(row => row.datasetId));
  for (const spec of document.comparisons) {
    if (!spec.datasetId || ids.has(spec.datasetId)) throw new Error(`Duplicate additional comparison: ${spec.datasetId}`);
    ids.add(spec.datasetId);
    if (![1, -1].includes(spec.orientationSign) || !['tsv', 'csv', 'xlsx'].includes(spec.format)
      || !/^[a-f0-9]{64}$/.test(spec.sha256) || !spec.sourceUrl || !spec.note || !spec.localMethod || !spec.authorMethod) {
      throw new Error(`${spec.datasetId}: incomplete reviewed comparison specification`);
    }
    const sourcePath = resolve(ROOT, spec.authorPath);
    const localPath = resolve(ROOT, spec.localPath);
    const localRelative = relative(ROOT, localPath).replaceAll('\\', '/');
    // The R 4.6.0 regeneration replaced this output; its manifest records the bytes it replaced.
    const replaced = supersessionNames(ROOT, localRelative) ? supersession(ROOT).records.get(localRelative) : undefined;
    const regenerated = Boolean(replaced?.newSha256) && isRecordedCurrentOutput(ROOT, localRelative, readFileSync(localPath), replaced);
    // A mapping prepared against the replaced output stays bound to it: the snapshot
    // must be exactly the recorded predecessor, and rows are re-keyed to its IDs below.
    const preparedAgainstPredecessor = (snapshot: { sha256: string; bytes?: number }): boolean => regenerated
      && snapshot.sha256 === replaced.oldSha256 && (snapshot.bytes === undefined || snapshot.bytes === replaced.oldBytes);
    if (spec.localSnapshot && (resolve(ROOT, spec.localSnapshot.path) !== localPath
      || ((sha256(localPath) !== spec.localSnapshot.sha256
        || (spec.localSnapshot.bytes !== undefined && statSync(localPath).size !== spec.localSnapshot.bytes))
        && !preparedAgainstPredecessor(spec.localSnapshot)))) {
      throw new Error(`${spec.datasetId}: normalized mapping was prepared against a different local snapshot; regenerate source extraction`);
    }
    const ref = reference(sourcePath, spec.sourceUrl);
    if (ref.sha256 !== spec.sha256) throw new Error(`${spec.datasetId}: pinned author source changed`);
    const originalRefs = (spec.originalReferences ?? []).map(source => {
      if (HISTORICAL_PINS.has(source.path) || supersessionNames(ROOT, source.path)) {
        const historical = readSealedHistoricalInput(ROOT, source.path, source.sha256);
        if (source.bytes !== undefined && historical.length !== source.bytes) throw new Error(`${spec.datasetId}: original sealed input size changed: ${source.path}`);
        return { ...reference(resolve(ROOT, source.path), source.sourceUrl), sha256: source.sha256, bytes: historical.length };
      }
      const current = reference(resolve(ROOT, source.path), source.sourceUrl);
      if (current.sha256 !== source.sha256 || (source.bytes !== undefined && current.bytes !== source.bytes)) {
        throw new Error(`${spec.datasetId}: original author evidence changed: ${source.path}`);
      }
      return current;
    });
    let sourceRows: Row[];
    if (spec.format === 'xlsx') {
      const workbook = XLSX.readFile(sourcePath);
      const sheetName = spec.sheetName ?? workbook.SheetNames[0];
      if (!workbook.Sheets[sheetName] || (spec.headerRow !== undefined && (!Number.isInteger(spec.headerRow) || spec.headerRow < 1))) {
        throw new Error(`${spec.datasetId}: invalid worksheet or header row`);
      }
      sourceRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheetName], { defval: null, raw: true, range: (spec.headerRow ?? 1) - 1 });
    } else sourceRows = readDelimited(sourcePath, spec.format === 'csv' ? ',' : '\t');
    const localSourceRows = readDelimited(localPath, '\t');
    const localKey = spec.localKey ?? 'gene_id';
    const requireColumns = (rows: Row[], columns: string[], context: string): void => {
      if (!rows.length || columns.some(column => !Object.hasOwn(rows[0], column))) throw new Error(`${spec.datasetId}: missing ${context} columns`);
    };
    requireColumns(sourceRows, [spec.authorKey, spec.authorEffect, ...(spec.authorAdjustedP ? [spec.authorAdjustedP] : [])], 'author');
    requireColumns(localSourceRows, [localKey, 'logFC', 'padj'], 'local');
    requireUniqueKeys(sourceRows.map(row => ({ key: String(row[spec.authorKey] ?? '') })), `${spec.datasetId}: source`);
    requireUniqueKeys(localSourceRows.map(row => ({ key: String(row[localKey] ?? '') })), `${spec.datasetId}: local`);
    const validP = (value: Cell): number | null => {
      const parsed = nullableNumber(value);
      if (parsed != null && (parsed < 0 || parsed > 1)) throw new Error(`${spec.datasetId}: adjusted P outside [0,1]`);
      return parsed;
    };
    const published: MineRow[] = localSourceRows.map(row => ({ key: String(row[localKey]), logFC: number(row.logFC), padj: validP(row.padj) }))
      .filter(row => Number.isFinite(row.logFC));
    const author: AuthorRow[] = sourceRows.map(row => ({ key: String(row[spec.authorKey]), logFC: number(row[spec.authorEffect]) * spec.orientationSign,
      padj: spec.authorAdjustedP ? validP(row[spec.authorAdjustedP]) : null }))
      .filter(row => Number.isFinite(row.logFC));
    // Regenerated rows are keyed by symbol. Author IDs prepared against the replaced
    // output's per-feature IDs join through the feature map; IDs that are neither a
    // feature ID nor a symbol (an input keyed by symbol) join through the predecessor.
    let rekeyed: 'feature' | 'predecessor' | null = null;
    let mine = published;
    if (regenerated && localKey === 'id' && localSourceRows.some(row => row.id !== row.symbol)) {
      throw new Error(`${spec.datasetId}: a regenerated output is expected to be keyed by symbol`);
    }
    const symbols = new Set(published.map(row => row.key));
    // Outputs whose predecessor was already keyed by symbol have no feature map and join unchanged.
    if (regenerated && localKey === 'id' && existsSync(localPath.replace(/_DE\.tsv$/, '_feature_map.tsv.gz'))
      && author.some(row => !symbols.has(row.key))) {
      const featureIds = new Set(readDelimited(featureMapPath(localPath), '\t').map(row => String(row.feature_id)));
      rekeyed = author.some(row => !featureIds.has(row.key) && !symbols.has(row.key)) ? 'predecessor' : 'feature';
      mine = rekeyed === 'predecessor' ? priorIdKeyedRows(localPath) : featureKeyedRows(localPath);
    }
    const summed = rekeyed ? symbolsWithSeveralFeatures(localPath) : new Set<string>();
    const summedSymbols = mine.filter(row => summed.has(row.key)).length;
    const testedAuthorKeys = new Set(author.filter(row => row.padj != null).map(row => row.key));
    const finiteInferencePairs = mine.filter(row => row.padj != null && testedAuthorKeys.has(row.key)).length;
    const comparisonMetrics = finiteInferencePairs >= 3 ? metricsWithFiniteInference(mine, author) : metrics(mine, author.map(row => ({ ...row, padj: null })));
    comparisons.push({ datasetId: spec.datasetId, accession: spec.accession, contrast: spec.contrast,
      comparisonType: 'direct_author_result', interpretation: spec.interpretation,
      localMethod: spec.localMethod, authorMethod: spec.authorMethod,
      orientation: spec.orientation ?? `Author effect multiplied by ${spec.orientationSign} to match the registered comparison.`,
      metrics: comparisonMetrics, references: [ref, ...originalRefs, reference(localPath, '')],
      note: `${spec.note}${regenerated ? ' Figures quoted above were reviewed on the R 4.4.1 output; the metrics are recomputed on its R 4.6.0 regeneration.' : ''}${rekeyed ? ` The R 4.6.0 output is keyed by symbol; its rows are re-keyed to the reviewed ${rekeyed === 'feature' ? 'per-feature IDs through its feature map' : 'IDs of the output it replaced'}, and ${summedSymbols} symbols summed over several features stay unpaired.` : ''} Exact unique identifiers; ${sourceRows.length - author.length} author rows and ${localSourceRows.length - published.length} local rows lack finite effects and are excluded. ${finiteInferencePairs} shared genes expose finite adjusted P in both results; ${finiteInferencePairs >= 3 ? 'FDR comparison is scoped to those genes' : 'author FDR comparison is not assessed'}. No missing adjusted P is counted as a negative author call.` });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  thresholdDefinitions: {
    significant: 'adjusted p-value < 0.05',
    strongEffect: '|author log2 fold-change| >= 0.5',
  },
  comparisons,
};

const columns = [
  'datasetId', 'accession', 'contrast', 'comparisonType', 'interpretation', 'sharedGenes',
  'pearsonLogFC', 'spearmanLogFC', 'medianAbsLogFCDelta', 'strongEffectGenes',
  'strongEffectSignConcordance', 'authorSignificantGenes', 'localSignificantGenes',
  'significantInBoth', 'significantSetJaccard', 'authorSignificantSignConcordance',
  'oppositeDirectionAuthorSignificant', 'allAuthorSignificantGenes',
  'allLocalSignificantGenes', 'allSignificantInBoth', 'allSignificantSetJaccard',
  'expressedGeneCount', 'expressedPearsonLogFC',
  'expressedMedianAbsLogFCDelta', 'expressedSignConcordance', 'expressedStrongEffectGenes',
  'expressedStrongEffectSignConcordance', 'paperFilteredAuthorGenes', 'paperFilteredLocalGenes',
  'paperFilteredInBoth', 'paperFilteredSetJaccard', 'paperFilteredDirectionConcordance',
  'authorPaperFilteredGenesMeetingLocalQAndEffect', 'paperFilterDefinition',
  'expressedSubsetDefinition', 'note',
];
const tsvRows = comparisons.map((comparison) => {
  const row: Record<string, string | number | null> = {
    ...comparison,
    ...comparison.metrics,
  } as unknown as Record<string, string | number | null>;
  return columns.map((column) => String(row[column] ?? '')).join('\t');
});
const json = `${JSON.stringify(report, null, 2)}\n`;
const tsv = `${columns.join('\t')}\n${tsvRows.join('\n')}\n`;

if (CHECK) {
  if (!existsSync(OUT_JSON) || !existsSync(OUT_TSV)) throw new Error('direct comparison outputs are missing');
  const current = JSON.parse(readFileSync(OUT_JSON, 'utf8')) as typeof report;
  const comparable = { ...report, generatedAt: current.generatedAt };
  if (`${JSON.stringify(comparable, null, 2)}\n` !== readFileSync(OUT_JSON, 'utf8') || tsv !== readFileSync(OUT_TSV, 'utf8')) {
    throw new Error('direct author-result comparison outputs are stale');
  }
  process.stdout.write(`direct author-result comparisons are current (${comparisons.length})\n`);
} else {
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, json);
  writeFileSync(OUT_TSV, tsv);
  process.stdout.write(`wrote ${comparisons.length} direct/reconstructed author-result comparisons\n`);
}
