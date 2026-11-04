import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import App from '../App';
import { getDefaultDataset } from '../data/datasets';
import { _resetTrackCache } from '../data/loadTrack';
import { _resetDatasetMetaCache } from '../data/loadDatasetMeta';
import { HX_MACAQUE_SNRNA_E9_FIXTURE, BULK_TRACK_FIXTURE, seedQueryManifest } from './fixtures';

// App wiring for the multi-dataset foundation. With a single dataset registered
// the breadcrumb shows the dataset name as plain text (the <select> only appears
// once a 2nd dataset is registered). These tests pin the default-dataset
// behavior and the per-track state-reset machinery that switchDataset reuses.

describe('App — dataset breadcrumb + default selection', () => {
  it('shows the default dataset name in the breadcrumb', () => {
    render(<App initialView="explorer" />);
    const ds = getDefaultDataset();
    expect(screen.getAllByText(ds.name).length).toBeGreaterThan(0);
  });

  it('defaults to the dataset default track (e9) in the hero + breadcrumb', () => {
    const { container } = render(<App initialView="explorer" />);
    // The hero shows the active track id as a large mono heading.
    expect(container.textContent).toContain('e9');
    // Default tab is Gene Explorer (volcano canvas present).
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders the contrast group labels (Normal / Obese) in the hero', () => {
    const { container } = render(<App initialView="explorer" />);
    expect(container.textContent).toMatch(/Normal/);
    expect(container.textContent).toMatch(/Obese/);
  });
});

describe('App — hero replicate counts are data-driven (no hardcoded 3)', () => {
  // Regression: the hero used to render `currentQC?.nNormal ?? 3` / `?? 3`,
  // hardcoding the macaque 3v3 so a non-3v3 dataset (mouse 7v8 / 3v4) or a
  // mid-load track would show a plausible-but-wrong "3 vs 3". The priority is
  // now: the active contrast's groupSamples ∩ samplesKept (the only source
  // that knows a factorial cell arm like chow_p0), else
  // `currentQC ?? datasetMeta.qcFlags[track] ?? '–'` — so the count must
  // reflect the actual data and degrade to '–' (never 3) when truly missing.
  //
  // Helper: re-seed the eager e9 track global with a patched qc and re-render so
  // App reads the new counts. `stripGroupMembership` removes the per-group
  // sample ids (groupSamples + the legacy pair) so a test can exercise the
  // count FALLBACKS — with membership present, membership is authoritative.
  // Returns a restore fn.
  function seedE9Qc(qcPatch: any, opts: { stripGroupMembership?: boolean } = {}) {
    const prev = window.HX_MACAQUE_SNRNA_E9;
    const meta = opts.stripGroupMembership
      ? {
        ...HX_MACAQUE_SNRNA_E9_FIXTURE.meta,
        groupSamples: undefined, normalSamples: undefined, obeseSamples: undefined,
      }
      : HX_MACAQUE_SNRNA_E9_FIXTURE.meta;
    window.HX_MACAQUE_SNRNA_E9 = {
      ...HX_MACAQUE_SNRNA_E9_FIXTURE,
      meta,
      qc: qcPatch === null ? null : { ...HX_MACAQUE_SNRNA_E9_FIXTURE.qc, ...qcPatch },
    };
    _resetTrackCache();
    return () => {
      window.HX_MACAQUE_SNRNA_E9 = prev;
      _resetTrackCache();
    };
  }

  it('derives hero counts from kept membership and warns from those active-arm counts', async () => {
    // The 2v3 macaque case: membership lists 3 normals but QC kept only 2. The
    // count must follow the retained membership — even though this seeded qc
    // still SAYS nNormal: 3, proving membership outranks the aggregate pair.
    const restore = seedE9Qc({
      samplesKept: [
        'HCA_Macaque001_S001', 'HCA_Macaque001_S002',
        'HCA_Macaque001_S004', 'HCA_Macaque001_S005', 'HCA_Macaque001_S006',
      ],
      is3v3: true,
    });
    try {
      const { container } = render(<App initialView="explorer" />);
      await waitFor(() => {
        const chips = [...container.querySelectorAll('span')].map(s => (s.textContent || '').trim());
        expect(chips.some(t => /^2\s+Normal$/.test(t))).toBe(true);
        expect(chips.some(t => /^3\s+Obese$/.test(t))).toBe(true);
        expect(screen.getAllByText(/n=2 vs 3 · low power/).length).toBeGreaterThan(0);
      });
    } finally {
      restore();
    }
  });

  it('falls back to the per-track datasetMeta.qcFlags counts when track QC is absent mid-load', async () => {
    // Middle arm of `currentQC ?? datasetMeta.qcFlags[track] ?? '–'`: the track
    // bundle's qc carries no counts (currentQC absent), but the dataset meta's
    // per-track qcFlags do — the mid-load path the change was written for. A
    // non-3 value (7 vs 8) proves the count comes from the meta, not a literal 3.
    const restoreQc = seedE9Qc({ nNormal: undefined, nObese: undefined }, { stripGroupMembership: true });
    const prevFlags = window.HX_MACAQUE_SNRNA_META!.qcFlags.e9;
    window.HX_MACAQUE_SNRNA_META!.qcFlags.e9 = { ...prevFlags, nNormal: 7, nObese: 8 };
    try {
      const { container } = render(<App initialView="explorer" />);
      await waitFor(() => {
        const chips = [...container.querySelectorAll('span')].map(s => (s.textContent || '').trim());
        expect(chips.some(t => /^7\s+Normal$/.test(t))).toBe(true);
        expect(chips.some(t => /^8\s+Obese$/.test(t))).toBe(true);
        expect(chips.some(t => /^3\s+Normal$/.test(t))).toBe(false);
      });
    } finally {
      window.HX_MACAQUE_SNRNA_META!.qcFlags.e9 = prevFlags;
      restoreQc();
    }
  });
});

