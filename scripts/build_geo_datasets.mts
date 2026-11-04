// Build explorer bundles for the two tier-1 mouse HFD hypothalamus datasets from
// the local geo_replication analysis outputs (DE tables + per-sample expression).
//
// Datasets (the "tier 1" / powered sets from the committee deck):
//   GSE220533 — whole hypothalamus, WT chow (n=7) vs HFD (n=8); limma on log-normalized expr.
//   GSE225038 — arcuate bulk, Control chow (n=3) vs HFD (n=4); edgeR-QL on raw counts → TMM CPM.
//
// Since the R 4.6.0 regeneration (2026-09-25) both read the symbol-level tables
// the DE run wrote (scripts/lib/regenTables.mts): <id>_DE.tsv keyed by symbol,
// GSE220533_expression.tsv.gz (deposited log scale, duplicate symbols averaged
// before the fit) and GSE225038_CPM_TMM.tsv.gz (the fit's own TMM CPM). Nothing
// is deduplicated or summed here; a duplicate symbol throws.
//
// Output (contract-shaped, see docs/DATASET_CONTRACT.md):
//   public/datasets/<id>/meta.js        -> HX_<DSID>_META
//   public/datasets/<id>/track_<t>.js   -> HX_<DSID>_<TRACK>
//   public/datasets/<id>/qc_global.js   -> HX_<DSID>_QC
//
// Genotype subsetting matches the published DE contrast exactly (KO arms excluded).
// FGSEA is computed by scripts/run_mouse_fgsea.R and read here (readPathways) →
// supportsPathways:true; per-gene logFC SE is recovered via seFromStat.
//
// Run: tsx scripts/build_geo_datasets.mts
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRectangular } from './lib/matrixShape.mjs';
import { rankScore, numCell } from './lib/deTable.mjs';
import {
  CPM_TMM_UNIT, readSymbolDe, readSymbolMatrix, readSymbolSe, readTsv,
} from './lib/regenTables.mjs';
import { defaultContrastBinding, outDirFromArgv, requireDataset, writeDatasetBundles } from './lib/bundleWriter.mjs';
import { seFromStat } from '../src/utils/seRecovery';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO = resolve(ROOT, 'geo_replication', 'datasets');
const OUT_ROOT = outDirFromArgv();

const log = (...a) => console.log(...a);
function readMaybeGz(path) {
  const buf = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}
function parseDelim(text, delim, label = 'matrix') {
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const header = lines[0].split(delim);
  const parsed = lines.slice(1).map(l => l.split(delim));
  assertRectangular(label, header, parsed[0]);
  return { header, rows: parsed };
}
// rankScore and numCell now live in scripts/lib/deTable.mts, with the header
// contract they belong beside — this file used to carry its own copies and no
// header assertion at all.
/**
 * Per-gene SE from scripts/compute_edger_se.R, keyed by symbol (the regenerated
 * DE id). edgeR-QL SEs cannot be derived from the reported statistic (see
 * src/utils/seRecovery.ts), so a dataset without this sidecar emits no `se` and
 * abstains from inverse-variance pooling rather than entering it on a proxy.
 * limma datasets need no sidecar — their |logFC|/|t| is the moderated SE.
 */
function readSeSidecar(base: string, geoId: string): Map<string, number> {
  return readSymbolSe(resolve(base, 'processed', `${geoId}_SE.tsv`), `${geoId}_SE.tsv`);
}

/** Symbol-keyed DE rows with their SE; one row per public symbol. */
function readDeRows(base: string, geoId: string, seBySymbol: Map<string, number>) {
  return readSymbolDe(resolve(base, 'processed', `${geoId}_DE.tsv`), `${geoId}_DE.tsv`).map((d) => ({
    gene: d.gene, logFC: +d.logFC.toFixed(4), logCPM: null, PValue: d.PValue, FDR: d.FDR,
    se: seFromStat(d.logFC, d.stat, d.method, seBySymbol.get(d.gene)), rank_score: rankScore(d.logFC, d.FDR),
  }));
}

/** Arm samples from the committed samplesheet (group = control | case). */
function samplesheetArms(base: string, geoId: string): { control: string[]; caseS: string[] } {
  const { header, rows } = readTsv(resolve(base, 'metadata', `${geoId}_samplesheet.tsv`));
  const si = header.indexOf('sample'), gi = header.indexOf('group');
  return {
    control: rows.filter((r) => r[gi] === 'control').map((r) => r[si]),
    caseS: rows.filter((r) => r[gi] === 'case').map((r) => r[si]),
  };
}

