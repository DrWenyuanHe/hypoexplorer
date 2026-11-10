// Install a pre-commit hook that runs the public-safety check on what is about to
// be committed. Run once per clone: `pnpm run hooks:install`. An existing
// pre-commit hook is kept and runs first.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const hooks = path.resolve(execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim());
const hook = path.join(hooks, 'pre-commit');
const MARK = '# hypoexplorer public-safety';
mkdirSync(hooks, { recursive: true });

if (existsSync(hook) && readFileSync(hook, 'utf8').includes(MARK)) {
  console.log('public-safety pre-commit hook already installed');
  process.exit(0);
}
const previous = existsSync(hook) ? `${hook}.before-public-safety` : null;
if (previous) renameSync(hook, previous);

writeFileSync(hook, [
  '#!/bin/sh',
  MARK,
  previous ? `"${previous.split(path.sep).join('/')}" "$@" || exit $?` : '',
  'node ./node_modules/tsx/dist/cli.mjs scripts/check_public_safety.mts --staged || {',
  '  echo "pre-commit: public-safety check failed; nothing was committed." >&2',
  '  exit 1',
  '}',
  '',
].filter((line) => line !== '').join('\n') + '\n');
chmodSync(hook, 0o755);
console.log(`installed ${hook}${previous ? ` (previous hook kept as ${path.basename(previous)})` : ''}`);
