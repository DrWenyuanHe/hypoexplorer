import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { CurrentIntakePathwayRecord } from './authorPathwayValidation.mjs';
import { FGSEA_DATABASES, readVerifiedFgseaSet } from './fgseaProvenance.mjs';
import { readAdditiveIntake } from './historicalEvidence.mjs';
import { createOxtAvpIntakeReader, OXT_AVP_AUDIT, OXT_AVP_INTAKE } from './oxtAvpIntakeEvidence.mjs';

type Registry = readonly { id: string; geo?: string; contrasts: readonly { id: string }[] }[];

/** New outputs get current provenance, never synthetic migration differences. */
export function readCurrentIntakePathwayRecords(root: string, registry: Registry): CurrentIntakePathwayRecord[] {
  const declared = readAdditiveIntake(root).datasetIds;
  const registered = registry.filter(dataset => declared.has(dataset.id));
  if (!registered.length) return [];
  const read = (path: string) => readFileSync(resolve(root, path));
  const studies = JSON.parse(read(`${OXT_AVP_INTAKE}/studies.json`).toString('utf8')) as any[];
  const analyses = JSON.parse(read(`${OXT_AVP_INTAKE}/analyses.json`).toString('utf8')) as any[];
  const sourceEvidence = createOxtAvpIntakeReader(root, read);
  return registered.map(dataset => {
    const study = studies.find(row => row.id === dataset.id);
    assert.equal(study?.accession, dataset.geo, `${dataset.id}: current pathway accession changed`);
    assert.deepEqual(study.contrasts.map((row: any) => row.id), dataset.contrasts.map(row => row.id), `${dataset.id}: current pathway contrasts changed`);
    // The admitted microarray producer and mechanical audit expose one default
    // SON track. A future multi-track intake needs an explicit coverage policy.
    assert.equal(study.tracks.length, 1, `${dataset.id}: unsupported current pathway track coverage`);
    const track = study.tracks[0];
    let currentRows = 0, nonFiniteRows = 0;
    const provenanceFiles = dataset.contrasts.map((contrast, index) => {
      const expectedId = index === 0 ? track.analysisId : `${track.analysisId}_${contrast.id}`;
      const matches = analyses.filter(row => row.studyId === dataset.id && row.track === track.id && row.contrast === contrast.id);
      assert.equal(matches.length, 1, `${dataset.id}/${contrast.id}: current pathway analysis coverage changed`);
      assert.equal(matches[0].analysisId, expectedId, `${dataset.id}/${contrast.id}: current pathway analysis identity changed`);
      const evidence = sourceEvidence.evaluate(dataset.id, track.id, contrast.id);
      assert.ok(evidence && evidence.preparation.status === 'pass' && evidence.effects.status === 'pass'
        && evidence.replication.status === 'pass', `${dataset.id}/${contrast.id}: current source-bound intake audit is missing or stale`);
      const dePath = resolve(root, `${study.dir}/processed/${expectedId}_DE.tsv`);
      const verified = readVerifiedFgseaSet(dePath, { expectedSpecies: study.organism });
      for (const database of FGSEA_DATABASES) {
        const rows = verified.rawRows[database];
        currentRows += rows.length;
        nonFiniteRows += rows.filter(row => ['pval', 'padj', 'NES'].some(key =>
          row[key] === '' || row[key] === 'NA' || !Number.isFinite(Number(row[key])))).length;
      }
      return relative(root, verified.provenancePath).replaceAll('\\', '/');
    });
    return {
      datasetId: dataset.id, accession: study.accession,
      state: 'current_provenance_checked' as const, provenanceSchemaVersion: 3 as const,
      contrastCount: dataset.contrasts.length, currentRows, nonFiniteRows, provenanceFiles,
      evidencePath: OXT_AVP_AUDIT,
      note: 'Current schema-3 FGSEA provenance and output hashes are verified against the source-bound intake audit. This newly admitted analysis has no pre-migration baseline; no migration change or author pathway-result agreement is inferred.',
    };
  });
}
