// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataExportParagraph, getGuideDocuments } from '../../scripts/lib/seoGuides.mjs';
import * as registry from '../data/datasets';
import { QUALITY_STATUS } from '../data/datasetQualityR460';
import { AUTHOR_EMAIL, AUTHOR_NAME, SITE_URL } from '../data/siteInfo';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
afterEach(() => { vi.restoreAllMocks(); });

describe('public research guides', () => {
  it('exposes stable, distinct document metadata with honest schema and attribution', () => {
    const guides = getGuideDocuments();
    expect(guides.map((guide) => guide.path)).toEqual(['/methods/', '/how-to-cite/']);
    for (const guide of guides) {
      const document = parse(guide.body);
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(document.querySelector('a[href="/about/"]')).not.toBeNull();
      expect(document.querySelector('a[href="/studies/"]')).not.toBeNull();
      expect(document.body.textContent).toContain(AUTHOR_NAME);
      expect(document.querySelector(`a[href="mailto:${AUTHOR_EMAIL}"]`)).not.toBeNull();
      expect(guide.schema[0]).toMatchObject({ url: SITE_URL + guide.path, name: guide.title, description: guide.description });
      expect(JSON.stringify(guide.schema)).not.toMatch(/FAQPage|HowTo|datePublished|dateModified|license|aggregateRating/);
      for (const anchor of document.querySelectorAll('a[href^="#"]')) {
        const id = anchor.getAttribute('href')!.slice(1);
        expect(document.querySelectorAll(`[id="${id}"]`), `Missing or duplicate guide anchor: ${id}`).toHaveLength(1);
      }
    }
    expect(guides[0].schema[0]).toMatchObject({ '@type': 'TechArticle' });
    expect(guides[1].schema[0]).toMatchObject({ '@type': 'WebPage' });
  });

  it('distinguishes source data, replication units, models and pathway interpretation', () => {
    const text = parse(getGuideDocuments()[0].body).body.textContent!;
    expect(text).toContain('Thousands of cells do not become thousands of independent biological replicates');
    expect(text).toContain('positive log2 fold change means higher expression in the case group');
    expect(text).toContain('no single universal fit for every dataset');
    expect(text).toContain('variance-stabilized');
    expect(text).toContain('limma');
    expect(text).toContain('edgeR');
    expect(text).toContain('different from over-representation analysis');
    expect(text).toContain('does not by itself prove pathway activation');
    expect(text).toContain('do not compute a pooled effect or combined p-value');
    expect(text).not.toContain('HypoExplorer does not report them');
  });

  it('uses current verification definitions without upgrading source-only checks', () => {
    const document = parse(getGuideDocuments()[0].body);
    const text = document.body.textContent!;
    for (const state of Object.values(QUALITY_STATUS)) {
      expect(text).toContain(state.label);
    }
    expect(text).toContain('Pipeline QC, experimental design and author concordance are separate badges');
    expect(text).toContain('Missing evidence never earns an individual green check');
    expect(text).toContain('strong matched-gene correlation or same-gene directional agreement');
    expect(text).toContain('macaque single-nucleus atlas is outside the current author-comparison verification scope');
    expect(document.querySelector('a[href="/#/verification"]')).not.toBeNull();
  });

  it('provides real source citations separately from the app reference', () => {
    const document = parse(getGuideDocuments()[1].body);
    const text = document.body.textContent!;
    expect(text).toContain('Todorov PV');
    expect(text).toContain('An RNA-seq atlas of mouse brain areas during fasting and diet-induced obesity');
    expect(text).toContain('GSE236077');
    expect(text).toContain('CNP0003785');
    expect(text).toContain('Lei Y');
    expect(document.querySelector('a[href="https://doi.org/10.1038/s41597-023-02888-4"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://doi.org/10.1016/j.cmet.2024.01.003"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE236077"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://db.cngb.org/search/project/CNP0003785/"]')).not.toBeNull();
    expect(text).toContain('reanalysis does not currently have its own publication citation');
    expect(text).toContain("original code is licensed under MIT");
    expect(text).toContain('original contributions to derived analysis outputs');
    expect(text).toContain('retain their own terms');
    expect(document.querySelector('a[href="https://creativecommons.org/licenses/by/4.0/"]')).not.toBeNull();
    expect(document.querySelector('a[href="/REUSE.md"]')).not.toBeNull();
    expect(document.querySelector('a[href="/release.json"]')).not.toBeNull();
    expect(document.querySelector('a[href="/CITATION.cff"]')).not.toBeNull();
    expect(document.querySelector('.note')?.textContent).toContain('your actual access date');
    expect(document.querySelector('.note')?.textContent).not.toContain('doi.org');
  });

  it('links the full-dataset archive only once a DOI is recorded', () => {
    const methods = parse(getGuideDocuments()[0].body);
    expect(methods.querySelector('#downloads #full-dataset')).not.toBeNull();
    const pending = parse(dataExportParagraph(null));
    expect(pending.body.textContent).toContain('not yet published');
    expect(pending.querySelector('a')).toBeNull();
    const published = parse(dataExportParagraph('10.5281/zenodo.1234567'));
    expect(published.querySelector('a[href="https://doi.org/10.5281/zenodo.1234567"]')).not.toBeNull();
    expect(published.body.textContent).toContain('AGENTS.md');
    expect(published.body.textContent).toContain('LICENSE-DATA.md');
    expect(parse(dataExportParagraph('javascript:alert(1)')).querySelector('a')).toBeNull();
  });

  it('escapes registry prose and rejects an unsafe DOI in a citation example', () => {
    const datasets = registry.listDatasets();
    vi.spyOn(registry, 'listDatasets').mockReturnValue(datasets.map((dataset) => dataset.id === 'mouse_hypo_hfd_gse236077' ? {
      ...dataset, name: '<img src=x onerror=alert(1)>', pmid: 'unmatched',
      citation: '<script>alert(1)</script>', doi: 'javascript:alert(1)',
    } : dataset));
    const document = parse(getGuideDocuments()[1].body);
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
    expect(document.querySelector('img, script, a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href="https://doi.org/10.1038/s41597-023-02888-4"]')).toBeNull();
  });
});
