import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useMemo, type JSX } from 'react';
import { GeneExplorerTab } from '../gene-explorer/GeneExplorerTab';
import { GenePicker } from '../common/GenePicker';
import { buildPopData } from '../data/buildPopData';
import { nomenclatureAuthorityForOrganism, _resetNomenclature } from '../data/nomenclature';
import { _resetBundleCache } from '../data/bundleSource';
import { useGeneSelection } from '../explorer/explorerSession';
import { geneVocabulary, useBoundGeneSelection } from '../explorer/geneVocabulary';
import { POP_E9_FIXTURE, MACAQUE_DATASET, MACAQUE_CONTRAST, stubVolcanoView } from './fixtures';
import type { PopData, RawTrack } from '../types';

// The shared gene picker shows a retired symbol's "now X" note wherever an
// authority applies. The compare set's case (two species, two authorities)
// is in compareSetView.test.tsx, beside that view's bundle fixtures.

// e9 stores POMC, IP6K1 and TBX3; AARS is added as the retired HGNC symbol.
const withGene = (track: RawTrack, gene: string): RawTrack => ({
  ...track,
  de: [...(track.de ?? []), { gene, logFC: 0.1, PValue: 0.6, FDR: 0.9 }],
  cpm: { ...track.cpm, [gene]: [3, 3, 3, 3, 3, 3] },
});
const E9 = buildPopData(withGene(POP_E9_FIXTURE, 'AARS'), MACAQUE_DATASET, MACAQUE_CONTRAST) as PopData;
// A second population that lacks AARS but carries a gene e9 does not.
const I23 = buildPopData(
  { ...withGene(POP_E9_FIXTURE, 'AGRP'), meta: { ...POP_E9_FIXTURE.meta, code: 'i23' } } as RawTrack,
  MACAQUE_DATASET, MACAQUE_CONTRAST,
) as PopData;

const ALIAS_FIXTURE = { v: 1, rows: [['AARS', 0, 1, 'AARS1', '', '']] };

beforeEach(() => {
  _resetNomenclature();
  _resetBundleCache();
  (globalThis as any).HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = ALIAS_FIXTURE;
});

afterEach(() => {
  cleanup();
  (globalThis as any).HX_NOMENCLATURE_ALIASES = undefined;
  (globalThis as any).window.HX_NOMENCLATURE_ALIASES = undefined;
  _resetNomenclature();
  _resetBundleCache();
});

async function mount(ui: JSX.Element) {
  render(ui);
  await act(async () => { await Promise.resolve(); });
}

function pick(gene: string) {
  const input = screen.getByPlaceholderText(/Search gene/i);
  fireEvent.change(input, { target: { value: gene } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('GenePicker — the retired-symbol note on a chip', () => {
  it('Gene Explorer: shows "now AARS1" on the stored AARS', async () => {
    function Explorer() {
      return (
        <GeneExplorerTab geneSelection={useGeneSelection()} volcano={stubVolcanoView()}
          popData={E9} nomenclatureAuthority="HGNC" />
      );
    }
    await mount(<Explorer />);
    pick('aars');
    expect(screen.getByRole('button', { name: 'Remove AARS' })).toBeTruthy();
    const note = await screen.findByText('now AARS1');
    expect(note.getAttribute('title')).toMatch(/HGNC now calls this gene AARS1\. The dataset stores the older spelling/);
  });

  it('Compare: shows the same note over the union of the loaded populations', async () => {
    // The Compare tab's binding, over the loaded populations' PopData: one
    // source per population, each under the dataset's authority. Rendered
    // without the tab's population loading, which is not what this pins.
    function Compare({ pops }: { pops: PopData[] }) {
      const vocabulary = useMemo(() => {
        const authority = nomenclatureAuthorityForOrganism(MACAQUE_DATASET.organism);
        return geneVocabulary(pops.map((pd) => ({ geneNames: pd.geneNames, authority })));
      }, [pops]);
      const selection = useBoundGeneSelection(useGeneSelection(), vocabulary);
      return <GenePicker selection={selection} scopeLabel="the selected populations" filenameParts={['hypoexplorer_compare']} />;
    }
    await mount(<Compare pops={[I23, E9]} />);
    // AARS is only in the second population; AGRP only in the first.
    pick('aars');
    pick('agrp');
    expect(screen.getByRole('button', { name: 'Remove AARS' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove AGRP' })).toBeTruthy();
    expect(screen.getByText('2 genes selected')).toBeTruthy();
    expect(await screen.findByText('now AARS1')).toBeTruthy();
  });
});
