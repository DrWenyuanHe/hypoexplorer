// The control behind listingModeStore, and the q explanation the result tables
// attach to their q / FDR / padj columns.
//
// Rendered above the search portal's results and in the gene and pathway
// reports; the pick lives in the store, so every copy shows the same state and
// one click relists every view.

import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_FDR_CUTOFF, NOMINAL_P_CUTOFF } from './policy';
import { setListingMode, useListingMode, type ListingMode } from './listingModeStore';
import './listingMode.css';

/**
 * What q is, in one tooltip. Shared by every q / FDR / padj column so the
 * explanation cannot drift between views.
 */
export const Q_EXPLANATION =
  'q is the FDR-adjusted p-value: each study\'s p-values after Benjamini–Hochberg correction across '
  + 'everything that study tested (its genes, or the pathways tested in a track). It is the lowest '
  + 'false-discovery rate at which this result would count as a hit, so q < '
  + `${DEFAULT_FDR_CUTOFF} keeps the expected share of false hits below 5%. HypoExplorer shows the value `
  + 'each study\'s own analysis produced; it computes no q of its own.';

/**
 * A q / FDR / padj label that explains itself on hover or focus. Pass
 * `focusable={false}` inside an element that is already interactive (a row
 * that is a button), where a nested tab stop would be invalid.
 */
export function QTerm({ children = 'q', focusable = true }: { children?: ReactNode; focusable?: boolean }) {
  // Focusable (where allowed) so keyboard users can reach the tooltip too.
  return <abbr className="q-term" title={Q_EXPLANATION} tabIndex={focusable ? 0 : undefined}>{children}</abbr>;
}

const OPTIONS: ReadonlyArray<{ value: ListingMode; label: string; title: string }> = [
  {
    value: 'fdr',
    label: `FDR (q < ${DEFAULT_FDR_CUTOFF})`,
    title: `List only the tracks that pass FDR < ${DEFAULT_FDR_CUTOFF}.`,
  },
  {
    value: 'nominal',
    label: `p < ${NOMINAL_P_CUTOFF}`,
    title: `Also list tracks with raw p < ${NOMINAL_P_CUTOFF} that miss FDR, labelled "p < ${NOMINAL_P_CUTOFF} only". `
      + 'They are not corrected for multiple testing, so some are expected by chance. Counts stay on FDR.',
  },
];

export function ListingModeToggle({ style }: { style?: CSSProperties }) {
  const mode = useListingMode();
  return (
    <div className="listing-mode" style={style}>
      <span className="listing-mode-label" aria-hidden="true">List</span>
      <fieldset className="listing-mode-options">
        {/* Visually hidden: names the group for a screen reader without taking space. */}
        <legend className="listing-mode-legend">Tracks to list</legend>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            title={option.title}
            onClick={() => setListingMode(option.value)}
          >
            {/* Always rendered, shown only when pressed, so the buttons keep their width.
                With the fill, the state never rests on colour alone. */}
            <span className="listing-mode-check" aria-hidden="true">✓</span>
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
