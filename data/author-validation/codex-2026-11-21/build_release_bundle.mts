// Builds this pass's contribution to the next hypoexplorer-data release, following the
// data repository's README: the project's own records and scripts are redistributed
// (scrubbed of personal addresses, pre-signed URLs and machine paths); third-party inputs
// and tables derived from them are listed in sources.json with their SHA-256 instead.
//
//   RELEASE_FILES_TSV=<pinned files.tsv> pnpm exec tsx data/author-validation/codex-2026-11-21/build_release_bundle.mts [--survey] [--list-evidence] [--out <dir>]
//
// Inputs: every file under data/author-validation/continued-sources/*/codex-2026-11-21/, plus the
// raw sources this pass recovered at the paths earlier specs pin. Copies of files the current
// release already carries are dropped. Nothing is uploaded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tarEnd, tarEntry } from '../../../scripts/lib/tarball.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const PART = 'evidence-codex-2026-11-21';
const survey = process.argv.includes('--survey');
const outArg = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : '.release-staging/codex-2026-11-21');
const releaseFiles = process.env.RELEASE_FILES_TSV; // files.tsv of the pinned release

const posix = (p: string) => p.replaceAll('\\', '/');
const rel = (p: string) => posix(relative(ROOT, p));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

// Raw sources recovered byte-identical at the paths existing specs pin (README, "Held").
const RECOVERED = [
  'data/author-validation/continued-sources/advancement-sources-a-2026-09-05/GSE179663/FEB4-12-443-s001.docx',
  'data/author-validation/continued-sources/five-dataset-followup-2026-09-04/GSE284408/GSE284408_author_table.txt.gz',
  'data/author-validation/continued-sources/final-numerical-batch-c/GSE231769_S1.xlsx',
  'data/author-validation/continued-sources/final-numerical-batch-b/GSE49540/12864_2017_4265_MOESM1_ESM.docx',
  'data/author-validation/continued-sources/final-numerical-batch-d/JNC-169-0-s006.xlsx',
  'data/author-validation/continued-sources/GSE232510/turbo-2026-11-16-wave2/sources/ijms-25-07188-s001.zip',
  'data/author-validation/continued-sources/GSE232510/turbo-2026-11-16-wave2/sources/Supplementry_Table_S1.xlsx',
  'data/author-validation/continued-sources/GSE232510/turbo-2026-11-16-wave2/sources/PMC11241292.xml',
  'data/author-validation/continued-sources/GSE242354/turbo-2026-11-15-notloc2/source/TRNSCRPT_HYPOTH_DA.rda',
];
const RECOVERED_DERIVED = ['data/author-validation/continued-sources/advancement-sources-b-2026-09-05/GSE231769/author-effects.tsv'];

// Recorded download URLs, keyed by repository path.
const recorded = new Map<string, { url: string; sourcesFile: string }>();
const base = join(ROOT, 'data/author-validation/continued-sources');
const passDirs = readdirSync(base).map((acc) => join(base, acc, 'codex-2026-11-21')).filter(existsSync);
for (const dir of passDirs) {
  const sourcesFile = join(dir, 'SOURCES.tsv');
  if (!existsSync(sourcesFile)) continue;
  const [, ...rows] = readFileSync(sourcesFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const row of rows) {
    const [p, url] = row.split('\t');
    if (!p) continue;
    const full = posix(p).startsWith('data/') ? resolve(ROOT, p) : resolve(dir, p);
    recorded.set(rel(full), { url: (url ?? '').trim(), sourcesFile: rel(sourcesFile) });
  }
}
// Pinned URLs for the recovered sources come from the existing specs.
const specs = JSON.parse(readFileSync(join(ROOT, 'data/author-validation/additional-comparison-specs.json'), 'utf8')).comparisons;
for (const spec of specs) for (const ref of spec.originalReferences ?? []) {
  if (RECOVERED.includes(ref.path) && /^https?:/.test(ref.sourceUrl)) {
    recorded.set(ref.path, { url: ref.sourceUrl, sourcesFile: 'data/author-validation/additional-comparison-specs.json' });
  }
}
recorded.set(RECOVERED[6], { url: 'https://pmc.ncbi.nlm.nih.gov/articles/instance/11241292/bin/ijms-25-07188-s001.zip', sourcesFile: 'data/author-validation/additional-comparison-specs.json' });

const inRelease = new Set<string>();
if (releaseFiles && existsSync(releaseFiles)) {
  for (const line of readFileSync(releaseFiles, 'utf8').split(/\r?\n/).slice(1)) {
    const cols = line.split('\t');
    if (cols[3]) inRelease.add(cols[3]);
  }
}

