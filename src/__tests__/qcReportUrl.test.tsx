import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import { MACAQUE_DATASET } from './fixtures';
import type { DatasetMeta, QcGlobal } from '../types';

// The QA-report PDFs ship with the data bundles: QCTab's report modal must
// resolve /qc/<file> against the dataset's bundleBaseUrl (R2 when
// VITE_BUNDLE_BASE_URL is set at build time), exactly like the
// meta/qc_global/track loaders. A same-origin dataset ('' base) must keep the
// bare /qc/ path. Regression guard for the off-origin cutover: a hardcoded
// same-origin path here 404s every report once dist/qc is pruned.

const noop = () => {};
const meta = {
  populations: ['e9'],
  labels: { e9: 'e9 (POMC/TBX3)' },
  qcFlags: { e9: { is3v3: true, nNormal: 3, nObese: 3 } },
  qaReportFilenames: { e9: 'e9__POMC_TBX3.pdf' },
} as unknown as DatasetMeta;
const qc = { runStatus: [], deSummary: [], fgseaSummary: [], composition: {} } as unknown as QcGlobal;

function openReportModal() {
  fireEvent.click(screen.getByRole('button', { name: 'View report' }));
}

describe('QCTab — QA report PDF URLs follow the dataset bundle base', () => {
  it('prefixes iframe src and download href with bundleBaseUrl', () => {
    const dataset = { ...MACAQUE_DATASET, bundleBaseUrl: 'https://data.example.com' };
    render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} dataset={dataset} />);
    openReportModal();

    const iframe = screen.getByTitle('QA report: e9 (POMC/TBX3)');
    expect(iframe).toHaveAttribute('src', 'https://data.example.com/qc/e9__POMC_TBX3.pdf');
    const link = screen.getByRole('link', { name: /Download/ });
    expect(link).toHaveAttribute('href', 'https://data.example.com/qc/e9__POMC_TBX3.pdf');
  });

  it('keeps the same-origin /qc/ path when the dataset base is empty', () => {
    const dataset = { ...MACAQUE_DATASET, bundleBaseUrl: '' };
    render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} dataset={dataset} />);
    openReportModal();

    expect(screen.getByTitle('QA report: e9 (POMC/TBX3)'))
      .toHaveAttribute('src', '/qc/e9__POMC_TBX3.pdf');
  });
});