describe('App — a track switch resets per-track state, preserves thresholds', () => {
  it('clears the selected-gene chips when switching to another track', async () => {
    render(<App initialView="explorer" />);

    // Add POMC via the gene search so a chip appears.
    const search = screen.getByPlaceholderText(/Search gene/i);
    fireEvent.change(search, { target: { value: 'POMC' } });
    await waitFor(
      () => expect(screen.getAllByText('POMC').length).toBeGreaterThan(0),
    );
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(screen.getByLabelText(/Remove POMC/i)).toBeTruthy();
    });

    // Switch to another track from the sidebar. e33 is in the fixture meta and is
    // seeded as a track global? No — only e9 is eager. Switching triggers a load;
    // wrap in act so the resulting state settles. The selection must reset
    // regardless of load completion.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /e33/i }));
    });
    expect(screen.queryByLabelText(/Remove POMC/i)).toBeNull();
  });

  it('preserves the significance threshold across a track switch (cross-track cutoff sweep)', async () => {
    // Seed e33 as an eager track global so loadTrack resolves it synchronously
    // (from the window global) and the Gene Explorer tab stays mounted across the
    // switch — letting us observe that the threshold slider value persisted.
    const prevE33 = (window as any).HX_MACAQUE_SNRNA_E33;
    (window as any).HX_MACAQUE_SNRNA_E33 = {
      ...HX_MACAQUE_SNRNA_E9_FIXTURE,
      meta: { ...HX_MACAQUE_SNRNA_E9_FIXTURE.meta, code: 'e33', label: 'e33 (KISS1/ESR1)', type: 'Glutamatergic' },
    };
    // Drop any e33 in-flight promise a prior test left behind (it clicked e33
    // before the global was seeded), so loadTrack re-reads the now-seeded global
    // and resolves synchronously instead of returning the stale pending promise.
    _resetTrackCache();

    try {
      const { container } = render(<App initialView="explorer" />);
      const sliders = () => container.querySelectorAll('input[type="range"]');
      const sigSlider = () => sliders()[1];

      // Move the significance slider to a recognizable value.
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(sigSlider(), '3');
        sigSlider().dispatchEvent(new Event('input', { bubbles: true }));
      });
      const before = (sigSlider() as HTMLInputElement).value;
      expect(before).toBe('3');

      // Switch tracks; thresholds are intentionally NOT in a track switch's reset set.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /e33/i }));
      });
      // Gene tab stays mounted (e33 resolved synchronously); slider value persists.
      expect((sigSlider() as HTMLInputElement).value).toBe(before);
    } finally {
      if (prevE33 === undefined) delete (window as any).HX_MACAQUE_SNRNA_E33;
      else (window as any).HX_MACAQUE_SNRNA_E33 = prevE33;
    }
  });
});

