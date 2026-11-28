// Reads the generated GTEx, HPA and Allen products (pnpm run build:expression-external) and the Visium ones (build:expression-visium).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  externalGeneResult, loadExternalExpression, loadExternalManifest, loadExternalSources, loadExternalValidation,
} from '../expression-survey/externalReference';
import { resetSourceRequests, sourceJson } from '../expression-survey/sourceJson';
import { externalKey } from '../expression-survey/externalReferenceFormat';
import type { ExternalReferenceManifest } from '../expression-survey/externalReferenceFormat';
import { csvTable } from '../expression-survey/expressionSurvey';

function publicJson(path: string): unknown {
  return JSON.parse(readFileSync(`public${path.split('?')[0]}`, 'utf8'));
}
function localFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => publicJson(url) })));
}
afterEach(() => { resetSourceRequests(); vi.unstubAllGlobals(); });

async function source(id: string) {
  const { sources } = await loadExternalSources();
  const found = sources.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('external reference atlases', () => {
  it('describe GTEx donors without inventing reference eligibility', async () => {
    localFetch();
    const manifest = await loadExternalManifest('gtex');
    const [gtex] = manifest.sources;
    expect(gtex).toMatchObject({ collection: 'external', scope: 'tissue', species: 'Homo sapiens', unit: 'TPM', valueKind: 'samples', sampleCount: 257 });
    expect(gtex.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
    expect(gtex.provider?.attribution).toMatch(/Common Fund/);
    expect(new Set(manifest.samples.map((sample) => sample.metadata.subject)).size).toBe(257);
    expect(manifest.samples.filter((sample) => sample.metadata.sex === 'female')).toHaveLength(64);
  });

  it('matches a mouse symbol to the human gene with two small requests and exact values', async () => {
    localFetch();
    const gtex = await source('gtex-v10-brain-hypothalamus');
    vi.mocked(fetch).mockClear();
    const [pomc, missing] = await loadExternalExpression(gtex, ['Pomc', 'NOT_A_GENE_123']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'POMC', geneId: 'ENSG00000115138', unit: 'TPM' });
    const [donors] = pomc.groups;
    expect(donors.samples).toHaveLength(257);
    expect(donors.samples.find((sample) => sample.id === 'GTEX-111FC-0011-R8b-SM-GI4VS')?.value).toBe(26.1534);
    expect(donors.summary).toBeUndefined();
    expect(missing).toMatchObject({ status: 'not-retained', groups: [] });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('/values/'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/lookup/'))).toHaveLength(2);
  });

  it('reports pseudo-autosomal copies as ambiguous and resolves them by versioned ID', async () => {
    localFetch();
    const gtex = await source('gtex-v10-brain-hypothalamus');
    const [bySymbol, byId] = await loadExternalExpression(gtex, ['PLCXD1', 'ENSG00000182378.15_PAR_Y']);
    expect(bySymbol.status).toBe('ambiguous');
    expect(bySymbol.candidates).toHaveLength(2);
    expect(byId).toMatchObject({ status: 'available', gene: 'PLCXD1' });
    expect(externalKey('ensg00000115138.11')).toBe('ENSG00000115138');
  });

  it('finds a versioned Ensembl ID in a source that stores IDs unversioned', async () => {
    localFetch();
    const subregions = await source('hpa-human-hypothalamic-subregions');
    const [pomc] = await loadExternalExpression(subregions, ['ENSG00000115138.11']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'POMC', geneId: 'ENSG00000115138' });
  });

  it('keeps HPA subregion and cluster values as published summaries', async () => {
    localFetch();
    const subregions = await source('hpa-human-hypothalamic-subregions');
    const [pomc] = await loadExternalExpression(subregions, ['POMC']);
    expect(pomc.groups).toHaveLength(8);
    expect(pomc.groups.every((group) => group.samples.length === 0 && group.mean === null && group.n === 0)).toBe(true);
    expect(pomc.groups.find((group) => group.label === 'arcuate nucleus')?.summary).toBe(68.4);
    const clusters = await source('hpa-human-hypothalamus-snrna-clusters');
    expect(clusters.scope).toBe('population');
    const [oxt] = await loadExternalExpression(clusters, ['OXT']);
    expect(oxt.groups).toHaveLength(26);
    expect(oxt.groups.find((group) => group.key === 'c-1')?.summary).toBe(126.5);
  });

  it('serves mouse and pig hypothalamus per animal under their own identifiers', async () => {
    localFetch();
    const mouse = await source('hpa-mouse-hypothalamus');
    const [pomc, byId] = await loadExternalExpression(mouse, ['Pomc', 'ENSMUSG00000020660']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'Pomc', geneId: 'ENSMUSG00000020660' });
    expect(pomc.groups[0].samples.map((sample) => sample.id)).toEqual(['F 1', 'F 2', 'M 1', 'M 2']);
    expect(pomc.groups[0].samples[0].value).toBe(36.5544);
    expect(byId.groups[0].mean).toBe(pomc.groups[0].mean);
    const pig = await source('hpa-pig-hypothalamus');
    expect(pig.species).toBe('Sus scrofa');
    expect((await loadExternalExpression(pig, ['ENSSSCG00000021155']))[0].gene).toBe('POMC');
  });

  it('accepts only exact-agreement validation reports', async () => {
    localFetch();
    for (const provider of ['gtex', 'hpa', 'allen'] as const) {
      const report = await loadExternalValidation(provider);
      expect(report.exactMatches).toBe(report.comparedValues);
      expect(report.notes.join(' ')).toMatch(/API/);
    }
    resetSourceRequests();
    const tampered = { ...(publicJson('/expression/gtex/validation.json') as object), exactMatches: 1 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, json: async () => (String(url).includes('validation') ? tampered : publicJson(url)) })));
    await expect(loadExternalValidation('gtex')).rejects.toThrow('exact source agreement');
  });

  it('rejects unsafe paths and inconsistent cohorts, and retries failed loads', async () => {
    await expect(sourceJson('gtex', '/expression/gtex/../neuroseq/manifest.json')).rejects.toThrow('asset path');
    const manifest = structuredClone(publicJson('/expression/hpa/manifest.json')) as ExternalReferenceManifest;
    manifest.columns['hpa-mouse-hypothalamus'].pop();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
    await expect(loadExternalManifest('hpa')).rejects.toThrow('cohort metadata');
    resetSourceRequests();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (url: string) => ({ ok: true, json: async () => publicJson(url) }));
    vi.stubGlobal('fetch', fetcher);
    expect((await loadExternalSources()).errors.gtex).toBe('offline');
    expect((await loadExternalSources()).sources).toHaveLength(7);
  });

  it('returns one Allen row per probe with donors as groups and tissue samples as profiles', async () => {
    localFetch();
    const allen = await source('allen-human-hypothalamus-microarray');
    expect(allen).toMatchObject({ featureLevel: 'probe', unit: 'log2 normalized intensity', sampleCount: 102 });
    expect(allen.conditions.map((condition) => condition.sampleCount)).toEqual([9, 22, 17, 20, 16, 18]);
    expect(allen.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
    const results = await loadExternalExpression(allen, ['Pomc']);
    expect(results.map((result) => result.probe).sort()).toEqual(['A_23_P5875', 'CUST_15470_PI416261804', 'CUST_15474_PI416261804']);
    for (const result of results) {
      expect(result).toMatchObject({ status: 'available', gene: 'POMC', query: 'Pomc' });
      expect(result.groups.map((group) => group.n)).toEqual([9, 22, 17, 20, 16, 18]);
    }
    const manifest = await loadExternalManifest('allen');
    expect(new Set(manifest.samples.map((sample) => sample.metadata.donor)).size).toBe(6);
    expect((await loadExternalValidation('allen')).exactMatches).toBe(58692 * 102);
  });

  it('accepts negative values only on a log scale', async () => {
    localFetch();
    const allen = await source('allen-human-hypothalamus-microarray');
    const gtex = await source('gtex-v10-brain-hypothalamus');
    const allenManifest = await loadExternalManifest('allen');
    const gtexManifest = await loadExternalManifest('gtex');
    const entry = (id: string) => ({ source: id, id: 'X', symbol: 'X', ensemblId: '' });
    const negative = (count: number) => Array.from({ length: count }, () => -0.5);
    expect(externalGeneResult(allenManifest, allen, 'X', entry(allen.id), negative(102)).groups[0].mean).toBe(-0.5);
    expect(() => externalGeneResult(gtexManifest, gtex, 'X', entry(gtex.id), negative(257))).toThrow('do not match');
  });
});

