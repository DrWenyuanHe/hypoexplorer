import type { LocalDataset, LocalGene, LocalPathway } from './types';

export type LocalEvidenceStatus =
  | 'up'
  | 'down'
  | 'enriched'
  | 'below'
  | 'unknown'
  | 'missing'
  | 'species-mismatch';

export const EVIDENCE_LABEL: Record<LocalEvidenceStatus, string> = {
  up: 'Up',
  down: 'Down',
  enriched: 'Enriched, no direction',
  below: 'Below cutoff',
  unknown: 'Adjusted P unavailable',
  missing: 'Not in imported table',
  'species-mismatch': 'Different or unknown species',
};

const ORGANISM_NAMES: Record<string, string> = {
  human: 'homo sapiens',
  mouse: 'mus musculus',
  rat: 'rattus norvegicus',
  'cynomolgus macaque': 'macaca fascicularis',
  'rhesus macaque': 'macaca mulatta',
};
function organismKey(value: string): string | null {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    [
      '',
      'unknown',
      'unspecified',
      'other',
      'other / unknown',
      'other/unknown',
      'macaque',
      'monkey',
    ].includes(key)
  )
    return null;
  return ORGANISM_NAMES[key] ?? key;
}
export function sameOrganism(a: string, b: string): boolean {
  const left = organismKey(a);
  return left !== null && left === organismKey(b);
}

/** Letter case is formatting; aliases and identifier version suffixes are preserved. */
export function geneKey(value: string): string {
  return value.trim().toUpperCase();
}

export function geneStatus(
  row: LocalGene | undefined,
  cutoff: number,
  minAbsLogFC = 0,
): LocalEvidenceStatus {
  if (!row) return 'missing';
  if (row.padj === null || !Number.isFinite(row.padj)) return 'unknown';
  if (row.padj >= cutoff || Math.abs(row.logFC) <= minAbsLogFC) return 'below';
  return row.logFC > 0 ? 'up' : 'down';
}

export function pathwayStatus(row: LocalPathway | undefined, cutoff: number): LocalEvidenceStatus {
  if (!row) return 'missing';
  if (row.padj === null || !Number.isFinite(row.padj)) return 'unknown';
  if (row.padj >= cutoff || row.nes === 0) return 'below';
  if (row.nes === null) return 'enriched';
  return row.nes > 0 ? 'up' : 'down';
}

export function pathwayKey(row: Pick<LocalPathway, 'pathway' | 'database'>): string {
  return JSON.stringify([row.database.trim().toLowerCase(), row.pathway.trim()]);
}

export interface LocalEvidence<T> {
  dataset: LocalDataset;
  row: T | undefined;
  status: LocalEvidenceStatus;
  matches: number;
}

// A supplied table can contain repeated symbols or pathway IDs. Show the row
// with the smallest available adjusted P, and expose the number of matches.
function representative<T extends { padj: number | null }>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((best, row) => {
    if (!best) return row;
    return (row.padj ?? Number.POSITIVE_INFINITY) < (best.padj ?? Number.POSITIVE_INFINITY)
      ? row
      : best;
  }, undefined);
}

export function geneEvidence(
  datasets: LocalDataset[],
  gene: string,
  organism: string,
  cutoff: number,
  minAbsLogFC = 0,
  sourceDatasetId?: string,
): LocalEvidence<LocalGene>[] {
  return datasets.map((dataset) => {
    if (dataset.id !== sourceDatasetId && !sameOrganism(dataset.organism, organism))
      return { dataset, row: undefined, status: 'species-mismatch', matches: 0 };
    const rows = dataset.genes.filter((row) => geneKey(row.gene) === geneKey(gene));
    const row = representative(rows);
    return { dataset, row, status: geneStatus(row, cutoff, minAbsLogFC), matches: rows.length };
  });
}

export function pathwayEvidence(
  datasets: LocalDataset[],
  pathway: Pick<LocalPathway, 'pathway' | 'database'>,
  organism: string,
  cutoff: number,
  sourceDatasetId?: string,
): LocalEvidence<LocalPathway>[] {
  const key = pathwayKey(pathway);
  return datasets.map((dataset) => {
    if (dataset.id !== sourceDatasetId && !sameOrganism(dataset.organism, organism))
      return { dataset, row: undefined, status: 'species-mismatch', matches: 0 };
    const rows = dataset.pathways.filter((row) => pathwayKey(row) === key);
    const row = representative(rows);
    return { dataset, row, status: pathwayStatus(row, cutoff), matches: rows.length };
  });
}

/** Missing values remain last in either sort direction. */
export function compareNullable(a: number | null, b: number | null, direction: number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return (a - b) * direction;
}
