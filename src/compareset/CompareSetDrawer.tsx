// The compare set, laid out for editing: every column in it, grouped the way
// the library and the reports group studies, with a remove on each row and
// the one control that turns the set into a comparison.
//
// A Modal rather than a side drawer, for the reason the library's record
// stopped being one: what you opened is the subject, not an aside. It
// renders the `items` it is handed — the header button that opens it holds
// the subscription, so a removal here shows up on the next render either way.

import { useMemo } from 'react';
import { Modal } from '../common/Modal';
import { DATASET_CATEGORIES } from '../data/datasetCategories';
import { getDataset } from '../data/datasets';
import { getActiveContrast } from '../data/contrasts';
import { contrastLabel } from '../crossdataset/forestReport';
import { FONT_MONO } from '../styles/constants';
import { COMPARE_SET_MAX, clear, removeItem, type CompareSetItem } from './compareSetStore';
import type { Dataset } from '../types';

interface CompareSetDrawerProps {
  items: readonly CompareSetItem[];
  onClose: () => void;
  onCompare: (items: readonly CompareSetItem[]) => void;
  onOpenLibrary?: () => void;
}

const eyebrow = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
};

export function CompareSetDrawer({ items, onClose, onCompare, onOpenLibrary }: CompareSetDrawerProps) {
  const n = items.length;

  // Categories in their canonical order, columns in the order they were
  // added within each. Walks the registry rather than trusting stored ids —
  // the store already dropped unknown ones, but a render guard costs nothing.
  const groups = useMemo(() => {
    const rows: Array<{ item: CompareSetItem; dataset: Dataset }> = [];
    for (const item of items) {
      const dataset = getDataset(item.datasetId);
      if (dataset) rows.push({ item, dataset });
    }
    return DATASET_CATEGORIES
      .map((category) => ({ category, rows: rows.filter((r) => r.dataset.category === category) }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  return (
    <Modal title="Compare set" onClose={onClose} width="min(560px, 94vw)" height="auto">
      <div style={{ padding: '6px 18px 12px', overflowY: 'auto', maxHeight: '60vh' }}>
        {n === 0 ? (
          <div style={{ padding: '18px 0 8px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            <p style={{ margin: '0 0 10px', color: 'var(--text-primary)' }}>Nothing in the compare set yet.</p>
            <p style={{ margin: 0 }}>
              Use <strong>＋ Compare</strong> on a study card or in the explorer topbar to add studies or
              individual macaque populations. Then compare a gene or pathway across them.
            </p>
            {onOpenLibrary && (
              <button type="button" onClick={onOpenLibrary}
                style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                Browse the dataset library →
              </button>
            )}
          </div>
        ) : (
          groups.map(({ category, rows }) => (
            <section key={category} style={{ marginTop: 12 }}>
              <div style={{ ...eyebrow, marginBottom: 4 }}>{category}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map(({ item, dataset }) => {
                  const nonDefault = item.trackId !== dataset.defaultTrack;
                  const name = nonDefault ? `${dataset.name} ${item.trackId}` : dataset.name;
                  return (
                    <li key={`${item.datasetId}:${item.trackId}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                          {dataset.name}
                          {nonDefault && (
                            <span style={{ marginLeft: 8, fontFamily: FONT_MONO, fontWeight: 500, fontSize: 11.5, color: 'var(--text-mono)' }}>
                              {item.trackId}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          <span style={{ fontStyle: 'italic' }}>{dataset.organism}</span>
                          <span aria-hidden="true"> · </span>
                          <span style={{ fontFamily: FONT_MONO }}>{contrastLabel(getActiveContrast(dataset))}</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeItem(item)}
                        aria-label={`Remove ${name} from compare set`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'var(--text-muted)', padding: '0 4px' }}>
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-app)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn--ghost" disabled={n === 0} onClick={clear}>
          Clear
        </button>
        <span style={{ flex: 1, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 11, color: 'var(--text-muted)' }}>
          {n < 2 ? 'Add at least two' : `${n} of ${COMPARE_SET_MAX}`}
        </span>
        <button type="button" className="btn btn--primary" disabled={n < 2} onClick={() => onCompare(items)}>
          Compare <span style={{ fontFamily: FONT_MONO }}>{n}</span> →
        </button>
      </div>
    </Modal>
  );
}
