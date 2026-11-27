import { describe, expect, it } from 'vitest';
import { EXISTING_EXPRESSION_SOURCES } from '../expression-survey/existingCatalog';
import {
  barGeometry,
  catalogEntries,
  catalogRegions,
  csvTable,
  exportManifestNeeds,
  inReferenceScope,
  panelGroups,
  sampleStatus,
  selectSources,
  surveyExport,
  surveyPanel,
  VALUE_STATUS_LABEL,
} from '../expression-survey/expressionSurvey';
import type { ExportManifests, SourceFilters, TissueKind } from '../expression-survey/expressionSurvey';
import type { ExpressionGeneResult, ExpressionGroupResult, ExpressionSource } from '../types';

const base = EXISTING_EXPRESSION_SOURCES[0];
function src(id: string, over: Partial<ExpressionSource> = {}): ExpressionSource {
  return {
    ...base, id, label: id, populationLabel: id, collection: 'neuroseq', scope: 'population', populationId: id, region: 'ARH',
    assay: 'RNA-seq', notes: '', driverOrMarker: undefined, datasetId: undefined, ...over,
  };
}
function group(key: string, value: number | null, over: Partial<ExpressionGroupResult> = {}): ExpressionGroupResult {
  return { key, label: key, referenceEligible: true, samples: [{ id: `${key}-s`, value }], mean: value, n: value == null ? 0 : 1, totalSamples: 1, ...over };
}
function res(sourceId: string, query: string, groups: ExpressionGroupResult[], over: Partial<ExpressionGeneResult> = {}): ExpressionGeneResult {
  return { sourceId, query, gene: query, geneId: `ID-${query}`, unit: 'TPM', status: 'available', groups, ...over };
}
const ids = (sources: ExpressionSource[]) => sources.map((source) => source.id);

