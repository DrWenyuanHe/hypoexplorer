// Researcher-facing discovery content. Describes the selected analysis, not an
// invented summary of the original paper or an inferred biological conclusion.
import editorialJson from '../../data/seo/studyEditorial.json';
import { getAuthorValidation } from '../../src/data/authorValidation';
import { datasetQuality, QUALITY_BADGES, QUALITY_STATUS } from '../../src/data/datasetQualityR460';
import { defaultArmCounts, getActiveContrast } from '../../src/data/contrasts';
import { SITE_NAME } from '../../src/data/siteInfo';
import { CPM_TMM_UNIT } from '../../src/data/expressionUnits';
import type { Dataset, DatasetMeta } from '../../src/types';

interface StudyEditorial {
  searchTopic?: string;
  primaryAccession?: string;
  selectedScope?: string;
  limitations?: string;
  /** Repository evidence for authored scientific notes, not rendered as copy. */
  evidencePaths?: string[];
}

const editorial: Record<string, StudyEditorial> = editorialJson;
const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function searchTopic(dataset: Dataset): string {
  // Only the final assay parenthesis is removed. Internal genotype qualifiers
  // such as '(ob/ob)' remain part of the scientific subject. Full assay details
  // remain in the H1, visible scope and study facts on the page.
  return editorial[dataset.id]?.searchTopic ?? dataset.name
    .replace(/\s*\(([^()]+)\)$/u, (whole, qualifier: string) =>
      /RNA-seq|TRAP|RiboTag|WTTS-seq/iu.test(qualifier) ? '' : whole)
    .replace(/\bwhole hypothalamus\b/iu, 'hypothalamus')
    .replace(/\s+—\s+/gu, ': ');
}

/** Preserve the searchable accession and complete topic; never cut a word. */
export function studySearchTitle(dataset: Dataset, primaryAccession?: string): string {
  const accession = primaryAccession || dataset.geo || editorial[dataset.id]?.primaryAccession;
  return `${accession ? `${accession} | ` : ''}${searchTopic(dataset)} | ${SITE_NAME}`;
}

export function studySearchDescription(dataset: Dataset): string {
  const accession = dataset.geo || editorial[dataset.id]?.primaryAccession;
  return `${accession ? `${accession}: ` : ''}${searchTopic(dataset)}. View gene expression and comparisons in ${SITE_NAME}, with methods and original source records.`;
}

function preparationGuidance(dataset: Dataset): string {
  switch (dataset.preparation) {
    case 'Translatome':
      return 'This preparation profiles ribosome-associated RNA from the targeted cells. Treat the result as a translatome measurement. It does not represent total RNA from every cell in the anatomical region.';
    case 'Sorted cells':
      return 'The preparation enriches the selected cell population. Interpret expression within that population. Check the source for sorting markers and sample pooling.';
    case 'Single-nucleus':
      return 'The source assay profiles nuclei. Check the population track and its retained sample count to see which analysis each result describes.';
    case 'Single-cell':
      return 'The source assay profiles individual cells. The track and sample counts shown here describe the analysis used for the comparison. Cell counts do not replace independent biological replicates.';
    case 'Spatial spots':
      return 'The source assay measures spatial profiles. Before interpreting sample counts or differential expression, check how profiles and sections are grouped into analysis samples.';
    case 'Cell culture':
      return 'These data come from a cell-culture model. Check the cell line or differentiation system and the conditions sampled before interpreting a result.';
    default:
      return 'The measurement combines expression from the cells in the tissue sample. A difference in tissue expression alone does not identify which cell type contributes to it.';
  }
}

function expressionGuidance(dataset: Dataset): string {
  const unit = dataset.expressionUnit;
  if (!unit) return 'Consult the expression axis and study methods for the scale used by this dataset.';
  if (unit === CPM_TMM_UNIT) return 'Expression values are CPM (TMM-normalized): counts per million on library sizes adjusted by the TMM factors of the study’s own edgeR fit. This scale adjusts for library size and composition, not gene length. Use it to inspect a feature across the samples in this analysis. CPM values are not absolute transcript counts.';
  if (unit === 'CPM') return 'Expression values are CPM, or counts per million. This scale adjusts for library size, not gene length. Use it to inspect a feature across the samples in this analysis. CPM values are not absolute transcript counts.';
  if (unit === 'log2-normalized') return "Expression values use a log2-normalized scale. They are not raw counts or CPM. Check this study's preprocessing before comparing them with other datasets.";
  return `Expression values use ${unit}. Keep this unit when exporting or comparing values. Values on other normalization scales are not directly interchangeable.`;
}

