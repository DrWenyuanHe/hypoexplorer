import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from '../App';
import { DatasetInfoPanel } from '../common/DatasetInfoPanel';
import { getDataset } from '../data/datasets';
import { listContrasts } from '../data/contrasts';
import type { DatasetMeta } from '../types';

// The DatasetInfoPanel is the "access all metadata" affordance; these pin that it
// surfaces the registry fields and links every external identifier, and that the
// explorer hero's "Dataset info" button opens it.

const GSE_META: DatasetMeta = {
  populations: ['arcuate'],
  labels: { arcuate: 'Arcuate nucleus' },
  types: { arcuate: 'Tissue' },
  nGenes: { arcuate: 12345 },
  colors: { arcuate: '#3775BA' },
  qcFlags: { arcuate: { is3v3: false, nNormal: 4, nObese: 4, status: 'ok' } },
};

describe('DatasetInfoPanel', () => {
  it('shows organism, modality, accession link, PubMed link, and groups', () => {
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    render(
      <DatasetInfoPanel
        dataset={dataset}
        meta={GSE_META}
        contrasts={listContrasts(dataset)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const u = within(dialog);

    expect(u.getByText('Mus musculus')).toBeTruthy();
    expect(u.getByText('bulk RNA-seq')).toBeTruthy();

    // The GEO accession resolves to the NCBI GEO viewer.
    const geoLinks = u.getAllByRole('link').filter(
      (a) => a.getAttribute('href') === 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE225038',
    );
    expect(geoLinks.length).toBeGreaterThan(0);

    // The registry's PMID resolves to a chip that both names and links the id.
    const pubmed = u.getAllByRole('link').filter(
      (a) => a.getAttribute('href') === 'https://pubmed.ncbi.nlm.nih.gov/38145289/',
    );
    expect(pubmed.length).toBeGreaterThan(0);
    expect(pubmed.some((a) => a.textContent?.includes('PMID 38145289'))).toBe(true);

    // Experimental arms are listed with their replicate counts from the meta.
    expect(u.getAllByText(/Chow/).length).toBeGreaterThan(0);
    expect(u.getAllByText(/HFD/).length).toBeGreaterThan(0);
  });

  it('falls back to a DOI link when a dataset has no accession', () => {
    const dataset = getDataset('macaque_snrna')!; // DOI, no geo
    render(<DatasetInfoPanel dataset={dataset} contrasts={listContrasts(dataset)} onClose={() => {}} />);
    const u = within(screen.getByRole('dialog'));
    const doi = u.getAllByRole('link').filter(
      (a) => a.getAttribute('href') === 'https://doi.org/10.1016/j.cmet.2024.01.003',
    );
    expect(doi.length).toBeGreaterThan(0);
  });
});

describe('explorer hero — Dataset info button', () => {
  it('opens the metadata panel for the active dataset', () => {
    render(<App initialView="explorer" />);
    fireEvent.click(screen.getByRole('button', { name: /Dataset info/i }));
    const dialog = screen.getByRole('dialog');
    // Default dataset is the macaque snRNA atlas.
    expect(within(dialog).getByText('Macaca fascicularis')).toBeTruthy();

    // Focus moves into the dialog on open (WCAG 2.4.3).
    const panel = dialog.querySelector('.modal-panel');
    expect(panel).toBeTruthy();
    expect(panel === document.activeElement || panel!.contains(document.activeElement)).toBe(true);
  });
});

// ── Factorial replicate counts ──────────────────────────────────────────
// A 2x2 dataset has six groups (the two pooled diet arms plus the four cells),
// but the legacy qcFlags pair only ever knows the DEFAULT contrast's baseline
// and case. meta.groupN is the per-group source the bundle builders write for
// exactly this; without it four of GSE135639's six chips would render bare.
describe('DatasetInfoPanel — per-group replicate counts', () => {
  const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
  const POMC_META: DatasetMeta = {
    populations: ['pomc'],
    labels: { pomc: 'POMC neurons' },
    types: { pomc: 'Neuronal' },
    nGenes: { pomc: 15000 },
    colors: { pomc: '#B64342' },
    qcFlags: { pomc: { is3v3: false, nNormal: 8, nObese: 9, status: 'ok' } },
    groupN: { control: 8, case: 9, chow_p0: 5, chow_p21: 3, hfd_p0: 5, hfd_p21: 4 },
  };

  /** The Groups row's chips, in render order: each is "<n> <label>" or "<label>". */
  function groupChips(): string[] {
    const row = within(screen.getByRole('dialog')).getByText('Groups').closest('tr')!;
    return [...row.querySelectorAll('td:last-child > span:first-child > span')]
      .map((s) => (s.textContent || '').replace(/\s+/g, ' ').trim());
  }

  function renderPanel(meta: DatasetMeta) {
    render(
      <DatasetInfoPanel
        dataset={dataset}
        meta={meta}
        contrasts={listContrasts(dataset)}
        onClose={() => {}}
      />,
    );
  }

  it('reads every group count from meta.groupN, including the cells qcFlags cannot describe', () => {
    renderPanel(POMC_META);
    // Asserted as whole chips, not loose numbers, so a count landing on the
    // wrong group still fails.
    expect(groupChips()).toEqual([
      '8 Maternal chow', '9 Maternal HFD',
      '5 Chow · P0', '3 Chow · P21', '5 HFD · P0', '4 HFD · P21',
    ]);
  });

  it('falls back to the legacy qcFlags pair for the active contrast when meta.groupN is absent', () => {
    const { groupN: _drop, ...noGroupN } = POMC_META;
    renderPanel(noGroupN as DatasetMeta);
    // The DEFAULT contrast's arms keep their counts; every other group renders
    // bare rather than borrowing them. Since GSE135639's default is now the P21
    // cell contrast, the legacy pair lands on Chow · P21 / HFD · P21 — and the
    // pooled arms, which no contrast compares any more, go bare.
    //
    // The numbers are the pooled 8/9 because that is all the legacy qcFlags
    // pair holds; this fallback exists for bundles predating meta.groupN and is
    // approximate by construction. The point under test is WHICH groups it
    // labels, which is why the chips are asserted whole.
    expect(groupChips()).toEqual([
      'Maternal chow', 'Maternal HFD',
      'Chow · P0', '8 Chow · P21', 'HFD · P0', '9 HFD · P21',
    ]);
  });
});

// ── Stale meta: the tracks the registry and the bundle disagree about ──────
// Both adapters behind the record read a per-track QC blob, and until they were
// made to resolve that track the SAME way, a meta whose populations no longer
// match the registry's defaultTrack could put two different numbers on one pair
// of groups — or drop numbers it plainly held. Found by an independent review of
// the StudyFactTable migration; these pin the fix.
describe('DatasetInfoPanel — meta whose tracks disagree with the registry', () => {
  /** "<label> | <value>" for one labelled row of the record. */
  function row(field: string): string {
    const tr = within(screen.getByRole('dialog')).getByText(field).closest('tr')!;
    return (tr.querySelector('td')?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  it('reads Replicates and Groups from one track, never two', () => {
    // populations names a track the registry's defaultTrack is not among, while
    // qcFlags still carries both. Replicates resolves through populations[0];
    // Groups used to resolve through defaultTrack, so the same two groups were
    // labelled 2/3 in one row and 8/9 in the next.
    const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;
    render(
      <DatasetInfoPanel
        dataset={dataset}
        meta={{
          populations: ['other'],
          labels: { other: 'Other track' },
          types: { other: 'Tissue' },
          nGenes: { other: 10000 },
          colors: { other: '#3775BA' },
          qcFlags: {
            other: { is3v3: false, nNormal: 2, nObese: 3, status: 'ok' },
            pomc: { is3v3: false, nNormal: 8, nObese: 9, status: 'ok' },
          },
        }}
        contrasts={listContrasts(dataset)}
        onClose={() => {}}
      />,
    );
    // The default contrast is the P21 cell pair, so both rows describe those two
    // groups. They must quote the same track's counts.
    expect(row('Replicates')).toBe('2 Chow · P21vs3 HFD · P21');
    expect(row('Groups')).toContain('2 Chow · P21');
    expect(row('Groups')).toContain('3 HFD · P21');
    expect(row('Groups')).not.toMatch(/8|9/);
    // And the row says which track it is quoting, which is now that same track.
    expect(row('Groups')).toContain('(n for other)');
  });

  it('keeps counts it holds when the meta lists no populations at all', () => {
    // factsFromMeta gives up wholesale on an empty populations list, which left
    // the arms rendering as dashes even though qcFlags still held 4 and 4. The
    // old hand-rolled panel showed them; the shared table must too.
    const dataset = getDataset('mouse_arc_hfd_gse225038')!;
    render(
      <DatasetInfoPanel
        dataset={dataset}
        meta={{
          populations: [],
          labels: {},
          types: {},
          nGenes: {},
          colors: {},
          qcFlags: { arcuate: { is3v3: false, nNormal: 4, nObese: 4, status: 'ok' } },
        }}
        contrasts={listContrasts(dataset)}
        onClose={() => {}}
      />,
    );
    expect(row('Replicates')).toBe('4 Chowvs4 HFD');
  });
});
