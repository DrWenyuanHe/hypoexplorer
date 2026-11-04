// Static data-sources / acknowledgements tab.
// Prose is written directly as JSX (the app has no markdown renderer) and
// shares the reference-page prose of src/common/prose. Citations were
// verified against PubMed; each carries a resolvable DOI link.
//
// The "Datasets in this explorer" section is generated from the bundled
// DATASETS registry (src/data/datasets.js) so every dataset added to the
// app shows up here automatically with its organism, modality and citation.

import type { CSSProperties, ReactNode } from 'react';
import { DATASETS } from '../data/datasets';
import { listContrasts } from '../data/contrasts';
import { repositoryName, repositoryUrl, datasetPmid, pubmedUrl, citationWithoutPmid } from '../utils/datasetLinks';
import { TRACKER_REVERSE_INDEX } from '../data/tracker/reverseIndex.generated.js';
import type { Dataset } from '../types';

import { FONT_HEADING, FONT_MONO, FONT_SANS } from '../styles/constants';
import { H2, Mono, P, tdStyle as tdBaseStyle, thStyle } from '../common/prose';

// Software + gene-set databases behind the results shown in the explorer.
// `ref` is a citation string; `doi` resolves at https://doi.org/<doi>.
const REFS = [
  {
    resource: 'edgeR',
    ref: 'Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. Bioinformatics. 2010;26(1):139–140.',
    doi: '10.1093/bioinformatics/btp616',
  },
  {
    resource: 'edgeR QL',
    ref: 'Chen Y, Lun ATL, Smyth GK. From reads to genes to pathways: differential expression analysis of RNA-Seq experiments using Rsubread and the edgeR quasi-likelihood pipeline. F1000Research. 2016;5:1438.',
    doi: '10.12688/f1000research.8987.2',
  },
  {
    resource: 'TMM',
    ref: 'Robinson MD, Oshlack A. A scaling normalization method for differential expression analysis of RNA-seq data. Genome Biol. 2010;11(3):R25.',
    doi: '10.1186/gb-2010-11-3-r25',
  },
  {
    resource: 'GSEA',
    ref: 'Subramanian A, Tamayo P, Mootha VK, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. Proc Natl Acad Sci USA. 2005;102(43):15545–15550.',
    doi: '10.1073/pnas.0506580102',
  },
  {
    resource: 'fgsea',
    ref: 'Korotkevich G, Sukhov V, Budin N, et al. Fast gene set enrichment analysis. bioRxiv 060012; 2021 (preprint).',
    doi: '10.1101/060012',
  },
  {
    resource: 'MSigDB / Hallmark',
    ref: 'Liberzon A, Birger C, Thorvaldsdóttir H, et al. The Molecular Signatures Database (MSigDB) hallmark gene set collection. Cell Syst. 2015;1(6):417–425.',
    doi: '10.1016/j.cels.2015.12.004',
  },
  {
    resource: 'Reactome',
    ref: 'Gillespie M, Jassal B, Stephan R, et al. The Reactome Pathway Knowledgebase 2022. Nucleic Acids Res. 2022;50(D1):D687–D692.',
    doi: '10.1093/nar/gkab1028',
  },
  {
    resource: 'KEGG',
    ref: 'Kanehisa M, Goto S. KEGG: Kyoto Encyclopedia of Genes and Genomes. Nucleic Acids Res. 2000;28(1):27–30.',
    doi: '10.1093/nar/28.1.27',
  },
  {
    resource: 'Gene Ontology',
    ref: 'Ashburner M, Ball CA, Blake JA, et al. Gene Ontology: tool for the unification of biology. Nat Genet. 2000;25(1):25–29.',
    doi: '10.1038/75556',
  },
  {
    resource: 'GO knowledgebase',
    ref: 'The Gene Ontology Consortium. The Gene Ontology knowledgebase in 2023. Genetics. 2023;224(1):iyad031.',
    doi: '10.1093/genetics/iyad031',
  },
  {
    resource: 'Seurat',
    ref: 'Hao Y, Hao S, Andersen-Nissen E, et al. Integrated analysis of multimodal single-cell data. Cell. 2021;184(13):3573–3587.e29.',
    doi: '10.1016/j.cell.2021.04.048',
  },
  // Reference atlases in the expression survey (GTEx Release V10; Human Protein Atlas version 25;
  // Allen Human Brain Atlas microarray, used under the Allen Institute's noncommercial terms).
  {
    resource: 'Allen Human Brain Atlas',
    ref: 'Hawrylycz MJ, Lein ES, Guillozet-Bongaarts AL, et al. An anatomically comprehensive atlas of the adult human brain transcriptome. Nature. 2012;489(7416):391–399. Allen Institute for Brain Science; human.brain-map.org.',
    doi: '10.1038/nature11405',
  },
  {
    resource: 'GTEx',
    ref: 'GTEx Consortium. The GTEx Consortium atlas of genetic regulatory effects across human tissues. Science. 2020;369(6509):1318–1330. The Genotype-Tissue Expression (GTEx) Project was supported by the Common Fund of the Office of the Director of the National Institutes of Health, and by NCI, NHGRI, NHLBI, NIDA, NIMH, and NINDS.',
    doi: '10.1126/science.aaz1776',
  },
  {
    resource: 'Human Protein Atlas',
    ref: 'Sjöstedt E, Zhong W, Fagerberg L, et al. An atlas of the protein-coding genes in the human, pig, and mouse brain. Science. 2020;367(6482):eaay5947. Data from HPA version 25 (v25.proteinatlas.org), CC BY 4.0.',
    doi: '10.1126/science.aay5947',
  },
  {
    resource: 'HPA single-nucleus brain',
    ref: 'Siletti K, Hodge R, Mossi Albiach A, et al. Transcriptomic diversity of cell types across the adult human brain. Science. 2023;382(6667):eadd7046. Source of the HPA single-nucleus hypothalamus clusters.',
    doi: '10.1126/science.add7046',
  },
];

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: 'var(--color-selected)', textDecoration: 'underline' }}>
      {children}
    </a>
  );
}

