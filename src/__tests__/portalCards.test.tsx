import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { BaselineSection, ConditionPathwaysSection, FamilySection, GeneExpressionCards, ReferenceAtlasSection, speciesPhrase } from '../search/portalCards';
import { resetSearchSummaries } from '../search/searchSummaries';
import { resetSourceRequests } from '../expression-survey/sourceJson';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { geneRow } from '../data/crossDatasetRows';
import type { QueryManifest, TrackPathwayRow } from '../data/queryIndex';
import type { CrossDatasetGeneReport, Dataset } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MACAQUE = getDataset('macaque_snrna') as Dataset;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533') as Dataset;

/** OXT significant only in macaque PVN. */
function geneReport(): CrossDatasetGeneReport {
  const t = (trackId: string, label: string, logFC: number, pval: number, fdr: number, lowPower = false) =>
    geneRow({ trackId, label, type: '', logFC, pval, fdr, se: 0.2, lowPower });
  return {
    gene: 'OXT', total: 4, loaded: 4,
    groups: [
      { dataset: MACAQUE, contrast: getActiveContrast(MACAQUE), tracks: [t('PVN', 'PVN neurons', 1.8, 1e-6, 2e-4, true), t('ARC', 'ARC neurons', 0.1, 0.4, 0.8)] },
      { dataset: MOUSE, contrast: getActiveContrast(MOUSE), tracks: [t('whole', 'Whole hypothalamus', -0.3, 0.2, 0.6)] },
    ],
  };
}

/** OXT significant in four conditions across two studies; ARC has no pathway analysis, so three are read. */
function fourConditions(): CrossDatasetGeneReport {
  const t = (trackId: string, logFC: number, fdr: number) =>
    geneRow({ trackId, label: `${trackId} cells`, type: '', logFC, pval: fdr / 10, fdr, se: 0.2, lowPower: false });
  return {
    gene: 'OXT', total: 4, loaded: 4,
    groups: [
      { dataset: MACAQUE, contrast: getActiveContrast(MACAQUE), tracks: [t('PVN', 1.8, 2e-4), t('SON', -0.9, 0.004), t('ARC', 0.7, 0.02)] },
      { dataset: MOUSE, contrast: getActiveContrast(MOUSE), tracks: [t('whole', 0.4, 0.03)] },
    ],
  };
}

// The index the condition-pathways card reads: the manifest (whose summaries
// must pass the contrast freshness check) and one file per pathway-capable
// track, keyed by manifest position. Positions 4-39 stand in for the rest of
// the corpus: never followed, they only set the base rates' frame (39
// pathway-capable tracks; ARC at position 2 has no analysis).
const summary = (ds: Dataset) => {
  const c = getActiveContrast(ds);
  return {
    ds: ds.id, trackCount: 1, defaultTrack: ds.defaultTrack, trackLabel: '', nGenes: null,
    nBaseline: null, nCase: null, nVaries: false, lowPowerTracks: 0,
    contrastId: c?.id ?? null, armKeys: c ? [c.baseline.key, c.caseGroup.key] : [],
  };
};
const entry = (ds: Dataset, trackId: string) => ({ ds: ds.id, trackId, label: trackId, type: '', lowPower: false });
function indexManifest(withFamily = true): QueryManifest {
  return {
    v: 2, buildId: 'b1', geneShards: 512, pathwayShards: 256, dbNames: ['GO_BP', 'HALLMARK'],
    tracks: [
      entry(MACAQUE, 'PVN'), entry(MACAQUE, 'SON'), entry(MACAQUE, 'ARC'), entry(MOUSE, 'whole'),
      ...Array.from({ length: 36 }, (_, i) => ({ ds: 'corpus_rest', trackId: `t${i}`, label: '', type: '', lowPower: false })),
    ],
    datasets: [summary(MACAQUE), summary(MOUSE)],
    ...(withFamily ? { trackPathways: { fdr: 0.05, tracks: [0, 1, ...Array.from({ length: 37 }, (_, i) => i + 3)] } } : {}),
  };
}
// Corpus base rates (significant of tested tracks): oxidative phosphorylation
// is enriched almost everywhere (30 of 39), hypoxia in 3 and feeding behaviour
// in 2 tracks, insulin response in 10.
const OXPHOS = (NES: number, padj: number): TrackPathwayRow => ['HALLMARK_OXIDATIVE_PHOSPHORYLATION', NES, padj, 190, 1, 30, 39];
const HYPOXIA = (NES: number, padj: number): TrackPathwayRow => ['HALLMARK_HYPOXIA', NES, padj, 200, 1, 3, 39];
const FEEDING = (NES: number, padj: number): TrackPathwayRow => ['GOBP_FEEDING_BEHAVIOR', NES, padj, 60, 0, 2, 38];
const TRACK_PATHWAYS: Record<number, TrackPathwayRow[]> = {
  0: [HYPOXIA(2, 1e-4), OXPHOS(1.9, 1e-3), FEEDING(-1.5, 0.01)],
  1: [FEEDING(-1.8, 0.002), OXPHOS(1.4, 0.02)],
  3: [['GOBP_RESPONSE_TO_INSULIN', 2.2, 1e-6, 150, 0, 10, 39], HYPOXIA(1.6, 0.03), OXPHOS(1.2, 0.04)],
};

