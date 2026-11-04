import { loadXLSX } from '../utils/lazyExport';
import type { ColumnField, ColumnMapping, ImportKind, ImportOptions, ImportSheet, LocalGene, LocalPathway, NormalizedImport } from './types';

export const LOCAL_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const LOCAL_MAX_ROWS = 250_000;
const MAX_COLUMNS = 512;
const MISSING = /^(?:na|n\/a|nan|null|none|undefined|\.|-)$/i;
let sheetSequence = 0;

/** Ordered aliases make a conventional unshrunk effect/Wald test the default. */
const ALIASES: Record<ColumnField, string[]> = {
  gene: ['genesymbol', 'symbol', 'genename', 'gene', 'hgncsymbol', 'mgiSymbol', 'externalgenename', 'feature', 'targetid', 'geneid', 'ensemblgeneid', 'ensembl', 'entrezid', 'id'],
  geneId: ['geneid', 'ensemblgeneid', 'ensemblid', 'ensembl', 'entrezgeneid', 'entrezid', 'entrez', 'featureid'],
  logFC: ['log2foldchange', 'waldlog2foldchange', 'logfc', 'log2fc', 'avglog2fc', 'avglogfc', 'logfoldchange', 'log2foldchangeunshrunk', 'lfc', 'apeglmlfc', 'log2foldchangeshrunk'],
  pvalue: ['pvalue', 'pval', 'waldpvalue', 'p', 'pvaluewald', 'nompval', 'nominalpvalue', 'rawpvalue', 'pvalues'],
  padj: ['padj', 'fdr', 'adjpval', 'adjpvalue', 'adjustedpvalue', 'adjustedpval', 'padjust', 'pvaladj', 'waldpadj', 'qvalue', 'fdrqval', 'qval', 'bhadjustedpvalue', 'falseDiscoveryRate'],
  pathway: ['pathway', 'pathwayid', 'gsname', 'geneset', 'genesetname', 'termid', 'id', 'description', 'term', 'name', 'pathwayname'],
  pathwayName: ['description', 'pathwayname', 'termname', 'name', 'term', 'gsdescription'],
  nes: ['nes', 'normalizedenrichmentscore', 'normalisedenrichmentscore'],
  size: ['size', 'setsize', 'genesetsize', 'pathwaysize', 'count', 'overlapcount'],
  leadingEdge: ['leadingedgesymbol', 'leadingedgesymbols', 'coreenrichmentsymbol', 'leadingedge', 'coreenrichment', 'geneid', 'genes', 'genesymbols', 'overlappinggenes', 'overlapgenes', 'leadingedgeensembl'],
  database: ['database', 'db', 'collection', 'category', 'source', 'ontology'],
};

const headerKey = (value: string): string => value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (value: unknown): string => String(value ?? '').replace(/^\uFEFF/, '').trim();
const absent = (value: string): boolean => !value || MISSING.test(value);

export function suggestKind(headers: readonly string[]): ImportKind {
  const keys = headers.map(headerKey);
  if (keys.some((key) => ['pathway', 'pathwayid', 'nes', 'normalizedenrichmentscore', 'coreenrichment', 'generatio', 'leadingedge', 'leadingedgesymbol', 'gsname', 'geneset', 'genesetname'].includes(key))) return 'pathway';
  // ORA tools such as Enrichr use Term/Genes and omit a signed effect entirely.
  if (keys.some((key) => ['term', 'description'].includes(key)) && keys.some((key) => ['genes', 'geneid', 'overlappinggenes', 'overlap', 'count'].includes(key)) && !keys.some((key) => ALIASES.logFC.includes(key))) return 'pathway';
  return 'de';
}

export function suggestMapping(headers: readonly string[], kind: ImportKind = suggestKind(headers)): ColumnMapping {
  const keys = headers.map(headerKey);
  const fields: ColumnField[] = kind === 'de'
    ? ['gene', 'geneId', 'logFC', 'pvalue', 'padj']
    : ['pathway', 'pathwayName', 'nes', 'pvalue', 'padj', 'size', 'leadingEdge', 'database'];
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    for (const alias of ALIASES[field]) {
      const index = keys.indexOf(alias.toLowerCase());
      if (index !== -1) { mapping[field] = index; break; }
    }
  }
  return mapping;
}

/** Preserve empty headers as numbered columns so R row-name columns can be mapped. */
export function getSheetHeaders(sheet: ImportSheet, headerRow = sheet.headerRow): string[] {
  const row = sheet.rows[headerRow] ?? [];
  const width = Math.max(row.length, ...sheet.rows.slice(headerRow + 1, headerRow + 6).map((value) => value.length));
  return Array.from({ length: width }, (_, index) => clean(row[index]) || `Column ${index + 1}`);
}

