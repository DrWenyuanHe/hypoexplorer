// Build-time HTML for study discovery. The registry remains the authority for
// the comparisons available in the app; paper titles are separate verified
// metadata and are never guessed from a study's display name.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetsByCategory, listDatasets } from '../../src/data/datasets';
import {
  AUTHOR_BIO, AUTHOR_EMAIL, AUTHOR_NAME, CONTRIBUTOR_NAMES, DATA_REPO_URL, SITE_NAME, SITE_URL,
  SOURCE_REPO_URL,
} from '../../src/data/siteInfo';
import { datasetExternalLinks, datasetPmid, repositoryName } from '../../src/utils/datasetLinks';
import { upstreamDisplay, upstreamProcessingFor } from '../../src/data/upstreamProcessing';
import type { Dataset, DatasetMeta } from '../../src/types';
import { renderStudyContext, studySearchDescription, studySearchTitle } from './seoStudyContent.mjs';
import { getGuideDocuments } from './seoGuides.mjs';
import { escapeHtml } from './html.mjs';
import { studyRecord, type StudyRecord, type StudySources } from './studyRecord.mjs';
import { datasetBundlePaths, readDatasetFromDisk } from './bundleReader.mjs';
import { BRAND, BRAND_HEAD } from '../../src/common/brand';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface StudyDetails {
  /** The study's publication record; a dataset with no snapshot or meta gets an empty one. */
  record?: StudyRecord;
  accessions?: string[];
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function studyPath(dataset: Pick<Dataset, 'id'>): string {
  // Registry ids are deliberately preserved: every app dataset gets one stable
  // URL, without a second slug-to-dataset index to drift out of sync.
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(dataset.id)) throw new Error(`Unsafe study id: ${dataset.id}`);
  return `/studies/${dataset.id}/`;
}

