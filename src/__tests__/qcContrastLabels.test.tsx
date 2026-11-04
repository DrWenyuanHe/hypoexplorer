import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import { getActiveContrast } from '../data/contrasts';
import type { Dataset, DatasetMeta } from '../types';

// Candidate #4 ("QCTab de-macaque"): QCTab must take its arm labels from the
// active contrast, its track noun from the manifest, and hide the FGSEA +
// composition sections for datasets that don't have that data — instead of
// hardcoding "n Normal / n Obese", "populations", and an always-on FGSEA table.

const noop = () => {};
const ths = (c: HTMLElement) => [...c.querySelectorAll('th')].map(t => t.textContent!.replace(/[↑↓\s]+$/, ''));
const h3s = (c: HTMLElement) => [...c.querySelectorAll('h3')].map(h => h.textContent);

const bulkDataset = {
  trackNoun: 'track',
  supportsPathways: false,
  modality: 'bulk RNA-seq',
  groups: [
    { key: 'chow', label: 'Chow', color: '#3775BA' },
    { key: 'hfd', label: 'HFD', color: '#B64342' },
  ],
  contrasts: [{ id: 'hfd_vs_chow', baseline: 'chow', case: 'hfd', isDefault: true }],
} as unknown as Dataset;
const bulkMeta = {
  populations: ['whole'],
  labels: { whole: 'Whole hypothalamus' },
  qcFlags: { whole: { is3v3: false, nNormal: 7, nObese: 8, minCells: 0, status: 'ok' } },
  qaReportFilenames: {},
} as unknown as DatasetMeta;
const emptyQc = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} };

describe('QCTab — de-macaque labels + section gating', () => {
  it('bulk dataset: arm labels + track noun come from the manifest/contrast', () => {
    const { container } = render(
      <QCTab onSelectTrack={noop} qcData={emptyQc} meta={bulkMeta}
        dataset={bulkDataset} contrast={getActiveContrast(bulkDataset)} />
    );
    const headers = ths(container);
    expect(headers).toContain('n Chow');
    expect(headers).toContain('n HFD');
    expect(headers).not.toContain('n Normal');
    expect(headers).not.toContain('n Obese');
    // Track-ID column header uses the manifest noun, capitalised.
    expect(headers).toContain('Track');
    expect(headers).not.toContain('Pop');
    // Sizes heading follows the noun.
    expect(h3s(container)).toContain('Per-track sample sizes');
    expect(h3s(container)).not.toContain('Per-population sample sizes');
  });

  it('bulk dataset: FGSEA + composition sections are hidden', () => {
    const { container } = render(
      <QCTab onSelectTrack={noop} qcData={emptyQc} meta={bulkMeta}
        dataset={bulkDataset} contrast={getActiveContrast(bulkDataset)} />
    );
    const headings = h3s(container);
    expect(headings).not.toContain('FGSEA summary');     // supportsPathways: false
    expect(headings).not.toContain('Cell composition');  // no composition data
    // The still-relevant sections remain.
    expect(headings).toContain('Run status');
    expect(headings).toContain('DE summary');
    expect(headings).toContain('QA reports');
  });

  it('no dataset prop (legacy/global fallback): NEUTRAL arm labels, macaque sections', () => {
    // The null-contrast arm labels come from the group-label seam
    // (sampleValues.groupLabels): neutral 'Baseline'/'Case', never the macaque
    // vocabulary — this view can be reached from any dataset in a degraded
    // state. Section gating still degrades to the macaque shape.
    const { container } = render(<QCTab onSelectTrack={noop} qcData={emptyQc} meta={bulkMeta} />);
    const headers = ths(container);
    expect(headers).toContain('n Baseline');
    expect(headers).toContain('n Case');
    expect(headers).not.toContain('n Normal');
    expect(headers).not.toContain('n Obese');
    expect(h3s(container)).toContain('FGSEA summary');
    expect(h3s(container)).toContain('Per-population sample sizes');
  });
});
