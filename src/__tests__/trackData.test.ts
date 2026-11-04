// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadTrackData, popDataFor } from '../data/trackData';
import { _resetTrackCache } from '../data/loadTrack';
import { getActiveContrast } from '../data/contrasts';
import {
  BULK_DATASET_FIXTURE,
  BULK_TRACK_FIXTURE,
  MULTICONTRAST_DATASET_FIXTURE,
  MULTICONTRAST_TRACK_FIXTURE,
} from './fixtures';
import type { Dataset, PathwayDatabase, RawTrack } from '../types';

// Stub document.createElement so injected <script> tags never hit the network.
// `onAppend` sees the element after loadTrack has set src + onload/onerror, and
// decides what the "response" is. Mirrors loadTrack.test.ts's helper, plus a
// record of every URL asked for — the pathway policy is a claim about which
// bundles are REQUESTED, so the request log is the assertion surface.
function stubScripts(onAppend: (el: any) => void) {
  const orig = document.createElement.bind(document);
  const requested: string[] = [];
  vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const el = orig(tag);
    if (tag === 'script') {
      setTimeout(() => {
        requested.push(String(el.src));
        onAppend(el);
      }, 0);
    }
    return el;
  });
  return { requested };
}

const PATHWAYS: PathwayDatabase = {
  GO_BP: [{ pathway: 'GOBP_LATE', pval: 0.01, padj: 0.02, NES: 1.9, size: 20, leadingEdge: ['LEP'] }],
  HALLMARK: [], KEGG: [], REACTOME: [],
};

// A bulk track with NO pathways block, so 'include' has something to hydrate.
function pathwaylessTrack(): RawTrack {
  const { pathways: _drop, ...rest } = BULK_TRACK_FIXTURE as RawTrack & { pathways?: PathwayDatabase };
  return { ...rest } as RawTrack;
}

const BULK_CONTRAST = getActiveContrast(BULK_DATASET_FIXTURE);

beforeEach(() => { _resetTrackCache(); });

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).HX_MOUSE_BULK_HFD_WHOLE;
  delete (window as any).HX_MOUSE_BULK_HFD_WHOLE_PATH;
  delete (window as any).HX_MOUSE_FASTING_TC_WHOLE;
  delete (window as any).HX_MOUSE_FASTING_TC_WHOLE_PATH;
});

describe('loadTrackData — pathway policy', () => {
  it("'omit' never requests the pathway sibling and reports nothing to re-read", async () => {
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = pathwaylessTrack();
    const { requested } = stubScripts(() => {});

    const { raw, pathwaysReady } = await loadTrackData(BULK_DATASET_FIXTURE, 'whole', { pathways: 'omit' });
    await expect(pathwaysReady).resolves.toBeNull();

    expect(requested.some((u) => u.includes('.pathways.js'))).toBe(false);
    expect(raw.pathways).toBeUndefined();
    // The popData is legitimately pathway-less — by policy, not by oversight.
    expect(popDataFor(raw, BULK_DATASET_FIXTURE, BULK_CONTRAST)!.allPathways).toEqual([]);
  });

  it("'include' hydrates the sibling onto the SAME raw and signals a re-read", async () => {
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = pathwaylessTrack();
    stubScripts((el) => {
      if (String(el.src).includes('.pathways.js')) {
        (window as any).HX_MOUSE_BULK_HFD_WHOLE_PATH = PATHWAYS;
        el.onload?.();
      }
    });

    const { raw, pathwaysReady } = await loadTrackData(BULK_DATASET_FIXTURE, 'whole', { pathways: 'include' });
    // Resolving before the sibling lands is the point: first paint isn't blocked.
    expect(popDataFor(raw, BULK_DATASET_FIXTURE, BULK_CONTRAST)!.allPathways).toEqual([]);

    const hydrated = await pathwaysReady;
    // Same object — popCache's WeakMap key depends on that identity holding.
    expect(hydrated).toBe(raw);
    // And the stale pathway-less transform was dropped, so the re-read is fresh.
    expect(popDataFor(raw, BULK_DATASET_FIXTURE, BULK_CONTRAST)!.allPathways).toHaveLength(1);
  });

  it("'include' reports nothing to re-read when the bundle already carries pathways", async () => {
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = BULK_TRACK_FIXTURE;   // has a pathways block
    const { requested } = stubScripts(() => {});

    const { raw, pathwaysReady } = await loadTrackData(BULK_DATASET_FIXTURE, 'whole', { pathways: 'include' });
    await expect(pathwaysReady).resolves.toBeNull();

    expect(requested.some((u) => u.includes('.pathways.js'))).toBe(false);
    expect(popDataFor(raw, BULK_DATASET_FIXTURE, BULK_CONTRAST)!.allPathways.length).toBeGreaterThan(0);
  });

  it("'include' degrades to nothing-to-re-read when the sibling is absent", async () => {
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = pathwaylessTrack();
    stubScripts((el) => {
      if (String(el.src).includes('.pathways.js')) el.onerror?.();
    });

    const { raw, pathwaysReady } = await loadTrackData(BULK_DATASET_FIXTURE, 'whole', { pathways: 'include' });
    // Graceful: resolves null rather than rejecting, so an ignored pathwaysReady
    // can never surface as an unhandled rejection.
    await expect(pathwaysReady).resolves.toBeNull();
    expect(popDataFor(raw, BULK_DATASET_FIXTURE, BULK_CONTRAST)!.allPathways).toEqual([]);
  });

  it("'include' on a dataset without pathway support requests nothing", async () => {
    const noPathways: Dataset = { ...BULK_DATASET_FIXTURE, supportsPathways: false };
    (window as any).HX_MOUSE_BULK_HFD_WHOLE = pathwaylessTrack();
    const { requested } = stubScripts(() => {});

    const { pathwaysReady } = await loadTrackData(noPathways, 'whole', { pathways: 'include' });
    await expect(pathwaysReady).resolves.toBeNull();
    expect(requested.some((u) => u.includes('.pathways.js'))).toBe(false);
  });
});

