// Prebuild gate: every tracked -text or eol=lf file (dataset bundles, retained
// sources, replay tables, DE results and evidence ledgers) must carry its
// committed line endings before anything hashes it. lib/bundleEol.mts explains
// how a stale copy sits behind a clean `git status`. `--fix` restores copies
// that differ only in line endings and leaves anything with a real content
// change for review.
import { fileURLToPath } from 'node:url';
import { FIXED_EOL_PATHSPECS, findEolDrift, restoreEolDrift } from './lib/bundleEol.mjs';

// Pathspecs resolve against the working directory, so from anywhere but the
// repository root the pattern would match nothing and the gate would pass while
// a stale copy remained. Anchor to this script's repository instead.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const drift = findEolDrift(FIXED_EOL_PATHSPECS, ROOT);
if (drift === null) {
  console.log('[bundle-eol] Not a Git work tree, so there are no committed bytes to compare. Skipped.');
} else if (!drift.length) {
  console.log('[bundle-eol] Every tracked -text and eol=lf file has its committed line endings.');
} else if (process.argv.includes('--fix')) {
  const { restored, kept } = restoreEolDrift(drift, ROOT);
  const still = restored.length ? findEolDrift(restored.map((file) => `:(literal)${file}`), ROOT) ?? [] : [];
  if (still.length) throw new Error(`Restoration left ${still.length} file(s) unchanged: ${still.map((d) => d.path).join(', ')}`);
  console.log(`[bundle-eol] Restored ${restored.length} file(s) to their committed bytes.`);
  if (kept.length) {
    console.error(`FAIL: ${kept.length} file(s) differ from their committed bytes beyond line endings, so they were left alone:`);
    for (const file of kept) console.error(`  ${file}`);
    process.exitCode = 1;
  }
} else {
  console.error(`FAIL: ${drift.length} tracked -text or eol=lf file(s) have line endings that differ from their committed bytes:`);
  for (const entry of drift) console.error(`  ${entry.path} (committed ${entry.index}, working ${entry.worktree})`);
  console.error('Evidence pins describe the committed bytes, so hashing these copies fails the checks on other');
  console.error('checkouts, and a pin recorded here would describe bytes that no other checkout reproduces.');
  console.error('Restore them with: npm run restore:bundle-eol');
  process.exitCode = 1;
}