function headerScore(row: string[]): number {
  const kind = suggestKind(row);
  const mapping = suggestMapping(row, kind);
  let score = Object.keys(mapping).length;
  if (kind === 'de' && mapping.logFC != null) score += 5;
  if (kind === 'pathway' && mapping.pathway != null) score += 4;
  if (mapping.padj != null || mapping.pvalue != null) score += 3;
  return score;
}

function makeSheet(rows: string[][], fileName: string, name: string): ImportSheet {
  if (rows.length > LOCAL_MAX_ROWS + 100) throw new Error(`${fileName}: tables are limited to ${LOCAL_MAX_ROWS.toLocaleString()} rows. Split this table before importing.`);
  if (rows.some((row) => row.length > MAX_COLUMNS)) throw new Error(`${fileName}: a table has more than ${MAX_COLUMNS} columns. Select a results table with fewer columns.`);
  let headerRow = rows.findIndex((row) => row.some((value) => value.trim()));
  if (headerRow < 0) headerRow = 0;
  let bestScore = headerScore(rows[headerRow] ?? []);
  for (let index = 0; index < Math.min(rows.length, 100); index += 1) {
    const score = headerScore(rows[index]);
    if (score > bestScore) { bestScore = score; headerRow = index; }
  }
  const sheet: ImportSheet = { id: `import-${Date.now()}-${++sheetSequence}`, fileName, name, rows, headerRow, kind: 'de', mapping: {} };
  const headers = getSheetHeaders(sheet);
  sheet.kind = suggestKind(headers);
  sheet.mapping = suggestMapping(headers, sheet.kind);
  // R write.csv commonly leaves the row-name header empty. Only suggest it
  // when the rest of the header clearly identifies a DE results table.
  if (sheet.kind === 'de' && sheet.mapping.gene == null && sheet.mapping.logFC != null && !clean(rows[headerRow]?.[0])) {
    const identifiers = rows.slice(headerRow + 1, headerRow + 11).map((row) => clean(row[0])).filter(Boolean);
    if (identifiers.length && identifiers.every((value) => /[A-Za-z]/.test(value))) sheet.mapping.gene = 0;
  }
  return sheet;
}

/** RFC-style quoted cells, including embedded line breaks and doubled quotes. */
export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  const pushRow = () => {
    row.push(cell.trim());
    rows.push(row);
    if (rows.length > LOCAL_MAX_ROWS + 100) throw new Error(`Tables are limited to ${LOCAL_MAX_ROWS.toLocaleString()} rows. Split this table before importing.`);
    row = []; cell = ''; afterQuote = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
      continue;
    }
    if (char === '"' && !cell.trim() && !afterQuote) { cell = ''; quoted = true; continue; }
    const separator = delimiter === 'whitespace' ? /[\t ]/.test(char) : char === delimiter;
    if (separator) {
      if (delimiter === 'whitespace' && !cell && !afterQuote) continue;
      row.push(cell.trim()); cell = ''; afterQuote = false;
      if (row.length > MAX_COLUMNS) throw new Error(`A table has more than ${MAX_COLUMNS} columns.`);
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      if (afterQuote && char.trim()) throw new Error('A quoted cell has text after its closing quote. Check the file delimiter and quoting.');
      cell += char;
    }
  }
  if (quoted) throw new Error('The file contains an unclosed quoted cell. Save it again as CSV or TSV.');
  if (cell || row.length || afterQuote) pushRow();
  return rows;
}

function detectDelimiter(text: string, fileName: string): string {
  // Count separators outside quotes. Tabs take precedence when CSV-like gene
  // lists occur inside a TSV column. Filename only breaks otherwise equal scores.
  const counts = new Map<string, number[]>([['\t', []], [',', []], [';', []]]);
  const current = new Map<string, number>([['\t', 0], [',', 0], [';', 0]]);
  let quoted = false;
  let lines = 0;
  for (let index = 0; index < text.length && lines < 100; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && current.has(char)) current.set(char, current.get(char)! + 1);
    else if (!quoted && (char === '\n' || char === '\r')) {
      for (const [delimiter, count] of current) { counts.get(delimiter)!.push(count); current.set(delimiter, 0); }
      lines += 1;
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    }
  }
  for (const [delimiter, count] of current) if (count) counts.get(delimiter)!.push(count);
  let winner = 'whitespace';
  let best = 0;
  for (const [delimiter, values] of counts) {
    const frequency = new Map<number, number>();
    for (const count of values) if (count > 0) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const modes = [...frequency.entries()];
    const mode = modes.sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (!mode) continue;
    const preferred = (/\.csv$/i.test(fileName) && delimiter === ',') || (/\.tsv$/i.test(fileName) && delimiter === '\t');
    const score = mode[1] * 10 + Math.min(mode[0], 20) / 20 + (preferred ? 0.1 : 0);
    if (score > best) { best = score; winner = delimiter; }
  }
  return winner;
}

