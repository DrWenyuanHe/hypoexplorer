/**
 * Trace every HFD intake population and comparison to its R 4.6.0 pipeline outputs.
 *
 * Successor of scripts/audit_hfd_intake.mts, which traces the replaced outputs and
 * stays byte-identical. data/intake/hfd-2026-09-12/analyses.json is byte-preserved
 * and still names the September 12 DE hashes and raw-library-size CPM files; this
 * audit binds each analysis to its regenerated tables through their provenance
 * records, reads the displayed values named in data/intake/regeneration-r460-2026-09-25.json,
 * and uses the R 4.6.0 GSE107324 model replay (scripts/verify_hfd_107324_r460.R).
 * GSE104709's tables did not change, so its September 12 replay still applies.
 *
 *   npx tsx scripts/audit_hfd_intake_r460.mts           write data/intake/hfd-2026-09-12/audit.generated.json
 *   npx tsx scripts/audit_hfd_intake_r460.mts --check   verify it
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
import {HFD_R460_104709_REPLAY,HFD_R460_MODEL_REPLAY,validateHfdReplaysR460} from './lib/hfdReplayValidationR460.mjs';
import {provenanceHashMatches} from './lib/internalQcR460.mjs';

const ROOT=process.cwd(), DIR=resolve(ROOT,'data/intake/hfd-2026-09-12');
const studies=JSON.parse(readFileSync(resolve(DIR,'studies.json'),'utf8'));
const analyses=JSON.parse(readFileSync(resolve(DIR,'analyses.json'),'utf8'));
const values=JSON.parse(readFileSync(resolve(ROOT,'data/intake/regeneration-r460-2026-09-25.json'),'utf8')).intakes['hfd-2026-09-12'];
const fingerprints:Record<string,string>={};
const sha=(path:string)=>fingerprints[path]=createHash('sha256').update(readFileSync(resolve(ROOT,path))).digest('hex');
for (const path of ['scripts/audit_hfd_intake_r460.mts','scripts/regen-r460/run_hfd_r460.R','scripts/lib/de_common.R','scripts/build_hfd_bundles_r460.mts',
  'scripts/verify_hfd_104709_r460.R','scripts/verify_hfd_107324_r460.R','scripts/verify_hfd_107324_source.py','scripts/regen-r460/run_fgsea_r460.R',
  'scripts/lib/hfdReplayValidation.mts','scripts/lib/hfdReplayValidationR460.mts','scripts/lib/internalQcR460.mts',
  'data/intake/hfd-2026-09-12/studies.json','data/intake/hfd-2026-09-12/analyses.json','data/intake/regeneration-r460-2026-09-25.json',
  'geo_replication/config/datasets.tsv']) sha(path);
function table(path:string):Record<string,string>[] {
  const bytes=readFileSync(resolve(ROOT,path));
  const lines=(path.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8').trim().split(/\r?\n/);
  const head=lines.shift()!.split('\t');
  return lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[head[i],v])));
}
const provenance=(path:string):Record<string,string>=>Object.fromEntries(table(path).map(r=>[r.key,r.value]));
const jsonp=(url:string)=>JSON.parse(readFileSync(resolve(ROOT,'public',url.replace(/^\//,'')),'utf8').replace(/^var [^=]+ = /,'').replace(/;\s*$/,''));
const configs=table('geo_replication/config/datasets.tsv');
const report:any[]=[];
for(const s of studies) {
  const ds=DATASETS.find(d=>d.id===s.id);assert(ds,`${s.id}: not registered`);
  const manifestPath=`${s.dir}/metadata/${s.accession}_source_files.tsv`;
  sha(manifestPath);
  const manifest=table(manifestPath); assert(manifest.length,`${s.id}: empty source manifest`);
  for(const file of manifest) {
    const path=file.local_path||file.file,url=file.source_url||file.source;
    assert.equal(sha(path),file.sha256,`${s.id}: original source bytes changed`);
    assert.equal(readFileSync(resolve(ROOT,path)).length,Number(file.bytes));
    assert(/^https:\/\//.test(url),`${s.id}: source URL missing`);
  }
  const replayPaths=s.accession==='GSE104709'?['104709-independent.json']:['107324-source-independent.json','107324-independent.json'];
  const replays=new Map<string,any>();
  for(const name of replayPaths) {
    // Model replays of the regenerated tables are successors; the GSE107324 source reconstruction is unchanged.
    const path=name==='107324-independent.json'?HFD_R460_MODEL_REPLAY:name==='104709-independent.json'?HFD_R460_104709_REPLAY:`data/internal-qc/hfd-intake-2026-09-12/${name}`;sha(path);
    const replay=JSON.parse(readFileSync(resolve(ROOT,path),'utf8'));
    replays.set(name,replay);
    assert.equal(replay.status,'passed',`${s.id}: independent replay did not pass`);
    assert.equal(replay.accession,s.accession);
    const verifyPins=(value:any):void=>{
      if(!value||typeof value!=='object')return;
      if(typeof value.path==='string'&&typeof value.sha256==='string') assert.equal(sha(value.path),value.sha256,`Stale replay dependency ${value.path}`);
      for(const child of Object.values(value))verifyPins(child);
    };
    verifyPins(replay);
  }
  const records=new Map<string,Record<string,string>>(analyses.filter((a:any)=>a.accession===s.accession)
    .map((a:any)=>{const path=`${s.dir}/processed/${a.analysisId}_provenance.tsv`;sha(path);return [a.analysisId,provenance(path)];}));
  validateHfdReplaysR460(s,analyses,replays,records);
  for(const path of s.sourceReview.evidencePaths) sha(path);
  for(const tr of s.tracks) {
    sha(tr.samplesheet);
    const raw=jsonp(resolveTrackUrl(sameOriginDataset(ds),tr.id));
    const pw=jsonp(resolvePathwayUrl(sameOriginDataset(ds),tr.id));
    sha(`public${resolveTrackUrl(sameOriginDataset(ds),tr.id)}`);
    sha(`public${resolvePathwayUrl(sameOriginDataset(ds),tr.id)}`);
    const ss=table(tr.samplesheet).filter(r=>r.included.toLowerCase()==='true');
    assert.equal(new Set(ss.map(r=>r.sample)).size,ss.length);
    assert.deepEqual(new Set(raw.meta.sampleOrder),new Set(ss.map(r=>r.sample)));
    for(const g of s.groups) assert.deepEqual(raw.meta.groupSamples[g.key],ss.filter(r=>r.group===g.key).map(r=>r.sample));
    const aa=analyses.filter((a:any)=>a.accession===s.accession&&a.track===tr.id);
    assert.equal(aa.length,s.contrasts.length);
    {
      const mappingPath=`${s.dir}/metadata/${aa[0].analysisId}_gene_map.tsv`;
      const trackValues=values[aa[0].analysisId];assert(trackValues,`${aa[0].analysisId}: no R 4.6.0 value table`);
      assert.equal(trackValues.kind,tr.kind==='counts'?'cpm_tmm':'matrix');
      sha(mappingPath);sha(aa[0].counts);sha(trackValues.values);
      // Rule A2: features without a public symbol stay in the fit under their own ID.
      const mapping=new Map(table(mappingPath).map(r=>[r.gene_id,r.symbol==='NA'||!r.symbol?r.gene_id:r.symbol]));
      const expected=new Map<string,number[]>();
      const duplicates=new Map<string,number>();
      for(const r of table(tr.matrix)) {
        const symbol=mapping.get(r.gene_id);assert(symbol,`${s.id}: source gene missing from mapping`);
        const sum=expected.get(symbol)??ss.map(()=>0);
        ss.forEach((sample,i)=>{sum[i]+=Number(r[sample.sample]);});expected.set(symbol,sum);
        duplicates.set(symbol,(duplicates.get(symbol)??0)+1);
      }
      const actual=table(aa[0].counts);assert.equal(actual.length,expected.size);
      for(const r of actual) {
        const sum=expected.get(r.gene_id);assert(sum);
        ss.forEach((sample,i)=>{
          const value=tr.kind==='matrix_log'?sum[i]/duplicates.get(r.gene_id)!:sum[i];
          assert(Math.abs(Number(r[sample.sample])-value)<=Math.max(1e-6,Math.abs(value)*1e-12),
            `${s.id}/${tr.id}/${sample.sample}/${r.gene_id}: source projection changed`);
        });
      }
    }
    const exp=new Map(table(values[aa[0].analysisId].values).flatMap(r=>{const g=normalizeGene(r.gene_id);return g?[[g,r] as const]:[];}));
    for(const [g,values] of Object.entries(raw.cpm)) {
      const r=exp.get(g);assert(r,g);
      assert.deepEqual(values,raw.meta.sampleOrder.map((id:string)=>Number(r[id])),`${s.id}/${tr.id}/${g}: expression`);
    }
    for(let i=0;i<s.contrasts.length;i++) {
      const co=s.contrasts[i],a=aa.find((a:any)=>a.contrast===co.id);assert(a);
      const matchingConfig=configs.filter(row=>row.id===a.analysisId);
      assert.equal(matchingConfig.length,1,`${a.analysisId}: configuration missing or duplicated`);
      const config=matchingConfig[0];
      assert.deepEqual({dir:config.dir,organism:config.organism,id_type:config.id_type,id_col:config.id_col,id_map:config.id_map,
        input_kind:config.input_kind,input_path:config.input_path,batch_var:config.batch_var,status:config.status},
        {dir:s.dir.replace(/^geo_replication\//,''),organism:s.organism,id_type:'SYMBOL',id_col:'gene_id',id_map:'NA',
          input_kind:a.inputKind,input_path:a.counts.replace(/^geo_replication\//,''),batch_var:'NA',status:'ready'},
        `${a.analysisId}: configured model differs from the independent replay`);
      const configSheet=`geo_replication/${config.samplesheet}`;sha(configSheet);
      assert.deepEqual(table(configSheet).filter(row=>row.included.toLowerCase()==='true').map(row=>({sample:row.sample,group:row.group})),
        ss.filter(row=>[co.baseline,co.case].includes(row.group)).map(row=>({sample:row.sample,group:row.group===co.case?'case':'control'})),
        `${a.analysisId}: configured samples differ from the independent replay`);
      assert.equal(a.sourceSha256,sha(tr.matrix),`${a.analysisId}: changed source`);
      const dePath=`${s.dir}/processed/${a.analysisId}_DE.tsv`;
      const record=records.get(a.analysisId)!;
      assert.equal(record.generator,'scripts/regen-r460/run_hfd_r460.R',`${a.analysisId}: producer`);
      assert.equal(record.generator_sha256,sha(record.generator),`${a.analysisId}: producer changed since the run`);
      assert.equal(record.input_matrix_sha256,a.sourceSha256,`${a.analysisId}: provenance names another source`);
      assert(provenanceHashMatches(readFileSync(resolve(ROOT,dePath)),record.output_de_sha256),`${a.analysisId}: DE differs from its provenance record`);
      assert(provenanceHashMatches(readFileSync(resolve(ROOT,`${s.dir}/processed/${a.analysisId}_SE.tsv`)),record.output_se_sha256),`${a.analysisId}: SE differs from its provenance record`);
      const deSha256=sha(dePath);
      const expectedSamples=ss.filter(r=>[co.baseline,co.case].includes(r.group)).map(r=>r.sample);
      assert.deepEqual(a.samples,expectedSamples);
      assert(a.control>=3&&a.case>=3);
      if(a.inputKind==='counts') {
        const norm=table(values[a.analysisId].values.replace(/_CPM_TMM\.tsv\.gz$/,'_cpm_normalization.tsv'));
        const counts=table(a.counts);
        for(const r of norm) {
          const total=counts.reduce((n,row)=>n+Number(row[r.sample]),0);
          assert(Math.abs(Number(r.raw_library_size)-total)<=1e-6*Math.max(1,total),`${a.analysisId}/${r.sample}: library total`);
          assert(Number(r.tmm_norm_factor)>0&&Number.isFinite(Number(r.tmm_norm_factor)),`${a.analysisId}/${r.sample}: TMM factor`);
        }
      }
      const source=table(dePath).filter(r=>normalizeGene(r.symbol));
      const de=i===0?raw.de:raw.deByContrast[co.id];
      assert.equal(de.length,source.length,`${a.analysisId}: dropped/extra genes`);
      const publicRows=new Map(de.map((r:any)=>[r.gene,r]));
      assert.equal(publicRows.size,de.length);
      const se=new Map(table(`${s.dir}/processed/${a.analysisId}_SE.tsv`).map(r=>[r.id,Number(r.se)]));
      assert(se.size>.95*source.length,`${a.analysisId}: SE coverage`);
      sha(`${s.dir}/processed/${a.analysisId}_SE.tsv`);
      for(const r of source) {
        const out:any=publicRows.get(normalizeGene(r.symbol));assert(out,r.symbol);
        assert.equal(out.logFC,+Number(r.logFC).toFixed(4)||0);
        assert.equal(out.PValue,roundProb(Number(r.pvalue)));
        assert.equal(out.FDR,roundProb(Number(r.padj)));
        assert.equal(out.se,se.has(r.id)?roundEffect(se.get(r.id)):undefined);
      }
      const verified=readVerifiedFgseaSet(resolve(ROOT,dePath),{expectedSpecies:s.organism});
      for(const suffix of ['FGSEA_HALLMARK','FGSEA_KEGG','FGSEA_GO_BP','FGSEA_REACTOME','FGSEA_provenance','fgsea']) {
        sha(`${s.dir}/processed/${a.analysisId}_${suffix}.tsv`);
      }
      assert.deepEqual(i===0?(pw.default??pw):pw.byContrast[co.id],verified.publicBlock);
      report.push({datasetId:s.id,track:tr.id,contrast:co.id,analysisId:a.analysisId,
        sampleCount:a.samples.length,publicGenes:de.length,deSha256,producer:record.generator,
        displayedValues:values[a.analysisId].kind==='cpm_tmm'?'CPM (TMM-normalized)':'deposited expression',
        countConservation:a.inputKind==='counts'?'pass':'not_applicable_normalized_input',
        preparedInputTrace:'pass',
        expressionTrace:'pass',deTrace:'pass',pathwayProvenance:'pass'});
    }
  }
}
assert.equal(report.length,analyses.length,'unclaimed analysis');
const output=JSON.stringify({schemaVersion:1,scope:'Checksummed public processed sources, configured preparation and all displayed tracks. Author-result concordance is assessed separately.',studies:studies.length,tracks:studies.reduce((n:number,s:any)=>n+s.tracks.length,0),fingerprints,analyses:report},null,2)+'\n';
const target=resolve(DIR,'audit.generated.json');
if(process.argv.includes('--check')) assert.equal(readFileSync(target,'utf8').replace(/\r\n/g,'\n'),output,'stale intake audit');
else writeFileSync(target,output);
console.log(`High-fat diet intake verified against the R 4.6.0 outputs: ${studies.length} studies, ${report.length} comparisons; expression, DE, SE and pathways trace to source outputs.`);
