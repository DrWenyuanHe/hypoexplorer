import { describe, expect, it } from 'vitest';
import {
  compareNullable,
  geneEvidence,
  geneStatus,
  pathwayEvidence,
  pathwayStatus,
  sameOrganism,
} from './comparison';
import type { LocalDataset, LocalGene, LocalPathway } from './types';

const gene = (values: Partial<LocalGene> = {}): LocalGene => ({
  gene: 'Pomc',
  logFC: 1.5,
  pvalue: 0.001,
  padj: 0.01,
  source: 'DE',
  ...values,
});
const pathway = (values: Partial<LocalPathway> = {}): LocalPathway => ({
  pathway: 'GO:0001',
  name: 'Test pathway',
  database: 'GO_BP',
  nes: 1.8,
  pvalue: 0.002,
  padj: 0.02,
  size: 100,
  genes: ['Pomc'],
  source: 'FGSEA',
  ...values,
});
const dataset = (id: string, values: Partial<LocalDataset> = {}): LocalDataset => ({
  id,
  name: id,
  organism: 'Mus musculus',
  createdAt: '',
  updatedAt: '',
  genes: [],
  pathways: [],
  sources: [],
  ...values,
});

describe('local evidence', () => {
  it('distinguishes absent, missing adjusted P, and below-cutoff genes', () => {
    expect(geneStatus(undefined, 0.05)).toBe('missing');
    expect(geneStatus(gene({ padj: null }), 0.05)).toBe('unknown');
    expect(geneStatus(gene({ padj: 0.5 }), 0.05)).toBe('below');
    expect(geneStatus(gene({ logFC: 0.5 }), 0.05, 1)).toBe('below');
    expect(geneStatus(gene({ logFC: -1.5 }), 0.05, 1)).toBe('down');
    expect(geneStatus(gene({ padj: 0 }), 0.05)).toBe('up');
  });

  it('applies strict cutoffs and does not assign direction to ORA results', () => {
    expect(geneStatus(gene({ padj: 0.05 }), 0.05)).toBe('below');
    expect(geneStatus(gene({ logFC: 1 }), 0.05, 1)).toBe('below');
    expect(pathwayStatus(pathway({ nes: null }), 0.05)).toBe('enriched');
    expect(pathwayStatus(pathway({ nes: null, padj: null }), 0.05)).toBe('unknown');
    expect(pathwayStatus(pathway({ nes: -2 }), 0.05)).toBe('down');
  });

  it('matches symbol letter case within a known species and never implies orthology', () => {
    const evidence = geneEvidence(
      [
        dataset('same', { genes: [gene()] }),
        dataset('case differs', { genes: [gene({ gene: 'POMC' })] }),
        dataset('human', { organism: 'Homo sapiens', genes: [gene()] }),
        dataset('unknown', { organism: '', genes: [gene()] }),
        dataset('negative', { genes: [gene({ logFC: -2 })] }),
      ],
      'Pomc',
      'Mus musculus',
      0.05,
    );
    expect(evidence.map((e) => e.status)).toEqual([
      'up',
      'up',
      'species-mismatch',
      'species-mismatch',
      'down',
    ]);
    expect(sameOrganism(' Mus musculus ', 'mus musculus')).toBe(true);
    expect(sameOrganism('unknown', 'unknown')).toBe(false);
    expect(sameOrganism('Other / unknown', 'Other / unknown')).toBe(false);
    expect(sameOrganism('Other', 'Other')).toBe(false);
  });

  it('recognizes unambiguous common species names while keeping macaque species separate', () => {
    expect(sameOrganism('Human', 'Homo sapiens')).toBe(true);
    expect(sameOrganism('mouse', 'Mus musculus')).toBe(true);
    expect(sameOrganism('rat', 'Rattus norvegicus')).toBe(true);
    expect(sameOrganism('rhesus macaque', 'Macaca mulatta')).toBe(true);
    expect(sameOrganism('cynomolgus macaque', 'Macaca fascicularis')).toBe(true);
    expect(sameOrganism('rhesus macaque', 'cynomolgus macaque')).toBe(false);
    expect(sameOrganism('macaque', 'macaque')).toBe(false);
  });

  it('does not strip Ensembl version suffixes or infer alternate symbols', () => {
    const rows = [
      dataset('versioned', {
        genes: [gene({ gene: 'ENSMUSG000000001.2' }), gene({ gene: 'POMC' })],
      }),
    ];
    expect(geneEvidence(rows, 'ENSMUSG000000001.1', 'mouse', 0.05)[0].status).toBe('missing');
    expect(geneEvidence(rows, 'ENSMUSG000000001', 'mouse', 0.05)[0].status).toBe('missing');
    expect(geneEvidence(rows, 'ACTH', 'mouse', 0.05)[0].status).toBe('missing');
  });

  it('retains a selection’s own evidence when species is unknown but excludes other unknown datasets', () => {
    const unknown = [
      dataset('source', { organism: 'Other / unknown', genes: [gene()] }),
      dataset('other', { organism: 'Other / unknown', genes: [gene()] }),
    ];
    expect(
      geneEvidence(unknown, 'Pomc', 'Other / unknown', 0.05, 0, 'source').map((e) => e.status),
    ).toEqual(['up', 'species-mismatch']);
  });

  it('reports duplicate matches and selects the smallest available adjusted P', () => {
    const evidence = geneEvidence(
      [
        dataset('duplicate', {
          genes: [gene({ padj: null }), gene({ padj: 0.1 }), gene({ padj: 0.01, logFC: -3 })],
        }),
      ],
      'Pomc',
      'Mus musculus',
      0.05,
    );
    expect(evidence[0].matches).toBe(3);
    expect(evidence[0].status).toBe('down');
    expect(evidence[0].row?.logFC).toBe(-3);
  });

  it('requires exact pathway IDs and compatible database labels', () => {
    const evidence = pathwayEvidence(
      [
        dataset('match', { pathways: [pathway({ database: 'go_bp' })] }),
        dataset('other database', { pathways: [pathway({ database: 'REACTOME' })] }),
        dataset('same name other ID', { pathways: [pathway({ pathway: 'GO:0002' })] }),
      ],
      pathway(),
      'Mus musculus',
      0.05,
    );
    expect(evidence.map((e) => e.status)).toEqual(['up', 'missing', 'missing']);
  });

  it('keeps unavailable statistics last when either ascending or descending', () => {
    for (const direction of [1, -1]) {
      const ordered = [null, 0.1, 0.001, null].sort((a, b) => compareNullable(a, b, direction));
      expect(ordered.slice(2)).toEqual([null, null]);
      expect(ordered[0]).toBe(direction === 1 ? 0.001 : 0.1);
    }
  });
});