export function parseLocalText(text: string, fileName = 'data.txt'): ImportSheet {
  const rows = parseDelimitedRows(text, detectDelimiter(text, fileName));
  if (!rows.some((row) => row.some((cell) => cell.trim()))) throw new Error(`${fileName} is empty.`);
  return makeSheet(rows, fileName, fileName);
}

export async function parseLocalWorkbook(buffer: ArrayBuffer, fileName = 'data.xlsx'): Promise<ImportSheet[]> {
  const XLSX = await loadXLSX();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: false, sheetRows: LOCAL_MAX_ROWS + 101 });
  const sheets: ImportSheet[] = [];
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    // raw:true retains full numeric precision instead of Excel's display rounding.
    const range = worksheet['!fullref'] ?? worksheet['!ref'];
    if (range) {
      const bounds = XLSX.utils.decode_range(range);
      if (bounds.e.r > LOCAL_MAX_ROWS + 99 || bounds.e.c >= MAX_COLUMNS) throw new Error(`${fileName}, ${name}: the worksheet exceeds ${LOCAL_MAX_ROWS.toLocaleString()} rows or ${MAX_COLUMNS} columns. Split the results table before importing.`);
    }
    const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, blankrows: true, defval: '', range: 0 });
    const rows = grid.map((row) => row.map(clean));
    if (rows.some((row) => row.some(Boolean))) sheets.push(makeSheet(rows, fileName, name));
  }
  if (!sheets.length) throw new Error(`${fileName} has no non-empty worksheets.`);
  return sheets;
}

function readFile(file: File, binary: true): Promise<ArrayBuffer>;
function readFile(file: File, binary: false): Promise<string>;
function readFile(file: File, binary: boolean): Promise<ArrayBuffer | string> {
  if (binary && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  if (!binary && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result == null) reject(new Error(`${file.name} could not be read.`));
      else resolve(reader.result);
    };
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    if (binary) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });
}

/** File bytes are read directly in the browser. No fetch, form post, or upload. */
export async function parseLocalFile(file: File): Promise<ImportSheet[]> {
  if (file.size > LOCAL_FILE_MAX_BYTES) throw new Error(`${file.name} exceeds the ${LOCAL_FILE_MAX_BYTES / 1048576} MB file limit. Split it into smaller results files.`);
  if (/\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(file.name)) return parseLocalWorkbook(await readFile(file, true), file.name);
  if (!/\.(csv|tsv|txt|tab)$/i.test(file.name)) throw new Error('Choose a CSV, TSV, TXT, TAB, XLSX, XLS, XLSM, XLSB, or ODS results file.');
  return [parseLocalText(await readFile(file, false), file.name)];
}

export function validateMapping(kind: ImportKind, mapping: ColumnMapping): string[] {
  const issues: string[] = [];
  if (kind === 'de') {
    if (mapping.gene == null && mapping.geneId == null) issues.push('Choose a gene symbol or gene identifier column.');
    if (mapping.logFC == null) issues.push('Choose a log2 fold-change column.');
  } else if (mapping.pathway == null && mapping.pathwayName == null) issues.push('Choose a pathway identifier or name column.');
  for (const index of Object.values(mapping)) {
    if (index != null && (!Number.isInteger(index) || index < 0)) { issues.push('Column positions must be valid columns in this table.'); break; }
  }
  const fields: ColumnField[] = kind === 'de' ? [mapping.gene == null ? 'geneId' : 'gene', 'logFC', 'pvalue', 'padj'] : [mapping.pathway == null ? 'pathwayName' : 'pathway', 'nes', 'pvalue', 'padj', 'size', 'leadingEdge', 'database'];
  const used = new Set<number>();
  for (const field of fields) {
    const index = mapping[field];
    if (index == null) continue;
    if (used.has(index)) { issues.push('Choose a different column for each statistic and identifier.'); break; }
    used.add(index);
  }
  return issues;
}

