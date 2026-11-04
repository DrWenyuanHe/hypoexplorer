import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import XLSX from 'xlsx';

const folder = 'data/author-validation/continued-sources/advancement-sources-b-2026-09-05/GSE141144';
const sourcePath = `${folder}/Table_1.xlsx`;
const localPath = 'geo_replication/datasets/GSE141144_drer_hypothalamus_flx/processed/GSE141144_DE.tsv';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const workbook = XLSX.readFile(sourcePath, { cellStyles: true, sheetStubs: true });
const [header, ...lines] = readFileSync(localPath, 'utf8').trim().split(/\r?\n/).map(line => line.split('\t'));
const ids = new Map(lines.map(row => [row[header.indexOf('id')], Number(row[header.indexOf('logFC')])]));
const findings: { sheet: string; cell: string; gene: string; authorDirection: string; localLogFC: number | null; sameDirection: boolean | null }[] = [];
for (const name of ['Supp 5', 'Supp 7']) {
  const sheet = workbook.Sheets[name];
  const end = XLSX.utils.decode_range(sheet['!ref']!).e.r + 1;
  for (let row = 4; row <= end; row++) {
    const gene = sheet[`B${row}`]?.v;
    const color = sheet[`D${row}`]?.s?.fgColor?.rgb;
    if (typeof gene !== 'string' || !['FF0000', '92D050'].includes(color)) continue;
    const value = ids.get(gene) ?? null;
    findings.push({ sheet: name, cell: `D${row}`, gene, authorDirection: color === 'FF0000' ? 'up' : 'down', localLogFC: value, sameDirection: value === null || value === 0 ? null : Math.sign(value) === (color === 'FF0000' ? 1 : -1) });
  }
}
const unique = new Map<string, typeof findings[number]>();
for (const row of findings) {
  if (unique.has(row.gene) && unique.get(row.gene)!.authorDirection !== row.authorDirection) throw new Error(`Conflicting author colors: ${row.gene}`);
  unique.set(row.gene, row);
}
const rows = [...unique.values()];
const paired = rows.filter(row => row.sameDirection !== null);
const report = { accession: 'GSE141144', sourceUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9097470/supplementaryFiles', sourcePath, sha256: hash(sourcePath), localPath, localSha256: hash(localPath), extractionScript: { path: 'scripts/audit_recovered_direction_sources.mts', sha256: hash('scripts/audit_recovered_direction_sources.mts') }, resultScope: 'Selected lifelong/depressive-disorder gene lists; unstressed adult hypothalamus only, Supp 5 and Supp 7 Hyp column D. Exact Danio rerio symbols only.', method: 'Workbook legend: red upregulated, green downregulated. No fold-change magnitude or P/FDR is encoded as a color or invented. Duplicate genes counted once. Blank/uncolored cells are unassessed.', selectedGenes: rows.length, pairedNonzeroGenes: paired.length, sameDirectionGenes: paired.filter(row => row.sameDirection).length, sameDirectionFraction: paired.length ? paired.filter(row => row.sameDirection).length / paired.length : null, findings };
const serialized = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(`${folder}/direction-comparison.json`, 'utf8') !== serialized) throw new Error('Stale recovered direction-only evidence');
} else writeFileSync(`${folder}/direction-comparison.json`, serialized);
console.log(JSON.stringify({ selected: report.selectedGenes, paired: report.pairedNonzeroGenes, sameDirection: report.sameDirectionGenes }));
