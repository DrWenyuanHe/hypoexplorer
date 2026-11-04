import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { buildRegistry, integrationFor, trimRecord } from '../../scripts/lib/trackerIntegration.mjs';
import { loadReviews } from '../dataset-tracker/reviewStore';
import { modelGroup } from '../dataset-tracker/trackerLogic';
import { TrackerTable } from '../dataset-tracker/TrackerTable';
import { TrackerBoard } from '../dataset-tracker/TrackerBoard';
import { TrackerDetail } from '../dataset-tracker/TrackerDetail';
import type { TrackerRow } from '../types';

// The matcher that decides which candidates are already in the explorer. Two
// tiers: a shared accession/BioProject means the SAME dataset (integrated); only
// a shared DOI/PMID means the same PAPER (a different series — not integrated).
describe('tracker integration matcher', () => {
  const registry = buildRegistry(
    [
      {
        id: 'mouse_arc_hfd_gse225038',
        name: 'Mouse arcuate',
        geo: 'GSE225038',
        doi: '',
        citation: 'Ritter & Grobe (GSE225038, PMID 38145289)',
      },
    ],
    { mouse_arc_hfd_gse225038: { accessions: ['PRJNA933607'], pmids: ['38145289'] } },
  );

  it('treats a shared GEO accession as the same dataset (integrated)', () => {
    const m = integrationFor({ shortAcc: 'GSE225038', links: {} }, registry);
    expect(m?.tier).toBe('dataset');
  });

  it('treats a shared BioProject as the same dataset (integrated)', () => {
    const m = integrationFor(
      { shortAcc: 'GSE999999', links: { bioproject: 'PRJNA933607' } },
      registry,
    );
    expect(m?.tier).toBe('dataset');
  });

  it('treats a PMID-only match as the same publication, NOT integrated', () => {
    const m = integrationFor({ shortAcc: 'GSE224716', links: { pmid: '38145289' } }, registry);
    expect(m?.tier).toBe('publication');
  });

  it('returns null for an unrelated record', () => {
    expect(
      integrationFor({ shortAcc: 'GSE111111', links: { pmid: '12345678' } }, registry),
    ).toBeNull();
  });
});

// Tissue vs. hypothalamus-derived cell-model facet (the pass-9 scope expansion).
describe('modelGroup (tissue vs cell line)', () => {
  it('flags an explicit isCellLine record as Cell line', () => {
    expect(
      modelGroup({ isCellLine: true, region: 'cell line: mHypoE-44', title: 'palmitate' } as TrackerRow),
    ).toBe('Cell line');
  });

  it('classifies plain tissue as Tissue', () => {
    expect(
      modelGroup({ region: 'Whole hypothalamus', title: 'HFD vs chow bulk RNA-seq' } as TrackerRow),
    ).toBe('Tissue');
  });

  it('falls back to a region/title regex for legacy rows without the flag', () => {
    // The 27 cell-line rows catalogued before isCellLine existed must still classify.
    expect(
      modelGroup({ region: 'GT1-7 cell line', title: 'Klf4 knockdown GT1-7' } as TrackerRow),
    ).toBe('Cell line');
    expect(
      modelGroup({ region: '', title: 'iPSC-derived hypothalamic neurons' } as TrackerRow),
    ).toBe('Cell line');
    // "single-cell" must NOT trip the "cell line" matcher.
    expect(modelGroup({ region: 'Arcuate', title: 'single-cell RNA-seq atlas' } as TrackerRow)).toBe(
      'Tissue',
    );
  });

  it('trimRecord carries isCellLine + cellLine through to the row shape', () => {
    const row = trimRecord({ shortAcc: 'GSE1', isCellLine: true, cellLine: 'GT1-7' });
    expect(row.isCellLine).toBe(true);
    expect(row.cellLine).toBe('GT1-7');
  });
});

// The n≥3 tri-state (nState) is rendered by three views in three different
// wordings, and two of them fall back to STATUSES[0] for an unrecognised status.
// These pin the exact visible text of every branch, so the shared cell can only
// keep rendering what each site rendered before.
const nRow = (acc: string, min: number | null): TrackerRow =>
  ({
    acc,
    title: `${acc} title`,
    species: 'Mus musculus',
    region: 'Arcuate',
    modality: 'bulk RNA-seq',
    n: '12',
    links: {},
    nadeq: min === null ? null : { min },
  }) as TrackerRow;

// ok (n≥3) · excluded (n<3) · unknown (no nadeq)
const N_ROWS = [nRow('GSE1', 6), nRow('GSE2', 1), nRow('GSE3', null)];
const noop = () => {};

