// Column contracts and bundled documents for the agent export
// (scripts/build_agent_export.mts). The schema test imports the column lists, so
// a column added here without a README entry, or the reverse, fails the test.

export type KeggMode = 'full' | 'stats' | 'omit';

export const DATASET_COLUMNS = [
  'dataset_id', 'name', 'category', 'organism', 'modality', 'region', 'perturbation', 'preparation',
  'feature_type', 'feature_label', 'expression_unit', 'supports_pathways', 'n_tracks', 'n_contrasts',
  'default_track', 'default_contrast', 'accession', 'geo', 'doi', 'pmid', 'citation', 'paper_title',
  'paper_first_author', 'paper_relationship', 'source_url', 'aligner', 'genome', 'annotation',
  'pipeline_qc', 'experimental_design', 'author_concordance', 'explorer_url',
] as const;
export const CONTRAST_COLUMNS = [
  'dataset_id', 'contrast_id', 'is_default', 'label', 'baseline_key', 'baseline_label', 'case_key',
  'case_label', 'exploratory', 'contrast_group', 'description', 'pipeline_qc', 'experimental_design',
  'author_concordance',
] as const;
export const TRACK_COLUMNS = [
  'dataset_id', 'track_id', 'label', 'type', 'is_default_track', 'n_genes', 'n_samples',
  'expression_unit', 'qc_status', 'min_cells', 'low_power',
] as const;
export const TRACK_CONTRAST_COLUMNS = [
  'dataset_id', 'track_id', 'contrast_id', 'n_baseline', 'n_case', 'de_rows', 'de_fdr_sig', 'de_up',
  'de_down', 'fgsea_rows', 'fgsea_attribution',
] as const;
export const SAMPLE_COLUMNS = ['dataset_id', 'track_id', 'sample_id', 'sample_index', 'group_key', 'group_label', 'kept'] as const;
export const DE_COLUMNS = ['dataset_id', 'track_id', 'contrast_id', 'gene', 'logFC', 'SE', 'PValue', 'FDR', 'logCPM'] as const;
export const FGSEA_COLUMNS = [
  'dataset_id', 'track_id', 'contrast_id', 'collection', 'pathway', 'NES', 'pval', 'padj', 'size', 'leading_edge',
] as const;

export interface ExportSummary {
  version: string;
  commit: string | null;
  dirty: boolean;
  keggMode: KeggMode;
  datasets: number;
  tracks: number;
  contrasts: number;
  trackContrasts: number;
  deRows: number;
  fgseaRows: number;
  keggRows: number;
  expressionFiles: number;
  timeSeriesFiles: number;
  collections: string[];
  fdrCutoff: number;
  subset: boolean;
  organisms: string[];
  perturbations: string[];
}

