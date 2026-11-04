import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createIntakeReplicationReader,INTAKE_REPLICATION_SPEC_SHA256} from '../../data/internal-qc/intake-replication-2026-09-11/intakeReplication.mjs';
import {resolveConfiguredFgseaSpecies} from './fgseaProvenance.mjs';

interface Request {datasetId:string;organism:string;trackId:string;contrastId:string;dePath:string}
const specPath='data/internal-qc/intake-replication-2026-09-11/specifications.json';

/** Validate retained pathway targets after an explicitly reviewed display-species correction. */
export function createReviewedFgseaSpeciesResolver(root:string,readOverride?:(path:string)=>Buffer) {
  const read=readOverride??((path:string)=>readFileSync(resolve(root,path)));
  let review:ReturnType<typeof createIntakeReplicationReader>|undefined;
  return (request:Request):string=>{
    if(request.datasetId!=='gse314184')return request.organism;
    if(request.organism!=='Rhabdomys pumilio')throw new Error('GSE314184 biological species must remain Rhabdomys pumilio');
    review??=createIntakeReplicationReader(root,read);
    const check=review.speciesCheck(request.datasetId,request.trackId,request.contrastId);
    if(check?.status!=='review'||check.required===false)throw new Error('Current required GSE314184 species/feature review is unavailable');
    // The reader validates the literal specification seal and every current configuration pin.
    const bytes=read(specPath);
    if(createHash('sha256').update(bytes).digest('hex')!==INTAKE_REPLICATION_SPEC_SHA256)throw new Error('GSE314184 pathway binding specification seal differs');
    const spec=JSON.parse(bytes.toString('utf8')) as {records:Array<{
      datasetId:string;trackId:string;contrastId:string;configId:string;config:{dir:string;organism:string};
    }>};
    const rows=spec.records.filter(row=>row.datasetId===request.datasetId&&row.trackId===request.trackId&&row.contrastId===request.contrastId);
    if(rows.length!==1||rows[0].config.organism!=='Mus musculus'
      ||resolve(root,request.dePath)!==resolve(root,'geo_replication',rows[0].config.dir,'processed',`${rows[0].configId}_DE.tsv`)) {
      throw new Error('GSE314184 retained pathway configuration or exact DE binding differs');
    }
    const configured=resolveConfiguredFgseaSpecies(resolve(root,request.dePath),{configPath:resolve(root,'geo_replication/config/datasets.tsv')});
    if(configured!=='Mus musculus')throw new Error('GSE314184 retained pathway target must match the reviewed mouse configuration');
    // This permits only verification of unchanged historical pathway artifacts.
    // The required biological cross-species mapping review remains unresolved.
    return configured;
  };
}