describe('source selection', () => {
  const sources = [
    src('arh-agrp', { populationId: 'agrp', region: 'ARH' }),
    src('pvh', { region: 'PVH' }),
    src('sfo', { region: 'SFO' }),
    src('neuro.SFO_x', { region: 'MnPO' }),
    src('study-agrp', { collection: 'existing', populationId: 'agrp', region: 'ARC' }),
    src('oxt', { collection: 'reference', region: 'SON' }),
    src('hpa-clusters', { collection: 'external', region: 'Hypothalamus' }),
    src('whole', { collection: 'existing', scope: 'tissue', region: 'Whole hypothalamus' }),
    src('hypothalamus', { collection: 'existing', scope: 'tissue', region: 'Hypothalamus' }),
    src('arc-tissue', { collection: 'existing', scope: 'tissue', region: 'Arcuate nucleus' }),
    src('arh-tissue', { collection: 'existing', scope: 'tissue', region: 'MBH (ARH)' }),
    src('pvn-tissue', { collection: 'existing', scope: 'tissue', region: 'PVN' }),
    src('sorted', { collection: 'existing', scope: 'isolated-neurons', region: 'Hypothalamus' }),
    src('gtex-hyp', { collection: 'external', scope: 'tissue', region: 'Hypothalamus' }),
  ];
  const filters: SourceFilters = { mode: 'populations', collection: 'neuroseq', region: 'all', includeSfo: false, selectedIds: null, tissueKind: 'whole' };

  it.each<[string, Partial<SourceFilters>, string[], string[]]>([
    ['NeuroSeq leaves SFO boundary records out by default', {}, ['arh-agrp', 'pvh'], ['ARH', 'PVH']],
    ['SFO boundary records are included on request', { includeSfo: true }, ['arh-agrp', 'pvh', 'sfo', 'neuro.SFO_x'], ['ARH', 'MnPO', 'PVH', 'SFO']],
    ['AgRP spans collections by population id', { collection: 'agrp' }, ['arh-agrp', 'study-agrp'], ['ARC', 'ARH']],
    ['all population sources, never tissue', { collection: 'all' }, ['arh-agrp', 'pvh', 'study-agrp', 'oxt', 'hpa-clusters'], ['ARC', 'ARH', 'Hypothalamus', 'PVH', 'SON']],
    ['one collection', { collection: 'reference' }, ['oxt'], ['SON']],
    ['the region narrows choices, not the regions offered', { region: 'PVH' }, ['pvh'], ['ARH', 'PVH']],
  ])('%s', (_name, over, choices, regions) => {
    const selection = selectSources(sources, { ...filters, ...over });
    expect(ids(selection.choices)).toEqual(choices);
    expect(ids(selection.selected)).toEqual(choices);
    expect(selection.regions).toEqual(regions);
  });

  it.each<[readonly string[] | null, string[]]>([
    [null, ['arh-agrp', 'pvh']],
    [[], []],
    [['pvh', 'not-a-choice'], ['pvh']],
  ])('picked populations %j select %j', (selectedIds, selected) => {
    expect(ids(selectSources(sources, { ...filters, selectedIds }).selected)).toEqual(selected);
  });

  it.each<[TissueKind, string[]]>([
    ['whole', ['whole', 'hypothalamus', 'gtex-hyp']],
    ['arc', ['arc-tissue', 'arh-tissue']],
    ['isolated', ['sorted']],
    ['external', ['gtex-hyp']],
    ['all', ['whole', 'hypothalamus', 'arc-tissue', 'arh-tissue', 'pvn-tissue', 'sorted', 'gtex-hyp']],
  ])('the tissue tab selects %s preparations', (tissueKind, selected) => {
    // The population picker is irrelevant on the tissue tab.
    expect(ids(selectSources(sources, { ...filters, mode: 'tissue', tissueKind, selectedIds: [] }).selected)).toEqual(selected);
  });

  it('filters the catalog by collection, region and case-insensitive text over every descriptive field', () => {
    const catalog = [src('a', { driverOrMarker: 'Npy-hrGFP', region: 'ARH' }), src('b', { region: 'PVH', notes: 'AVP neurons' }), ...sources.slice(7)];
    const entries = (over: Partial<{ collection: string; region: string; query: string }>) =>
      ids(catalogEntries(catalog, { collection: 'all', region: 'all', query: '', ...over }));
    expect(entries({})).toEqual(['a', 'b']);
    expect(entries({ query: 'npy-HRGFP' })).toEqual(['a']);
    expect(entries({ query: 'avp' })).toEqual(['b']);
    expect(entries({ region: 'PVH' })).toEqual(['b']);
    expect(entries({ collection: 'existing' })).toEqual([]);
    expect(catalogRegions(catalog)).toEqual(['ARH', 'PVH']);
  });

  it('groups NeuroSeq populations into one panel and gives every other source its own', () => {
    expect(panelGroups(sources.slice(0, 6)).map(([key, members]) => [key, ids(members)])).toEqual([
      ['neuroseq', ['arh-agrp', 'pvh', 'sfo', 'neuro.SFO_x']],
      ['study-agrp', ['study-agrp']],
      ['oxt', ['oxt']],
    ]);
  });
});

describe('reference eligibility and value status', () => {
  it.each<[object, boolean, boolean]>([
    [{ referenceEligible: true }, true, true],
    [{ referenceEligible: false }, true, false],
    [{}, true, false],
    [{ referenceEligible: false }, false, true],
    [{}, false, true],
  ])('%j under referenceOnly=%s is shown: %s', (item, referenceOnly, shown) => {
    expect(inReferenceScope(item, referenceOnly)).toBe(shown);
  });

  it.each<[number | null, string, string]>([
    [null, 'missing', 'Missing value'],
    [0, 'measured-zero', 'Measured zero'],
    [-1.5, 'measured', 'Measured'],
    [12, 'measured', 'Measured'],
  ])('a stored %s is %s ("%s")', (value, code, label) => {
    const status = sampleStatus(value);
    expect(status).toBe(code);
    expect(VALUE_STATUS_LABEL[status]).toBe(label);
  });
});

