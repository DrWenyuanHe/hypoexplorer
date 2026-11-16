// September 5 intake bundle builder. Since the R 4.6.0 regeneration (2026-09-25) per-sample
// values come from data/intake/regeneration-r460-2026-09-25.json (TMM CPM for count analyses),
// DE tables are keyed by symbol and must be unique, and every DE symbol must have values.
// Staging, --check and the registry merge are buildIntakeStudies'; the writer derives each
// track's QC counts and the merged study files.
//   npx tsx scripts/build_september5_bundles.mts [--check] [--only=GSE1,GSE2]
import { readFileSync } from 'node:fs';
import { CPM_TMM_UNIT, assertUniqueKeys, publicSymbol } from './lib/regenTables.mjs';
import { rankScore } from './lib/deTable.mjs';
import { readVerifiedFgseaSet } from './lib/fgseaProvenance.mjs';
import { buildIntakeStudies, intakeArgs, intakePath, readIntakeTable, type IntakeHooks } from './lib/intakeStudies.mjs';
import type { TrackBundlePayload } from './lib/bundleWriter.mjs';
import type { PathwayDatabase } from '../src/types';

const ROOT = process.cwd();
const DIR = 'data/intake/september5-2026';
const readJson = (path: string): any => JSON.parse(readFileSync(intakePath(ROOT, path), 'utf8'));
const studies = readJson(`${DIR}/studies.json`);
const analyses = readJson(`${DIR}/analyses.json`);
const ledger = readJson(`${DIR}/ledger.json`).records;
const colors = ['#3775BA', '#B64342', '#44996B', '#9765AE'];
// Regenerated per-sample value tables (R 4.6.0, 2026-09-25): the intake's own
// analyses.json is byte-preserved and still names the pre-regeneration CPM files.
const regeneration = readJson('data/intake/regeneration-r460-2026-09-25.json')
  .intakes['september5-2026'] as Record<string, { values: string; kind: 'cpm_tmm' | 'matrix'; replaces: string }>;
function valuesPath(analysis: any): string {
  const entry = regeneration[analysis.analysisId];
  if (!entry || entry.replaces !== analysis.cpm) {
    throw new Error(`${analysis.analysisId}: no regeneration value table for ${analysis.cpm}`);
  }
  return entry.values;
}
const table = (path: string) => readIntakeTable(ROOT, path);
function number(value: string, context: string): number {
  if (!value || value === 'NA') throw new Error(`Missing number: ${context}`);
  const n = Number(value); if (!Number.isFinite(n)) throw new Error(`Invalid number: ${context}`); return n;
}
function pathways(s: any, analysis: any): PathwayDatabase {
  return readVerifiedFgseaSet(intakePath(ROOT, `${s.dir}/processed/${analysis.analysisId}_DE.tsv`),
    {expectedSpecies:s.organism}).publicBlock;
}
function definition(s: any): any {
  const region = s.region.startsWith('Paraventricular') ? 'Paraventricular nucleus' : s.region;
  const perturbation: Record<string,string> = { 'Circadian & sleep':'Environment & stress', 'Genetic perturbation':'Genetic',
    'Disease model':'Genetic', 'Inflammation & immune':'Environment & stress' };
  return { id:s.id, name:s.name, organism:s.organism, category:s.category, region,
    preparation:s.preparation==='TRAP / RiboTag'?'Translatome':s.preparation,
    perturbation:perturbation[s.perturbation]??s.perturbation, modality:s.modality,
    featureType:'gene',featureLabel:'Gene',supportsPathways:true,isDefault:false,defaultTrack:s.tracks[0].id,
    trackNoun:s.tracks.length>1?'population':'track',trackCategoryOrder:['Tissue'],
    // The generated registry is pinned by retained evidence, so it keeps the intake's legacy
    // 'CPM' label; src/data/datasets.ts reads it as CPM_TMM_UNIT for these count studies.
    expressionUnit:s.expressionUnit??'CPM',
    citation:s.note,geo:s.accession,doi:s.doi??'',pmid:s.pmid||ledger.find((r:any)=>r.accession===s.accession)?.pubmed?.[0]||'',
    groups:s.groups.map((g:any,i:number)=>({...g,color:colors[i%colors.length]})),
    contrasts:s.contrasts.map((c:any,i:number)=>({id:c.id,label:c.label,baseline:c.baseline,case:c.case,isDefault:i===0})),
  };
}