// ── Mocks ───────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  queryGeneViaIndex: vi.fn(),
  queryGeneAcrossDatasets: vi.fn(),
  queryPathwayAcrossDatasets: vi.fn(),
  loadBaselineTeaser: vi.fn(),
  loadFamilyTeaser: vi.fn(),
  loadQueryManifest: vi.fn(),
  loadTrackPathways: vi.fn(),
}));

vi.mock('../search/searchVocabulary', () => ({
  describePathway: (id: string) => ({ db: 'GO_BP', dbLabel: 'GO BP', title: id }),
}));
// The summaries are the real module over a mocked index: these tests prove
// what the cards render from index rows, and that they never take the
// per-track download path.
vi.mock('../data/crossDataset', async (original) => ({
  ...await original<typeof import('../data/crossDataset')>(),
  queryGeneViaIndex: mocks.queryGeneViaIndex,
  queryGeneAcrossDatasets: mocks.queryGeneAcrossDatasets,
  queryPathwayAcrossDatasets: mocks.queryPathwayAcrossDatasets,
}));
vi.mock('../data/queryIndex', async (original) => ({
  ...await original<typeof import('../data/queryIndex')>(),
  loadQueryManifest: mocks.loadQueryManifest,
  loadTrackPathways: mocks.loadTrackPathways,
}));
vi.mock('../search/searchSummaries', async (original) => ({
  ...await original<typeof import('../search/searchSummaries')>(),
  loadBaselineTeaser: mocks.loadBaselineTeaser,
  loadFamilyTeaser: mocks.loadFamilyTeaser,
}));
// The HypoMap export is not checked in; these tests cover where its preview sits, not its data.
vi.mock('../search/hypomap/atlas', async (original) => ({
  ...await original<typeof import('../search/hypomap/atlas')>(),
  loadAtlasGene: async () => ({ state: 'missing' }) as const,
}));

beforeEach(() => {
  resetSearchSummaries();
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.queryGeneViaIndex.mockResolvedValue(geneReport());
  mocks.loadQueryManifest.mockResolvedValue(indexManifest());
  mocks.loadTrackPathways.mockImplementation((_d: Dataset[], _m: QueryManifest, i: number) => Promise.resolve(TRACK_PATHWAYS[i] ?? null));
  mocks.loadBaselineTeaser.mockResolvedValue({
    status: 'available', gene: 'Oxt', populationCount: 15, max: 9000,
    groups: [
      { id: 'Oxytocin-GFP_PVH', populationId: 'HY.PVH_glu_Oxytocin-GFP', label: 'PVH oxytocin', group: null, region: 'PVH', meanTpm: 9000, libraries: 4 },
      { id: 'AVP.QZ20.Ai_sup', populationId: 'HY.SO_glu_AVP.QZ20', label: 'SO AVP', group: 'AVP.QZ20.Ai_sup', region: 'SO', meanTpm: 1200, libraries: 2 },
    ],
  });
  mocks.loadFamilyTeaser.mockImplementation(async (_symbol: string, family: string) => (family === 'studies'
    ? {
      measured: 3, total: 18, unit: 'CPM (TMM-normalized)', inUnit: 2,
      unread: 0, species: ['Mus musculus'],
      levels: [
        { sourceId: 'oxt-study', label: 'Hypothalamic OXT', study: 'GSE242245', cohort: 'Vehicle', mean: 812.5, n: 4 },
        { sourceId: 'crh-study', label: 'PVN CRH', study: 'GSE174085', cohort: 'Control rearing', mean: 40, n: 14 },
      ],
    }
    : { measured: 0, total: 6, unit: '', inUnit: 0, levels: [], unread: 0, species: ['Mus musculus', 'Rattus norvegicus', 'Sus scrofa'] }));
});

// ── Condition pathways ──────────────────────────────────────────────────────