const CSS = `
:root{color-scheme:light;--blue:#215d96;--ink:#27251e;--muted:#5d5a54;--line:#e3dfda;--paper:#fff;--wash:#faf8f5;--mono:'Geist Mono','IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:16px/1.65 var(--font-sans)}a{color:var(--blue);text-underline-offset:3px;overflow-wrap:anywhere}a:hover{text-decoration-thickness:2px}a:focus-visible{outline:3px solid #c66b0b;outline-offset:4px}p{margin:0 0 1rem}h1,h2,h3{line-height:1.2;font-weight:600;overflow-wrap:anywhere}h1{font-size:clamp(1.9rem,4vw,3rem);letter-spacing:-.035em;max-width:28ch;margin:.6rem 0 1.2rem}h2{font-size:1.35rem;margin:0 0 1.1rem}h3{font-size:1.06rem;margin:0 0 .55rem}.skip{position:absolute;top:-100px;left:12px;background:white;padding:8px;z-index:2}.skip:focus{top:12px}.site-header{background:var(--paper);border-top:4px solid var(--blue);border-bottom:1px solid var(--line)}.header-inner,main,footer{max-width:1120px;margin:auto;padding-left:32px;padding-right:32px}.header-inner{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:1.35rem;letter-spacing:-.04em;font-weight:600;text-decoration:none;color:var(--ink)}.brand span{color:var(--blue)}nav{display:flex;gap:24px;flex-wrap:wrap}nav a{font-size:.9rem;font-weight:500;text-decoration:none}nav a[aria-current=page]{text-decoration:underline;text-decoration-thickness:2px}main{padding-top:30px;padding-bottom:44px}.breadcrumbs{font-size:.82rem;color:var(--muted);margin-bottom:28px}.breadcrumbs a{margin-right:7px}.eyebrow,.mono{font-family:var(--mono)}.eyebrow{text-transform:uppercase;font-size:.73rem;letter-spacing:.075em;color:var(--blue);margin-bottom:8px}.intro{max-width:78ch;color:var(--muted);font-size:1.03rem}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0 30px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:9px 17px;border:1px solid var(--blue);border-radius:5px;text-decoration:none;font-size:.9rem;font-weight:500;background:var(--blue);color:white}.button.secondary{background:white;color:var(--blue)}.chips{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}.chip{font-size:.76rem;border:1px solid var(--line);padding:3px 9px;border-radius:4px;background:white;font-family:var(--mono)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:start}.panel{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:26px;margin-bottom:24px}.panel p:last-child{margin-bottom:0}.facts{margin:0}.facts div{padding:11px 0;border-bottom:1px solid var(--line)}.facts div:first-child{padding-top:0}.facts div:last-child{border:0;padding-bottom:0}.facts dt{font-size:.77rem;color:var(--muted);margin:0 0 3px}.facts dd{margin:0;font-size:.9rem;overflow-wrap:anywhere}.source-links{padding-left:20px;margin:12px 0 0}.source-links li{margin:7px 0}.muted,.small{color:var(--muted)}.small{font-size:.84rem}.note{padding:14px 16px;border-left:3px solid #d39b39;background:#fff9ed;font-size:.9rem;margin:14px 0}.comparison{padding:15px 0;border-top:1px solid var(--line)}.comparison:first-of-type{padding-top:0;border-top:0}.comparison p{font-size:.88rem;margin:6px 0}.comparison .direction{font-family:var(--mono);font-size:.85rem}.comparison .direction span{color:var(--muted)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.87rem}caption{text-align:left;color:var(--muted);font-size:.82rem;padding-bottom:12px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}th{font-weight:500;background:var(--wash)}td:first-child{max-width:22ch;overflow-wrap:anywhere}.category-links{display:flex;flex-wrap:wrap;gap:8px 18px;margin:24px 0 32px;font-size:.86rem}.catalog-section{scroll-margin-top:20px;margin-bottom:36px}.catalog-section>h2{padding-bottom:12px;border-bottom:2px solid var(--line)}.study-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.study-card{background:white;border:1px solid var(--line);border-radius:5px;padding:20px}.study-card h3 a{text-decoration:none}.study-card p{font-size:.84rem;margin:8px 0 0}.study-card .accession{font-size:.73rem;color:var(--blue);font-family:var(--mono);margin-bottom:8px}.study-card .paper{font-size:.83rem;color:var(--ink)}.related{margin-top:10px;padding-left:20px}.related li{margin:10px 0}.about{max-width:790px}.author-name{font-size:1.5rem}.contact{font-family:var(--mono);font-size:.9rem}footer{border-top:1px solid var(--line);padding-top:24px;padding-bottom:32px;color:var(--muted);font-size:.81rem;display:flex;justify-content:space-between;gap:24px}footer p{margin:0}.footer-links{display:flex;gap:16px;flex-wrap:wrap}
@media(max-width:800px){.layout{grid-template-columns:1fr}.layout aside{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.layout aside .panel{margin:0}.study-list{grid-template-columns:1fr}}
@media(max-width:520px){.header-inner,main,footer{padding-left:18px;padding-right:18px}.header-inner{padding-top:15px;padding-bottom:15px;align-items:flex-start;flex-direction:column;gap:10px}.header-inner nav{gap:24px}.layout aside{display:block}.layout aside .panel{margin-bottom:20px}.panel{padding:20px}.actions .button{flex:1 1 auto}footer{flex-direction:column;gap:12px}h1{font-size:2rem}}
`;

function breadcrumbs(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...items].map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name, item: SITE_URL + item.path,
    })),
  };
}

