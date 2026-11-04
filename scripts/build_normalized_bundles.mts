// Build explorer bundles for datasets deposited as ALREADY-NORMALIZED matrices.
//
// The batch builders (build_geo_datasets, build_explorer_bundles_batch2) all
// start from raw counts and produce CPM. A GEO series that never deposited
// counts cannot go through them: there is no library size to divide by, and
// relabelling FPKM as "CPM" to fit the pipeline would put a wrong unit on every
// axis and every export in the app. This builder is that second route —
// log2(value + 1) on the submitters' own scale, reported under the registry's
// unit, which names the deposited scale (log2(FPKM + 1), log2(normalized CPM + 1)).
//
// One entry per dataset. Reads the committed DE table + samplesheet under
// geo_replication/ and, since the R 4.6.0 regeneration (2026-09-25), the
// symbol-level <id>_expression.tsv.gz the DE run wrote: the deposited linear
// values with duplicate symbols summed BEFORE the fit (scripts/lib/regenTables.mts).
// The DE tables are keyed by symbol and unique, so nothing is collapsed or
// deduplicated here; a duplicate throws. Writes the four files the app loads:
//   public/datasets/<id>/{meta.js, qc_global.js, track_<t>.js, track_<t>.pathways.js, pathways_index.js}
//
// Usage: npx tsx scripts/build_normalized_bundles.mts [--dry]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { defaultContrastBinding, outDirFromArgv, requireDataset, writeDatasetBundles } from './lib/bundleWriter.mjs';
import { assertUniqueKeys, readSymbolDe, readSymbolMatrix, readTsv } from './lib/regenTables.mjs';
import { seFromStat } from '../src/utils/seRecovery';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = resolve(ROOT, 'geo_replication');
const DRY = process.argv.includes('--dry');
const OUT_ROOT = outDirFromArgv();
const log = (m: string) => process.stdout.write(`${m}\n`);

interface Entry {
  geoId: string;
  dir: string;
  datasetId: string;
  trackId: string;
  armKeys: readonly [string, string];
  trackLabel: string;
  color: string;
  /**
   * Symbol-level expression written by the DE run (processed/<file>): deposited
   * linear values, sample columns named exactly as in the samplesheet.
   */
  expression: string;
  /**
   * Factorial-design extension (multi-contrast bundles). `cellGroupOf` maps a
   * samplesheet row to the sample's design-cell group key (e.g. chow_p0) —
   * these keys land in meta.groupSamples BESIDE the pooled control/case arms,
   * so a sample legitimately appears in two groups (its pooled arm and its
   * cell). `extraContrasts` names the non-default contrasts and the DE/FGSEA
   * file prefix each was written under (processed/<prefix>_DE.tsv +
   * <prefix>_FGSEA_<DB>.tsv); ids must match the dataset's manifest contrasts
   * in src/data/datasets.ts, since deByContrast/pathwaysByContrast are keyed
   * by them.
   */
  cellGroupOf?: (row: Record<string, string>) => string | null;
  defaultContrastBinding?: { id: string; baseline: string; case: string };
  extraContrasts?: Array<{ id: string; prefix: string; baseline: string; case: string }>;
  /**
   * File prefix of the DEFAULT contrast's DE + FGSEA tables, when it is not the
   * bare accession. The bundle format keeps the default contrast's table in
   * `de` (and its enrichment in the pathway sibling's `default`), with only the
   * OTHERS in deByContrast/byContrast — see buildPopData. So "which contrast is
   * default" is a fact about file naming here, not only about `isDefault` in
   * the registry, and the two must agree.
   *
   * Defaults to `geoId`, which is the single-contrast case: one <geoId>_DE.tsv.
   */
  defaultPrefix?: string;
}

