import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { SearchPage } from '../search/SearchPage';
import { resetSearchSummaries } from '../search/searchSummaries';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { geneRow, pathwayRow } from '../data/crossDatasetRows';
import type { GeneHit, PathwayHit, SearchFilter, SearchResults, SearchVocabulary } from '../search/searchTypes';
import type { CrossDatasetGeneReport, CrossDatasetPathwayReport, Dataset } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const VOCAB: SearchVocabulary = { genes: [], pathways: [] };
const MACAQUE = getDataset('macaque_snrna') as Dataset;
const MOUSE = getDataset('mouse_hypo_hfd_gse220533') as Dataset;

const gene = (symbol: string, name: string, match: GeneHit['match'], matchedText = '', datasets = 12): GeneHit => ({
  entry: { symbol, name, otherNames: [], aliases: [], datasets }, match, matchedText, score: 1,
});
const pathway = (id: string, title: string): PathwayHit => ({ id, db: 'GO_BP', dbLabel: 'GO BP', title, score: 1 });

const OXT = gene('OXT', 'oxytocin/neurophysin I prepropeptide', 'name', 'oxytocin');
const OXTR = gene('OXTR', 'oxytocin receptor', 'name-prefix', 'oxytocin receptor', 30);
const SECRETION = pathway('GOBP_OXYTOCIN_SECRETION', 'Oxytocin secretion');
const SIGNALING = pathway('KEGG_OXYTOCIN_SIGNALING_PATHWAY', 'Oxytocin signaling pathway');
const TWELVE = Array.from({ length: 12 }, (_, i) => gene(`G${i}`, `gene ${i}`, 'name-word'));
const HUNDRED = Array.from({ length: 100 }, (_, i) => gene(`H${i}`, `gene ${i}`, 'name-word'));

const FIXTURES: Record<string, SearchResults> = {
  oxytocin: { query: 'oxytocin', genes: [OXT, OXTR], pathways: [SECRETION, SIGNALING], best: { kind: 'gene', hit: OXT } },
  GOBP_OXYTOCIN_SECRETION: { query: 'GOBP_OXYTOCIN_SECRETION', genes: [], pathways: [SECRETION], best: { kind: 'pathway', hit: SECRETION } },
  // A direct match with eleven more genes behind it.
  G0: { query: 'G0', genes: TWELVE, pathways: [], best: { kind: 'gene', hit: TWELVE[0] } },
  // No decisive match.
  many: { query: 'many', genes: TWELVE, pathways: [SECRETION], best: null },
  // A direct match at the head of a list cut off at the 100-gene limit.
  H0: { query: 'H0', genes: HUNDRED, pathways: [], best: { kind: 'gene', hit: HUNDRED[0] } },
};

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

function pathwayReport(): CrossDatasetPathwayReport {
  const t = (trackId: string, NES: number, padj: number) =>
    pathwayRow({ trackId, label: trackId, type: '', NES, padj, pval: padj / 10, size: 40, db: 'GO_BP' });
  return {
    pathway: 'GOBP_OXYTOCIN_SECRETION', total: 3, loaded: 3,
    groups: [{ dataset: MACAQUE, contrast: getActiveContrast(MACAQUE), tracks: [t('PVN', -2.1, 0.01), t('SON', 1.9, 0.03), t('ARC', 0.4, 0.7)] }],
  };
}

// ── Mocks ───────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  useSearchVocabulary: vi.fn(),
  searchAll: vi.fn(),
  queryGeneViaIndex: vi.fn(),
  queryPathwayViaIndex: vi.fn(),
  queryGeneAcrossDatasets: vi.fn(),
  queryPathwayAcrossDatasets: vi.fn(),
}));

vi.mock('../search/useSearchVocabulary', () => ({ useSearchVocabulary: mocks.useSearchVocabulary }));
vi.mock('../search/searchVocabulary', () => ({
  searchAll: mocks.searchAll,
  geneMatchLabel: (hit: GeneHit) => (hit.match === 'name' ? 'Gene name' : 'Name starts with'),
  describePathway: (id: string) => ({ db: 'GO_BP', dbLabel: 'GO BP', title: id }),
  loadSearchVocabulary: () => Promise.resolve(VOCAB),
}));
// The summaries are the real module over a mocked index: these tests prove
// what the rows and the pathway portal render from index rows, and that the
// page never takes the per-track download path.
vi.mock('../data/crossDataset', async (original) => ({
  ...await original<typeof import('../data/crossDataset')>(),
  queryGeneViaIndex: mocks.queryGeneViaIndex,
  queryPathwayViaIndex: mocks.queryPathwayViaIndex,
  queryGeneAcrossDatasets: mocks.queryGeneAcrossDatasets,
  queryPathwayAcrossDatasets: mocks.queryPathwayAcrossDatasets,
}));

