/** User-supplied data stays in memory and this browser's IndexedDB. */
export type ImportKind = 'de' | 'pathway';

export type ColumnField = 'gene' | 'geneId' | 'logFC' | 'pvalue' | 'padj' | 'pathway' | 'pathwayName' | 'nes' | 'size' | 'leadingEdge' | 'database';
/** Zero-based column positions. A missing or null entry means unmapped. */
export type ColumnMapping = Partial<Record<ColumnField, number | null>>;

export interface ImportSheet {
  id: string;
  fileName: string;
  name: string;
  /** Original row positions are retained, including blank and preamble rows. */
  rows: string[][];
  headerRow: number;
  kind: ImportKind;
  mapping: ColumnMapping;
}

export interface LocalGene {
  gene: string;
  geneId?: string;
  logFC: number;
  /** Unknown values never become zero or an adjusted p-value. */
  pvalue: number | null;
  padj: number | null;
  source: string;
}

export interface LocalPathway {
  pathway: string;
  name: string;
  /** Only a mapped normalized enrichment score is NES; ORA remains null. */
  nes: number | null;
  pvalue: number | null;
  padj: number | null;
  size: number | null;
  genes: string[];
  database: string;
  source: string;
}

export interface LocalSource {
  fileName: string;
  sheetName: string;
  kind: ImportKind;
  rowCount: number;
  importedAt: string;
  /** Zero-based; the UI displays this plus one. */
  headerRow: number;
  mapping: ColumnMapping;
}

export interface LocalDataset {
  id: string;
  name: string;
  organism: string;
  createdAt: string;
  updatedAt: string;
  genes: LocalGene[];
  pathways: LocalPathway[];
  sources: LocalSource[];
}

export interface ImportOptions {
  headerRow: number;
  kind: ImportKind;
  mapping: ColumnMapping;
}

export interface NormalizedImport {
  genes: LocalGene[];
  pathways: LocalPathway[];
  source: LocalSource;
  issues: string[];
  skippedRows: number;
}