// Read FGSEA tables (scripts/run_mouse_fgsea.R) into a PathwayDatabase; null if absent.
const PW_DBS = ['GO_BP', 'HALLMARK', 'KEGG', 'REACTOME'];
function readPathways(base, geoId) {
  const out = {};
  for (const db of PW_DBS) {
    const p = resolve(base, 'processed', `${geoId}_FGSEA_${db}.tsv`);
    if (!existsSync(p)) continue;
    const t = parseDelim(readMaybeGz(p), '\t', p);
    const ix = Object.fromEntries(t.header.map((h, i) => [h, i]));
    out[db] = t.rows.map((row) => {
      const NES = numCell(row[ix.NES]);
      return {
        pathway: row[ix.pathway], pval: numCell(row[ix.pval]), padj: numCell(row[ix.padj]),
        NES: Number.isFinite(NES) ? +NES.toFixed(4) : NES, size: +row[ix.size],
        leadingEdge: (row[ix.leadingEdge] ?? '').split(';').filter(Boolean),
      };
    }).filter((p) => Number.isFinite(p.pval) && Number.isFinite(p.padj) && Number.isFinite(p.NES));
  }
  return Object.keys(out).length ? out : null;
}
function finalizeTrack(deRows, cpmBySymbol, { trackId, label, type, armKeys, chowSamples, hfdSamples, expressionUnit }) {
  // Every published DE symbol must have expression values (the DE rows are
  // already unique per symbol); sort by rank_score desc, assign rankPos.
  const absent = deRows.filter(d => !cpmBySymbol[d.gene]).map(d => d.gene);
  if (absent.length) throw new Error(`${trackId}: ${absent.length} DE symbol(s) without expression values: ${absent.slice(0, 5).join(', ')}`);
  const de = [...deRows]
    .sort((a, b) => b.rank_score - a.rank_score)
    .map((d, i) => ({ ...d, rankPos: i + 1 }));
  const cpm = {};
  for (const d of de) cpm[d.gene] = cpmBySymbol[d.gene];
  const sampleOrder = [...chowSamples, ...hfdSamples];
  const meta = {
    code: trackId, label, type, nGenes: de.length,
    sampleOrder,
    groupSamples: { [armKeys[0]]: chowSamples, [armKeys[1]]: hfdSamples },
    expressionUnit,
  };
  const qc = {
    cluster: trackId, clusterLabel: label, minCells: 0,
    nNormal: chowSamples.length, nObese: hfdSamples.length,
    is3v3: chowSamples.length === hfdSamples.length && chowSamples.length === 3,
    samplesKept: sampleOrder,
  };
  return { meta, qc, de, cpm };
}

// ───────────────────────── GSE220533: whole hypothalamus ─────────────────────────
function buildGSE220533() {
  const dataset = requireDataset('mouse_hypo_hfd_gse220533');
  const trackId = 'whole';
  const armKeys = ['chow', 'hfd'] as const;
  log('GSE220533 (whole hypothalamus, WT chow vs HFD):');
  const base = resolve(GEO, 'GSE220533_mmus_hypothalamus_rnaseq');
  // DE: symbol-keyed (limma on the deposited log-normalized matrix; no SE sidecar).
  const deRows = readDeRows(base, 'GSE220533', new Map());
  const { control: chowSamples, caseS: hfdSamples } = samplesheetArms(base, 'GSE220533');
  log(`  WT chow (${chowSamples.length}): ${chowSamples.join(', ')}`);
  log(`  WT HFD  (${hfdSamples.length}): ${hfdSamples.join(', ')}`);
  // Expression: the symbol-level deposited log matrix the fit used (KO arms excluded).
  const order = [...chowSamples, ...hfdSamples];
  const expr = readSymbolMatrix(resolve(base, 'processed', 'GSE220533_expression.tsv.gz'), order, 'GSE220533 expression');
  const cpmBySymbol = {};
  for (const [g, vals] of expr) cpmBySymbol[g] = vals.map(v => +v.toFixed(4));
  const trackObj = finalizeTrack(deRows, cpmBySymbol, {
    trackId, label: 'Whole hypothalamus', type: 'Tissue', armKeys,
    chowSamples, hfdSamples, expressionUnit: 'log2-normalized',
  });
  const pathways = readPathways(base, 'GSE220533');
  const nSig = trackObj.de.filter(d => d.PValue < 0.01).length;
  // sanity: IGFBP6 logFC should be ~+1.10 (README)
  const ig = trackObj.de.find(d => d.gene === 'Igfbp6');
  log(`  genes: ${trackObj.de.length} | nSig(P<0.01): ${nSig} | Igfbp6 logFC=${ig?.logFC} (README ~+1.10)`);
  writeDatasetBundles(dataset, [{
    trackId, armKeys,
    defaultContrastBinding: defaultContrastBinding(dataset, armKeys),
    color: '#4C78A8', nSig,
    meta: trackObj.meta, qc: trackObj.qc, de: trackObj.de, cpm: trackObj.cpm, pathways,
  }], { outRoot: OUT_ROOT });
  log(`  wrote public/datasets/${dataset.id}/{meta.js, track_${trackId}.js${pathways ? `, track_${trackId}.pathways.js, pathways_index.js` : ''}, qc_global.js}`);
}

