import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PathwayReport } from '../crossdataset/PathwayReport';
import { CompareSetButton } from '../compareset/CompareSetButton';
import { _resetCompareSetStore, getSnapshot } from '../compareset/compareSetStore';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { datasetHref } from '../utils/appLinks';
import { pathwayRow, type PathwayRowInput } from '../data/crossDatasetRows';
import type { CrossDatasetPathwayReport, PathwayTrackRow } from '../types';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../data/crossDataset', async (original) => ({ ...await original<typeof import('../data/crossDataset')>(), queryPathwayAcrossDatasets: query }));
const macaque = getDataset('macaque_snrna')!;
const mouse = getDataset('mouse_hypo_hfd_gse220533')!;
const pathway = 'HALLMARK_ADIPOGENESIS';

// A non-significant track defaults to raw p 0.4, outside the nominal tier; pass
// `pval` below 0.05 to make it nominal.
function track(trackId: string, significant = false, over: Partial<PathwayRowInput> = {}): PathwayTrackRow {
  return pathwayRow({ trackId, label: `${trackId} population`, type: 'Tissue', NES: significant ? 2.5 : 1.1, pval: significant ? 0.001 : 0.4, padj: significant ? 0.02 : 0.5, size: 30, db: 'HALLMARK', ...over });
}
beforeEach(() => {
  _resetCompareSetStore();
  const report: CrossDatasetPathwayReport = { pathway, total: 6, loaded: 6, groups: [
    { dataset: macaque, contrast: getActiveContrast(macaque), tracks: [track('e9', true), track('i23'), track('e1'), track('e2'), track('e3')] },
    { dataset: mouse, contrast: getActiveContrast(mouse), tracks: [track(mouse.defaultTrack, true)] },
  ] };
  query.mockResolvedValue(report);
});

function mount(onCompare = vi.fn()) {
  return render(<PathwayReport pathway={pathway} onHome={() => {}} onSearchPathway={() => {}} headerRight={<CompareSetButton onCompare={onCompare} />} />);
}