function defaultSampleSummary(dataset: Dataset, meta?: DatasetMeta): string {
  const contrast = getActiveContrast(dataset);
  if (!contrast || !meta?.populations.includes(dataset.defaultTrack)) return '';
  const counts = defaultArmCounts(dataset, meta, meta.qcFlags?.[dataset.defaultTrack]);
  if (counts.nBaseline == null || counts.nCase == null) return '';
  const trackLabel = meta.labels?.[dataset.defaultTrack] || dataset.defaultTrack;
  return `The default track, ${trackLabel}, includes ${counts.nBaseline} ${contrast.baseline.label} samples and ${counts.nCase} ${contrast.caseGroup.label} samples in this comparison. These are analysis sample counts. Check the source for biological replication and pooling.`;
}

/** Safe, no-JavaScript HTML to insert before the existing provenance section. */
export function renderStudyContext(dataset: Dataset, meta?: DatasetMeta): string {
  const note = editorial[dataset.id];
  const contrast = getActiveContrast(dataset);
  const scope = `This dataset contains ${dataset.modality} data from ${dataset.organism}, sampled from ${dataset.region.toLowerCase()}. `
    + (contrast ? `The default comparison examines ${dataset.featureLabel.toLowerCase()} expression in ${contrast.caseGroup.label} relative to ${contrast.baseline.label}.` : 'The available tracks and comparisons are listed below.');
  const samples = defaultSampleSummary(dataset, meta);
  const trackCount = meta?.populations.length;
  const exploratory = dataset.contrasts.filter((entry) => entry.exploratory).length;
  const record = getAuthorValidation(dataset.id);
  const quality = record ? datasetQuality(record) : undefined;
  const verificationCopy = quality
    ? `<h3>Evidence and verification</h3>${QUALITY_BADGES.map(({key, label}) => `<p><strong>${escapeHtml(label)} ${escapeHtml(QUALITY_STATUS[quality[key].status].suffix)}.</strong> ${escapeHtml(quality[key].scope)}</p>`).join('')}<p>Pipeline QC can pass while experimental-design limitations remain. Read both assessments before interpreting results.</p><p>Open the dataset in the Explorer to read each check and its evidence. Author concordance compares effects for matched genes. It does not require identical author P values or FDR.</p>`
    : '<h3>Evidence and verification</h3><p>Author-result verification has not been assessed for this dataset.</p>';
  return `<section class="panel" aria-labelledby="selected-data-heading">
<h2 id="selected-data-heading">Selected data and study scope</h2>
<p>${escapeHtml(scope)}</p>
${note?.selectedScope ? `<p>${escapeHtml(note.selectedScope)}</p>` : ''}
${trackCount ? `<p>The explorer includes ${trackCount} ${escapeHtml(dataset.trackNoun === 'population' ? `cell population${trackCount === 1 ? '' : 's'}` : `track${trackCount === 1 ? '' : 's'}`)} and ${dataset.contrasts.length} ${dataset.contrasts.length === 1 ? 'comparison' : 'comparisons'} for this dataset.${exploratory ? ` ${exploratory === 1 ? 'One comparison is' : `${exploratory} comparisons are`} marked exploratory because ${exploratory === 1 ? 'it was' : 'they were'} not run in the source study.` : ''}</p>` : ''}
${samples ? `<p>${escapeHtml(samples)}</p>` : ''}
<h3>Interpretation and limitations</h3>
${note?.limitations ? `<p class="note">${escapeHtml(note.limitations)}</p>` : ''}
<p>${escapeHtml(preparationGuidance(dataset))}</p><p>${escapeHtml(expressionGuidance(dataset))}</p>
${verificationCopy}
<p class="small">Read the <a href="/methods/">analysis methods and interpretation guide</a> and <a href="/how-to-cite/">how to cite the source study and ${SITE_NAME}</a>. The source publication may include tissues, groups or comparisons beyond the data shown here.</p>
</section>`;
}