describe('popDataFor — the contrast the caller passes is the contrast that is used', () => {
  // Regression for the Compare tab: it built popData with neither dataset nor
  // contrast, and buildPopData's old fallback quietly resolved both to the
  // macaque defaults. On a multi-contrast dataset that renders the DEFAULT
  // contrast's DE table while the shell shows another one — a wrong answer that
  // looks like a real one. Both arguments are required now; this pins the
  // behaviour that made the omission matter.
  it('selects the non-default contrast table when asked for it', async () => {
    (window as any).HX_MOUSE_FASTING_TC_WHOLE = MULTICONTRAST_TRACK_FIXTURE;
    stubScripts(() => {});
    const ds = MULTICONTRAST_DATASET_FIXTURE;

    const { raw } = await loadTrackData(ds, 'whole', { pathways: 'omit' });

    const dflt = popDataFor(raw, ds, getActiveContrast(ds))!;
    const refed = popDataFor(raw, ds, getActiveContrast(ds, 'refed_vs_fed'))!;

    expect(dflt.contrast!.id).toBe('fast24_vs_fed');
    expect(dflt.deByGene.IGFBP2!.logFC).toBe(-1.4);
    expect(refed.contrast!.id).toBe('refed_vs_fed');
    expect(refed.deByGene.IGFBP2!.logFC).toBe(0.3);
    expect(refed.groups.map((g) => g.key)).toEqual(['fed', 'refed']);
  });

  it('keys the transform cache by dataset too, so a shared contrast id cannot cross-serve', () => {
    // Two datasets that declare the SAME contrast id but a different expression
    // unit. Keyed on contrast id alone, the second read would serve the first's
    // transform and mislabel the axis.
    const asCpm: Dataset = { ...BULK_DATASET_FIXTURE, id: 'ds_cpm', expressionUnit: 'CPM' };
    const asLog2: Dataset = { ...BULK_DATASET_FIXTURE, id: 'ds_log2', expressionUnit: 'log2-normalized' };
    const raw = BULK_TRACK_FIXTURE;
    const contrast = getActiveContrast(asCpm);

    expect(popDataFor(raw, asCpm, contrast)!.expressionUnit).toBe('CPM');
    expect(popDataFor(raw, asLog2, contrast)!.expressionUnit).toBe('log2-normalized');
  });
});

