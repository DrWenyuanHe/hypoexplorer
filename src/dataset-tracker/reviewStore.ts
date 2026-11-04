// Review-state persistence with a dev/prod seam.
//
// PROD (published static site): there is no server. `canEdit` is false, `load()`
// returns the baked reviews bundled at build time, and `save()` is a no-op. The
// `import.meta.env.DEV` guards are statically false, so the fetch code is dead-code-
// eliminated from the production bundle — there is literally no code path to a
// server.
//
// DEV (vite dev server): `canEdit` is true; `load()` reads the live file through
// the dev-only /api/tracker/reviews endpoint (so manual edits to the file show up),
// falling back to the baked copy if the endpoint is unreachable (e.g. under tests);
// `save()` POSTs the full map back, which the dev plugin writes to
// src/data/tracker/reviews.json — commit that file and the next build bakes it in.

import baked from '../data/tracker/reviews.json';
import type { Reviews } from '../types';

export const canEdit = import.meta.env.DEV;

const ENDPOINT = '/api/tracker/reviews';

export async function loadReviews(): Promise<Reviews> {
  if (import.meta.env.DEV) {
    try {
      const r = await fetch(ENDPOINT);
      if (r.ok) {
        const j = await r.json();
        // Guard against a corrupt reviews.json (e.g. an array/string written by a
        // bad POST): only accept a plain object, else fall back to the baked copy.
        if (j && typeof j === 'object' && !Array.isArray(j)) return j as Reviews;
      }
    } catch (_e) {
      /* dev server / endpoint unavailable (e.g. tests) — fall back to baked */
    }
  }
  return baked as Reviews;
}

export async function saveReviews(map: Reviews): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map),
    });
    return r.ok;
  } catch (_e) {
    return false;
  }
}