function page(input: { title: string; description: string; path: string; section: 'studies' | 'about' | 'methods' | 'how-to-cite'; body: string; schema: unknown[] }): string {
  const canonical = SITE_URL + input.path;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="description" content="${escapeHtml(input.description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="${BRAND.themeColor}">
${BRAND_HEAD}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(input.title)}"><meta property="og:description" content="${escapeHtml(input.description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${SITE_URL}/social-preview.jpg">
<meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="HypoExplorer homepage with dataset, gene, and pathway search tools">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(input.title)}">
<meta name="twitter:description" content="${escapeHtml(input.description)}">
<meta name="twitter:image" content="${SITE_URL}/social-preview.jpg">
<meta name="twitter:image:alt" content="HypoExplorer homepage with dataset, gene, and pathway search tools">
<link rel="stylesheet" href="/fonts/ibm-plex.css">
<link rel="stylesheet" href="/fonts/geist-mono/geist-mono.css">
<link rel="stylesheet" href="/fonts/hanken/hanken.css">
<link rel="stylesheet" href="/fonts/source/source.css">
<link rel="stylesheet" href="/fonts/typography.css">
<style>${CSS}</style>
<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': input.schema })}</script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="header-inner"><a class="site-brand" href="${BRAND.home}" aria-label="${BRAND.label}"><img src="${BRAND.logo}" width="${BRAND.width}" height="${BRAND.height}" alt="HypoExplorer"></a>
<nav aria-label="Main navigation"><a href="/">Home</a><a href="/studies/"${input.section === 'studies' ? ' aria-current="page"' : ''}>Studies</a><a href="/methods/"${input.section === 'methods' ? ' aria-current="page"' : ''}>Methods</a><a href="/about/"${input.section === 'about' ? ' aria-current="page"' : ''}>About</a></nav></div></header>
<main id="main">${input.body}</main>
<footer><p>${SITE_NAME} · Hypothalamus transcriptomics<br>Created by ${escapeHtml(AUTHOR_NAME)}.</p><div class="footer-links"><a href="/methods/">Methods</a><a href="/how-to-cite/">How to cite</a><a href="/about/">About &amp; contact</a><a href="/#/library">Dataset library</a><a href="${SOURCE_REPO_URL}">Source code on GitHub</a><a href="${DATA_REPO_URL}">Data repository on GitHub</a></div></footer>
</body></html>\n`;
}

function contrastLabel(dataset: Dataset, contrast: Dataset['contrasts'][number]): string {
  const group = (key: string) => dataset.groups.find((entry) => entry.key === key)?.label ?? key;
  return contrast.label || `${group(contrast.case)} vs ${group(contrast.baseline)}`;
}

function studyDescription(dataset: Dataset): string {
  return studySearchDescription(dataset);
}

function trackTable(dataset: Dataset, record: StudyRecord): string {
  if (!record.tracks.length) return '';
  const { defaultContrast, armLabels, tracks } = record;
  const unknown = tracks.some((track) => track.nBaseline == null || track.nCase == null);
  return `<section class="panel"><h2>Available ${escapeHtml(dataset.trackNoun === 'population' ? 'cell populations' : 'tracks')}</h2>
<div class="table-wrap"><table><caption>Detected features and sample counts for ${escapeHtml(defaultContrast ? defaultContrast.label : 'the default comparison')}. Counts are specific to each track.${unknown ? ' A dash marks a track whose count for this comparison is not recorded.' : ''}</caption>
<thead><tr><th scope="col">Track</th><th scope="col">Features</th><th scope="col">${escapeHtml(armLabels.baselineLabel)} n</th><th scope="col">${escapeHtml(armLabels.caseLabel)} n</th></tr></thead>
<tbody>${tracks.map((track) => `<tr><td>${escapeHtml(track.label)}</td><td>${escapeHtml(track.features?.toLocaleString('en-US') ?? '—')}</td><td>${escapeHtml(track.nBaseline ?? '–')}</td><td>${escapeHtml(track.nCase ?? '–')}</td></tr>`).join('')}</tbody></table></div></section>`;
}

export function renderStudyPage(dataset: Dataset, details: StudyDetails = {}, related: Dataset[] = []): string {
  const path = studyPath(dataset);
  const { record = studyRecord(dataset, {}), accessions = [] } = details;
  const { source, publication } = record;
  const identifiers = [...new Set([dataset.geo, ...accessions].filter((value): value is string => Boolean(value)))];
  // The record decides publication identity. An unverified snapshot is dropped
  // whole (title, authors, year, journal and URL together) and the registry's
  // own citation stands; a verified one's DOI replaces an older registry DOI.
  const verified = publication.status === 'verified' ? publication : undefined;
  const paperDoi = verified?.doi;
  const links = datasetExternalLinks({ ...dataset, pmid: record.pmid, doi: record.doi });
  const paperUrl = verified?.url ?? links.find((link) => link.kind === 'doi' || link.kind === 'pubmed')?.href;
  const sourceLink = record.repositoryUrl ?? links.find((link) => link.kind === 'repository')?.href;
  const title = studySearchTitle(dataset, identifiers[0]);
  const description = studyDescription(dataset);
  const sourceCitation = verified
    ? { '@type': 'ScholarlyArticle', name: verified.title, ...(paperUrl ? { url: paperUrl } : {}), ...(paperDoi ? { identifier: `https://doi.org/${paperDoi}` } : {}),
      ...(source.paperAuthors?.length ? { author: source.paperAuthors.map((name) => ({ '@type': source.paperCollectiveAuthors?.includes(name) ? 'Organization' : 'Person', name })) } : {}),
      ...(source.paperYear ? { datePublished: source.paperYear } : {}),
      ...(source.paperJournal ? { isPartOf: { '@type': 'Periodical', name: source.paperJournal } } : {}),
      ...(source.paperIsPreprint ? { creativeWorkStatus: 'Preprint' } : {}) }
    : dataset.citation;
  const facts: Array<[string, string]> = [
    ['Organism', dataset.organism], ['Anatomical region', dataset.region], ['Assay', dataset.modality],
    ['Preparation', dataset.preparation], ['Research theme', dataset.category],
    ['Perturbation', dataset.perturbation], ['Expression unit', dataset.expressionUnit ?? 'CPM'],
  ];
  // The depositor's aligner, genome build and annotation; the analysis starts
  // from their deposited matrix.
  const upstream = upstreamDisplay(upstreamProcessingFor(dataset));
  if (upstream) facts.push(['Upstream processing', upstream]);
  const schema = {
    '@type': 'Dataset', '@id': `${SITE_URL}${path}#dataset`, name: dataset.name,
    description: `${description} ${dataset.citation}`, url: SITE_URL + path,
    isAccessibleForFree: true,
    identifier: identifiers.length ? identifiers : [dataset.id],
    keywords: [dataset.organism, dataset.region, dataset.modality, dataset.category, ...identifiers],
    measurementTechnique: dataset.modality, variableMeasured: `${dataset.featureLabel} expression`,
    citation: sourceCitation,
    ...(sourceLink ? { isBasedOn: source.sourceTitle ? { '@type': 'CreativeWork', name: source.sourceTitle,
      url: sourceLink, ...(dataset.geo ? { identifier: dataset.geo } : {}) } : sourceLink } : {}),
    includedInDataCatalog: { '@type': 'DataCatalog', '@id': `${SITE_URL}/studies/#catalog`, name: `${SITE_NAME} studies`, url: `${SITE_URL}/studies/` },
  };
  return page({ title, description, path, section: 'studies', schema: [schema, breadcrumbs([{ name: 'Studies', path: '/studies/' }, { name: dataset.geo || dataset.name, path }])], body: `
<div class="breadcrumbs"><a href="/">Home</a> / <a href="/studies/">Studies</a> / ${escapeHtml(dataset.geo || dataset.name)}</div>
<div class="eyebrow">${escapeHtml(dataset.category)}</div>
<h1>${escapeHtml(dataset.name)}</h1>
<p class="intro">${escapeHtml(dataset.organism)} · ${escapeHtml(dataset.region)} · ${escapeHtml(dataset.modality)}</p>
${identifiers.length ? `<div class="chips" aria-label="Dataset accessions">${identifiers.map((identifier) => `<span class="chip">${escapeHtml(identifier)}</span>`).join('')}</div>` : ''}
<div class="actions"><a class="button" href="/#/dataset/${dataset.id}">Explore this dataset</a><a class="button secondary" href="/#/library/${dataset.id}">View in dataset library</a></div>
<div class="layout"><div>
${renderStudyContext(dataset, record)}
<section class="panel"><h2>Source study</h2>
<p>${escapeHtml(dataset.citation)}</p>
${verified ? `<h3>${source.paperRelationship === 'methods' ? 'Related methods publication' : 'Source publication'}${source.paperIsPreprint ? ' · preprint' : ''}</h3><p>${paperUrl ? `<a href="${escapeHtml(paperUrl)}">${escapeHtml(verified.title)}</a>` : escapeHtml(verified.title)}</p>${source.paperAuthors?.length ? `<p class="small">${escapeHtml(source.paperAuthors.slice(0, 6).join(', '))}${source.paperAuthors.length > 6 ? ', et al.' : ''}</p>` : ''}${source.paperJournal || source.paperYear ? `<p class="small">${escapeHtml([source.paperJournal, source.paperYear].filter(Boolean).join(' · '))}</p>` : ''}` : ''}
${source.paperRelationshipNote ? `<p class="note">${escapeHtml(source.paperRelationshipNote)}</p>` : ''}
${source.sourceTitle ? `<h3>Repository study title</h3><p>${escapeHtml(source.sourceTitle)}</p>` : ''}
${source.summary ? `<p>${escapeHtml(source.summary)}</p>` : ''}
${source.overallDesign ? `<h3>Source study design</h3><p>${escapeHtml(source.overallDesign)}</p>` : ''}
<ul class="source-links">${links.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.kind === 'doi' ? `DOI ${record.doi}` : link.kind === 'repository' ? `${repositoryName(dataset.geo)} ${link.label}` : link.label)}</a></li>`).join('')}${sourceLink && !links.some((link) => link.href === sourceLink) ? `<li><a href="${escapeHtml(sourceLink)}">Original repository record</a></li>` : ''}</ul>
<p class="small" style="margin-top:16px">The original study authors produced these data. ${SITE_NAME} displays selected data and analyses that may cover only part of the study.</p>
<p class="small"><a href="/how-to-cite/">How to cite the dataset, publication and ${SITE_NAME}</a></p>
</section>
<section class="panel"><h2>Comparisons in ${SITE_NAME}</h2>
${dataset.contrasts.map((contrast) => {
    const baseline = dataset.groups.find((group) => group.key === contrast.baseline)?.label ?? contrast.baseline;
    const comparison = dataset.groups.find((group) => group.key === contrast.case)?.label ?? contrast.case;
    return `<div class="comparison"><h3>${escapeHtml(contrastLabel(dataset, contrast))}${contrast.isDefault ? ' <span class="small">· default</span>' : ''}</h3><div class="direction"><span>Baseline:</span> ${escapeHtml(baseline)} <span>→ Case:</span> ${escapeHtml(comparison)}</div>${contrast.description ? `<p>${escapeHtml(contrast.description)}</p>` : ''}${contrast.exploratory ? '<p class="note">This exploratory comparison is a reanalysis. The source study did not run it.</p>' : ''}</div>`;
  }).join('')}
