import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import type {AuthorValidationScopedComparison} from '../../src/data/authorValidation';
import {validateComparisonReview} from '../../src/data/authorComparability';
import {HISTORICAL_PINS, readSealedHistoricalInput, supersessionNames} from './historicalEvidence.mjs';

export const SCOPED_AUTHOR_PATH = 'data/author-validation/continuation-round2-2026-09-11/intake-author/GSE148252/scoped-comparisons.json';
export const SCOPED_AUTHOR_SEAL = '79b1d09331c36cc1fc9dd16d2780e6103be91df421c429e885d6d688380e0bda';
type Pin = {path: string; sha256: string; bytes: number};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const need = (ok: unknown, note: string) => { if (!ok) throw Error(`Scoped author evidence: ${note}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : value;
const semanticHash = (value: unknown) => hash(Buffer.from(JSON.stringify(ordered(value))));
const STUDY_SCOPE_SEAL = 'b07e5ec89c3108d7457a36c506b36f7091bceb19dc421ac45a7c5f9a69ed2a85';

/** Refuse to generate badges from stale sources, borrowed contexts or unreviewed metrics. */
export function readScopedAuthorEvidence(root: string, read: (path: string) => Buffer = readFileSync): Map<string, AuthorValidationScopedComparison[]> {
  const safe = (path: string) => {
    need(typeof path === 'string' && path.length && !isAbsolute(path) && !path.includes('\\'), 'Invalid relative evidence path');
    const absolute = resolve(root, path), rel = relative(root, absolute);
    need(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Evidence leaves workspace');
    return absolute;
  };
  const pinned = (pin: Pin) => {
    need(pin && /^[a-f0-9]{64}$/.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0, 'Invalid source identity');
    // A dependency the R 4.6.0 regeneration replaced resolves to its verified pre-regeneration bytes.
    const bytes = HISTORICAL_PINS.has(pin.path) || supersessionNames(root, pin.path)
      ? readSealedHistoricalInput(root, pin.path, pin.sha256, read) : read(safe(pin.path));
    need(bytes.length === pin.bytes && hash(bytes) === pin.sha256, `Changed dependency ${pin.path}`);
    return bytes;
  };
  const raw = read(safe(SCOPED_AUTHOR_PATH));
  need(hash(raw) === SCOPED_AUTHOR_SEAL, 'Reviewed artifact seal differs');
  const doc = JSON.parse(raw.toString('utf8')) as {schemaVersion: number; records: AuthorValidationScopedComparison[];
    measurementReferences: Pin[]; dependencyClosure: Pin[]};
  need(doc.schemaVersion === 1 && doc.records.length === 4 && doc.measurementReferences.length === 4, 'Unexpected comparison scope');
  need(new Set(doc.dependencyClosure.map(pin => pin.path)).size === doc.dependencyClosure.length, 'Duplicate dependency');
  const closure = new Map(doc.dependencyClosure.map(pin => [pin.path, pin]));
  for (const pin of doc.dependencyClosure) pinned(pin);
  const studies = JSON.parse(read(safe('data/intake/september5-2026/studies.json')).toString('utf8')) as Array<{
    id: string; dir: string; organism: string; groups: unknown; tracks: Array<{id: string; matrix: string; samplesheet: string}>; contrasts: Array<{id: string}>}>;
  const study = studies.find(row => row.id === 'gse148252');
  need(study && study.tracks.length === 1 && study.tracks[0].id === 'hypothalamus', 'Registered track scope changed');
  need(semanticHash({id: study!.id, dir: study!.dir, organism: study!.organism, groups: study!.groups,
    tracks: study!.tracks, contrasts: study!.contrasts}) === STUDY_SCOPE_SEAL, 'Registered groups, arms or input scope changed');
  const analyses = JSON.parse(read(safe('data/intake/september5-2026/analyses.json')).toString('utf8')) as Array<{
    studyId: string; track: string; contrast: string; analysisId: string; deSha256: string; sourceSha256: string}>;
  const expected = analyses.filter(row => row.studyId === 'gse148252');
  need(semanticHash(expected) === '5417660657f7441328295f4aca880255c6b7f7ab058a12e171608d185ba0092a', 'Registered analysis inputs or membership changed');
  need(expected.every(row => row.sourceSha256 === 'a8bcb5d36376097e5a041f900385960d6edfd4b6a75c6b2805bfffb9609357b1')
    && hash(read(safe(study!.tracks[0].matrix))) === 'a8bcb5d36376097e5a041f900385960d6edfd4b6a75c6b2805bfffb9609357b1', 'Registered source matrix differs');
  const expectedKeys = expected.map(row => `${row.track}/${row.contrast}/${row.analysisId}`);
  need(expected.length === 4 && new Set(expectedKeys).size === 4 && study!.contrasts.length === 4
    && new Set(study!.contrasts.map(row => row.id)).size === 4
    && expected.every(row => study!.contrasts.some(c => c.id === row.contrast)), 'Registered comparison scope changed');
  const actualKeys = doc.records.map(row => `${row.trackId}/${row.contrastId}/${row.configId}`);
  need(new Set(actualKeys).size === 4 && expectedKeys.every(key => actualKeys.includes(key)), 'Borrowed or missing registered context');
  const configText = pinned(closure.get('geo_replication/config/datasets.tsv')!).toString('utf8').trim().split(/\r?\n/);
  const columns = configText.shift()!.split('\t');
  const configs = configText.map(line => Object.fromEntries(line.split('\t').map((value, i) => [columns[i], value])));
  need(new Set(doc.records.map(row => row.comparison.evidenceFingerprint)).size === 4
    && new Set(doc.records.map(row => row.localReference.path)).size === 4, 'Reused measured result');
  for (const row of doc.records) {
    need(row.datasetId === 'gse148252' && row.comparison.contrast === row.contrastId, 'Borrowed dataset or comparison');
    validateComparisonReview(row.comparability);
    need(same(row.comparability.registeredContrastIds, [row.contrastId]), 'Scientific review covers another comparison');
    const config = configs.filter(c => c.id === row.configId);
    const analysis = expected.find(a => a.analysisId === row.configId)!;
    need(config.length === 1 && row.localReference.path === `geo_replication/${config[0].dir}/processed/${row.configId}_DE.tsv`
      && row.localReference.sha256 === analysis.deSha256, 'Registered result identity differs');
    need(same(closure.get(row.localReference.path), row.localReference), 'Current result is outside the reviewed dependency closure');
    const references = doc.measurementReferences.filter(ref => ref.sha256 === row.comparison.evidenceFingerprint);
    need(references.length === 1, 'Measured-result identity missing or duplicated');
    const measured = JSON.parse(pinned(references[0]).toString('utf8'));
    need(measured.datasetId === row.datasetId && measured.trackId === row.trackId && measured.contrastId === row.contrastId
      && measured.configId === row.configId && same(measured.localReference, row.localReference)
      && same(measured.metrics, row.comparison.metrics), 'Scoped metrics differ from the reviewed measurement');
    for (const ref of measured.dependencies as Pin[]) need(same(closure.get(ref.path), ref), 'Measurement dependency was omitted or substituted');
    need(same(closure.get(measured.authorReference.path), measured.authorReference), 'Author table is outside source closure');
  }
  return new Map([['gse148252', doc.records]]);
}
