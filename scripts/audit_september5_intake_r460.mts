/**
 * Trace every September 5 intake population and comparison to its R 4.6.0 pipeline outputs.
 *
 * Successor of scripts/audit_september5_intake.mts, which traces the replaced
 * R 4.4.1 outputs and stays byte-identical because retained evidence pins it.
 * data/intake/september5-2026/analyses.json is byte-preserved and still records the
 * replaced DE hashes, raw-library-size CPM files and run statistics. This audit
 * therefore binds each analysis to the regenerated outputs through their own
 * provenance records, reads the displayed values from the files named in
 * data/intake/regeneration-r460-2026-09-25.json (TMM CPM for counts), and
 * remeasures library totals and TMM factors from the current sidecars.
 *
 * The September 5 audit.generated.json is read by sealed producers (its bytes are pinned
 * by the intake replication specifications and the September 11 scientific snapshot),
 * so it stays byte-identical; this successor writes audit-r460.generated.json.
 *
 *   npx tsx scripts/audit_september5_intake_r460.mts           write data/intake/september5-2026/audit-r460.generated.json
 *   npx tsx scripts/audit_september5_intake_r460.mts --check   verify it
 */
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
import {provenanceHashMatches} from './lib/internalQcR460.mjs';

const ROOT=process.cwd(), DIR=resolve(ROOT,'data/intake/september5-2026');
const studies=JSON.parse(readFileSync(resolve(DIR,'studies.json'),'utf8'));
const analyses=JSON.parse(readFileSync(resolve(DIR,'analyses.json'),'utf8'));
const values=JSON.parse(readFileSync(resolve(ROOT,'data/intake/regeneration-r460-2026-09-25.json'),'utf8')).intakes['september5-2026'];
const sha=(path:string)=>createHash('sha256').update(readFileSync(resolve(ROOT,path))).digest('hex');
function table(path:string):Record<string,string>[] {
  const bytes=readFileSync(resolve(ROOT,path));
  const lines=(path.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8').trim().split(/\r?\n/);
  const head=lines.shift()!.split('\t');
  return lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[head[i],v])));
}
const provenance=(path:string):Record<string,string>=>Object.fromEntries(table(path).map(r=>[r.key,r.value]));
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
    const trackValues=values[aa[0].analysisId];
    assert(trackValues,`${aa[0].analysisId}: no R 4.6.0 value table`);
    assert(aa.every((a:any)=>values[a.analysisId]?.values===trackValues.values),`${s.id}/${tr.id}: one value table per track`);
    let normalization:Record<string,string>[]=[];
    if(tr.kind==='counts') {
      assert.equal(trackValues.kind,'cpm_tmm');
      // Rule A2: every source feature takes its final public symbol; features
      // without one stay in the fit matrix under their own ID.
      const mapping=new Map(table(`${s.dir}/metadata/${aa[0].analysisId}_gene_map.tsv`).map(r=>[r.gene_id,r.symbol==='NA'||!r.symbol?r.gene_id:r.symbol]));
      const expected=new Map<string,number[]>();
      for(const r of table(tr.matrix)) {
        const key=mapping.get(r.gene_id);assert(key,`${s.id}: source gene missing from mapping`);
        const sum=expected.get(key)??ss.map(()=>0);
        ss.forEach((sample,i)=>{sum[i]+=Number(r[sample.sample]);});expected.set(key,sum);
      }
      const actual=table(aa[0].counts);assert.equal(actual.length,expected.size);
      for(const r of actual) {
        const sum=expected.get(r.gene_id);assert(sum,`${s.id}: ${r.gene_id} has no source rows`);
        ss.forEach((sample,i)=>{assert(Math.abs(Number(r[sample.sample])-sum[i])<=Math.max(1e-6,Math.abs(sum[i])*1e-12),
          `${s.id}/${tr.id}/${sample.sample}/${r.gene_id}: source count not conserved`);});
      }
      normalization=table(trackValues.values.replace(/_CPM_TMM\.tsv\.gz$/,'_cpm_normalization.tsv'));
      assert.deepEqual(new Set(normalization.map(r=>r.sample)),new Set(ss.map(r=>r.sample)));
      for(const r of normalization) {
        const i=ss.findIndex(x=>x.sample===r.sample);
        const total=[...expected.values()].reduce((n,v)=>n+v[i],0);
        assert(Math.abs(Number(r.raw_library_size)-total)<=1e-6*Math.max(1,total),`${s.id}/${r.sample}: raw library size`);
        assert(Number(r.tmm_norm_factor)>0&&Number.isFinite(Number(r.tmm_norm_factor)),`${s.id}/${r.sample}: TMM factor`);
        assert(Math.abs(Number(r.filtered_library_size)*Number(r.tmm_norm_factor)-Number(r.effective_library_size))<=1e-6*Number(r.effective_library_size));
      }
    } else assert.equal(trackValues.kind,'matrix');
    const exp=new Map(table(trackValues.values).flatMap(r=>{const g=normalizeGene(r.gene_id);return g?[[g,r] as const]:[];}));
    for(const [g,v] of Object.entries(raw.cpm)) {
      const r=exp.get(g);assert(r,g);
      assert.deepEqual(v,raw.meta.sampleOrder.map((id:string)=>Number(r[id])),`${s.id}/${tr.id}/${g}: expression`);
    }
    for(let i=0;i<s.contrasts.length;i++) {
      const co=s.contrasts[i],a=aa.find((a:any)=>a.contrast===co.id);assert(a);
      assert.equal(a.sourceSha256,sha(tr.matrix),`${a.analysisId}: changed source`);
      const dePath=`${s.dir}/processed/${a.analysisId}_DE.tsv`;
      const record=provenance(`${s.dir}/processed/${a.analysisId}_provenance.tsv`);
      assert.equal(record.generator,'scripts/regen-r460/run_september5_r460.R',`${a.analysisId}: producer`);
      assert.equal(record.generator_sha256,sha(record.generator),`${a.analysisId}: producer changed since the run`);
      assert.equal(record.input_matrix_sha256,a.sourceSha256,`${a.analysisId}: provenance names another source`);
      assert(provenanceHashMatches(readFileSync(resolve(ROOT,dePath)),record.output_de_sha256),`${a.analysisId}: DE differs from its provenance record`);
      const sePath=`${s.dir}/processed/${a.analysisId}_SE.tsv`;
      assert(provenanceHashMatches(readFileSync(resolve(ROOT,sePath)),record.output_se_sha256),`${a.analysisId}: SE differs from its provenance record`);
      const expectedSamples=ss.filter(r=>[co.baseline,co.case].includes(r.group)).map(r=>r.sample);
      assert.deepEqual(a.samples,expectedSamples);
      assert.deepEqual([...record.samples_control.split(','),...record.samples_case.split(',')].sort(),[...expectedSamples].sort(),`${a.analysisId}: fitted samples`);
      assert(a.control>=3&&a.case>=3);
      const source=table(dePath).filter(r=>normalizeGene(r.symbol));
      const de=i===0?raw.de:raw.deByContrast[co.id];
      assert.equal(de.length,source.length,`${a.analysisId}: dropped/extra genes`);
      const publicRows=new Map(de.map((r:any)=>[r.gene,r]));
      assert.equal(publicRows.size,de.length);
      const se=new Map(table(sePath).map(r=>[r.id,Number(r.se)]));
      assert(se.size>.95*source.length,`${a.analysisId}: SE coverage`);
      for(const r of source) {
        const out:any=publicRows.get(normalizeGene(r.symbol));assert(out,r.symbol);
        assert.equal(out.logFC,+Number(r.logFC).toFixed(4)||0);
        assert.equal(out.PValue,roundProb(Number(r.pvalue)));
        assert.equal(out.FDR,roundProb(Number(r.padj)));
        assert.equal(out.se,se.has(r.id)?roundEffect(se.get(r.id)):undefined);
      }
      const verified=readVerifiedFgseaSet(resolve(ROOT,dePath),{expectedSpecies:s.organism});
      assert.deepEqual(i===0?(pw.default??pw):pw.byContrast[co.id],verified.publicBlock);
      const factors=normalization.map(r=>Number(r.tmm_norm_factor));
      report.push({datasetId:s.id,track:tr.id,contrast:co.id,analysisId:a.analysisId,
        sampleCount:a.samples.length,publicGenes:de.length,deSha256:sha(dePath),producer:record.generator,
        displayedValues:trackValues.kind==='cpm_tmm'?'CPM (TMM-normalized)':'deposited expression',
        ...(a.inputKind==='counts'?{minTmm:Math.min(...factors),maxTmm:Math.max(...factors)}:{}),
        countConservation:a.inputKind==='counts'?'pass':'not_applicable_normalized_input',
        expressionTrace:'pass',deTrace:'pass',pathwayProvenance:'pass'});
    }
  }
}
assert.equal(report.length,analyses.length,'unclaimed analysis');
const output=JSON.stringify({schemaVersion:1,studies:studies.length,tracks:studies.reduce((n:number,s:any)=>n+s.tracks.length,0),analyses:report},null,2)+'\n';
const target=resolve(DIR,'audit-r460.generated.json');
if(process.argv.includes('--check')) assert.equal(readFileSync(target,'utf8').replace(/\r\n/g,'\n'),output,'stale intake audit');
else writeFileSync(target,output);
console.log(`September 5 intake verified against the R 4.6.0 outputs: ${studies.length} studies, ${report.length} comparisons; expression, DE, SE and pathways trace to their provenance-recorded outputs.`);
