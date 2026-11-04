// The gene-list seam: a file (or a pasted block of text) becomes a list of
// symbols, that list is resolved against the dataset in front of the user, and
// a selection goes back out as a file.
//
// WHAT "AUTOMATIC DETECTION" MEANS HERE
// -------------------------------------
// Nobody should have to say what kind of file a gene list is. The reader
// looks at the extension first (a workbook is binary and has to be handed to
// xlsx; a GMT has a fixed field order), and for everything else at the CONTENT:
//   * a delimiter is chosen by counting which of tab / comma / semicolon runs
//     through most of the lines — a plain one-per-line list has none, and then
//     each line is split on whitespace, which is also what makes a pasted
//     "POMC AGRP NPY" work;
//   * a table's gene column is the one whose header says so (Gene, Symbol,
//     gene_name, …, see GENE_HEADER); without a recognisable header it is the
//     column whose cells look most like symbols, so an export with logFC and
//     p-value columns still reads its first column and not its numbers;
//   * the header row, comment lines (#…), blank cells and R's NA are dropped.
//
// RESOLUTION IS THE DATASET'S JOB, NOT THE FILE'S
// -----------------------------------------------
// A list written for one species arrives at a study that spells its symbols
// another way (Pomc in a mouse list, POMC in the macaque atlas), or under a
// name the authority has since retired (AARS1 for the stored AARS). The reader
// hands back the file's names verbatim; resolveGeneList maps them onto the
// dataset's OWN spelling — case-insensitively first, then through the alias
// index, exactly as the search box does for one gene at a time — and says
// which names it could not place, so a missing gene is reported rather than
// silently dropped.
//
// Pure and React-free: the xlsx package is reached only through the lazy
// loader (it is 400 KB nobody should pay for until they hand us a workbook),
// and the download half goes through the export-action and workbook seams.

import { loadXLSX } from './lazyExport';
import { writeWorkbook, type WorkbookRow } from './workbook';
import { downloadFile, exportFilename } from './exportAction';
import { resolveByOtherName, type AliasIndex, type NomenclatureAuthority } from '../data/nomenclature';

// ── Reading ─────────────────────────────────────────────────────────────────

export type GeneListFormat = 'text' | 'csv' | 'tsv' | 'excel' | 'gmt' | 'json';

export interface ParsedGeneList {
  /** The names as the file spelled them, in file order, exact duplicates dropped. */
  genes: string[];
  format: GeneListFormat;
  /** The header of the column the names came from; null for a headerless list. */
  column: string | null;
  /** The worksheet read, for a workbook. */
  sheet?: string;
  /** The number of gene sets merged, for a GMT. */
  sets?: number;
}

/** Files handed to xlsx rather than read as text. */
const WORKBOOK_EXT = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;
const GMT_EXT = /\.gmt$/i;
const JSON_EXT = /\.json$/i;

/**
 * Column headers that name a gene column. Deliberately broad — Gene, Symbol,
 * gene_name, GeneID, Feature, external_gene_name, the app's own export headers
 * — because the alternative to recognising a header is guessing from cells.
 */
const GENE_HEADER =
  /^(genes?|symbols?|ids?|names?|features?|probes?|transcripts?|mirnas?|(gene|feature|hgnc|mgi|rgd|probe|transcript|mirna|external_gene)[ _.-]?(symbols?|names?|ids?|short_name)|gene_short_name)$/i;

/** A cell that is a number (1.2, -0.5, 3e-05) is never a symbol. */
const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
/** What a symbol looks like: word characters plus the punctuation real symbols carry (mt-Rnr2, HLA-DRB1, 5S_rRNA, LOC1021). */
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._:/()'@-]{0,60}$/;
/** Cells that mean "no value" in the tools that write these files. */
const NULL_CELL = /^(na|nan|null|none|n\/a)$/i;

function looksLikeSymbol(cell: string): boolean {
  return cell.length > 0 && !NUMERIC.test(cell) && !NULL_CELL.test(cell) && SYMBOL.test(cell);
}

function cleanCell(raw: string): string {
  let s = raw.trim();
  // Quoted CSV cells ("POMC"), with a doubled inner quote unescaped.
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).replace(/""/g, '"').trim();
  return s;
}