// ───────────────────────── GSE225038: arcuate bulk ─────────────────────────
function buildGSE225038() {
  const dataset = requireDataset('mouse_arc_hfd_gse225038');
  const trackId = 'arcuate';
  const armKeys = ['chow', 'hfd'] as const;
  log('GSE225038 (arcuate bulk, Control chow vs HFD):');
  const base = resolve(GEO, 'GSE225038_mmus_arc_bulk_rnaseq');
  const seById = readSeSidecar(base, 'GSE225038');
  const deRows = readDeRows(base, 'GSE225038', seById);
  // Control-genotype libraries only (the KO arms are excluded from the fit).
  const { control: chowSamples, caseS: hfdSamples } = samplesheetArms(base, 'GSE225038');
  log(`  Control chow (${chowSamples.length}): ${chowSamples.join(', ')}`);
  log(`  Control HFD  (${hfdSamples.length}): ${hfdSamples.join(', ')}`);
  const order = [...chowSamples, ...hfdSamples];
  // The DE fit's own TMM CPM (filtered library sizes x TMM factors), per symbol.
  const expr = readSymbolMatrix(resolve(base, 'processed', 'GSE225038_CPM_TMM.tsv.gz'), order, 'GSE225038 CPM_TMM');
  const cpmBySymbol = {};
  for (const [g, vals] of expr) cpmBySymbol[g] = vals.map(v => +v.toFixed(4));
  const trackObj = finalizeTrack(deRows, cpmBySymbol, {
    trackId, label: 'Arcuate nucleus (bulk)', type: 'Tissue', armKeys,
    chowSamples, hfdSamples, expressionUnit: CPM_TMM_UNIT,
  });
  const pathways = readPathways(base, 'GSE225038');
  const nSig = trackObj.de.filter(d => d.PValue < 0.01).length;
  // sanity: Pomc mean CPM ~784, Agrp ~20 (README)
  const mean = a => a.reduce((x, y) => x + (y || 0), 0) / a.length;
  const pomc = (cpmBySymbol as Record<string, number[]>).Pomc, agrp = (cpmBySymbol as Record<string, number[]>).Agrp;
  log(`  genes: ${trackObj.de.length} | nSig(P<0.01): ${nSig} | Pomc mean CPM=${pomc ? mean(pomc).toFixed(0) : 'NA'} (README ~784) | Agrp=${agrp ? mean(agrp).toFixed(0) : 'NA'} (README ~20)`);
  writeDatasetBundles(dataset, [{
    trackId, armKeys,
    defaultContrastBinding: defaultContrastBinding(dataset, armKeys),
    color: '#59A14F', nSig,
    meta: trackObj.meta, qc: trackObj.qc, de: trackObj.de, cpm: trackObj.cpm, pathways,
  }], { outRoot: OUT_ROOT });
  log(`  wrote public/datasets/${dataset.id}/{meta.js, track_${trackId}.js${pathways ? `, track_${trackId}.pathways.js, pathways_index.js` : ''}, qc_global.js}`);
}

buildGSE220533();
buildGSE225038();
log('Done.');
