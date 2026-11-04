import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import { getActiveContrast } from '../data/contrasts';
import { groupSampleTooltip } from '../utils/sampleIds';
import type { Dataset, DatasetMeta, RawTrack } from '../types';

// Per-track replicate sample ids: the QC "Sizes" section lists each loaded
// track's kept (and any QC-dropped) sample ids per arm — sourced from the track
// bundle (groupSamples + samplesKept), not the aggregate nNormal/nObese counts.
// The same partition feeds the hero pill tooltips via groupSampleTooltip.

const noop = () => {};
const ths = (c: HTMLElement) => [...c.querySelectorAll('th')].map((t) => (t.textContent ?? '').replace(/[↑↓\s]+$/, ''));
const S = (n: number) => `HCA_Macaque001_S00${n}`;

const dataset = {
  trackNoun: 'population',
  supportsPathways: true,
  modality: 'snRNA-seq',
  groups: [
    { key: 'normal', label: 'Normal', color: '#3775BA' },
    { key: 'obese', label: 'Obese', color: '#B64342' },
  ],
  contrasts: [{ id: 'obese_vs_normal', baseline: 'normal', case: 'obese', isDefault: true }],
} as unknown as Dataset;

const meta = {
  populations: ['e9', 'i23'],
  labels: { e9: 'POMC/TBX3', i23: 'AGRP/MCTP2' },
  // e9 dropped one obese replicate (3v3 → 3v2); i23 is a clean 3v3.
  qcFlags: { e9: { is3v3: false, nNormal: 3, nObese: 2 }, i23: { is3v3: true, nNormal: 3, nObese: 3 } },
  qaReportFilenames: {},
} as unknown as DatasetMeta;

const emptyQc = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} };

// Only e9's bundle is loaded; i23 has not been opened, so its ids are unavailable.
const tracks = {
  e9: {
    meta: {
      groupSamples: { normal: [S(1), S(2), S(3)], obese: [S(4), S(5), S(6)] },
      samplesKept: [S(1), S(2), S(3), S(4), S(5)],
    },
    qc: { samplesKept: [S(1), S(2), S(3), S(4), S(5)] },
    cpm: {},
  },
} as unknown as Record<string, RawTrack>;

const renderTab = () => render(
  <QCTab onSelectTrack={noop} qcData={emptyQc} meta={meta}
    dataset={dataset} contrast={getActiveContrast(dataset)} getTrack={(id) => tracks[id]} />,
);

describe('QCTab — per-track replicate sample ids in the Sizes section', () => {
  it('adds a "Replicate samples" column', () => {
    const { container } = renderTab();
    expect(ths(container)).toContain('Replicate samples');
  });

  it('shows a kept-count toggle for a loaded track and reveals per-arm ids on expand', () => {
    const { container } = renderTab();
    // One dropped sample → the toggle reports the kept/total ratio, collapsed.
    const toggle = screen.getByRole('button', { name: '5/6 kept' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Ids are hidden until expanded.
    expect(container.textContent).not.toContain('S001, S002, S003');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '5/6 kept' })).toHaveAttribute('aria-expanded', 'true');
    // Per-arm kept ids, donor prefix stripped.
    expect(container.textContent).toContain('S001, S002, S003'); // Normal arm
    expect(container.textContent).toContain('S004, S005');       // Obese arm (kept)
    // The QC-dropped obese replicate is surfaced, struck through.
    const dropped = screen.getByTitle('Dropped by QC');
    expect(dropped).toHaveTextContent('S006');
    expect(dropped).toHaveStyle({ textDecoration: 'line-through' });
  });

  it('renders an em-dash with a hint for a track whose bundle is not loaded', () => {
    renderTab();
    // i23 has no loaded bundle → no toggle, just the lazy-load hint on its cell.
    expect(screen.getByTitle('Open this track to load its replicate sample ids.')).toBeInTheDocument();
  });
});

describe('groupSampleTooltip — hero pill text', () => {
  const gs = { normal: [S(1), S(2), S(3)], obese: [S(4), S(5), S(6)] };
  const kept = [S(1), S(2), S(3), S(4), S(5)];

  it('lists kept ids and flags dropped ones for the affected arm', () => {
    expect(groupSampleTooltip(gs, kept, { key: 'obese', label: 'Obese' }))
      .toBe('Obese — 2 samples: S004, S005 · dropped by QC: S006');
  });

  it('lists only kept ids for an arm with no drops', () => {
    expect(groupSampleTooltip(gs, kept, { key: 'normal', label: 'Normal' }))
      .toBe('Normal — 3 samples: S001, S002, S003');
  });

  it('is undefined when the group has no ids yet (bundle unresolved)', () => {
    expect(groupSampleTooltip(undefined, undefined, { key: 'normal', label: 'Normal' })).toBeUndefined();
  });
});