describe('App — load-error banner + Retry (S2)', () => {
  it('surfaces a failed track load and clears it on Retry', async () => {
    _resetTrackCache();
    // jsdom never fires onload/onerror for injected <script>s, so stub
    // createElement to fail any script we inject (pass-through for everything
    // else, incl. React host nodes). Deferred so loadTrack wires onerror first.
    const orig = document.createElement.bind(document);
    let failScripts = true;
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = orig(tag);
      if (tag === 'script' && failScripts) setTimeout(() => el.onerror?.(new Event('error')), 0);
      return el;
    });

    try {
      render(<App initialView="explorer" />);
      // e9 is eager-cached → no failure on initial load.
      expect(screen.queryByText(/Failed to load/i)).toBeNull();

      // Switch to e33 (not cached) → loadTrack injects a script → stub fails it.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /e33/i }));
      });
      await waitFor(() => expect(screen.getByText(/Failed to load e33 data/i)).toBeTruthy());
      const retry = screen.getByRole('button', { name: /^Retry$/i });

      // Make e33 resolvable: seed its global + clear the failed in-flight, stop
      // failing scripts, then Retry → loadTrack resolves from the eager global.
      (window as any).HX_MACAQUE_SNRNA_E33 = {
        ...HX_MACAQUE_SNRNA_E9_FIXTURE,
        meta: { ...HX_MACAQUE_SNRNA_E9_FIXTURE.meta, code: 'e33', label: 'e33 (KISS1/ESR1)', type: 'Glutamatergic' },
      };
      _resetTrackCache();
      failScripts = false;
      await act(async () => {
        fireEvent.click(retry);
      });
      await waitFor(() => expect(screen.queryByText(/Failed to load e33 data/i)).toBeNull());
    } finally {
      spy.mockRestore();
      delete (window as any).HX_MACAQUE_SNRNA_E33;
      _resetTrackCache();
    }
  });
});

describe('App — logo home button returns to the hub', () => {
  it('clicking the logo returns to the landing hub', async () => {
    render(<App initialView="explorer" />);
    // Enter compare mode, then click the logo to go home (the hub).
    fireEvent.click(screen.getByRole('button', { name: /Compare all cells/i }));
    await screen.findByRole('button', { name: /Cells.*selected/i });
    const logo = screen.getByRole('link', { name: /HypoExplorer home/i });
    fireEvent.click(logo);
    await screen.findByRole('search', { name: 'Search genes and pathways' });
    expect(screen.queryByRole('button', { name: /Cells.*selected/i })).toBeNull();
  });
});

