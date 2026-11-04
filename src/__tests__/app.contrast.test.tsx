import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

// Inject the multi-contrast fixture dataset into the registry so the App's
// contrast selector has a >1-contrast dataset to exercise. The resolver helpers
// (getActiveContrast / listContrasts / getDefaultDataset) stay REAL — they
// operate on dataset objects — so only DATASETS / listDatasets / getDataset are
// augmented. Scoped to this file so the other App tests are unaffected.
vi.mock('../data/datasets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/datasets')>();
  const fixtures = await import('./fixtures');
  const augmented = [...actual.DATASETS, fixtures.MULTICONTRAST_DATASET_FIXTURE];
  return {
    ...actual,
    DATASETS: augmented,
    listDatasets: () => augmented,
    getDataset: (id: string) => augmented.find((d) => d.id === id) ?? null,
  };
});

// The library now joins every production registry row to the generated
// author-validation sidecar. This test adds one synthetic registry row, so give
// only that fixture a synthetic sidecar record while keeping production lookup
// strict for every real dataset.
vi.mock('../data/authorValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/authorValidation')>();
  const fixtureValidation = {
    ...actual.requireAuthorValidation('macaque_snrna'),
    datasetId: 'mouse_fasting_tc',
    accession: 'TEST',
    summary: 'Synthetic test fixture',
  };
  return {
    ...actual,
    requireAuthorValidation: (datasetId: string) => (
      datasetId === 'mouse_fasting_tc'
        ? fixtureValidation
        : actual.requireAuthorValidation(datasetId)
    ),
  };
});

// The QC ledger requires a record for every registered contrast, including this
// file's synthetic dataset. Keep the real registry coverage checks enabled.
vi.mock('../../data/internal-qc/assessments.generated.json', async (importOriginal) => {
  const actual = await importOriginal<{ default: { policyVersion: string; records: unknown[] } }>();
  const { MULTICONTRAST_DATASET_FIXTURE } = await import('./fixtures');
  const assessment = {
    status: 'not_assessed',
    scope: 'Synthetic test fixture',
    policyVersion: actual.default.policyVersion,
    checks: [{ id: 'fixture', label: 'Synthetic fixture', status: 'not_assessed', note: 'No biological data.' }],
  };
  const records = [...actual.default.records, {
    datasetId: MULTICONTRAST_DATASET_FIXTURE.id,
    assessment,
    contrasts: Object.fromEntries(MULTICONTRAST_DATASET_FIXTURE.contrasts.map(({ id }) => [id, assessment])),
  }];
  // internalQc.ts imports `records` by name; keep the default object in step.
  return { ...actual, records, default: { ...actual.default, records } };
});

import App from '../App';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { MULTICONTRAST_TRACK_FIXTURE } from './fixtures';
import { parseRoute } from '../utils/appLinks';
import { setChartScale } from '../common/chartScaleStore';

// Seed the eager globals for the multi-contrast dataset so switchDataset resolves
// its meta + default track synchronously (no network).
function seedFastingDataset() {
  (window as any).HX_MOUSE_FASTING_TC_META = {
    populations: ['whole'],
    labels: { whole: 'Whole hypothalamus' },
    types: { whole: 'Whole tissue' },
    qcFlags: { whole: { nNormal: 3, nObese: 3, is3v3: true } },
    nGenes: { whole: 2 },
  };
  (window as any).HX_MOUSE_FASTING_TC_WHOLE = MULTICONTRAST_TRACK_FIXTURE;
  return () => {
    delete (window as any).HX_MOUSE_FASTING_TC_META;
    delete (window as any).HX_MOUSE_FASTING_TC_WHOLE;
    _resetTrackCache();
    _resetDatasetMetaCache();
  };
}

afterEach(() => {
  _resetTrackCache();
  _resetDatasetMetaCache();
});

/** Backstop for a test that mounts the dataset library to switch dataset. The
 *  cost here was never the render: it was an unscoped role+name query for the
 *  drawer's commit button, which priced in the accessible name of all 145 card
 *  buttons. Both sites below scope that query to the drawer. Same reasoning as
 *  LIBRARY_SWITCH_TIMEOUT_MS in app.dataset.test.tsx; still a hang backstop. */
const LIBRARY_SWITCH_TIMEOUT_MS = 60000;