/** Split one line on a delimiter, honouring double-quoted fields. */
function splitLine(line: string, delimiter: string | null): string[] {
  // Whitespace-separated: a trailing comma or semicolon on a token is a stray
  // separator in a list that otherwise has none ("GENE3," in a 20-line list).
  if (delimiter === null) return line.split(/\s+/).map((t) => cleanCell(t.replace(/[,;]+$/, '')));
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else { quoted = !quoted; cur += ch; }
    } else if (ch === delimiter && !quoted) {
      out.push(cleanCell(cur));
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cleanCell(cur));
  return out;
}

/**
 * The delimiter that runs through most of the lines, or null for a
 * whitespace-separated (or one-per-line) list. Judged on a sample: a
 * 20,000-line list needs no more than its first fifty lines to declare itself.
 */
function detectDelimiter(lines: string[]): { delimiter: string | null; format: GeneListFormat } {
  const sample = lines.slice(0, 50);
  const candidates: Array<[string, GeneListFormat]> = [['\t', 'tsv'], [',', 'csv'], [';', 'csv']];
  let best: { delimiter: string | null; format: GeneListFormat; hits: number } = { delimiter: null, format: 'text', hits: 0 };
  for (const [d, format] of candidates) {
    const hits = sample.filter((l) => l.includes(d)).length;
    if (hits > best.hits) best = { delimiter: d, format, hits };
  }
  // A delimiter has to be the rule, not the exception: one stray comma in a
  // fifty-line list must not turn the whole list into a table.
  return best.hits * 2 >= sample.length && best.hits > 0
    ? { delimiter: best.delimiter, format: best.format }
    : { delimiter: null, format: 'text' };
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  return out;
}

/**
 * Pick the symbols out of a table of cells.
 *
 * ONE ROW is a list, not a table: "POMC, AGRP, NPY" pasted on a line has three
 * genes in it, not three columns of one gene each.
 */
export function pickGeneColumn(rows: string[][]): { genes: string[]; column: string | null } {
  const table = rows.filter((r) => r.some((c) => c.length > 0));
  if (!table.length) return { genes: [], column: null };
  if (table.length === 1) {
    return { genes: dedupe(table[0].filter(looksLikeSymbol)), column: null };
  }

  const width = Math.max(...table.map((r) => r.length));
  const first = table[0];

  // A header row names the column outright.
  const headerCol = first.findIndex((c) => GENE_HEADER.test(c));
  if (headerCol >= 0) {
    return {
      genes: dedupe(table.slice(1).map((r) => r[headerCol] ?? '').filter(looksLikeSymbol)),
      column: first[headerCol],
    };
  }

  // No header: the column whose cells look most like symbols, judged on a
  // sample. Ties go to the leftmost, which is where a gene column usually is.
  let bestCol = 0;
  let bestScore = -1;
  const sample = table.slice(0, 200);
  for (let c = 0; c < width; c++) {
    const score = sample.reduce((n, r) => n + (looksLikeSymbol(r[c] ?? '') ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestCol = c; }
  }
  return {
    genes: dedupe(table.map((r) => r[bestCol] ?? '').filter(looksLikeSymbol)),
    column: null,
  };
}

function parseGmt(lines: string[]): ParsedGeneList {
  // name <TAB> description <TAB> gene <TAB> gene …  — one set per line.
  const genes: string[] = [];
  let sets = 0;
  for (const line of lines) {
    const fields = line.split('\t').map(cleanCell);
    if (fields.length < 3) continue;
    sets += 1;
    for (const g of fields.slice(2)) if (looksLikeSymbol(g)) genes.push(g);
  }
  return { genes: dedupe(genes), format: 'gmt', column: null, sets };
}

/**
 * A JSON list: `["POMC", …]`, `{ "genes": [...] }`, or an array of objects
 * with a gene-ish key. Returns null when the text is not that, so the caller
 * can fall through to the text reader.
 */
function parseJson(text: string): ParsedGeneList | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  let list: unknown = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const key = Object.keys(obj).find((k) => GENE_HEADER.test(k) && Array.isArray(obj[k]));
    if (!key) return null;
    list = obj[key];
  }
  if (!Array.isArray(list)) return null;
  let column: string | null = null;
  const names = list.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const key = Object.keys(rec).find((k) => GENE_HEADER.test(k) && typeof rec[k] === 'string');
      if (key) { column = column ?? key; return String(rec[key]).trim(); }
    }
    return '';
  });
  return { genes: dedupe(names.filter(looksLikeSymbol)), format: 'json', column };
}