describe('pathway result study cards', () => {
  it('links to the library record and exact pathway tab, with no inline QC or source links', async () => {
    const { container } = mount();
    const info = await screen.findByRole('link', { name: `More information about ${mouse.name}` });
    expect(info).toHaveAttribute('href', `#/library/${mouse.id}`);
    expect(screen.getByTitle(`Browse ${mouse.name} in the pathway explorer`)).toHaveAttribute('href', datasetHref(mouse.id, mouse.defaultTrack, 'pathway'));
    expect(screen.getByTitle('Open e9 in the pathway explorer')).toHaveAttribute('href', datasetHref(macaque.id, 'e9', 'pathway'));
    expect(screen.queryByRole('link', { name: /Verification evidence|GSE220533|PMID/ })).toBeNull();
    expect(container.querySelector('.report-dataset')?.textContent).not.toMatch(/Pipeline QC|Experimental design|Author concordance/);
    expect(container.querySelector('.report-filters')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: /^Mouse whole hypothalamus/ }));
    expect(info).toBeVisible();
    expect(screen.queryByTitle(`Open ${mouse.defaultTrack} in the pathway explorer`)).toBeNull();
  });

  it('shows significant populations first and expands the remaining rows without duplicates', async () => {
    mount();
    await screen.findByText(macaque.name);
    expect(screen.getAllByTitle('Open e9 in the pathway explorer')).toHaveLength(1);
    expect(screen.queryByTitle('Open i23 in the pathway explorer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show all 5 tracks/ }));
    expect(screen.getByTitle('Open i23 in the pathway explorer')).toBeVisible();
    expect(screen.getAllByTitle('Open e9 in the pathway explorer')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Show only the 1 track at p < 0\.05/ }));
    expect(screen.queryByTitle('Open i23 in the pathway explorer')).toBeNull();
  });

  it('lists nominal tracks after the FDR ones and labels each call', async () => {
    query.mockResolvedValue({ pathway, total: 6, loaded: 6, groups: [
      { dataset: macaque, contrast: getActiveContrast(macaque), tracks: [
        track('e9', true), track('i23'), track('e1', false, { pval: 0.03, NES: -1.6 }), track('e2'), track('e3'),
      ] },
      { dataset: mouse, contrast: getActiveContrast(mouse), tracks: [track(mouse.defaultTrack, true)] },
    ] } satisfies CrossDatasetPathwayReport);
    const { container } = mount();
    await screen.findByText(macaque.name);
    // The headline count stays FDR; the nominal track is counted beside it.
    expect(container.textContent).toMatch(/Enriched \(FDR < 0\.05\) in 2 of 6 tracks\. .* 1 more track reaches p < 0\.05 only\./);
    expect(container.textContent).toMatch(/Tracks marked p < 0\.05 only do not pass FDR/);
    expect(container.textContent).toContain('5 tracks · 1 significant · 1 at p < 0.05 only');
    const rows = [...container.querySelectorAll<HTMLElement>('.report-forest-row')];
    const macaqueRows = rows.filter((r) => r.closest('.report-dataset')?.textContent?.includes(macaque.name));
    expect(macaqueRows.map((r) => r.querySelector('a')?.textContent)).toEqual(['e9', 'e1']);
    expect(macaqueRows.map((r) => r.dataset.tier)).toEqual(['fdr', 'nominal']);
    expect(macaqueRows[0].lastElementChild).toHaveTextContent('FDR < 0.05');
    expect(macaqueRows[1].lastElementChild).toHaveTextContent('p < 0.05 only');
    expect(screen.getByRole('button', { name: /Show all 5 tracks \(3 not at p < 0\.05\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show all 5 tracks/ }));
    const i23 = screen.getByTitle('Open i23 in the pathway explorer').closest('.report-forest-row') as HTMLElement;
    expect(i23.dataset.tier).toBe('none');
    expect(i23.lastElementChild).toHaveTextContent('n.s.');
  });

  it('lists only FDR survivors when switched to FDR, and explains the FDR column', async () => {
    query.mockResolvedValue({ pathway, total: 6, loaded: 6, groups: [
      { dataset: macaque, contrast: getActiveContrast(macaque), tracks: [
        track('e9', true), track('i23'), track('e1', false, { pval: 0.03 }), track('e2'), track('e3'),
      ] },
      { dataset: mouse, contrast: getActiveContrast(mouse), tracks: [track(mouse.defaultTrack, true)] },
    ] } satisfies CrossDatasetPathwayReport);
    const { container } = mount();
    await screen.findByText(macaque.name);
    expect(screen.getByTitle('Open e1 in the pathway explorer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'FDR (q < 0.05)' }));
    expect(screen.queryByTitle('Open e1 in the pathway explorer')).toBeNull();
    expect(container.textContent).not.toMatch(/p < 0\.05 only/);
    expect(screen.getByRole('button', { name: /Show all 5 tracks \(4 not significant\)/ })).toBeTruthy();
    const legend = [...container.querySelectorAll('abbr')].find((a) => a.getAttribute('tabindex') === '0') as HTMLElement;
    expect(legend.textContent).toBe('FDR');
    expect(legend.title).toMatch(/FDR-adjusted p-value/);
  });

  it('adds studies to the shared cart and compares them through the header', async () => {
    const onCompare = vi.fn();
    mount(onCompare);
    fireEvent.click(await screen.findByRole('button', { name: `Add ${mouse.name} to compare set` }));
    fireEvent.click(screen.getByRole('button', { name: `Add ${macaque.name} to compare set` }));
    expect(getSnapshot()).toEqual([{ datasetId: mouse.id, trackId: mouse.defaultTrack }, { datasetId: macaque.id, trackId: macaque.defaultTrack }]);
    fireEvent.click(screen.getByRole('button', { name: 'Compare set, 2 studies' }));
    fireEvent.click(screen.getByRole('button', { name: /Compare 2/ }));
    expect(onCompare).toHaveBeenCalledWith(getSnapshot());
    fireEvent.click(screen.getByRole('button', { name: `Remove ${mouse.name} from compare set` }));
    expect(getSnapshot()).toHaveLength(1);
  });
});
