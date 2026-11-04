// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadDatasetMeta, loadDatasetQC, _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { BULK_DATASET_FIXTURE, MIRNA_DATASET_FIXTURE } from './fixtures';

// Per-dataset lazy loaders for the dataset-level metadata (POP_META shape) and
// QC blob (QC_GLOBAL shape). They sit on the critical path of every dataset
// switch, so their safety properties (eager-global seed, cache by dataset.id,
// in-flight dedup, missing-global / onerror reject, clear-in-flight retry) need
// the same coverage loadTrack.js has.

const DS_A = BULK_DATASET_FIXTURE;   // metaGlobalKey HX_MOUSE_BULK_HFD_META
const DS_B = MIRNA_DATASET_FIXTURE;  // metaGlobalKey HX_MOUSE_MIRNA_META

function stubScripts(onAppend: (el: any) => void) {
  const orig = document.createElement.bind(document);
  const injected: any[] = [];
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const el = orig(tag);
    if (tag === 'script') {
      injected.push(el);
      setTimeout(() => onAppend(el), 0);
    }
    return el;
  });
  return { spy, injected };
}

beforeEach(() => { _resetDatasetMetaCache(); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ['HX_MOUSE_BULK_HFD_META', 'HX_MOUSE_MIRNA_META', 'HX_MOUSE_BULK_HFD_QC', 'HX_MOUSE_MIRNA_QC']) {
    delete (window as any)[k];
  }
});

describe('loadDatasetMeta — eager-global seed (no reinject)', () => {
  it('resolves synchronously from an already-set global without injecting', async () => {
    const meta = { populations: ['whole'], labels: { whole: 'Whole' } };
    (window as any).HX_MOUSE_BULK_HFD_META = meta;
    const { injected } = stubScripts(() => {});
    const data = await loadDatasetMeta(DS_A);
    expect(data).toBe(meta);
    expect(injected.length).toBe(0);
  });
});

describe('loadDatasetMeta — cache key is dataset.id, collision-free', () => {
  it('two datasets resolve to two distinct meta objects', async () => {
    (window as any).HX_MOUSE_BULK_HFD_META = { _tag: 'A' };
    (window as any).HX_MOUSE_MIRNA_META = { _tag: 'B' };
    stubScripts(() => {});
    const a = await loadDatasetMeta(DS_A);
    const b = await loadDatasetMeta(DS_B);
    expect((a as any)._tag).toBe('A');
    expect((b as any)._tag).toBe('B');
  });
});

describe('loadDatasetMeta — in-flight dedup', () => {
  it('two rapid calls return the same promise and inject one script', async () => {
    const { injected } = stubScripts(() => {}); // never resolves
    const p1 = loadDatasetMeta(DS_A);
    const p2 = loadDatasetMeta(DS_A);
    expect(p1).toBe(p2);
    // Injection is a tick late — the transport tries a streaming fetch first and
    // falls back to a <script> tag. See the same note in loadTrack.test.ts.
    await vi.waitFor(() => expect(injected.length).toBe(1));
    injected.forEach(s => { s.onerror?.(new Event('error')); });
    return p1.catch(() => {});
  });
});

describe('loadDatasetMeta — injects + reads the namespaced global on load', () => {
  it('appends a versioned <script> at metaFile and resolves with the global', async () => {
    const meta = { populations: ['whole'] };
    const { injected } = stubScripts((el) => {
      (window as any).HX_MOUSE_BULK_HFD_META = meta;
      el.onload?.(new Event('load'));
    });
    const data = await loadDatasetMeta(DS_A);
    expect(data).toBe(meta);
    expect(injected.length).toBe(1);
    expect(injected[0].src).toContain('/datasets/mouse_bulk_hfd/meta.js');
    expect(injected[0].src).toContain('?v=');
  });
});

describe('loadDatasetMeta — failure paths', () => {
  it('rejects when onload fires but the global is not set', async () => {
    stubScripts((el) => el.onload?.(new Event('load')));
    await expect(loadDatasetMeta(DS_A)).rejects.toThrow(/HX_MOUSE_BULK_HFD_META not defined/);
  });

  it('clears in-flight on onerror so a retry can re-inject', async () => {
    const first = stubScripts((el) => el.onerror?.(new Event('error')));
    await expect(loadDatasetMeta(DS_A)).rejects.toThrow(/Failed to load dataset metadata/);
    first.spy.mockRestore();

    const second = stubScripts((el) => {
      (window as any).HX_MOUSE_BULK_HFD_META = { _tag: 'retry' };
      el.onload?.(new Event('load'));
    });
    const data = await loadDatasetMeta(DS_A);
    expect((data as any)._tag).toBe('retry');
    expect(second.injected.length).toBe(1);
  });
});

describe('loadDatasetQC — independent cache from meta', () => {
  it('seeds QC from its own global and does not collide with meta', async () => {
    (window as any).HX_MOUSE_BULK_HFD_META = { _kind: 'meta' };
    (window as any).HX_MOUSE_BULK_HFD_QC = { _kind: 'qc' };
    stubScripts(() => {});
    const meta = await loadDatasetMeta(DS_A);
    const qc = await loadDatasetQC(DS_A);
    expect((meta as any)._kind).toBe('meta');
    expect((qc as any)._kind).toBe('qc');
  });

  it('rejects with a QC-specific message when the global is missing', async () => {
    stubScripts((el) => el.onload?.(new Event('load')));
    await expect(loadDatasetQC(DS_A)).rejects.toThrow(/HX_MOUSE_BULK_HFD_QC not defined/);
  });
});