// ── Multi-contrast pathway siblings ─────────────────────────────────────────
// A sibling bundle is either a plain PathwayDatabase (every legacy bundle) or
// the wrapper `{ default, byContrast }`. rawTrack.test.ts pins the unwrap
// ACCESSORS; these pin the hydration path that uses them, which is where the
// feature actually lives: the wrapper must land on BOTH raw.pathways (so the
// default contrast keeps working) and raw.pathwaysByContrast (so a non-default
// contrast reads its own enrichment). Dropping either half is silent — the
// explorer just serves the default contrast's pathways under every arm label,
// which is the exact failure buildPopData's fallback warning exists to catch.
describe('loadTrackData — pathway sibling shapes', () => {
  const MC = MULTICONTRAST_DATASET_FIXTURE;
  const DEFAULT_PW: PathwayDatabase = {
    GO_BP: [{ pathway: 'GOBP_DEFAULT_BLOCK', pval: 0.01, padj: 0.02, NES: 2.0, size: 20, leadingEdge: ['FOS'] }],
    HALLMARK: [], KEGG: [], REACTOME: [],
  };
  const REFED_ONLY_PW: PathwayDatabase = {
    GO_BP: [{ pathway: 'GOBP_REFED_ONLY', pval: 0.03, padj: 0.06, NES: 1.4, size: 15, leadingEdge: ['IGFBP2'] }],
    HALLMARK: [], KEGG: [], REACTOME: [],
  };

  /** The multi-contrast track with BOTH pathway fields stripped, so 'include' has work to do. */
  function pathwaylessMulticontrast(): RawTrack {
    const { pathways: _p, pathwaysByContrast: _pbc, ...rest } = MULTICONTRAST_TRACK_FIXTURE as RawTrack;
    return { ...rest } as RawTrack;
  }

  function serveSibling(value: unknown) {
    stubScripts((el) => {
      if (String(el.src).includes('.pathways.js')) {
        (window as any).HX_MOUSE_FASTING_TC_WHOLE_PATH = value;
        el.onload?.();
      }
    });
  }

  it('unwraps the WRAPPER sibling so each contrast reads its own enrichment', async () => {
    (window as any).HX_MOUSE_FASTING_TC_WHOLE = pathwaylessMulticontrast();
    serveSibling({ default: DEFAULT_PW, byContrast: { refed_vs_fed: REFED_ONLY_PW } });

    const { raw, pathwaysReady } = await loadTrackData(MC, 'whole', { pathways: 'include' });
    expect(await pathwaysReady).toBe(raw);

    // The default contrast falls through to the wrapper's `default` block...
    expect(popDataFor(raw, MC, getActiveContrast(MC))!.allPathways.map((p) => p.pathway))
      .toEqual(['GOBP_DEFAULT_BLOCK']);
    // ...and the non-default contrast reads ITS OWN block, not the default's.
    // Serving the default here is the silent-wrong case this test exists for.
    expect(popDataFor(raw, MC, getActiveContrast(MC, 'refed_vs_fed'))!.allPathways.map((p) => p.pathway))
      .toEqual(['GOBP_REFED_ONLY']);
  });

  it('keeps a LEGACY plain-block sibling as the default, with no per-contrast blocks', async () => {
    (window as any).HX_MOUSE_FASTING_TC_WHOLE = pathwaylessMulticontrast();
    serveSibling(DEFAULT_PW);

    const { raw, pathwaysReady } = await loadTrackData(MC, 'whole', { pathways: 'include' });
    expect(await pathwaysReady).toBe(raw);

    expect(raw.pathways).toEqual(DEFAULT_PW);
    expect(raw.pathwaysByContrast).toBeUndefined();
    // The legacy block belongs to the default comparison only.
    expect(popDataFor(raw, MC, getActiveContrast(MC))!.allPathways.map((p) => p.pathway))
      .toEqual(['GOBP_DEFAULT_BLOCK']);
    expect(popDataFor(raw, MC, getActiveContrast(MC, 'refed_vs_fed'))!.allPathways.map((p) => p.pathway))
      .toEqual([]);
  });

  it('reports nothing to re-read when the wrapper carries neither half', async () => {
    (window as any).HX_MOUSE_FASTING_TC_WHOLE = pathwaylessMulticontrast();
    serveSibling({ default: undefined, byContrast: undefined });

    const { raw, pathwaysReady } = await loadTrackData(MC, 'whole', { pathways: 'include' });
    await expect(pathwaysReady).resolves.toBeNull();
    expect(raw.pathways).toBeUndefined();
    expect(raw.pathwaysByContrast).toBeUndefined();
  });
});
