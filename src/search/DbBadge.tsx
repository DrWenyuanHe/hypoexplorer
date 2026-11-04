// The pathway collection a result comes from: a dot in the collection's hue
// (DESIGN.md's pathway-source palette) and a short label in ink, so the hue
// tags the source without carrying small coloured text that fails contrast.

import type { PathwayDb } from './searchTypes';

const DB_VAR: Record<PathwayDb, string> = {
  GO_BP: 'var(--db-gobp)',
  HALLMARK: 'var(--db-hallmark)',
  KEGG: 'var(--db-kegg)',
  REACTOME: 'var(--db-reactome)',
  OTHER: 'var(--text-muted)',
};

export function DbBadge({ db, label }: { db: PathwayDb; label: string }) {
  return (
    <span className="db-badge" data-db={db}>
      <span className="db-badge-dot" aria-hidden="true" style={{ background: DB_VAR[db] ?? DB_VAR.OTHER }} />
      {label}
    </span>
  );
}
