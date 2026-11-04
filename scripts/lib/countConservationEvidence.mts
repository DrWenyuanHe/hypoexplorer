/** Validate independently remeasured source→registered-input count accounting. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { QualityCheck } from '../../src/data/qualityChecks';
import { parseTsv, type EvidenceRow, type MatrixMeasurement } from './internalQc.mjs';

export const CONSERVATION_EVIDENCE = 'data/internal-qc/conservation-2026-09-05/conservation-evidence.json';
const FOLDER = 'data/internal-qc/conservation-2026-09-05';
interface Pin { path: string; sha256: string; bytes: number; scheme: 'utf8-crlf-to-lf' | 'exact-bytes' }
interface Sample {
  sample: string; source_rows: number; output_rows: number; excluded_rows: number;
  source_library_size: number; excluded_count_sum: number; output_library_size: number;
  count_conservation_delta: number; maximum_retained_count_delta: number;
  mismatching_retained_cells: number; status: string;
  transformed_source_library_size?: number; declared_rounding_delta?: number;
  original_unadjusted_delta?: number; rounded_source_cells?: number;
  original_source_rows?: number; aggregated_source_rows?: number;
  original_source_library_size?: number; source_aggregation_delta?: number;
}
interface RecordEntry {
  datasetId: string; configId: string; config: EvidenceRow; inputPath: string; samplesheetPath: string;
  specification: { source: string; mode?: string; mapping?: string; authority?: string; series?: string; rounding?: string; note: string;
    accession?: string; sourceLogs?: string[]; preparationScript?: string };
  pins: Pin[]; samples: Sample[]; sourceColumns: { [sample: string]: string };
  sourceMembers?: { sample: string; member: string; sha256: string; bytes: number }[];
  sampleSourceMapping?: { sample: string; group: string; gsm: string; sourceFile: string; sourceCountColumn: string; sourceCountColumnIndex: number }[];
  sourceArchiveInventory?: string[];
  comparedCells: number; status: string; blocker?: string; roundingRuntime?: string;
}
interface Request {
  datasetId: string; config: EvidenceRow; currentInputPath: string;
  matrix: Pick<MatrixMeasurement, 'rows' | 'samples' | 'sums'>;
  previous?: QualityCheck;
}
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
  : value != null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sorted(val)])) : value;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const whole = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;

export function conservationFingerprint(bytes: Buffer, scheme: Pin['scheme']): { sha256: string; bytes: number } {
  const canonical = scheme === 'utf8-crlf-to-lf'
    ? Buffer.from(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, '\n'), 'utf8') : bytes;
  return { sha256: digest(canonical), bytes: canonical.length };
}

export function createCountConservationReader(root: string, options: {
  readBytes?: (absolutePath: string) => Buffer;
  fingerprint?: (absolutePath: string) => string;
} = {}): { evaluate(request: Request): QualityCheck & { checkedReferences: Pin[] } } {
  const read = options.readBytes ?? ((path: string) => readFileSync(path));
  const absolute = (path: string): string => {
    const target = resolve(root, path);
    if (!path || isAbsolute(path) || path.includes('\\') || relative(resolve(root), target).startsWith('..')) throw new Error('Invalid workspace-relative evidence path');
    return target;
  };
  return { evaluate(request) {
    const checked = new Map<string, Pin>();
    const references = [CONSERVATION_EVIDENCE];
    const result = (status: QualityCheck['status'], note: string): QualityCheck & { checkedReferences: Pin[] } => ({
      id: 'count_conservation', label: 'Count conservation', required: true,
      status: request.previous?.status === 'fail' ? 'fail' : status,
      note: request.previous?.status === 'fail' ? `${request.previous.note} New source accounting cannot override an existing failure. ${note}` : note,
      evidence: [...new Set([...(request.previous?.evidence ?? []), ...references, ...checked.keys()])],
      checkedReferences: [...checked.values()],
    });
    const pin = (p: Pin, expectedPath?: string): Buffer => {
      if (!p || (expectedPath && p.path !== expectedPath) || !/^[a-f0-9]{64}$/.test(p.sha256)
        || !whole(p.bytes) || !['utf8-crlf-to-lf', 'exact-bytes'].includes(p.scheme)) throw new Error('Invalid or substituted evidence pin');
      const text = ['.py', '.mts', '.json', '.tsv', '.md', '.R'].includes(extname(p.path));
      if (p.scheme !== (text ? 'utf8-crlf-to-lf' : 'exact-bytes')) throw new Error('Fingerprint convention changed');
      const path = absolute(p.path);
      const bytes = read(path);
      options.fingerprint?.(path); // Register in the central build fingerprint ledger.
      const actual = conservationFingerprint(bytes, p.scheme);
      if (actual.sha256 !== p.sha256 || actual.bytes !== p.bytes) throw new Error(`Missing or stale evidence: ${p.path}`);
      checked.set(p.path, p);
      return bytes;
    };
    try {
      options.fingerprint?.(absolute(CONSERVATION_EVIDENCE));
      const document = JSON.parse(read(absolute(CONSERVATION_EVIDENCE)).toString('utf8')) as {
        schemaVersion: number; version: string; fingerprintConvention: string;
        script: Pin; baseline: Pin; plan: Pin; records: RecordEntry[];
      };
      if (document.schemaVersion !== 1 || document.version !== 'source-count-reconciliation-v1'
        || document.fingerprintConvention !== 'sha256-exact-binary-or-utf8-crlf-to-lf-v1'
        || !Array.isArray(document.records)) throw new Error('Unsupported source count evidence schema');
      pin(document.script, 'scripts/audit_count_conservation.py');
      const baseline = JSON.parse(pin(document.baseline, `${FOLDER}/baseline.json`).toString('utf8')) as { datasetId: string; configId: string; input: string }[];
      const plan = JSON.parse(pin(document.plan, `${FOLDER}/specifications.json`).toString('utf8')) as { datasetId: string; configId: string; inputPath: string; specification: unknown }[];
      const unique = <T extends { datasetId: string }>(rows: T[]): T | undefined => {
        if (!Array.isArray(rows) || new Set(rows.map(r => r.datasetId)).size !== rows.length) throw new Error('Duplicate or malformed dataset evidence');
        return rows.find(row => row.datasetId === request.datasetId);
      };
      const record = unique(document.records);
      const planned = unique(plan);
      const prior = unique(baseline);
      if (!record || !planned || !prior) return result('not_assessed', 'No independent source-to-input conservation audit covers this dataset.');
      if (!same(record.specification ?? null, planned.specification ?? null) || record.configId !== request.config.id
        || planned.configId !== request.config.id || prior.configId !== request.config.id
        || planned.inputPath !== request.currentInputPath || prior.input !== request.currentInputPath) throw new Error('Dataset/source plan binding changed');
      if (record.status === 'not_assessed') return result('not_assessed', record.blocker ?? 'Source-to-input transformation remains unresolved.');
      if (!record.specification || !Array.isArray(record.pins) || !Array.isArray(record.samples)) throw new Error('Incomplete measured record');
      const expectedInput = `geo_replication/${request.config.input_path}`;
      const expectedSheet = `geo_replication/${request.config.samplesheet}`;
      if (request.config.input_kind !== 'counts' || !same(record.config, request.config)
        || request.currentInputPath !== expectedInput || record.inputPath !== expectedInput
        || record.samplesheetPath !== expectedSheet) throw new Error('Current config/input/samplesheet binding changed');
      const configPath = absolute('geo_replication/config/datasets.tsv');
      options.fingerprint?.(configPath);
      const currentConfigs = parseTsv(read(configPath).toString('utf8')).filter(row => row.id === request.config.id);
      if (currentConfigs.length !== 1 || !same(currentConfigs[0], request.config)) throw new Error('Provided config is not the current registered config');
      if (new Set(record.pins.map(p => p.path)).size !== record.pins.length) throw new Error('Duplicate evidence pins');
      for (const reference of record.pins) pin(reference);
      const required = [expectedInput, expectedSheet, ...['mapping', 'authority', 'series', 'downloadLog', 'downloadScript', 'preparationScript'].flatMap(key => {
        const path = (record.specification as Record<string, unknown>)[key]; return typeof path === 'string' ? [path] : [];
      })];
      const recovered = ['recovered-featurecounts', 'recovered-symbol-matrix'].includes(record.specification.mode ?? '');
      if (recovered) {
        const originals = [record.specification.source, ...(record.specification.series ? [record.specification.series] : [])];
        if (!Array.isArray(record.specification.sourceLogs) || !same(record.specification.sourceLogs, originals.map(path => `${path}.download.json`))) throw new Error('Recovered original source logs are incomplete');
        required.push(...record.specification.sourceLogs);
      }
      if (['sample-files', 'recovered-featurecounts'].includes(record.specification.mode ?? '')) {
        const members = record.sourceMembers;
        if (!members || members.length !== record.samples.length || new Set(members.map(m => m.sample)).size !== members.length
          || new Set(members.map(m => m.member)).size !== members.length || members.some(m => !m.member || m.member.includes('/') || m.member.includes('\\') || !/^[a-f0-9]{64}$/.test(m.sha256) || !whole(m.bytes))) throw new Error('Incomplete or ambiguous original sample files');
        required.push(...(record.specification.source.endsWith('/') ? members.map(m => record.specification.source + m.member) : [record.specification.source]));
        if (record.specification.source.endsWith('/')) {
          for (const member of members) {
            const sourcePin = checked.get(record.specification.source + member.member);
            if (!sourcePin || sourcePin.scheme !== 'exact-bytes' || sourcePin.sha256 !== member.sha256 || sourcePin.bytes !== member.bytes) throw new Error('Source member does not match its checked file pin');
          }
        }
      } else required.push(record.specification.source);
      if (record.specification.source === expectedInput || required.some(path => !checked.has(path))) throw new Error('Required original source/input/authority pin absent');
      const sheet = parseTsv(read(absolute(expectedSheet)).toString('utf8')).filter(row => ['control', 'case'].includes(row.group));
      const samples = sheet.map(row => row.sample);
      const setEqual = (a: string[], b: string[]): boolean => a.length > 0 && new Set(a).size === a.length && new Set(b).size === b.length && same([...a].sort(), [...b].sort());
      if (!setEqual(samples, request.matrix.samples) || !setEqual(samples, record.samples.map(row => row.sample))
        || !setEqual(samples, Object.keys(record.sourceColumns)) || !whole(request.matrix.rows) || request.matrix.rows === 0
        || record.comparedCells !== samples.length * request.matrix.rows) throw new Error('Every current sample and input row must be covered exactly once');
      if (record.sourceMembers && !setEqual(samples, record.sourceMembers.map(member => member.sample))) throw new Error('Source member/sample coverage changed');
      if (recovered) {
        const recoveredScopes: Record<string, { accession: string; samples: number; archive?: number; prep?: string }> = {
          GSE245727: { accession: 'GSE245727', samples: 12, archive: 23 },
          GSE254155: { accession: 'GSE254155', samples: 20, archive: 35 },
          GSE289833: { accession: 'GSE289833', samples: 6, archive: 12 },
          GSE201207_young_vs_old: { accession: 'GSE201207', samples: 24, prep: 'scripts/prep_GSE201207.R' },
          GSE314817_6v27mo: { accession: 'GSE314817', samples: 36, prep: 'scripts/prep_GSE314817.R' },
        };
        const scope = recoveredScopes[record.configId];
        if (!scope || scope.accession !== record.specification.accession || samples.length !== scope.samples
          || record.specification.mode !== (scope.archive ? 'recovered-featurecounts' : 'recovered-symbol-matrix')
          || record.specification.preparationScript !== scope.prep) throw new Error('Recovered source scope or original preparation binding changed');
        if (scope.archive) {
          const mapping = record.sampleSourceMapping;
          const inventory = record.sourceArchiveInventory;
          if (!mapping || !setEqual(samples, mapping.map(row => row.sample))
            || new Set(mapping.map(row => row.gsm)).size !== samples.length
            || !inventory || inventory.length !== scope.archive || new Set(inventory).size !== inventory.length
            || inventory.some(name => !name || name.includes('/') || name.includes('\\'))) throw new Error('Incomplete recovered archive inventory or sample mapping');
          for (const row of mapping) {
            const member = record.sourceMembers!.find(item => item.sample === row.sample);
            const currentSheet = sheet.find(item => item.sample === row.sample);
            if (!/^GSM[0-9]+$/.test(row.gsm) || row.group !== currentSheet?.group || !member
              || member.member !== row.sourceFile || !row.sourceFile.startsWith(`${row.gsm}_`) || !inventory.includes(row.sourceFile)
              || record.sourceColumns[row.sample] !== row.sourceFile || row.sourceCountColumnIndex !== 6
              || typeof row.sourceCountColumn !== 'string' || !row.sourceCountColumn.trim()) throw new Error('Recovered sample does not bind to one complete original count column');
          }
        }
      }
      if (record.specification.mode !== 'sample-files') {
        const columns = Object.values(record.sourceColumns);
        if (columns.some(column => typeof column !== 'string' || !column.trim()) || new Set(columns).size !== columns.length) throw new Error('Source columns must be nonempty and unique');
      }
      let discrepancy = false;
      const rounding = record.specification.rounding;
      const roundPrep: Record<string, string> = {
        GSE235479: 'prep_2026batch2.R', 'E-MTAB-6929': 'prep_2026batch2.R', GSE229838: 'prep_GSE229838.R',
      };
      const runtimeFormat = /^R version [0-9]+\.[0-9]+\.[0-9]+ \([0-9]{4}-[0-9]{2}-[0-9]{2}(?: [A-Za-z0-9.-]+)?\)\nround\(x\), digits=0; IEEE 60559 nearest with ties to even$/;
      if (rounding && (rounding !== 'R-round-digits0-ties-to-even' || !record.roundingRuntime || !runtimeFormat.test(record.roundingRuntime)
        || !checked.has('scripts/round_conservation_values.R')
        || !roundPrep[record.configId]
        || !checked.has(`${FOLDER}/preparation/${roundPrep[record.configId]}`))) throw new Error('Documented rounding code/runtime evidence absent');
      for (const row of record.samples) {
        if (![row.source_rows, row.output_rows, row.excluded_rows, row.mismatching_retained_cells].every(whole)
          || row.source_rows !== row.output_rows + row.excluded_rows || row.output_rows !== request.matrix.rows
          || ![row.source_library_size, row.excluded_count_sum, row.output_library_size, row.maximum_retained_count_delta].every(v => finite(v) && v >= 0)
          || !finite(row.count_conservation_delta) || !finite(request.matrix.sums[row.sample])) throw new Error('Missing or malformed complete count measurements');
        const correction = rounding ? row.declared_rounding_delta : 0;
        if (!finite(correction)) throw new Error('Missing declared signed rounding correction');
        if (rounding && (!finite(row.transformed_source_library_size) || !finite(row.original_unadjusted_delta)
          || !whole(row.rounded_source_cells) || row.rounded_source_cells > row.source_rows
          || !near(row.transformed_source_library_size - row.source_library_size, correction)
          || !near(row.output_library_size - row.source_library_size, row.original_unadjusted_delta))) throw new Error('Rounding accounting is incomplete or inconsistent');
        if (!near(row.output_library_size + row.excluded_count_sum - row.source_library_size - correction, row.count_conservation_delta)) throw new Error('Recorded count accounting does not balance');
        if (recovered && (!whole(row.original_source_rows) || !whole(row.aggregated_source_rows)
          || row.original_source_rows < row.source_rows || row.aggregated_source_rows !== row.source_rows
          || (record.specification.mode === 'recovered-featurecounts' && row.original_source_rows !== row.source_rows)
          || row.excluded_rows !== 0 || row.excluded_count_sum !== 0
          || !finite(row.original_source_library_size) || row.original_source_library_size < 0 || !finite(row.source_aggregation_delta)
          || !near(row.source_library_size - row.original_source_library_size, row.source_aggregation_delta))) throw new Error('Complete original-to-aggregated source accounting is absent or inconsistent');
        const pass = near(row.count_conservation_delta, 0) && row.maximum_retained_count_delta <= 1e-6 && row.mismatching_retained_cells === 0
          && (!recovered || near(row.source_aggregation_delta!, 0));
        if (row.status !== (pass ? 'pass' : 'review')) throw new Error('Saved sample status contradicts measured discrepancies');
        discrepancy ||= !pass || !near(request.matrix.sums[row.sample], row.output_library_size);
      }
      if (record.status !== (record.samples.every(s => s.status === 'pass') ? 'pass' : 'review')) throw new Error('Saved dataset status contradicts sample measurements');
      const changed = rounding ? record.samples.map(row => `${row.sample}: ${row.declared_rounding_delta! >= 0 ? '+' : ''}${row.declared_rounding_delta}`).join('; ') : '';
      return result(discrepancy ? 'review' : 'pass', `${record.comparedCells.toLocaleString('en-US')} retained count values across all ${samples.length} selected libraries were independently compared with the original source. ${rounding
        ? `Declared rounding reproduced with R; raw library totals change by ${changed}. These signed changes are explicitly accounted, not described as lossless preservation.`
        : 'All retained values and source library totals reconcile, with any excluded technical summary rows accounted separately.'} ${record.specification.note}${discrepancy ? ' A measured source/input discrepancy remains.' : ''}`);
    } catch (error) {
      return result('not_assessed', `Independent conservation evidence is unavailable or stale: ${error instanceof Error ? error.message : String(error)}`);
    }
  } };
}