describe('ConditionPathwaysSection', () => {
  function renderSection(studies?: readonly Dataset[] | null) {
    const props = { onShowPathway: vi.fn(), onOpenPathway: vi.fn() };
    const view = render(<ConditionPathwaysSection symbol="OXT" studies={studies} {...props} />);
    return { ...props, view };
  }
  const section = () => document.querySelector('[data-section="condition-pathways"]') as HTMLElement | null;
  const slot = () => document.querySelector('[data-slot="condition-pathways"]') as HTMLElement | null;

  /** The settled card, its pathway rows (tbody) and its condition column headings. */
  const matrix = async () => {
    const cp = await waitFor(() => {
      const el = section();
      expect(el?.querySelector('.portal-verdict')).toBeTruthy();
      return el as HTMLElement;
    });
    return {
      cp,
      rows: [...cp.querySelectorAll<HTMLTableRowElement>('table.cp-matrix tbody tr')],
      heads: [...cp.querySelectorAll<HTMLTableCellElement>('tr.cp-heads th.cp-cond')],
    };
  };
  const verdict = (cp: HTMLElement) => cp.querySelector('.portal-verdict')?.textContent;
  const names = (rows: HTMLTableRowElement[]) => rows.map((r) => r.cells[0].querySelector('button')?.textContent);
  /** Each condition cell's text in column order (the row header and count cell dropped). */
  const cellTexts = (row: HTMLTableRowElement) => [...row.querySelectorAll('td.cp-cell')].map((td) => td.textContent);
  const countCell = (row: HTMLTableRowElement) => row.querySelector('td.cp-count') as HTMLTableCellElement;
  const followed = () => mocks.loadTrackPathways.mock.calls.map((c) => c[2]).sort();

  const OBESE = getActiveContrast(MACAQUE)?.caseGroup.label;
  const HFD = getActiveContrast(MOUSE)?.caseGroup.label;

  it('follows the gene to its conditions and ranks pathways by specificity to them', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    const { onShowPathway, onOpenPathway } = renderSection();
    const { cp, rows, heads } = await matrix();
    expect(verdict(cp)).toBe(
      'In the 3 conditions where OXT changes with a pathway analysis, 4 pathways are enriched; 3 in two or more (padj < 0.05)',
    );
    expect(cp.querySelector('ul.portal-conditions')).toBeNull();
    expect(cp.querySelector('table.cp-matrix caption')?.textContent).toMatch(/Pathway enrichment \(NES\) in each condition where OXT changes/);

    // Oxidative phosphorylation recurs most (all three conditions, two
    // studies) but is enriched in 30 of 39 tracks anyway, so it ranks below
    // feeding behaviour (2 of 3 here, 2 of 38 corpus-wide; tail 36/8436) and
    // hypoxia (2 of 3 here, 3 of 39; tail 109/9139). Insulin response, once
    // here and in 10 of 39 tracks, is last.
    expect(names(rows)).toEqual([
      'GOBP_FEEDING_BEHAVIOR', 'HALLMARK_HYPOXIA', 'HALLMARK_OXIDATIVE_PHOSPHORYLATION', 'GOBP_RESPONSE_TO_INSULIN',
    ]);
    expect(rows.every((r) => r.cells[0].tagName === 'TH' && r.cells[0].getAttribute('scope') === 'row')).toBe(true);

    // Recurrence stays visible beside the enrichment over the base rate.
    expect(rows.map((r) => countCell(r).textContent)).toEqual([
      '2 of 3 · ×13Report →', '2 of 3 · ×8.7Report →', '3 of 3 · ×1.3Report →', '1 of 3 · ×1.3Report →',
    ]);
    expect(countCell(rows[2]).querySelector('span[title]')?.getAttribute('title'))
      .toMatch(/^Enriched in 3 of 3 conditions here; at its rate across the corpus \(30 of 39 tracks\) 2\.3 were expected\. Hypergeometric tail .+, used for ranking only\.$/);

    // Index only: one file per followed track with an analysis, nothing else.
    expect(followed()).toEqual([0, 1, 3]);
    expect(mocks.queryGeneAcrossDatasets).not.toHaveBeenCalled();
    expect(mocks.queryPathwayAcrossDatasets).not.toHaveBeenCalled();

    // The title shows the pathway; the quiet link opens its full report.
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'HALLMARK_HYPOXIA' }));
    expect(onShowPathway).toHaveBeenCalledWith('HALLMARK_HYPOXIA');
    expect(onOpenPathway).not.toHaveBeenCalled();
    fireEvent.click(within(rows[3]).getByRole('button', { name: 'Open full pathway report for GOBP_RESPONSE_TO_INSULIN' }));
    expect(onOpenPathway).toHaveBeenCalledWith('GOBP_RESPONSE_TO_INSULIN');
    expect(onShowPathway).toHaveBeenCalledTimes(1);
    expect(heads).toHaveLength(4);
  });

  it('puts the conditions where the gene went down first, then those where it went up', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    renderSection();
    const { cp, heads } = await matrix();

    // One group heading per direction, spanning its columns.
    const groups = [...cp.querySelectorAll<HTMLTableCellElement>('tr.cp-groups th.cp-group')];
    expect(groups.map((g) => [g.dataset.group, g.textContent, g.colSpan, g.getAttribute('scope')])).toEqual([
      ['down', 'OXT lower in the first group', 1, 'colgroup'],
      ['up', 'OXT higher', 3, 'colgroup'],
    ]);

    // SON (down) leads; PVN, ARC and whole keep their followed (q) order.
    // Each heading is the comparison's first group with the gene's log2FC.
    expect(OBESE).toBe('Obese');
    expect(HFD).toBe('HFD');
    expect(heads.map((h) => [h.querySelector('.cp-cond-label')?.textContent, h.querySelector('.cp-cond-fc')?.textContent, h.dataset.status]))
      .toEqual([
        [OBESE, '-0.90', 'read'],
        [OBESE, '+1.80', 'read'],
        [OBESE, '+0.70', 'no-analysis'],
        [HFD, '+0.40', 'read'],
      ]);
    expect(heads[0].title).toMatch(new RegExp(`^${MACAQUE.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · SON cells: Obese vs Normal\\. OXT log2FC -0\\.90, q .+\\. 2 pathways\\.$`));
    expect(heads[2].title).toMatch(/· ARC cells: Obese vs Normal\. OXT log2FC \+0\.70, q .+\. no pathway analysis\.$/);
    expect(heads[3].title).toContain(`${MOUSE.name} · whole cells`);
    // The first up column is marked so the groups stand apart.
    expect(heads.map((h) => h.hasAttribute('data-first'))).toEqual([false, true, false, false]);
  });

  it('fills enriched cells with their NES and marks the condition without an analysis', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    renderSection();
    const { rows } = await matrix();
    // Columns: SON | PVN, ARC, whole.
    expect(rows.map(cellTexts)).toEqual([
      ['-1.8', '-1.5', 'no pathway analysis', 'not enriched'],
      ['not enriched', '2.0', 'no pathway analysis', '1.6'],
      ['1.4', '1.9', 'no pathway analysis', '1.2'],
      ['not enriched', 'not enriched', 'no pathway analysis', '2.2'],
    ]);

    const [son, pvn, arc, whole] = rows[0].querySelectorAll<HTMLTableCellElement>('td.cp-cell');
    // Enriched: direction and a filled swatch, blue below 0.
    expect(son.dataset.nes).toBe('down');
    expect(son.title).toMatch(/^GOBP_FEEDING_BEHAVIOR in Obese: NES -1\.80, padj .+$/);
    expect((son.querySelector('.cp-fill') as HTMLElement).style.background).toMatch(/^rgba\(76, 120, 168, /);
    expect(pvn.dataset.nes).toBe('down');
    // The column without an analysis is marked, never read as "not enriched".
    expect(arc.classList.contains('cp-cell--na')).toBe(true);
    expect(arc.hasAttribute('data-nes')).toBe(false);
    expect(arc.querySelector('.portal-sr')?.textContent).toBe('no pathway analysis');
    expect(arc.title).toBe('Obese: no pathway analysis');
    // Read but not enriched: empty, with the reason for screen readers.
    expect(whole.classList.contains('cp-cell--na')).toBe(false);
    expect(whole.hasAttribute('data-nes')).toBe(false);
    expect(whole.querySelector('.cp-fill')).toBeNull();
    expect(whole.querySelector('.portal-sr')?.textContent).toBe('not enriched');
    expect(whole.title).toBe('GOBP_FEEDING_BEHAVIOR: not enriched in HFD');

    // Above 0 is red.
    const hypoxiaPvn = rows[1].querySelectorAll<HTMLTableCellElement>('td.cp-cell')[1];
    expect(hypoxiaPvn.dataset.nes).toBe('up');
    expect((hypoxiaPvn.querySelector('.cp-fill') as HTMLElement).style.background).toMatch(/^rgba\(228, 87, 86, /);
    expect(rows.flatMap((r) => [...r.querySelectorAll('td.cp-cell--na')]).length).toBe(4);
  });

  it('marks a condition whose pathway file could not be read', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    mocks.loadTrackPathways.mockImplementation((_d: Dataset[], _m: QueryManifest, i: number) =>
      Promise.resolve(i === 1 ? null : TRACK_PATHWAYS[i] ?? null));
    renderSection();
    const { cp, rows, heads } = await matrix();
    expect(verdict(cp)).toMatch(/^In the 2 conditions where OXT changes with a pathway analysis/);
    expect(heads[0].dataset.status).toBe('unreadable');
    expect(rows.every((r) => r.querySelector('td.cp-cell')?.textContent === 'could not be read')).toBe(true);
  });

  it('explains the legend and how the list is ranked', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    renderSection();
    const { cp } = await matrix();
    const legend = cp.querySelector('.cp-legend') as HTMLElement;
    expect([...legend.querySelectorAll('.cp-key')].map((k) => k.textContent)).toEqual(['NES above 0', 'NES below 0', 'not enriched']);
    expect(legend.textContent).toContain('Over usual: how much more often than across all 39 tracks with a pathway analysis.');
    // Four pathways fit: no "Show more".
    expect(legend.querySelector('button.search-more')).toBeNull();

    const how = cp.querySelector('details.cp-how') as HTMLDetailsElement;
    expect(how.open).toBe(false);
    expect(how.querySelector('summary')?.textContent).toBe('How is this ranked?');
    const note = how.querySelector('.portal-note')?.textContent;
    expect(note).toMatch(/across all 39 tracks with a pathway analysis/);
    expect(note).toMatch(/It is not a significance test/);
    expect(note).toMatch(/Ties fall back to studies, then conditions, direction agreement and padj\./);
  });

  it('follows the one condition where the gene changes', async () => {
    renderSection();
    const { cp, heads } = await matrix();
    expect(verdict(cp)).toBe('In the 1 condition where OXT changes with a pathway analysis, 3 pathways are enriched (padj < 0.05)');
    // Only an up column, so the down group is omitted.
    const groups = [...cp.querySelectorAll<HTMLTableCellElement>('tr.cp-groups th.cp-group')];
    expect(groups.map((g) => [g.dataset.group, g.colSpan])).toEqual([['up', 1]]);
    expect(heads.map((h) => h.querySelector('.cp-cond-fc')?.textContent)).toEqual(['+1.80']);
    expect(followed()).toEqual([0]);
  });

  it('shows ten pathways, then up to fifty on request', async () => {
    const many = Array.from({ length: 13 }, (_, i): TrackPathwayRow => [`GOBP_SET_${String(i).padStart(2, '0')}`, 1.5, 0.001 * (i + 1), 50, 0, 5, 39]);
    mocks.loadTrackPathways.mockImplementation((_d: Dataset[], _m: QueryManifest, i: number) => Promise.resolve(i === 0 ? many : null));
    renderSection();
    const { cp, rows } = await matrix();
    expect(verdict(cp)).toMatch(/13 pathways are enriched/);
    expect(rows).toHaveLength(10);
    const legend = cp.querySelector('.cp-legend') as HTMLElement;
    fireEvent.click(within(legend).getByRole('button', { name: 'Show 3 more' }));
    expect(cp.querySelectorAll('table.cp-matrix tbody tr')).toHaveLength(13);
    expect(legend.querySelector('button.search-more')).toBeNull();
  });

  it('falls back to recurrence for rows that carry no base rate', async () => {
    mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
    mocks.loadTrackPathways.mockImplementation((_d: Dataset[], _m: QueryManifest, i: number) =>
      Promise.resolve(TRACK_PATHWAYS[i]?.map((row) => row.slice(0, 5) as unknown as TrackPathwayRow) ?? null));
    renderSection();
    const { rows } = await matrix();
    // Studies, then conditions, then direction agreement, then padj.
    expect(names(rows)).toEqual([
      'HALLMARK_OXIDATIVE_PHOSPHORYLATION', 'HALLMARK_HYPOXIA', 'GOBP_FEEDING_BEHAVIOR', 'GOBP_RESPONSE_TO_INSULIN',
    ]);
    // No base rate, no "over usual".
    expect(rows.map((r) => countCell(r).textContent)).toEqual(['3 of 3Report →', '2 of 3Report →', '2 of 3Report →', '1 of 3Report →']);
    expect(rows.some((r) => countCell(r).querySelector('span[title]'))).toBe(false);
  });

  it('says so when none of the conditions has a pathway analysis', async () => {
    const report = fourConditions();
    report.groups = report.groups.map((g) => ({
      ...g, tracks: g.tracks.map((t) => (t.trackId === 'ARC' ? t : geneRow({ ...t, fdr: 0.5 }))),
    }));
    mocks.queryGeneViaIndex.mockResolvedValue(report);
    renderSection();
    const { cp } = await matrix();
    expect(verdict(cp)).toBe('None of the conditions where OXT changes has a pathway analysis.');
    expect(cp.querySelector('table.cp-matrix')).toBeNull();
    expect(mocks.loadTrackPathways).not.toHaveBeenCalled();
  });

  it('keeps the reserved slot when the index has no track-pathways family', async () => {
    mocks.loadQueryManifest.mockResolvedValue(indexManifest(false));
    renderSection();
    await waitFor(() => expect(slot()).toBeTruthy());
    expect(slot()?.textContent).toContain('Coming soon');
    expect(section()).toBeNull();
    expect(mocks.loadTrackPathways).not.toHaveBeenCalled();
  });

  it('keeps the reserved slot when no followed condition can be read', async () => {
    mocks.loadTrackPathways.mockResolvedValue(null);
    renderSection();
    await waitFor(() => expect(slot()).toBeTruthy());
    expect(mocks.queryGeneAcrossDatasets).not.toHaveBeenCalled();
  });

  it('says when the gene changes nowhere, without reading the index', async () => {
    const report = geneReport();
    report.groups = report.groups.map((g) => ({ ...g, tracks: g.tracks.map((t) => geneRow({ ...t, fdr: 0.5 })) }));
    mocks.queryGeneViaIndex.mockResolvedValue(report);
    renderSection();
    const note = await waitFor(() => within(section() as HTMLElement).getByText(/not significant \(FDR < 0\.05\) in any track/));
    expect(note.textContent).not.toContain('of the selected studies');
    expect(mocks.loadQueryManifest).not.toHaveBeenCalled();
  });

  describe('scoped to studies', () => {
    it('follows only the conditions of the selected studies', async () => {
      mocks.queryGeneViaIndex.mockResolvedValue(fourConditions());
      renderSection([MACAQUE]);
      const { cp, rows, heads } = await matrix();
      expect(verdict(cp)).toBe(
        'In the 2 conditions where OXT changes with a pathway analysis, 3 pathways are enriched; 2 in two or more (padj < 0.05)',
      );
      // SON | PVN, ARC: the mouse condition is out of scope.
      expect(heads.map((h) => [h.querySelector('.cp-cond-fc')?.textContent, h.dataset.status])).toEqual([
        ['-0.90', 'read'], ['+1.80', 'read'], ['+0.70', 'no-analysis'],
      ]);
      expect(heads.every((h) => h.title.startsWith(MACAQUE.name))).toBe(true);
      // Insulin response is enriched only in the mouse condition, which is out of scope.
      expect(names(rows).sort()).toEqual(['GOBP_FEEDING_BEHAVIOR', 'HALLMARK_HYPOXIA', 'HALLMARK_OXIDATIVE_PHOSPHORYLATION']);
      expect(rows.map((r) => countCell(r).querySelector('span')?.textContent)).toEqual(
        names(rows).map((n) => (n === 'HALLMARK_HYPOXIA' ? '1 of 2' : '2 of 2')),
      );
      expect(followed()).toEqual([0, 1]);
    });

    it('says the gene changes nowhere in the selected studies', async () => {
      renderSection([MOUSE]);
      const note = await waitFor(() => within(section() as HTMLElement).getByText(/not significant \(FDR < 0\.05\) in any track/));
      expect(note.textContent).toContain('in any track of the selected studies');
      expect(mocks.loadQueryManifest).not.toHaveBeenCalled();
      expect(mocks.loadTrackPathways).not.toHaveBeenCalled();
    });

    it('stays loading while the study selection is undecided, without reading the index', async () => {
      renderSection(null);
      const status = within(section() as HTMLElement).getByRole('status');
      expect(status.textContent).toBe('Reading the pathway results of these conditions…');
      // Give any stray load a chance to land before checking nothing ran.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(within(section() as HTMLElement).getByRole('status')).toBeTruthy();
      expect(mocks.queryGeneViaIndex).not.toHaveBeenCalled();
      expect(mocks.loadQueryManifest).not.toHaveBeenCalled();
      expect(mocks.loadTrackPathways).not.toHaveBeenCalled();
    });
  });
});

