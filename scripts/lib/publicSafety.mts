// Content rules for everything that enters this public repository.
//
// Every commit here is public the moment it is pushed, so these run on each
// commit (pre-commit hook, scripts/install_safety_hook.mjs), in CI
// (.github/workflows/public-safety.yml) and in the maintainer's exporter. A
// `fail` blocks; a `warn` is reported for review.
//
// Two tiers. The rules below are generic and safe to publish. Rules that would
// themselves disclose something (a personal address, an account ID) are never
// committed: they are read at run time from `.public-safety.local.json`
// (gitignored) or from the HYPOEXPLORER_PRIVATE_PATTERNS environment variable
// (a CI secret), both shaped as [{ "label", "pattern", "flags"? }].
//
// A legitimate match is accepted only through public-safety.json: one file, one
// rule label, and the reason, so every exception is reviewable in the open.

export type Level = 'fail' | 'warn';
export type Finding = { level: Level; check: string; file: string; detail: string };
export type Rule = [label: string, pattern: RegExp];
export type Allowance = { file: string; label: string; reason: string };
export type Notice = { file: string; sha256: string; covers: string };
export type SafetyConfig = { allowed: Allowance[]; requiredNotices: Notice[] };

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const WARN_FILE_BYTES = 25 * 1024 * 1024;

export const SECRET_RULES: Rule[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['assigned credential', /\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_EDGE_TOKEN|CF_API_TOKEN|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|ZENODO_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9_\-/+]{20,}/],
];

// The owner's writing (thesis, manuscripts, submission planning, lab notes)
// never belongs here. The path rule catches document formats and writing
// folders; the text rules catch writing pasted into an ordinary file.
export const WRITING_PATH = /\.(?:docx?|pptx?|key|tex|bib|odt|rtf)$|(?:^|\/)(?:chapter\d+|nar-research|manuscripts?|thesis|drafts?|lab[-_ ]?notes?|LAB_NOTEBOOK[^/]*)(?:\/|$)/i;
export const WRITING_RULES: Rule[] = [
  ['thesis chapter', /\bChapter[ -]?6\b|\bchapter6\b/],
  ['thesis', /\b(?:thesis|dissertation)\b/i],
  // Any standalone "NAR": planning notes say "the NAR database" in lower case
  // too. A citation of another group's NAR paper needs an allowance.
  ['NAR', /\bNAR\b/],
  ['lab meeting', /\blab[- ]meeting\b/i],
  // Case-sensitive: "The Lab Notebook" is DESIGN.md's name for the visual style.
  ['lab notebook', /LAB_NOTEBOOK|\blab notebook\b/],
  ['own manuscript', /\b(?:methods|our|HypoExplorer) manuscript\b/i],
];

export const PRIVATE_RULES: Rule[] = [
  ['Windows user path', /[Cc]:[\\/]+Users[\\/]+(?!Public)[A-Za-z]/],
];

// Reported, not blocking: placeholders like C:/path/to/... are common in docs.
export const DRIVE_RULES: Rule[] = [
  ['drive path', /\b[A-Z]:[\\/](?!Program Files|Windows|Users[\\/]+Public)[A-Za-z]/],
];

/** Private rules from the gitignored local file or the CI secret; never from the repo. */
export function parsePrivateRules(json: string | undefined): Rule[] {
  if (!json?.trim()) return [];
  const rows = JSON.parse(json) as { label: string; pattern: string; flags?: string }[];
  return rows.map(({ label, pattern, flags }) => [label, new RegExp(pattern, flags)]);
}

// The rule definitions and the allowance list necessarily name the terms they
// look for; they are exempt from the prose and private rules, never from the
// credential, size and LFS checks.
export const RULE_FILES = new Set(['scripts/lib/publicSafety.mts', 'public-safety.json']);

export function scanFile(file: string, bytes: Buffer, config: SafetyConfig, privateRules: Rule[] = []): Finding[] {
  const findings: Finding[] = [];
  const ruleFile = RULE_FILES.has(file);
  const allowed = (label: string) => config.allowed.some((a) => a.file === file && a.label === label);
  if (bytes.length > MAX_FILE_BYTES) findings.push({ level: 'fail', check: 'size', file, detail: `${(bytes.length / 1e6).toFixed(1)} MB exceeds GitHub's 100 MB limit` });
  else if (bytes.length > WARN_FILE_BYTES) findings.push({ level: 'warn', check: 'size', file, detail: `${(bytes.length / 1e6).toFixed(1)} MB` });
  if (bytes.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs')) findings.push({ level: 'fail', check: 'lfs', file, detail: 'LFS pointer' });
  if (WRITING_PATH.test(file) && !allowed('writing path')) findings.push({ level: 'fail', check: 'writing', file, detail: 'writing file or folder' });
  // Binary files are scanned as latin1, so a credential or path inside a font,
  // image or bytecode blob is still caught; prose rules apply to text only.
  const binary = bytes.includes(0);
  const lines = bytes.toString(binary ? 'latin1' : 'utf8').split('\n');
  const scan = (rules: Rule[], level: Level, check: string) => {
    for (const [label, re] of rules) {
      if (allowed(label)) continue;
      const hits = lines.flatMap((line, i) => (re.test(line) ? [i + 1] : []));
      if (hits.length) findings.push({ level, check, file, detail: `${label} on line(s) ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ` (+${hits.length - 8})` : ''}` });
    }
  };
  scan(SECRET_RULES, 'fail', 'secret');
  if (ruleFile) return findings;
  scan([...PRIVATE_RULES, ...privateRules], 'fail', 'private');
  if (binary) return findings;
  scan(WRITING_RULES, 'fail', 'writing');
  scan(DRIVE_RULES, 'warn', 'drive-path');
  return findings;
}

/** Third-party notices that must travel with the content they cover (MIT and similar require it). */
export function checkNotices(config: SafetyConfig, digestOf: (file: string) => string | null): Finding[] {
  return config.requiredNotices.flatMap((notice) => {
    const digest = digestOf(notice.file);
    return digest === notice.sha256 ? [] : [{
      level: 'fail' as const, check: 'license', file: notice.file,
      detail: `${digest ? 'differs from' : 'missing; required for'} ${notice.covers}`,
    }];
  });
}
