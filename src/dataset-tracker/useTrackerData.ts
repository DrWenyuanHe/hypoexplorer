// Loads the tracker catalog (lazy, once) + the review state, and owns the
// debounced persistence of review edits. The ~2 MB catalog blob is NOT in the app
// bundle: it is injected as a script on first use (window.HX_TRACKER_CATALOG),
// matching the per-dataset bundle convention and the ?v= cache-bust scheme.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRequiredBundle, peekGlobalBundle } from '../data/bundleSource';
import { canEdit, loadReviews, saveReviews } from './reviewStore';
import type { Reviews, TrackerCatalog } from '../types';

// ORIGIN-RELATIVE ON PURPOSE — do NOT prefix this with BUNDLE_BASE. The build
// prunes only dist/datasets/ and dist/query/ when VITE_BUNDLE_BASE_URL is set
// (see the drop-off-origin-data plugin in vite.config.ts); dist/tracker/ stays
// on the app host, so pointing this at the bundle origin would 404 on every
// off-origin deploy.
const CATALOG_URL = '/tracker/catalog.js';
const CATALOG_GLOBAL = 'HX_TRACKER_CATALOG';

function loadCatalog(): Promise<TrackerCatalog> {
  // Required: the tracker has nothing to show without it, and a failure must
  // stay retryable on a later mount rather than caching a wedged null.
  return loadRequiredBundle<TrackerCatalog>(CATALOG_URL, CATALOG_GLOBAL);
}

export interface UseTrackerData {
  catalog: TrackerCatalog | null;
  reviews: Reviews;
  loading: boolean;
  error: string;
  save: string;
  canEdit: boolean;
  setStatus: (acc: string, status: string) => void;
  setNote: (acc: string, note: string) => void;
}

export function useTrackerData(): UseTrackerData {
  // Already on window (an eager <script>, or a previous mount's injection):
  // render from it synchronously instead of flashing the loading state.
  const seeded = peekGlobalBundle<TrackerCatalog>(CATALOG_GLOBAL) || null;
  const [catalog, setCatalog] = useState<TrackerCatalog | null>(seeded);
  const [reviews, setReviews] = useState<Reviews>({});
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState('');
  const [save, setSave] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadCatalog(), loadReviews()])
      .then(([cat, rev]) => {
        if (!alive) return;
        setCatalog(cat);
        setReviews(rev || {});
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: Reviews) => {
    if (!canEdit) return;
    setSave('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveReviews(next).then((ok) => {
        setSave(ok ? 'saved' : 'error');
        if (ok) setTimeout(() => setSave(''), 1500);
      });
    }, 250);
  }, []);

  const setStatus = useCallback(
    (acc: string, status: string) => {
      setReviews((prev) => {
        const next: Reviews = {
          ...prev,
          [acc]: { ...(prev[acc] || {}), status: status as Reviews[string]['status'], updated: new Date().toISOString() },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setNote = useCallback(
    (acc: string, note: string) => {
      setReviews((prev) => {
        const next: Reviews = {
          ...prev,
          [acc]: { ...(prev[acc] || {}), note, updated: new Date().toISOString() },
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { catalog, reviews, loading, error, save, canEdit, setStatus, setNote };
}
