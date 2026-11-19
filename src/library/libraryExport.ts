// "Export view as CSV" for the dataset library: the rows on screen, in the order
// on screen, with the same three-state counts the table draws.
//
// The column contract lives here; the bytes and the download belong to the CSV
// seam (utils/csv.ts). An unmeasured count is an EMPTY cell, never 0: zero is a
// finding, and a spreadsheet reader cannot see the em dash's tooltip explaining
// the difference.

import type { DatasetCard } from '../data/datasetCatalog';
import { writeCsv } from '../utils/csv';
import { exportFilename } from '../utils/exportAction';

const COLUMNS: ReadonlyArray<[header: string, value: (c: DatasetCard) => string | number | null | undefined]> = [
  ['dataset_id', (c) => c.dataset.id],
  ['study', (c) => c.dataset.name],
  ['category', (c) => c.dataset.category],
  ['organism', (c) => c.dataset.organism],
  ['region', (c) => c.dataset.region],
  ['perturbation', (c) => c.dataset.perturbation],
  ['preparation', (c) => c.dataset.preparation],
  ['baseline_arm', (c) => c.baselineGroup?.label],
  ['case_arm', (c) => c.caseGroup?.label],
  ['n_baseline', (c) => c.nBaseline],
  ['n_case', (c) => c.nCase],
  ['n_varies_across_tracks', (c) => (c.nBaseline == null ? null : c.nVaries ? 'yes' : 'no')],
  ['significant_genes', (c) => c.discoveries?.genes],
  ['genes_tested', (c) => c.discoveries?.genesTested],
  ['significant_pathways', (c) => c.discoveries?.paths],
  ['pathways_tested', (c) => c.discoveries?.pathsTested],
  ['tracks', (c) => c.trackCount],
  ['accession', (c) => c.dataset.geo],
  ['doi', (c) => c.dataset.doi],
  ['citation', (c) => c.dataset.citation],
];

/** Download the library rows as `hypoexplorer-studies-<YYYY-MM-DD>.csv`, stamped with `now`'s UTC date. */
export function exportLibraryCsv(cards: readonly DatasetCard[], now: Date = new Date()): void {
  writeCsv(
    exportFilename([`hypoexplorer-studies-${now.toISOString().slice(0, 10)}`], 'csv'),
    COLUMNS.map(([header]) => header),
    cards.map((card) => COLUMNS.map(([, get]) => get(card))),
  );
}