const ENTRIES: Entry[] = [
  {
    geoId: 'GSE157077',
    dir: 'GSE157077_mmus_scn_hfd',
    datasetId: 'mouse_scn_hfd_gse157077',
    trackId: 'scn',
    armKeys: ['control', 'case'],
    trackLabel: 'Suprachiasmatic nucleus (SCN)',
    color: '#59A14F',
    // de_gse157077_r460.R joins the two per-arm FPKM matrices and names the
    // libraries "Chow ZT0 rep1" / "HFD ZT0 rep1", as the samplesheet does.
    expression: 'GSE157077_expression.tsv.gz',
  },
  {
    geoId: 'GSE135639',
    dir: 'GSE135639_mmus_pomc_maternal_hfd',
    datasetId: 'mouse_pomc_maternal_hfd_gse135639',
    trackId: 'pomc',
    armKeys: ['control', 'case'],
    trackLabel: 'Arcuate POMC neurons (RiboTag)',
    color: '#D37295',
    // ONE deposited matrix (GSE135639_Newborn.txt.gz) holds all 17 libraries,
    // both the P0 and the P21 arms; the DE run writes its symbol-level form
    // with the matrix's own column names, which the samplesheet also uses.
    expression: 'GSE135639_expression.tsv.gz',
    // The 2x2 (maternal diet × collection age). Cell keys must match the group
    // keys in src/data/datasets.ts; the samplesheet's `age` column (P0/P21) is
    // written by de_gse135639.R from the same factor the fits used.
    cellGroupOf: (row) => {
      const arm = row.group === 'control' ? 'chow' : 'hfd';
      if (row.age !== 'P0' && row.age !== 'P21') {
        throw new Error(`GSE135639: samplesheet row "${row.sample}" has age "${row.age}" (want P0/P21)`);
      }
      return `${arm}_${row.age.toLowerCase()}`;
    },
    // The default used to be the age-adjusted `~ age + diet` fit, written as the
    // bare GSE135639_DE.tsv. That contrast was removed (see de_gse135639.R), so
    // the default is now the P21 cell contrast and dietP21 is therefore ABSENT
    // from extraContrasts below — it ships in `de`, not in deByContrast.
    defaultPrefix: 'GSE135639_dietP21',
    defaultContrastBinding: { id: 'hfd_vs_chow_p21', baseline: 'chow_p21', case: 'hfd_p21' },
    extraContrasts: [
      { id: 'hfd_vs_chow_p0', prefix: 'GSE135639_dietP0', baseline: 'chow_p0', case: 'hfd_p0' },
      { id: 'p21_vs_p0_chow', prefix: 'GSE135639_ageChow', baseline: 'chow_p0', case: 'chow_p21' },
      { id: 'p21_vs_p0_hfd', prefix: 'GSE135639_ageHFD', baseline: 'hfd_p0', case: 'hfd_p21' },
    ],
  },
];

const readText = (p: string) => {
  const buf = readFileSync(p);
  return p.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
};
const rows = (text: string, sep: string | RegExp = '\t') =>
  text.trim().split(/\r?\n/).map((l) => l.split(sep as string).map((c) => c.replace(/^"(.*)"$/, '$1')));

/** Signed -log10(FDR), capped — the macaque rank_score semantics. */
function rankScore(logFC: number, fdr: number): number {
  const s = Math.sign(logFC) || 1;
  // `Number(fdr) || 1` treated an FDR of exactly 0 as 1, because 0 is falsy —
  // so a gene whose q-value underflowed came out at rank_score 0, i.e. sorted
  // LAST among significant genes instead of first. Latent today (no committed
  // table has an exact 0) and wrong the moment one does.
  const f = Number(fdr);
  const v = s * -Math.log10(Math.max(Number.isFinite(f) ? f : 1, 1e-300));
  return Math.max(-1000, Math.min(1000, +v.toFixed(4)));
}

const numCell = (v: string | undefined): number => {
  const t = (v ?? '').trim();
  return t === '' || t === 'NA' || t === 'NaN' ? Number.NaN : Number(t);
};

const PW_DBS = ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'] as const;