describe('result panel', () => {
  const neuro = [src('a'), src('b')];
  const options = { referenceOnly: false, matrix: false };

  it('ranks the first gene\'s cohorts by value, missing last, and ignores other genes and other panels', () => {
    const results = [
      res('a', 'Agrp', [group('fed', 3), group('fasted', 30, { referenceEligible: false }), group('none', null)]),
      res('b', 'Agrp', [group('fed', 10)]),
      res('b', 'Npy', [group('fed', 999)]),
      res('elsewhere', 'Agrp', [group('fed', 500)]),
    ];
    const panel = surveyPanel(neuro, results, ['Agrp', 'Npy'], options);
    expect(panel.rows.map((row) => `${row.source.id}:${row.group.key}`)).toEqual(['a:fasted', 'b:fed', 'a:fed', 'a:none']);
    expect(panel.axis).toEqual({ minimum: 0, maximum: 30, range: 30 });
    expect(panel.results).toHaveLength(3);
    const eligible = surveyPanel(neuro, results, ['Agrp'], { ...options, referenceOnly: true });
    expect(eligible.rows.map((row) => `${row.source.id}:${row.group.key}`)).toEqual(['b:fed', 'a:fed', 'a:none']);
  });

  it.each<[string, Array<number | null>, { minimum: number; maximum: number; range: number }]>([
    ['positive values start at zero', [2, 8], { minimum: 0, maximum: 8, range: 8 }],
    ['negative log values extend below zero', [-3, 1], { minimum: -3, maximum: 1, range: 4 }],
    ['all-zero or missing values keep a unit range', [0, null], { minimum: 0, maximum: 0, range: 1 }],
  ])('axis: %s', (_name, values, axis) => {
    const results = [res('a', 'Agrp', values.map((value, index) => group(`g${index}`, value)))];
    expect(surveyPanel(neuro, results, ['Agrp'], options).axis).toEqual(axis);
  });

  it('places bars on the axis, negative values to the left of zero', () => {
    const axis = { minimum: -2, maximum: 6, range: 8 };
    expect(barGeometry(4, axis)).toEqual({ zero: 25, left: 25, width: 50 });
    expect(barGeometry(-2, axis)).toEqual({ zero: 25, left: 0, width: 25 });
    expect(barGeometry(null, axis)).toEqual({ zero: 25, left: 25, width: 0 });
  });

  it('uses a published summary as stated, never the empty mean', () => {
    const atlas = src('hpa', { collection: 'external', valueKind: 'summary' });
    const results = [res('hpa', 'Pomc', [
      group('c-1', null, { samples: [], n: 0, totalSamples: 0, summary: 4.1 }),
      group('c-2', null, { samples: [], n: 0, totalSamples: 0, summary: 27.4 }),
    ])];
    const panel = surveyPanel([atlas], results, ['Pomc'], { ...options, matrix: true });
    expect(panel.rows.map((row) => row.group.key)).toEqual(['c-2', 'c-1']);
    expect(panel.matrix.map((row) => row.cells[0])).toEqual([
      { gene: 'Pomc', text: '4.1', title: 'Published value · TPM' },
      { gene: 'Pomc', text: '27.4', title: 'Published value · TPM' },
    ]);
  });

  describe('probe-level sources', () => {
    const array = [src('allen', { collection: 'external', featureLevel: 'probe' })];
    const probe = (query: string, id: string, value: number) =>
      res('allen', query, [group('donor', value)], { gene: 'POMC', geneId: id, probe: id });

    it('keeps one ranked row per probe and splits matrix cells by probe', () => {
      const panel = surveyPanel(array, [probe('Pomc', 'A_1', 9.5), probe('Pomc', 'C_2', 4.25)], ['Pomc'], { ...options, matrix: true });
      expect(panel.rows.map((row) => row.result.probe)).toEqual(['A_1', 'C_2']);
      expect(panel.matrix).toHaveLength(1);
      expect(panel.matrix[0].cells).toEqual([
        { gene: 'Pomc', text: '9.5 · 4.25', title: 'Probes A_1, C_2 · 1 measured samples · TPM' },
      ]);
    });

    it.each<[string, ExpressionGeneResult[], string | null]>([
      ['several probes', [probe('Pomc', 'A_1', 1), probe('Pomc', 'C_2', 2)], 'Pomc → POMC (2 probes A_1, C_2)'],
      ['one probe', [probe('Pomc', 'A_1', 1)], 'Pomc → POMC (probe A_1)'],
      ['a gene-level match names the gene id', [res('allen', 'Pomc', [group('d', 1)], { gene: 'POMC', geneId: 'ENSG1' })], 'Pomc → POMC (ENSG1)'],
      ['several queries', [probe('Pomc', 'A_1', 1), res('allen', 'Npy', [group('d', 1)], { gene: 'NPY', geneId: 'ENSG2' })], 'Pomc → POMC (probe A_1) · Npy → NPY (ENSG2)'],
      ['an exact match says nothing', [res('allen', 'POMC', [group('d', 1)])], null],
      ['an unavailable result says nothing', [res('allen', 'Pomc', [], { gene: 'POMC', status: 'ambiguous' })], null],
    ])('matched note: %s', (_name, results, note) => {
      expect(surveyPanel(array, results, ['Pomc'], options).matched).toBe(note);
    });
  });

  it('labels matrix cells that have no value', () => {
    const results = [
      res('a', 'Agrp', [group('fed', 0), group('fasted', 2, { referenceEligible: false })]),
      res('a', 'Npy', [], { status: 'not-retained' }),
      res('a', 'Pomc', [], { status: 'ambiguous', candidates: ['Pomc1', 'Pomc2'] }),
    ];
    const panel = surveyPanel([src('a')], results, ['Agrp', 'Npy', 'Pomc', 'Lepr'], { referenceOnly: true, matrix: true });
    expect(panel.matrix.map((row) => row.group.key)).toEqual(['fed']);
    expect(panel.matrix[0].cells).toEqual([
      { gene: 'Agrp', text: '0', title: '1 measured samples · TPM' },
      { gene: 'Npy', text: '—', title: 'Not retained in this source' },
      { gene: 'Pomc', text: '—', title: 'Ambiguous identifier: Pomc1, Pomc2' },
      { gene: 'Lepr', text: '—', title: 'Unavailable' },
    ]);
    expect(panel.unavailable.map((result) => result.query)).toEqual(['Npy', 'Pomc']);
  });

  it.each<[string, ExpressionGeneResult[], { referenceOnly: boolean; matrix: boolean }, string | null]>([
    ['values are shown', [res('a', 'Agrp', [group('fed', 1)])], { referenceOnly: false, matrix: false }, null],
    ['the filter removed every cohort', [res('a', 'Agrp', [group('fasted', 1, { referenceEligible: false })])], { referenceOnly: true, matrix: false },
      'No explicitly eligible reference cohort in this selection. Use all reported states to inspect the source.'],
    ['nothing was measured', [res('a', 'Agrp', [], { status: 'not-retained' })], { referenceOnly: true, matrix: false },
      'No expression value is available for this selection.'],
    ['only the second gene has values, in the matrix', [res('a', 'Agrp', [], { status: 'not-retained' }), res('a', 'Npy', [group('fed', 1)])],
      { referenceOnly: false, matrix: true }, null],
  ])('empty state when %s', (_name, results, opts, empty) => {
    expect(surveyPanel([src('a')], results, ['Agrp', 'Npy'], opts).empty).toBe(empty);
  });
});

