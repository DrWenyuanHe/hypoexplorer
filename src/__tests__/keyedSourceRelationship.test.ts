import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareCompleteGeneTables, createKeyedSourceInputRelationshipReader } from '../../data/internal-qc/source-authenticity-2026-09-05/round5-keyed/sourceInputRelationship.mjs';

const folder = 'data/internal-qc/source-authenticity-2026-09-05/round5-keyed';
const doc = JSON.parse(readFileSync(`${folder}/evidence.json`, 'utf8'));
const request = {datasetId:doc.datasetId,currentInputPath:doc.registeredInput.path};
const table = 'symbol\tcontrol\tcase\na\t1\t2\nB\t3\t4\n';
describe('complete unique-gene source relationship', () => {
  it('accepts pure whole-row permutation without claiming byte identity', () => {
    expect(compareCompleteGeneTables(table, 'symbol\tcontrol\tcase\nB\t3\t4\na\t1\t2\n')).toMatchObject({rows:2,numericCellsCompared:4,orderedTextIdentical:false});
  });
  it.each([
    'symbol\tcontrol\tcase\na\t1\t2\na\t3\t4\n',
    'symbol\tcontrol\tcase\na\t1\t2\n',
    'symbol\tcontrol\tcase\na\t1\t2\nC\t3\t4\n',
    'symbol\tcontrol\tcase\na\t3\t4\nB\t1\t2\n',
    'symbol\tcase\tcontrol\na\t1\t2\nB\t3\t4\n',
    'symbol\tcontrol\tcase\na\t1\t2\nB\t3\t4.0\n',
    'symbol\tcontrol\tcase\na\t1\t2\nB\t3\tNaN\n',
    'symbol\tcontrol\tcase\na\t1\t2\nB\t3\t-4\n',
    'symbol\tcontrol\tcase\na\t1\t2\nB\t3\t9007199254740992\n',
    'symbol\tcontrol\tcase\na\t1\t2\n\t3\t4\n',
  ])('rejects incomplete or changed gene/count identity', actual => {
    expect(() => compareCompleteGeneTables(table, actual)).toThrow();
  });
  it('validates both current path forms and preserves a prior failure', () => {
    const reader = createKeyedSourceInputRelationshipReader(process.cwd());
    expect(reader.evaluate(request).status).toBe('pass');
    expect(reader.evaluate({...request,currentInputPath:resolve(request.currentInputPath)}).status).toBe('pass');
    expect(reader.evaluate({...request,previous:{status:'fail',note:'Existing discrepancy'}}).status).toBe('fail');
  }, 30000);
  it.each([null, '../outside.gz', 'data/unrelated.gz'])('rejects a missing, escaping, or different current input', path => {
    expect(createKeyedSourceInputRelationshipReader(process.cwd()).evaluate({...request,currentInputPath:path}).status).toBe('not_assessed');
  });
  it.each([doc.producer.path, doc.plan.path, doc.upstreamEvidence.path, doc.reconstruction.path,
    doc.registeredInput.path, doc.registeredSampleSheet.path, ...doc.sources.flatMap((row: any) => [row.download.path,row.downloadLog.path])])('rejects changed evidence at %s', changed => {
    const reader = createKeyedSourceInputRelationshipReader(process.cwd(), {fingerprint:path => resolve(path) === resolve(changed)
      ? '0'.repeat(64) : createHash('sha256').update(readFileSync(path)).digest('hex')});
    expect(reader.evaluate(request).status).toBe('not_assessed');
  }, 30000);
});
