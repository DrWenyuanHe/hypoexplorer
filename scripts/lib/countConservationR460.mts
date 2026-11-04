/**
 * Count conservation for the inputs the R 4.6.0 regeneration re-prepared
 * (scripts/audit_count_conservation_r460.py). For these datasets it replaces the
 * September 5 source-count, recovered-source and recovered-conservation readers,
 * whose evidence describes the replaced, rounded inputs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QualityCheck } from '../../src/data/qualityChecks';
import { conservationFingerprint } from './countConservationEvidence.mjs';
import { approximatelyEqual, parseTsv, type EvidenceRow, type MatrixMeasurement } from './internalQc.mjs';

export const CONSERVATION_R460_EVIDENCE = 'data/internal-qc/conservation-r460-2026-09-25/conservation-evidence.json';
const SCRIPT = 'scripts/audit_count_conservation_r460.py';
interface Pin { path: string; sha256: string; bytes: number; scheme: 'utf8-crlf-to-lf' | 'exact-bytes' }
interface Sample {
  sample: string; source_rows: number; output_rows: number; excluded_rows: number; source_library_size: number; excluded_count_sum: number;
  output_library_size: number; count_conservation_delta: number; maximum_retained_count_delta: number; mismatching_retained_cells: number;
  status: string; original_source_library_size?: number; source_aggregation_delta?: number;
}
interface RecordEntry {
  datasetId: string; configId: string; config?: EvidenceRow; inputPath?: string; samplesheetPath?: string; status: string; blocker?: string;
  specification?: { source: string; note: string; mapping?: string }; pins?: Pin[]; samples?: Sample[]; comparedCells?: number;
}
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

export function createR460ConservationReader(root: string, options: { readBytes?: (absolutePath: string) => Buffer; fingerprint?: (absolutePath: string) => string } = {}) {
  const read = options.readBytes ?? ((path: string) => readFileSync(path));
  let document: { version: string; script: Pin; sealedHelpers: Pin; records: RecordEntry[] } | null | undefined;
  const pinCurrent = (p: Pin): boolean => {
    const path = resolve(root, p.path);
    const actual = conservationFingerprint(read(path), p.scheme);
    options.fingerprint?.(path);
    return actual.sha256 === p.sha256 && actual.bytes === p.bytes;
  };
  return {
    covers(datasetId: string): boolean {
      if (document === undefined) {
        try {
          options.fingerprint?.(resolve(root, CONSERVATION_R460_EVIDENCE));
          document = JSON.parse(read(resolve(root, CONSERVATION_R460_EVIDENCE)).toString('utf8'));
        } catch { document = null; }
      }
      return !!document?.records?.some((record) => record.datasetId === datasetId);
    },
    evaluate(request: { datasetId: string; config: EvidenceRow; currentInputPath: string; matrix: Pick<MatrixMeasurement, 'rows' | 'samples' | 'sums'>; previous?: QualityCheck }): QualityCheck {
      const evidence = [CONSERVATION_R460_EVIDENCE];
      const result = (status: QualityCheck['status'], note: string): QualityCheck => ({
        id: 'count_conservation', label: 'Count conservation', required: true,
        status: request.previous?.status === 'fail' ? 'fail' : status,
        note: request.previous?.status === 'fail' ? `${request.previous.note} New source accounting cannot override an existing failure. ${note}` : note,
        evidence: [...new Set([...evidence, ...(document?.records.find((r) => r.datasetId === request.datasetId)?.pins ?? []).map((p) => p.path)])],
      });
      try {
        if (!this.covers(request.datasetId) || !document) throw new Error('no R 4.6.0 conservation record');
        if (document.version !== 'source-count-reconciliation-r460-v1' || document.script?.path !== SCRIPT || !pinCurrent(document.script) || !pinCurrent(document.sealedHelpers)) throw new Error('producer changed');
        const record = document.records.find((r) => r.datasetId === request.datasetId)!;
        if (record.status === 'not_assessed') return result('not_assessed', record.blocker ?? 'The re-prepared input could not be reconciled with its source.');
        if (!record.config || !same(record.config, request.config) || record.inputPath !== request.currentInputPath
          || record.samplesheetPath !== `geo_replication/${request.config.samplesheet}`) throw new Error('configuration or input binding changed');
        const current = parseTsv(read(resolve(root, 'geo_replication/config/datasets.tsv')).toString('utf8')).filter((row) => row.id === request.config.id);
        options.fingerprint?.(resolve(root, 'geo_replication/config/datasets.tsv'));
        if (current.length !== 1 || !same(current[0], request.config)) throw new Error('configuration is not the registered one');
        const pins = record.pins ?? [];
        if (!pins.some((p) => p.path === request.currentInputPath) || !pins.some((p) => p.path === record.specification?.source)) throw new Error('source or input pin absent');
        const stale = pins.filter((p) => !pinCurrent(p)).map((p) => p.path);
        if (stale.length) throw new Error(`stale pins: ${stale.join(', ')}`);
        const samples = record.samples ?? [];
        const names = samples.map((row) => row.sample);
        if (names.length !== request.matrix.samples.length || new Set(names).size !== names.length || !request.matrix.samples.every((s) => names.includes(s))
          || record.comparedCells !== names.length * request.matrix.rows) throw new Error('every current sample and input row must be covered exactly once');
        let discrepancy = false;
        for (const row of samples) {
          if (row.output_rows !== request.matrix.rows || !near(row.output_library_size + row.excluded_count_sum - row.source_library_size, row.count_conservation_delta)) throw new Error('recorded count accounting does not balance');
          const pass = near(row.count_conservation_delta, 0) && row.maximum_retained_count_delta <= 1e-6 && row.mismatching_retained_cells === 0
            && (row.source_aggregation_delta === undefined || near(row.source_aggregation_delta, 0));
          if (row.status !== (pass ? 'pass' : 'review')) throw new Error('saved sample status contradicts its measurements');
          discrepancy ||= !pass || !approximatelyEqual(request.matrix.sums[row.sample], row.output_library_size);
        }
        return result(discrepancy ? 'review' : 'pass', `${record.comparedCells!.toLocaleString('en-US')} registered count values across all ${names.length} selected libraries were compared with the deposited source after the R 4.6.0 re-preparation, which keeps count estimates unrounded. ${record.specification?.mapping ? `${record.specification.mapping}. ` : ''}${record.specification?.note ?? ''}${discrepancy ? ' A measured source/input discrepancy remains.' : ''}`);
      } catch (error) {
        return result('not_assessed', `R 4.6.0 source-count evidence is unavailable or stale: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