// Register a second (mouse, bulk) dataset's eager globals so a dataset switch
// resolves synchronously. Returns a restore fn.
function seedMouseDataset() {
  (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META = {
    populations: ['whole'],
    labels: { whole: 'Whole hypothalamus' },
    types: { whole: 'Whole tissue' },
    qcFlags: { whole: { nNormal: 7, nObese: 8, is3v3: false } },
    nGenes: { whole: 2 },
  };
  (window as any).HX_MOUSE_HYPO_HFD_GSE220533_WHOLE = BULK_TRACK_FIXTURE;
  return () => {
    delete (window as any).HX_MOUSE_HYPO_HFD_GSE220533_META;
    delete (window as any).HX_MOUSE_HYPO_HFD_GSE220533_WHOLE;
    _resetTrackCache();
    _resetDatasetMetaCache();
  };
}

/**
 * Switch the active dataset the way a user now does: out of the explorer via the
 * topbar crumb, into the dataset library, select the study, commit.
 *
 * This replaced `fireEvent.change` on a `<select aria-label="Active dataset">`.
 * The route matters as much as the destination — the library must reach the
 * explorer through the SAME transition the reports, the tracker and the deep
 * links use, so that the per-track resets asserted below happen exactly once and
 * identically on every path into a dataset.
 *
 * COST NOTE. This helper used to dominate the file — 32 s against a 60 s budget,
 * and it blew that budget outright once 155 test files competed for the machine.
 * The cost was NOT the mount or the card text-scan, which profiling put at 805 ms
 * and 525 ms. It was the unscoped `findByRole('button', { name: ... })` for the
 * drawer's commit button: a name matcher makes testing-library compute the
 * accessible name of EVERY button in the document, and each of the 145 dataset
 * cards is a button whose name concatenates its every chip. That one query cost
 * 11.6 s and grew with the registry.
 *
 * Scoping the query to the study record — the `role="article"` page the card
 * opens, as datasetLibrary.test.tsx does — takes it to ~0.1 s and makes the
 * helper O(1) in registry size. Keep any new query in here scoped the same way;
 * an unscoped role+name query at App level is the trap this note exists to mark.
 */
/** Backstop for a test that mounts the dataset library (see switchDatasetViaLibrary).
 *  Now ~4 s of real work, so this is a hang backstop again rather than a budget. */
const LIBRARY_SWITCH_TIMEOUT_MS = 60000;

async function switchDatasetViaLibrary(datasetName: string) {
  // The library reads the precomputed catalog; without a seeded manifest its
  // transport never lands in jsdom and it would sit on its spinner.
  const unseed = seedQueryManifest();
  fireEvent.click(screen.getByRole('button', { name: /Active dataset:/i }));
  // Match on the card's own name text and click the card it sits in. The button's
  // full accessible name concatenates every chip on the card (arms, counts,
  // accession), so matching by role+name would be matching against a moving target.
  const label = (await screen.findAllByText(datasetName))[0];
  fireEvent.click(label.closest('button') as HTMLElement);
  // Scoped to the record, never the document — see the COST NOTE above.
  const record = await screen.findByRole('article');
  fireEvent.click(within(record).getByRole('button', { name: /Open in explorer/i }));
  unseed();
}

describe('App — mouse datasets expose the Pathway Explorer tab (FGSEA computed)', () => {
  // Regression (Codex adversarial): switchDataset kept activeTab='pathway' across
  // a dataset switch. Moving from the macaque Pathway Explorer to a mouse dataset
  // with supportsPathways:false hid the Pathway *button* (the tab-bar filter) but
  // still rendered an empty PathwayExplorerTab via the else-branch — a broken
  // state unreachable by the tabs. The fix falls back to the Gene Explorer when
  // the target dataset has no pathway enrichment.

  it('keeps the Pathway Explorer tab when switching to a mouse dataset', async () => {
    const restore = seedMouseDataset();
    try {
      render(<App initialView="explorer" />);
      // Land on the macaque Pathway Explorer (macaque supportsPathways:true).
      const pathwayBtn = await screen.findByRole('button', { name: 'Pathway Explorer' });
      fireEvent.click(pathwayBtn);
      expect(screen.getByRole('button', { name: 'Pathway Explorer' }).className).toMatch(/active/);

      // Switch to the mouse dataset through the library.
      await switchDatasetViaLibrary('Mouse whole hypothalamus (bulk RNA-seq)');

      await waitFor(() => {
        // Mouse datasets now carry FGSEA (supportsPathways:true), so the Pathway
        // Explorer tab stays available rather than falling back to Gene Explorer.
        expect(screen.queryByRole('button', { name: 'Pathway Explorer' })).not.toBeNull();
      });
    } finally {
      restore();
    }
  }, LIBRARY_SWITCH_TIMEOUT_MS);
});

describe('App — the sidebar filter is dataset-scoped, not track-scoped', () => {
  // Regression: a track switch cleared `cellSearch` along with the per-track view
  // state, so clicking a track inside a filtered sidebar collapsed the list back
  // to the full 60 populations — breaking the "compare several matches of one
  // query" workflow (filter, open the first hit, then reach for the second).
  // The filter is navigation state about the LIST, so it now survives a track
  // switch; switchDataset still clears it, because the query's vocabulary
  // belongs to the outgoing dataset's track list.
  const filterInput = () => screen.getByLabelText(/Filter cells by id/i) as HTMLInputElement;

  it('keeps the query and the filtered list when a matching track is selected', async () => {
    render(<App initialView="explorer" />);

    // "GABAergic" matches three fixture tracks by category (i23, i26, i40) and
    // excludes the glutamatergic ones (e9, e33, e38).
    fireEvent.change(filterInput(), { target: { value: 'GABAergic' } });
    expect(screen.queryByRole('button', { name: /e33/i })).toBeNull();

    // Open the first match. The track isn't seeded as an eager global, so the
    // load stays pending — irrelevant here, but wrap in act so state settles.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /i23/i }));
    });

    // The query survives, and so does the narrowed list: i26 is still one click
    // away and the filtered-out tracks are still filtered out.
    expect(filterInput().value).toBe('GABAergic');
    expect(screen.getByRole('button', { name: /i26/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /e33/i })).toBeNull();
  });

  it('clears the query when the dataset changes', async () => {
    const restore = seedMouseDataset();
    try {
      render(<App initialView="explorer" />);
      fireEvent.change(filterInput(), { target: { value: 'GABAergic' } });
      expect(filterInput().value).toBe('GABAergic');

      await switchDatasetViaLibrary('Mouse whole hypothalamus (bulk RNA-seq)');

      // A macaque category name means nothing to the mouse track list; carrying
      // it over would render an empty sidebar.
      await waitFor(() => expect(filterInput().value).toBe(''));
    } finally {
      restore();
    }
  }, LIBRARY_SWITCH_TIMEOUT_MS);
});