// ── Baseline expression ─────────────────────────────────────────────────────

describe('BaselineSection', () => {
  it('shows the highest source groups, naming the group of a multi-group population', async () => {
    render(<BaselineSection symbol="OXT" />);
    const card = document.querySelector('[data-section="baseline-expression"]') as HTMLElement;
    expect(within(card).getByRole('status').textContent).toMatch(/Loading population expression/);
    expect(await within(card).findByText('PVH oxytocin')).toBeTruthy();
    expect(within(card).getByText('9000')).toBeTruthy();
    expect(within(card).getByText('SO AVP')).toBeTruthy();
    expect(within(card).getByText('AVP.QZ20.Ai_sup')).toBeTruthy();
    expect(within(card).getByTitle('SO AVP, source group AVP.QZ20.Ai_sup')).toBeTruthy();
    expect(within(card).getByTitle('PVH oxytocin').textContent).toBe('PVH oxytocin');
    expect(within(card).getByText(/top 2 of 2 source groups in 15 populations/)).toBeTruthy();
    expect(mocks.loadBaselineTeaser).toHaveBeenCalledWith('OXT');
  });
});

// ── Human reference atlases ─────────────────────────────────────────────────
//
// The real loader over the generated GTEx, HPA and Allen products
// (pnpm run build:expression-external), read from public/ instead of fetched.

