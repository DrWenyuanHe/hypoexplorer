/**
 * Locations of the R 4.6.0 internal-QC successor evidence (September 25, 2026).
 *
 * The regeneration replaced every bulk DE table and the macaque atlas outputs.
 * The September 5 evidence in data/internal-qc/advancement-2026-09-05 describes
 * the replaced tables and stays byte-identical; its successors live here and are
 * written by scripts/advance_internal_qc_r460.mts, scripts/advance_internal_dedicated_r460.mts
 * and scripts/audit_macaque_internal_qc_r460.mts.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const R460_FOLDER = 'data/internal-qc/advancement-r460-2026-09-25';
export const R460_NORMALIZATION = `${R460_FOLDER}/normalization-evidence.json`;
export const R460_DEDICATED = `${R460_FOLDER}/dedicated-evidence.json`;
export const R460_ATLAS = `${R460_FOLDER}/macaque/atlas-evidence.json`;
export const R460_NORMALIZATION_SCRIPT = 'scripts/audit_internal_normalization_r460.R';
export const R460_DEDICATED_SCRIPT = 'scripts/audit_internal_dedicated_r460.R';

/**
 * Every file a normalization replay of one configured DE table reads, in a fixed
 * order: the configured input and sample sheet, the table, and the table's own
 * feature-map, provenance and (for count inputs) CPM-normalization sidecars.
 */
export function r460ReplayFiles(root: string, config: Record<string, string>, table: string): Record<string, string> {
  const stem = table.replace(/_DE\.tsv$/, '');
  const files: Record<string, string> = {
    input: `geo_replication/${config.input_path}`,
    sheet: `geo_replication/${config.samplesheet}`,
    table,
    featureMap: `${stem}_feature_map.tsv.gz`,
    provenance: `${stem}_provenance.tsv`,
  };
  if (config.input_kind === 'counts' && existsSync(resolve(root, `${stem}_cpm_normalization.tsv`))) files.cpmNormalization = `${stem}_cpm_normalization.tsv`;
  return files;
}

/** The producer hashes its Windows output (CRLF); the repository stores LF. Either rendering matches. */
export function provenanceHashMatches(bytes: Buffer, recorded: string | undefined): boolean {
  if (!recorded) return false;
  const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  if (sha(bytes) === recorded) return true;
  const text = bytes.toString('latin1');
  if (text.includes('\r')) return sha(Buffer.from(text.replace(/\r\n/g, '\n'), 'latin1')) === recorded;
  return sha(Buffer.from(text.replace(/\n/g, '\r\n'), 'latin1')) === recorded;
}
