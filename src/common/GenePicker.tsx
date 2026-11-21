// The gene picker: search box, the Gene list ▾ menu, and — once something is
// selected — the count, Clear all and the chips, over ONE vocabulary-bound
// selection.
//
// The Gene Explorer, the Compare tab and the compare set each used to build
// this row themselves, and the copies drifted: only the Gene Explorer's chips
// said "now AARS1" for a retired symbol, only the compare set had a Clear
// button beside its count, and the compare set re-implemented the case
// mapping inline. Everything that differs between those places is now a
// property of the selection they hand over (its vocabulary: one track, the
// union of loaded populations, or a case-folded union across studies), so
// this view takes the selection and reads the rest from it.
//
// It comes in two halves so the Gene Explorer can put the search and its menu
// on the volcano toolbar's row: `GenePickerSearch` (search + Gene list ▾) and
// `GeneSelectionBar` (count, the host's own controls, Clear all, chips), which
// renders nothing until a gene is selected. `GenePicker` is the two stacked,
// for the Compare tab and the compare set.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { GeneSearchBox } from '../gene-explorer/GeneSearchBox';
import { LoadGeneListDialog } from './GeneListTools';
import { MenuGroup, MenuItem, ToolbarPopover } from './ToolbarPopover';
import { useExportAction } from '../utils/exportAction';
import { GENE_LIST_SAVE_FORMATS, saveGeneList } from '../utils/geneListFile';
import type { BoundGeneSelection, GeneChip } from '../explorer/geneVocabulary';
import { FONT_MONO, FONT_SANS } from '../styles/constants';

interface GenePickerSearchProps {
  selection: BoundGeneSelection;
  /** Names the vocabulary in the Load dialog: "this dataset", "the selected populations". */
  scopeLabel?: string;
  /** Filename stem parts for the saved selection, e.g. the track code. */
  filenameParts: Array<string | undefined>;
}

/**
 * The search box wired to a bound selection. Exported on its own for the
 * Gene Explorer's empty pop-ups, which exist to be typed into: the box there
 * must be the toolbar's, so anything the toolbar can find is findable there.
 */
export function SelectionSearchBox({ selection, autoFocus, showAliases }: {
  selection: BoundGeneSelection; autoFocus?: boolean; showAliases?: boolean;
}) {
  const { vocabulary } = selection;
  return (
    <GeneSearchBox
      onAdd={selection.add}
      selectedGenes={selection.offered}
      geneNames={vocabulary.names}
      nomenclatureAuthority={vocabulary.authority}
      autoFocus={autoFocus}
      showAliases={showAliases}
    />
  );
}

/**
 * Search, then one menu for a whole list at a time: Load list…, Save list in
 * each format, and whether suggestions list each gene's other names. Beside
 * the search box because they are the same act at a different scale: one gene
 * typed, fifty dropped.
 */
export function GenePickerSearch({ selection, scopeLabel, filenameParts }: GenePickerSearchProps) {
  const { genes, vocabulary } = selection;
  const [showAliases, setShowAliases] = useState(false);
  const [loading, setLoading] = useState(false);
  const { busy, run } = useExportAction();
  // Save writes what the chips print; Load counts "already selected" in the
  // vocabulary's spelling, which is what its resolution returns. The two
  // differ only for a case-folded union.
  const saveRows = useMemo(() => genes.map((g) => ({ Gene: g })), [genes]);
  const empty = saveRows.length === 0;

  return (
    <div className="gx-picker">
      <SelectionSearchBox selection={selection} showAliases={showAliases} />
      <ToolbarPopover kind="menu" label="Gene list" popupLabel="Gene list"
        title="Load a gene list from a file or pasted text, save the selection, or show other gene names in search"
        busy={busy} busyLabel="Saving…">
        {(close) => (
          <>
            <MenuItem onSelect={() => { close(); setLoading(true); }}
              title="Load a gene list from a text, CSV, TSV, Excel, GMT or JSON file, or paste one">
              Load list…
            </MenuItem>
            <MenuGroup heading="Save list as">
              {GENE_LIST_SAVE_FORMATS.map((f) => (
                <MenuItem key={f.format} hint={f.hint} disabled={empty}
                  title={empty ? 'Nothing to save yet' : `Download these ${saveRows.length} genes as a file`}
                  onSelect={() => { close(); run(() => saveGeneList([...filenameParts, 'gene_list'], saveRows, f.format)); }}>
                  {f.label}
                </MenuItem>
              ))}
            </MenuGroup>
            <div className="gx-menu-sep" />
            <MenuItem checked={showAliases} onSelect={() => setShowAliases((v) => !v)}
              title="List each suggested gene's alias and previous symbols from its nomenclature authority">
              List aliases and previous symbols in search
            </MenuItem>
          </>
        )}
      </ToolbarPopover>
      {loading && (
        <LoadGeneListDialog
          onClose={() => setLoading(false)}
          selectedGenes={selection.offered}
          onAddGenes={selection.addMany}
          onReplaceGenes={selection.replace}
          geneNames={vocabulary.names}
          nomenclatureAuthority={vocabulary.authority}
          scopeLabel={scopeLabel}
        />
      )}
    </div>
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

/**
 * What is selected: the count, controls only the host has (the Gene
 * Explorer's view buttons) between it and Clear all, then the chips. Nothing
 * at all with an empty selection: the search placeholder and the plot's hint
 * already say how to pick a gene.
 */
export function GeneSelectionBar({ selection, children }: { selection: BoundGeneSelection; children?: ReactNode }) {
  const { genes, chips, vocabulary } = selection;
  if (genes.length === 0) return null;
  return (
    <div className="gx-selection" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* A sentence in sans; only the count is a figure, so only it is mono. */}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, whiteSpace: 'nowrap', marginRight: 4 }}>
          <span style={{ fontFamily: FONT_MONO }}>{genes.length.toLocaleString()}</span>{` gene${genes.length === 1 ? '' : 's'} selected`}
        </span>
        {children}
        <button type="button" className="gx-btn" onClick={selection.clear} title="Remove all selected genes">
          Clear all
        </button>
      </div>
      {/* Bounded and scrollable: a volcano's "Add all" can hand over hundreds
          of genes, and an unbounded strip would push the plot off the screen. */}
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
    </div>
  );
}

/** Search and Gene list ▾ on one row, the selection under it. */
export function GenePicker({ selection, scopeLabel, filenameParts }: GenePickerSearchProps) {
  return (
    <div className="gene-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <GenePickerSearch selection={selection} scopeLabel={scopeLabel} filenameParts={filenameParts} />
      <GeneSelectionBar selection={selection} />
    </div>
  );
}