function buildTrack(s: any, tr: any, index: number): { payload: TrackBundlePayload; genes: number } {
  const active=analyses.filter((a:any)=>a.accession===s.accession&&a.track===tr.id);
  if(active.length!==s.contrasts.length) throw new Error(`${s.accession}/${tr.id}: incomplete analyses`);
  const sheet=table(tr.samplesheet).filter(x=>x.included==='True'||x.included==='TRUE');
  const groupSamples=Object.fromEntries(s.groups.map((g:any)=>[g.key,sheet.filter(x=>x.group===g.key).map(x=>x.sample)]));
  const sampleOrder=Object.values(groupSamples).flat() as string[];
  const expression=new Map<string,number[]>();
  const valuesFile=valuesPath(active[0]);
  for(const a of active) if(valuesPath(a)!==valuesFile) throw new Error(`${a.analysisId}: analyses of one track read different value tables`);
  for(const row of table(valuesFile)) {
    // Unique per public symbol since the regeneration; an unmapped id is hidden.
    const gene=publicSymbol(row.gene_id,valuesFile);if(!gene)continue;
    if(expression.has(gene)) throw new Error(`${s.accession}: colliding public symbol ${gene}`);
    expression.set(gene,sampleOrder.map(x=>number(row[x],`${tr.id}/${gene}/${x}`)));
  }
  const deByContrast:Record<string,any[]>={}; const pathwaysByContrast:Record<string,PathwayDatabase>={};
  for(const co of s.contrasts) {
    const a=active.find((a:any)=>a.contrast===co.id)!;
    const se=new Map(table(`${s.dir}/processed/${a.analysisId}_SE.tsv`).map(r=>[r.id,Number(r.se)]));
    const deTable=table(`${s.dir}/processed/${a.analysisId}_DE.tsv`);
    assertUniqueKeys(deTable.map(r=>r.symbol),`${a.analysisId}_DE.tsv`);
    const rows=deTable.flatMap(r=>{
      if(r.id!==r.symbol) throw new Error(`${a.analysisId}: DE id ${r.id} is not its symbol ${r.symbol}`);
      const gene=publicSymbol(r.symbol,`${a.analysisId}_DE.tsv`);if(!gene)return [];
      if(!expression.has(gene)) throw new Error(`${a.analysisId}: DE symbol ${gene} has no values in ${valuesFile}`);
      const logFC=+number(r.logFC,a.analysisId).toFixed(4),FDR=number(r.padj,a.analysisId);
      return [{gene,logFC,PValue:number(r.pvalue,a.analysisId),FDR,
        ...(se.has(r.id)?{se:se.get(r.id)}:{}),rank_score:rankScore(logFC,FDR)}];
    }).sort((a,b)=>b.rank_score-a.rank_score);
    deByContrast[co.id]=rows;
    pathwaysByContrast[co.id]=pathways(s,a);
  }
  const first=s.contrasts[0]; const de=deByContrast[first.id];delete deByContrast[first.id];
  const pw=pathwaysByContrast[first.id];delete pathwaysByContrast[first.id];
  const genes=new Set([de,...Object.values(deByContrast)].flat().map(r=>r.gene));
  const cpm=Object.fromEntries([...genes].map(g=>[g,expression.get(g)!]));
  const meta={code:tr.id,label:tr.label,type:'Tissue',nGenes:de.length,sampleOrder,groupSamples,expressionUnit:s.expressionUnit??CPM_TMM_UNIT};
  const qc={cluster:tr.id,clusterLabel:tr.label,minCells:sheet.some(r=>r.cells)?Math.min(...sheet.map(r=>Number(r.cells))):0,
    samplesKept:sampleOrder};
  return { genes: genes.size, payload: {
    trackId:tr.id,armKeys:[first.baseline,first.case],defaultContrastBinding:{id:first.id,baseline:first.baseline,case:first.case},
    extraContrastBindings:s.contrasts.slice(1).map((c:any)=>({id:c.id,baseline:c.baseline,case:c.case})),
    color:colors[index%colors.length],meta,qc,de,deByContrast,cpm,pathways:pw,pathwaysByContrast,
  } };
}

export const september5Hooks: IntakeHooks<any> = {
  name: 'September 5 intake',
  registryPath: 'src/data/september5Studies.generated.json',
  studies,
  id: (s) => s.id,
  key: (s) => s.accession,
  build(s) {
    const built = s.tracks.map((tr: any, index: number) => ({ tr, ...buildTrack(s, tr, index) }));
    return {
      definition: definition(s),
      tracks: built.map((b: any) => b.payload),
      log: built.map((b: any) => `${s.accession}/${b.tr.id}: ${b.genes} public genes, ${s.contrasts.length} contrasts`),
    };
  },
};

buildIntakeStudies(september5Hooks, { root: ROOT, ...intakeArgs() });
