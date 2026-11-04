/**
 * The supersession projection of scripts/run_sealed_ts_check.mts for tests of dated evidence whose
 * pins name bytes the R 4.6.0 regeneration replaced (data/quality/regeneration-r460-2026-09-25/README.md).
 * While active, every read of a superseded path returns its verified pre-regeneration bytes; every
 * other read is current. The runner is loaded through a non-literal specifier so the app's ES2020
 * type program does not compile that Node-only (ES2022) script.
 */
const RUNNER = '../../scripts/run_sealed_ts_check.mts';

/** Start the projection; resolves to the function that restores fs. */
export async function projectSuperseded(root = process.cwd()): Promise<() => void> {
  const runner = await import(/* @vite-ignore */ RUNNER) as { projectSuperseded: (root: string) => () => void };
  return runner.projectSuperseded(root);
}
