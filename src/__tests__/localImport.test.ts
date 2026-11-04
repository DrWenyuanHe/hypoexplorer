import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  getSheetHeaders, LOCAL_FILE_MAX_BYTES, normalizeSheet, parseDelimitedRows,
  parseLeadingEdge, parseLocalFile, parseLocalNumber, parseLocalText,
  parseLocalWorkbook, suggestMapping, validateMapping,
} from '../local-datasets/importData';

describe('local results import', () => {
  it('suggests the provided DESeq2 export columns without mixing Wald and threshold tests', () => {
    const sheet = parseLocalText([
      'gene_id,gene_name,gene_type,baseMean,wald_log2FoldChange,apeglm_lfc,wald_lfcSE,wald_stat,wald_pvalue,wald_padj,threshold_stat,threshold_pvalue,threshold_padj',
      'ENSG00000081041.11,CXCL2,protein_coding,3458.36,6.3195,6.3156,0.1114,56.68,0,0,51.43,0.2,0.3',
    ].join('\n'), 'results_paired.csv');
    expect(sheet.kind).toBe('de');
    expect(sheet.mapping).toEqual({ gene: 1, geneId: 0, logFC: 4, pvalue: 8, padj: 9 });
    const result = normalizeSheet(sheet);
    expect(result.genes[0]).toMatchObject({ gene: 'CXCL2', geneId: 'ENSG00000081041.11', logFC: 6.3195, pvalue: 0, padj: 0 });
    expect(result.source.mapping).toEqual(sheet.mapping);
    expect(result.skippedRows).toBe(0);
  });

  it('prefers leading-edge symbols over Ensembl identifiers in the supplied FGSEA layout', () => {
    const sheet = parseLocalText([
      'pathway,pval,padj,log2err,ES,NES,size,leadingEdge_ensembl,leadingEdge_symbol',
      'HALLMARK_TNFA_SIGNALING_VIA_NFKB,1.6e-35,8e-34,1.55,0.78,2.73,193,ENSG1/ENSG2,CXCL2/IL6',
    ].join('\n'), 'fgsea_hallmark.csv');
    expect(sheet.kind).toBe('pathway');
    expect(sheet.mapping.leadingEdge).toBe(8);
    expect(normalizeSheet(sheet).pathways[0]).toMatchObject({ pathway: 'HALLMARK_TNFA_SIGNALING_VIA_NFKB', nes: 2.73, padj: 8e-34, genes: ['CXCL2', 'IL6'], database: 'HALLMARK' });
  });

  it('reads a BOM, quotes, escaped quotes, commas inside cells and CRLF inside cells', () => {
    const text = '\uFEFFpathway,NES,padj,leadingEdge\r\n"Response to ","bad",0.1,A\r\n"Response to ""stress"",\r\nrecovery",-1.8,0.02,"A/B"\r\n';
    const rows = parseDelimitedRows(text, ',');
    expect(rows[2]).toEqual(['Response to "stress",\r\nrecovery', '-1.8', '0.02', 'A/B']);
    const result = normalizeSheet(parseLocalText(text, 'results.csv'));
    expect(result.pathways[1].nes).toBe(-1.8);
    expect(result.pathways[0].nes).toBeNull();
  });

  it('detects semicolon, tab, and whitespace text tables', () => {
    for (const delimiter of [';', '\t', '  ']) {
      const sheet = parseLocalText([['Gene Symbol', 'log2FoldChange', 'padj'].map((v) => `"${v}"`).join(delimiter), ['POMC', '-2.5', '0.01'].join(delimiter)].join('\n'), 'table.txt');
      expect(normalizeSheet(sheet).genes[0]).toMatchObject({ gene: 'POMC', logFC: -2.5, padj: 0.01 });
    }
  });

  it('recognizes a preamble and preserves blank row positions for manual header selection', () => {
    const sheet = parseLocalText('Study output\n\nDetails\n\nSymbol\tlogFC\tFDR\nPOMC\t2\t0.01\n', 'results.tsv');
    expect(sheet.headerRow).toBe(4);
    expect(getSheetHeaders(sheet)).toEqual(['Symbol', 'logFC', 'FDR']);
    expect(normalizeSheet(sheet).genes).toHaveLength(1);
    expect(normalizeSheet(sheet).source.headerRow).toBe(4);
  });

  it('accepts a user-selected header and columns even when suggestions cannot recognize them', () => {
    const sheet = parseLocalText('project,demo,only\nfeature_label,effect_estimate,adjustment\nPOMC,1.4,0.002\n', 'custom.csv');
    const result = normalizeSheet(sheet, { headerRow: 1, kind: 'de', mapping: { gene: 0, logFC: 1, padj: 2 } });
    expect(result.genes[0]).toMatchObject({ gene: 'POMC', logFC: 1.4, padj: 0.002, pvalue: null });
  });

  it('supports R row names and gene-ID-only files', () => {
    const rownames = parseLocalText(',logFC,FDR\nPomc,-2.1,0.004\n', 'limma.csv');
    expect(rownames.mapping.gene).toBe(0);
    expect(getSheetHeaders(rownames)[0]).toBe('Column 1');
    const ids = parseLocalText('gene_id\tavg_log2FC\tp_val_adj\nENSG000001\t1.9\t0.01', 'seurat.tsv');
    expect(normalizeSheet(ids).genes[0]).toMatchObject({ gene: 'ENSG000001', geneId: 'ENSG000001', padj: 0.01 });
  });

  it('never treats absent, malformed, or out-of-range probabilities as significant', () => {
    const sheet = parseLocalText('symbol,logFC,pvalue,padj\nA,1,0.001,\nB,1,NA,NA\nC,1,0.01,1.1\nD,1,0.05,-0.01\nE,1,<0.05,0.02*\nF,1,0,0\n', 'de.csv');
    const rows = normalizeSheet(sheet).genes;
    expect(rows.slice(0, 5).map((row) => row.padj)).toEqual([null, null, null, null, null]);
    expect(rows[0].pvalue).toBe(0.001);
    expect(rows[4].pvalue).toBeNull();
    expect(rows[5]).toMatchObject({ pvalue: 0, padj: 0 });
    expect(rows.filter((row) => row.padj != null && row.padj < 0.05).map((row) => row.gene)).toEqual(['F']);
    const rawOnly = normalizeSheet(parseLocalText('gene,logFC,P.Value\nA,2,0.001\n', 'raw.csv'));
    expect(rawOnly.genes[0].padj).toBeNull();
    expect(rawOnly.issues.join(' ')).toContain('raw p-values are not substituted');
  });

  it('skips invalid effects and duplicate identifiers with explicit counts, retaining identifier spelling', () => {
    const result = normalizeSheet(parseLocalText('gene,logFC,FDR\nA,Infinity,0.01\nB,nonnumeric,0.01\nC,,0.01\nD,2,0.02\nD,3,0.001\nd,4,0.03\n,1,0.05\n', 'de.csv'));
    expect(result.genes.map((row) => [row.gene, row.logFC])).toEqual([['D', 2], ['d', 4]]);
    expect(result.skippedRows).toBe(5);
    expect(result.issues.join(' ')).toContain('first valid row was retained');
  });

  it('supports overrepresentation results without fabricating signed enrichment', () => {
    const sheet = parseLocalText('ID,Description,GeneRatio,pvalue,p.adjust,qvalue,geneID,Count\nGO:0001,Example process,3/10,0.001,0.02,0.02,POMC/AGRP/NPY,3\n', 'ora.csv');
    expect(sheet.kind).toBe('pathway');
    const result = normalizeSheet(sheet);
    expect(result.pathways[0]).toMatchObject({ pathway: 'GO:0001', name: 'Example process', nes: null, padj: 0.02, size: 3, genes: ['POMC', 'AGRP', 'NPY'] });
    expect(result.issues.join(' ')).toContain('no enrichment direction');
    expect(suggestMapping(['pathway', 'ES', 'pval', 'padj'], 'pathway').nes).toBeUndefined();
    const enrichr = parseLocalText('Term\tOverlap\tP-value\tAdjusted P-value\tOdds Ratio\tCombined Score\tGenes\nStress\t2/30\t0.001\t0.01\t3.2\t4.5\tPOMC;AGRP', 'enrichr.txt');
    expect(enrichr.kind).toBe('pathway');
    expect(normalizeSheet(enrichr).pathways[0]).toMatchObject({ pathway: 'Stress', padj: 0.01, nes: null, genes: ['POMC', 'AGRP'] });
  });

  it('parses common pathway gene-list encodings without resolving aliases or species', () => {
    expect(parseLeadingEdge('["Pomc", "AgRP", "Pomc"]')).toEqual(['Pomc', 'AgRP']);
    expect(parseLeadingEdge('c("POMC", "AGRP")')).toEqual(['POMC', 'AGRP']);
    expect(parseLeadingEdge('POMC/AGRP;NPY|LEP LEPR')).toEqual(['POMC', 'AGRP', 'NPY', 'LEP', 'LEPR']);
    expect(parseLeadingEdge('NA')).toEqual([]);
  });

  it('rejects broken quotes, invalid column mappings, and empty files with actionable messages', () => {
    expect(() => parseLocalText('gene,logFC\n"POMC,1', 'broken.csv')).toThrow(/unclosed quoted cell/);
    expect(() => parseLocalText('\uFEFF\n\n', 'empty.csv')).toThrow(/empty/);
    expect(validateMapping('de', {})).toHaveLength(2);
    expect(validateMapping('de', { gene: 0, logFC: 1, pvalue: 2, padj: 2 }).join(' ')).toContain('different column');
    expect(validateMapping('de', { geneId: 0, logFC: 0 }).join(' ')).toContain('different column');
    const sheet = parseLocalText('gene,logFC\nA,1', 'de.csv');
    expect(() => normalizeSheet(sheet, { ...sheet, mapping: { gene: 0, logFC: 10 } })).toThrow(/outside this table/);
    expect(() => normalizeSheet(sheet, { ...sheet, headerRow: -1 })).toThrow(/valid header row/);
  });

  it('strictly accepts decimal and scientific numeric values including Unicode minus', () => {
    expect(parseLocalNumber(' −1.23e-4 ')).toBe(-0.000123);
    expect(parseLocalNumber('.05')).toBe(0.05);
    for (const text of ['', 'NA', 'nan', 'Inf', 'Infinity', '1.2x', '<0.05', '0x10', '1,000', '1e999']) expect(parseLocalNumber(text)).toBeNull();
  });

  it.each(['xlsx', 'xls'] as const)('reads every non-empty %s worksheet with full numeric precision and original header rows', async (bookType) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Study title'], [], ['gene', 'logFC', 'padj'], ['POMC', 1.234567890123, 1.23456789e-18]]), 'DE');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['pathway', 'NES', 'padj', 'leadingEdge'], ['HALLMARK_APOPTOSIS', -1.5, 0.03, 'POMC/AGRP']]), 'FGSEA');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
    const bytes = XLSX.write(workbook, { type: 'array', bookType });
    const sheets = await parseLocalWorkbook(bytes, `results.${bookType}`);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['DE', 'FGSEA']);
    expect(sheets[0].headerRow).toBe(2);
    expect(normalizeSheet(sheets[0]).genes[0]).toMatchObject({ gene: 'POMC', logFC: 1.234567890123, padj: 1.23456789e-18 });
    expect(normalizeSheet(sheets[1]).pathways[0].genes).toEqual(['POMC', 'AGRP']);
  });

  it('reads browser File bytes directly and checks file size and extensions before reading', async () => {
    const file = new File(['gene,logFC,FDR\nPOMC,1,0.01\n'], 'my-results.csv', { type: 'text/csv' });
    expect(normalizeSheet((await parseLocalFile(file))[0]).genes[0].gene).toBe('POMC');
    await expect(parseLocalFile(new File(['hello'], 'script.js'))).rejects.toThrow(/Choose a CSV/);
    const oversized = new File([''], 'too-large.csv');
    Object.defineProperty(oversized, 'size', { value: LOCAL_FILE_MAX_BYTES + 1 });
    await expect(parseLocalFile(oversized)).rejects.toThrow(/50 MB/);
  });
});
