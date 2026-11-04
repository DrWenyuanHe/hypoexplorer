import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PathwayReport } from '../crossdataset/PathwayReport';
import { CompareSetButton } from '../compareset/CompareSetButton';
import { _resetCompareSetStore, getSnapshot } from '../compareset/compareSetStore';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { datasetHref } from '../utils/appLinks';
import type { CrossDatasetPathwayReport, PathwayTrackRow } from '../types';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../data/crossDataset', async (original) => ({ ...await original<typeof import('../data/crossDataset')>(), queryPathwayAcrossDatasets: query }));
const macaque = getDataset('macaque_snrna')!;
const mouse = getDataset('mouse_hypo_hfd_gse220533')!;
const pathway = 'HALLMARK_ADIPOGENESIS';

function track(trackId: string, significant = false): PathwayTrackRow {
  return { trackId, label: `${trackId} population`, type: 'Tissue', NES: significant ? 2.5 : 1.1, pval: 0.01, padj: significant ? 0.02 : 0.5, size: 30, db: 'HALLMARK', direction: 'up', significant };
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
    fireEvent.click(screen.getByRole('button', { name: /Show only the 1 significant track/ }));
    expect(screen.queryByTitle('Open i23 in the pathway explorer')).toBeNull();
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
