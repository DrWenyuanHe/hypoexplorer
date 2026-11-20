import { describe, it, expect, vi, afterEach } from 'vitest';
import { DATASETS } from '../data/datasets';

// The internal QC ledger loads on the first export (utils/lazyExport.ts). Each
// test takes a fresh copy of the module, so "not loaded yet" is real state.
async function freshLazyExport() {
  vi.resetModules();
  return import('../utils/lazyExport');
}

const dataset = DATASETS.find((d) => d.contrasts?.length)!;
const contrastId = dataset.contrasts![0].id;

afterEach(() => {
  vi.doUnmock('../data/internalQc');
  vi.restoreAllMocks();
});

describe('export evidence', () => {
  it('refuses to build a snapshot before the ledger has loaded', async () => {
    const lazy = await freshLazyExport();
    expect(() => lazy.exportEvidence(dataset.id, contrastId)).toThrow(/not loaded/);
  });

  it('loads the ledger for the first export, then runs later exports synchronously', async () => {
    const lazy = await freshLazyExport();
    const first = vi.fn();
    const pending = lazy.withExportEvidence(first);
    expect(first).not.toHaveBeenCalled();
    await pending;
    expect(first).toHaveBeenCalledTimes(1);
    expect(lazy.exportEvidence(dataset.id, contrastId)).toMatchObject({ status: expect.any(String) });

    // Loaded: the body runs inside the click, before the promise settles.
    const second = vi.fn();
    void lazy.withExportEvidence(second);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reports a throwing export body instead of rejecting', async () => {
    const lazy = await freshLazyExport();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await lazy.loadExportEvidence();
    await expect(lazy.withExportEvidence(() => { throw new Error('boom'); })).resolves.toBeUndefined();
    await expect(lazy.withExportEvidence(async () => { throw new Error('later boom'); })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('reports a failed ledger download, skips the export, and retries on the next one', async () => {
    let available = false;
    vi.doMock('../data/internalQc', () => {
      if (!available) throw new Error('Failed to fetch dynamically imported module');
      return { getInternalQc: () => ({ status: 'pass', checks: [], scope: 'test', policyVersion: 'test' }) };
    });
    const lazy = await freshLazyExport();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = vi.fn();

    await expect(lazy.withExportEvidence(body)).resolves.toBeUndefined();
    expect(body).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(() => lazy.exportEvidence(dataset.id, contrastId)).toThrow(/not loaded/);

    available = true;
    await lazy.withExportEvidence(body);
    expect(body).toHaveBeenCalledTimes(1);
    expect(lazy.exportEvidence(dataset.id, contrastId)).toMatchObject({ status: 'pass' });
  });
});
