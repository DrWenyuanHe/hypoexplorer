// The raw-track back-compat reader: the single place the LEGACY bundle shapes
// are spelled out.
//
// A track bundle has been generated in more than one shape over the life of the
// resource, and every reader has to know the same two rules:
//
//   1. DE table — multi-contrast bundles carry `deByContrast` keyed by contrast
//      id; older single-contrast bundles carry only `de`.
//   2. Per-group sample ids — the migration added `meta.groupSamples`; older
//      macaque bundles carry only the `normalSamples` / `obeseSamples` pair.
//
// Both rules used to be hand-spelled twice each (buildPopData + the cross-dataset
// fallback path; buildPopData + sampleIds), which is how a comment in sampleIds
// came to say it "mirrors buildPopData's groupSamples resolution" — a mirror
// nothing enforced. They resolve here instead.
//
// What deliberately stays at the CALL SITES: the default for "this track states
// nothing". `groupSamplesOf` returns null for that case rather than inventing a
// record, because the two callers genuinely disagree about what nothing means —
// buildPopData yields the two empty macaque arms (popData.groupSamples is
// non-optional and its consumers index it by group key), while the QC tab's
// reader yields `{}` (it enumerates the record). Folding either default in here
// would silently change the other surface.

import type { GeneDERecord, PathwayDatabase, PathwaySibling, RawTrack } from '../types';

/**
 * The DE table a track exposes for one contrast.
 *
 * Prefers the active contrast's `deByContrast` entry and falls back to the
 * legacy single-contrast `de`. `[]` when the track states neither — a malformed
 * or pathway-only bundle must not crash a `.map`, and both call sites already
 * coalesced to the empty table.
 */
export function deTableFor(
  raw: RawTrack | null | undefined,
  contrastId: string | undefined,
): GeneDERecord[] {
  return (contrastId ? raw?.deByContrast?.[contrastId] : undefined) ?? raw?.de ?? [];
}

/**
 * The STRICT twin of `deTableFor` (DATASET_CONTRACT.md): legacy `de` is the
 * REGISTERED DEFAULT's table, so only the registered default contrast may fall
 * back to it. A non-default contrast must be witnessed explicitly in
 * `deByContrast`, and no contrast at all yields the empty table — never a
 * guess. Residual: a bundle predating a registry default swap is
 * indistinguishable from a fresh one here; that staleness is the manifest
 * freshness check's job, not this reader's.
 */
export function strictDeTableFor(
  raw: RawTrack | null | undefined,
  contrastId: string | undefined,
  registeredDefaultId: string | undefined,
): GeneDERecord[] {
  if (!contrastId) return [];
  const explicit = raw?.deByContrast?.[contrastId];
  if (explicit) return explicit;
  return contrastId === registeredDefaultId ? raw?.de ?? [] : [];
}

/**
 * The per-group sample ids a track declares, or null when it declares none.
 *
 * Prefers the migration-added `meta.groupSamples`; else derives the record from
 * the legacy `normalSamples` / `obeseSamples` pair. Null — never a fabricated
 * record — is what lets each caller keep its own "nothing declared" default
 * (see the module note).
 */
export function groupSamplesOf(raw: RawTrack | null | undefined): Record<string, string[]> | null {
  const meta = raw?.meta;
  if (!meta) return null;
  if (meta.groupSamples) return meta.groupSamples;
  if (meta.normalSamples || meta.obeseSamples) {
    return { normal: meta.normalSamples ?? [], obese: meta.obeseSamples ?? [] };
  }
  return null;
}

// ── Pathway sibling shapes (rule 3, added with the multi-contrast bundles) ────
// A sibling bundle is either a plain PathwayDatabase (legacy single-contrast)
// or the wrapper `{ default, byContrast }` (see the PathwaySibling type). The
// two accessors below are the sanctioned shape-sniff for consumers that want
// the resolved blocks (track hydration); strictSiblingPathwaysFor is the
// sanctioned STRICT resolution (crossDataset.findPathway and
// build_query_index.mts), which those permissive accessors cannot express.

/** The default contrast's pathway block of a sibling value; null when absent. */
export function siblingDefaultPathways(v: PathwaySibling | null | undefined): PathwayDatabase | null {
  if (!v) return null;
  return 'byContrast' in v ? v.default ?? null : v;
}

/** The non-default per-contrast pathway blocks of a sibling value; null on legacy shapes. */
export function siblingPathwaysByContrast(
  v: PathwaySibling | null | undefined,
): Record<string, PathwayDatabase> | null {
  return v && 'byContrast' in v ? v.byContrast ?? null : null;
}

/**
 * How strictSiblingPathwaysFor arrived at its block — callers audit on this.
 *
 * `explicit` is the only one whose contrast attribution the BYTES witness: the
 * block was keyed by the requested contrast id. The other two serving sources
 * are unverifiable-by-content and exist so callers can say so out loud —
 * `legacy-default` (a wrapper's unkeyed `default` block) and `legacy-plain` (a
 * whole sibling predating the wrapper, which names no contrast at all).
 */
export type StrictSiblingSource = 'explicit' | 'legacy-default' | 'legacy-plain' | 'refused';

/**
 * The STRICT default-witness resolution of a pathway sibling for one contrast
 * (DATASET_CONTRACT.md): a wrapper's `default` block IS the registered
 * default's table and `byContrast` carries the non-defaults, so a non-default
 * contrast must be witnessed explicitly in `byContrast`, while the registered
 * default may fall back to `default` ('legacy-default' — the contract shape
 * deliberately does NOT repeat the default inside `byContrast`, and the block
 * carries no contrast id, so attribution is unverifiable-by-content). A plain
 * legacy sibling serves only the registered default, reported as
 * 'legacy-plain': it names no contrast either, so its attribution is exactly
 * as unverifiable as a wrapper's default block and callers must be able to
 * audit it the same way. When NEITHER side names a contrast (an unregistered
 * caller, both ids undefined) the plain shape still serves, matching the query
 * index's treatment of legacy bundles. Wrapper fallback additionally requires a
 * named contrast, so an unregistered caller is 'refused' there.
 */
export function strictSiblingPathwaysFor(
  sibling: PathwaySibling | null | undefined,
  contrastId: string | undefined,
  registeredDefaultId: string | undefined,
): { db: PathwayDatabase | null; source: StrictSiblingSource } {
  if (!sibling) return { db: null, source: 'refused' };
  if ('byContrast' in sibling) {
    const explicit = contrastId ? sibling.byContrast[contrastId] : undefined;
    if (explicit) return { db: explicit, source: 'explicit' };
    if (contrastId && contrastId === registeredDefaultId && sibling.default) {
      return { db: sibling.default, source: 'legacy-default' };
    }
    return { db: null, source: 'refused' };
  }
  if (contrastId === registeredDefaultId) return { db: sibling, source: 'legacy-plain' };
  return { db: null, source: 'refused' };
}
