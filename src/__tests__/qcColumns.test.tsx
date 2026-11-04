import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QCTab } from '../qc/QCTab';
import type { DatasetMeta } from '../types';

// QC table polish: the Run-status Elapsed/Message columns are data-driven (hidden
// when no run records them, like the DE columns), and composition column headers
// strip the donor/sample-set prefix derived from the data instead of a hardcoded
// "HCA_Macaque001_".

const noop = () => {};
const ths = (c: HTMLElement) => [...c.querySelectorAll('th')].map((t) => (t.textContent ?? '').replace(/[↑↓\s]+$/, ''));
const meta = {
  populations: ['e9'],
  labels: { e9: 'POMC/TBX3' },
  qcFlags: { e9: { is3v3: true, nNormal: 3, nObese: 3 } },
  qaReportFilenames: {},
} as unknown as DatasetMeta;

describe('QCTab — data-driven run-status columns', () => {
  it('hides Elapsed/Message when no run records them', () => {
    const qc = { runStatus: [{ cluster: 'e9', status: 'ok', elapsed_sec: null, message: null }], deSummary: [], fgseaSummary: [], composition: {} };
    const { container } = render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} />);
    const headers = ths(container);
    expect(headers).toContain('Status');
    expect(headers).not.toContain('Elapsed (s)');
    expect(headers).not.toContain('Message');
  });

  it('shows Elapsed/Message when at least one run records them', () => {
    const qc = { runStatus: [{ cluster: 'e9', status: 'ok', elapsed_sec: 40, message: 'low cells' }], deSummary: [], fgseaSummary: [], composition: {} };
    const { container } = render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} />);
    const headers = ths(container);
    expect(headers).toContain('Elapsed (s)');
    expect(headers).toContain('Message');
  });
});

describe('QCTab — composition column prefix (data-derived)', () => {
  it('strips the shared macaque donor prefix, leaving the sample id', () => {
    const qc = {
      runStatus: [], deSummary: [], fgseaSummary: [],
      composition: {
        countsWide: [{ cluster: 'e9', HCA_Macaque001_S001: 100, HCA_Macaque001_S002: 110, HCA_Macaque001_S003: 95 }],
      },
    };
    const { container } = render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} />);
    const headers = ths(container);
    expect(headers).toContain('S001');
    expect(headers).not.toContain('HCA_Macaque001_S001');
  });

  it('derives the prefix from the data, not a hardcoded string (works for another donor set)', () => {
    const qc = {
      runStatus: [], deSummary: [], fgseaSummary: [],
      composition: {
        countsWide: [{ cluster: 'c1', DONORX_R1: 5, DONORX_R2: 6 }],
      },
    };
    const { container } = render(<QCTab onSelectTrack={noop} qcData={qc} meta={meta} />);
    const headers = ths(container);
    expect(headers).toContain('R1');
    expect(headers).not.toContain('DONORX_R1');
  });
});