/**
 * Refuse pathway tables that predate the DE table they were ranked from.
 *
 * FGSEA ranks on the DE `stat` column, so a pathway file is only meaningful
 * against the DE table that produced it — but the two are separate files joined
 * by filename, with nothing tying them together. Re-run a DE script without
 * re-running FGSEA (easy: run_mouse_fgsea.R deliberately SKIPS a dataset that
 * already has output) and the bundle ships a current volcano beside pathways
 * computed from the previous fit, with no visible symptom.
 *
 * Modification time is a coarse witness — a checkout or a copy reorders it
 * without either file changing, and touching a DE table without rerunning it
 * would trip this — so the message says MAY be stale, not is. It is a tripwire
 * for the ordering that actually goes wrong in practice, not provenance. The
 * real fix is a DE-content hash recorded when FGSEA is generated and checked
 * here; until that exists this catches the common case.
 */
function assertPathwaysFresh(dir: string, geoId: string): void {
  const dePath = resolve(dir, `${geoId}_DE.tsv`);
  if (!existsSync(dePath)) return;
  const deAt = statSync(dePath).mtimeMs;
  for (const db of PW_DBS) {
    const p = resolve(dir, `${geoId}_FGSEA_${db}.tsv`);
    if (!existsSync(p)) continue;
    if (statSync(p).mtimeMs < deAt) {
      throw new Error(
        `${geoId}: ${geoId}_FGSEA_${db}.tsv is older than ${geoId}_DE.tsv, so it MAY have been ranked `
        + 'from a previous fit. Delete the FGSEA tables and re-run scripts/run_mouse_fgsea.R '
        + '(it skips datasets that already have output, so stale files are never overwritten). '
        + 'If the DE table was only touched and not regenerated, re-running is still the cheap fix.',
      );
    }
  }
}

function readPathways(dir: string, geoId: string) {
  assertPathwaysFresh(dir, geoId);
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const db of PW_DBS) {
    const p = resolve(dir, `${geoId}_FGSEA_${db}.tsv`);
    if (!existsSync(p)) continue;
    const r = rows(readText(p));
    const h = r[0];
    const idx = (n: string) => h.indexOf(n);
    out[db] = r.slice(1).map((c) => ({
      pathway: c[idx('pathway')],
      pval: numCell(c[idx('pval')]),
      padj: numCell(c[idx('padj')]),
      NES: +Number(numCell(c[idx('NES')])).toFixed(4),
      size: Number(numCell(c[idx('size')])) || 0,
      leadingEdge: (c[idx('leadingEdge')] ?? '').split(';').filter(Boolean),
    })).filter((p) => p.pathway && Number.isFinite(p.pval));
  }
  return Object.keys(out).length ? out : null;
}