function productFetch(fail?: (url: string) => boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (fail?.(String(url))) throw new Error('offline');
    return { ok: true, json: async () => JSON.parse(readFileSync(`public${String(url).split('?')[0]}`, 'utf8')) };
  }));
}

describe('ReferenceAtlasSection', () => {
  beforeEach(() => resetSourceRequests());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows GTEx, HPA subregions and every Allen probe for the human gene of a mouse symbol', async () => {
    productFetch();
    render(<ReferenceAtlasSection symbol="Pomc" />);
    const card = document.querySelector('[data-section="reference-atlases"]') as HTMLElement;
    expect(within(card).getByRole('status').textContent).toMatch(/Loading the reference atlases/);
    await within(card).findByText(/the human gene of the same symbol/);
    expect(card.querySelector('.portal-verdict b')?.textContent).toBe('POMC');
    const gtex = card.querySelector('[data-atlas="gtex"]') as HTMLElement;
    expect(within(gtex).getByText('7.79')).toBeTruthy();
    expect(within(gtex).getByText(/Median of 257 donors; interquartile 5\.10–15\.0/)).toBeTruthy();
    // The donor mean is what the source's full survey ranks; the tile names it so the two agree.
    expect(within(gtex).getByText(/donor mean,\s+52\.6 TPM/)).toBeTruthy();
    const subregions = card.querySelector('[data-atlas="subregions"]') as HTMLElement;
    expect([...subregions.querySelectorAll('.portal-bar-label')].map((label) => label.textContent))
      .toEqual(['arcuate nucleus', 'supraoptic nucleus', 'ventromedial nucleus']);
    expect(within(subregions).getByText('68.4')).toBeTruthy();
    expect(within(subregions).getByText(/top 3 of 8 subregions/)).toBeTruthy();
    // Without a handler the tiles open nothing.
    expect(within(card).queryByRole('button', { name: /Every/ })).toBeNull();
    const allen = card.querySelector('[data-atlas="allen"]') as HTMLElement;
    expect([...allen.querySelectorAll('.portal-probe')].map((probe) => probe.textContent).sort())
      .toEqual(['A_23_P5875', 'CUST_15470_PI416261804', 'CUST_15474_PI416261804']);
    expect(within(allen).getByText('9.50')).toBeTruthy();
    expect(within(allen).getByText(/hypothalamic samples\s+\(102 across 6 donors\)/)).toBeTruthy();
  });

  it('keeps the other atlases when one provider cannot be read', async () => {
    productFetch((url) => url.includes('/allen-human/'));
    render(<ReferenceAtlasSection symbol="POMC" />);
    const card = document.querySelector('[data-section="reference-atlases"]') as HTMLElement;
    const allen = await waitFor(() => {
      const column = card.querySelector('[data-atlas="allen"]') as HTMLElement;
      expect(column).toBeTruthy();
      return column;
    });
    expect(within(allen).getByText('This atlas could not be loaded.')).toBeTruthy();
    expect(within(card.querySelector('[data-atlas="gtex"]') as HTMLElement).getByText('7.79')).toBeTruthy();
    // The query is the human gene's own symbol, so there is no match line.
    expect(card.querySelector('.portal-verdict')).toBeNull();
  });

  it('says when a gene is in none of the atlases', async () => {
    productFetch();
    render(<ReferenceAtlasSection symbol="NOT_A_GENE_123" />);
    expect(await screen.findAllByText('NOT_A_GENE_123 is not in this atlas.')).toHaveLength(4);
  });

  it('fills the human single-cell slot with the HPA clusters', async () => {
    productFetch();
    render(<ReferenceAtlasSection symbol="Pomc" />);
    const card = await waitFor(() => {
      const block = document.querySelector('[data-section="single-cell-human"]') as HTMLElement;
      expect(block).toBeTruthy();
      return block;
    });
    expect(within(card).getByText('c-1 · splatter')).toBeTruthy();
    expect(within(card).getByText('27.4')).toBeTruthy();
    expect(within(card).getByText(/top 3 of 26 clusters/)).toBeTruthy();
  });
});

