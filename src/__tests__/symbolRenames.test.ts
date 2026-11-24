import { describe, it, expect } from 'vitest';
import {
  buildSymbolRenames, pickStoredMember, renameAuthorityOf, renameGroupOf, renameGroupsFor, renamePartners,
} from '../data/symbolRenames';
import { compareCell } from '../compare/compareCell';
import { compareSummaryRows } from '../compare/compareSummary';
import { resolveGeneCI } from '../compare/resolveGene';
import { renamedStudies } from '../crossdataset/GeneReport';
import { geneRow } from '../data/crossDatasetRows';
import { BULK_DATASET_FIXTURE, MACAQUE_DATASET, makePopData } from './fixtures';
import type { CompareColumn } from '../compare/compareColumns';
import type { DatasetGroup, PopData } from '../types';

// MGI renamed Gm8773 to Fam237b; HGNC renamed AARS to AARS1. The payload names
// its authorities once and refers to them by position.
const PAYLOAD = {
  v: 1,
  authorities: ['HGNC', 'MGI'],
  groups: [[0, 'AARS1', 'AARS'], [1, 'Fam237b', 'Gm8773'], [1, 'Newa', 'Olda', 'Oldb']],
};
const renames = buildSymbolRenames(PAYLOAD)!;

describe('the rename table', () => {
  it('decodes groups into case-insensitive members per authority', () => {
    expect(renameGroupOf(renames, 'GM8773', 'MGI')).toEqual({
      authority: 'MGI', current: 'Fam237b', retired: ['Gm8773'], members: ['Fam237b', 'Gm8773'],
    });
    expect(renamePartners(renames, 'fam237b', 'MGI')).toEqual(['Gm8773']);
    expect(renamePartners(renames, 'Olda', 'MGI')).toEqual(['Newa', 'Oldb']);
  });

  it('keeps each group in its own authority', () => {
    expect(renameGroupOf(renames, 'Gm8773', 'HGNC')).toBeNull();
    expect(renameGroupOf(renames, 'AARS', 'MGI')).toBeNull();
    expect(renameGroupOf(renames, 'Gm8773', null)).toBeNull();
    expect(renameGroupsFor(renames, 'aars').map((g) => g.authority)).toEqual(['HGNC']);
  });

  it('reads a payload it cannot decode as no table at all', () => {
    expect(buildSymbolRenames(null)).toBeNull();
    expect(buildSymbolRenames({ ...PAYLOAD, v: 2 })).toBeNull();
    expect(buildSymbolRenames({ v: 1, authorities: [], groups: [] })).toBeNull();
    // An authority this build does not know is dropped rather than guessed at.
    const unknown = buildSymbolRenames({ v: 1, authorities: ['NCBI Gene (Felis catus)', 'MGI'], groups: [[0, 'A', 'B'], [1, 'C', 'D']] });
    expect(renameGroupOf(unknown, 'C', 'MGI')?.current).toBe('C');
    expect([...unknown!.byMember.keys()]).toHaveLength(2);
  });

  it('maps a study to the authority of its stored symbols', () => {
    expect(renameAuthorityOf(BULK_DATASET_FIXTURE)).toBe('MGI');
    expect(renameAuthorityOf(MACAQUE_DATASET)).toBe('HGNC');
    expect(renameAuthorityOf(undefined)).toBeNull();
  });

  it('lets one stored partner answer, several only through the current symbol', () => {
    const group = renameGroupOf(renames, 'Newa', 'MGI')!;
    expect(pickStoredMember([{ symbol: 'Oldb', value: 1 }], group)?.value).toBe(1);
    expect(pickStoredMember([{ symbol: 'Olda', value: 1 }, { symbol: 'NEWA', value: 2 }], group)?.value).toBe(2);
    expect(pickStoredMember([{ symbol: 'Olda', value: 1 }, { symbol: 'Oldb', value: 2 }], group)).toBeNull();
    expect(pickStoredMember([], group)).toBeNull();
  });
});

describe('Compare columns read renamed symbols', () => {
  const column = (key: string): CompareColumn => ({ key, label: key, color: '#000', qc: null });
  const stored = (dataset: PopData['dataset']) => makePopData({
    dataset,
    de: [{ gene: 'Gm8773', logFC: 1.25, PValue: 0.001, FDR: 0.01 }],
    cpm: { Gm8773: [10, 20, 30, 40] },
  });
  const popDataMap: Record<string, PopData | null> = {
    mouse: stored(BULK_DATASET_FIXTURE),
    macaque: stored(MACAQUE_DATASET),
  };

  it('measures a mouse column under the symbol it stores', () => {
    const cell = compareCell(column('mouse'), popDataMap, 'Fam237b', renames);
    expect(cell.kind).toBe('measured');
    expect(cell.kind === 'measured' && [cell.gene, cell.de.logFC]).toEqual(['Gm8773', 1.25]);
  });

  it('does not read a group outside the column\'s authority, or without the table', () => {
    expect(compareCell(column('macaque'), popDataMap, 'Fam237b', renames).kind).toBe('not-detected');
    expect(compareCell(column('mouse'), popDataMap, 'Fam237b').kind).toBe('not-detected');
    expect(resolveGeneCI(popDataMap.mouse, 'Fam237b', null)).toBeUndefined();
  });

  it('prefers the stored queried symbol over any partner', () => {
    const both = makePopData({
      dataset: BULK_DATASET_FIXTURE,
      de: [{ gene: 'Gm8773', logFC: 9, PValue: 0.5, FDR: 0.9 }, { gene: 'Fam237b', logFC: 1, PValue: 0.01, FDR: 0.05 }],
      cpm: { Gm8773: [1, 1, 1, 1], Fam237b: [1, 2, 3, 4] },
    });
    expect(resolveGeneCI(both, 'FAM237B', renames)?.gene).toBe('Fam237b');
  });

  it('carries the same reading into the compare-set summary sheet', () => {
    const [row] = compareSummaryRows([column('mouse')], popDataMap, ['Fam237b'], { tally: true, renames });
    expect(row).toMatchObject({ Gene: 'Fam237b', Detected: 1, mouse_logFC: 1.25 });
  });
});

describe('the gene page names the studies read under another symbol', () => {
  const track = (trackId: string, storedAs?: string) => geneRow({
    trackId, label: trackId, type: 'Tissue', logFC: 1, fdr: 0.01, pval: 0.001, se: null, lowPower: false,
    ...(storedAs ? { storedAs } : {}),
  });
  it('counts studies, not tracks, per stored symbol and authority', () => {
    const groups: DatasetGroup[] = [
      { dataset: BULK_DATASET_FIXTURE, contrast: null, tracks: [track('a', 'Gm8773'), track('b', 'Gm8773')] },
      { dataset: { ...BULK_DATASET_FIXTURE, id: 'other' }, contrast: null, tracks: [track('c', 'Gm8773'), track('d')] },
      { dataset: MACAQUE_DATASET, contrast: null, tracks: [track('x')] },
    ];
    expect(renamedStudies(groups)).toEqual([{ symbol: 'Gm8773', authority: 'MGI', studies: 2 }]);
    expect(renamedStudies([])).toEqual([]);
  });
});
