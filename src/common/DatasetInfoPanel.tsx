// Full dataset-metadata panel — the "see/access all metadata" affordance reached
// from the explorer hero's ⓘ button. Read-only.
//
// The record itself is StudyFactTable. This file is the modal frame around it
// plus the cross-links into the deeper provenance surfaces, and it decides
// nothing about what a study fact looks like. It used to: it hand-rolled its own
// two-column table and its own ExtLink/LinkChip/Row helpers, byte-for-byte
// copies of the shared module's, which is how it ended up still rendering the
// flat, headerless, hard-150px version of a record the library drawer had
// already moved past.
//
// What it does still own is the CONTRAST. The explorer passes whichever one the
// user currently has selected, and both the arms and the per-group counts are
// resolved against it rather than against the dataset's default — otherwise the
// modal would name the selected arms and then print the default's numbers
// beside them.

import { Modal } from './Modal';
import { StudyFactTable, factsFromMeta, groupCountsFromMeta } from './StudyMetadata';
import { getActiveContrast } from '../data/contrasts';
import { TRACKER_REVERSE_INDEX } from '../data/tracker/reverseIndex.generated.js';
import type { Dataset, DatasetMeta, ResolvedContrast } from '../types';

interface DatasetInfoPanelProps {
  dataset: Dataset;
  meta?: DatasetMeta | null;
  contrasts?: ResolvedContrast[];
  /** The contrast currently active in the explorer; its baseline/case decide which group gets which replicate count. */
  activeContrast?: ResolvedContrast | null;
  onClose: () => void;
  onOpenDataSources?: () => void;
  onOpenTracker?: (acc?: string) => void;
}

export function DatasetInfoPanel({
  dataset, meta, contrasts = [], activeContrast, onClose, onOpenDataSources, onOpenTracker,
}: DatasetInfoPanelProps) {
  const trackerAcc = (TRACKER_REVERSE_INDEX as Record<string, string>)[dataset.id];
  // The no-activeContrast fallback defers to getActiveContrast rather than
  // taking contrasts[0], because those two answers differ whenever `isDefault`
  // is not on the FIRST contrast — and then the arms land on the wrong groups.
  // Latent until GSE135639's default moved off its first contrast, at which
  // point this labelled the P0 cells with the pooled 8/9. Callers that do pass
  // activeContrast (the explorer does) were never affected.
  const armContrast = activeContrast ?? getActiveContrast(dataset);

  return (
    <Modal title={dataset.name} onClose={onClose} width="min(620px, 96vw)" height="auto">
      <div style={{ padding: '14px 16px 18px' }}>
        {/* showLinks, so the external-identifier chips live in the record's own
            Source band instead of floating above it — which is also what lets
            the table drop the Accession row it would otherwise repeat. */}
        <StudyFactTable
          dataset={dataset}
          facts={factsFromMeta(dataset, meta, armContrast)}
          baselineGroup={armContrast?.baseline ?? null}
          caseGroup={armContrast?.caseGroup ?? null}
          contrasts={contrasts}
          groupCounts={groupCountsFromMeta(dataset, meta, armContrast)}
          showLinks
        />

        {/* Cross-links into the deeper provenance surfaces */}
        {(onOpenDataSources || (onOpenTracker && trackerAcc)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            {onOpenDataSources && (
              <button type="button" onClick={onOpenDataSources}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-selected)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                Data Sources &amp; methods →
              </button>
            )}
            {onOpenTracker && trackerAcc && (
              <button type="button" onClick={() => onOpenTracker(trackerAcc)}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-selected)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                View in dataset tracker →
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