${dataset.timeSeries?.design ? `<h3>Time-course design</h3><p>${escapeHtml(dataset.timeSeries.design)}</p>` : ''}
<p class="small">Positive differential-expression values indicate higher expression in the case group relative to the baseline. Check the comparison direction and study design when interpreting results.</p>
</section>
${trackTable(dataset, record)}
<section class="panel"><h2>Expression and analysis results</h2><p>Open this dataset to inspect ${escapeHtml(dataset.featureLabel.toLowerCase())} expression and differential-expression results across the available ${escapeHtml(dataset.trackNoun === 'population' ? 'cell populations' : 'tracks')}.${dataset.supportsPathways ? ' Pathway enrichment is also available. The pathway databases differ by dataset.' : ''}</p><p class="small">Review the original source, analysis methods and quality-control checks before using a result in research.</p></section>
</div><aside aria-label="Study details"><section class="panel"><h2>At a glance</h2><dl class="facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}<div><dt>Experimental groups</dt><dd>${dataset.groups.map((group) => escapeHtml(group.label)).join('<br>')}</dd></div></dl></section>
${related.length ? `<section class="panel"><h2>Related studies</h2><ul class="related">${related.map((entry) => `<li><a href="${studyPath(entry)}">${escapeHtml(entry.geo ? `${entry.geo}: ${entry.name}` : entry.name)}</a></li>`).join('')}</ul></section>` : ''}
</aside></div>` });
}

function categoryId(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function renderStudiesPage(datasets: Dataset[], details: Record<string, StudyDetails> = {}): string {
  const groups = datasetsByCategory(datasets);
  const speciesCount = new Set(datasets.map((dataset) => dataset.organism)).size;
  const description = `Browse ${datasets.length} hypothalamus transcriptomics datasets across ${speciesCount} species. Find GEO accessions, source publications and gene-expression analyses in ${SITE_NAME}.`;
  return page({ title: `Hypothalamus datasets & source studies | ${SITE_NAME}`, description, path: '/studies/', section: 'studies', schema: [{
    '@type': 'DataCatalog', '@id': `${SITE_URL}/studies/#catalog`, name: `${SITE_NAME} studies`,
    url: `${SITE_URL}/studies/`, description,
    dataset: datasets.map((dataset) => ({ '@type': 'Dataset', '@id': `${SITE_URL}${studyPath(dataset)}#dataset`, name: dataset.name, description: studyDescription(dataset), url: SITE_URL + studyPath(dataset), sameAs: SITE_URL + studyPath(dataset) })),
  }, breadcrumbs([{ name: 'Studies', path: '/studies/' }])], body: `
<div class="breadcrumbs"><a href="/">Home</a> / Studies</div>
<div class="eyebrow">The study collection</div><h1>Hypothalamus datasets and source studies</h1>
<p class="intro">Browse ${datasets.length} datasets across ${speciesCount} species. The collection includes the macaque single-nucleus atlas, bulk tissue datasets and cell-type-specific expression studies. Each entry links the data in ${SITE_NAME} to its repository accession, publication and available comparisons.</p>
<p>Read the <a href="/methods/">analysis methods and limitations</a> before comparing results.</p>
<p class="small">Use your browser's find function to search this page for a GEO accession or paper. Open the dataset library to filter by species, anatomy and assay.</p>
<div class="actions"><a class="button" href="/#/library">Open dataset library</a></div>
<nav class="category-links" aria-label="Study themes">${groups.map(({ category, datasets: entries }) => `<a href="#${categoryId(category)}">${escapeHtml(category)} (${entries.length})</a>`).join('')}</nav>
${groups.map(({ category, datasets: entries }) => `<section class="catalog-section" id="${categoryId(category)}"><h2>${escapeHtml(category)} <span class="small">${entries.length} studies</span></h2><div class="study-list">${entries.map((dataset) => {
    const publication = details[dataset.id]?.record?.publication;
    const verified = publication?.status === 'verified' ? publication : undefined;
    return `<article class="study-card"><div class="accession">${escapeHtml(dataset.geo || details[dataset.id]?.accessions?.[0] || 'Primate atlas')}</div><h3><a href="${studyPath(dataset)}">${escapeHtml(dataset.name)}</a></h3><p>${escapeHtml(dataset.organism)} · ${escapeHtml(dataset.modality)} · ${escapeHtml(dataset.region)}</p><p>${escapeHtml(dataset.contrasts.map((contrast) => contrastLabel(dataset, contrast)).join('; '))}</p><p class="paper">${verified?.source.paperRelationship === 'methods' ? 'Related methods publication: ' : ''}${escapeHtml(verified?.title || dataset.citation)}</p>${datasetPmid(dataset) ? `<p class="mono small">PMID ${escapeHtml(datasetPmid(dataset))}</p>` : ''}</article>`;
  }).join('')}</div></section>`).join('')}` });
}

