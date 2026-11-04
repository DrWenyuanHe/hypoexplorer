import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {createReviewedFgseaSpeciesResolver} from '../../scripts/lib/reviewedFgseaSpecies.mjs';
import {readVerifiedFgseaSet} from '../../scripts/lib/fgseaProvenance.mjs';
import specifications from '../../data/internal-qc/intake-replication-2026-09-11/specifications.json';

const root=process.cwd(),records=specifications.records.filter(row=>row.datasetId==='gse314184');
const request=(row:typeof records[number])=>({datasetId:row.datasetId,organism:'Rhabdomys pumilio',trackId:row.trackId,contrastId:row.contrastId,
  dePath:resolve(root,'geo_replication',row.config.dir,'processed',`${row.configId}_DE.tsv`)});

describe('reviewed retained pathway species',()=>{
  it('verifies all four unchanged mouse-reference artifacts while retaining the biological species correction',()=>{
    const species=createReviewedFgseaSpeciesResolver(root);expect(records).toHaveLength(4);
    for(const row of records){
      const input=request(row);expect(species(input)).toBe('Mus musculus');
      expect(readVerifiedFgseaSet(input.dePath,{expectedSpecies:species(input)}).provenance.target_species).toBe('Mus musculus');
      expect(()=>readVerifiedFgseaSet(input.dePath,{expectedSpecies:'Rhabdomys pumilio'})).toThrow(/target_species does not match/);
    }
  });
  it('leaves other organisms strict and never opens the exception evidence for them',()=>{
    const species=createReviewedFgseaSpeciesResolver(root,()=>{throw new Error('Unexpected exception read');});
    for(const organism of ['Mus musculus','Rattus norvegicus','Homo sapiens','Rhabdomys pumilio']){
      expect(species({...request(records[0]),datasetId:'another-study',organism})).toBe(organism);
    }
  });
  it('rejects unknown tracks, contrasts, changed display species and borrowed DE paths',()=>{
    const species=createReviewedFgseaSpeciesResolver(root),base=request(records[0]);
    for(const change of [{trackId:'unknown'},{contrastId:'unknown'},{organism:'Mus musculus'},
      {dePath:request(records[1]).dePath},{dePath:'../outside_DE.tsv'}]){
      expect(()=>species({...base,...change})).toThrow();
    }
  });
  it('requires the current sealed review and exact retained configuration',()=>{
    for(const path of ['data/internal-qc/intake-replication-2026-09-11/specifications.json','geo_replication/config/datasets.tsv']){
      const species=createReviewedFgseaSpeciesResolver(root,p=>p===path?Buffer.from('changed'):readFileSync(resolve(root,p)));
      expect(()=>species(request(records[0]))).toThrow(/review is unavailable/);
      const absent=createReviewedFgseaSpeciesResolver(root,p=>{if(p===path)throw new Error('missing');return readFileSync(resolve(root,p));});
      expect(()=>absent(request(records[0]))).toThrow(/review is unavailable/);
    }
  });
  it('cannot mix a cached review with later substituted specification bytes',()=>{
    const path='data/internal-qc/intake-replication-2026-09-11/specifications.json';
    let replaced:Buffer|undefined;
    const species=createReviewedFgseaSpeciesResolver(root,p=>p===path&&replaced?replaced:readFileSync(resolve(root,p)));
    expect(species(request(records[0]))).toBe('Mus musculus');
    const changed=structuredClone(specifications);
    const row=changed.records.find(row=>row.datasetId===records[0].datasetId&&row.trackId===records[0].trackId&&row.contrastId===records[0].contrastId)!;
    row.configId=records[1].configId;row.config=structuredClone(records[1].config);
    replaced=Buffer.from(JSON.stringify(changed));
    expect(()=>species({...request(records[0]),dePath:request(records[1]).dePath})).toThrow(/specification seal differs/);
  });
});
