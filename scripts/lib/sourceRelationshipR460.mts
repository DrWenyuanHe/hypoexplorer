/**
 * Source integrity for the datasets whose source relationship the R 4.6.0
 * regeneration broke by replacing a file the sealed September reader pins
 * (scripts/audit_source_relationship_r460.mts). For these datasets it replaces
 * the September 5 and 11 source-relationship readers in scripts/build_internal_qc_r460.mts.
 *
 * The evidence is current only while its producer and this reader are unchanged,
 * it was written against the pinned supersession manifest, the registered input
 * is the one it describes, and every file it pins (sealed evidence, authenticated
 * sources, regenerated inputs and outputs, successor evidence) still has the
 * recorded fingerprint. Otherwise the check is not assessed.
 */
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { QualityCheck } from '../../src/data/qualityChecks';
import { SUPERSESSION_SHA256 } from './historicalEvidence.mjs';

export const SOURCE_RELATIONSHIP_R460 = 'data/internal-qc/advancement-r460-2026-09-25/source-relationship-evidence.json';
export const SOURCE_RELATIONSHIP_R460_SCRIPT = 'scripts/audit_source_relationship_r460.mts';
export const SOURCE_RELATIONSHIP_R460_READER = 'scripts/lib/sourceRelationshipR460.mts';
export const SOURCE_RELATIONSHIP_R460_VERSION = 'source-relationship-r460-v1';
export type PinScheme = 'utf8-crlf-to-lf' | 'exact-bytes';
export interface EvidencePin { path: string; sha256: string; bytes: number; scheme: PinScheme }
export interface SuccessorLink {
  path: string; oldSha256: string; newSha256: string;
  successor: 'line_endings_only' | 'r460_count_conservation' | 'r460_dedicated_replay' | 'none'; successorEvidence: string | null; status: 'pass' | 'not_assessed'; note: string;
}
export interface SourceRelationshipRecord {
  datasetId: string; accession: string; configId: string | null; inputPath: string | null;
  sealedReader: string; historical: { status: string; sourceAuthentication: string; derivedInputRelationship: string; note: string };
  superseded: SuccessorLink[]; status: 'pass' | 'fail' | 'not_assessed'; note: string; pins: EvidencePin[];
  unavailable?: string[];
}
export interface SourceRelationshipDocument {
  schemaVersion: 1; version: string; record: string; script: EvidencePin; reader: EvidencePin; supersessionSha256: string | null;
  records: SourceRelationshipRecord[];
}

const TEXT = /\.(?:ts|tsx|mts|js|json|csv|tsv|txt|xml|md|r|py|soft)$/i;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Keep an early unavailable historical reader distinct from a verified chain. */
export function sourceRelationshipAvailability(root: string,
  result: { status: string; sourceAuthentication: string; derivedInputRelationship: string; note: string; evidence?: string[]; missingPaths?: string[] },
  served: readonly string[], touched: Iterable<string>, available: (path: string) => boolean = existsSync) {
  const historicalPass = result.status === 'pass' && result.sourceAuthentication === 'pass' && result.derivedInputRelationship === 'pass';
  // A reader can reject a pin before its fingerprint callback runs. Accept
  // only its complete known terminal error form (including spaces), or a
  // complete quoted Node filesystem path. Ordinary prose is never an inventory.
  const failure = /(?:File pin changed or is missing|Changed or missing evidence|Changed evidence|Missing evidence): ((?:data|geo_replication|scripts|public)\/[\S ]+)$/.exec(result.note);
  const filesystem = /(?:open|stat|lstat|access) ['"]([^'"\r\n]+)['"]$/.exec(result.note);
  const mentioned = failure ? [failure[1]] : filesystem ? [filesystem[1]] : [];
  const bounded = (path: string) => {
    assert.ok(typeof path === 'string' && path && !/[\r\n\0]/.test(path)
      && !path.replaceAll('\\', '/').split('/').includes('..'), 'Source relationship reference escapes the workspace');
    const name = relative(resolve(root), resolve(root, path));
    assert.ok(name && name !== '..' && !name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(name),
      'Source relationship reference escapes the workspace');
    return name.replaceAll('\\', '/');
  };
  const references = [...new Set([...touched, ...(result.evidence ?? []), ...(result.missingPaths ?? []), ...mentioned].map(bounded))].sort();
  const unavailable = references.filter(path => !available(resolve(root, path)));
  assert.ok(!historicalPass || served.length > 0, 'A passing sealed relationship reads no replaced file; no successor is established');
  assert.ok(!historicalPass || unavailable.length === 0, 'A passing sealed relationship names unavailable evidence');
  const present = references.filter(path => available(resolve(root, path)));
  return { historicalPass, unavailable, available: present,
    authenticated: result.sourceAuthentication === 'pass' ? present : [] };
}
/** A checkout-independent pin: UTF-8 text with CRLF read as LF, other files as exact bytes. */
export function evidencePin(path: string, bytes: Buffer): EvidencePin {
  if (TEXT.test(path)) {
    try {
      const canonical = Buffer.from(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, '\n'), 'utf8');
      return { path, sha256: digest(canonical), bytes: canonical.length, scheme: 'utf8-crlf-to-lf' };
    } catch { /* Non-UTF8 text keeps exact bytes. */ }
  }
  return { path, sha256: digest(bytes), bytes: bytes.length, scheme: 'exact-bytes' };
}