describe('App — contrast selector (multi-contrast dataset)', () => {
  it('opens a copied analysis in a fresh mount with its non-default contrast, genes and volcano settings', async () => {
    const restore = seedFastingDataset();
    try {
      window.history.replaceState(null, '', '/#/dataset/mouse_fasting_tc');
      const first = render(<App />);
      fireEvent.change(await screen.findByLabelText('Active contrast'), { target: { value: 'refed_vs_fed' } });
      const search = await screen.findByRole('textbox', { name: 'Search gene' });
      fireEvent.change(search, { target: { value: 'FOS' } });
      fireEvent.keyDown(search, { key: 'Enter' });
      await screen.findByRole('button', { name: 'Remove FOS' });
      fireEvent.click(screen.getByRole('button', { name: 'FDR' }));
      const sliders = screen.getAllByRole('slider');
      fireEvent.change(sliders[0], { target: { value: '1.5' } });
      fireEvent.change(sliders[1], { target: { value: '3' } });
      await act(async () => { setChartScale('log2'); });
      const copied = window.location.hash;
      const saved = parseRoute(copied);
      expect(saved?.view === 'explorer' && saved.analysis).toMatchObject({
        version: 1, contrastId: 'refed_vs_fed', genes: ['FOS'], chartScale: 'log2',
        volcano: { metric: 'fdr', logFCThresh: 1.5, sigThresh: 3 },
      });
      first.unmount();
      await act(async () => { setChartScale('native'); });
      localStorage.clear();
      window.history.replaceState(null, '', `/${copied}`);
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText('Active contrast')).toHaveValue('refed_vs_fed'));
      expect(await screen.findByRole('button', { name: 'Remove FOS' })).toBeInTheDocument();
      expect(screen.getAllByRole('slider')[0]).toHaveValue('1.5');
      expect(screen.getAllByRole('slider')[1]).toHaveValue('3');
      expect(screen.getByText('(−log₁₀ = 3.00)')).toBeInTheDocument();
      expect(parseRoute(window.location.hash)).toEqual(saved);
    } finally {
      restore();
      await act(async () => { setChartScale('native'); });
    }
  }, LIBRARY_SWITCH_TIMEOUT_MS);

  it('renders NO contrast selector for the single-contrast macaque default', () => {
    render(<App initialView="explorer" />);
    expect(screen.queryByLabelText('Active contrast')).toBeNull();
  });

  it('shows the selector with one option per contrast after switching to a multi-contrast dataset, and switching a contrast swaps the resolved baseline→case', async () => {
    const restore = seedFastingDataset();
    try {
      render(<App initialView="explorer" />);

      // Macaque default: no selector yet.
      expect(screen.queryByLabelText('Active contrast')).toBeNull();

      // Switch dataset to the fasting timecourse through the dataset library,
      // which is how a user changes dataset now that the topbar <select> is gone.
      fireEvent.click(screen.getByRole('button', { name: /Active dataset:/i }));
      const card = (await screen.findAllByText('Mouse hypothalamus (fasting timecourse, bulk RNA-seq)'))[0];
      fireEvent.click(card.closest('button') as HTMLElement);
      // Scoped to the study record: an unscoped role+name query here costs the
      // accessible name of every dataset card button in the library.
      const record = await screen.findByRole('article');
      fireEvent.click(within(record).getByRole('button', { name: /Open in explorer/i }));

      // The contrast selector now appears, with both declared contrasts.
      const contrastSelect = (await screen.findByLabelText('Active contrast')) as HTMLSelectElement;
      expect([...contrastSelect.options].map((o) => o.value)).toEqual(['fast24_vs_fed', 'refed_vs_fed']);
      expect([...contrastSelect.options].map((o) => o.textContent)).toEqual([
        'Fasted 24h vs Fed',
        'Refed vs Fed',
      ]);
      // Defaults to the isDefault contrast.
      expect(contrastSelect.value).toBe('fast24_vs_fed');

      // Hero case-group chip reflects the active contrast: "3 Fasted 24h".
      const chipText = () => [...document.querySelectorAll('span')].map((s) => (s.textContent || '').trim());
      await waitFor(() => {
        expect(chipText().some((t) => /^3\s+Fasted 24h$/.test(t))).toBe(true);
      });

      // Switch the contrast → the resolved case group becomes Refed.
      await act(async () => {
        fireEvent.change(contrastSelect, { target: { value: 'refed_vs_fed' } });
      });
      await waitFor(() => {
        expect(chipText().some((t) => /^3\s+Refed$/.test(t))).toBe(true);
        // The previous contrast's case group is no longer shown as a chip.
        expect(chipText().some((t) => /^3\s+Fasted 24h$/.test(t))).toBe(false);
      });
      expect(contrastSelect.value).toBe('refed_vs_fed');
    } finally {
      restore();
    }
  }, LIBRARY_SWITCH_TIMEOUT_MS);
});

