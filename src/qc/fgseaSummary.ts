// FGSEA summary aggregation for the QC tab.
//
// The per-cluster FGSEA summary arrives as one row per (cluster, collection,
// pathway); the QC table shows one row per cluster with, per collection, how
// many pathways passed FDR 0.05 and FDR 0.25. This is that fold — pure, so it
// is testable without mounting the tab.
//
// The four collections are hardcoded because the TABLE's columns are: the QC
// table names Hallmark / KEGG / GO_BP / Reactome explicitly, and a collection
// nobody has a column for is counted nowhere. `go_bp` is an accepted alias of
// `gobp` — the two spellings both occur upstream (the pipeline writes the
// underscored form, older summaries the bare one) and must land in one column.

/** One raw FGSEA summary row. Loosely shaped, like the QcGlobal blob it lives in. */
export interface FgseaSummaryRecord {
  cluster: string;
  cluster_label?: string;
  collection?: string;
  padj?: number;
  [key: string]: unknown;
}

/** One aggregated table row: per-collection counts at both FDR thresholds. */
export type FgseaAggregateRow = {
  _key: string;
  cluster: string;
  label: string | undefined;
  hallmark_005: number;
  kegg_005: number;
  gobp_005: number;
  reactome_005: number;
  hallmark_025: number;
  kegg_025: number;
  gobp_025: number;
  reactome_025: number;
};

/**
 * Fold per-(cluster, collection, pathway) FGSEA rows into one row per cluster,
 * counting the pathways under each FDR threshold per collection. Clusters keep
 * first-seen order; `label` comes from the first row seen for the cluster.
 */
export function aggregateFgseaSummary(rows: FgseaSummaryRecord[]): FgseaAggregateRow[] {
  const byPop = new Map<string, FgseaAggregateRow>();
  for (const r of rows) {
    const pid = r.cluster;
    if (!byPop.has(pid)) byPop.set(pid, {
      _key: pid, cluster: pid, label: r.cluster_label,
      hallmark_005: 0, kegg_005: 0, gobp_005: 0, reactome_005: 0,
      hallmark_025: 0, kegg_025: 0, gobp_025: 0, reactome_025: 0,
    });
    const row = byPop.get(pid) as FgseaAggregateRow;
    const coll = (r.collection || '').toLowerCase();
    const padj = r.padj as number;
    if (coll === 'hallmark') { if (padj < 0.05) row.hallmark_005++; if (padj < 0.25) row.hallmark_025++; }
    if (coll === 'kegg') { if (padj < 0.05) row.kegg_005++; if (padj < 0.25) row.kegg_025++; }
    if (coll === 'gobp' || coll === 'go_bp') { if (padj < 0.05) row.gobp_005++; if (padj < 0.25) row.gobp_025++; }
    if (coll === 'reactome') { if (padj < 0.05) row.reactome_005++; if (padj < 0.25) row.reactome_025++; }
  }
  return [...byPop.values()];
}
