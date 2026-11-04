/**
 * Runs two SHA-256-pinned evidence tests under the supersession projection.
 *
 * countConservationEvidence.test.ts (pinned by data/internal-qc/conservation-2026-09-05/evidence-pins.tsv)
 * and reviewedFgseaSpecies.test.ts (pinned by the September 11 integration and FGSEA reviews) check
 * dated evidence whose pins name bytes the R 4.6.0 regeneration replaced. They cannot be edited, so
 * vite.config.ts excludes them from direct discovery and this file imports them while every read of a
 * superseded path returns its verified pre-regeneration bytes; every other read is current
 * (data/quality/regeneration-r460-2026-09-25/README.md). The live successors are checked by
 * scripts/audit_count_conservation_r460.py and scripts/refresh_fgsea_bundles.mts --check.
 */
import { afterAll } from 'vitest';
import { projectSuperseded } from './supersededProjection';

const restore = await projectSuperseded();
afterAll(() => restore());

await import('./countConservationEvidence.test');
await import('./reviewedFgseaSpecies.test');
