// The gene picker: search box, Load list… / Save list ▾, the count, Clear all,
// and the chips — over ONE vocabulary-bound selection.
//
// The Gene Explorer, the Compare tab and the compare set each used to build
// this row themselves, and the copies drifted: only the Gene Explorer's chips
// said "now AARS1" for a retired symbol, only the compare set had a Clear
// button beside its count, and the compare set re-implemented the case
// mapping inline. Everything that differs between those places is now a
// property of the selection they hand over (its vocabulary: one track, the
// union of loaded populations, or a case-folded union across studies), so
// this view takes the selection and reads the rest from it. The one slot is
// for controls that belong to a single place — the Gene Explorer's view
// buttons — which sit between the count and Clear all.

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { GeneSearchBox } from '../gene-explorer/GeneSearchBox';
import { LoadGeneListButton, SaveGeneListMenu } from './GeneListTools';
import type { BoundGeneSelection, GeneChip } from '../explorer/geneVocabulary';
import { FONT_MONO, FONT_SANS } from '../styles/constants';

interface GenePickerProps {
  selection: BoundGeneSelection;
  /** Names the vocabulary in the Load dialog: "this dataset", "the selected populations". */
  scopeLabel?: string;
  /** Filename stem parts for the saved selection, e.g. the track code. */
  filenameParts: Array<string | undefined>;
  /** Controls only this place has, placed between the count and Clear all. */
  children?: ReactNode;
}

/**
 * The search box wired to a bound selection. Exported on its own for the
 * Gene Explorer's empty pop-ups, which exist to be typed into: the box there
 * must be the toolbar's, so anything the toolbar can find is findable there.
 */
export function SelectionSearchBox({ selection, autoFocus }: { selection: BoundGeneSelection; autoFocus?: boolean }) {
  const { vocabulary } = selection;
  return (
    <GeneSearchBox
      onAdd={selection.add}
      selectedGenes={selection.offered}
      geneNames={vocabulary.names}
      nomenclatureAuthority={vocabulary.authority}
      autoFocus={autoFocus}
    />
  );
}

/** The note's tooltip, in the vocabulary's own terms: one dataset, or a set of studies. */
function retiredTitle(chip: GeneChip, caseFolded: boolean): string {
  const to = chip.retiredTo.join(' / ');
  const who = chip.authorities.length === 1
    ? `${chip.authorities[0]} now calls`
    : `${chip.authorities.join(' and ')} now call`;
  const where = caseFolded
    ? 'At least one study in this set stores the older spelling.'
    : 'The dataset stores the older spelling.';
  return `${chip.gene} is a previous symbol; ${who} this gene ${to}. ${where}`;
}

export function GenePicker({ selection, scopeLabel, filenameParts, children }: GenePickerProps) {
  const { genes, chips, vocabulary } = selection;
  const hasGenes = genes.length > 0;
  // Save writes what the chips print; Load counts "already selected" in the
  // vocabulary's spelling, which is what its resolution returns. The two
  // differ only for a case-folded union.
  const saveRows = useMemo(() => genes.map((g) => ({ Gene: g })), [genes]);

  return (
    <div className="gene-picker" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SelectionSearchBox selection={selection} />
        {/* A whole list in one go — a file, or a pasted block — and the
            selection back out as one. Beside the search box because they are
            the same act at a different scale: one gene typed, fifty dropped. */}
        <LoadGeneListButton
          selectedGenes={selection.offered}
          onAddGenes={selection.addMany}
          onReplaceGenes={selection.replace}
          geneNames={vocabulary.names}
          nomenclatureAuthority={vocabulary.authority}
          scopeLabel={scopeLabel}
        />
        <SaveGeneListMenu rows={saveRows} filenameParts={[...filenameParts, 'gene_list']} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>
          {hasGenes
            ? `${genes.length} gene${genes.length === 1 ? '' : 's'} selected`
            : 'no genes selected'}
        </span>
        {children}
        {hasGenes && (
          <button type="button" onClick={selection.clear}
            title="Remove all selected genes"
            style={{
              fontSize: 10, padding: '1px 8px', border: '1px solid var(--border)',
              borderRadius: 3, background: 'var(--bg-panel)', color: 'var(--text-muted)',
              cursor: 'pointer', fontFamily: FONT_SANS,
            }}>
            Clear all
          </button>
        )}
      </div>
      {/* Chips on their own row, starting below the search box. Bounded and
          scrollable: a volcano's "Add all" can hand over hundreds of genes,
          and an unbounded strip would push the plot off the screen. */}
      {hasGenes && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 96, overflowY: 'auto', alignContent: 'flex-start' }}>
          {chips.map((chip) => {
            // The symbol a source stores may be one its authority has retired.
            // Saying so ON THE CHIP is the point: this is where the reader's
            // attention already is, and it is the difference between "the site
            // is missing AARS1" and "this study measured it under its former
            // name". Silent until the alias index has loaded.
            const retiredTo = chip.retiredTo.join(' / ');
            return (
              <span key={chip.gene} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                border: '1px solid var(--color-selected)', background: 'var(--chip-bg)', color: 'var(--text-primary)',
                borderRadius: 4, padding: '1px 6px 1px 8px', fontSize: 12,
                fontFamily: FONT_MONO,
              }}>
                {chip.gene}
                {retiredTo && (
                  <span
                    title={retiredTitle(chip, vocabulary.caseFolded)}
                    style={{ fontFamily: FONT_SANS, fontSize: 10, color: 'var(--text-muted)' }}
                  >
                    now {retiredTo}
                  </span>
                )}
                <button type="button" onClick={() => selection.remove(chip.gene)} aria-label={`Remove ${chip.gene}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, color: 'var(--color-selected)', lineHeight: 1 }}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
