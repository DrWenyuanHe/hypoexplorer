import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QualityCheck } from '../../src/data/qualityChecks';
import { qualityCheck } from './internalQc.mjs';

export const OXT_AVP_INTAKE = 'data/intake/oxt-avp-2026-10-19';
export const OXT_AVP_AUDIT = `${OXT_AVP_INTAKE}/audit.generated.json`;
export const OXT_AVP_AUDIT_DEPENDENCIES = [
  `${OXT_AVP_INTAKE}/studies.json`, `${OXT_AVP_INTAKE}/analyses.json`,
  'scripts/audit_oxt_avp_intake_r460.mts', 'scripts/lib/oxtAvpIntakeEvidence.mts',
  'scripts/regen-r460/run_oxt_avp_r460.R', 'scripts/lib/de_common.R', 'scripts/build_oxt_avp_bundles_r460.mts',
  'scripts/lib/geneSymbol.mts', 'scripts/lib/bundleSlim.mts', 'scripts/lib/fgseaProvenance.mts',
  'scripts/regen-r460/run_fgsea_r460.R', 'geo_replication/config/datasets.tsv',
  'src/data/datasets.ts', 'src/data/oxtAvpStudies.generated.json',
] as const;

/** A missing or stale source/output audit cannot supply passing badge evidence. */
export function createOxtAvpIntakeReader(root: string, read: (path: string) => Buffer) {
  const manifest = `${OXT_AVP_INTAKE}/studies.json`;
  const studies = existsSync(resolve(root, manifest)) ? JSON.parse(read(manifest).toString('utf8')) : [];
  let saved: { current: boolean; records: any[]; fingerprints: Record<string, string> } | undefined;
  function audit() {
    if (saved) return saved;
    if (!existsSync(resolve(root, OXT_AVP_AUDIT))) {
      saved = { current: false, records: [], fingerprints: {} };
      return saved;
    }
    const document = JSON.parse(read(OXT_AVP_AUDIT).toString('utf8'));
    const pins = Object.entries(document.fingerprints ?? {});
    const current = document.schemaVersion === 1 && OXT_AVP_AUDIT_DEPENDENCIES.every(path => document.fingerprints?.[path]) && pins.every(([path, expected]) =>
      existsSync(resolve(root, path)) && createHash('sha256').update(read(path)).digest('hex') === expected);
    saved = { current, records: document.analyses ?? [], fingerprints: document.fingerprints ?? {} };
    return saved;
  }
  return {
    evaluate(datasetId: string, trackId: string, contrastId: string): {
      preparation: QualityCheck; replication: QualityCheck; conservation: QualityCheck; normalization: QualityCheck; effects: QualityCheck;
    } | null {
      const study = studies.find((row: any) => row.id === datasetId);
      if (!study) return null;
      const evidence = [manifest, OXT_AVP_AUDIT, ...(study.designReview?.evidencePaths ?? [])];
      const document = audit();
      const records = document.records.filter(row => row.datasetId === datasetId && row.track === trackId && row.contrast === contrastId);
      const record = records.length === 1 ? records[0] : null;
      const track = study.tracks?.find((row: any) => row.id === trackId);
      const contrastIndex = study.contrasts?.findIndex((row: any) => row.id === contrastId) ?? -1;
      const expectedId = track && contrastIndex >= 0 ? contrastIndex === 0 ? track.analysisId : `${track.analysisId}_${contrastId}` : null;
      const prefix = `${study.dir}/processed/${expectedId}`;
      const required = [track?.matrix, track?.samplesheet, `${study.dir}/metadata/${study.accession}_source_files.tsv`,
        `${study.dir}/processed/${track?.analysisId}_model_input.tsv.gz`, `${study.dir}/processed/${track?.analysisId}_expression.tsv.gz`,
        `${study.dir}/processed/${track?.analysisId}_feature_map.tsv.gz`, `${prefix}_DE.tsv`, `${prefix}_SE.tsv`, `${prefix}_provenance.tsv`,
        `public/datasets/${datasetId}/track_${trackId}.js`, `public/datasets/${datasetId}/track_${trackId}.pathways.js`,
        ...(study.designReview?.evidencePaths ?? [])];
      const valid = document.current && record && record.analysisId === expectedId && required.every(path => path && document.fingerprints[path])
        && ['sourceIntegrity', 'preparedInputTrace', 'expressionTrace', 'deTrace', 'pathwayProvenance', 'modelEffectTrace']
        .every(key => record[key] === 'pass');
      const missing = 'The current source-bound OXT/AVP audit is missing or stale. No earlier passing result is inherited.';
      const preparation = qualityCheck('prepared_input_trace', 'Prepared matrix and output trace', valid ? 'pass' : 'not_assessed', valid
        ? 'Checksummed original sources, the source-feature map and every averaged log-expression value trace to the current model input and public expression. Published DE, SE and pathways match their source outputs.' : missing, evidence);
      const resolved = ['pass', 'pass_with_notes'].includes(study.designReview?.replicationStatus);
      const replication = qualityCheck('independent_replication', 'Independent biological replication', valid && resolved ? 'pass' : 'not_assessed', valid && resolved
        ? `${study.designReview.biologicalUnit}. ${study.designReview.note} The reviewed unit is counted once; constituent animals within a pool are not additional replicates.` : missing, evidence);
      const conservation = qualityCheck('count_conservation', 'Count conservation through preparation', valid ? 'not_applicable' : 'not_assessed', valid
        ? 'Microarray input contains normalized log-expression values. Count conservation is not applicable; the preparation audit verifies the declared log-scale averaging instead.' : missing, evidence);
      const normalization = qualityCheck('normalization', 'Normalization and transformation', valid ? 'pass' : 'not_assessed', valid
        ? 'Every model value is independently checked against its declared prepared log-expression source: unambiguous same-symbol probes are averaged before fitting, with no additional transformation. Upstream array normalization is source-documented; raw CEL normalization is outside this value-trace check.' : missing, evidence);
      const effects = qualityCheck('model_effect_trace', 'Registered model effects and coefficient SE trace', valid ? 'pass' : 'not_assessed', valid
        ? 'For the registered unadjusted group comparisons, every published effect equals the independently computed difference of model-input means, and moderated t equals logFC/SE. Current producer, configuration and output hashes are verified. Empirical-Bayes hyperparameter estimation is not independently reconstructed by this check.' : missing, evidence);
      return { preparation, replication, conservation, normalization, effects };
    },
  };
}
