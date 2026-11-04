import type { ReactNode } from 'react';
import { EffectPreview } from './EffectPreview';
import { useTrackColumn, type TrackColumnPolicy } from '../data/trackColumns';
import { RunningScorePlot } from '../pathway-explorer/RunningScorePlot';
import { fmtSigned } from '../utils/format';
import type { Dataset, PathwayTrackRow, ResolvedContrast } from '../types';

interface PreviewProps {
  pathway: string;
  dataset: Dataset;
  track: PathwayTrackRow;
  contrast: ResolvedContrast | null;
}

// The pathway sibling is the point here, so it is included and waited for. The
// track list is trusted: the track id comes from the report's own row for this
// dataset, so a meta.js request would confirm what the row already says.
const PREVIEW_POLICY: TrackColumnPolicy = { pathways: 'include', trackList: 'trust' };

// The column reads popData at the REPORT's comparison — a column's contrast is
// whatever its request says, so there is no default contrast to override.
// Retry restarts the column, which also re-asks for a sibling that failed.
function EnrichmentPreview({ pathway, dataset, track, contrast }: PreviewProps) {
  const column = useTrackColumn({ dataset, trackId: track.trackId, contrast }, PREVIEW_POLICY);
  if (column.status === 'loading' || !column.pathwaysSettled) return <div role="status" className="report-preview-empty">Loading enrichment…</div>;
  if (column.status !== 'ready') return <div role="status" className="report-preview-empty">Enrichment could not be loaded. <button type="button" onClick={column.retry}>Retry</button></div>;

  const { popData } = column;
  const record = popData?.allPathways.find((row) => row.db === track.db && row.pathway.toUpperCase() === pathway.toUpperCase());
  const hasRanks = record?.leadingEdge?.some((gene) => Number.isFinite(popData?.deByGene[gene]?.rank_score) && Math.abs(popData?.deByGene[gene]?.rank_score ?? 0) > 0);
  if (!popData || !record || !hasRanks) return <div className="report-preview-empty">An enrichment preview is not available for this pathway and comparison. <button type="button" onClick={column.retry}>Retry</button></div>;
  return <RunningScorePlot pathway={record} popData={popData} />;
}

export function PathwayEffectPreview({ children, ...props }: PreviewProps & { children: ReactNode }) {
  return <EffectPreview
    label={`Preview ${props.pathway} enrichment in ${props.dataset.name}, ${props.track.label}; NES ${fmtSigned(props.track.NES, 2)}`}
    previewLabel={`${props.pathway} enrichment preview`} closeLabel="Close enrichment preview"
    heading={props.dataset.name} subheading={`${props.track.label} · ${props.track.db}`}
    width={540}
    content={<EnrichmentPreview {...props} />}>
    {children}
  </EffectPreview>;
}