/** Every column of every table, described once; README renders these. */
export const COLUMN_DOCS: Record<string, Record<string, string>> = {
  'datasets.csv': {
    dataset_id: 'Stable HypoExplorer id; the folder name under `datasets/`.',
    name: 'Study title as shown in the explorer.',
    category: 'Thematic category (explorer grouping), e.g. `Feeding & fasting`.',
    organism: 'Species.',
    modality: 'Assay description, e.g. bulk RNA-seq, snRNA-seq pseudobulk, microarray.',
    region: 'Anatomical origin of the sampled tissue (authored facet).',
    perturbation: 'What the case arm differs from baseline by (authored facet), e.g. `Fasting & feeding`.',
    preparation: 'Library preparation: bulk tissue, translatome, sorted cells, single-nucleus, ...',
    feature_type: '`gene` or `miRNA`.',
    feature_label: 'Display noun for the features.',
    expression_unit: 'Default unit of the expression matrices; tracks may override (see tracks.csv).',
    supports_pathways: 'Whether FGSEA results exist for this dataset.',
    n_tracks: 'Number of tracks (cell populations or tissues).',
    n_contrasts: 'Number of registered comparisons.',
    default_track: 'Track the explorer opens first.',
    default_contrast: 'Comparison the explorer opens first.',
    accession: 'Source repository accession (GEO, ArrayExpress or CNGB).',
    geo: 'GEO series, when the deposit is in GEO.',
    doi: 'DOI of the source publication, when one exists.',
    pmid: 'PubMed id of the source publication; empty when the deposit has no paper.',
    citation: 'Citation prose from the registry.',
    paper_title: 'Verified publication title (only when its PMID matches `pmid`).',
    paper_first_author: 'First author of that publication.',
    paper_relationship: 'How the paper relates to the deposit (e.g. `primary`, `methods`).',
    source_url: 'Link to the repository record.',
    aligner: 'Depositor-stated aligner, if stated.',
    genome: 'Depositor-stated genome build, if stated.',
    annotation: 'Depositor-stated annotation, if stated.',
    pipeline_qc: 'Pipeline QC decision: pass, review, fail, not_assessed or not_applicable.',
    experimental_design: 'Experimental-design decision (replication and sample support), same states.',
    author_concordance: 'Agreement with comparable author results, same states.',
    explorer_url: 'Study overview page on hypoexplorer.com.',
  },
  'contrasts.csv': {
    dataset_id: 'Dataset.',
    contrast_id: 'Comparison id, unique within a dataset.',
    is_default: 'Whether this is the dataset\'s default comparison.',
    label: 'Display label, usually "case vs baseline".',
    baseline_key: 'Group key of the baseline (reference) arm.',
    baseline_label: 'Human label of the baseline arm.',
    case_key: 'Group key of the case arm.',
    case_label: 'Human label of the case arm. **Positive logFC = higher in this arm.**',
    exploratory: '`true` when the source study never ran this comparison, or the fit cannot support gene-level significance. Read `description`.',
    contrast_group: 'Grouping label for factorial designs (e.g. "Maternal-diet effect").',
    description: 'Longer explanation, when authored.',
    pipeline_qc: 'Pipeline QC decision scoped to this comparison (use these, not datasets.csv, when reporting one comparison).',
    experimental_design: 'Design decision scoped to this comparison.',
    author_concordance: 'Author-concordance decision scoped to this comparison.',
  },
  'tracks.csv': {
    dataset_id: 'Dataset.',
    track_id: 'Track id: a cell population (single-cell) or a tissue (bulk).',
    label: 'Human track label.',
    type: 'Track type (e.g. `Tissue`, `Neuron`, `Glia`).',
    is_default_track: 'Whether this is the dataset\'s default track.',
    n_genes: 'Features tested in this track.',
    n_samples: 'Columns in this track\'s expression matrix.',
    expression_unit: 'Unit of `datasets/<id>/expression/<track_id>.csv`.',
    qc_status: 'Producer run status for the track: `ok` when the model was fitted.',
    min_cells: 'Minimum cells per pseudobulk sample (single-cell tracks).',
    low_power: '`true` when either pooled arm has fewer than 3 replicates.',
  },
  'track_contrasts.csv': {
    dataset_id: 'Dataset.',
    track_id: 'Track.',
    contrast_id: 'Comparison.',
    n_baseline: 'Baseline replicates used for this comparison in this track.',
    n_case: 'Case replicates used for this comparison in this track.',
    de_rows: 'Rows in de.csv for this track and comparison (0 = no DE table published).',
    de_fdr_sig: 'Rows with FDR below the cutoff.',
    de_up: 'Significant rows with logFC > 0 (higher in case).',
    de_down: 'Significant rows with logFC < 0 (lower in case).',
    fgsea_rows: 'Rows in fgsea.csv for this track and comparison.',
    fgsea_attribution: 'How the pathway block was attributed: `explicit` (keyed by contrast id), `legacy-default` / `legacy-plain` (the default comparison\'s block from an older bundle shape) or `none`.',
  },
  'datasets/<id>/samples.csv': {
    dataset_id: 'Dataset.',
    track_id: 'Track.',
    sample_id: 'Sample id as deposited (or the pseudobulk animal id).',
    sample_index: '1-based column position in the track\'s expression matrix.',
    group_key: 'Arm(s) the sample belongs to (contrasts.csv keys), `;`-separated when a factorial design puts it in a pooled arm and a design cell; empty if not declared.',
    group_label: 'Human label(s) of those arms, in the same order.',
    kept: 'Whether the sample passed QC and entered the model.',
  },
  'datasets/<id>/de.csv': {
    dataset_id: 'Dataset.',
    track_id: 'Track.',
    contrast_id: 'Comparison (see contrasts.csv for case and baseline).',
    gene: 'Feature symbol as stored (species case: `Pomc` in mouse/rat, `POMC` in human/macaque).',
    logFC: 'log2 fold change, case minus baseline.',
    SE: 'Standard error of logFC (log2 scale). Exact for limma; for edgeR only when a refit persisted it; empty otherwise.',
    PValue: 'Raw p-value.',
    FDR: 'Benjamini-Hochberg adjusted p-value within the track and comparison; empty when not estimable.',
    logCPM: 'Average log2 CPM, when the producer reported it.',
  },
  'datasets/<id>/fgsea.csv': {
    dataset_id: 'Dataset.',
    track_id: 'Track.',
    contrast_id: 'Comparison.',
    collection: 'Gene-set collection: GO_BP, HALLMARK, KEGG or REACTOME (MSigDB).',
    pathway: 'MSigDB gene-set name.',
    NES: 'Normalized enrichment score; positive = enriched toward the case-up end of the ranking.',
    pval: 'Raw p-value.',
    padj: 'BH-adjusted p-value within the collection, track and comparison.',
    size: 'Gene-set size after overlap with the ranked genes.',
    leading_edge: 'Leading-edge genes, `;`-separated.',
  },
};