describe('exports', () => {
  const sources = [src('a', { sourceUrl: 'https://example.org/a', populationLabel: '=Pop' })];
  const results = [
    res('a', 'Agrp', [
      group('fed', 0, { samples: [{ id: 'l1', value: 0 }, { id: 'l2', value: null }, { id: 'l3', value: -1.5 }], mean: -0.75, n: 2, totalSamples: 3 }),
      group('fasted', 9, { referenceEligible: false }),
      group('summary', null, { samples: [], n: 0, totalSamples: 0, summary: 4 }),
      group('summary-missing', null, { samples: [], n: 0, totalSamples: 0, summary: null }),
    ]),
    res('a', 'Npy', [], { status: 'ambiguous', gene: undefined, geneId: undefined, candidates: ['Npy1', 'Npy2'] }),
    res('elsewhere', 'Agrp', [group('fed', 1)]),
  ];
  const base = ['source_id', 'source_url', 'source_credit', 'population', 'species', 'region', 'assay', 'rna_fraction', 'query', 'gene', 'gene_id',
    'probe', 'identifier_candidates', 'gene_status', 'cohort_key', 'cohort', 'reference_eligible', 'unit'];
  const cohort = (key: string, eligible = true) => [key, key, eligible, 'TPM'];
  const lead = (query: string, gene?: string, geneId?: string, status = 'available', candidates?: string) =>
    ['a', 'https://example.org/a', sources[0].citation, '=Pop', sources[0].species, 'ARH', sources[0].assay, sources[0].rnaFraction, query, gene, geneId, undefined, candidates, status];

  it('writes one row per sample with its value status, and published summaries as stated', () => {
    const table = csvTable('samples', { sources, results, referenceOnly: false });
    expect(table[0]).toEqual([...base, 'sample_id', 'value', 'value_status']);
    expect(table.slice(1)).toEqual([
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('fed'), 'l1', 0, 'measured-zero'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('fed'), 'l2', null, 'missing'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('fed'), 'l3', -1.5, 'measured'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('fasted', false), 'fasted-s', 9, 'measured'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('summary'), '', 4, 'published-summary'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('summary-missing'), '', null, 'missing'],
      [...lead('Npy', undefined, undefined, 'ambiguous', 'Npy1; Npy2'), '', '', '', 'TPM', '', '', ''],
    ]);
    expect(table.every((row) => row.length === table[0].length)).toBe(true);
  });

  it('writes one row per cohort with its mean, and drops ineligible cohorts under the reference filter', () => {
    const table = csvTable('summary', { sources, results, referenceOnly: true });
    expect(table[0]).toEqual([...base, 'mean_stored_value', 'measured_samples', 'total_samples', 'value_kind']);
    expect(table.slice(1)).toEqual([
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('fed'), -0.75, 2, 3, 'mean'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('summary'), 4, '', '', 'published-summary'],
      [...lead('Agrp', 'Agrp', 'ID-Agrp'), ...cohort('summary-missing'), null, '', '', 'published-summary'],
      [...lead('Npy', undefined, undefined, 'ambiguous', 'Npy1; Npy2'), '', '', '', 'TPM', '', '', '', ''],
    ]);
    expect(table.every((row) => row.length === table[0].length)).toBe(true);
  });

  it('quotes every CSV cell, keeps formula-like text literal and numbers numeric, and names the file', () => {
    const file = surveyExport('samples', { sources, results: [results[0]], genes: ['Agrp', 'Npy'], referenceOnly: true, exportedAt: 'now' });
    expect(file.filename).toBe('expression_Agrp-Npy_samples.csv');
    expect(file.type).toBe('text/csv;charset=utf-8');
    const lines = file.content.split('\r\n');
    expect(lines[0].startsWith('"source_id","source_url","source_credit","population"')).toBe(true);
    expect(lines[1]).toContain(`"'=Pop"`);
    expect(lines[3]).toContain('"l3","-1.5","measured"');
    expect(lines[2]).toContain('"l2","","missing"');
    expect(lines).toHaveLength(6);
  });

  it('reads only the manifests a metadata export needs', () => {
    expect(exportManifestNeeds([src('n'), src('gtex-x', { collection: 'external' }), src('hpa-y', { collection: 'external' }), src('gtex-z', { collection: 'external' })]))
      .toEqual({ neuroseq: true, reference: false, providers: ['gtex', 'hpa'] });
    expect(exportManifestNeeds([src('o', { collection: 'reference' })])).toEqual({ neuroseq: false, reference: true, providers: [] });
  });

  it('writes values with the selected sources\' sample metadata, in a stable key order', () => {
    const selected = [src('n'), src('o', { collection: 'reference' }), src('hpa-x', { collection: 'external' })];
    const manifests = {
      neuroseq: { samples: [{ id: 'n1', populationId: 'n', referenceEligible: true }, { id: 'n2', populationId: 'n', referenceEligible: false }, { id: 'n3', populationId: 'other', referenceEligible: true }] },
      reference: { samples: [{ id: 'o1', sourceId: 'o', referenceEligible: false }, { id: 'o2', sourceId: 'o', referenceEligible: true }] },
      external: [{ samples: [{ id: 'h1', sourceId: 'hpa-x' }, { id: 'h2', sourceId: 'hpa-other' }] }],
    } as unknown as ExportManifests;
    const values = [res('n', 'Agrp', [group('fed', 1), group('fasted', 2, { referenceEligible: false })])];
    const parse = (referenceOnly: boolean) => {
      const file = surveyExport('metadata', { sources: selected, results: values, genes: ['Agrp'], referenceOnly, exportedAt: '2026-11-15T00:00:00.000Z', manifests });
      expect(file.filename).toBe('expression_Agrp_metadata.json');
      expect(file.type).toBe('application/json');
      return JSON.parse(file.content);
    };
    const all = parse(false);
    expect(Object.keys(all)).toEqual(['exportedAt', 'genes', 'referenceOnly', 'summary', 'sources', 'sampleMetadata', 'results']);
    expect(all.exportedAt).toBe('2026-11-15T00:00:00.000Z');
    expect(all.sampleMetadata.map((sample: { id: string }) => sample.id)).toEqual(['n1', 'n2', 'o1', 'o2', 'h1']);
    expect(all.results[0].groups).toHaveLength(2);
    const eligible = parse(true);
    expect(eligible.sampleMetadata.map((sample: { id: string }) => sample.id)).toEqual(['n1', 'o2']);
    expect(eligible.results[0].groups.map((g: { key: string }) => g.key)).toEqual(['fed']);
  });
});

