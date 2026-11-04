import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './snapshot.mjs';

export const MARKER = '# HypoExplorer context pre-push wrapper v1';
export const WRAPPER = `#!/bin/sh
${MARKER}
set -eu
# Keep trailing newlines when shell command substitution removes its own one.
context_input="$(cat; printf x)"
context_input="\${context_input%x}"
command -v node >/dev/null 2>&1 || { echo 'Node is required for the context review guard.' >&2; exit 1; }
printf '%s' "$context_input" | node scripts/agent-context/cli.mjs check --pre-push || exit $?
context_original="$(git rev-parse --git-path hooks/pre-push.context-original)"
if [ -f "$context_original" ]; then
  printf '%s' "$context_input" | "$context_original" "$@"
fi
`;

export function installHook(root) {
  const hook = path.resolve(root, git(root, ['rev-parse', '--git-path', 'hooks/pre-push']).trim());
  const backup = `${hook}.context-original`;
  for (const filename of [hook, backup]) if (existsSync(filename) && lstatSync(filename).isSymbolicLink()) throw new Error(`Refusing symlink hook: ${filename}`);
  const current = existsSync(hook) ? readFileSync(hook, 'utf8') : '';
  if (current === WRAPPER) return false;
  if (current.includes(MARKER) || existsSync(backup)) throw new Error('Existing context wrapper/backup differs; inspect it before installing');
  if (current) { writeFileSync(backup, current, { flag: 'wx', mode: 0o755 }); chmodSync(backup, 0o755); }
  writeFileSync(hook, WRAPPER, { mode: 0o755 });
  chmodSync(hook, 0o755);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    console.log(installHook(root) ? '[context] Installed pre-push guard; existing hook preserved.' : '[context] Pre-push guard already installed.');
  } catch (error) { console.error(`[context] ${error.message}`); process.exitCode = 1; }
}
