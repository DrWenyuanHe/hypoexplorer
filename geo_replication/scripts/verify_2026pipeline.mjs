// Independent end-to-end verification of the 6 tracker-pipeline datasets.
// Checks, against the ACTUAL files (not any summary): config integrity, every
// samplesheet sample present in its matrix, group sizes, DE sanity, and that the
// pathway/panel numbers match what was reported. Exit non-zero on any failure.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve('geo_replication');
const readGzHeader = (p) => gunzipSync(readFileSync(p)).toString().split('\n', 1)[0].replace(/\r$/, '');
const readGz = (p) => gunzipSync(readFileSync(p)).toString();
const sniff = (line) => (line.includes('\t') ? '\t' : ',');

// What I reported, to be checked against the files (NES, padj, IGFBPs-down/detected).
// Seeded (reproducible) fgsea values from the final scorecard. NES is checked with a
// small tolerance and, more importantly, the VERDICT bucket (sign + significance).
const REPORTED = {
  GSE236077: { nes: 1.04, padj: 0.61, ndown: 3, ndet: 4, nctrl: 6, ncase: 6, verdict: 'opposite' },
  GSE247825: { nes: -1.18, padj: 0.414, ndown: 3, ndet: 4, nctrl: 12, ncase: 12, verdict: 'down_ns' },
  GSE282067: { nes: -1.39, padj: 1.0, ndown: 0, ndet: 0, nctrl: 4, ncase: 4, verdict: 'down_ns' },
  GSE292416: { nes: 0.99, padj: 0.688, ndown: 3, ndet: 4, nctrl: 4, ncase: 4, verdict: 'opposite' },
  GSE294478: { nes: -1.81, padj: 0.00081, ndown: 4, ndet: 4, nctrl: 3, ncase: 3, verdict: 'replicates' },
  GSE305719: { nes: 1.48, padj: 0.257, ndown: 3, ndet: 4, nctrl: 6, ncase: 6, verdict: 'opposite' },
};
const bucket = (nes, padj) => (nes < 0 && padj < 0.05 ? 'replicates' : nes < 0 ? 'down_ns' : 'opposite');
const IGFBP = ['IGFBP2', 'IGFBP5', 'IGFBP6', 'IGFBP7'];

const cfgLines = readFileSync(path.join(ROOT, 'config/datasets.tsv'), 'utf8').trim().split('\n');
const cfgHead = cfgLines[0].split('\t');
const cfg = cfgLines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cfgHead[i], v])));

let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL: ' + msg); } };

for (const id of Object.keys(REPORTED)) {
  console.log(`\n==== ${id} ====`);
  const r = cfg.find((c) => c.id === id);
  check(!!r, `${id} present in config`);
  if (!r) continue;
  const dir = path.join(ROOT, r.dir);
  const inp = path.join(ROOT, r.input_path);
  const ss = path.join(ROOT, r.samplesheet);

  // 1. inputs exist
  let header, sscontent;
  try { header = readGzHeader(inp); } catch { check(false, `matrix readable: ${r.input_path}`); continue; }
  try { sscontent = readFileSync(ss, 'utf8'); } catch { check(false, `samplesheet readable: ${r.samplesheet}`); continue; }

  // 2. samplesheet samples all present as matrix columns; group sizes
  const cols = new Set(header.split(sniff(header)));
  const ssRows = sscontent.trim().split('\n').slice(1).map((l) => l.split('\t'));
  const samples = ssRows.map((c) => ({ sample: c[0], group: c[1] }));
  const missing = samples.filter((s) => !cols.has(s.sample)).map((s) => s.sample);
  check(missing.length === 0, `${id}: all samples in matrix (missing: ${missing.join(',')})`);
  const nctrl = samples.filter((s) => s.group === 'control').length;
  const ncase = samples.filter((s) => s.group === 'case').length;
  check(nctrl === REPORTED[id].nctrl && ncase === REPORTED[id].ncase,
    `${id}: group sizes ${nctrl}v${ncase} == reported ${REPORTED[id].nctrl}v${REPORTED[id].ncase}`);

  // 3. DE sanity
  const de = readGz ? null : null; // DE files are plain tsv (not gz)
  const dePath = path.join(dir, 'processed', `${id}_DE.tsv`);
  const deTxt = readFileSync(dePath, 'utf8').trim().split('\n');
  const deHead = deTxt[0].split('\t');
  const si = deHead.indexOf('stat'), li = deHead.indexOf('logFC');
  const nonFinite = deTxt.slice(1).filter((l) => { const f = l.split('\t'); return !Number.isFinite(+f[si]) || !Number.isFinite(+f[li]); }).length;
  check(deTxt.length - 1 > 4000 || id === 'GSE282067', `${id}: DE gene count ${deTxt.length - 1} plausible`);
  check(nonFinite === 0, `${id}: DE has ${nonFinite} non-finite stat/logFC rows (want 0)`);

  // 4. pathway NES/padj match report
  const fg = readFileSync(path.join(dir, 'processed', `${id}_fgsea.tsv`), 'utf8').trim().split('\n');
  const fgHead = fg[0].split('\t');
  const pi = fgHead.indexOf('pathway'), ni = fgHead.indexOf('NES'), pj = fgHead.indexOf('padj');
  const row = fg.slice(1).map((l) => l.split('\t')).find((f) => /IGF_TRANSPORT_AND_UPTAKE/.test(f[pi]));
  check(!!row, `${id}: IGF-transport pathway row present`);
  if (row) {
    const nes = +row[ni], padj = +row[pj];
    check(Math.abs(nes - REPORTED[id].nes) < 0.03, `${id}: NES ${nes.toFixed(3)} ~= reported ${REPORTED[id].nes}`);
    const padjOk = Math.abs(padj - REPORTED[id].padj) < Math.max(0.02, REPORTED[id].padj * 0.1);
    check(padjOk, `${id}: padj ${padj.toExponential(3)} ~= reported ${REPORTED[id].padj}`);
    check(bucket(nes, padj) === REPORTED[id].verdict, `${id}: verdict '${bucket(nes, padj)}' == reported '${REPORTED[id].verdict}'`);
  }

  // 5. panel IGFBP directions match report
  const pan = readFileSync(path.join(dir, 'processed', `${id}_panel.tsv`), 'utf8').trim().split('\n');
  const panHead = pan[0].split('\t');
  const syi = panHead.indexOf('symbol'), di = panHead.indexOf('direction');
  const igfbps = pan.slice(1).map((l) => l.split('\t')).filter((f) => IGFBP.includes(f[syi].toUpperCase()));
  const ndet = igfbps.length, ndown = igfbps.filter((f) => f[di] === 'down').length;
  check(ndet === REPORTED[id].ndet && ndown === REPORTED[id].ndown,
    `${id}: IGFBPs ${ndown}/${ndet} down == reported ${REPORTED[id].ndown}/${REPORTED[id].ndet}`);
}

console.log(`\n================ ${fail === 0 ? 'ALL CHECKS PASS' : fail + ' CHECK(S) FAILED'} (${pass} passed, ${fail} failed) ================`);
process.exit(fail === 0 ? 0 : 1);
