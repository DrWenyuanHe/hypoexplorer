// The study-scope controls the cross-dataset gene and pathway reports share:
// the expandable per-dataset picker, its summary line and the lazily loaded
// search vocabulary.
//
// The category and quality cards and the panel that assembles these pieces
// live in StudySelectionPanel.tsx.
//
// COLOR NOTE (DESIGN.md, the One Voice Rule): the scope controls follow
// FilterChip's blue `var(--accent)`, not the orange `var(--color-selected)` that
// the checkbox rail in the library uses. Orange marks the single active thing in
// a view.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { FONT_MONO } from '../styles/constants';
import { datasetCategory, DATASET_CATEGORIES } from '../data/datasets';
import type { DatasetCategory } from '../data/datasets';
import type { Dataset } from '../types';

/**
 * The per-dataset scope picker.
 *
 * Rendered as real checkboxes rather than as more chips, for two reasons. It is
 * a long multi-select list, which is what checkboxes are for — and the report's
 * dataset rows are already buttons carrying dataset names, so a second control
 * per dataset with the same accessible name and the same role would make
 * "the Mouse whole hypothalamus button" ambiguous to a screen reader and to
 * every by-role query written against this page.
 *
 * `selected === null` means all displayed studies. Gene search permits an
 * explicit empty selection; other callers retain the last-checkbox reset.
 */
export function DatasetScopePanel({ datasets, selected, onChange, allowEmpty = false }: {
  datasets: readonly Dataset[];
  selected: readonly string[] | null;
  /** Gene search preserves an explicit empty selection and offers select/clear actions. */
  allowEmpty?: boolean;
  /**
   * A `useState` setter, so a toggle can be expressed as a function of the
   * PREVIOUS selection. Computing the next list from the `selected` prop instead
   * would drop an update whenever two toggles land in one React batch — not
   * something a mouse can do, since each click commits its own render, but true
   * of anything that toggles more than one study in a single handler.
   */
  onChange: Dispatch<SetStateAction<string[] | null>>;
}) {
  const [open, setOpen] = useState(false);
  const isOn = (id: string) => selected === null || selected.includes(id);

  // Grouped in the canonical category order so the picker reads in the same
  // order as the report's sections. `datasetCategory` throws on an id it does
  // not know, so this walks the registry rather than trusting a stored list.
  const grouped = useMemo(() => {
    const byCat = new Map<DatasetCategory, Dataset[]>();
    for (const d of datasets) {
      const c = datasetCategory(d.id);
      const arr = byCat.get(c);
      if (arr) arr.push(d); else byCat.set(c, [d]);
    }
    return DATASET_CATEGORIES.filter((c) => byCat.has(c)).map((c) => ({ category: c, datasets: byCat.get(c) as Dataset[] }));
  }, [datasets]);

  const toggle = (id: string) => {
    onChange((prev) => {
      // The first tick has to start from "everything", not from an empty set, or
      // unticking one dataset would read as selecting only that one.
      const base = prev === null ? datasets.map((d) => d.id) : prev.filter((id) => datasets.some((d) => d.id === id));
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      // A full selection is all; preserve an explicit empty gene selection.
      return (!allowEmpty && next.length === 0) || (next.length > 0 && next.length === datasets.length) ? null : next;
    });
  };

  const nSelected = datasets.filter((d) => isOn(d.id)).length;

  return (
    <div className="qsearch-datasets">
      {/* Reset sits BESIDE the disclosure, not inside it: nesting one control in
          another gives the inner one no accessible name of its own and makes the
          outer button's name include it. */}
      <div className="qsearch-datasets-bar">
        <button type="button" className="qsearch-datasets-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span aria-hidden="true" className="caret">{open ? '▾' : '▸'}</span>
          Datasets
          <span className="n">{nSelected} of {datasets.length}</span>
        </button>
        {selected !== null && (
          <button type="button" className="qsearch-clear" onClick={() => onChange(null)}>
            Reset
          </button>
        )}
      </div>
      {open && (
        <div className="qsearch-datasets-body">
          {allowEmpty && datasets.length > 0 && (
            <div className="qsearch-dataset-actions">
              <button type="button" className="qsearch-clear" onClick={() => onChange(null)}>Select all</button>
              <button type="button" className="qsearch-clear" onClick={() => onChange([])}>Clear selection</button>
            </div>
          )}
          {datasets.length === 0 && <p className="qsearch-empty">No datasets match these filters.</p>}
          {grouped.map(({ category, datasets: list }) => (
            <div key={category} className="qsearch-dsgroup">
              <div className="qsearch-dsgroup-head">{category}</div>
              {list.map((d) => (
                <label key={d.id} className="qsearch-dsrow">
                  <input type="checkbox" checked={isOn(d.id)} onChange={() => toggle(d.id)} />
                  <span className="nm">{d.name}</span>
                  <span className="meta">{d.organism}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Load a search vocabulary once per mount, tolerating failure.
 *
 * Both explorers warm their autocomplete the same way and neither treats a
 * failure as an error: the box still works, it just stops suggesting.
 */
export function useSearchIndex(load: () => Promise<string[]>): string[] {
  const [index, setIndex] = useState<string[]>([]);
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once; `load` is a stable module function per call site
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    load()
      .then((names) => { if (!cancelled) setIndex(names); })
      .catch(() => { /* autocomplete just stays empty */ });
    return () => { cancelled = true; };
  }, []);
  return index;
}

/** The mono count line under the scope controls. */
export function ScopeSummary({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO, marginTop: 10 }}>{children}</div>;
}