/** No partial parseFloat coercion: '0.01*', '<0.05', Infinity and blanks are unavailable. */
export function parseLocalNumber(value: string): number | null {
  const trimmed = clean(value).replace(/\u2212/g, '-');
  if (absent(trimmed) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function parseLeadingEdge(value: string): string[] {
  let text = clean(value);
  if (absent(text)) return [];
  text = text.replace(/^c\s*\((.*)\)$/s, '$1').replace(/^\[(.*)\]$/s, '$1');
  return [...new Set(text.split(/[\s,;|/]+/).map((item) => item.replace(/^["']|["']$/g, '').trim()).filter((item) => !absent(item)))];
}

function inferDatabase(pathway: string, fileName: string): string {
  const label = `${pathway} ${fileName}`.toUpperCase();
  if (/HALLMARK/.test(label)) return 'HALLMARK';
  if (/REACTOME|R-HSA-|R-MMU-/.test(label)) return 'REACTOME';
  if (/KEGG|(?:^|\W)(?:HSA|MMU)\d{5}/.test(label)) return 'KEGG';
  if (/GOBP|GO[_ -]?BP/.test(label)) return 'GO_BP';
  if (/GOMF|GO[_ -]?MF/.test(label)) return 'GO_MF';
  if (/GOCC|GO[_ -]?CC/.test(label)) return 'GO_CC';
  if (/^GO:\d+/.test(pathway)) return 'GO';
  return 'Custom';
}

export function normalizeSheet(sheet: ImportSheet, options: ImportOptions = sheet): NormalizedImport {
  const { headerRow, kind, mapping } = options;
  const errors = validateMapping(kind, mapping);
  if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= sheet.rows.length) errors.push('Choose a valid header row.');
  const width = getSheetHeaders(sheet, headerRow).length;
  if (Object.values(mapping).some((index) => index != null && index >= width)) errors.push('A mapped column is outside this table.');
  if (errors.length) throw new Error(errors.join(' '));
  const genes: LocalGene[] = [];
  const pathways: LocalPathway[] = [];
  const counts = new Map<string, number>();
  const count = (message: string) => counts.set(message, (counts.get(message) ?? 0) + 1);
  const source = `${sheet.fileName} / ${sheet.name}`;
  const seen = new Set<string>();
  let skippedRows = 0;
  const at = (row: string[], field: ColumnField) => mapping[field] == null ? '' : clean(row[mapping[field]!]);
  const statistic = (row: string[], field: 'pvalue' | 'padj' | 'nes' | 'size'): number | null => {
    if (mapping[field] == null) return null;
    const text = at(row, field);
    const value = parseLocalNumber(text);
    const valid = value != null && ((field === 'pvalue' || field === 'padj') ? value >= 0 && value <= 1 : field === 'size' ? value >= 0 && Number.isInteger(value) : true);
    if (!valid) { count(`${field} values were missing or invalid and remain unavailable`); return null; }
    return value;
  };
  for (const row of sheet.rows.slice(headerRow + 1)) {
    if (!row.some((value) => value.trim())) continue;
    if (kind === 'de') {
      const symbol = at(row, 'gene');
      const geneId = at(row, 'geneId');
      const gene = !absent(symbol) ? symbol : !absent(geneId) ? geneId : '';
      const logFC = parseLocalNumber(at(row, 'logFC'));
      if (!gene || logFC == null) { skippedRows += 1; count('rows were skipped because their gene or log2 fold change was missing or invalid'); continue; }
      if (seen.has(gene)) { skippedRows += 1; count('duplicate gene rows were skipped; the first valid row was retained'); continue; }
      seen.add(gene);
      genes.push({ gene, ...(!absent(geneId) ? { geneId } : {}), logFC, pvalue: statistic(row, 'pvalue'), padj: statistic(row, 'padj'), source });
    } else {
      const pathwayId = at(row, 'pathway');
      const pathwayName = at(row, 'pathwayName');
      const pathway = !absent(pathwayId) ? pathwayId : !absent(pathwayName) ? pathwayName : '';
      if (!pathway) { skippedRows += 1; count('rows were skipped because their pathway identifier and name were missing'); continue; }
      const database = at(row, 'database') || inferDatabase(pathway, `${sheet.fileName} ${sheet.name}`);
      const key = `${database}\u0000${pathway}`;
      if (seen.has(key)) { skippedRows += 1; count('duplicate pathway rows were skipped; the first valid row was retained'); continue; }
      seen.add(key);
      pathways.push({ pathway, name: absent(pathwayName) ? pathway : pathwayName, nes: statistic(row, 'nes'), pvalue: statistic(row, 'pvalue'), padj: statistic(row, 'padj'), size: statistic(row, 'size'), genes: parseLeadingEdge(at(row, 'leadingEdge')), database, source });
    }
  }
  const issues = [...counts].map(([message, countValue]) => `${countValue.toLocaleString()} ${message}.`);
  if (mapping.padj == null) issues.push('No adjusted p-value column is mapped. Adjusted significance is unavailable; raw p-values are not substituted.');
  if (kind === 'pathway' && mapping.nes == null) issues.push('No normalized enrichment score is mapped. These pathways have no enrichment direction.');
  if (kind === 'pathway' && mapping.leadingEdge == null) issues.push('No pathway gene column is mapped. Gene-to-pathway links are unavailable for this table.');
  if (!genes.length && !pathways.length) issues.push('No valid result rows were found. Check the header row and column mapping.');
  return {
    genes, pathways, issues, skippedRows,
    source: { fileName: sheet.fileName, sheetName: sheet.name, kind, rowCount: genes.length + pathways.length, importedAt: new Date().toISOString(), headerRow, mapping: { ...mapping } },
  };
}