// ── The 2×2: grouped selector, exploratory gate, across-comparisons entry ────
// GSE135639 is the real factorial dataset in the registry, so these run against
// the shipped manifest rather than a fixture: the selector's <optgroup> bands,
// the exploratory-warning rule, and the Gene Explorer button that opens the
// across-comparisons matrix are all authored THERE, and a manifest edit that
// breaks them should fail here.
const POMC_NAME = 'Mouse arcuate POMC neurons — maternal HFD (RiboTag)';
const POMC_SAMPLES = ['c0_1', 'c0_2', 'c0_3', 'c0_4', 'c0_5', 'c21_1', 'c21_2', 'c21_3',
  'h0_1', 'h0_2', 'h0_3', 'h0_4', 'h0_5', 'h21_1', 'h21_2', 'h21_3', 'h21_4'];
const POMC_DE = [
  { gene: 'Timp1', logFC: 0.12, logCPM: 5, PValue: 0.5, FDR: 0.9, rank_score: 0.1, rankPos: 1 },
];

function seedPomcDataset() {
  const NS = 'HX_MOUSE_POMC_MATERNAL_HFD_GSE135639';
  (window as any)[`${NS}_META`] = {
    populations: ['pomc'],
    labels: { pomc: 'POMC neurons' },
    types: { pomc: 'Neuronal' },
    colors: { pomc: '#B64342' },
    nGenes: { pomc: 1 },
    qcFlags: { pomc: { nNormal: 8, nObese: 9, is3v3: false } },
    groupN: { control: 8, case: 9, chow_p0: 5, chow_p21: 3, hfd_p0: 5, hfd_p21: 4 },
  };
  (window as any)[`${NS}_POMC`] = {
    meta: {
      code: 'pomc', label: 'POMC neurons', type: 'Neuronal',
      sampleNames: POMC_SAMPLES, samplesKept: POMC_SAMPLES, sampleOrder: POMC_SAMPLES,
      groupSamples: {
        control: POMC_SAMPLES.slice(0, 8), case: POMC_SAMPLES.slice(8),
        chow_p0: POMC_SAMPLES.slice(0, 5), chow_p21: POMC_SAMPLES.slice(5, 8),
        hfd_p0: POMC_SAMPLES.slice(8, 13), hfd_p21: POMC_SAMPLES.slice(13),
      },
      nGenes: 1,
    },
    qc: { cluster: 'pomc', clusterLabel: 'POMC neurons', minCells: null, nNormal: 8, nObese: 9, is3v3: false, samplesKept: POMC_SAMPLES },
    de: POMC_DE,
    deByContrast: {
      hfd_vs_chow_p0: POMC_DE, p21_vs_p0_chow: POMC_DE, p21_vs_p0_hfd: POMC_DE,
    },
    cpm: { Timp1: POMC_SAMPLES.map(() => 10) },
  };
  return () => {
    delete (window as any)[`${NS}_META`];
    delete (window as any)[`${NS}_POMC`];
    _resetTrackCache();
    _resetDatasetMetaCache();
  };
}

/** Open the explorer on GSE135639 through the dataset library, as a user would. */
async function openPomcExplorer() {
  render(<App initialView="explorer" />);
  fireEvent.click(screen.getByRole('button', { name: /Active dataset:/i }));
  const card = (await screen.findAllByText(POMC_NAME))[0];
  fireEvent.click(card.closest('button') as HTMLElement);
  // Scoped to the study record — see LIBRARY_SWITCH_TIMEOUT_MS.
  const record = await screen.findByRole('article');
  fireEvent.click(within(record).getByRole('button', { name: /Open in explorer/i }));
  return (await screen.findByLabelText('Active contrast')) as HTMLSelectElement;
}

