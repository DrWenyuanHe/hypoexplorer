// HFD intake (data/intake/hfd-2026-09-12) bundle builder, R 4.6.0 regeneration.
//
// Successor of scripts/build_hfd_bundles.mts, whose exact bytes are pinned by the
// HFD intake evidence and therefore stay unchanged. Differences: per-sample
// values come from data/intake/regeneration-r460-2026-09-25.json (the DE fit's
// TMM CPM for count analyses, labelled CPM_TMM_UNIT), DE tables are keyed by
// symbol and must be unique, and every DE symbol must have values.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { writeDatasetBundles } from './lib/bundleWriter.mjs';
import { CPM_TMM_UNIT, assertUniqueKeys, publicSymbol } from './lib/regenTables.mjs';
import { rankScore } from './lib/deTable.mjs';
import { readVerifiedFgseaSet } from './lib/fgseaProvenance.mjs';
import { defineDataset } from '../src/data/datasets';
import { resolvePathwayIndexGlobalKey } from '../src/data/bundleLocators';
import type { Dataset, PathwayDatabase } from '../src/types';

const ROOT = process.cwd();
const dir = resolve(ROOT, 'data/intake/hfd-2026-09-12');
const studies = JSON.parse(readFileSync(resolve(dir, 'studies.json'), 'utf8'));
const analyses = JSON.parse(readFileSync(resolve(dir, 'analyses.json'), 'utf8'));
const colors = ['#3775BA', '#B64342', '#44996B', '#9765AE'];
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7).split(',');
// Regenerated per-sample value tables (R 4.6.0, 2026-09-25): the intake's own
// analyses.json is byte-preserved and still names the pre-regeneration CPM files.
const regeneration = JSON.parse(readFileSync(resolve(ROOT, 'data/intake/regeneration-r460-2026-09-25.json'), 'utf8'))
  .intakes['hfd-2026-09-12'] as Record<string, { values: string; kind: 'cpm_tmm' | 'matrix'; replaces: string }>;
