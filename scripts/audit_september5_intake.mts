/** Trace every new population and comparison to its actual pipeline inputs. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {DATASETS} from '../src/data/datasets';
import {resolveTrackUrl,resolvePathwayUrl,sameOriginDataset} from '../src/data/bundleLocators';
import {normalizeGene} from './lib/geneSymbol.mjs';
import {roundEffect,roundProb} from './lib/bundleSlim.mjs';
import {readVerifiedFgseaSet} from './lib/fgseaProvenance.mjs';

const ROOT=process.cwd(), DIR=resolve(ROOT,'data/intake/september5-2026');
const studies=JSON.parse(readFileSync(resolve(DIR,'studies.json'),'utf8'));
const analyses=JSON.parse(readFileSync(resolve(DIR,'analyses.json'),'utf8'));
const sha=(path:string)=>createHash('sha256').update(readFileSync(resolve(ROOT,path))).digest('hex');
function table(path:string):Record<string,string>[] {
  const bytes=readFileSync(resolve(ROOT,path));
  const lines=(path.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8').trim().split(/\r?\n/);
  const head=lines.shift()!.split('\t');
  return lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[head[i],v])));
}
const jsonp=(url:string)=>JSON.parse(readFileSync(resolve(ROOT,'public',url.replace(/^\//,'')),'utf8').replace(/^var [^=]+ = /,'').replace(/;\s*$/,''));
const report:any[]=[];
for(const s of studies) {
  const ds=DATASETS.find(d=>d.id===s.id);assert(ds,`${s.id}: not registered`);
  for(const tr of s.tracks) {
    const raw=jsonp(resolveTrackUrl(sameOriginDataset(ds),tr.id));
    const pw=jsonp(resolvePathwayUrl(sameOriginDataset(ds),tr.id));
    const ss=table(tr.samplesheet).filter(r=>r.included.toLowerCase()==='true');
    assert.equal(new Set(ss.map(r=>r.sample)).size,ss.length);
    assert.deepEqual(new Set(raw.meta.sampleOrder),new Set(ss.map(r=>r.sample)));
    for(const g of s.groups) assert.deepEqual(raw.meta.groupSamples[g.key],ss.filter(r=>r.group===g.key).map(r=>r.sample));
    const aa=analyses.filter((a:any)=>a.accession===s.accession&&a.track===tr.id);
    assert.equal(aa.length,s.contrasts.length);
    if(tr.kind==='counts') {
      const mapping=new Map(table(`${s.dir}/metadata/${aa[0].analysisId}_gene_map.tsv`).map(r=>[r.gene_id,r.symbol]));
      const expected=new Map<string,number[]>();
      for(const r of table(tr.matrix)) {
        const symbol=mapping.get(r.gene_id);assert(symbol,`${s.id}: source gene missing from mapping`);
        const sum=expected.get(symbol)??ss.map(()=>0);
        ss.forEach((sample,i)=>{sum[i]+=Number(r[sample.sample]);});expected.set(symbol,sum);
      }
      const actual=table(aa[0].counts);assert.equal(actual.length,expected.size);
      for(const r of actual) {
        const sum=expected.get(r.gene_id);assert(sum);
        ss.forEach((sample,i)=>assert(Math.abs(Number(r[sample.sample])-sum[i])<=Math.max(1e-6,Math.abs(sum[i])*1e-12),
          `${s.id}/${tr.id}/${sample.sample}/${r.gene_id}: source count not conserved`));
      }
    }
    const exp=new Map(table(aa[0].cpm).flatMap(r=>{const g=normalizeGene(r.gene_id);return g?[[g,r] as const]:[];}));
    for(const [g,values] of Object.entries(raw.cpm)) {
      const r=exp.get(g);assert(r,g);
      assert.deepEqual(values,raw.meta.sampleOrder.map((id:string)=>Number(r[id])),`${s.id}/${tr.id}/${g}: expression`);
    }
    for(let i=0;i<s.contrasts.length;i++) {
      const co=s.contrasts[i],a=aa.find((a:any)=>a.contrast===co.id);assert(a);
      assert.equal(a.sourceSha256,sha(tr.matrix),`${a.analysisId}: changed source`);
      const dePath=`${s.dir}/processed/${a.analysisId}_DE.tsv`;
      assert.equal(a.deSha256,sha(dePath),`${a.analysisId}: changed DE`);
      const expectedSamples=ss.filter(r=>[co.baseline,co.case].includes(r.group)).map(r=>r.sample);
      assert.deepEqual(a.samples,expectedSamples);
      assert(a.control>=3&&a.case>=3&&a.seCoverage>.95);
      if(a.inputKind==='counts') assert(a.maxLibrarySumDelta<1e-6&&a.minTmm>0&&a.maxTmm<Infinity);
      const source=table(dePath).filter(r=>normalizeGene(r.symbol));
      const de=i===0?raw.de:raw.deByContrast[co.id];
      assert.equal(de.length,source.length,`${a.analysisId}: dropped/extra genes`);
      const publicRows=new Map(de.map((r:any)=>[r.gene,r]));
      assert.equal(publicRows.size,de.length);
      const se=new Map(table(`${s.dir}/processed/${a.analysisId}_SE.tsv`).map(r=>[r.id,Number(r.se)]));
      for(const r of source) {
        const out:any=publicRows.get(normalizeGene(r.symbol));assert(out,r.symbol);
        assert.equal(out.logFC,+Number(r.logFC).toFixed(4)||0);
        assert.equal(out.PValue,roundProb(Number(r.pvalue)));
        assert.equal(out.FDR,roundProb(Number(r.padj)));
        assert.equal(out.se,se.has(r.id)?roundEffect(se.get(r.id)):undefined);
      }
      const verified=readVerifiedFgseaSet(resolve(ROOT,dePath),{expectedSpecies:s.organism});
      assert.deepEqual(i===0?(pw.default??pw):pw.byContrast[co.id],verified.publicBlock);
      report.push({datasetId:s.id,track:tr.id,contrast:co.id,analysisId:a.analysisId,
        sampleCount:a.samples.length,publicGenes:de.length,deSha256:a.deSha256,
        countConservation:a.inputKind==='counts'?'pass':'not_applicable_normalized_input',
        expressionTrace:'pass',deTrace:'pass',pathwayProvenance:'pass'});
    }
  }
}
assert.equal(report.length,analyses.length,'unclaimed analysis');
const output=JSON.stringify({schemaVersion:1,studies:studies.length,tracks:studies.reduce((n:number,s:any)=>n+s.tracks.length,0),analyses:report},null,2)+'\n';
const target=resolve(DIR,'audit.generated.json');
if(process.argv.includes('--check')) assert.equal(readFileSync(target,'utf8'),output,'stale intake audit');
else writeFileSync(target,output);
console.log(`September 5 intake verified: ${studies.length} studies, ${report.length} comparisons; expression, DE, SE and pathways trace to source outputs.`);
