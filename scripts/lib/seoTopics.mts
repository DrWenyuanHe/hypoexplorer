// Hand-selected research guides, rather than one page for every registry facet.
// Study notes describe the served contrast, not inferred biological conclusions.
import type { Dataset } from '../../src/types';
import { AUTHOR_BIO, AUTHOR_NAME, SITE_NAME, SITE_URL } from '../../src/data/siteInfo';
import { studySearchDescription } from './seoStudyContent.mjs';

interface TopicStudy {
  id: string;
  note: string;
}

interface TopicCollection {
  slug: string;
  title: string;
  description: string;
  introduction: string[];
  guidance: Array<{ title: string; text: string }>;
  groups: Array<{ title: string; introduction: string; studies: TopicStudy[] }>;
}

export interface TopicDocument {
  title: string;
  description: string;
  path: string;
  body: string;
  schema: unknown[];
}

/** Membership is editorial: category and name keyword matches are insufficient.
 * In particular, development is not late-life aging, sorted-cell bulk RNA is
 * not single-cell RNA-seq, and an obesity paper may serve a fasting contrast. */
export const TOPIC_COLLECTIONS: readonly TopicCollection[] = [
  {
    slug: 'hypothalamic-aging',
    title: 'Hypothalamic aging datasets',
    description: 'Compare hypothalamic aging RNA-seq studies in mouse, rat and rhesus macaque, with age ranges, assay differences and links to the available datasets.',
    introduction: [
      'Choose a hypothalamic gene-expression dataset for an age comparison. This collection includes young-versus-aged rodent studies and a young-versus-middle-aged rhesus macaque study. Each entry lists the ages and preparations available in HypoExplorer. These may cover only part of a larger multi-tissue publication.',
      'Start with a whole-hypothalamus study for an overall tissue comparison. Use the astrocyte translatome or spatial-derived study to ask a more specific question about the sampled material. These are complementary designs, not interchangeable measurements of a single aging trajectory.',
    ],
    guidance: [
      { title: 'Match the age window and species', text: 'The mouse cohorts use different young and aged endpoints. The rhesus macaque contrast ends in middle age, so it should not be relabeled as advanced old age. Postnatal maturation studies and treatments given only to aged animals are outside this selection. Neither directly estimates the same young-versus-aged comparison.' },
      { title: 'Check sex and sampling time', text: 'GSE240365 is a male-mouse comparison, while GSE314817 and GSE212336 include sex as an additive model term. GSE201207 models circadian sampling time to estimate a common cycle-averaged age effect. That effect should not be read as a change at a particular time of day or as a test of altered rhythmicity.' },
      { title: 'Check what each assay measures', text: 'GSE99791 measures a GFAP-RiboTag immunoprecipitate, rather than total RNA from all hypothalamic cells. GSE270383 aggregates hypothalamic spatial spots to independent animals and uses a deposited cohort that differs from the final publication. Check the study page and quality-control information before comparing effect sizes or counting biological replicates across these assays.' },
    ],
    groups: [
      {
        title: 'Whole-hypothalamus age comparisons',
        introduction: 'These studies provide distinct age endpoints, species or sampling designs. Choose the cohort that matches your research question before comparing a gene across studies.',
        studies: [
          { id: 'mouse_hypo_aging_gse240365', note: 'Male mouse hypothalamus at 12 weeks and 22 months, with three animals per arm.' },
          { id: 'mouse_hypo_aging_gse314817', note: 'Mouse hypothalamus from a multi-tissue atlas: 6 versus 27 months, with sex included in the model. Other tissues are not part of this dataset in HypoExplorer.' },
          { id: 'mouse_hypo_aging_gse212336', note: 'Mouse hypothalamus at 3 versus 21 months, with sex included in the model. The later 28-month male samples are excluded from this endpoint.' },
          { id: 'mouse_hypo_circadian_aging_gse201207', note: 'Mouse hypothalamus at 6 versus 27 months. Twelve circadian sampling levels are modeled to estimate the common cycle-averaged age effect.' },
          { id: 'rat_hypo_aging_gse314970', note: 'Male rat hypothalamus at 6 versus 27 months, with 12 independent animals per arm. This is a second rodent species, not a matched mouse replication.' },
          { id: 'macaque_hypo_aging_gse128537', note: 'Rhesus macaque hypothalamus: young donors aged 3.2 to 5 years versus middle-aged donors aged 9.8 to 10 years. Both arms include females and males.' },
        ],
      },
      {
        title: 'Astrocyte and spatial-derived views',
        introduction: 'These entries measure different biological material. Account for the preparation and aggregation when interpreting their results.',
        studies: [
          { id: 'mouse_hypo_astro_aging_gse99791', note: 'Hypothalamic GFAP-RiboTag RNA at 4 months versus 2 years. The single input library at each age is excluded because it does not form a replicated contrast.' },
          { id: 'mouse_hypo_spatial_aging_gse270383', note: "Female mouse hypothalamic spatial spots at 4 versus 23 months, aggregated by animal. This reanalysis uses the deposited 2024 cohort, not the final paper's revised cohort." },
        ],
      },
    ],
  },
  {
    slug: 'hypothalamic-obesity',
    title: 'Hypothalamus datasets for obesity and diet research',
    description: 'Find hypothalamus datasets for high-fat diet, obesity and leptin deficiency. Compare dietary controls, brain regions and cell preparations.',
    introduction: [
      'HypoExplorer includes dietary comparisons, a normal-versus-obese primate atlas reanalysis and a leptin-deficient mouse comparison for research on hypothalamus expression in obesity and metabolism. This guide explains how these experimental models differ. Do not treat every metabolic perturbation as the same obesity model.',
      'For a dietary question, first match the control diet, exposure duration and anatomical region. For a cellular question, compare the material captured by each assay. An arcuate-nucleus dissection, an astrocyte translatome and mixed lateral-hypothalamic cells answer different questions even when all contain a high-fat-diet arm.',
    ],
    guidance: [
      { title: 'A high-fat-diet contrast is defined by its control', text: 'Chow, normal-control diet and a specified low-fat diet are different reference conditions. The GSE236077 comparison covers 16 hours of dietary exposure; it should not be treated as equivalent to a chronic obesity endpoint. GSE305719 compares an HFD day-zero baseline with 12 weeks and has no parallel chow arm. That contrast alone cannot separate time from diet exposure.' },
      { title: 'Separate tissue and cell-population questions', text: 'The macaque reanalysis has 60 population tracks. GSE214683 captures ribosome-associated RNA from hypothalamic astrocytes. The GSE130597 analysis uses single-cell data aggregated to mixed-cell animal pseudobulk because a public barcode-to-cell-type map is unavailable. A shared gene symbol does not make these three measurements equivalent.' },
      { title: 'Check which part of the study is available', text: 'Some source studies include additional genotypes, drugs or tissues. The links below describe the comparisons available in HypoExplorer. The ob/ob entry is a leptin-deficiency genotype comparison, not a controlled change of diet. Acute fasting, maternal dietary programming and drug-only interventions are outside this guide.' },
    ],
    groups: [
      {
        title: 'Dietary studies across hypothalamic regions',
        introduction: 'Use these entries to compare a specific diet design within the whole hypothalamus or arcuate nucleus. Check the source page before interpreting a result as an obesity-associated effect.',
        studies: [
          { id: 'mouse_hypo_hfd_gse220533', note: 'Whole-hypothalamus chow-versus-HFD comparison. The data in HypoExplorer use the deposited log2-normalized expression scale.' },
          { id: 'mouse_arc_hfd_gse225038', note: 'Arcuate-nucleus chow-versus-HFD comparison from the control, Cre-negative arm of the broader Klf4 study.' },
          { id: 'mouse_hypo_hfd_emtab6929', note: 'Whole hypothalamus with a low-fat-diet baseline and high-fat-diet case; keep this diet definition distinct from chow-controlled studies.' },
          { id: 'mouse_hypo_hfd_gse236077', note: 'The hypothalamic arm of a mouse brain atlas, comparing chow with 16 hours of high-fat feeding. This is an acute dietary exposure.' },
          { id: 'mouse_hypo_hfd_tc_gse305719', note: 'HFD day zero versus 12 weeks in whole hypothalamus. This endpoint follows time on HFD and has no chow control arm.' },
        ],
      },
      {
        title: 'Population, translatome and genetic comparisons',
        introduction: 'These studies use different species, preparations and perturbations. Account for those differences before treating a shared result as replication.',
        studies: [
          { id: 'macaque_snrna', note: 'Normal-versus-obese reanalysis of the Lei et al. cynomolgus macaque single-nucleus atlas, with 60 population tracks. Original atlas authorship and this reanalysis are separate.' },
          { id: 'mouse_hypo_astro_trap_gse214683', note: 'Sham chow-versus-Sham HFD astrocyte TRAP-seq. This measures the captured translatome rather than a whole-tissue RNA profile.' },
          { id: 'mouse_lha_hfd_gse130597', note: 'Lateral-hypothalamus control-chow-versus-HFD single-cell data aggregated by mouse. The estimate mixes captured cell types.' },
          { id: 'mouse_hypo_obob_gse167264', note: 'Whole-hypothalamus wild-type-versus-ob/ob comparison. The perturbation is leptin deficiency, so it is grouped separately from diet assignment.' },
        ],
      },
    ],
  },
  {
    slug: 'hypothalamic-fasting-feeding',
    title: 'Hypothalamic fasting and feeding datasets',
    description: 'Find fed-versus-fasted hypothalamus datasets, AGRP and POMC neuron studies, dietary restriction and timed feeding. Check each comparison and assay.',
    introduction: [
      'This guide covers hypothalamic expression studies of food deprivation, dietary restriction and feeding schedules. Short fasting experiments are listed separately from interventions in food amount or timing. Choose a comparison that matches the duration and tissue or cell preparation you need.',
      "A paper about feeding does not always have a feeding comparison available in HypoExplorer. This guide excludes cell-subtype and knockout comparisons whose groups remain fed, even when they belong to the library's broader Feeding & fasting category. The links below identify the baseline and case groups in HypoExplorer.",
    ],
    guidance: [
      { title: 'Fasting duration and collection time matter', text: 'The selected whole-hypothalamus studies range from 16 to 72 hours of food deprivation. GSE254155 samples at ZT16, while the AGRP RiboTag study GSE124693 fixes collection at ZT14. Treat duration and circadian collection time as design variables when comparing results. Choosing the larger effect does not resolve an apparent disagreement between studies.' },
      { title: 'Check the cells and RNA collected', text: 'GSE68177 has separate sorted AGRP and POMC neuron datasets under the same accession. These are two neuronal populations from one source study, not two independent publications. RiboTag and NuTRAP isolate ribosome-associated RNA, while the whole-hypothalamus single-cell entry GSE87544 is aggregated to mouse pseudobulk in this app.' },
      { title: 'Restriction and timed feeding ask different questions', text: 'Five weeks of dietary restriction in aged mice is not interchangeable with a single fast. The SCN time-restricted-feeding study compares isocaloric Western-diet schedules over a 24-hour collection series and models collection time. Neither contrast should be relabeled simply as fasting-induced obesity or as evidence for a dietary treatment in people.' },
    ],
    groups: [
      {
        title: 'Whole-hypothalamus food deprivation',
        introduction: 'Compare fasting windows within the whole hypothalamus. Check the original source pages for the remaining strain, sex and handling details.',
        studies: [
          { id: 'mouse_hypo_fedfast_gse254155', note: 'Wild-type male mice, ad-libitum feeding versus a 16-hour fast, sampled at ZT16.' },
          { id: 'mouse_hypo_fasting_gse289833', note: 'Fed versus 18-hour-fasted whole hypothalamus from 8-week-old male mice. The hippocampal arm is excluded.' },
          { id: 'mouse_hypo_fasting_gse87544', note: 'Normal feeding versus 24-hour food deprivation. The source is Drop-seq, but cells and technical partitions are collapsed to eight mouse pseudobulks.' },
          { id: 'mouse_hypo_fasting_gse294478', note: 'Fed versus 72-hour-fasted whole hypothalamus. This is a negative-energy-balance comparison, not an obesity contrast.' },
        ],
      },
      {
        title: 'AGRP and POMC neuron preparations',
        introduction: 'Compare the captured neurons and RNA fraction before interpreting differences between these entries.',
        studies: [
          { id: 'mouse_agrp_fedfast_gse68177', note: 'FACS-purified arcuate AGRP neurons under fed and fasted conditions; paired here with the POMC entry from the same GEO study.' },
          { id: 'mouse_pomc_fedfast_gse68177', note: 'FACS-purified arcuate POMC neurons, fed versus 24-hour fasting. It shares GSE68177 with the AGRP entry.' },
          { id: 'mouse_arc_agrp_trap_gse240484', note: 'AGRP-neuron NuTRAP, ad-libitum feeding versus overnight fasting. The leptin-injected and POMC-neuron arms are excluded.' },
          { id: 'mouse_agrp_fedfast_gse124693', note: 'AGRP RiboTag RNA, ad-libitum feeding versus a 24-hour fast at ZT14, with collection time, genotype and affinity fraction held fixed.' },
        ],
      },
      {
        title: 'Food amount and feeding schedule',
        introduction: 'Compare these longer or scheduled interventions separately from acute deprivation.',
        studies: [
          { id: 'mouse_hypo_dr_gse227689', note: 'Nineteen-month-old female mice, ad-libitum feeding versus five weeks of acute dietary restriction. The separate young-plasma experiment is excluded.' },
          { id: 'mouse_scn_trf_gse190389', note: 'SCN time course comparing nine-hour time-restricted Western-diet feeding with isocaloric ad-libitum feeding; collection ZT is modeled additively.' },
        ],
      },
    ],
  },
  {
    slug: 'single-cell-hypothalamus',
    title: 'Single-cell and single-nucleus hypothalamus datasets',
    description: 'Browse hypothalamus scRNA-seq and snRNA-seq data. The macaque atlas has population tracks; the mouse studies use animal pseudobulk.',
    introduction: [
      'This collection lists hypothalamic datasets generated with single-cell RNA-seq or single-nucleus RNA-seq. Check both the source assay and the analysis available in HypoExplorer. The macaque atlas has individual population tracks, whereas the mouse studies listed below are aggregated to one expression profile per animal for the selected comparison.',
      'Use the macaque atlas to browse population-specific obese-versus-normal results. Choose a mouse entry when its species, region, developmental stage and intervention fit your question. The app aggregates mouse data by animal, so the available results may not include the original cell annotations or embeddings.',
    ],
    guidance: [
      { title: 'Count animals, not cells, as replicates', text: 'Cells from one animal do not constitute independent animals. In the mouse pseudobulk views, deposited cells and within-animal technical runs are combined before the selected group comparison. Use the biological sample count on the study page when assessing replication.' },
      { title: 'Distinguish lineage enrichment from cell-type resolution', text: 'GSE143818 captures developing VMH Sf1-lineage cells and GSE174085 captures PVN CRH-expressing cells. Their animal-level aggregates are lineage-enriched comparisons, not interchangeable whole-hypothalamus estimates. The GSE130597 analysis combines captured LHA cell types because the public data lack a barcode-to-cell-type map.' },
      { title: 'Match developmental stage and assay', text: 'P0 arcuate-median-eminence data, P10 VMH-lineage cells and adult whole-hypothalamus data differ in age and sampled cells. This guide excludes sorted bulk RNA-seq, TRAP, RiboTag and spatial RNA-seq, even when they target a cell type. Follow each source citation for the original atlas scope and the study page for the subset used in HypoExplorer.' },
    ],
    groups: [
      {
        title: 'Population-level single-nucleus atlas',
        introduction: 'The macaque dataset lets you browse populations in the explorer.',
        studies: [
          { id: 'macaque_snrna', note: 'Cynomolgus macaque hypothalamus, normal versus obese, across 60 population tracks. This is an obese-versus-normal reanalysis of the Lei et al. atlas, with the source authors credited separately.' },
        ],
      },
      {
        title: 'Mouse single-cell studies analysed as animal pseudobulk',
        introduction: 'Each entry identifies the source assay and states how the data are aggregated. Open a study for its biological sample counts, comparison direction and caveats.',
        studies: [
          { id: 'mouse_lha_hfd_gse130597', note: 'Lateral hypothalamus, control chow versus HFD. The captured cells are aggregated by mouse with sequencing pool modeled; no public barcode-to-cell-type map is available.' },
          { id: 'mouse_hypo_fasting_gse87544', note: 'Whole hypothalamus, normal feeding versus 24-hour food deprivation. Seventeen technical partitions are collapsed to eight independent mouse pseudobulks.' },
          { id: 'mouse_hypo_akkermansia_gse212491', note: 'Fructose-fed mouse hypothalamus with or without Akkermansia muciniphila, aggregated to three animal libraries per arm. The cited source is a preprint.' },
          { id: 'mouse_vmh_sf1_sex_gse143818', note: 'P10 VMH Sf1-lineage cells, female versus male, aggregated by mouse. This is a developmental lineage-enriched view, not an adult whole-hypothalamus estimate.' },
          { id: 'mouse_pvn_crh_ela_gse174085', note: 'P10 to P12 PVN CRH-expressing cells, control rearing versus early-life adversity; cells are aggregated by animal and collection age is modeled.' },
          { id: 'mouse_arc_mettl14_gse289461', note: 'P0 arcuate-median-eminence cells, control versus Mettl14 knockout. Sections and droplet runs are pooled within each animal to form eight mouse pseudobulks.' },
        ],
      },
    ],
  },
];

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function topicPath(topic: TopicCollection): string {
  return `/topics/${topic.slug}/`;
}