/**
 * Read a gene list out of text — a file's contents or a pasted block.
 *
 * `filename` only steers the two formats that cannot be told from content
 * alone (GMT's fixed field order, JSON); everything else is sniffed.
 */
export function parseGeneListText(text: string, filename = ''): ParsedGeneList {
  // Strip a BOM (Excel's "CSV UTF-8" writes one) and normalise line endings.
  const body = text.replace(/^\uFEFF/, '');
  const trimmed = body.trim();

  if (JSON_EXT.test(filename) || /^[[{]/.test(trimmed)) {
    const asJson = parseJson(trimmed);
    if (asJson) return asJson;
  }

  const lines = body
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (GMT_EXT.test(filename)) return parseGmt(lines);

  const { delimiter, format } = detectDelimiter(lines);
  const rows = lines.map((l) => splitLine(l, delimiter));

  // ONE LINE is a list, whatever separates its names — "POMC, AGRP NPY" has
  // three genes in it — so every cell is split on whitespace as well.
  if (rows.length === 1) {
    const cells = rows[0].flatMap((c) => c.split(/\s+/)).map(cleanCell);
    return { genes: dedupe(cells.filter(looksLikeSymbol)), format, column: null };
  }

  // A whitespace-separated list that wraps ("POMC AGRP NPY" over several
  // lines) is a list, not a two-column table with one column to keep: when no
  // delimiter was found and every cell looks like a symbol, take them all.
  // Delimited tables keep column selection — "POMC,up" is a gene and a label.
  if (delimiter === null && rows.length > 1 && rows.some((r) => r.length > 1)) {
    const cells = rows.flat().filter((c) => c.length > 0);
    if (cells.every(looksLikeSymbol)) return { genes: dedupe(cells), format, column: null };
  }
  return { ...pickGeneColumn(rows), format };
}

function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}

function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Read the first worksheet that has anything on it. */
async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedGeneList> {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(buffer, { type: 'array' });
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    // header: 1 → arrays of cells; raw: false → the displayed text, so a
    // number cell is "1.2" (and rejected as a symbol) rather than 1.2.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false, defval: '' });
    const rows = grid.map((r) => (Array.isArray(r) ? r : []).map((c) => cleanCell(String(c ?? ''))));
    if (rows.some((r) => r.some((c) => c.length > 0))) {
      return { ...pickGeneColumn(rows), format: 'excel', sheet: name };
    }
  }
  return { genes: [], format: 'excel', column: null, sheet: wb.SheetNames[0] };
}

/** Larger than any gene list, smaller than a mistake. */
export const GENE_LIST_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Read a gene list from a file the user handed over. Rejects with a message
 * meant for the screen when the file is too big or cannot be decoded.
 */
