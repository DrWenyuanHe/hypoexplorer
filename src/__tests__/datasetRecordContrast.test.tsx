import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DatasetInfoPanel } from '../common/DatasetInfoPanel';
import { getDataset } from '../data/datasets';
import { getActiveContrast, listContrasts } from '../data/contrasts';
import type { DatasetMeta } from '../types';

// The explorer's record follows the contrast the USER has selected.
//
// The modal is opened from the study bar, which already names the selected
// arms. Resolving its numbers against the dataset's default contrast instead
// would have it label those arms with a different comparison's replicate
// counts — the exact failure the panel's own note calls out. Both the arms row
// and the per-group row have to follow the same selection, or the record
// contradicts itself two rows apart.

const dataset = getDataset('mouse_pomc_maternal_hfd_gse135639')!;

/** A pre-groupN bundle: qcFlags carries only the study's pooled pair, so the
 *  two counts it can supply are forced to choose a pair of cells to land on. */
const LEGACY_META: DatasetMeta = {
  populations: ['pomc'],
  labels: { pomc: 'POMC neurons' },
  types: { pomc: 'Neuronal' },
  nGenes: { pomc: 15000 },
  colors: { pomc: '#B64342' },
  qcFlags: { pomc: { is3v3: false, nNormal: 8, nObese: 9, status: 'ok' } },
};

function row(field: string): string {
  const tr = within(screen.getByRole('dialog')).getByText(field).closest('tr')!;
  return (tr.querySelector('td')?.textContent || '').replace(/\s+/g, ' ').trim();
}

describe('DatasetInfoPanel — the contrast the explorer has selected', () => {
  it('resolves the arms, the group counts and the caveat against it, not the default', () => {
    // The registry's default here is the P21 cell pair; the explorer is showing
    // the P0 one.
    const selected = getActiveContrast(dataset, 'hfd_vs_chow_p0')!;
    render(
      <DatasetInfoPanel
        dataset={dataset}
        meta={LEGACY_META}
        contrasts={listContrasts(dataset)}
        activeContrast={selected}
        onClose={() => {}}
      />,
    );

    // Arms: the selected contrast's cells, carrying the only pair of counts the
    // legacy bundle holds.
    expect(row('Replicates')).toBe('8 Chow · P0vs9 HFD · P0');

    // Groups: the SAME allocation, one row down. Before the record was shared,
    // these two rows were derived separately and could disagree.
    const groups = row('Groups');
    expect(groups).toContain('8 Chow · P0');
    expect(groups).toContain('9 HFD · P0');
    // The P21 cells are the default's arms, and must not be labelled here.
    expect(groups).toMatch(/(?<!\d )Chow · P21/);
    expect(groups).not.toContain('8 Chow · P21');
    expect(groups).not.toContain('9 HFD · P21');

    // And the record says out loud which of the four comparisons those numbers
    // belong to.
    expect(row('Contrasts')).toContain('Replicates above are for Maternal HFD vs chow · at P0.');
  });
});