export function renderAboutPage(): string {
  const person = {
    '@type': 'Person', '@id': `${SITE_URL}/about/#author`, name: AUTHOR_NAME,
    description: AUTHOR_BIO, email: AUTHOR_EMAIL,
    alumniOf: { '@type': 'CollegeOrUniversity', name: 'University of Toronto' },
  };
  return page({ title: `About ${SITE_NAME} | ${AUTHOR_NAME}`, description: `${SITE_NAME} is a hypothalamus transcriptomics explorer by ${AUTHOR_NAME}, who holds a PhD from the University of Toronto.`, path: '/about/', section: 'about', schema: [
    { '@type': 'AboutPage', '@id': `${SITE_URL}/about/#page`, url: `${SITE_URL}/about/`, name: `About ${SITE_NAME}`, description: AUTHOR_BIO, mainEntity: { '@id': person['@id'] },
      contributor: CONTRIBUTOR_NAMES.map((name) => ({ '@type': 'Person', name })) },
    person, breadcrumbs([{ name: 'About', path: '/about/' }]),
  ], body: `<div class="about"><div class="breadcrumbs"><a href="/">Home</a> / About</div><div class="eyebrow">About the project</div><h1>About ${SITE_NAME}</h1>
<p class="intro">${SITE_NAME} lets you inspect gene expression, differential expression and pathway enrichment in public hypothalamus datasets through your browser.</p>
<section class="panel"><h2>The study collection</h2><p>The datasets cover multiple species, brain regions and experimental conditions. Each study page links the comparisons in the app to the original source records.</p><p>Browse the <a href="/studies/">study collection</a> for repository accessions and source publications, or use the <a href="/#/library">dataset library</a> to find data by organism, brain region and assay.</p></section>
<section class="panel"><div class="eyebrow">Author</div><h2 class="author-name">${escapeHtml(AUTHOR_NAME)}</h2><p>${escapeHtml(AUTHOR_BIO)}</p><p>Send questions, corrections or feedback to:</p><p class="contact"><a href="mailto:${escapeHtml(AUTHOR_EMAIL)}">${escapeHtml(AUTHOR_EMAIL)}</a></p></section>
<section class="panel"><div class="eyebrow">Contributors</div><p>${CONTRIBUTOR_NAMES.map(escapeHtml).join(', ')}</p></section>
<section class="panel"><h2>Source code and data</h2><p>The <a href="${SOURCE_REPO_URL}">source code</a> and the <a href="${DATA_REPO_URL}">processed data releases</a> are public on GitHub. When reporting a problem, include the dataset accession, the comparison you were viewing and the steps needed to reproduce it.</p></section>
<section class="panel"><h2>Data sources and attribution</h2><p>The original researchers produced the study data and deposited them in public repositories. ${SITE_NAME} displays selected analyses, with source links and study-specific caveats.</p><p>When using a dataset in research, cite the original publication and repository record, and review the methods for the selected analysis.</p></section></div>` });
}

function readOptionalJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
}

// The study page shows the dataset as the explorer does: read through the
// bundle reader, so reviewed display corrections (the GSE174085 "litter
// pseudobulk" label) apply here exactly as loadDatasetMeta applies them.
function readMeta(dataset: Dataset): DatasetMeta | undefined {
  const opts = { publicRoot: join(ROOT, 'public') };
  if (!existsSync(datasetBundlePaths(dataset, opts).meta.file)) return undefined;
  return readDatasetFromDisk(dataset, opts).meta;
}

function readSourceContext() {
  return {
    sources: readOptionalJson<StudySources>(join(ROOT, 'data/seo/studySources.json'), {}),
    accessions: readOptionalJson<Record<string, { accessions?: string[] }>>(join(ROOT, 'src/data/tracker/explorerAccessions.json'), {}),
  };
}

function studyDetails(dataset: Dataset, context: ReturnType<typeof readSourceContext>, includeMeta = true): StudyDetails {
  return {
    record: studyRecord(dataset, context.sources, includeMeta ? readMeta(dataset) : undefined),
    accessions: context.accessions[dataset.id]?.accessions,
  };
}

function relatedStudies(dataset: Dataset, datasets: Dataset[]): Dataset[] {
  return datasets.filter((entry) => entry.id !== dataset.id && entry.category === dataset.category)
    .sort((a, b) => Number(b.organism === dataset.organism) - Number(a.organism === dataset.organism)).slice(0, 3);
}