function studyPath(dataset: Dataset): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(dataset.id)) throw new Error(`Unsafe topic study id: ${dataset.id}`);
  return `/studies/${dataset.id}/`;
}

function studiesForTopic(topic: TopicCollection): TopicStudy[] {
  return topic.groups.flatMap((group) => group.studies);
}

/** Link overlapping selections without treating topic similarity as proof that
 * different cohorts or interventions answer the same biological question. */
function relatedTopics(topic: TopicCollection): TopicCollection[] {
  const ids = new Set(studiesForTopic(topic).map((study) => study.id));
  return TOPIC_COLLECTIONS.filter((candidate) => candidate.slug !== topic.slug
    && studiesForTopic(candidate).some((study) => ids.has(study.id)));
}

function guideAuthor(): Record<string, string> {
  return { '@type': 'Person', '@id': `${SITE_URL}/about/#author`, name: AUTHOR_NAME, url: `${SITE_URL}/about/` };
}

function defaultComparison(dataset: Dataset): string {
  const contrast = dataset.contrasts.find((entry) => entry.isDefault) ?? dataset.contrasts[0];
  if (!contrast) return 'See study for available comparisons';
  const label = (key: string) => dataset.groups.find((group) => group.key === key)?.label ?? key;
  return `${label(contrast.baseline)} → ${label(contrast.case)}`;
}