function valuesPath(analysis: any): string {
  const entry = regeneration[analysis.analysisId];
  if (!entry || entry.replaces !== analysis.cpm) {
    throw new Error(`${analysis.analysisId}: no regeneration value table for ${analysis.cpm}`);
  }
  return entry.values;
}
function table(path: string): Record<string, string>[] {
  const raw = readFileSync(resolve(ROOT, path));
  const lines = (path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')).trim().split(/\r?\n/);
  const head = lines.shift()!.split('\t');
  return lines.map(line => Object.fromEntries(line.split('\t').map((v,i) => [head[i],v])));
}
function number(value: string, context: string): number {
  if (!value || value === 'NA') throw new Error(`Missing number: ${context}`);
  const n = Number(value); if (!Number.isFinite(n)) throw new Error(`Invalid number: ${context}`); return n;
}
function pathways(s: any, analysis: any): PathwayDatabase {
  return readVerifiedFgseaSet(resolve(ROOT,`${s.dir}/processed/${analysis.analysisId}_DE.tsv`),
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
    trackNoun:'track',trackCategoryOrder:['Tissue'],expressionUnit:s.expressionUnit??CPM_TMM_UNIT,
    citation:s.note,geo:s.accession,doi:s.doi??'',pmid:s.pmid||'',
    groups:s.groups.map((g:any,i:number)=>({...g,color:colors[i%colors.length]})),
    contrasts:s.contrasts.map((c:any,i:number)=>({id:c.id,label:c.label,baseline:c.baseline,case:c.case,isDefault:i===0})),
  };
}

const registryPath = resolve(ROOT, 'src/data/hfdStudies.generated.json');
const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath,'utf8')) : [];
const written: any[] = [];
for (const s of studies.filter((s:any)=>!only||only.includes(s.accession))) {
  const registry = definition(s);
  const dataset = defineDataset(registry) as Dataset;
  const root = resolve(ROOT,'public/datasets',dataset.id);
  const metas:any[]=[]; const qcs:any[]=[]; const pathwayNames=new Set<string>();
  for(const tr of s.tracks) {
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
      for(const items of Object.values(pathwaysByContrast[co.id])) for(const p of items as any[]) pathwayNames.add(p.pathway);
    }
    const first=s.contrasts[0]; const de=deByContrast[first.id];delete deByContrast[first.id];
    const pw=pathwaysByContrast[first.id];delete pathwaysByContrast[first.id];
    const genes=new Set([de,...Object.values(deByContrast)].flat().map(r=>r.gene));
    const cpm=Object.fromEntries([...genes].map(g=>[g,expression.get(g)]));
    const control=groupSamples[first.baseline] as string[],cases=groupSamples[first.case] as string[];
    const meta={code:tr.id,label:tr.label,type:'Tissue',nGenes:de.length,sampleOrder,groupSamples,expressionUnit:s.expressionUnit??CPM_TMM_UNIT};
    const qc={cluster:tr.id,clusterLabel:tr.label,minCells:sheet.some(r=>r.cells)?Math.min(...sheet.map(r=>Number(r.cells))):0,
      nNormal:control.length,nObese:cases.length,is3v3:control.length===3&&cases.length===3,samplesKept:sampleOrder};
    // The existing writer validates one track at a time. Merge the dataset-level
    // indexes below so every population remains available in one study.
    writeDatasetBundles({...dataset,defaultTrack:tr.id},[{
      trackId:tr.id,armKeys:[first.baseline,first.case],defaultContrastBinding:{id:first.id,baseline:first.baseline,case:first.case},
      extraContrastBindings:s.contrasts.slice(1).map((c:any)=>({id:c.id,baseline:c.baseline,case:c.case})),
      color:colors[metas.length%colors.length],nSig:de.filter(r=>r.PValue<.01).length,
      meta,qc,de,deByContrast,cpm:cpm as any,pathways:pw,pathwaysByContrast,
    }]);
    const read=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8').replace(/^var [^=]+ = /,'').replace(/;\s*$/,''));
    metas.push(read('meta.js'));qcs.push(read('qc_global.js'));
    console.log(`${s.accession}/${tr.id}: ${genes.size} public genes, ${s.contrasts.length} contrasts`);
  }
  const merged={...metas[0],populations:metas.flatMap(m=>m.populations)};
  for(const key of ['labels','types','nGenes','colors','qcFlags','qaReportFilenames']) merged[key]=Object.assign({},...metas.map(m=>m[key]));
  // With varying population coverage the default population supplies the
  // pre-load group count. Loaded tracks always carry their own sample IDs.
  const qc={...qcs[0],runStatus:qcs.flatMap(q=>q.runStatus),deSummary:qcs.flatMap(q=>q.deSummary)};
  writeFileSync(resolve(root,'meta.js'),`var ${dataset.metaGlobalKey} = ${JSON.stringify(merged)};\n`);
  writeFileSync(resolve(root,'qc_global.js'),`var ${dataset.qcGlobalKey} = ${JSON.stringify(qc)};\n`);
  writeFileSync(resolve(root,'pathways_index.js'),`var ${resolvePathwayIndexGlobalKey(dataset)} = ${JSON.stringify([...pathwayNames].sort())};\n`);
  written.push(registry);
}
const replaced=new Set(written.map(s=>s.id));
const mergedRegistry=new Map([...previous.filter((s:any)=>!replaced.has(s.id)),...written].map((s:any)=>[s.id,s]));
const orderedRegistry=studies.filter((s:any)=>mergedRegistry.has(s.id)).map((s:any)=>mergedRegistry.get(s.id));
if(orderedRegistry.length!==mergedRegistry.size) throw new Error('Intake registry contains an unknown study');
writeFileSync(registryPath,JSON.stringify(orderedRegistry,null,2)+'\n');
