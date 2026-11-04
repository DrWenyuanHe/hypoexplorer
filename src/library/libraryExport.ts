// "Export view as CSV" for the dataset library: the rows on screen, in the order
// on screen, with the same three-state counts the table draws.
//
// Pure apart from `downloadCsv`, so the column contract can be tested without a
// DOM. An unmeasured count is an EMPTY cell, never 0: zero is a finding, and a
// spreadsheet reader cannot see the em dash's tooltip explaining the difference.

import type { DatasetCard } from '../data/datasetCatalog';

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

function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function libraryCsv(cards: readonly DatasetCard[]): string {
  const lines = [COLUMNS.map(([h]) => h).join(',')];
  for (const card of cards) lines.push(COLUMNS.map(([, get]) => cell(get(card))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel reads the en dashes and Greek letters in study names as UTF-8.
  const blob = new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