function studyCard(dataset: Dataset, note: string): string {
  return `<article class="study-card"><div class="accession">${escapeHtml(dataset.geo || 'Macaque atlas')}</div>
<h3><a href="${studyPath(dataset)}">${escapeHtml(dataset.name)}</a></h3>
<p>${escapeHtml(dataset.organism)} · ${escapeHtml(dataset.modality)} · ${escapeHtml(dataset.region)}</p>
<p><strong>Baseline → case:</strong> ${escapeHtml(defaultComparison(dataset))}</p>
<p>${escapeHtml(note)}</p><p class="small"><a href="${studyPath(dataset)}">View study, source and comparisons</a></p></article>`;
}

export function topicLinksForDataset(dataset: Dataset): Array<{ title: string; path: string }> {
  return TOPIC_COLLECTIONS.filter((topic) => studiesForTopic(topic).some((study) => study.id === dataset.id))
    .map((topic) => ({ title: topic.title, path: topicPath(topic) }));
}

/** Call with the full registry. Missing or duplicated memberships fail the
 * build so edits cannot silently publish empty guides or broken study links. */
export function getTopicDocuments(datasets: Dataset[]): TopicDocument[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  if (byId.size !== datasets.length) throw new Error('Duplicate dataset id in topic input');
  const paths = new Set<string>();
  for (const topic of TOPIC_COLLECTIONS) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.slug) || paths.has(topicPath(topic))) {
      throw new Error(`Invalid or duplicate topic slug: ${topic.slug}`);
    }
    paths.add(topicPath(topic));
    const members = new Set<string>();
    for (const study of studiesForTopic(topic)) {
      if (!byId.has(study.id)) throw new Error(`Missing curated study ${study.id} in ${topic.slug}`);
      if (members.has(study.id)) throw new Error(`Duplicate curated study ${study.id} in ${topic.slug}`);
      members.add(study.id);
    }
  }

  const documents = TOPIC_COLLECTIONS.map((topic): TopicDocument => {
    const path = topicPath(topic);
    const members = studiesForTopic(topic).map((study) => byId.get(study.id)!);
    const related = relatedTopics(topic);
    return {
      title: `${topic.title} | ${SITE_NAME}`,
      description: topic.description,
      path,
      schema: [{
        '@type': 'CollectionPage', '@id': `${SITE_URL}${path}#collection`, url: SITE_URL + path,
        name: topic.title, description: topic.description,
        author: guideAuthor(), inLanguage: 'en',
        isPartOf: { '@id': `${SITE_URL}/topics/#collection` },
        mainEntity: { '@id': `${SITE_URL}${path}#studies` },
      }, {
        '@type': 'ItemList', '@id': `${SITE_URL}${path}#studies`, name: `${topic.title}: selected studies`,
        numberOfItems: members.length,
        itemListElement: members.map((dataset, index) => ({
          '@type': 'ListItem', position: index + 1,
          item: { '@type': 'Dataset', '@id': `${SITE_URL}${studyPath(dataset)}#dataset`, name: dataset.name, description: studySearchDescription(dataset), url: SITE_URL + studyPath(dataset), sameAs: SITE_URL + studyPath(dataset) },
        })),
      }],
      body: `<div class="eyebrow">Research guide · ${members.length} selected datasets</div><h1>${escapeHtml(topic.title)}</h1>
${topic.introduction.map((paragraph) => `<p class="intro">${escapeHtml(paragraph)}</p>`).join('')}
<p class="small">${escapeHtml(AUTHOR_BIO)} <a href="/about/">About the author</a>.</p>
<div class="actions"><a class="button secondary" href="/studies/">Browse all studies</a><a class="button secondary" href="/topics/">All research guides</a></div>
<nav class="category-links" aria-label="On this research guide"><a href="#comparison-guidance">Comparison guidance</a>${topic.groups.map((group, index) => `<a href="#study-group-${index + 1}">${escapeHtml(group.title)}</a>`).join('')}</nav>
<section class="panel" id="comparison-guidance"><h2>How to choose and compare studies</h2>${topic.guidance.map((item) => `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p>`).join('')}</section>
${topic.groups.map((group, index) => `<section class="catalog-section" id="study-group-${index + 1}"><h2>${escapeHtml(group.title)}</h2><p class="intro">${escapeHtml(group.introduction)}</p><div class="study-list">${group.studies.map((study) => studyCard(byId.get(study.id)!, study.note)).join('')}</div></section>`).join('')}
${related.length ? `<section class="panel"><h2>Related research questions</h2><p>These guides share some of the same datasets and explain how to use them for other research questions.</p><ul>${related.map((item) => `<li><a href="${topicPath(item)}">${escapeHtml(item.title)}</a>: ${escapeHtml(item.description)}</li>`).join('')}</ul></section>` : ''}
<section class="panel"><h2>Using this research guide</h2><p>This guide selects studies by the comparisons and assays available in ${SITE_NAME}. It does not combine results into a meta-analysis. Each study page credits the original authors and describes the subset shown in the app.</p><p>Follow the <a href="/methods/#finding-genes">gene-search instructions</a> to inspect a gene, or the <a href="/methods/#downloads">data and export guide</a> to save results. Read the <a href="/methods/">analysis methods and limitations</a> before interpreting a result. Use the <a href="/how-to-cite/">citation guide</a> to credit the original researchers and this app.</p></section>`,
    };
  });
  const indexDescription = 'Choose a hypothalamus dataset by research question: aging, obesity, fasting and feeding, or single-cell and single-nucleus assays.';
  return [{
    title: `Hypothalamus research guides | ${SITE_NAME}`,
    description: indexDescription,
    path: '/topics/',
    schema: [{
      '@type': 'CollectionPage', '@id': `${SITE_URL}/topics/#collection`, url: `${SITE_URL}/topics/`,
      name: 'Hypothalamus research guides', description: indexDescription,
      author: guideAuthor(), inLanguage: 'en',
      mainEntity: { '@id': `${SITE_URL}/topics/#guides` },
    }, {
      '@type': 'ItemList', '@id': `${SITE_URL}/topics/#guides`, name: 'Hypothalamus research guides',
      numberOfItems: documents.length,
      itemListElement: documents.map((document, index) => ({
        '@type': 'ListItem', position: index + 1,
        item: { '@type': 'CollectionPage', '@id': `${SITE_URL}${document.path}#collection`, name: TOPIC_COLLECTIONS[index].title, url: SITE_URL + document.path },
      })),
    }],
    body: `<div class="eyebrow">Choose a research question</div><h1>Hypothalamus research guides</h1>
<p class="intro">Choose a guide for your research question. Each guide compares species, sampled regions, experimental groups and RNA preparations, with links to the studies available in ${SITE_NAME}.</p>
<p class="intro">The guides cover selected studies within the larger library. A dataset can appear in more than one guide when it addresses both questions, such as a single-cell study of fasting. Inclusion depends on the comparison available here, rather than every topic discussed in the source paper.</p>
<p class="small">${escapeHtml(AUTHOR_BIO)} <a href="/about/">About the author</a>.</p>
<div class="study-list">${TOPIC_COLLECTIONS.map((topic) => `<article class="study-card"><h2><a href="${topicPath(topic)}">${escapeHtml(topic.title)}</a></h2><p>${escapeHtml(topic.description)}</p><p class="small">${studiesForTopic(topic).length} selected datasets · Comparison guidance and source links</p></article>`).join('')}</div>
<section class="panel" style="margin-top:24px"><h2>Know an accession or paper already?</h2><p>The <a href="/studies/">complete study directory</a> lists every dataset available in the explorer with its GEO or other repository accession and source publication where available. Use a guide to understand study differences, or go directly to a study when you already know the source.</p><p>The <a href="/methods/">Methods page</a> explains how source data and comparisons are represented. <a href="/about/">About ${SITE_NAME}</a> identifies the app author and provides a contact for corrections.</p></section>`,
  }, ...documents];
}