beforeEach(() => {
  resetSearchSummaries();
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.useSearchVocabulary.mockReturnValue(VOCAB);
  mocks.searchAll.mockImplementation((_v: SearchVocabulary, query: string): SearchResults =>
    FIXTURES[query] ?? { query, genes: [], pathways: [], best: null });
  mocks.queryGeneViaIndex.mockResolvedValue(geneReport());
  mocks.queryPathwayViaIndex.mockResolvedValue(pathwayReport());
});

function renderPage(query: string, filter: SearchFilter = 'all') {
  const props = {
    onSearch: vi.fn(), onFilterChange: vi.fn(), onHome: vi.fn(),
    onOpenGene: vi.fn(), onOpenPathway: vi.fn(),
  };
  const view = render(<SearchPage query={query} filter={filter} {...props} />);
  return { ...props, view };
}

const pathwayPortal = () => document.querySelector('[data-portal="pathway"]') as HTMLElement | null;
/** The section holding the direct gene match; its heading is exactly "Gene". */
const matchList = () => screen.queryByRole('region', { name: 'Gene' });
const rowsOf = (region: HTMLElement) => within(region).getAllByRole('listitem').map((li) => li.querySelector('button') as HTMLButtonElement);
const summaryOf = (row: HTMLElement) => row.querySelector('.search-row-summary') as HTMLElement;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SearchPage', () => {
  it('introduces the search and offers examples when there is no query', () => {
    const { onSearch } = renderPage('');
    expect(screen.getByRole('heading', { level: 1, name: 'Search genes and pathways' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'oxytocin' }));
    expect(onSearch).toHaveBeenCalledWith('oxytocin', 'all');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('waits quietly for the vocabulary', () => {
    mocks.useSearchVocabulary.mockReturnValue(null);
    renderPage('oxytocin');
    expect(screen.getByRole('status').textContent).toMatch(/Loading gene and pathway names/);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('breaks results down with counted tabs, bound to the filter', () => {
    const { onFilterChange } = renderPage('oxytocin');
    const tablist = screen.getByRole('tablist', { name: 'Result types' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['All 4', 'Genes 2', 'Pathways 2']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs[2]);
    expect(onFilterChange).toHaveBeenLastCalledWith('pathway');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onFilterChange).toHaveBeenLastCalledWith('gene');
  });

  it('leads with the gene a name search snapped to, as one row that opens its gene page', async () => {
    const { onOpenGene, onSearch } = renderPage('oxytocin');
    expect(document.querySelector('[data-portal]')).toBeNull();
    expect(document.querySelector('[data-section], [data-slot]')).toBeNull();

    const match = matchList() as HTMLElement;
    expect(match).toHaveClass('search-list--match');
    expect(within(match).getByRole('heading', { level: 2 }).textContent).toBe('Gene');
    const rows = rowsOf(match);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toHaveClass('search-row', 'search-row--featured');
    expect(row.querySelector('.search-row-sym')?.textContent).toBe('OXT');
    expect(row.querySelector('.search-row-meta')?.textContent).toBe('Open gene page →');

    // How it changes, from the index: the tally, then the strongest change.
    await waitFor(() => expect(summaryOf(row)).toHaveAttribute('data-summary', 'done'));
    expect(summaryOf(row).textContent).toMatch(/Significant in 1 of 2 datasets · 1 track up · 0 down/);
    const strongest = row.querySelector('.search-row-strongest') as HTMLElement;
    expect(strongest.textContent).toContain('Strongest');
    expect(strongest.textContent).toContain(`${MACAQUE.name} · PVN neurons`);
    expect(strongest.textContent).toMatch(/PVN neurons log2FC \+1\.80 q 2\.0e-4$/);
    expect(row.textContent).not.toMatch(/[▲▼]|Name starts with|Gene name/);
    expect(mocks.queryGeneViaIndex).toHaveBeenCalledWith('OXT', expect.any(Array));
    expect(mocks.queryGeneAcrossDatasets).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(onOpenGene).toHaveBeenCalledWith('OXT');
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('follows the direct match with the other genes the query matched', async () => {
    const { onOpenGene, onSearch } = renderPage('oxytocin');
    expect(screen.queryByRole('region', { name: /^Genes \d/ })).toBeNull();
    const also = screen.getByRole('region', { name: 'Also matching 1' });
    expect(also.compareDocumentPosition(matchList() as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    const rows = rowsOf(also);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveClass('search-row--featured');
    expect(rows[0].querySelector('.search-row-sym')?.textContent).toBe('OXTR');
    expect(rows[0].textContent).toContain('30 datasets');

    await waitFor(() => expect(summaryOf(rows[0])).toHaveAttribute('data-summary', 'done'));
    expect(summaryOf(rows[0]).textContent).toMatch(/Significant in 1 of 2 datasets · 1 track up · 0 down/);
    expect(rows[0].querySelector('.search-row-strongest')?.textContent).toMatch(/PVN neurons log2FC \+1\.80 q /);
    expect(rows[0].textContent).not.toMatch(/[▲▼]|Name starts with/);
    expect(rows[0].textContent).not.toContain('30 datasets');
    expect(mocks.queryGeneViaIndex).toHaveBeenCalledWith('OXTR', expect.any(Array));
    expect(mocks.queryGeneAcrossDatasets).not.toHaveBeenCalled();

    fireEvent.click(rows[0]);
    expect(onOpenGene).toHaveBeenCalledWith('OXTR');
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('caps the other genes under All, and lists them all on the Genes breakdown', () => {
    const all = renderPage('G0');
    expect(rowsOf(matchList() as HTMLElement).map((r) => r.querySelector('.search-row-sym')?.textContent)).toEqual(['G0']);
    const also = screen.getByRole('region', { name: 'Also matching 11' });
    expect(rowsOf(also).map((r) => r.querySelector('.search-row-sym')?.textContent))
      .toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']);
    fireEvent.click(within(also).getByRole('button', { name: 'Show all 12 genes' }));
    expect(all.onFilterChange).toHaveBeenCalledWith('gene');
    all.view.unmount();

    renderPage('G0', 'gene');
    expect(matchList()).toBeTruthy();
    const listed = screen.getByRole('region', { name: 'Also matching 11' });
    expect(within(listed).getAllByRole('listitem')).toHaveLength(11);
    expect(listed.querySelector('.search-more')).toBeNull();
    expect(screen.queryByRole('region', { name: /^Pathways/ })).toBeNull();
  });

  it('marks the other genes as capped when the result list hit its limit', () => {
    renderPage('H0', 'gene');
    expect(matchList()).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Also matching 100+' })).toBeTruthy();
  });

  it('lists the genes without a lead row when no gene is a direct match, capped under All', () => {
    const { onFilterChange } = renderPage('many');
    expect(matchList()).toBeNull();
    expect(screen.queryByRole('region', { name: /^Also matching/ })).toBeNull();
    expect(screen.getByText(/Pick a gene or pathway below/)).toBeTruthy();
    const genes = screen.getByRole('region', { name: 'Genes 12' });
    const rows = rowsOf(genes);
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row).not.toHaveClass('search-row--featured');
    fireEvent.click(within(genes).getByRole('button', { name: 'Show all 12 genes' }));
    expect(onFilterChange).toHaveBeenCalledWith('gene');
  });

  it('says when a matching gene does not change, is not measured, or cannot be summarized', async () => {
    mocks.searchAll.mockReturnValue({
      query: 'ox',
      genes: [
        gene('OXTR', 'oxytocin receptor', 'name-word'),
        gene('OXTX', 'unmeasured', 'name-word', '', 0),
        gene('OXTY', 'flat everywhere', 'name-word'),
        gene('OXTZ', 'no index', 'name-word'),
      ],
      pathways: [], best: null,
    });
    const flat = geneReport();
    flat.groups = flat.groups.map((g) => ({ ...g, tracks: g.tracks.map((t) => ({ ...t, significant: false })) }));
    mocks.queryGeneViaIndex.mockImplementation((symbol: string) => Promise.resolve(
      symbol === 'OXTR' ? {
        gene: 'OXTR', total: 1, loaded: 1,
        groups: [{ dataset: MOUSE, contrast: getActiveContrast(MOUSE), tracks: [geneRow({ trackId: 'whole', label: 'Whole', type: '', logFC: 0.2, pval: 0.03, fdr: 0.4, se: 0.2, lowPower: false })] }],
      } : symbol === 'OXTY' ? flat : null,
    ));
    renderPage('ox');
    const rows = rowsOf(screen.getByRole('region', { name: 'Genes 4' }));
    expect(await within(rows[0]).findByText(/Not significant in its 1 dataset/)).toBeTruthy();
    expect(rows[0].textContent).toContain('(lowest q 0.400)');
    expect(rows[1].textContent).toContain('Not measured in any indexed study.');
    expect(summaryOf(rows[1])).toHaveAttribute('data-summary', 'none');
    expect(await within(rows[2]).findByText(/Not significant in any of 2 datasets/)).toBeTruthy();
    expect(rows[2].textContent).toContain('(lowest q 2.0e-4)');
    expect(await within(rows[3]).findByText('Cross-study summary unavailable.')).toBeTruthy();
    expect(mocks.queryGeneViaIndex.mock.calls.map((c) => c[0]).sort()).toEqual(['OXTR', 'OXTY', 'OXTZ']);
    expect(mocks.queryGeneAcrossDatasets).not.toHaveBeenCalled();
  });

  it('runs a search for a pathway row', () => {
    const { onSearch, onOpenGene } = renderPage('oxytocin');
    const pathways = screen.getByRole('region', { name: 'Pathways 2' });
    const rows = rowsOf(pathways);
    expect(rows.map((r) => r.querySelector('.search-row-id')?.textContent)).toEqual(['GOBP_OXYTOCIN_SECRETION', 'KEGG_OXYTOCIN_SIGNALING_PATHWAY']);
    fireEvent.click(rows[1]);
    expect(onSearch).toHaveBeenLastCalledWith('KEGG_OXYTOCIN_SIGNALING_PATHWAY', 'all');
    expect(onOpenGene).not.toHaveBeenCalled();
  });

  it('shows only pathways on the Pathways breakdown', () => {
    renderPage('oxytocin', 'pathway');
    expect(matchList()).toBeNull();
    expect(screen.queryByRole('region', { name: /^(Genes|Also matching)/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Pathways 2' })).toBeTruthy();
  });

  it('opens a pathway portal from the index', async () => {
    const { onOpenPathway } = renderPage('GOBP_OXYTOCIN_SECRETION');
    const card = pathwayPortal() as HTMLElement;
    expect(within(card).getByRole('heading', { level: 2, name: 'Oxytocin secretion' })).toBeTruthy();
    expect(card.textContent).toContain('GO BP');
    expect(card.querySelector('.portal-id')?.textContent).toBe('GOBP_OXYTOCIN_SECRETION');
    const section = card.querySelector('[data-section="enrichment"]') as HTMLElement;
    expect(await within(section).findByText(/Enriched/)).toBeTruthy();
    expect(section.querySelector('.portal-verdict')?.textContent)
      .toMatch(/Enriched \(FDR < 0\.05\) in 2 of 3 tracks across 1 study · 1 up · 1 down/);
    expect(within(section).getAllByRole('row').slice(1).map((r) => (r as HTMLTableRowElement).cells[1].textContent)).toEqual(['PVN', 'SON']);
    expect(mocks.queryPathwayViaIndex).toHaveBeenCalledWith('GOBP_OXYTOCIN_SECRETION', expect.any(Array));
    expect(mocks.queryPathwayAcrossDatasets).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: 'Open full pathway report →' }));
    expect(onOpenPathway).toHaveBeenCalledWith('GOBP_OXYTOCIN_SECRETION');
    expect(card.querySelector('[data-slot="pathway-members"]')?.textContent).toContain('Coming soon');

    // The portal's pathway is marked in the list below it.
    const [current] = rowsOf(screen.getByRole('region', { name: 'Pathways 1' }));
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.textContent).toContain('Shown above');
  });

  it('degrades the pathway portal to a sentence when the index is unavailable, never to the full download', async () => {
    mocks.queryPathwayViaIndex.mockResolvedValue(null);
    const { onOpenPathway } = renderPage('GOBP_OXYTOCIN_SECRETION');
    const section = (pathwayPortal() as HTMLElement).querySelector('[data-section="enrichment"]') as HTMLElement;
    expect(await within(section).findByText(/cross-study index is not available/)).toBeTruthy();
    expect(mocks.queryPathwayAcrossDatasets).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: 'Open full pathway report →' }));
    expect(onOpenPathway).toHaveBeenCalledWith('GOBP_OXYTOCIN_SECRETION');
  });

  it('says so when nothing matches, and offers examples', () => {
    const { onSearch } = renderPage('zzzz');
    expect(screen.getByRole('heading', { level: 1, name: 'No genes or pathways match “zzzz”' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'leptin signaling' }));
    expect(onSearch).toHaveBeenCalledWith('leptin signaling', 'all');
  });
});