it('labels the first bundled study source in TMM-normalized CPM', () => {
  // Count studies store TMM-normalized CPM since the R 4.6.0 regeneration (rule C2,
  // data/quality/regeneration-r460-2026-09-25/README.md); bars carry the source unit.
  expect(EXISTING_EXPRESSION_SOURCES[0].unit).toBe('CPM (TMM-normalized)');
});

describe('existing catalog', () => {
  it('catalogs the GSE162563 GnRH-depleted supernatant as tissue, not as a GnRH population', () => {
    const source = EXISTING_EXPRESSION_SOURCES.find((entry) => entry.id === 'mouse_gnrh_androgen_gse162563:poa')!;
    expect(source).toMatchObject({ scope: 'tissue', populationId: 'poa-tissue', sampleCount: 11 });
    expect(source.driverOrMarker).toBeUndefined();
    expect(source.rnaFraction).not.toMatch(/ribosome/i);
    const all = { collection: 'all', region: 'all', includeSfo: true, selectedIds: null, tissueKind: 'all' } as const;
    const ids = (mode: 'populations' | 'tissue') => selectSources(EXISTING_EXPRESSION_SOURCES, { ...all, mode }).selected.map((entry) => entry.id);
    expect(ids('populations')).not.toContain(source.id);
    expect(ids('tissue')).toContain(source.id);
  });
});
