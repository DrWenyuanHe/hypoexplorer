// How an export's provenance snapshot is laid out: the CSV columns appended
// after a file's scientific columns, and the workbook's Metadata sheet.
//
// Kept apart from exportProvenance.ts, which BUILDS the snapshot and reads the
// internal QC ledger to do so. These formatters only read a finished snapshot,
// so csv.ts (and every view that can write a CSV, the search page among them)
// can import them without downloading that ~4 MB ledger chunk. The type import
// below is erased at build time and adds no runtime edge.

import type { AtlasProvenance, ExportProvenance } from './exportProvenance';
import type { WorkbookRow, WorkbookSheet } from './workbook';

interface ContrastRecord { id: string; direction: string }

interface TrackRecord {
  dataset: { id: string | null; accession: string | null };
  track: { id: string | null };
  contrasts: string | ContrastRecord[];
  expression: { unit: string };
}

/**
 * The provenance columns the CSV seam (utils/csv.ts) appends after a file's
 * scientific columns, in this order. A columns subject joins one value per
 * column with ' | ', in column order. A HypoMap atlas file has no dataset,
 * track or contrast; its columns name the pinned atlas release instead.
 */
export function provenanceColumns(metadata: ExportProvenance | AtlasProvenance): WorkbookRow {
  if ('atlas' in metadata) {
    return {
      AtlasRelease: metadata.atlas.releaseTag,
      AtlasManifestSHA256: metadata.atlas.manifestSha256,
      ExpressionUnit: metadata.expression.unit,
      ExportMetadataJSON: JSON.stringify(metadata),
    };
  }
  const tracks: TrackRecord[] = 'columns' in metadata ? metadata.columns : [metadata];
  const value = (read: (track: TrackRecord) => string | null) =>
    (tracks.length === 1 ? read(tracks[0]) : tracks.map(read).join(' | '));
  const contrasts = (track: TrackRecord, spell: (contrast: ContrastRecord) => string) =>
    (typeof track.contrasts === 'string' ? 'Not applicable' : track.contrasts.map(spell).join(' | '));
  return {
    DatasetID: value((track) => track.dataset.id),
    SourceAccession: value((track) => track.dataset.accession),
    TrackID: value((track) => track.track.id),
    ContrastID: value((track) => contrasts(track, (contrast) => contrast.id)),
    ContrastDirection: value((track) => contrasts(track, (contrast) => `${contrast.id}: ${contrast.direction}`)),
    ExpressionUnit: value((track) => track.expression.unit),
    ExportMetadataJSON: JSON.stringify(metadata),
  };
}

export function provenanceRows(metadata: ExportProvenance): WorkbookRow[] {
  // One field per row makes the sheet readable and avoids Excel's per-cell
  // text limit when a factorial design carries many evidence records.
  const rows: WorkbookRow[] = [];
  const append = (Field: string, value: unknown): void => {
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length) {
        for (const [key, item] of entries) append(Field ? `${Field}.${key}` : key, item);
      } else rows.push({ Field, Value: Array.isArray(value) ? '[]' : '{}' });
    } else rows.push({ Field, Value: value == null ? 'Unrecorded' : String(value) });
  };
  append('', metadata);
  return rows;
}

/** The Metadata sheet every provenance-carrying workbook ends with. */
export function metadataSheet(metadata: ExportProvenance): WorkbookSheet {
  return { name: 'Metadata', rows: provenanceRows(metadata) };
}
