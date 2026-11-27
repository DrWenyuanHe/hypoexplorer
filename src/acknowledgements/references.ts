// Software, gene-set collections and reference atlases behind HypoExplorer's
// results, and the acknowledgements that go with them. Plain data, so both the
// app and the static /how-to-cite/ page (scripts/lib/seoGuides.mts) can read it.
// Citations were verified against PubMed, or for an R package with no paper
// (msigdbr) against its CRAN DOI record; each carries a resolvable DOI.
//
// This replaced the explorer's Data Sources tab, which also listed every study
// (the library and /studies/ list them) and described the macaque cohort (its
// study record and the Methods & statistics page describe it).

export interface SoftwareReference {
  resource: string;
  /** Citation string. */
  ref: string;
  /** Resolves at https://doi.org/<doi>. */
  doi: string;
}

export const SOFTWARE_REFERENCES: readonly SoftwareReference[] = [
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
    resource: 'limma',
    ref: 'Ritchie ME, Phipson B, Wu D, et al. limma powers differential expression analyses for RNA-sequencing and microarray studies. Nucleic Acids Res. 2015;43(7):e47.',
    doi: '10.1093/nar/gkv007',
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
    resource: 'msigdbr',
    ref: 'Dolgalev I. msigdbr: MSigDB Gene Sets for Multiple Organisms in a Tidy Data Format. R package version 26.1.0. CRAN.',
    doi: '10.32614/CRAN.package.msigdbr',
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
  // Allen Human Brain Atlas microarray, used under the Allen Institute's noncommercial terms;
  // HYPOMAP human Visium, below).
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
  // HYPOMAP human Visium sections, by region (data/expression/visium; dataset
  // doi:10.17863/CAM.111988, CC BY 4.0, summed per donor and region and converted to CPM here).
  {
    resource: 'HYPOMAP human Visium',
    ref: 'Tadross JA, Steuernagel L, Dowsett GKC, et al. A comprehensive spatio-cellular map of the human hypothalamus. Nature. 2025;639(8055):708–716. Visium data from the University of Cambridge repository (doi:10.17863/CAM.111988), CC BY 4.0, transformed by HypoExplorer.',
    doi: '10.1038/s41586-024-08504-8',
  },
  {
    resource: 'HPA single-nucleus brain',
    ref: 'Siletti K, Hodge R, Mossi Albiach A, et al. Transcriptomic diversity of cell types across the adult human brain. Science. 2023;382(6667):eadd7046. Source of the HPA single-nucleus hypothalamus clusters.',
    doi: '10.1126/science.add7046',
  },
  // Mouse reference collections in the expression survey (data/expression/neuroseq and
  // data/expression/oxt-reference record their sources).
  {
    resource: 'NeuroSeq',
    ref: 'Sugino K, Clark E, Schulmann A, et al. Mapping the transcriptional diversity of genetically and anatomically defined cell populations in the mouse brain. eLife. 2019;8:e38619. Janelia Research Campus; neuroseq.janelia.org.',
    doi: '10.7554/eLife.38619',
  },
  {
    resource: 'Oxytocin-neuron reference (GSE147092)',
    ref: "Lewis EM, Stein-O'Brien GL, Patino AV, et al. Parallel social information processing circuits are differentially impacted in autism. Neuron. 2020;108(4):659–675.e6.",
    doi: '10.1016/j.neuron.2020.10.002',
  },
];

/** Acknowledgement paragraphs, as plain sentences. */
export const ACKNOWLEDGEMENTS: readonly string[] = [
  'We thank Lei et al. (Cell Metab, 2024) for generating and openly publishing the macaque hypothalamus single-nucleus dataset that HypoExplorer re-analyzes, and every group whose deposited data appear in the collection.',
  'We also thank the teams behind MSigDB (Broad Institute) and msigdbr, Reactome, KEGG, the Gene Ontology Consortium, GTEx, the Human Protein Atlas, the Allen Institute for Brain Science, the HYPOMAP authors (Tadross et al., human Visium sections), Janelia\'s NeuroSeq, and the Goff Lab (GSE147092 oxytocin-neuron reference), and the Bioconductor developers of edgeR, limma and fgsea, for the annotations, reference data and analysis software used here.',
];
