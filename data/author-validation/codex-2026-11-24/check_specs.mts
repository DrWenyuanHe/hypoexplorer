// Applies compare_author_results.mts's additional-spec rules to the proposed specs:
// required fields, pinned author SHA-256, local snapshot, columns, unique keys, adjusted P range,
// and no clash with a built-in comparison. Prints paired-gene counts for review.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const A = resolve(ROOT, 'data/author-validation');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
type Row = Record<string, unknown>;
const readDelimited = (p: string, sep: string): Row[] => {
  const raw = readFileSync(p);
  const text = (p.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').replace(/^﻿/, '');
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.length);
  const cols = head.split(sep).map((c) => c.replace(/^"|"$/g, ''));
  return lines.map((l) => Object.fromEntries(l.split(sep).map((v, i) => [cols[i], v.replace(/^"|"$/g, '')])));
};
const num = (v: unknown) => (v === null || v === '' || v === 'NA' ? NaN : Number(v));

const specs = JSON.parse(readFileSync(resolve(A, 'additional-comparison-specs.json'), 'utf8')).comparisons as Row[];
const generated = JSON.parse(readFileSync(resolve(A, 'direct-comparisons.generated.json'), 'utf8')).comparisons as Row[];
const specIds = new Set(specs.map((s) => s.datasetId));
const builtIn = new Set(generated.map((c) => c.datasetId).filter((id) => !specIds.has(id)));
const dir = resolve(here, process.argv[2] ?? 'corrected');
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const spec = JSON.parse(readFileSync(resolve(dir, f), 'utf8')).proposed?.additionalComparisonSpec as Row | undefined;
  if (!spec) continue;
  const id = String(spec.datasetId), errs: string[] = [];
  try {
    if (builtIn.has(id)) errs.push('dataset already has a built-in comparison');
    if (![1, -1].includes(spec.orientationSign as number) || !['tsv', 'csv', 'xlsx'].includes(String(spec.format))
      || !/^[a-f0-9]{64}$/.test(String(spec.sha256)) || !spec.sourceUrl || !spec.note || !spec.localMethod || !spec.authorMethod
      || !spec.contrast || !spec.interpretation) errs.push('incomplete specification');
    const authorPath = resolve(ROOT, String(spec.authorPath)), localPath = resolve(ROOT, String(spec.localPath));
    if (!existsSync(authorPath)) throw new Error(`author file missing: ${spec.authorPath}`);
    if (!existsSync(localPath)) throw new Error(`local file missing: ${spec.localPath}`);
    if (sha(authorPath) !== spec.sha256) errs.push('author SHA-256 does not match');
    const snap = spec.localSnapshot as { path: string; sha256: string } | undefined;
    if (snap && (resolve(ROOT, snap.path) !== localPath || sha(localPath) !== snap.sha256)) errs.push('local snapshot does not match current bytes');
    for (const ref of (spec.originalReferences as { path: string; sha256: string }[] | undefined) ?? []) {
      const p = resolve(ROOT, ref.path);
      if (!existsSync(p)) errs.push(`original reference missing: ${ref.path}`);
      else if (sha(p) !== ref.sha256) errs.push(`original reference hash differs: ${ref.path}`);
    }
    let author: Row[];
    if (spec.format === 'xlsx') {
      const wb = XLSX.read(readFileSync(authorPath));
      const sheet = wb.Sheets[String(spec.sheetName ?? wb.SheetNames[0])];
      if (!sheet) throw new Error('missing worksheet');
      author = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true, range: Number(spec.headerRow ?? 1) - 1 });
    } else author = readDelimited(authorPath, spec.format === 'csv' ? ',' : '\t');
    const local = readDelimited(localPath, '\t');
    const localKey = String(spec.localKey ?? 'gene_id');
    for (const c of [spec.authorKey, spec.authorEffect, ...(spec.authorAdjustedP ? [spec.authorAdjustedP] : [])]) if (!author.length || !Object.hasOwn(author[0], String(c))) errs.push(`author column missing: ${c}`);
    for (const c of [localKey, 'logFC', 'padj']) if (!local.length || !Object.hasOwn(local[0], c)) errs.push(`local column missing: ${c}`);
    const dup = (rows: Row[], k: string) => rows.length - new Set(rows.map((r) => String(r[k] ?? ''))).size;
    if (dup(author, String(spec.authorKey))) errs.push(`author keys not unique (${dup(author, String(spec.authorKey))} duplicates)`);
    if (dup(local, localKey)) errs.push(`local keys not unique`);
    if (spec.authorAdjustedP && author.some((r) => { const p = num(r[String(spec.authorAdjustedP)]); return p < 0 || p > 1; })) errs.push('author adjusted P outside [0,1]');
    const mine = new Map(local.filter((r) => Number.isFinite(num(r.logFC))).map((r) => [String(r[localKey]), num(r.logFC)]));
    const pairs = author.filter((r) => Number.isFinite(num(r[String(spec.authorEffect)])) && mine.has(String(r[String(spec.authorKey)])));
    const agree = pairs.filter((r) => Math.sign(num(r[String(spec.authorEffect)]) * Number(spec.orientationSign)) === Math.sign(mine.get(String(r[String(spec.authorKey)]))!)).length;
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${id}: ${author.length} author rows, ${pairs.length} paired, ${agree} same direction${specIds.has(id) ? ' [replaces existing spec]' : ''}`);
  } catch (e) { errs.push((e as Error).message); console.log(`FAIL ${id}`); }
  errs.forEach((e) => console.log(`     ${e}`));
  if (errs.length) failed++;
}
process.exitCode = failed ? 1 : 0;
