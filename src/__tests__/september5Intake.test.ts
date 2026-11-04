import {describe,expect,it} from 'vitest';
import studies from '../../data/intake/september5-2026/studies.json';
import analyses from '../../data/intake/september5-2026/analyses.json';
import audit from '../../data/intake/september5-2026/audit.generated.json';
import internalQc from '../../data/internal-qc/assessments.generated.json';
import {DATASETS,DATASET_CATEGORIES} from '../data/datasets';

describe('September 5 discovery intake',()=>{
  it('registers exactly the processed studies and exposes every reviewed contrast',()=>{
    expect(studies).toHaveLength(14);
    expect(analyses).toHaveLength(51);
    expect(audit.analyses).toHaveLength(51);
    expect(audit.tracks).toBe(22);
    for(const study of studies){
      const ds=DATASETS.find(d=>d.id===study.id)!;
      expect(ds).toBeDefined();
      expect(DATASET_CATEGORIES).toContain(ds.category);
      expect(ds.geo).toBe(study.accession);
      expect(ds.contrasts.map(c=>[c.id,c.baseline,c.case]))
        .toEqual(study.contrasts.map(c=>[c.id,c.baseline,c.case]));
      expect(analyses.filter(a=>a.studyId===study.id)).toHaveLength(study.tracks.length*study.contrasts.length);
    }
  });

  it('retains biological pools and covariates instead of counting cells as replicates',()=>{
    const byId=(id:string)=>analyses.find(a=>a.analysisId===id)!;
    expect(byId('GSE317867')).toMatchObject({control:5,case:4});
    expect(byId('GSE113576')).toMatchObject({control:3,case:3});
    expect(byId('GSE135007')).toMatchObject({control:10,case:10});
    for(const id of ['GSE135007','GSE309435','GSE337822']){
      expect(byId(id).design).toHaveLength(3);
      expect(byId(id).design).toContain('groupcase');
    }
    for(const a of analyses){
      expect(a.control).toBeGreaterThanOrEqual(3);
      expect(a.case).toBeGreaterThanOrEqual(3);
      expect(new Set(a.samples).size).toBe(a.samples.length);
      expect(a.samples).toHaveLength(a.control+a.case);
    }
  });

  it('labels normalized expression and restricted gene coverage explicitly',()=>{
    expect(DATASETS.find(d=>d.id==='gse224274')).toMatchObject({expressionUnit:'log2(CPM + 1)'});
    expect(DATASETS.find(d=>d.id==='gse308884')).toMatchObject({expressionUnit:'Author log2 CPM'});
    expect(DATASETS.find(d=>d.id==='gse224274')!.citation).toContain('5,764 genes');
    expect(DATASETS.find(d=>d.id==='gse314184')!.citation).toContain('sex and parental-role');
    expect(analyses.filter(a=>a.inputKind==='matrix')).toHaveLength(3);
    expect(audit.analyses.every(a=>a.deTrace==='pass'&&a.expressionTrace==='pass'&&a.pathwayProvenance==='pass')).toBe(true);
  });

  it('checks each comparison against the full study sheet and its own model',()=>{
    for(const study of studies){
      const record=internalQc.records.find(r=>r.datasetId===study.id)!;
      expect(record).toBeDefined();
      for(const result of Object.values(record.contrasts)){
        expect(result.checks.find((c:{id:string;status:string})=>c.id==='sample_assignment')?.status,study.id).toBe('pass');
        expect(result.checks.find((c:{id:string;status:string})=>c.id==='model_validity')?.status,study.id).toBe('pass');
      }
    }
  });
});
