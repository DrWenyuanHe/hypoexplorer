import {describe,expect,it} from 'vitest';
import ledger from '../../data/internal-qc/assessments.generated.json';
import studies from '../../data/intake/september5-2026/studies.json';
import {validateInternalQcRecords,type InternalQcRecord} from '../data/internalQc';
import {aggregateQualityChecks} from '../data/qualityChecks';

const copy=()=>structuredClone(ledger.records) as unknown as InternalQcRecord[];
const mutate=(id:string,action:(record:InternalQcRecord)=>void)=>{
  const records=copy();action(records.find(record=>record.datasetId===id)!);
  return ()=>validateInternalQcRecords(records);
};

describe('complete intake track audit validation',()=>{
  it('validates the complete current 14-study, 22-track, 51-comparison ledger',()=>{
    const records=validateInternalQcRecords(ledger.records);
    const intake=records.filter(record=>studies.some(study=>study.id===record.datasetId));
    expect(intake).toHaveLength(14);
    expect(intake.flatMap(record=>Object.values(record.tracks!))).toHaveLength(22);
    expect(intake.flatMap(record=>Object.values(record.tracks!).flatMap(track=>Object.values(track.contrasts)))).toHaveLength(51);
  });
  it('rejects missing and additional tracks',()=>{
    expect(mutate('gse262407',record=>{delete record.tracks;})).toThrow(/track coverage/);
    expect(mutate('gse262407',record=>{delete record.tracks![Object.keys(record.tracks!)[0]];})).toThrow(/track coverage/);
    expect(mutate('gse262407',record=>{record.tracks!.invented=Object.values(record.tracks!)[0];})).toThrow(/track coverage/);
  });
  it('rejects borrowed track evidence and mismatched track identities',()=>{
    expect(mutate('gse262407',record=>{
      const ids=Object.keys(record.tracks!);record.tracks![ids[1]]=structuredClone(record.tracks![ids[0]]);
    })).toThrow(/track identity/);
    expect(mutate('gse337822',record=>{Object.values(record.tracks!)[0].trackId='invented';})).toThrow(/track identity/);
  });
  it('rejects a missing comparison from one track',()=>{
    expect(mutate('gse262407',record=>{
      const track=Object.values(record.tracks!)[0];delete track.contrasts[Object.keys(track.contrasts)[0]];
    })).toThrow(/track contrast coverage/);
  });
  it('rejects a conservation failure hidden by unchanged aggregate records',()=>{
    expect(mutate('gse262407',record=>{
      const result=Object.values(Object.values(record.tracks!)[0].contrasts)[0];
      result.checks.find(check=>check.id==='count_conservation')!.status='fail';
      result.status=aggregateQualityChecks(result.checks);
    })).toThrow(/track checks disagree/);
  });
  it('requires species and mating-pair checks even when every aggregate is edited consistently',()=>{
    for(const id of ['source_species_feature_mapping','source_pairing_model']) expect(mutate('gse314184',record=>{
      const assessments=[record.assessment,...Object.values(record.contrasts),...Object.values(record.tracks!).flatMap(track=>[track.assessment,...Object.values(track.contrasts)])];
      for(const result of assessments){result.checks=result.checks.filter(check=>check.id!==id);result.status=aggregateQualityChecks(result.checks);}
    })).toThrow(/must remain required/);
  });
  it('rejects making a required source or normalization check optional',()=>{
    for(const id of ['independent_replication','count_conservation','normalization','source_reconstruction','source_pairing_model']) expect(mutate('gse314184',record=>{
      const result=Object.values(record.tracks!)[0].contrasts.dam_vs_sire;
      result.checks.find(check=>check.id===id)!.required=false;result.status=aggregateQualityChecks(result.checks);
    })).toThrow(/must remain required/);
  });
  it('retains neutral pairing checks only for the other known GSE314184 comparisons',()=>{
    const study=copy().find(record=>record.datasetId==='gse314184')!;
    for(const track of Object.values(study.tracks!)) for(const [id,result] of Object.entries(track.contrasts)){
      const pairing=result.checks.find(check=>check.id==='source_pairing_model')!;
      expect(pairing.required).not.toBe(false);
      expect(pairing.status).toBe(id==='dam_vs_sire'?'review':'not_applicable');
    }
  });
});
