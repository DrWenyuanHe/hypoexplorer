// Check that nothing private enters this public repository (rules: scripts/lib/publicSafety.mts).
//
//   pnpm run check:public-safety            # every tracked file
//   pnpm run check:public-safety --staged   # what the next commit would contain (the pre-commit hook)
//
// Reads blobs from git (the index with --staged, HEAD's tracked paths otherwise
// from the working tree), applies public-safety.json's allowances and required
// notices, and adds private rules from .public-safety.local.json or
// HYPOEXPLORER_PRIVATE_PATTERNS when present. Runs gitleaks too when it is
// installed. Exits non-zero on any failure.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNotices, parsePrivateRules, scanFile, type Finding, type SafetyConfig } from './lib/publicSafety.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });

const config: SafetyConfig = JSON.parse(readFileSync(path.join(ROOT, 'public-safety.json'), 'utf8'));
const localRules = path.join(ROOT, '.public-safety.local.json');
const privateRules = [
  ...parsePrivateRules(existsSync(localRules) ? readFileSync(localRules, 'utf8') : undefined),
  ...parsePrivateRules(process.env.HYPOEXPLORER_PRIVATE_PATTERNS),
];

// --staged: added, copied, modified or renamed paths, read from the index.
const files = (staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  : git(['ls-files', '-z'])).toString('utf8').split('\0').filter(Boolean);
const read = (file: string): Buffer | null => {
  if (staged) return git(['show', `:${file}`]);
  const at = path.join(ROOT, file);
  return existsSync(at) ? readFileSync(at) : null;
};

const findings: Finding[] = [];
for (const file of files) {
  const bytes = read(file);
  if (bytes) findings.push(...scanFile(file, bytes, config, privateRules));
}
const tracked = new Set(staged ? git(['ls-files', '-z']).toString('utf8').split('\0') : files);
findings.push(...checkNotices(config, (file) => {
  if (!tracked.has(file) && !files.includes(file)) return null;
  const bytes = read(file);
  return bytes ? createHash('sha256').update(bytes).digest('hex') : null;
}));
for (const entry of config.allowed) {
  if (!tracked.has(entry.file)) findings.push({ level: 'warn', check: 'allowance', file: entry.file, detail: 'allowance names a file that is not tracked; remove it' });
}

// gitleaks, when installed. Installed but unable to run is a failure, not a skip.
const gitleaks = spawnSync('gitleaks', ['git', ROOT, ...(staged ? ['--staged'] : []), '--no-banner', '--redact', '--report-format', 'json', '--report-path', '-', '--exit-code', '0'],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
if ((gitleaks.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
  if (gitleaks.error || gitleaks.status !== 0) {
    findings.push({ level: 'fail', check: 'secret', file: '(gitleaks)', detail: String(gitleaks.error ?? gitleaks.stderr).slice(0, 300) });
  } else {
    for (const leak of JSON.parse(gitleaks.stdout || '[]') as { File: string; RuleID: string; StartLine: number }[]) {
      findings.push({ level: 'warn', check: 'gitleaks', file: leak.File, detail: `${leak.RuleID} line ${leak.StartLine}` });
    }
  }
}

const failures = findings.filter((f) => f.level === 'fail');
for (const f of findings) console.log(`[${f.level}] ${f.check} ${f.file}: ${f.detail}`);
console.log(`public safety: ${files.length} file(s) checked${staged ? ' (staged)' : ''}, ${privateRules.length} private rule(s), ${failures.length} failure(s), ${findings.length - failures.length} warning(s)`);
if (failures.length) {
  console.log('\nNothing private may be committed here. Remove it, or add a reviewed allowance to public-safety.json.');
  process.exit(1);
}
