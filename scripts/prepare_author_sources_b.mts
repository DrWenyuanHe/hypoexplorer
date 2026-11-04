import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import XLSX from 'xlsx';

const out = 'data/author-validation/continued-sources/advancement-sources-b-2026-09-05';
const old = 'data/author-validation/continued-sources';
const baseline = JSON.parse(readFileSync('data/quality/advancement-2026-09-05/baseline.json', 'utf8')).validation.records;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const checking = process.argv.includes('--check');
function emit(path: string, value: string): void {
  if (checking) {
    if (readFileSync(path, 'utf8') !== value) throw new Error(`Stale author extraction: ${path}`);
  } else writeFileSync(path, value);
}
const inputs = [
  ['GSE231617', `${old}/final-numerical-batch-c/GSE231617_Table_1.XLSX`, 'allResults', '__EMPTY', 'log2FoldChange', 'padj', 'limma', 'DESeq2'],
  ['GSE231769', `${old}/final-numerical-batch-c/GSE231769_S1.xlsx`, 'Differentially Expressed Genes', 'geneID', 'logFC', 'adj.P.Val', 'limma', 'limma; exact original settings unavailable'],
  ['GSE185074', `${old}/ten-dataset-followup-2026-09-04/GSE185074/author_wt_hfd_ncd.xlsx`, 'wt_hfd_ncd.xlsx', 'ensembl_gene_id', 'log2FoldChange', 'padj', 'edgeR-QL', 'DESeq2'],
  ['GSE153551', `${old}/ten-dataset-followup-2026-09-04/GSE153551/author_Data11.xlsx`, 'b.d5_deg', 'gene', 'log2FoldChange', 'padj', 'edgeR-QL', 'DESeq2; author multi-day fit'],
  ['GSE328990', `${old}/five-dataset-followup-2026-09-04/GSE328990/GSE328990_DESeq2_KO_vs_WT.csv.gz`, '', 'gene_id', 'log2FoldChange', 'padj', 'edgeR-QL', 'DESeq2'],
  ['GSE242187', `${old}/ten-dataset-followup-2026-09-04/GSE242187/GSE242187_5A_vs_3A_control_vs_comparison.deseq.res.csv.gz`, '', 'GeneName', 'log2FoldChange', 'padj', 'edgeR-QL', 'DESeq2'],
  ['GSE190712', `${out}/GSE190712/mmc2.xlsx`, 'Table S5', 'EnsemblID', 'log2FoldChange', 'FDR', 'edgeR-QL', 'DESeq2 with surrogate variables'],
  ['GSE273038', `${out}/GSE273038/NIHMS2113368-supplement-4.xlsx`, 'Table S3', 'gene_short_name', 'derivedLog2FC', 'qval', 'edgeR-QL animal pseudobulk', 'Monocle2 spot-level LRT'],
];
const comparisons = inputs.map(([accession, originalPath, sheetName, key, effect, adjustedP, localMethod, authorMethod]) => {
  const record = baseline.find((row: { accession: string }) => row.accession === accession);
  const folder = `${out}/${accession}`;
  mkdirSync(folder, { recursive: true });
  const workbook = sheetName ? XLSX.readFile(originalPath) : XLSX.read(gunzipSync(readFileSync(originalPath)), { type: 'buffer' });
  let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName || workbook.SheetNames[0]], { defval: null, range: accession === 'GSE190712' ? 1 : accession === 'GSE273038' ? 2 : 0 });
  if (accession === 'GSE273038') {
    rows = rows.filter(row => row.brain_region === 'Hypothalamus').map(row => {
      const high = row['max.condition'];
      const low = row['second.condition'];
      const ratio = Number(row['fold.change']);
      if (!((high === 'CR' && low === 'AL') || (high === 'AL' && low === 'CR')) || !Number.isFinite(ratio) || ratio < 1) throw new Error('Unsupported author CR/AL ratio');
      return { ...row, derivedLog2FC: Math.log2(ratio) * (high === 'CR' ? 1 : -1) };
    });
  }
  // Keep every identified author row, including rows without effects or FDR.
  // An unidentified statistical row is retained in the exclusions audit, never assigned to a local gene.
  const named = rows.filter(row => typeof row[key] === 'string' && String(row[key]).trim());
  const seen = new Set<string>();
  for (const row of named) {
    const id = String(row[key]);
    if (seen.has(id) || /[\t\r\n]/.test(id)) throw new Error(`${accession}: ambiguous author key ${id}`);
    seen.add(id);
  }
  const authorPath = `${folder}/author-effects.tsv`;
  emit(authorPath, ['id\tlogFC\tpadj', ...named.map(row => `${row[key]}\t${row[effect] ?? 'NA'}\t${row[adjustedP] ?? 'NA'}`)].join('\n') + '\n');
  const dir = readdirSync('geo_replication/datasets').find(name => name.startsWith(`${accession}_`));
  if (!dir) throw new Error(`${accession}: local dataset missing`);
  const localPath = `geo_replication/datasets/${dir}/processed/${accession}_DE.tsv`;
  const sourceUrl = accession === 'GSE231617'
    ? 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10498476/supplementaryFiles'
    : record.evidenceLinks.find((link: { kind: string; url: string }) => link.kind === 'author_result' && (accession !== 'GSE231769' || link.url.includes('journals.plos.org'))).url;
  const originalReferences = [originalPath, 'scripts/prepare_author_sources_b.mts'].map(path => ({ path, sourceUrl: path === originalPath ? sourceUrl : 'Local deterministic author-table extraction; no local effect-based selection', sha256: hash(path), bytes: readFileSync(path).length }));
  const exclusions = rows.filter(row => !named.includes(row));
  emit(`${folder}/extraction.json`, JSON.stringify({ accession, originalReferences, worksheet: sheetName || workbook.SheetNames[0], parsedRows: rows.length, identifiedRows: named.length, unidentifiedRows: exclusions, authorPath, sha256: hash(authorPath), localPath, localSha256: hash(localPath), note: 'All identified author rows are exported before any local join or numerical filtering. Blank worksheet rows carry no identifiable result. Original workbook preserved. No fitted reconstruction is substituted for registered output.' }, null, 2) + '\n');
  return { datasetId: record.datasetId, accession, contrast: record.verification.comparability.registeredContrastIds[0], localPath, localKey: 'id', authorPath, sourceUrl, sha256: hash(authorPath), format: 'tsv', authorKey: 'id', authorEffect: 'logFC', authorAdjustedP: 'padj', orientationSign: 1, localMethod, authorMethod, orientation: accession === 'GSE273038' ? 'CR minus AL: log2(author fold.change), negative when the author max.condition is AL. Hypothalamus selected solely from the author brain_region field.' : 'Original author coefficient already follows the registered case-minus-control direction; no sign inversion.', note: `${record.verification.comparability.basis} Every identified row in the ${record.verification.comparability.resultScope === 'selected_results' ? 'author-selected tissue list' : 'full author table'} is retained before local joining. Historical statistical and cohort limitations remain in the reviewed comparability record; missing FDR remains unknown.`, interpretation: 'effects_compared', originalReferences };
});
emit(`${out}/additional-comparison-specs.json`, JSON.stringify({ schemaVersion: 1, comparisons }, null, 2) + '\n');
console.log(`${checking ? 'Checked' : 'Prepared'} ${comparisons.length} author-table comparisons from retained original sources.`);