function Doi({ doi }: { doi: string }) {
  return <ExtLink href={`https://doi.org/${doi}`}>{`doi:${doi}`}</ExtLink>;
}

// One card per registered dataset, driven by the DATASETS manifest. Field/value
// rows mirror the manifest keys so adding a dataset needs no edit here.
function DatasetCard({ dataset, onOpenTracker }: { dataset: Dataset; onOpenTracker?: (acc?: string) => void }) {
  const repoUrl = repositoryUrl(dataset.geo);
  const contrasts = listContrasts(dataset);
  const pmid = datasetPmid(dataset);
  const pmUrl = pubmedUrl(pmid);
  const rows: Array<[string, string]> = [
    ['Organism', dataset.organism],
    ['Modality', dataset.modality],
    ['Feature type', dataset.featureLabel || dataset.featureType],
    ...(dataset.expressionUnit ? ([['Expression unit', dataset.expressionUnit]] as Array<[string, string]>) : []),
    ...(dataset.geo ? ([['Accession', dataset.geo]] as Array<[string, string]>) : []),
    ['Design', dataset.groups.map((g) => g.label).join(' · ')],
    ...(contrasts.length ? ([['Contrast', contrasts.map((c) => c.label).join(', ')]] as Array<[string, string]>) : []),
    // Stripped, not raw: the PMID gets its own link at the end of this row, and
    // most citations also name it in prose. See citationWithoutPmid.
    ['Source', citationWithoutPmid(dataset.citation)],
  ];
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px',
      margin: '0 0 10px', background: 'var(--bg-panel, transparent)',
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
        fontFamily: FONT_SANS, marginBottom: 8,
      }}>
        {dataset.name}
        {dataset.isDefault ? (
          <span style={{
            marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
            fontFamily: FONT_MONO, textTransform: 'uppercase', letterSpacing: 0.4,
          }}>
            default
          </span>
        ) : null}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {rows.map(([field, value]) => (
            <tr key={field}>
              <td style={{
                padding: '3px 8px 3px 0', fontSize: 11, fontWeight: 600,
                color: 'var(--text-muted)', fontFamily: FONT_SANS,
                width: 110, verticalAlign: 'top', whiteSpace: 'nowrap',
              }}>
                {field}
              </td>
              <td style={{
                padding: '3px 0', fontSize: 12, color: 'var(--text-primary)',
                fontFamily: FONT_SANS,
                fontStyle: field === 'Organism' ? 'italic' : 'normal',
                lineHeight: 1.5, verticalAlign: 'top',
              }}>
                {field === 'Accession' && repoUrl ? (
                  <>
                    <ExtLink href={repoUrl}>{value}</ExtLink>
                    <span style={{ color: 'var(--text-muted)' }}> · {repositoryName(dataset.geo)}</span>
                  </>
                ) : (
                  value
                )}
                {field === 'Source' && dataset.doi ? (
                  <>
                    {' '}
                    <ExtLink href={`https://doi.org/${dataset.doi}`}>{dataset.doi}</ExtLink>
                  </>
                ) : null}
                {field === 'Source' && pmUrl ? (
                  <>
                    {' · '}
                    <ExtLink href={pmUrl}>{`PMID ${pmid}`}</ExtLink>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {onOpenTracker ? (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => onOpenTracker((TRACKER_REVERSE_INDEX as Record<string, string>)[dataset.id])}
            style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-selected)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT_SANS }}>
            View in dataset tracker →
          </button>
        </div>
      ) : null}
    </div>
  );
}

// The shared cell, top-aligned: this page's reference rows are multi-line, so the
// resource cell must sit against the top of a wrapped citation.
const tdStyle: CSSProperties = { ...tdBaseStyle, verticalAlign: 'top' };