function build(e: Entry) {
  const dataset = requireDataset(e.datasetId);
  // The bundle states the registry's unit, which must name the transform applied
  // here (log2 of the deposited value + 1), e.g. 'log2(FPKM + 1)'.
  if (!dataset.expressionUnit?.startsWith('log2(') || !dataset.expressionUnit.endsWith(' + 1)')) {
    throw new Error(`${e.geoId}: registry unit "${dataset.expressionUnit}" does not name log2(value + 1)`);
  }
  const base = resolve(GEO, 'datasets', e.dir);

  // ── DE table(s) ───────────────────────────────────────────────────────────
  // One reader for the default table and every extra contrast's table — they
  // are written by the same R script in the same schema, and a schema drift
  // between them should fail loudly here, not ship half-parsed.
  const readDeRows = (prefix: string) =>
    readSymbolDe(resolve(base, 'processed', `${prefix}_DE.tsv`), `${prefix}_DE.tsv`)
      .filter((d) => Number.isFinite(d.logFC) && Number.isFinite(d.PValue))
      .map((d) => ({
        gene: d.gene,
        logFC: +d.logFC.toFixed(4),
        logCPM: null,
        PValue: d.PValue,
        FDR: d.FDR,
        se: seFromStat(d.logFC, d.stat, d.method),
        rank_score: rankScore(d.logFC, d.FDR),
      }));
  const deRows = readDeRows(e.defaultPrefix ?? e.geoId);

  // ── samplesheet ───────────────────────────────────────────────────────────
  const ss = rows(readText(resolve(base, 'metadata', `${e.geoId}_samplesheet.tsv`)));
  const sh = ss[0];
  const si = sh.indexOf('sample');
  const gi = sh.indexOf('group');
  const ssRows = ss.slice(1).map((c) => Object.fromEntries(sh.map((h, i) => [h, c[i] ?? ''])));
  const control = ss.slice(1).filter((c) => c[gi] === 'control').map((c) => c[si]);
  const caseS = ss.slice(1).filter((c) => c[gi] === 'case').map((c) => c[si]);
  const order = [...control, ...caseS];

  // ── design-cell groups (factorial datasets only) ──────────────────────────
  // Each sample must land in exactly ONE cell, and cell keys must not shadow
  // the pooled arm keys — meta.groupSamples carries both side by side.
  const cellSamples: Record<string, string[]> = {};
  if (e.cellGroupOf) {
    for (const row of ssRows) {
      const key = e.cellGroupOf(row);
      if (!key) continue;
      if (e.armKeys.includes(key)) {
        throw new Error(`${e.geoId}: cell group key "${key}" shadows a pooled arm key`);
      }
      if (!cellSamples[key]) cellSamples[key] = [];
      cellSamples[key].push(row.sample);
    }
    const cellTotal = Object.values(cellSamples).reduce((a, s) => a + s.length, 0);
    if (cellTotal !== order.length) {
      throw new Error(
        `${e.geoId}: design cells hold ${cellTotal} samples but the samplesheet has ${order.length} — `
        + 'cellGroupOf must place every sample in exactly one cell.',
      );
    }
  }

  // ── expression: log2(value + 1) on the deposited scale ────────────────────
  //
  // The DE run already joined the per-arm matrices and summed duplicate
  // symbols on the linear scale before fitting, so its <id>_expression.tsv.gz is
  // exactly the matrix the DE rows describe.
  //
  // The samplesheet and the matrix must agree in BOTH directions: a library
  // that drops out of the samplesheet would otherwise vanish from the bars and
  // the arm counts with nothing to show that it did.
  const exprPath = resolve(base, 'processed', e.expression);
  const columnIds = readTsv(exprPath).header.slice(1);
  assertUniqueKeys(columnIds, `${e.geoId}: ${e.expression} columns`);
  assertUniqueKeys(order, `${e.geoId}: samplesheet ids`);
  const bothArms = control.filter((id) => caseS.includes(id));
  if (bothArms.length) {
    throw new Error(`${e.geoId}: sample(s) assigned to BOTH arms: ${bothArms.slice(0, 3).join(', ')}`);
  }
  const unclaimed = columnIds.filter((id) => !order.includes(id));
  if (unclaimed.length) {
    throw new Error(
      `${e.geoId}: the matrix has ${unclaimed.length} column(s) the samplesheet does not assign to an arm: `
      + `${unclaimed.slice(0, 3).join(', ')}. Either the samplesheet lost a library or the matrix gained one; `
      + 'both would silently change the arms the bundle reports.',
    );
  }
  const linear = readSymbolMatrix(exprPath, order, `${e.geoId}: ${e.expression}`);
  const expr: Record<string, Array<number | null>> = {};
  for (const [symbol, vals] of linear) {
    expr[symbol] = vals.map((v) => +Math.log2(v + 1).toFixed(4));
  }

  // ── finalize: every DE symbol has values (rows are already unique), rank ──
  const finalizeDe = (rowsIn: typeof deRows) => {
    const absent = rowsIn.filter((d) => !expr[d.gene]).map((d) => d.gene);
    if (absent.length) {
      throw new Error(`${e.geoId}: ${absent.length} DE symbol(s) missing from ${e.expression}: ${absent.slice(0, 5).join(', ')}`);
    }
    return [...rowsIn]
      .sort((a, b) => b.rank_score - a.rank_score)
      .map((d, i) => ({ ...d, rankPos: i + 1 }));
  };
  const deFinal = finalizeDe(deRows);
  const cpm: Record<string, Array<number | null>> = {};
  for (const d of deFinal) cpm[d.gene] = expr[d.gene];

  // Extra contrasts: same finalize (so every table is rank-sorted with the
  // rankPos invariant bundleSlim drops), same expression gate — the cpm matrix
  // is shared, keyed by the DEFAULT table's genes, and the extra tables cover
  // the same fitted symbols by construction (one filter, one fit input).
  const deByContrast: Record<string, ReturnType<typeof finalizeDe>> = {};
  for (const c of e.extraContrasts ?? []) {
    deByContrast[c.id] = finalizeDe(readDeRows(c.prefix));
  }

  const trackObj = {
    meta: {
      code: e.trackId, label: e.trackLabel, type: 'Tissue', nGenes: deFinal.length,
      sampleOrder: order,
      groupSamples: { [e.armKeys[0]]: control, [e.armKeys[1]]: caseS, ...cellSamples },
      expressionUnit: dataset.expressionUnit,
    },
    qc: {
      cluster: e.trackId, clusterLabel: e.trackLabel, minCells: 0,
      nNormal: control.length, nObese: caseS.length,
      is3v3: control.length === caseS.length && control.length === 3,
      samplesKept: order,
    },
    de: deFinal,
    ...(Object.keys(deByContrast).length ? { deByContrast } : {}),
    cpm,
  };
  const pathways = readPathways(resolve(base, 'processed'), e.defaultPrefix ?? e.geoId);
  const pathwaysByContrast: Record<string, NonNullable<ReturnType<typeof readPathways>>> = {};
  for (const c of e.extraContrasts ?? []) {
    const p = readPathways(resolve(base, 'processed'), c.prefix);
    if (p) pathwaysByContrast[c.id] = p;
  }
  const nSig = deFinal.filter((d) => Number.isFinite(d.FDR) && d.FDR < 0.05).length;

  log(`\n[${e.datasetId}]`);
  const controlLabel = dataset.groups.find((group) => group.key === e.armKeys[0])?.label ?? e.armKeys[0];
  const caseLabel = dataset.groups.find((group) => group.key === e.armKeys[1])?.label ?? e.armKeys[1];
  log(`  arms          : ${control.length} ${controlLabel} + ${caseS.length} ${caseLabel}`);
  if (Object.keys(cellSamples).length) {
    log(`  design cells  : ${Object.entries(cellSamples).map(([k, s]) => `${k}:${s.length}`).join(' ')}`);
  }
  log(`  genes         : ${deFinal.length} (of ${deRows.length} DE rows)`);
  log(`  FDR < 0.05    : ${nSig}`);
  for (const [cid, table] of Object.entries(deByContrast)) {
    const n = table.filter((d) => Number.isFinite(d.FDR) && (d.FDR as number) < 0.05).length;
    log(`  contrast ${cid}: ${table.length} genes, FDR<0.05: ${n}`);
  }
  log(`  pathways      : ${pathways ? PW_DBS.filter((d) => pathways[d]?.length).map((d) => `${d}:${pathways[d].length}`).join(' ') : 'none'}`);
  for (const [cid, block] of Object.entries(pathwaysByContrast)) {
    log(`  pathways ${cid}: ${PW_DBS.filter((d) => block[d]?.length).map((d) => `${d}:${block[d].length}`).join(' ')}`);
  }
  const top = deFinal.slice(0, 5).map((d) => `${d.gene}(${d.logFC > 0 ? '+' : ''}${d.logFC})`).join(' ');
  log(`  top by rank   : ${top}`);

  if (DRY) return;

  writeDatasetBundles(dataset, [{
    trackId: e.trackId,
    armKeys: e.armKeys,
    defaultContrastBinding: e.defaultContrastBinding ?? defaultContrastBinding(dataset, e.armKeys),
    extraContrastBindings: (e.extraContrasts ?? []).map(({ id, baseline, case: caseKey }) => ({
      id, baseline, case: caseKey,
    })),
    color: e.color,
    nSig,
    meta: trackObj.meta,
    qc: trackObj.qc,
    de: deFinal,
    deByContrast,
    cpm,
    pathways,
    pathwaysByContrast,
  }], { outRoot: OUT_ROOT });
  log(`  wrote         : public/datasets/${e.datasetId}/`);
}

log(`Building normalized-matrix bundles${DRY ? ' (dry run)' : ''}…`);
for (const e of ENTRIES) build(e);
log('\nDone.');