describe('App — factorial (2×2) dataset surfaces', () => {
  // One walk, not three: each of these assertions needs the same mounted
  // explorer on the same dataset, and mounting App + navigating the dataset
  // library costs seconds. Three separate mounts pushed this FILE past the
  // per-test timeout under full-suite worker contention while passing in
  // isolation - the flakiest kind of test debt.
  it('walks the 2x2: grouped selector, exploratory gate, across-comparisons matrix', async () => {
    const restore = seedPomcDataset();
    try {
      const select = await openPomcExplorer();

      // ── The selector carries the design's structure ──────────────────────
      // Every declared contrast is offered, in manifest order...
      expect([...select.options].map((o) => o.value)).toEqual([
        'hfd_vs_chow_p0', 'hfd_vs_chow_p21',
        'p21_vs_p0_chow', 'p21_vs_p0_hfd',
      ]);
      // ...and adjacent contrasts sharing a `group` collapse into one band, so
      // the 2x2's structure is visible in the selector itself.
      const bands = [...select.querySelectorAll('optgroup')];
      expect(bands.map((g) => g.getAttribute('label')))
        .toEqual(['Maternal-diet effect', 'Maturation (P0 → P21)']);
      expect(bands.map((g) => g.querySelectorAll('option').length)).toEqual([2, 2]);

      // ── The exploratory gate reads the FLAG, not the description ─────────
      // The default contrast is an exploratory re-analysis, so the warning
      // rides beside the volcano.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /exploratory contrast/i })).toBeTruthy();
      });
      // The maturation axis IS the published analysis, re-fit. It carries a
      // description too - which is exactly what the old gate keyed on - so it
      // must NOT be branded exploratory.
      await act(async () => {
        fireEvent.change(select, { target: { value: 'p21_vs_p0_chow' } });
      });
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /exploratory contrast/i })).toBeNull();
      });

      // ── "Across comparisons" is on the toolbar from the start ──────────
      // Its gate is the DATASET declaring more than one contrast, not the
      // selection: with nothing picked it opens on a prompt that says what it
      // needs (see the macaque case below for the other side of that rule).
      const acrossBefore = await screen.findByRole('button', { name: /Across comparisons/i });
      fireEvent.click(acrossBefore);
      const prompt = within(await screen.findByRole('dialog'));
      expect(prompt.getByText(/Select a gene/i)).toBeTruthy();
      fireEvent.click(prompt.getByRole('button', { name: /close/i }));

      const search = await screen.findAllByPlaceholderText(/Search gene/i);
      await act(async () => {
        fireEvent.change(search[0], { target: { value: 'Timp1' } });
      });
      // The suggestion list commits on mouseDown (blur would close it first).
      fireEvent.mouseDown(await screen.findByRole('button', { name: /^Timp1/ }));

      fireEvent.click(await screen.findByRole('button', { name: /Across comparisons/i }));
      // The matrix opens with one column per declared contrast. Scoped to the
      // modal: the contrast labels also live in the selector behind it.
      const matrix = within(await screen.findByRole('dialog'));
      expect(matrix.getByText(/Bold = FDR/)).toBeTruthy();
      const headerCells = [...(await matrix.findAllByRole('columnheader'))]
        .map((th) => (th.textContent || '').trim());
      expect(headerCells).toContain('Maternal HFD vs chow · at P21');
      expect(headerCells).toContain('P21 vs P0 · HFD arm (maturation)');
    } finally {
      restore();
    }
  }, LIBRARY_SWITCH_TIMEOUT_MS);


  it('hides "Across comparisons" on the single-contrast macaque default', async () => {
    render(<App initialView="explorer" />);
    const search = await screen.findByPlaceholderText(/Search gene/i);
    await act(async () => {
      fireEvent.change(search, { target: { value: 'LEP' } });
    });
    // "+ Add all N →" commits the current search to the selection.
    fireEvent.click(await screen.findByRole('button', { name: /Add all 1/ }));
    // The other two views are always on the toolbar...
    expect(await screen.findByRole('button', { name: /Summary table/i })).toBeTruthy();
    // ...but a single-contrast dataset has nothing to compare across, so this
    // one stays off entirely rather than opening a view that can only say so.
    expect(screen.queryByRole('button', { name: /Across comparisons/i })).toBeNull();
  });
});