const fmt = (n: number) => n.toLocaleString('en-US');

function schemaSection(): string {
  return Object.entries(COLUMN_DOCS).map(([table, cols]) => [
    `### \`${table}\``, '', '| Column | Meaning |', '| --- | --- |',
    ...Object.entries(cols).map(([c, d]) => `| \`${c}\` | ${d} |`), '',
  ].join('\n')).join('\n');
}

function keggSentence(s: ExportSummary): string {
  if (s.keggMode === 'omit') return 'KEGG rows are omitted from this build.';
  if (s.keggMode === 'stats') return 'KEGG rows keep their statistics, but their `leading_edge` is empty in this build.';
  return 'KEGG rows are included in full; see LICENSE-DATA.md for their separate terms.';
}

export function readmeDoc(s: ExportSummary): string {
  return `# HypoExplorer data export v${s.version}

Differential-expression (DE) and pathway-enrichment (FGSEA) results, sample
tables and expression matrices for ${s.subset ? 'a SUBSET of ' : 'every study in '}[HypoExplorer](https://hypoexplorer.com),
a curated collection of public hypothalamus transcriptomic studies.
${s.subset ? '\n> **This is a partial build** (`--datasets`). It does not contain the whole corpus.\n' : ''}
| | |
| --- | --- |
| Datasets | ${fmt(s.datasets)} |
| Tracks (cell populations or tissues) | ${fmt(s.tracks)} |
| Comparisons | ${fmt(s.contrasts)} (${fmt(s.trackContrasts)} track × comparison pairs) |
| DE rows | ${fmt(s.deRows)} |
| FGSEA rows | ${fmt(s.fgseaRows)} (collections: ${s.collections.join(', ') || 'none'}) |
| Organisms | ${s.organisms.join(', ')} |
| Source commit | \`${s.commit ?? 'unknown'}\`${s.dirty ? ' (working tree had uncommitted data changes)' : ''} |

AI agents: start with [AGENTS.md](AGENTS.md).

## Layout

\`\`\`
datasets.csv            one row per study: organism, region, perturbation, citation, quality
contrasts.csv           one row per comparison: which arm is case, which is baseline
tracks.csv              one row per track: label, unit, sample count, low-power flag
track_contrasts.csv     per track × comparison: replicates and significant-gene counts
datasets/<id>/
  meta.json             registry entry, publication, upstream processing, QC detail
  samples.csv           sample → arm membership for every track
  de.csv                DE results, all tracks and comparisons (long format)
  fgsea.csv             pathway results, when the study supports pathways
  expression/<track>.csv   feature × sample matrix in the track's expression unit
  timeseries/<track>.csv   sampled time course (circadian studies only) + _samples.csv
reference/nomenclature.tsv  stored symbol → current symbol, aliases, previous symbols
manifest.json           every file with byte size and SHA-256
LICENSE-DATA.md         terms for this data and the third-party content in it
CITATION.cff            how to cite HypoExplorer itself
\`\`\`

All tables are UTF-8 CSV with a header row, \`,\` separators, RFC 4180 quoting and
LF line endings. An empty field means "not available"; it is never zero.
Booleans are \`true\`/\`false\`. Join tables on \`dataset_id\`, \`track_id\` and
\`contrast_id\`.

## Quick start

DuckDB reads every study's table at once:

\`\`\`sql
-- Which studies show POMC lower in the case arm of a fasting comparison?
SELECT d.dataset_id, d.organism, d.region, de.track_id, c.case_label, c.baseline_label,
       de.logFC, de.FDR, tc.n_case, tc.n_baseline
FROM read_csv('datasets/*/de.csv', union_by_name = true, types = {'track_id': 'VARCHAR', 'gene': 'VARCHAR'}) de
JOIN read_csv('datasets.csv') d USING (dataset_id)
JOIN read_csv('contrasts.csv') c USING (dataset_id, contrast_id)
JOIN read_csv('track_contrasts.csv', types = {'track_id': 'VARCHAR'}) tc USING (dataset_id, track_id, contrast_id)
WHERE upper(de.gene) = 'POMC'
  AND (d.perturbation = 'Fasting & feeding' OR d.category = 'Feeding & fasting')
ORDER BY de.FDR NULLS LAST;
\`\`\`

Then read \`case_label\` and \`baseline_label\` before saying "down in fasting":
a negative logFC means lower in the **case** arm, and in some comparisons the
case arm is the *fed* or *refed* group. Rows with \`FDR < ${s.fdrCutoff}\` are what the
explorer calls significant.

pandas:

\`\`\`python
import glob, pandas as pd
de = pd.concat(pd.read_csv(f, dtype={"track_id": str, "gene": str}) for f in glob.glob("datasets/*/de.csv"))
datasets = pd.read_csv("datasets.csv"); contrasts = pd.read_csv("contrasts.csv")
hits = de[de.gene.str.upper() == "POMC"].merge(datasets, on="dataset_id").merge(contrasts, on=["dataset_id", "contrast_id"])
\`\`\`

Without a query engine, match the \`gene\` column (column 4) exactly; a plain
grep for \`POMC\` also hits every row of tracks named \`pomc\`:

\`\`\`sh
awk -F, 'FNR == 1 || toupper($4) == "POMC"' datasets/*/de.csv
\`\`\`

## Tables

${schemaSection()}
### \`datasets/<id>/expression/<track>.csv\`

First column \`gene\`, then one column per sample in \`samples.csv\` order
(\`sample_index\`). Values are in the track's \`expression_unit\` (tracks.csv):
TMM-normalized CPM for most count studies, deposited log-scale values for
microarray and processed-matrix studies. Samples with \`kept = false\` are shown
but were not modelled.

### \`datasets/<id>/timeseries/<track>.csv\`

Only for studies with a sampled time course. Same matrix shape; sample time,
arm and replicate are in \`<track>_samples.csv\`.

## Interpreting results

These rules come from the explorer's methods and statistics guides
(<https://hypoexplorer.com/methods/>). State them when they affect a conclusion.

- **Direction.** Every comparison names a baseline and a case arm. Positive
  logFC (and positive NES) means higher in the case arm. "Case" is a role, not
  necessarily a disease or treatment; read the labels.
- **Significance.** The explorer calls a gene significant when \`FDR < ${s.fdrCutoff}\`
  (pathways: \`padj < ${s.fdrCutoff}\`). Raw p-values are not corrected for the
  thousands of genes tested. An empty FDR is unknown, not small.
  **On an exploratory comparison, read its \`description\` before using FDR:** some
  (for example GSE87544, one residual degree of freedom) publish an FDR column
  but state that no gene-level FDR call is made. Report only effect sizes there,
  even though \`track_contrasts.csv\` still counts rows below the cutoff.
- **Replicates.** Single-cell and single-nucleus tracks are pseudobulk: cells are
  summed within an animal, so \`n_case\`/\`n_baseline\` count animals, not cells.
  Tracks from the same animals are correlated, not independent replications.
  \`low_power = true\` means an arm has fewer than 3 replicates.
- **Exploratory comparisons** (\`exploratory = true\`) were not run by the source
  study, or cannot support gene-level significance. Say so when citing them.
- **Units differ between studies.** Compare effect directions and adjusted
  significance across studies, not expression magnitudes. Do not compare a log
  scale with CPM.
- **No meta-analysis.** Nothing here pools effects or p-values across studies.
  A count of significant studies is descriptive, not a new test.
- **Missing genes.** A gene absent from a track was not measured, filtered out or
  lost in identifier mapping. Absence is not evidence of no expression. Some
  deposits cover only a gene subset, which a small \`n_genes\` in tracks.csv
  shows; \`meta.json\` (\`registry.citation\`) says why.
- **Facets describe studies, not comparisons.** A study filed under a fasting
  facet can also hold cell-type, genotype or diet comparisons. Decide which
  comparisons answer the question from \`case_label\` and \`baseline_label\`.
- **Symbols and species.** Matching symbols across species does not prove
  one-to-one orthology. Use \`reference/nomenclature.tsv\` to resolve aliases and
  previous symbols to the stored symbol.
- **Pathways.** FGSEA tests whether a gene set accumulates toward one end of the
  ranked gene list. It is not over-representation analysis, and NES alone does
  not prove activation. Gene-set size filtering (15–500 genes) and species
  mapping can remove a pathway. ${keggSentence(s)}
- **Standard errors** support an approximate 95% Wald interval
  (logFC ± 1.96 × SE). They are absent where the model does not give one.
- **Quality columns** are three separate decisions: pipeline QC, experimental
  design and author concordance. \`not_assessed\` is missing evidence, not a
  pass or a fail. When reporting one comparison, use its row in contrasts.csv;
  datasets.csv gives the study-level decision.
- **Macaque atlas** (\`macaque_snrna\`) is an obese-versus-normal re-analysis of
  Lei et al., *Cell Metab.* 2024 (doi:10.1016/j.cmet.2024.01.003). The source
  paper did not publish this comparison.

## Precision and provenance

Values come from the explorer's published bundles, which round effect sizes to
about 4–5 significant digits and probabilities to about 6. Check a value within
rounding distance of a threshold against the full-precision tables, which are
in the source repository (\`data/raw/results/\` for the macaque atlas,
\`geo_replication/\` for the other studies), with the producer scripts and
session records. Current analyses: R 4.6.0, edgeR 4.10.1, limma 3.68.4,
fgsea 1.38.0, msigdbr 26.1.0 (MSigDB 2026.1.Hs). Some later intakes keep their
own recorded provenance; see each study page.

## Citing

Cite the original publication and repository accession for every study you use
(\`citation\`, \`doi\`, \`pmid\`, \`accession\` in datasets.csv), and cite HypoExplorer
separately (CITATION.cff). Record this export's version and source commit.
Reuse terms are in LICENSE-DATA.md.
`;
}

