// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getTopicDocuments, TOPIC_COLLECTIONS, topicLinksForDataset } from '../../scripts/lib/seoTopics.mjs';
import { listDatasets } from '../data/datasets';
import { AUTHOR_NAME, SITE_URL } from '../data/siteInfo';

const datasets = listDatasets();
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const selectedIds = (slug: string) => TOPIC_COLLECTIONS.find((topic) => topic.slug === slug)!.groups
  .flatMap((group) => group.studies.map((study) => study.id));

describe('curated research guides', () => {
  it('publishes four distinct guides and an index with crawlable links to real studies', () => {
    const documents = getTopicDocuments(datasets);
    expect(documents).toHaveLength(5);
    expect(new Set(documents.map((document) => document.path)).size).toBe(5);
    expect(new Set(documents.map((document) => document.title)).size).toBe(5);
    expect(new Set(documents.map((document) => document.description)).size).toBe(5);
    const index = parse(documents[0].body);
    for (const topic of TOPIC_COLLECTIONS) {
      const path = `/topics/${topic.slug}/`;
      expect(index.querySelector(`a[href="${path}"]`)?.textContent).toBe(topic.title);
      const document = documents.find((entry) => entry.path === path)!;
      const dom = parse(document.body);
      expect(dom.querySelectorAll('h1')).toHaveLength(1);
      expect(dom.querySelector('h1')?.textContent).toBe(topic.title);
      for (const anchor of dom.querySelectorAll('a[href^="#"]')) {
        const id = anchor.getAttribute('href')!.slice(1);
        expect(dom.querySelectorAll(`[id="${id}"]`), `Missing or duplicate topic anchor: ${id}`).toHaveLength(1);
      }
      const expected = selectedIds(topic.slug);
      const linked = [...new Set(Array.from(dom.querySelectorAll('a[href^="/studies/"]'))
        .map((anchor) => anchor.getAttribute('href')).filter((href) => href !== '/studies/'))];
      expect(linked).toEqual(expected.map((id) => `/studies/${id}/`));
      for (const id of expected) {
        expect(datasets.find((dataset) => dataset.id === id), id).toBeDefined();
        expect(topicLinksForDataset(datasets.find((dataset) => dataset.id === id)!)).toContainEqual({ title: topic.title, path });
      }
    }
  });

  it('keeps collection schema aligned with the visible selection and canonical study IDs', () => {
    for (const document of getTopicDocuments(datasets)) {
      const collection = document.schema[0];
      expect(collection).toMatchObject({
        '@type': 'CollectionPage', url: SITE_URL + document.path,
        author: { '@type': 'Person', name: AUTHOR_NAME, url: `${SITE_URL}/about/` },
      });
      const list = document.schema[1] as {
        '@type': string; numberOfItems: number;
        itemListElement: Array<{ position: number; item: { '@id': string; url: string; sameAs?: string; description?: string } }>;
      };
      expect(list['@type']).toBe('ItemList');
      expect(list.numberOfItems).toBe(list.itemListElement.length);
      const dom = parse(document.body);
      expect(dom.body.textContent).toContain(AUTHOR_NAME);
      expect(dom.querySelector('a[href="/about/"]')).not.toBeNull();
      for (const [index, item] of list.itemListElement.entries()) {
        expect(item.position).toBe(index + 1);
        expect(item.item.url.startsWith(`${SITE_URL}/`)).toBe(true);
        expect(item.item['@id']).toBe(item.item.url + (document.path === '/topics/' ? '#collection' : '#dataset'));
        if (document.path !== '/topics/') {
          expect(item.item.sameAs).toBe(item.item.url);
          expect(item.item.description!.length).toBeGreaterThanOrEqual(50);
          expect(item.item.description!.length).toBeLessThanOrEqual(5000);
        }
        expect(dom.querySelector(`a[href="${item.item.url.slice(SITE_URL.length)}"]`)).not.toBeNull();
      }
    }
  });

  it('links related guides only when they share a selected study, without self links', () => {
    const documents = getTopicDocuments(datasets);
    for (const topic of TOPIC_COLLECTIONS) {
      const document = parse(documents.find((entry) => entry.path === `/topics/${topic.slug}/`)!.body);
      const currentIds = new Set(selectedIds(topic.slug));
      for (const candidate of TOPIC_COLLECTIONS) {
        const hasSharedStudy = candidate.slug !== topic.slug
          && selectedIds(candidate.slug).some((id) => currentIds.has(id));
        expect(document.querySelector(`a[href="/topics/${candidate.slug}/"]`) !== null,
          `${topic.slug} → ${candidate.slug}`).toBe(hasSharedStudy);
      }
    }
  });

  it('does not misclassify maturation, fed genotype experiments or cell-targeted bulk assays', () => {
    const aging = selectedIds('hypothalamic-aging');
    expect(aging).not.toContain('rat_son_aging_gse231617'); // 35 to 125 days is maturation, despite the category.
    expect(aging).not.toContain('mouse_hypo_aging_glp1r_gse280382'); // Aged-only drug contrast.
    expect(aging).not.toContain('mouse_arc_neun_development_gse189945');
    const feeding = selectedIds('hypothalamic-fasting-feeding');
    expect(feeding).not.toContain('mouse_hypo_hibernation_gse295250'); // Fed knockout, not fasting.
    expect(feeding).not.toContain('mouse_arc_pomc_drd2_gse210311'); // Cell-subtype comparison.
    expect(selectedIds('hypothalamic-obesity')).not.toContain('mouse_hypo_fasting_gse294478');
    const singleCell = selectedIds('single-cell-hypothalamus');
    for (const id of singleCell) {
      expect(['scRNA-seq', 'snRNA-seq']).toContain(datasets.find((dataset) => dataset.id === id)!.modality);
    }
    expect(singleCell).not.toContain('mouse_hypo_astro_trap_gse214683');
    expect(singleCell).not.toContain('mouse_agrp_fedfast_gse68177');
    expect(singleCell).not.toContain('mouse_hypo_spatial_aging_gse270383');
  });

  it('makes the source-assay versus served-view distinction visible beside the relevant studies', () => {
    const documents = getTopicDocuments(datasets);
    const singleCell = parse(documents.find((document) => document.path === '/topics/single-cell-hypothalamus/')!.body);
    expect(singleCell.body.textContent).toContain('mouse studies listed below are aggregated');
    expect(singleCell.body.textContent).toContain('no public barcode-to-cell-type map');
    expect(singleCell.body.textContent).toContain('The cited source is a preprint');
    expect(singleCell.body.textContent).toContain('60 population tracks');
    const obesity = parse(documents.find((document) => document.path === '/topics/hypothalamic-obesity/')!.body);
    expect(obesity.body.textContent).toContain('has no parallel chow arm');
    const aging = parse(documents.find((document) => document.path === '/topics/hypothalamic-aging/')!.body);
    expect(aging.body.textContent).toContain("not the final paper's revised cohort");
  });

  it('fails on registry drift instead of silently emitting broken membership links', () => {
    expect(() => getTopicDocuments(datasets.filter((dataset) => dataset.id !== 'macaque_snrna')))
      .toThrow('Missing curated study macaque_snrna');
    expect(() => getTopicDocuments([...datasets, datasets[0]]))
      .toThrow('Duplicate dataset id in topic input');
    expect(topicLinksForDataset(datasets.find((dataset) => dataset.id === 'rat_son_aging_gse231617')!)).toEqual([]);
  });

  it('escapes registry text while retaining it in structured data and visible comparison labels', () => {
    const unsafe = '<img src=x onerror=alert(1)> & "source"';
    const edited = datasets.map((dataset) => dataset.id === 'macaque_snrna'
      ? { ...dataset, name: unsafe, geo: unsafe, organism: unsafe, groups: dataset.groups.map((group) => ({ ...group, label: unsafe })) }
      : dataset);
    const document = getTopicDocuments(edited).find((entry) => entry.path === '/topics/single-cell-hypothalamus/')!;
    const dom = parse(document.body);
    expect(dom.querySelector('img, script')).toBeNull();
    expect(dom.querySelector('a[href="/studies/macaque_snrna/"]')?.textContent).toBe(unsafe);
    expect(dom.body.textContent).toContain(`${unsafe} → ${unsafe}`);
    const list = document.schema[1] as { itemListElement: Array<{ item: { name: string } }> };
    expect(list.itemListElement[0].item.name).toBe(unsafe);
  });
});