function renderSupportingDocument(document: ReturnType<typeof getGuideDocuments>[number]): string {
  const section = document.path.split('/')[1] as 'methods' | 'how-to-cite';
  const name = document.title.split(' | ')[0];
  return page({ ...document, section,
    body: `<div class="breadcrumbs"><a href="/">Home</a> / ${escapeHtml(name)}</div>${document.body}`,
    schema: [...document.schema, breadcrumbs([{ name, path: document.path }])],
  });
}

function sitemap(datasets: Dataset[]): string {
  const paths = ['/', '/studies/', ...datasets.map(studyPath), '/about/', ...getGuideDocuments().map((document) => document.path)];
  // No fabricated lastmod: a build timestamp is not a content-change timestamp.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${escapeHtml(SITE_URL + path)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;

/** Serve the same documents in Vite development without writing build files. */
export function renderSeoRoute(pathname: string): { body: string; contentType: string } | null {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
  if (path === '/robots.txt') return { body: ROBOTS, contentType: 'text/plain; charset=utf-8' };
  if (path === '/sitemap.xml') return { body: sitemap(listDatasets()), contentType: 'application/xml; charset=utf-8' };
  if (path === '/about') return { body: renderAboutPage(), contentType: 'text/html; charset=utf-8' };
  if (/^\/(?:methods|how-to-cite)(?:\/|$)/.test(path)) {
    const document = getGuideDocuments().find((document) => document.path.slice(0, -1) === path);
    return document ? { body: renderSupportingDocument(document), contentType: 'text/html; charset=utf-8' } : null;
  }
  if (path !== '/studies' && !/^\/studies\/[a-z0-9_-]+$/.test(path)) return null;
  const datasets = listDatasets();
  const context = readSourceContext();
  if (path === '/studies') {
    const details = Object.fromEntries(datasets.map((dataset) => [dataset.id, studyDetails(dataset, context, false)]));
    return { body: renderStudiesPage(datasets, details), contentType: 'text/html; charset=utf-8' };
  }
  const dataset = datasets.find((entry) => studyPath(entry).slice(0, -1) === path);
  return dataset ? { body: renderStudyPage(dataset, studyDetails(dataset, context), relatedStudies(dataset, datasets)), contentType: 'text/html; charset=utf-8' } : null;
}

/** Call after Vite has emitted its files. No network access or runtime JS. */
export function generateSeoPages(outDir: string): { studyCount: number; pageCount: number } {
  const datasets = listDatasets();
  if (new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length) throw new Error('Duplicate study ids in the dataset registry');
  const context = readSourceContext();
  const details: Record<string, StudyDetails> = {};
  for (const dataset of datasets) {
    details[dataset.id] = studyDetails(dataset, context);
  }
  const write = (relative: string, contents: string) => {
    const file = join(outDir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, 'utf8');
  };
  write('studies/index.html', renderStudiesPage(datasets, details));
  write('about/index.html', renderAboutPage());
  const documents = getGuideDocuments();
  for (const document of documents) write(`${document.path.slice(1)}index.html`, renderSupportingDocument(document));
  for (const dataset of datasets) {
    write(`${studyPath(dataset).slice(1)}index.html`, renderStudyPage(dataset, details[dataset.id], relatedStudies(dataset, datasets)));
  }
  write('sitemap.xml', sitemap(datasets));
  write('robots.txt', ROBOTS);
  return { studyCount: datasets.length, pageCount: datasets.length + 3 + documents.length };
}