export function agentsDoc(s: ExportSummary): string {
  return `# Guide for AI agents

This folder is a self-contained export of HypoExplorer v${s.version}: ${fmt(s.datasets)}
hypothalamus transcriptomic studies, ${fmt(s.tracks)} tracks and ${fmt(s.deRows)} DE rows,
as plain CSV. You do not need the HypoExplorer app or its source code.
README.md has every column's meaning; read its "Interpreting results" section
before you state a conclusion.

## Answer a question in this order

1. **Find studies** in \`datasets.csv\`. Filter on \`organism\`, \`region\`,
   \`perturbation\` (values: ${s.perturbations.map((p) => `\`${p}\``).join(', ')}),
   \`category\`, \`preparation\` or the free-text \`name\`. A topic can appear in
   more than one facet: fasting studies are \`perturbation = 'Fasting & feeding'\`
   and \`category = 'Feeding & fasting'\`; check both. Facets describe the study,
   so the match is a candidate list, not an answer.
2. **Read the comparisons** in \`contrasts.csv\` and keep only those whose arms
   answer the question (a fasting study can also hold cell-type or genotype
   comparisons). \`case_label\` and \`baseline_label\` fix the sign: logFC > 0
   means higher in the case arm. Never infer the direction from the dataset name.
3. **Look up the gene** in \`datasets/<id>/de.csv\`, matching \`gene\`
   case-insensitively (mouse and rat use \`Pomc\`, human and macaque \`POMC\`).
   If nothing matches, look the symbol up in \`reference/nomenclature.tsv\`
   (\`symbol\`, \`current_symbol\`, \`aliases\`, \`previous_symbols\`), since the
   stored name may be an older symbol.
4. **Call significance** with \`FDR < ${s.fdrCutoff}\`. Treat an empty FDR as
   unknown. If the comparison has \`exploratory = true\`, read its \`description\`
   first: when it says no gene-level FDR call is made, report the effect size
   only, whatever the FDR column says. Report the track: one study can have
   dozens of cell-population tracks, and they can disagree.
5. **Check support** in \`track_contrasts.csv\` (\`n_case\`, \`n_baseline\`),
   \`tracks.csv\` (\`low_power\`) and \`contrasts.csv\` (\`exploratory\`). Mention the
   quality columns when they are not \`pass\`.
6. **Pathways** are in \`datasets/<id>/fgsea.csv\` (\`padj < ${s.fdrCutoff}\`, sign of \`NES\`).

## Working efficiently

- \`de.csv\` files are long-format, one per study. A study's DE file can be tens
  of megabytes, and all of them together run to hundreds. Stream or filter them
  (DuckDB, \`grep\`, pandas with \`usecols\`) rather than printing whole files.
- Expression matrices (\`expression/*.csv\`) are only needed for per-sample
  values; most questions are answered from de.csv.
- \`meta.json\` has the full registry entry, publication record, upstream
  processing and QC checks for one study.
- \`manifest.json\` lists every file with its size.

## When you report a result

- Name the study (\`dataset_id\`, \`accession\`), organism, track, and the case
  and baseline labels, then give logFC, FDR and replicate counts.
- Say "no significant change" only for genes that were tested. A gene missing
  from de.csv was not tested.
- Do not pool p-values or average effects across studies, and do not compare
  expression magnitudes between studies with different units.
- Cite the source publication (\`citation\`, \`doi\`) for each study, plus
  HypoExplorer (CITATION.cff).
`;
}