export function createSourceRelationshipR460Reader(root: string, options: { readBytes?: (absolutePath: string) => Buffer; fingerprint?: (absolutePath: string) => string } = {}) {
  const read = options.readBytes ?? ((path: string) => readFileSync(path));
  let document: SourceRelationshipDocument | null | undefined;
  const load = (): SourceRelationshipDocument | null => {
    if (document === undefined) {
      try {
        options.fingerprint?.(resolve(root, SOURCE_RELATIONSHIP_R460));
        document = JSON.parse(read(resolve(root, SOURCE_RELATIONSHIP_R460)).toString('utf8'));
      } catch { document = null; }
    }
    return document ?? null;
  };
  const current = (pin: EvidencePin): boolean => {
    try {
      const path = resolve(root, pin.path);
      const actual = evidencePin(pin.path, read(path));
      options.fingerprint?.(path);
      return actual.scheme === pin.scheme && actual.sha256 === pin.sha256 && actual.bytes === pin.bytes;
    } catch { return false; }
  };
  return {
    covers(datasetId: string): boolean {
      return !!load()?.records?.some((record) => record.datasetId === datasetId);
    },
    evaluate(request: { datasetId: string; currentInputPath: string | null; previous?: QualityCheck }): QualityCheck {
      const saved = load();
      const record = saved?.records.find((row) => row.datasetId === request.datasetId);
      const evidence = [SOURCE_RELATIONSHIP_R460, ...(record?.pins ?? []).map((pin) => pin.path)];
      const result = (status: QualityCheck['status'], note: string): QualityCheck => ({
        id: 'source_integrity', label: 'Source file integrity', required: true,
        status: request.previous?.status === 'fail' ? 'fail' : status,
        note: request.previous?.status === 'fail' ? `${request.previous.note} New source evidence does not override that discrepancy. ${note}` : note,
        evidence: [...new Set([...(request.previous?.evidence ?? []), ...evidence])],
      });
      try {
        if (!saved || !record) throw new Error('no R 4.6.0 source-relationship record');
        if (saved.schemaVersion !== 1 || saved.version !== SOURCE_RELATIONSHIP_R460_VERSION || saved.script?.path !== SOURCE_RELATIONSHIP_R460_SCRIPT
          || saved.reader?.path !== SOURCE_RELATIONSHIP_R460_READER || !current(saved.script) || !current(saved.reader)) throw new Error('producer or reader changed');
        if (!saved.supersessionSha256 || saved.supersessionSha256 !== SUPERSESSION_SHA256) throw new Error('written against another supersession manifest');
        if (record.inputPath !== request.currentInputPath) throw new Error('registered input binding changed');
        if (record.unavailable?.length) throw new Error(`unavailable references: ${record.unavailable.join(', ')}`);
        const stale = record.pins.filter((pin) => !current(pin)).map((pin) => pin.path);
        if (stale.length) throw new Error(`stale pins: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ` and ${stale.length - 5} more` : ''}`);
        return result(record.status, record.note);
      } catch (error) {
        return result('not_assessed', `R 4.6.0 source-relationship evidence is unavailable or stale: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
