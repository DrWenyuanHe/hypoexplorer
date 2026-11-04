/** Re-extract the complete author universe; keep source units and unknown inference explicit. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';

const folder = 'data/author-validation/continued-sources/continuation-2026-09-05';
const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const spec = json(`${folder}/comparison-specs.json`).comparisons[0];
const master = json('data/author-validation/additional-comparison-specs.json').comparisons.filter((row: any) => row.datasetId === spec.datasetId);
if (master.length !== 1 || JSON.stringify(master[0]) !== JSON.stringify(spec)) throw new Error('Continuation comparison specification is not current in the shared pipeline');
for (const pin of spec.originalReferences) if (hash(pin.path) !== pin.sha256 || readFileSync(pin.path).length !== pin.bytes) throw new Error(`Changed primary source or extractor: ${pin.path}`);
if (hash(spec.authorPath) !== spec.sha256 || spec.authorAdjustedP != null || spec.orientationSign !== 1 || spec.localKey !== 'id') throw new Error('Changed selected-gene extraction or pairwise-inference scope');
const workbook = XLSX.readFile(`${folder}/GSE198437/Table1.xlsx`);
const sourceRows: Record<string, string | number>[] = workbook.SheetNames.flatMap(sheet => XLSX.utils.sheet_to_json<Record<string, string | number>>(workbook.Sheets[sheet]).map((row, index) => ({ ...row, sheet, source_row: String(index + 2) })));
const lines = readFileSync(spec.authorPath, 'utf8').trimEnd().split(/\r?\n/);
const header = lines.shift()!.split('\t');
const rows = lines.map(line => Object.fromEntries(line.split('\t').map((value, i) => [header[i], value])));
if (sourceRows.length !== 1796 || rows.length !== sourceRows.length || new Set(rows.map(row => row.output_id)).size !== rows.length) throw new Error('Incomplete or duplicated original selected universe');
for (let i = 0; i < rows.length; i++) {
  const actual = rows[i], expected = sourceRows[i];
  if (actual.output_id !== String(expected.Geneid) || actual.sheet !== expected.sheet || actual.source_row !== expected.source_row
    || Number(actual.ctrl_coefficient) !== Number(expected['CTRL-0']) || Number(actual.hfd_coefficient) !== Number(expected['HFD-0'])
    || Number(actual.hfdmino_coefficient) !== Number(expected['HFDMIN-0'])
    || Math.abs(Number(actual.published_hfd_minus_ctrl) - (Number(expected['HFD-0']) - Number(expected['CTRL-0']))) > 1e-12) throw new Error(`Published coefficient extraction differs at row ${i + 2}`);
}
for (const [path, expected] of [
  [`${folder}/GSE204883/MPP-MPP.zip`, 'bcde126d7286fe9a26263485e13f358a6ce309bbea87c27c371728087c8ca203'],
  [`${folder}/GSE205313/145e6b10ed16cd7e4e4cc1a63b4ec84e90428a07.zip`, '669ad01bd1147d4bd2fc3dab0f8167ea8cf0229500800af8fa206f0e1afb1f6d'],
]) if (hash(path) !== expected) throw new Error(`Changed original author archive: ${path}`);
console.log('Continuation evidence current: all 1,796 original selected rows and both original author code archives.');