export async function parseGeneListFile(file: File): Promise<ParsedGeneList> {
  if (file.size > GENE_LIST_MAX_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB; a gene list should be well under ${GENE_LIST_MAX_BYTES / 1048576} MB.`);
  }
  if (WORKBOOK_EXT.test(file.name)) return parseWorkbook(await readAsArrayBuffer(file));
  return parseGeneListText(await readAsText(file), file.name);
}

/** One sentence on how a list was read, for the report under the file picker. */
export function describeGeneListSource(parsed: ParsedGeneList): string {
  const kind: Record<GeneListFormat, string> = {
    text: 'plain text',
    csv: 'comma-separated table',
    tsv: 'tab-separated table',
    excel: 'Excel workbook',
    gmt: 'GMT gene sets',
    json: 'JSON',
  };
  const parts = [kind[parsed.format]];
  if (parsed.sheet) parts.push(`sheet “${parsed.sheet}”`);
  if (parsed.column) parts.push(`column “${parsed.column}”`);
  else if (parsed.format === 'csv' || parsed.format === 'tsv' || parsed.format === 'excel') parts.push('no header recognised, column chosen by its contents');
  if (parsed.sets != null) parts.push(`${parsed.sets} set${parsed.sets === 1 ? '' : 's'} merged`);
  return parts.join(' · ');
}

// ── Resolving against a dataset ─────────────────────────────────────────────

export interface GeneListResolution {
  /** Symbols to select, in the dataset's own spelling, in list order, no duplicates. */
  found: string[];
  /** Names placed through another name (an alias, a previous or current symbol). */
  redirected: Array<{ from: string; to: string }>;
  /** Names this dataset has nothing for. */
  missing: string[];
  /** Names an alias maps onto several stored symbols. Left out: guessing would select the wrong gene. */
  ambiguous: Array<{ from: string; to: string[] }>;
  /** Names that landed on a symbol already found — case variants, or an alias beside its own symbol. */
  duplicates: number;
}

/**
 * Map a file's names onto the symbols a dataset actually stores.
 *
 * Same policy as the search box, applied to a list: the dataset's own
 * spelling wins (a case-insensitive match IS a match — Pomc finds POMC), then
 * the alias index redirects what is left, and an ambiguous alias fails closed.
 */
export function resolveGeneList(
  names: readonly string[],
  geneNames: readonly string[],
  aliasIndex: AliasIndex | null,
  authority?: NomenclatureAuthority | null,
): GeneListResolution {
  const known = new Map(geneNames.map((g) => [g.toUpperCase(), g] as const));
  const found: string[] = [];
  const seen = new Set<string>();
  const redirected: GeneListResolution['redirected'] = [];
  const missing: string[] = [];
  const ambiguous: GeneListResolution['ambiguous'] = [];
  let duplicates = 0;

  const take = (symbol: string): boolean => {
    if (seen.has(symbol)) { duplicates += 1; return false; }
    seen.add(symbol);
    found.push(symbol);
    return true;
  };

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const own = known.get(name.toUpperCase());
    if (own) { take(own); continue; }
    const via = resolveByOtherName(aliasIndex, name, known, authority);
    if (via.length === 1) {
      if (take(via[0])) redirected.push({ from: name, to: via[0] });
    } else if (via.length > 1) {
      ambiguous.push({ from: name, to: via });
    } else {
      missing.push(name);
    }
  }
  return { found, redirected, missing, ambiguous, duplicates };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export type GeneListSaveFormat = 'txt' | 'csv' | 'xlsx';

/** One row of a saved list: the symbol first, then whatever the view adds (a direction, a statistic). */
export type GeneListRow = { Gene: string } & WorkbookRow;

export const GENE_LIST_SAVE_FORMATS: ReadonlyArray<{ format: GeneListSaveFormat; label: string; hint: string }> = [
  { format: 'txt', label: 'Text (.txt)', hint: 'one symbol per line' },
  { format: 'csv', label: 'CSV (.csv)', hint: 'symbols with their columns' },
  { format: 'xlsx', label: 'Excel (.xlsx)', hint: 'the same table as a workbook' },
];

function csvCell(v: WorkbookRow[string]): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The bytes a saved list carries, for the two text formats. */
export function geneListFileText(rows: readonly GeneListRow[], format: 'txt' | 'csv'): string {
  if (format === 'txt') return rows.map((r) => r.Gene).join('\n').concat(rows.length ? '\n' : '');
  const columns = rows.length ? Object.keys(rows[0]) : ['Gene'];
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))];
  return `${lines.join('\n')}\n`;
}

/**
 * Hand a list to the browser as a file. Never rejects: the workbook path
 * inherits writeWorkbook's contained-failure policy, and the text paths cannot
 * fail past building a string.
 */
export function saveGeneList(
  nameParts: Array<string | undefined>,
  rows: readonly GeneListRow[],
  format: GeneListSaveFormat,
): Promise<void> {
  if (format === 'xlsx') {
    return writeWorkbook(exportFilename(nameParts, 'xlsx'), [{ name: 'GeneList', rows }]);
  }
  const mime = format === 'csv' ? 'text/csv' : 'text/plain';
  downloadFile(
    exportFilename(nameParts, format),
    `data:${mime};charset=utf-8,${encodeURIComponent(geneListFileText(rows, format))}`,
  );
  return Promise.resolve();
}
