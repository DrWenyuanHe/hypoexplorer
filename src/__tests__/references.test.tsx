// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ACKNOWLEDGEMENTS, SOFTWARE_REFERENCES } from '../acknowledgements/references';
import { getGuideDocuments } from '../../scripts/lib/seoGuides.mjs';
import { EXPLORER_TABS, isExplorerTab } from '../explorer/explorerTabs';
import { parseRoute } from '../utils/appLinks';

// The explorer's Data Sources tab was retired. It listed every study, which the
// library and /studies/ list, and described the macaque cohort, which its study
// record and the Methods & statistics page describe. Its software and reference
// table and its acknowledgements moved to /how-to-cite/.
describe('software references and acknowledgements', () => {
  it('lists the analysis software and gene-set databases, each with a DOI', () => {
    const names = SOFTWARE_REFERENCES.map((entry) => entry.resource);
    for (const name of ['edgeR', 'fgsea', 'Reactome', 'KEGG', 'GTEx', 'Human Protein Atlas']) expect(names).toContain(name);
    for (const entry of SOFTWARE_REFERENCES) expect(entry.doi).toMatch(/^10\.\d{4,9}\//);
    expect(new Set(names).size).toBe(names.length);
    expect(ACKNOWLEDGEMENTS.join(' ')).toMatch(/Lei et al\./);
  });

  it('publishes them on the static How to cite page with resolvable DOI links', () => {
    const cite = getGuideDocuments().find((guide) => guide.path === '/how-to-cite/')!;
    const page = new DOMParser().parseFromString(cite.body, 'text/html');
    const section = page.getElementById('software-and-acknowledgements')!;
    expect(section.querySelector('h2')?.textContent).toBe('Software, gene sets and reference atlases');
    expect(section.querySelectorAll('li')).toHaveLength(SOFTWARE_REFERENCES.length);
    const edgeR = SOFTWARE_REFERENCES.find((entry) => entry.resource === 'edgeR')!;
    expect(section.querySelector(`a[href="https://doi.org/${edgeR.doi}"]`)?.textContent).toBe(`doi:${edgeR.doi}`);
    expect(section.textContent).toContain('Acknowledgements');
  });
});

describe('retired Data Sources tab', () => {
  it('is no longer an explorer tab', () => {
    expect(EXPLORER_TABS.map(([id]) => id)).not.toContain('datasources');
    expect(isExplorerTab('datasources')).toBe(false);
  });

  it('sends old tab links to the study library record', () => {
    expect(parseRoute('#/dataset/macaque_snrna/e9/datasources')).toEqual({
      view: 'library', datasetId: 'macaque_snrna', categories: null,
    });
  });
});
