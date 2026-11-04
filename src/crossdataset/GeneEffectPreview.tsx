import type { ReactNode } from 'react';
import { EffectPreview } from './EffectPreview';
import { useTrackColumn, type TrackColumnPolicy } from '../data/trackColumns';
import { resolveGeneCI } from '../compare/resolveGene';
import { getGroupedValues } from '../utils/sampleValues';
import { fmtSigned } from '../utils/format';
import { BarSEMChart } from '../gene-explorer/BarSEMChart';
import type { Dataset, ResolvedContrast, TrackRow } from '../types';

interface PreviewProps {
  gene: string;
  dataset: Dataset;
  track: TrackRow;
  contrast: ResolvedContrast | null;
}

// Gene-level only: no pathway sibling, and no meta.js either — the track id
// comes from the report's own row for this dataset, and nothing drawn here
// reads the dataset's meta (it used to borrow the whole explorer store, whose
// meta effect fetched it anyway).
const PREVIEW_POLICY: TrackColumnPolicy = { pathways: 'omit', trackList: 'trust' };

// Mounted only while requested. Loading uses the same track, contrast, symbol
// resolution and sample-value readers as the full explorer, with no QC/pathways.
function ExpressionPreview({ gene, dataset, track, contrast }: PreviewProps) {
  const column = useTrackColumn({ dataset, trackId: track.trackId, contrast }, PREVIEW_POLICY);
  const { popData } = column;
  const record = resolveGeneCI(popData, gene);
  const hasValues = popData && record && getGroupedValues(popData, record.gene, contrast).some((group) => group.n > 0);

  if (column.status === 'failed' || column.status === 'unknown-track') return <div role="status">Expression could not be loaded. <button type="button" onClick={column.retry}>Retry</button></div>;
  if (column.status === 'loading') return <div role="status" className="report-preview-empty">Loading expression…</div>;
  if (!popData || !record || !hasValues) return <div className="report-preview-empty">Sample expression is not available for this gene and comparison.</div>;
  return <BarSEMChart gene={record.gene} popData={popData} contrast={contrast} />;
}

export function GeneEffectPreview({ children, ...props }: PreviewProps & { children: ReactNode }) {
  return <EffectPreview
    label={`Preview ${props.gene} expression in ${props.dataset.name}, ${props.track.label}; log2 fold change ${fmtSigned(props.track.logFC, 2)}`}
    previewLabel={`${props.gene} expression preview`} closeLabel="Close expression preview"
    heading={props.dataset.name} subheading={props.track.label}
    content={<ExpressionPreview {...props} />}
    caption="Bars show group means with SEM; dots show individual samples.">
    {children}
  </EffectPreview>;
}