describe('tracker n≥3 tri-state + status label', () => {
  it('table: renders the compact ✓ / ✗ / ? cell', () => {
    const { container } = render(
      <TrackerTable
        rows={N_ROWS}
        statusOf={() => 'new'}
        sort={{ key: 'acc', dir: 1 }}
        setSort={noop}
        selectedAcc={null}
        onSelect={noop}
        canEdit={false}
        onSetStatus={noop}
      />,
    );
    expect(container.querySelector('.nok')?.textContent).toBe('6✓');
    expect(container.querySelector('.nbad')?.textContent).toBe('1✗');
    expect(container.querySelector('.nunk')?.textContent).toBe('?');
    // the n<3 row is marked on the <tr> itself
    expect(container.querySelectorAll('tr.exrow').length).toBe(1);
  });

  it('table: the read-only status badge labels a known status and falls back to New', () => {
    const badge = (status: string) => {
      const { container } = render(
        <TrackerTable
          rows={[N_ROWS[0]]}
          statusOf={() => status}
          sort={{ key: 'acc', dir: 1 }}
          setSort={noop}
          selectedAcc={null}
          onSelect={noop}
          canEdit={false}
          onSetStatus={noop}
        />,
      );
      return container.querySelector('.stbadge') as HTMLElement;
    };
    expect(badge('pipeline').textContent).toBe('In pipeline');
    const unknown = badge('not-a-status');
    expect(unknown.textContent).toBe('New');
    expect(unknown.className).toBe('stbadge not-a-status');
  });

  it('detail: renders the long-form n≥3 row and the header status badge', () => {
    const dossier = (row: TrackerRow, status: string) => {
      const { container } = render(
        <TrackerDetail
          row={row}
          entry={{}}
          status={status}
          canEdit={false}
          onSetStatus={noop}
          onSetNote={noop}
          onOpenInExplorer={noop}
          onClose={noop}
        />,
      );
      return container;
    };
    expect(dossier(N_ROWS[0], 'reviewed').querySelector('.nok')?.textContent).toBe(
      'Passes, minimum 6 per group',
    );
    expect(dossier(N_ROWS[1], 'new').querySelector('.nbad')?.textContent).toBe(
      'Excluded, n<3. Minimum 1 per group',
    );
    expect(dossier(N_ROWS[2], 'new').querySelector('.nunk')?.textContent).toBe('unknown');
    expect(dossier(N_ROWS[0], 'reviewed').querySelector('.tk-headbadge')?.textContent).toBe(
      'Reviewed',
    );
    // same STATUSES[0] fallback as the table badge
    expect(dossier(N_ROWS[0], 'not-a-status').querySelector('.tk-headbadge')?.textContent).toBe(
      'New',
    );
  });

  it('board: appends “ · n<3” to the card meta line only for the excluded state', () => {
    const { container } = render(
      <TrackerBoard
        rows={N_ROWS}
        statusOf={() => 'new'}
        onSelect={noop}
        canEdit={false}
        onSetStatus={noop}
      />,
    );
    expect(Array.from(container.querySelectorAll('.cmeta')).map((e) => e.textContent)).toEqual([
      'Mouse · Bulk · —',
      'Mouse · Bulk · — · n<3',
      'Mouse · Bulk · —',
    ]);
  });
});

describe('reviewStore', () => {
  it('loadReviews resolves to an object (baked fallback when no dev API)', async () => {
    const r = await loadReviews();
    expect(typeof r).toBe('object');
    expect(r).not.toBeNull();
  });
});

describe('Dataset Tracker view in App', () => {
  it('opens from the hub, lists candidates, hides n<3 by default, flags same-paper', async () => {
    const { container } = render(<App initialView="hub" />);
    // The hub exposes "Dataset tracker" both as a row and a util-nav link; either
    // navigates. Click the first match.
    fireEvent.click(screen.getAllByText('Dataset tracker')[0]);

    await waitFor(() => expect(screen.getByText('GSE900001')).toBeInTheDocument());

    // n>=3 candidate is shown; the related (same-paper) candidate is shown.
    expect(screen.getByText('GSE224716')).toBeInTheDocument();
    // the "same paper" badge renders for the related row (precise: the badge span,
    // not the "Same paper" filter option)
    expect(container.querySelector('.intbadge.rel')).toBeTruthy();
    // the n<3 candidate is hidden by the default n>=3 filter
    expect(screen.queryByText('GSE900002')).not.toBeInTheDocument();

    // The default filter state is NOT "filtered" (isFiltered is derived from
    // DEFAULT_FILTERS, including the non-'all' n≥3 default); relaxing one filter
    // away from its default is.
    expect(container.querySelector('.shown')?.textContent).toBe('2 shown');
    fireEvent.change(container.querySelectorAll('select')[1], { target: { value: 'all' } });
    expect(container.querySelector('.shown')?.textContent).toBe('3 shown (filtered)');
  });
});
