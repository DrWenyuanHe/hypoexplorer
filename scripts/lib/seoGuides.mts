// Public documentation of the actual registry and verification contract.
// Avoid importing the HTML renderer here: it consumes these document bodies.
import { listDatasets } from '../../src/data/datasets';
import { QUALITY_STATUS } from '../../src/data/datasetQualityR460';
import { AUTHOR_BIO, AUTHOR_EMAIL, AUTHOR_NAME, CONTRIBUTOR_NAMES, DATA_EXPORT_DOI, SITE_NAME, SITE_URL, studyPageHref } from '../../src/data/siteInfo';
import sourceMetadata from '../../data/seo/studySources.json';

export interface GuideDocument {
  title: string;
  description: string;
  path: string;
  body: string;
  schema: unknown[];
}

interface SourcePublication {
  paperTitle?: string;
  paperDoi?: string;
  paperPmid?: string;
  paperAuthors?: string[];
  sourceUrl?: string;
}

const sources = sourceMetadata as Record<string, SourcePublication>;
const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function publicationExample(datasetId: string): string {
  const dataset = listDatasets().find((entry) => entry.id === datasetId);
  if (!dataset) return '';
  const source = sources[datasetId] ?? (dataset.geo ? sources[dataset.geo] : undefined);
  // A snapshot for a different publication must not be silently attached.
  const matched = source?.paperPmid === dataset.pmid ? source : undefined;
  const doi = matched?.paperDoi || dataset.doi;
  const doiUrl = doi && /^10\.\d{4,9}\/[^\s<>"']+$/.test(doi) ? `https://doi.org/${doi}` : undefined;
  const publication = matched?.paperTitle || dataset.citation;
  const author = matched?.paperAuthors?.[0];
  let repositoryUrl: string | undefined;
  try {
    const candidate = new URL(source?.sourceUrl || '');
    if (candidate.protocol === 'https:') repositoryUrl = candidate.href;
  } catch { /* A missing source URL is not filled with a guessed link. */ }
  const contrast = dataset.contrasts.find((item) => item.isDefault) ?? dataset.contrasts[0];
  const baseline = dataset.groups.find((group) => group.key === contrast?.baseline)?.label;
  const comparison = dataset.groups.find((group) => group.key === contrast?.case)?.label;
  return `<article class="comparison"><h3>${escapeHtml(dataset.geo || 'CNP0003785')}: ${escapeHtml(dataset.name)}</h3>
<p><strong>Source publication:</strong> ${author ? `${escapeHtml(author)} et al. ` : ''}${escapeHtml(publication)}${doiUrl ? ` <a href="${escapeHtml(doiUrl)}">DOI ${escapeHtml(doi)}</a>.` : ''}</p>
${repositoryUrl ? `<p><strong>Dataset deposit:</strong> <a href="${escapeHtml(repositoryUrl)}">${escapeHtml(dataset.geo || 'CNP0003785')} original repository record</a>.</p>` : ''}
<p>The <a href="${escapeHtml(studyPageHref(dataset.id))}">${escapeHtml(SITE_NAME)} study overview</a> describes the ${escapeHtml(comparison)} versus ${escapeHtml(baseline)} comparison. Record the track or population and any additional comparison you used.</p>
${datasetId === 'macaque_snrna' ? '<p>The macaque example is an obese-versus-normal reanalysis of the Lei et al. source cohort. The source article is not a publication of this reanalysis, and the reanalysis does not currently have its own publication citation.</p>' : '<p>This is the selected hypothalamus comparison from a wider brain atlas. Cite the original atlas, and state the selected region and comparison rather than implying you analysed every deposited sample.</p>'}</article>`;
}

/** The full-dataset download paragraph; states plainly when no archive is deposited yet. */
export function dataExportParagraph(doi: string | null = DATA_EXPORT_DOI): string {
  const what = `every study's differential-expression and pathway results, sample tables and expression matrices as plain CSV`;
  if (!doi || !/^10\.\d{4,9}\/[^\s<>"']+$/.test(doi)) {
    return `<p id="full-dataset"><strong>Full dataset download.</strong> A ZIP archive of ${what} is being prepared for deposit on Zenodo and is not yet published. Until then, use the export controls described below.</p>`;
  }
  return `<p id="full-dataset"><strong>Full dataset download.</strong> A ZIP archive of ${what} is deposited on Zenodo: <a href="https://doi.org/${escapeHtml(doi)}">DOI ${escapeHtml(doi)}</a>. Its README and AGENTS.md describe every table and the rules for interpreting it, so you can unpack the archive and point a local AI agent, such as Claude Code or Codex, at the folder. Each study, gene-set collection and reference keeps its own terms; read the archive's LICENSE-DATA.md before redistributing it.</p>`;
}

function guideSchema(path: string, title: string, description: string, type: 'TechArticle' | 'WebPage'): unknown[] {
  return [{
    '@type': type,
    '@id': `${SITE_URL}${path}#page`,
    url: `${SITE_URL}${path}`,
    name: title,
    ...(type === 'TechArticle' ? { headline: title } : {}),
    description,
    inLanguage: 'en',
    author: { '@type': 'Person', '@id': `${SITE_URL}/about/#author`, name: AUTHOR_NAME, url: `${SITE_URL}/about/` },
    about: { '@type': 'SoftwareApplication', name: SITE_NAME, url: SITE_URL },
  }];
}

const byline = `<p class="small">${escapeHtml(AUTHOR_BIO)} <a href="/about/">About the author</a>.</p>`;

/** Header, breadcrumbs, canonical metadata and footer are supplied by seoPages. */
export function getGuideDocuments(): GuideDocument[] {
  const methodsTitle = `Methods and data interpretation | ${SITE_NAME}`;
  const methodsDescription = 'How HypoExplorer selects public transcriptomic data, handles expression units and comparisons, and distinguishes source checks from author-result verification.';
  const citationTitle = `How to cite datasets and ${SITE_NAME}`;
  const citationDescription = 'Cite the original publication and dataset accession alongside HypoExplorer. Record the selected comparison, analysis settings and access date.';

  const methods: GuideDocument = {
    title: methodsTitle, description: methodsDescription, path: '/methods/',
    schema: guideSchema('/methods/', methodsTitle, methodsDescription, 'TechArticle'),
    body: `<div class="about"><div class="eyebrow">Research guide</div><h1>Methods and data interpretation</h1>
<p class="intro">${SITE_NAME} displays gene-expression and pathway analyses from public transcriptomic studies. The analysis shown here may use a different cohort, comparison or statistical method from the original paper. Start with the study overview, then check the evidence for the result you want to use.</p>${byline}
<nav class="category-links" aria-label="On this page"><a href="#finding-genes">Find a gene</a><a href="#sources">Sources and selection</a><a href="#comparisons">Comparisons and replication</a><a href="#units">Expression units</a><a href="#statistics">Genes and pathways</a><a href="#verification">Verification</a><a href="#downloads">Data and exports</a></nav>
<section class="panel" id="finding-genes"><h2>Find a gene in a hypothalamus dataset</h2>
<ol><li><strong>Choose the experiment.</strong> Start with the <a href="/topics/">research guides</a> for a question such as aging, dietary exposure or fasting, or use the <a href="/studies/">study directory</a> when you know an accession. Confirm the organism, anatomical region and assay on the study page, then open the dataset in the Explorer.</li>
<li><strong>Select the comparison and track.</strong> Check the baseline and case labels and, where available, choose the cell population. The selected track determines the genes and samples available to inspect.</li>
<li><strong>Search the gene symbol.</strong> Gene search also recognizes aliases and previous symbols when a matching nomenclature record is available. Inspect the suggested stored symbol before selecting it, especially when an older name can refer to more than one gene.</li>
<li><strong>Check the scale and statistics.</strong> Inspect the expression unit, individual sample values, effect direction and adjusted significance together. For a second study, repeat these checks against its own design and normalization.</li></ol>
<h3>Why a gene name may differ or be missing</h3>
<p>The <a href="/#/nomenclature">gene nomenclature reference</a> lists stored symbols, current symbols, aliases, previous symbols and their authority records. A stored symbol may come from an older annotation. A missing gene may fall outside the assay's coverage or have been lost during filtering or identifier mapping. A failed search does not establish that the gene is unexpressed in the hypothalamus.</p>
<p>A shared spelling across species does not establish a one-to-one ortholog relationship. Some datasets retain source-provided human or mouse feature projections. Nomenclature identifies the stored name; it does not independently validate those projections. Keep the organism and the source mapping with any cross-species interpretation.</p></section>
<section class="panel" id="sources"><h2>Original data, selected analyses</h2>
<p>The original researchers produced the source data. ${SITE_NAME} displays selected deposited data and analysis results. Credit the original researchers as authors of the studies. A repository accession identifies the deposit. A publication DOI identifies the paper.</p>
<p>A study may contain more tissues, treatments, time points or samples than the comparison available here. The <a href="/studies/">study directory</a> links each available dataset to its source records, selected comparisons and caveats. Read both the source design and the selected analysis before interpreting a result.</p>
<p>${SITE_NAME} starts from the depositors' processed matrices and does not realign raw reads. Each study page records the depositor's aligner, genome build and annotation as stated in the repository record or source paper, or notes that the depositor did not state them.</p>
<p>For example, the <a href="/studies/macaque_snrna/">macaque hypothalamus atlas</a> contains an obese-versus-normal reanalysis of the 2024 study by Lei et al., <a href="https://doi.org/10.1016/j.cmet.2024.01.003">DOI 10.1016/j.cmet.2024.01.003</a>. It uses three normal and three obese animals across 60 population tracks. The source paper describes the original study. This reanalysis does not have its own publication.</p></section>
<section class="panel" id="comparisons"><h2>Comparison direction and biological replication</h2>
<p>Each comparison names a <strong>baseline</strong> and a <strong>case</strong> group. A positive log2 fold change means higher expression in the case group; a negative value means higher expression in the baseline. "Case" names a role in the comparison and does not always mean disease. Read the group names when comparing fasting, diet, age, sex or treatment studies.</p>
<p>The replicate unit matters as much as the sample count. For animal- or donor-level pseudobulk analyses, cells or nuclei are aggregated within the same biological sample. Thousands of cells do not become thousands of independent biological replicates. Technical partitions and sequencing runs can also belong to one animal. Population tracks from the same animals are correlated observations, not independent replication studies.</p>
<p>Counts can differ by population when a sample lacks usable data. Use the selected track and comparison counts, including any pooled samples or exclusions described in the evidence record. For factorial designs, read which groups belong to the selected contrast. Comparisons marked <strong>exploratory</strong> are local analyses that the original study did not run.</p></section>
<section class="panel" id="units"><h2>Expression units and assay scope</h2>
<p>Read the expression-unit label for the selected dataset. The collection includes CPM, deposited log-normalized values, transformed normalized counts, variance-stabilized values and other study-specific scales. These labels are not interchangeable. A log-transformed scale should not be interpreted as an untransformed count ratio.</p>
<p>Display values and differential-expression statistics have different roles. Where raw counts support a count model, the analysis can use those counts while displaying normalized values. Where only a processed matrix is available, an appropriate analysis may instead use that deposited scale. Do not assume every study was rerun from raw reads or analysed with the same model.</p>
<p>Whole-tissue RNA-seq, sorted cells, single-cell or single-nucleus pseudobulk, translatome assays and spatial measurements sample different biological material. TRAP-seq measures enriched ribosome-associated RNA; it is not a direct protein-abundance measurement. Compare like tissues, preparations and biological questions before interpreting a shared gene signal.</p>
<p>Do not directly compare expression magnitudes across studies with different units or normalization schemes. A heatmap standardized within each gene shows relative patterns, not absolute expression across genes. Check the selected assay and source quantification when interpreting differences between genes.</p></section>
<section class="panel" id="statistics"><h2>Differential expression and pathway enrichment</h2>
<p>HypoExplorer loads precomputed gene results. The collection includes edgeR quasi-likelihood analyses of suitable count data and limma analyses of suitable processed expression matrices. Comparisons with the authors' methods may use other methods, including DESeq2. Check the dataset evidence for filtering, normalization, covariates, model and the exact contrast. There is no single universal fit for every dataset.</p>
<p><strong>Raw p-values and adjusted values answer different questions.</strong> FDR or pathway <code>padj</code> accounts for multiple tests within the documented analysis scope. Plot significance stars use raw p-values, so stars can appear when FDR is not below the selected threshold. Filtering or missing reference evidence must not be read as a significant result.</p>
<p>Pathway results use ranked gene-set enrichment with <a href="https://bioconductor.org/packages/release/bioc/html/fgsea.html">fgsea</a> where supported. This tests whether a gene set accumulates toward either end of a ranked list. It is different from over-representation analysis of a thresholded gene list. The normalized enrichment score, NES, gives direction and relative enrichment strength. Positive NES points toward the case-up end of the ranking. It does not by itself prove pathway activation or causation.</p>
<p>The available gene-set collections, species mapping, ranking statistic and tested gene universe affect the result. For the macaque pipeline, gene sets are retained only when their overlap with the population's ranked genes contains 15 to 500 genes. A missing pathway can reflect size filtering, gene mapping or lack of assay support; it is not evidence that the pathway is biologically absent. Review pathway provenance and source methods before equating a local result with an author-reported pathway.</p>
<p>The <a href="/#/statistics">statistics guide in the app</a> explains the current displays. Cross-dataset views arrange each study's results; they do not compute a pooled effect or combined p-value. A tally of significant datasets is descriptive and does not establish a new statistical test.</p></section>
<section class="panel" id="verification"><h2>Quality control and author-result verification</h2>
<p>Quality-control displays show sample coverage and the analysis inputs or outputs available for a dataset. Source checks can establish that a deposited matrix was retrieved and traced into a local analysis. They do not independently validate raw-read alignment, every laboratory measurement or every conclusion in the original paper.</p>
<p><strong>Pipeline QC, experimental design and author concordance are separate badges.</strong> Hover, focus or tap a badge in the app to see each check.</p>
<p>Pipeline QC checks processing evidence. Experimental design records biological replication and sample-support limitations. Pipeline QC can pass while design limitations remain. Known input and model problems still need pipeline review.</p>
<p>Author concordance accepts strong matched-gene correlation or same-gene directional agreement when the cohort, comparison, effect definitions, identifiers and reference coverage are compatible. Documented effect units and biological direction can support comparisons between different estimators. The checklist states which criterion passed and records every metric outcome. Read effect magnitudes, P values, FDR and significant-gene counts in the context of each analysis. Missing evidence never earns an individual green check.</p>
<p>Each check has one of these states: ${Object.values(QUALITY_STATUS).map((state) => escapeHtml(state.label)).join(', ')}. A dataset pass requires coverage of its registered comparisons; selected-gene evidence remains explicitly scoped.</p>
<p style="margin-top:18px">An unavailable or not-yet-reviewed author table is an evidence gap. An observed unexplained disagreement is an unresolved result. Read the evidence note, limitations and next step in the <a href="/#/verification">data-verification guide</a> and the dataset's library record to distinguish these situations. The macaque single-nucleus atlas is outside the current author-comparison verification scope.</p></section>
<section class="panel" id="downloads"><h2>Get source data and export results</h2>
${dataExportParagraph()}
<p>For original deposited files, follow the repository accession on the study overview to its GEO, CNGB or other source record. That record lists the deposited raw reads, processed matrices and sample metadata, with instructions for access. Check the source for availability and reuse terms. ${SITE_NAME} may not host every original file from a study.</p>
<p>For the result you are viewing, use the export controls available in that Explorer view. The gene-expression view provides an <strong>Export Excel</strong> control for selected genes; the nomenclature reference exports its filtered table. These exports describe the selected analysis or reference entries. They are not substitutes for the original sequencing files.</p>
<p>Gene-expression CSV exports include study and release metadata; Excel exports include a Metadata sheet. Save these with the full-precision values. Use Share analysis to preserve the selected comparison, genes, thresholds and study filters. Follow the <a href="/how-to-cite/">citation examples and reporting checklist</a> when preparing a methods section or figure caption.</p></section>
<section class="panel"><h2>Before using a result</h2><ol><li>Confirm the accession, tissue, organism, assay, selected comparison and replicate unit.</li><li>Inspect the expression scale, effect direction, adjusted significance and relevant caveats.</li><li>Read the verification scope and original publication. Save the settings and exported results you used.</li><li>Follow <a href="/how-to-cite/">How to cite</a> to credit the source data and this interface separately.</li></ol>
<p>${SITE_NAME} is in beta testing. Analyses and coverage may change. For corrections, send the accession, comparison and observed issue to <a href="mailto:${escapeHtml(AUTHOR_EMAIL)}">${escapeHtml(AUTHOR_EMAIL)}</a>.</p></section></div>`,
  };

  const citations: GuideDocument = {
    title: citationTitle, description: citationDescription, path: '/how-to-cite/',
    schema: guideSchema('/how-to-cite/', citationTitle, citationDescription, 'WebPage'),
    body: `<div class="about"><div class="eyebrow">Research guide</div><h1>How to cite datasets and ${escapeHtml(SITE_NAME)}</h1>
<p class="intro">Credit the original publication, the deposited dataset and ${escapeHtml(SITE_NAME)} separately. Describe the comparison you used so another researcher can find the same data and understand your analysis.</p>${byline}
<section class="panel"><h2>What to cite</h2><ol>
<li><strong>Original publication.</strong> Cite the source article using its authors, title and DOI or PMID. The <a href="/studies/">study overview pages</a> link to verified publication records where available. Retrieve the final journal formatting from the publisher or PubMed.</li>
<li><strong>Deposited dataset.</strong> Include the repository name and accession, such as a GEO series number, plus its source-record link. If a deposit has no linked paper, cite the deposit without inventing a publication.</li>
<li><strong>Interface and selected analysis.</strong> Credit ${escapeHtml([AUTHOR_NAME, ...CONTRIBUTOR_NAMES].join(' and '))} as the authors of ${escapeHtml(SITE_NAME)}. Include the study overview URL and your access date. State the comparison, track or population, relevant settings and any exported data or figure you used.</li></ol>
<p>The <a href="/about/">About page</a> has the app author's biography and contact details.</p></section>
<section class="panel"><h2>Suggested interface reference</h2><p class="note">He, Wenyuan${CONTRIBUTOR_NAMES.map((name) => `, and ${escapeHtml(name)}`).join('')}. <em>${escapeHtml(SITE_NAME)}</em> [web application; beta]. <a href="${escapeHtml(SITE_URL)}">${escapeHtml(SITE_URL)}</a>. Accessed [your actual access date].</p>
<p>Replace the access-date placeholder with the date you used the app. Download the <a href="/CITATION.cff">software citation file</a> and save the <a href="/release.json">release metadata</a> with your results. Record the app version, full release identifier, source fingerprint and data build identifiers supplied in your export. The source fingerprint identifies working-tree builds too. This reference cites the website, not a peer-reviewed software paper. Do not assign an original study's DOI to ${escapeHtml(SITE_NAME)}.</p>
<p>The <a href="https://github.com/DrWenyuanHe/hypoexplorer">source repository</a> contains the release packaging command and checksums. A public archive DOI has not yet been assigned; until an immutable archive is deposited, retain the exported result files and release metadata.</p></section>
<section class="panel"><h2>Source citation examples</h2>${publicationExample('mouse_hypo_hfd_gse236077')}${publicationExample('macaque_snrna')}</section>
<section class="panel"><h2>What to record in your methods or figure caption</h2><ul>
<li>The source accession, publication and selected species, tissue and assay.</li>
<li>The case and baseline groups, track or population, exclusions, and biological replicate counts.</li>
<li>The expression unit, differential-expression method and any display or significance thresholds relevant to the claim.</li>
<li>For pathways, the gene-set collection, pathway identifier, direction, NES and adjusted p-value, plus the methods and source data used.</li>
<li>The stable study overview URL, access date, and the exported data or figure used.</li></ul>
<p>Use the <a href="/methods/">Methods and data interpretation guide</a> to distinguish a published author result, a local reanalysis and a new exploratory comparison. A figure made with the interface does not establish that the original authors tested the same hypothesis.</p></section>
<section class="panel"><h2>Reuse and corrections</h2><p>HypoExplorer's original code is licensed under <a href="/LICENSE">MIT</a>. Its original contributions to derived analysis outputs are licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. See the <a href="/REUSE.md">scope and attribution statement</a>. Original publications, deposited data, gene-set collections, annotations, fonts and dependencies retain their own terms; the HypoExplorer licenses do not replace them.</p>
<p>${escapeHtml(SITE_NAME)} is in beta testing. Save the results and settings you used because the interface, analyses and coverage may change. For citation corrections, contact <a href="mailto:${escapeHtml(AUTHOR_EMAIL)}">${escapeHtml(AUTHOR_EMAIL)}</a> and include the affected study accession and publication link.</p></section></div>`,
  };
  return [methods, citations];
}