const OWN_CODE = /\.(py|mts|ts|mjs|cjs|js|R|r|sh|ps1)$/;
const OWN_RECORD = /\.(json|md)$/;
const AUTO_HOSTS = /(^|\.)(ncbi\.nlm\.nih\.gov|nih\.gov|ebi\.ac\.uk|europepmc\.org|zenodo\.org|figshare\.com|githubusercontent\.com|github\.com|osf\.io|datadryad\.org|biorxiv\.org|medrxiv\.org|crossref\.org|doi\.org|cran\.r-project\.org|bioconductor\.org|ensembl\.org|ddbj\.nig\.ac\.jp)$/;
const DYNAMIC_URL = /api\.crossref\.org|eutils\.ncbi|\/rest\/search|api\.github\.com|\/api\/|esummary|esearch|efetch|query=/i;
const REGENERATED = /_family\.soft(\.gz)?$|series_matrix/i;

// The data release carries no previews of supplementary tables: a record holding copied
// rows or cells (arrays under row/cell/preview keys) is treated as a derived table.
const PREVIEW_KEY = /preview|excerpt|cells|(^|_)rows?($|_)|first_.*rows|head_rows|sample_rows|row_values|headers?$/i;
function holdsTablePreview(bytes: Buffer): boolean {
  let doc: unknown;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { return false; }
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 12 || !node || typeof node !== 'object') return false;
    for (const [key, value] of Object.entries(node)) {
      if (PREVIEW_KEY.test(key) && Array.isArray(value) && value.some((v) => Array.isArray(v) || (v && typeof v === 'object') || typeof v === 'string')) return true;
      if (visit(value, depth + 1)) return true;
    }
    return false;
  };
  return visit(doc, 0);
}

// Records that check_copied_text.py found carrying copied publication text or table rows.
const copiedTextPath = join(here, 'copied-text.json');
const copiedText = new Set<string>(existsSync(copiedTextPath)
  ? JSON.parse(readFileSync(copiedTextPath, 'utf8')).files.map((f: { path: string }) => f.path) : []);