// Reference cell uses the sans face and wraps (citations are long).
const tdRefStyle: CSSProperties = {
  ...tdStyle, fontFamily: FONT_SANS, fontSize: 11.5, lineHeight: 1.5,
};

export function DataSourcesTab({ onOpenTracker }: { onOpenTracker?: (acc?: string) => void }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-app)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', fontFamily: FONT_HEADING,
          }}>
            Data sources &amp; acknowledgements
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: FONT_SANS }}>
            HypoExplorer, hypothalamic gene &amp; pathway explorer
          </div>
        </div>

        {/* 0. Datasets registry (generated from DATASETS) */}
        <H2>Datasets in this explorer</H2>
        {DATASETS.map((d) => (
          <DatasetCard key={d.id} dataset={d} onOpenTracker={onOpenTracker} />
        ))}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5, margin: '4px 0 0' }}>
          The sections below describe the default macaque dataset, its cohort, source study and
          analysis pipeline. The cards above summarize and cite the other datasets.
        </div>

        {/* 1. Dataset (macaque, default) */}
        <H2>Macaque dataset (default)</H2>
        <P>
          This explorer presents an independent re-analysis of single-nucleus RNA-seq from
          the cynomolgus macaque (<em>Macaca fascicularis</em>) hypothalamus. The cohort shown here is{' '}
          <strong>3 Normal vs 3 Obese</strong> animals (samples{' '}
          <Mono>HCA_Macaque001_S001–S006</Mono>) across <strong>60 cell populations</strong>.
          These include 45 neuronal (glutamatergic, GABAergic, histaminergic, oxytocin) and 15 non-neuronal
          (astrocytes, oligodendrocytes, OPC/COP, microglia, ependymal, tanycytes, endothelial,
          fibroblasts).
        </P>
        <P>
          This project&apos;s pseudobulk pipeline computes the differential-expression and
          pathway-enrichment results shown here. See the{' '}
          <a href="#/methodology" style={{ color: 'var(--accent)' }}>Methodology page</a> for details.
          The underlying single-nucleus data come from the published macaque hypothalamus study below.
        </P>

        {/* 2. Source dataset (macaque) */}
        <H2>Macaque source dataset</H2>
        <P>
          Lei Y, Liang X, Sun Y, Yao T, Gong H, Chen Z, Gao Y, Wang H, Wang R, Huang Y, Yang T,
          Yu M, Liu L, Yi C-X, Wu Q-F, Kong X, Xu X, Liu S, Zhang Z, Liu T.{' '}
          <em>Region-specific transcriptomic responses to obesity and diabetes in macaque
          hypothalamus.</em> Cell Metab. 2024;36(2):438–453.e6.{' '}
          <Doi doi="10.1016/j.cmet.2024.01.003" /> · PMID 38325338.
        </P>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5, margin: '0 0 4px' }}>
          The source study profiled obese and sporadically diabetic macaques; this explorer uses
          the obese-vs-normal contrast. Citation retrieved from PubMed.
        </div>

        {/* 3. Methods & gene-set databases (macaque pipeline) */}
        <H2>Methods &amp; gene-set databases (macaque)</H2>
        <P>
          Per-cluster pseudobulk differential expression is run with <Mono>edgeR</Mono>{' '}
          (quasi-likelihood), and the signed F-statistic ranking feeds <Mono>fgsea</Mono>{' '}
          against the MSigDB Hallmark, KEGG, GO:BP and Reactome collections for{' '}
          <em>Macaca mulatta</em> (the closest msigdbr-supported ortholog proxy for the
          cynomolgus source animals). Software and annotation sources:
        </P>
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0 8px', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 120 }}>Resource</th>
              <th style={thStyle}>Reference</th>
            </tr>
          </thead>
          <tbody>
            {REFS.map((r) => (
              <tr key={r.resource}>
                <td style={tdStyle}>{r.resource}</td>
                <td style={tdRefStyle}>
                  {r.ref} <Doi doi={r.doi} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5, margin: '4px 0 0' }}>
          These cover the differential-expression and pathway-enrichment results shown in the
          Gene and Pathway Explorers; cell-composition and QC statistics are described in the
          Quality Control tab.
        </div>

        {/* 4. Acknowledgements */}
        <H2>Acknowledgements</H2>
        <P>
          We thank Lei et al. (Cell Metab, 2024) for generating and openly
          publishing the macaque hypothalamus single-nucleus dataset that this explorer
          re-analyzes.
        </P>
        <P>
          We also thank the teams behind MSigDB (Broad Institute), Reactome, KEGG, the Gene Ontology
          Consortium, and the Bioconductor developers of edgeR and fgsea for the pathway annotations
          and analysis software used here.
        </P>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.5 }}>
          A citation for this re-analysis will be added on publication.
        </div>
      </div>
    </div>
  );
}
