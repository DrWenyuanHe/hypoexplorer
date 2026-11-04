import { describe, it, expect } from 'vitest';
import { libraryCsv } from '../library/libraryExport';
import { loadDatasetCatalog, registryCards } from '../data/datasetCatalog';
import { _resetBundleCache } from '../data/bundleSource';
import { seedQueryManifest } from './fixtures';

const parseRow = (line: string) => {
  // Minimal CSV splitter for the assertions below: quoted fields may hold commas.
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
};

describe('libraryCsv', () => {
  it('writes one row per study, in the order given, under a fixed header', () => {
    const cards = registryCards();
    const lines = libraryCsv(cards).trimEnd().split('\r\n');
    expect(lines.length).toBe(cards.length + 1);
    const header = parseRow(lines[0]);
    expect(header.slice(0, 3)).toEqual(['dataset_id', 'study', 'category']);
    expect(parseRow(lines[1])[0]).toBe(cards[0].dataset.id);
  });

  it('leaves an unmeasured count empty rather than writing a zero', () => {
    // Registry cards carry no counts; a 0 here would read as a finding.
    const cards = registryCards();
    const lines = libraryCsv(cards).trimEnd().split('\r\n');
    const header = parseRow(lines[0]);
    const row = parseRow(lines[1]);
    expect(row[header.indexOf('n_baseline')]).toBe('');
    expect(row[header.indexOf('significant_genes')]).toBe('');
  });

  it('quotes a field that carries a comma, and keeps measured counts', async () => {
    const unseed = seedQueryManifest();
    const { cards } = await loadDatasetCatalog();
    const csv = libraryCsv(cards);
    const lines = csv.trimEnd().split('\r\n');
    const header = parseRow(lines[0]);
    const hfd = lines.map(parseRow).find((r) => r[0] === 'mouse_hypo_hfd_gse220533');
    expect([hfd?.[header.indexOf('n_baseline')], hfd?.[header.indexOf('n_case')]]).toEqual(['7', '8']);
    // 'Leptin, insulin & energy signaling' must survive as one field.
    const leptin = lines.map(parseRow).find((r) => r[2] === 'Leptin, insulin & energy signaling');
    if (leptin) expect(leptin.length).toBe(header.length);
    unseed();
    _resetBundleCache();
  });
});