type Kind = 'evidence' | 'source' | 'derived' | 'release-copy';
type Entry = { path: string; bytes: number; sha256: string; kind: Kind; url?: string; recordedIn?: string };
const entries: Entry[] = [];
const inputs = [...passDirs.flatMap(walk).map(rel), ...RECOVERED, ...RECOVERED_DERIVED].filter((p) => existsSync(join(ROOT, p)));
for (const p of inputs) {
  const bytes = readFileSync(join(ROOT, p));
  const digest = sha256(bytes);
  const rec = recorded.get(p);
  const isDownload = Boolean(rec && /^https?:\/\//.test(rec.url));
  let kind: Kind;
  if (inRelease.has(digest)) kind = 'release-copy';
  else if (isDownload || RECOVERED.includes(p)) kind = 'source';
  else if (copiedText.has(p) || (p.endsWith('.json') && holdsTablePreview(bytes))) kind = 'derived';
  else if (p.endsWith('/SOURCES.tsv') || OWN_CODE.test(p) || OWN_RECORD.test(p)) kind = 'evidence';
  else kind = 'derived';
  entries.push({ path: p, bytes: bytes.length, sha256: digest, kind, url: isDownload ? rec!.url : undefined, recordedIn: rec?.sourcesFile });
}

// Scrub rules for redistributed text, matching the data repository's documented edits.
const SCRUB: [string, RegExp, string][] = [
  ['pre-signed URL query', /([?&])(X-Amz-[A-Za-z-]+|Signature|Expires|AWSAccessKeyId|sig|se|sp|sv|st|sr)=[^\s"'&)\]]+/g, '$1'],
  ['email address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email redacted>'],
  ['maintainer checkout path', /[A-Za-z]:[\\/]+Github Projects[\\/]+hypoexplorer(?:-review)?|\/[a-z]\/Github Projects\/hypoexplorer(?:-review)?/gi, '<checkout>'],
  ['Windows home path', /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+|\/[a-z]\/Users\/[^/\s"']+/gi, '<home>'],
  ['machine tool path', /[A-Za-z]:[\\/]+Program Files[\\/]+Git[\\/]+mingw64[\\/]+etc[\\/]+ssl[\\/]+certs[\\/]+ca-bundle\.crt/g, '<ca-bundle>'],
  ['machine tool path', /[A-Za-z]:[\\/]+Program Files[^"'\n]*?[\\/]([A-Za-z0-9_.-]+)\.(?:exe|com)\b/g, '$1'],
];
const scrubbed: { file: string; headBlobSha256: string; rules: Record<string, number> }[] = [];
const scrubText = (path: string, bytes: Buffer): Buffer => {
  if (bytes.includes(0)) return bytes;
  let text = bytes.toString('utf8');
  const rules: Record<string, number> = {};
  for (const [label, re, replacement] of SCRUB) {
    const hits = text.match(re)?.length ?? 0;
    if (hits) { rules[label] = (rules[label] ?? 0) + hits; text = text.replace(re, replacement); }
  }
  if (!Object.keys(rules).length) return bytes;
  scrubbed.push({ file: path, headBlobSha256: sha256(bytes), rules });
  return Buffer.from(text, 'utf8');
};

const fetchMode = (url: string) => (AUTO_HOSTS.test(new URL(url).hostname) ? 'auto' : 'manual');
const stability = (path: string, url: string) => (REGENERATED.test(path) ? 'regenerated' : DYNAMIC_URL.test(url) ? 'dynamic' : 'immutable');
// Signed download URLs expire; keep the stable part only, as the released text does.
const unsign = (url: string) => url.replace(SCRUB[0][1], SCRUB[0][2]).replace(/[?&]+$/, '');
const sources = entries.filter((e) => e.kind === 'source' || e.kind === 'derived').map((e) => ({
  path: e.path, bytes: e.bytes, sha256: e.sha256,
  urls: e.url ? [unsign(e.url)] : [],
  urlSource: e.url ? 'recorded' : 'none',
  recordedIn: e.recordedIn ? [e.recordedIn] : [],
  fetch: e.url ? fetchMode(e.url) : e.kind === 'derived' ? 'not-fetchable' : 'unknown',
  stability: e.url ? stability(e.path, e.url) : 'immutable',
  redistributable: false,
}));

const tally = (k: Kind) => { const xs = entries.filter((e) => e.kind === k); return { files: xs.length, MB: +(xs.reduce((s, e) => s + e.bytes, 0) / 1e6).toFixed(1) }; };
const summary = { evidence: tally('evidence'), sources: tally('source'), derived: tally('derived'), releaseCopies: tally('release-copy') };
console.log(JSON.stringify(summary, null, 2));
// --list-evidence prints the redistributed files (size, path) to stderr for review.
if (process.argv.includes('--list-evidence')) for (const e of entries.filter((x) => x.kind === 'evidence')) console.error(`${e.bytes}\t${e.path}`);
if (survey) {
  const ext = (k: Kind) => Object.entries(entries.filter((e) => e.kind === k).reduce<Record<string, number>>((m, e) => {
    const x = (e.path.match(/\.([A-Za-z0-9]+)(\.gz)?$/)?.[1] ?? 'none').toLowerCase(); m[x] = (m[x] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  for (const k of ['evidence', 'source', 'derived'] as Kind[]) console.log(k, JSON.stringify(ext(k)));
  const fm = sources.reduce<Record<string, number>>((m, s) => { const key = `${s.fetch}/${s.stability}`; m[key] = (m[key] ?? 0) + 1; return m; }, {});
  console.log('sources by fetch/stability', JSON.stringify(fm));
  process.exit(0);
}

// Pack the scrubbed files with the release archives' own deterministic ustar/PAX writer,
// which fetch:data's reader understands (GNU tar's long-name entries it does not).
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files: string[] = ['path\tpart\tbytes\tsha256'];
const blocks: Buffer[] = [];
for (const e of entries.filter((x) => x.kind === 'evidence').sort((a, b) => (a.path < b.path ? -1 : 1))) {
  const out = scrubText(e.path, readFileSync(join(ROOT, e.path)));
  blocks.push(...tarEntry(e.path, out));
  files.push(`${e.path}\t${PART}\t${out.length}\t${sha256(out)}`);
}
const archive = join(OUT, `${PART}.tar.gz`);
writeFileSync(archive, gzipSync(Buffer.concat([...blocks, tarEnd()]), { level: 9 }));
writeFileSync(join(OUT, 'files.tsv'), `${files.join('\n')}\n`);
writeFileSync(join(OUT, 'sources.json'), `${JSON.stringify({ schemaVersion: 1, note: 'Third-party inputs and derived tables behind the 2026-11-21 Codex closure pass. They are not redistributed: fetch each from its URL and check its SHA-256. "not-fetchable" entries are derived tables the pass scripts rebuild from the listed inputs.', entries: sources }, null, 2)}\n`);
writeFileSync(join(OUT, 'scrubbed.json'), `${JSON.stringify(scrubbed, null, 2)}\n`);
writeFileSync(join(OUT, 'release-copies.tsv'), ['path\tsha256', ...entries.filter((e) => e.kind === 'release-copy').map((e) => `${e.path}\t${e.sha256}`)].join('\n') + '\n');
const archiveBytes = readFileSync(archive);
writeFileSync(join(OUT, 'part.json'), `${JSON.stringify({ name: PART, file: `${PART}.tar.gz`, sha256: sha256(archiveBytes), bytes: archiveBytes.length, compression: 'gzip', optional: false, files: files.length - 1 }, null, 2)}\n`);
console.log(`staged ${files.length - 1} files; ${PART}.tar.gz ${(archiveBytes.length / 1e6).toFixed(1)} MB; ${sources.length} sources.json entries; ${scrubbed.length} scrubbed files`);