export function claudeDoc(): string {
  return `# HypoExplorer data export

@AGENTS.md
`;
}

export function licenseDoc(s: ExportSummary): string {
  return `# Data license and third-party terms

## HypoExplorer contributions: CC BY 4.0

HypoExplorer's original contributions to these derived analysis outputs
(differential-expression statistics, enrichment results, summaries, table
layouts and documentation) are © 2026 Wenyuan He. They are licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Credit "Wenyuan He / HypoExplorer", link the license and say what you changed.
This grant covers only rights the HypoExplorer author holds. It does not
relicense the third-party content listed below. No warranty is provided.

## Source studies

Each study's deposited data and publication remain under their own terms.
Cite them using \`citation\`, \`doi\`, \`pmid\` and \`accession\` in datasets.csv.

- **NCBI GEO.** NCBI places no restrictions on the use or distribution of GEO
  data. Submitters may still claim patent, copyright or other rights in the
  data they submitted. See <https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html>.
- **ArrayExpress / BioStudies (E-MTAB accessions).** EMBL-EBI terms of use apply:
  <https://www.ebi.ac.uk/about/terms-of-use>.
- **CNGB (CNP0003785, macaque atlas).** CNGBdb terms apply. Cite Lei et al.,
  *Cell Metab.* 2024;36(2):438–453.e6, doi:10.1016/j.cmet.2024.01.003.

## Gene-set collections (fgsea.csv)

Pathway names and leading-edge genes come from the Molecular Signatures
Database (MSigDB), © 2004–2025 Broad Institute, Inc. and Massachusetts Institute of
Technology. MSigDB is distributed
under CC BY 4.0, with the exceptions below. Cite Subramanian et al., *PNAS* 2005
and Liberzon et al., *Cell Systems* 2015. The underlying sources are Gene
Ontology (CC BY 4.0), Reactome (CC BY 4.0) and the MSigDB Hallmark collection.

**KEGG.** Gene sets named \`KEGG_*\` (MSigDB C2 KEGG_LEGACY) derive from KEGG,
© Kanehisa Laboratories. MSigDB provides them under license to the Broad
Institute, with qualified permission to include them. The CC BY grants above do
not cover them, and keeping this copyright notice is a condition of their use.
Academic users may use KEGG freely; non-academic use requires a license from
Kanehisa Laboratories via Pathway Solutions. See
<https://www.kegg.jp/kegg/legal.html> and
<https://www.gsea-msigdb.org/gsea/msigdb_license_terms.jsp>.
${keggSentence(s)} This build contains ${fmt(s.keggRows)} KEGG rows.

## Gene nomenclature (reference/nomenclature.tsv)

Compiled from HGNC (<https://www.genenames.org>), MGI
(<https://www.informatics.jax.org>; cite the MGI database), RGD
(<https://rgd.mcw.edu>) and NCBI Gene (<https://www.ncbi.nlm.nih.gov/gene>).
Each resource's citation and use terms apply.
`;
}