describe('GeneExpressionCards', () => {
  beforeEach(() => resetSourceRequests());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sets an animal row and a human row of source tiles, each opening its own source under its row', async () => {
    productFetch();
    const onOpenExpression = vi.fn();
    render(<GeneExpressionCards symbol="OXT" onOpenExpression={onOpenExpression} />);
    const section = screen.getByRole('region', { name: 'Where OXT is expressed' });
    const mouse = within(section).getByRole('region', { name: 'Animal hypothalamus' });
    expect(await within(mouse).findByText('PVH oxytocin')).toBeTruthy();
    expect(mouse.querySelector('[data-slot="single-cell-mouse"]')).toBeTruthy();
    // The study library: each population's highest cohort, its study and cohort named, in the shared unit.
    const studies = mouse.querySelector('[data-section="study-populations"]') as HTMLElement;
    expect(await within(studies).findByText('Hypothalamic OXT')).toBeTruthy();
    expect(within(studies).getByText('GSE242245 · Vehicle')).toBeTruthy();
    expect(within(studies).getByText(/2 of the 3 populations with OXT use this unit; the rest are listed/)).toBeTruthy();
    const tissueTile = mouse.querySelector('[data-section="tissue"]') as HTMLElement;
    expect(within(tissueTile).getByText('OXT is not among the genes these 6 sources retained.')).toBeTruthy();
    // The tissue tile names the species its sources come from.
    expect(within(tissueTile).getByText('mouse, rat and pig')).toBeTruthy();
    const human = section.querySelector('[data-section="reference-atlases"]') as HTMLElement;
    expect(human.contains(mouse)).toBe(false);
    await waitFor(() => expect(human.querySelector('[data-atlas="gtex"] .portal-ref-value')).toBeTruthy(), { timeout: 5000 });
    expect(section.querySelector('[data-section="expression-survey"]')).toBeNull();

    // An animal tile opens its source alone, under the animal row.
    const open = within(mouse).getByRole('button', { name: 'Every source group →' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(open);
    const close = within(mouse).getByRole('button', { name: 'Close' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    const panel = within(mouse).getByRole('region', { name: /^NeuroSeq sorted populations OXT in each cohort/ });
    expect(close.getAttribute('aria-controls')).toBe(panel.id);
    expect(mouse.querySelector('.gene-tile--open')?.getAttribute('data-tile')).toBe('neuroseq');
    expect(await within(panel).findByRole('heading', { name: 'Hypothalamic populations' }, { timeout: 5000 })).toBeTruthy();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    // Held to NeuroSeq: no collection choice until the reader releases it.
    expect(within(panel).queryByRole('combobox', { name: 'Source collection' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'All sources and filters' }));
    expect(await within(panel).findByRole('combobox', { name: 'Source collection' }, { timeout: 5000 })).toHaveValue('neuroseq');

    // A human tile replaces it, under the human row.
    fireEvent.click(within(human).getByRole('button', { name: 'Every donor →' }));
    expect(mouse.querySelector('[data-drill]')).toBeNull();
    const gtex = within(section).getByRole('region', { name: /^GTEx v10 hypothalamus OXT in each cohort/ });
    expect(mouse.contains(gtex)).toBe(false);
    expect(human.compareDocumentPosition(gtex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(gtex).findByRole('heading', { name: 'Human hypothalamus · GTEx v10' }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(within(gtex).getByRole('button', { name: 'Close GTEx v10 hypothalamus' }));
    expect(section.querySelector('[data-section="expression-survey"]')).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'Compare with other genes →' }));
    expect(onOpenExpression).toHaveBeenCalledTimes(1);
  });

  it('opens every source at once in the scope the survey page handed over', async () => {
    productFetch();
    render(<GeneExpressionCards symbol="OXT" surveyScope={{
      mode: 'tissue', collection: 'neuroseq', region: 'all', includeSfo: false, selectedIds: null, tissueKind: 'external', referenceOnly: false,
    }} />);
    const survey = await screen.findByRole('region', { name: /Every source and sample/ });
    expect(survey.getAttribute('data-drill')).toBe('handoff');
    expect(await within(survey).findByRole('button', { name: /Reference atlases/, pressed: true }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compare with other genes →' })).toBeNull();
  });

  it('puts the HypoMap preview behind the single-cell tile, keeping every other source', async () => {
    vi.stubEnv('VITE_HYPOMAP_EXPRESSION', '1');
    try {
      productFetch();
      render(<GeneExpressionCards symbol="OXT" onOpenExpression={vi.fn()} />);
      const section = screen.getByRole('region', { name: 'Where OXT is expressed' });
      const mouse = within(section).getByRole('region', { name: 'Animal hypothalamus' });
      expect(await within(mouse).findByText('PVH oxytocin')).toBeTruthy();
      expect(mouse.querySelector('[data-slot="single-cell-mouse"]')).toBeNull();
      expect(section.querySelector('[data-section="reference-atlases"]')).toBeTruthy();
      expect(within(section).queryByRole('region', { name: 'Mouse single-cell expression in HypoMap' })).toBeNull();
      fireEvent.click(within(mouse).getByRole('button', { name: 'Open the atlas →' }));
      const preview = within(mouse).getByRole('region', { name: 'Mouse single-cell expression in HypoMap' });
      expect(await within(preview).findByText('No HypoMap feature matched OXT.')).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('FamilySection', () => {
  const teaser = (levels: Array<{ id: string; mean: number }>, extra: Record<string, unknown> = {}) => ({
    measured: levels.length, total: 5, unit: 'log2', inUnit: levels.length, unread: 0, species: ['Mus musculus'],
    levels: levels.map(({ id, mean }) => ({ sourceId: id, label: id, study: 'GSE1', cohort: 'Control', mean, n: 3 })),
    ...extra,
  });
  const widths = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.portal-bar')]
    .map((bar) => [bar.style.marginLeft, bar.style.width]);

  it('draws a measured zero with no width and a negative mean left of zero', async () => {
    mocks.loadFamilyTeaser.mockResolvedValueOnce(teaser([{ id: 'zero', mean: 0 }, { id: 'below', mean: -1.5 }]));
    const { container } = render(<FamilySection symbol="Pomc" family="tissue" />);
    expect(await screen.findByText('below')).toBeTruthy();
    expect(widths(container)).toEqual([['100%', '0%'], ['0%', '100%']]);
    expect((container.querySelector('.portal-bar-zero') as HTMLElement).style.left).toBe('100%');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('draws nothing, not NaN, when every shown mean is zero', async () => {
    mocks.loadFamilyTeaser.mockResolvedValueOnce(teaser([{ id: 'a', mean: 0 }, { id: 'b', mean: 0 }]));
    const { container } = render(<FamilySection symbol="Pomc" family="studies" />);
    expect(await screen.findByText('b')).toBeTruthy();
    expect(widths(container)).toEqual([['0%', '0%'], ['0%', '0%']]);
    expect(container.querySelector('.portal-bar-zero')).toBeNull();
  });

  it('counts sources it could not read apart from sources that lack the gene', async () => {
    mocks.loadFamilyTeaser.mockResolvedValueOnce(teaser([], { measured: 0, inUnit: 0, unit: '', unread: 2 }));
    render(<FamilySection symbol="Pomc" family="studies" />);
    expect(await screen.findByText(/Pomc is not among the genes the 3 populations that loaded retained\. 2 of the 5 populations could not be read/)).toBeTruthy();
  });

  it('says the family could not be loaded when nothing was read', async () => {
    mocks.loadFamilyTeaser.mockResolvedValueOnce(null);
    render(<FamilySection symbol="Pomc" family="studies" />);
    expect(await screen.findByText('These populations could not be loaded.')).toBeTruthy();
  });

  it('names species by common name', () => {
    expect(speciesPhrase(['Mus musculus', 'Rattus norvegicus', 'Sus scrofa'])).toBe('mouse, rat and pig');
    expect(speciesPhrase(['Mus musculus'])).toBe('mouse');
    expect(speciesPhrase(['Gallus gallus', 'Mus musculus'])).toBe('Gallus gallus and mouse');
  });
});