// Reads the HYPOMAP Visium products (pnpm run build:expression-visium), built from
// the tracked donor x region extract in data/expression/visium/.
describe('HYPOMAP Visium by region', () => {
  const VISIUM = 'visium-hypomap-regions';

  it('describes regions as groups and donor-region pseudobulks as samples, with public fields only', async () => {
    localFetch();
    const manifest = await loadExternalManifest('visium');
    const [visium] = manifest.sources;
    expect(visium).toMatchObject({
      id: VISIUM, collection: 'external', scope: 'tissue', species: 'Homo sapiens', valueKind: 'samples',
      featureLevel: 'gene', groupKind: 'region', unit: 'FFPE Visium probe-count CPM', sampleCount: 143,
      absentLabel: 'Not measured in this Visium probe panel',
    });
    expect(visium.conditions).toHaveLength(23);
    expect(visium.conditions.every((condition) => !condition.referenceEligible)).toBe(true);
    expect(manifest.samples).toHaveLength(143);
    expect(new Set(manifest.samples.map((sample) => sample.id)).size).toBe(143);
    // Display-local donor labels; no source donor code, sex, age or BMI anywhere in the manifest.
    expect([...new Set(manifest.samples.map((sample) => sample.label))].sort()).toEqual(
      ['Donor 1', 'Donor 2', 'Donor 3', 'Donor 4', 'Donor 5', 'Donor 6', 'Donor 7']);
    for (const sample of manifest.samples) {
      expect(Object.keys(sample.metadata)).toEqual(['donor', 'region', 'spots', 'sections', 'libraryCounts']);
    }
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/"(sex|age|bmi|donorID)"/i);
    // As in HYPOMAP: every spot is kept (no minimum spots or donors), names follow the authors' abbreviation
    // table, no compartments, and only Unassigned is set apart.
    const byKey = new Map(visium.conditions.map((condition) => [condition.key, condition]));
    expect(byKey.get('POA')?.coverage).toEqual({ donors: 4, sections: 4, spots: 793 });
    expect(byKey.get('ARC')?.coverage).toMatchObject({ donors: 7, spots: 3503 });
    expect(byKey.get('POA')?.label).toBe('POA (Preoptic area) · 4 donors, 793 spots');
    expect(byKey.get('LH/RCN')?.label).toMatch(/^LH\/RCN \(Lateral hypothalamus \/ Retrochiasmatic nucleus\)/);
    expect(byKey.get('Ventricular')?.label).toMatch(/^Ventricular \(Ventricular hypothalamus\)/);
    expect(byKey.get('Vascular')?.label).toMatch(/^Vascular · /);
    expect(visium.conditions.filter((condition) => condition.unassigned).map((condition) => condition.key)).toEqual(['Unassigned']);
    expect(text).not.toMatch(/compartment|sparse/);
    for (const condition of visium.conditions) {
      expect(condition.poolWeights).toHaveLength(condition.sampleCount!);
      expect(manifest.columns[VISIUM].filter((column) => column.group === condition.key).map((column) =>
        Number(manifest.samples.find((sample) => sample.id === column.sample)!.metadata.libraryCounts))).toEqual(condition.poolWeights);
    }
    expect(visium.provider).toMatchObject({ license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(visium.provider?.attribution).toMatch(/10\.1038\/s41586-024-08504-8.*10\.17863\/CAM\.111988.*Transformed by HypoExplorer/);
    expect(visium.notes).toMatch(/55 µm/);
  });

  it('matches a mouse symbol to the human gene, keeps measured zeros and reports off-panel genes as not measured', async () => {
    localFetch();
    const visium = await source(VISIUM);
    const [pomc, zero, igf2] = await loadExternalExpression(visium, ['Pomc', 'TSPY1', 'IGF2']);
    expect(pomc).toMatchObject({ status: 'available', gene: 'POMC', geneId: 'POMC', unit: 'FFPE Visium probe-count CPM' });
    const arc = pomc.groups.find((group) => group.key === 'ARC')!;
    expect(arc.n).toBe(7);
    expect(arc.samples.map((sample) => sample.id)).toEqual(['Donor 1', 'Donor 2', 'Donor 3', 'Donor 4', 'Donor 5', 'Donor 6', 'Donor 7']);
    // 2,404 POMC counts over Donor 1's 5,126,481 ARC counts, to six significant digits.
    expect(arc.samples[0].value).toBe(468.938);
    // Pooled over every ARC spot: 134,074 POMC counts over 110,969,984, from the stored six-digit donor values.
    expect(arc.pooled!).toBeCloseTo(1e6 * 134074 / 110969984, 2);
    expect(pomc.groups.reduce((sum, group) => sum + group.samples.length, 0)).toBe(143);
    expect(zero.status).toBe('available');
    expect(zero.groups.every((group) => group.samples.every((sample) => sample.value === 0))).toBe(true);
    expect(igf2).toMatchObject({ status: 'not-retained', groups: [] });
    // Every exported row credits the authors, the dataset, the licence and the transformation.
    const table = csvTable('samples', { sources: [visium], results: [pomc], referenceOnly: false });
    const credit = table[0].indexOf('source_credit');
    expect(table).toHaveLength(144);
    for (const row of table.slice(1)) expect(String(row[credit])).toMatch(/s41586-024-08504-8.*CAM\.111988.*Transformed by HypoExplorer.*creativecommons\.org\/licenses\/by\/4\.0/);
  });

  it('accepts its derived-CPM validation report', async () => {
    localFetch();
    const report = await loadExternalValidation('visium');
    expect(report.comparedValues).toBe(18085 * 143);
    expect(report.exactMatches).toBe(report.comparedValues);
    expect(report.inputs[0]).toMatchObject({ name: 'humanHYPOMAP_spatial.rds', bytes: 2632769082 });
    expect(report.notes.join(' ')).toMatch(/recomputed from its count and library size/);
    const pomc = report.checkpoints.find((point) => point.feature === 'POMC')!;
    expect(pomc.derivedFrom).toEqual({ count: 2404, library: 5126481 });
    expect(Number((1e6 * pomc.derivedFrom!.count / pomc.derivedFrom!.library).toPrecision(6))).toBe(pomc.value);
  });
});
