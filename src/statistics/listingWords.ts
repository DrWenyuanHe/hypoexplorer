// The words a cross-study listing uses for its listing mode.
//
// What leads, the order and the counts are crossStudyListing.ts's. This module
// owns only the words that change with the listing mode, and the clause that
// says what a nominal result is not corrected for. Several views say these
// things, and a slip in one would call a nominal result "significant" or
// misstate the multiple-testing family it was never corrected across.
//
// Rules:
//   * The nominal mode says "at p < 0.05"; only the FDR mode says
//     "significant", because only FDR results lead in it.
//   * Every count is the caller's; nothing here re-derives one.
//   * Cutoffs come from policy.ts, never typed.
//
// Headlines, verdicts, notes that depend on the order or on what is shown, and
// every layout decision stay with the views: they need facts a listing does
// not record (which studies were selected but not measured, what is folded).

import { NOMINAL_P_CUTOFF } from './policy';
import type { ListingMode } from './listingModeStore';
import { plural } from '../utils/format';

/**
 * The leading tracks, counted in the mode's words: "2 tracks at p < 0.05" |
 * "2 significant tracks"; with `more`, "2 more tracks at p < 0.05" |
 * "2 more significant tracks".
 */
export function leadingTracks(mode: ListingMode, n: number, options: { more?: boolean } = {}): string {
  const more = options.more ? 'more ' : '';
  return mode === 'nominal'
    ? `${plural(n, `${more}track`)} at p < ${NOMINAL_P_CUTOFF}`
    : `${plural(n, `${more}significant track`)}`;
}

/** What the tracks after the leading ones are not: "not at p < 0.05" | "not significant". */
export function notLeading(mode: ListingMode): string {
  return mode === 'nominal' ? `not at p < ${NOMINAL_P_CUTOFF}` : 'not significant';
}

/** The quiet line when nothing leads: "No track at p < 0.05" | "No significant track". */
export function noneLeads(mode: ListingMode): string {
  return mode === 'nominal' ? `No track at p < ${NOMINAL_P_CUTOFF}` : 'No significant track';
}

/**
 * What a nominal result is not corrected for, lower-case with no lead-in, so
 * each view keeps its own sentence around it. A gene's q is corrected across
 * the genes its study tested; a pathway's padj across the pathways tested in
 * its track. With no kind, the general clause the listing control's tooltip
 * uses.
 */
export function nominalCaveat(kind?: 'gene' | 'pathway'): string {
  const family = kind === 'gene'
    ? 'the genes each study tested or the tracks searched here'
    : kind === 'pathway' ? 'testing many pathways and tracks' : 'multiple testing';
  return `not corrected for ${family}, so some are expected by chance.`;
}
