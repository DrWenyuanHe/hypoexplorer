// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSeoPages, renderAboutPage, renderSeoRoute, renderStudiesPage, renderStudyPage, studyPath,
} from '../../scripts/lib/seoPages.mjs';
import { listDatasets } from '../data/datasets';
import { AUTHOR_EMAIL, AUTHOR_NAME, BETA_NOTICE, SITE_URL } from '../data/siteInfo';
import type { Dataset, DatasetMeta } from '../types';
import { getGuideDocuments } from '../../scripts/lib/seoGuides.mjs';
import { studyRecord, type StudySource } from '../../scripts/lib/studyRecord.mjs';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const datasets = listDatasets();
const supportDocuments = getGuideDocuments();

describe('crawlable study build', () => {
  let output: string;

  beforeAll(() => {
    output = mkdtempSync(join(tmpdir(), 'hypoexplorer-seo-test-'));
    generateSeoPages(output);
  });
  afterAll(() => rmSync(output, { recursive: true, force: true }));

  it('emits one unique, self-canonical HTML page per registry dataset and links every one from the catalog', () => {
    const catalog = parse(readFileSync(join(output, 'studies/index.html'), 'utf8'));
    const links = new Set(Array.from(catalog.querySelectorAll('a')).map((link) => link.getAttribute('href')));
    const catalogGraph = JSON.parse(catalog.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'];
    const catalogDatasets = catalogGraph.find((node: { '@type': string }) => node['@type'] === 'DataCatalog').dataset;
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    expect(readdirSync(join(output, 'studies')).filter((name) => name !== 'index.html')).toHaveLength(datasets.length);
    for (const dataset of datasets) {
      const document = parse(readFileSync(join(output, 'studies', dataset.id, 'index.html'), 'utf8'));
      expect(document.querySelector('h1')?.textContent, dataset.id).toBe(dataset.name);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(SITE_URL + studyPath(dataset));
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('index,follow');
      expect(document.querySelector('header')?.textContent).toContain(BETA_NOTICE);
      expect(document.querySelector('header .site-brand')?.getAttribute('href')).toBe('/#/');
      expect(document.querySelector('header .site-brand img')?.getAttribute('src')).toBe('/brand/v1/hypoexplorer-logo.png');
      expect(document.querySelector('link[rel="icon"][type="image/png"]')?.getAttribute('href')).toBe('/brand/v1/favicon-32.png');
      expect(document.querySelector(`a[href="/#/dataset/${dataset.id}"]`)).not.toBeNull();
      expect(document.querySelector(`a[href="/#/library/${dataset.id}"]`)).not.toBeNull();
      expect(links.has(studyPath(dataset)), dataset.id).toBe(true);
      expect(catalogDatasets.find((entry: { url: string }) => entry.url === SITE_URL + studyPath(dataset))).toMatchObject({
        sameAs: SITE_URL + studyPath(dataset),
      });
      expect(document.querySelectorAll('script:not([type="application/ld+json"])')).toHaveLength(0);
      const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'];
      expect(graph.find((node: { '@type': string }) => node['@type'] === 'Dataset')).toMatchObject({
        name: dataset.name,
        url: SITE_URL + studyPath(dataset),
        measurementTechnique: dataset.modality,
      });
      titles.add(document.title);
      descriptions.add(document.querySelector('meta[name="description"]')!.getAttribute('content')!);
    }
    expect(titles.size).toBe(datasets.length);
    expect(descriptions.size).toBe(datasets.length);
  });

  it('puts only canonical pages in the sitemap and advertises it in robots.txt', () => {
    const sitemap = readFileSync(join(output, 'sitemap.xml'), 'utf8');
    const document = new DOMParser().parseFromString(sitemap, 'application/xml');
    const locations = Array.from(document.querySelectorAll('loc')).map((node) => node.textContent);
    expect(locations).toEqual([`${SITE_URL}/`, `${SITE_URL}/studies/`, ...datasets.map((dataset) => SITE_URL + studyPath(dataset)), `${SITE_URL}/about/`, ...supportDocuments.map((document) => SITE_URL + document.path)]);
    expect(new Set(locations).size).toBe(datasets.length + 3 + supportDocuments.length);
    expect(document.querySelector('lastmod, priority, changefreq')).toBeNull();
    expect(readFileSync(join(output, 'robots.txt'), 'utf8')).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it('serves every guide with its own canonical, schema and working internal document links', () => {
    const knownPaths = new Set(['/', '/studies/', '/about/', '/CITATION.cff', '/release.json', '/LICENSE', '/REUSE.md', ...datasets.map(studyPath), ...supportDocuments.map((document) => document.path)]);
    for (const expected of supportDocuments) {
      const html = readFileSync(join(output, expected.path.slice(1), 'index.html'), 'utf8');
      const document = parse(html);
      expect(renderSeoRoute(expected.path)?.body).toBe(html);
      expect(renderSeoRoute(`${expected.path}index.html`)?.body).toBe(html);
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(SITE_URL + expected.path);
      expect(document.querySelector('header')?.textContent).toContain(BETA_NOTICE);
      const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'];
      expect(graph.some((node: { '@type': string }) => node['@type'] === 'BreadcrumbList')).toBe(true);
      expect(document.querySelectorAll('script:not([type="application/ld+json"])')).toHaveLength(0);
      for (const link of document.querySelectorAll('a[href^="/"]')) {
        const path = link.getAttribute('href')!.split('#')[0];
        expect(knownPaths.has(path), `${expected.path} links to ${path}`).toBe(true);
      }
    }
  });
});

// Which paper is verified is the study record's decision (studyRecord.test.ts);
// these tests pin how a page lays out a record it is given.
describe('study provenance and safe rendering', () => {
  const withSource = (dataset: Dataset, source: StudySource, meta?: DatasetMeta) => ({ record: studyRecord(dataset, { [dataset.id]: source }, meta) });

  it('escapes source prose in HTML and JSON-LD without turning metadata into executable markup', () => {
    const name = 'Study </script><script>alert("injected")</script> & comparisons';
    const doi = '10.5555/escaping-fixture';
    const dataset = { ...datasets[0], name, citation: '<img src=x onerror=alert(1)>', doi, pmid: undefined };
    const document = parse(renderStudyPage(dataset, withSource(dataset, { paperTitle: name, paperDoi: doi, paperUrl: 'javascript:alert(1)' })));
    expect(document.querySelector('h1')?.textContent).toBe(name);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(document.querySelector('main img, a[href^="javascript:"], img[onerror]')).toBeNull();
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph[0].citation.name).toBe(name);
    expect(graph[0].citation.url ?? '').not.toMatch(/^javascript:/);
  });

  // An unverified snapshot contributes no citation field to the page or the
  // directory card: its title and authors never sit beside another paper's DOI.
  it('renders an unverified snapshot as the registry citation alone, on the page and in the directory', () => {
    const dataset = { ...datasets[0], doi: '10.5555/registry-paper', pmid: '11111111',
      citation: 'Registry citation for the actual paper.' };
    const details = withSource(dataset, {
      paperTitle: 'An unrelated paper that is not this dataset',
      paperAuthors: ['Nobody, A.'], paperJournal: 'Journal of Elsewhere', paperYear: '1999',
      paperPmid: '99999999', paperDoi: '10.5555/some-other-paper',
    });
    const document = parse(renderStudyPage(dataset, details));
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph[0].citation).toBe(dataset.citation);
    for (const text of ['An unrelated paper that is not this dataset', 'Nobody, A.', 'Journal of Elsewhere', 'Source publication', '10.5555/some-other-paper']) {
      expect(document.body.textContent).not.toContain(text);
    }
    const catalog = parse(renderStudiesPage([dataset], { [dataset.id]: details }));
    expect(catalog.body.textContent).not.toContain('An unrelated paper that is not this dataset');
    expect(catalog.body.textContent).toContain(dataset.citation);
  });

  it("lists the depositor's upstream processing in the At a glance facts", () => {
    const dataset = datasets.find((entry) => entry.geo === 'GSE104709')!;
    const document = parse(renderStudyPage(dataset));
    const fact = Array.from(document.querySelectorAll('.facts div'))
      .find((entry) => entry.querySelector('dt')?.textContent === 'Upstream processing');
    expect(fact?.querySelector('dd')?.textContent).toBe('STAR 2.5.1b · mm9 · Ensembl 67 · PORT 0.8.1 (as deposited)');
  });

  it('does not invent paper titles, license, creators or missing source identifiers', () => {
    const dataset = { ...datasets[0], geo: undefined, doi: '', pmid: '', citation: 'A repository study without a linked publication.' };
    const document = parse(renderStudyPage(dataset));
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph[0].citation).toBe(dataset.citation);
    expect(graph[0].identifier).toEqual([dataset.id]);
    expect(graph[0].creator).toBeUndefined();
    expect(graph[0].license).toBeUndefined();
    expect(document.body.textContent).not.toContain('Source publication');
    expect(document.querySelector('a[href*="doi.org"], a[href*="pubmed.ncbi"]')).toBeNull();
  });

  it('pairs verified paper titles with the verified DOI, without calling a paper DOI a dataset identifier', () => {
    const dataset = { ...datasets[0], pmid: '12345678', doi: '10.1000/old-link' };
    const document = parse(renderStudyPage(dataset, withSource(dataset, {
      paperTitle: 'The verified publication', paperPmid: '12345678',
      paperUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', paperDoi: '10.1000/correct-link',
    })));
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph[0].citation.identifier).toBe('https://doi.org/10.1000/correct-link');
    expect(graph[0].identifier).not.toContain('https://doi.org/10.1000/correct-link');
    expect(document.querySelector('a[href="https://doi.org/10.1000/correct-link"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://doi.org/10.1000/old-link"]')).toBeNull();
  });

  it('labels preprints and collective authors without assigning study authorship to the app author', () => {
    const dataset = { ...datasets[0], pmid: '', doi: '', citation: 'Repository record' };
    const document = parse(renderStudyPage(dataset, withSource(dataset, {
      paperTitle: 'A source-linked preprint', paperPmid: '12345678', sourcePubmedIds: ['12345678'],
      paperDoi: '10.1000/source', paperUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
      paperAuthors: ['Study Author', 'Research Consortium'], paperCollectiveAuthors: ['Research Consortium'], paperYear: '2024', paperIsPreprint: true,
      sourceTitle: 'The full source experiment', sourceUrl: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345',
    })));
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph[0].citation).toMatchObject({ identifier: 'https://doi.org/10.1000/source', author: [{ '@type': 'Person', name: 'Study Author' }, { '@type': 'Organization', name: 'Research Consortium' }], datePublished: '2024', creativeWorkStatus: 'Preprint' });
    expect(graph[0].isAccessibleForFree).toBe(true);
    expect(graph[0].creator).toBeUndefined();
    expect(graph[0].isBasedOn.name).toBe('The full source experiment');
    expect(document.querySelector('a[href="https://doi.org/10.1000/source"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Source publication · preprint');
  });

  it('identifies a methods-only publication without claiming it published the selected dataset', () => {
    const study = datasets.find((dataset) => dataset.geo === 'E-MTAB-12340')!;
    const actual = parse(renderSeoRoute(studyPath(study))!.body);
    expect(actual.body.textContent).toContain('Related methods publication');
    expect(actual.body.textContent).toContain('not a publication of the hypothalamus dataset itself');
  });

  it('lays out the record\'s per-track counts under its arm labels and marks unknown counts with a dash', () => {
    const dataset = { ...datasets[0], defaultTrack: 'track', groups: [
      { key: 'p0', label: 'P0', color: '#000' }, { key: 'p21', label: 'P21', color: '#fff' },
    ], contrasts: [{ id: 'age', baseline: 'p0', case: 'p21', isDefault: true }] };
    const meta: DatasetMeta = {
      populations: ['track', 'other'], labels: { track: 'POMC neurons' }, types: {}, colors: {},
      nGenes: { track: 1234 }, groupN: { p0: 4, p21: 5 },
      qcFlags: { track: { nNormal: 8, nObese: 9 }, other: { nNormal: 8, nObese: 9 } },
    };
    const document = parse(renderStudyPage(dataset, withSource(dataset, {}, meta)));
    expect(Array.from(document.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual(['Track', 'Features', 'P0 n', 'P21 n']);
    expect(Array.from(document.querySelectorAll('tbody td')).map((cell) => cell.textContent))
      .toEqual(['POMC neurons', '1,234', '4', '5', 'other', '—', '–', '–']);
    expect(document.querySelector('caption')?.textContent).toContain('A dash marks a track whose count for this comparison is not recorded');
    const malformed = parse(renderStudyPage(dataset, withSource(dataset, {}, { ...meta,
      groupN: { p0: '<img src=x onerror=alert(1)>' as unknown as number, p21: 5 },
    })));
    expect(malformed.querySelector('main img, img[onerror]')).toBeNull();
    expect(malformed.querySelector('tbody')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('uses the supplied author identity and public contact on About, with truthful Person markup', () => {
    const document = parse(renderAboutPage());
    expect(document.body.textContent).toContain(AUTHOR_NAME);
    expect(document.body.textContent).toContain('PhD from the University of Toronto');
    expect(document.querySelector(`a[href="mailto:${AUTHOR_EMAIL}"]`)).not.toBeNull();
    expect(document.querySelector('header')?.textContent).toContain(BETA_NOTICE);
    const graph = JSON.parse(document.querySelector('script')!.textContent!)['@graph'];
    expect(graph.find((node: { '@type': string }) => node['@type'] === 'Person')).toMatchObject({ name: AUTHOR_NAME, email: AUTHOR_EMAIL });
  });

  it('renders the same SEO routes for development and rejects unknown or unsafe routes', () => {
    expect(renderSeoRoute('/about/')?.body).toBe(renderAboutPage());
    expect(renderSeoRoute('/about/index.html')?.body).toBe(renderAboutPage());
    expect(renderSeoRoute(studyPath(datasets[0]))?.body).toContain(datasets[0].name);
    expect(renderSeoRoute('/sitemap.xml')?.contentType).toContain('application/xml');
    expect(renderSeoRoute('/robots.txt')?.contentType).toContain('text/plain');
    expect(renderSeoRoute('/studies/missing-study/')).toBeNull();
    expect(renderSeoRoute('/topics/missing-topic/')).toBeNull();
    expect(renderSeoRoute('/methods/missing/')).toBeNull();
    expect(renderSeoRoute('/how-to-cite/missing/')).toBeNull();
    expect(renderSeoRoute('/studies/../../outside/')).toBeNull();
    expect(renderSeoRoute('/datasets/macaque_snrna/')).toBeNull();
    expect(() => studyPath({ id: '../outside' })).toThrow('Unsafe study id');
  });
});
