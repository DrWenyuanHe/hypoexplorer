// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderStudyContext, studySearchDescription, studySearchTitle,
} from '../../scripts/lib/seoStudyContent.mjs';
import editorial from '../../data/seo/studyEditorial.json';
import { getAuthorValidation } from '../data/authorValidation';
import { datasetQuality, QUALITY_STATUS } from '../data/datasetQualityR460';
import { listDatasets } from '../data/datasets';
import { SITE_NAME } from '../data/siteInfo';
import type { Dataset, DatasetMeta } from '../types';

const datasets = listDatasets();
const find = (accession: string): Dataset => datasets.find((dataset) => dataset.geo === accession)!;
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const metaFor = (dataset: Dataset): DatasetMeta => {
  const contents = readFileSync(resolve('public/datasets', dataset.id, 'meta.js'), 'utf8');
  return JSON.parse(contents.slice(contents.indexOf('{'), contents.lastIndexOf('}') + 1));
};

describe('study discovery content', () => {
  it('keeps unique accession-led titles and descriptions across the registry', () => {
    const titles = datasets.map((dataset) => studySearchTitle(dataset));
    const descriptions = datasets.map(studySearchDescription);
    expect(new Set(titles).size).toBe(datasets.length);
    expect(new Set(descriptions).size).toBe(datasets.length);
    for (const dataset of datasets) {
      const title = studySearchTitle(dataset);
      if (dataset.geo) expect(title).toMatch(new RegExp(`^${dataset.geo} \\| `));
      expect(title).toContain(SITE_NAME);
      expect(title).not.toMatch(/[.…]{3}/u);
      expect(title.length).toBeGreaterThan(SITE_NAME.length + 10);
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const oldMedian = median(datasets.map((dataset) => `${dataset.geo || ''} | ${dataset.name} | ${SITE_NAME}`.length));
    expect(median(titles.map((title) => title.length))).toBeLessThan(oldMedian);
  });

  it('preserves the population distinction for studies sharing one accession and the macaque source accession', () => {
    const shared = datasets.filter((dataset) => dataset.geo === 'GSE68177');
    expect(shared).toHaveLength(2);
    expect(shared.map((dataset) => studySearchTitle(dataset)).join(' ')).toMatch(/AGRP/);
    expect(shared.map((dataset) => studySearchTitle(dataset)).join(' ')).toMatch(/POMC/);
    expect(studySearchTitle(datasets[0])).toMatch(/^CNP0003785 \| /);
    expect(studySearchTitle(datasets[0], 'CNP0003785')).toMatch(/^CNP0003785 \| /);
    expect(studySearchDescription(datasets[0])).toContain('CNP0003785');
    expect(studySearchTitle(find('GSE153551'))).toContain('(ob/ob)');
    expect(studySearchTitle({ ...find('GSE153551'), id: 'test_genotype', name: 'Mouse hypothalamus (ob/ob)' })).toContain('(ob/ob)');
  });

  it('distinguishes selected HFD cohorts and sampling duration from the original studies', () => {
    const wt = parse(renderStudyContext(find('GSE220533'), metaFor(find('GSE220533')))).body.textContent!;
    expect(wt).toContain('wild-type chow and high-fat-diet samples');
    expect(wt).toContain('knockout arms');
    expect(wt).toContain('7 Chow samples and 8 HFD samples');
    expect(wt).toContain('log2-normalized');
    expect(wt).not.toContain('Expression values are CPM');
    const duration = parse(renderStudyContext(find('GSE305719'))).body.textContent!;
    expect(duration).toContain('no chow-fed comparison arm');
    expect(duration).toContain('12-week');
    expect(parse(renderStudyContext(find('GSE236077'))).body.textContent).toContain('16 hours');
  });

  it('uses factorial default cell sizes and keeps exploratory axes separate from source-paper maturation', () => {
    const dataset = find('GSE135639');
    const text = parse(renderStudyContext(dataset, metaFor(dataset))).body.textContent!;
    expect(text).toContain('3 Chow · P21 samples and 4 HFD · P21 samples');
    expect(text).not.toContain('8 Chow · P21');
    expect(text).not.toContain('9 HFD · P21');
    expect(text).toContain('2 comparisons are marked exploratory');
    expect(text).toContain('source study emphasizes maturation');
    expect(text).toContain('limma-trend');
    expect(text).toContain("does not reproduce the source study's raw-count edgeR analysis");
  });

  it('describes pooled samples, organoid predictions and spatial-cohort limits without changing their biological unit', () => {
    const treg = parse(renderStudyContext(find('GSE282067'))).body.textContent!;
    expect(treg).toContain('five mice');
    expect(treg).toContain('pooled libraries, not individual mice');
    const organoid = parse(renderStudyContext(find('GSE301692'))).body.textContent!;
    expect(organoid).toContain('day-15 human iPSC-derived hypothalamus-pituitary organoid cultures');
    expect(organoid).toContain("machine-learning predictions of successful or unsuccessful differentiation");
    expect(organoid).toContain('excludes day-9 libraries');
    expect(organoid).toContain('not human hypothalamic tissue');
    const spatial = parse(renderStudyContext(find('GSE270383'))).body.textContent!;
    expect(spatial).toContain('128,405');
    expect(spatial).toContain('98,006');
    expect(spatial).toContain('spatial profiles are not independent animal replicates');
  });

  it('shows the existing scientific verification state instead of inferring verification from audit completion', () => {
    const dataset = find('GSE294478');
    const document = parse(renderStudyContext(dataset));
    const quality = datasetQuality(getAuthorValidation(dataset.id)!);
    expect(document.body.textContent).toContain(`Pipeline QC ${QUALITY_STATUS[quality.pipelineQc.status].suffix}`);
    expect(document.body.textContent).toContain(`Experimental design ${QUALITY_STATUS[quality.experimentalDesign.status].suffix}`);
    expect(document.body.textContent).toContain(`Author concordance ${QUALITY_STATUS[quality.authorConcordance.status].suffix}`);
    expect(document.body.textContent).toContain(quality.authorConcordance.scope);
    expect(document.body.textContent).toContain('P values and FDR cannot be combined');
    expect(document.querySelector('a[href="/methods/"]')).not.toBeNull();
    expect(document.querySelector('a[href="/how-to-cite/"]')).not.toBeNull();
    expect(document.querySelector('h1')).toBeNull();
  });

  it('escapes dataset content and does not invent counts when metadata is unavailable', () => {
    const malicious: Dataset = {
      ...find('GSE220533'), id: 'unregistered_test',
      organism: '<img src=x onerror=alert(1)>',
      modality: '</p><script>alert(1)</script>',
      expressionUnit: 'TPM <svg onload=alert(1)>',
    };
    const document = parse(renderStudyContext(malicious));
    expect(document.querySelector('script,img,svg')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('not been assessed');
    expect(document.body.textContent).not.toContain('samples in this comparison');
    expect(document.body.textContent).not.toContain('explorer includes 0');
  });

  it('keeps authored scientific notes tied to real datasets and reviewable evidence', () => {
    for (const [id, note] of Object.entries(editorial)) {
      expect(datasets.some((dataset) => dataset.id === id), id).toBe(true);
      if ('selectedScope' in note || 'limitations' in note) {
        expect('evidencePaths' in note && note.evidencePaths.length > 0, id).toBe(true);
        if ('evidencePaths' in note) {
          for (const evidence of note.evidencePaths) expect(existsSync(resolve(evidence)), `${id}: ${evidence}`).toBe(true);
        }
      }
    }
  });
});
