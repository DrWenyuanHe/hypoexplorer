import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { _resetBundleCache, _setBundleTransport, type BundleTransport } from '../data/bundleSource';
import { loadGeneIndex, loadPathwayIndex } from '../data/crossDataset';
import {
  _resetSearchVocabulary,
  describePathway,
  geneMatchLabel,
  loadSearchVocabulary,
  searchAll,
} from '../search/searchVocabulary';
import { lookupSynonyms, SEARCH_SYNONYMS, synonymKey } from '../search/searchSynonyms';
import type { GeneEntry, SearchVocabulary } from '../search/searchTypes';

// The unified search: one box for genes and pathways.
//
// Most of this file drives searchAll over a small hand-written vocabulary, so a
// ranking change shows up as a readable diff. The loader tests serve names.js
// through the bundle transport and stub the two cross-origin indexes, and the
// last block parses the COMMITTED names.js, so a generator change that drops
// the names the box depends on cannot pass unnoticed.

vi.mock('../data/crossDataset', () => ({
  loadGeneIndex: vi.fn(async () => [] as string[]),
  loadPathwayIndex: vi.fn(async () => [] as string[]),
}));

const gene = (symbol: string, name: string, datasets: number, extra: Partial<GeneEntry> = {}): GeneEntry => ({
  symbol, name, otherNames: [], aliases: [], datasets, ...extra,
});

// Shaped like the real rows (see public/nomenclature/names.js), with the dataset
// counts that make the ranking questions real: Glra1's alias 'ot' is stored in
// more datasets than Oxt, and the gene name 'insulin' belongs to INS alone.
const GENES: GeneEntry[] = [
  gene('OXT', 'oxytocin/neurophysin I prepropeptide', 107, { otherNames: ['oxytocin'], aliases: ['OT', 'Oxy', 'OXT-NPI'] }),
  gene('OXTR', 'oxytocin receptor', 107),
  gene('GLRA1', 'glycine receptor alpha 1', 109, { aliases: ['ot', 'spd'] }),
  gene('INS', 'insulin', 2),
  gene('INS1', 'insulin I', 4, { otherNames: ['insulin 1'] }),
  gene('INS2', 'insulin II', 14, { otherNames: ['insulin 2'], aliases: ['Mody4'] }),
  gene('INSR', 'insulin receptor', 118),
  gene('IGF1R', 'insulin like growth factor 1 receptor', 119),
  gene('IRS1', 'insulin receptor substrate 1', 117),
  gene('HCRT', 'hypocretin neuropeptide precursor', 103, { otherNames: ['hypocretin'], aliases: ['orexin A', 'orexin B'] }),
  gene('HCRTR1', 'hypocretin receptor 1', 104, { otherNames: ['hypocretin (orexin) receptor 1'] }),
  gene('POMC', 'proopiomelanocortin', 112, { otherNames: ['pro-opiomelanocortin-alpha'], aliases: ['ACTH', 'MSH'] }),
  gene('POMP', 'proteasome maturation protein', 119),
  gene('POM121', 'POM121 transmembrane nucleoporin', 119),
  gene('LEP', 'leptin', 10, { aliases: ['ob'] }),
  gene('LEPR', 'leptin receptor', 103),
  gene('IL2', 'interleukin 2', 50),
  gene('IL4', 'interleukin 4', 50),
  gene('IL6', 'interleukin 6', 50),
  gene('IL7', 'interleukin 7', 50),
  gene('IL10', 'interleukin 10', 50),
  gene('IL17A', 'interleukin 17A', 50),
  // Index-only symbols carry no names.
  gene('GM12345', '', 0),
];

const PATHWAYS = [
  'GOBP_INSULIN_SECRETION',
  'GOBP_REGULATION_OF_INSULIN_SECRETION',
  'GOBP_INSULIN_RECEPTOR_SIGNALING_PATHWAY',
  'GOBP_CELLULAR_RESPONSE_TO_INSULIN_STIMULUS',
  'REACTOME_INSULIN_RECEPTOR_SIGNALLING_CASCADE',
  'REACTOME_SIGNALING_BY_INSULIN_RECEPTOR',
  'KEGG_INSULIN_SIGNALING_PATHWAY',
  'HALLMARK_TNFA_SIGNALING_VIA_NFKB',
  'HALLMARK_MTORC1_SIGNALING',
  'HALLMARK_G2M_CHECKPOINT',
  'GOBP_RESPONSE_TO_LEPTIN',
  'REACTOME_DNA_REPLICATION',
];

const VOCAB: SearchVocabulary = { genes: GENES, pathways: PATHWAYS };
const symbols = (r: ReturnType<typeof searchAll>) => r.genes.map((h) => h.entry.symbol);

describe('searchAll — genes', () => {
  it('snaps a gene name to its symbol: oxytocin -> OXT, by name', () => {
    const r = searchAll(VOCAB, 'oxytocin');
    expect(r.best?.kind).toBe('gene');
    const hit = r.best!.kind === 'gene' ? r.best!.hit : null;
    expect(hit?.entry.symbol).toBe('OXT');
    expect(hit?.match).toBe('name');
    // The receptor follows as a name prefix, below the gene itself.
    expect(symbols(r)).toEqual(['OXT', 'OXTR']);
    expect(geneMatchLabel(hit!)).toBe('Gene name “oxytocin”');
  });

  it('matches the segment before a slash and a trailing family numeral', () => {
    // 'oxytocin' is only the slash segment of HGNC's name: drop MGI's name and it still finds OXT.
    const hgncOnly: SearchVocabulary = {
      genes: [gene('OXT', 'oxytocin/neurophysin I prepropeptide', 2)],
      pathways: [],
    };
    expect(searchAll(hgncOnly, 'Oxytocin').genes[0]).toMatchObject({ match: 'name' });
    // 'growth hormone 1' is what a reader calls growth hormone; so is 'somatotropin II'.
    const numbered: SearchVocabulary = {
      genes: [gene('GH1', 'growth hormone 1', 6), gene('SOMX', 'somatotropin-like II', 3), gene('GHR', 'growth hormone receptor', 115)],
      pathways: [],
    };
    expect(searchAll(numbered, 'growth hormone').genes.map((h) => [h.entry.symbol, h.match]))
      .toEqual([['GH1', 'name'], ['GHR', 'name-prefix']]);
    expect(searchAll(numbered, 'somatotropin like').genes[0]).toMatchObject({ match: 'name', matchedText: 'somatotropin-like II' });
  });

  it('does not turn a family into an exact name: interleukin is not IL6', () => {
    const r = searchAll(VOCAB, 'interleukin');
    expect(r.genes.every((h) => h.match === 'name-prefix')).toBe(true);
    expect(r.best).toBeNull();
  });

  it('insulin: the gene is best, all three insulin genes lead, and the pathways are listed', () => {
    const r = searchAll(VOCAB, 'insulin');
    expect(r.best?.kind).toBe('gene');
    expect(symbols(r).slice(0, 3)).toEqual(['INS2', 'INS1', 'INS']);
    expect(r.genes.slice(0, 3).every((h) => h.match === 'synonym')).toBe(true);
    // Then genes whose name starts with insulin, by reach.
    expect(symbols(r).slice(3)).toEqual(['IGF1R', 'INSR', 'IRS1']);
    const ids = r.pathways.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([
      'GOBP_INSULIN_SECRETION', 'KEGG_INSULIN_SIGNALING_PATHWAY',
      'REACTOME_INSULIN_RECEPTOR_SIGNALLING_CASCADE', 'GOBP_CELLULAR_RESPONSE_TO_INSULIN_STIMULUS',
      'GOBP_REGULATION_OF_INSULIN_SECRETION',
    ]));
    // Title prefixes before word matches; KEGG before Reactome before GO BP.
    expect(ids.slice(0, 4)).toEqual([
      'KEGG_INSULIN_SIGNALING_PATHWAY', 'REACTOME_INSULIN_RECEPTOR_SIGNALLING_CASCADE',
      'GOBP_INSULIN_SECRETION', 'GOBP_INSULIN_RECEPTOR_SIGNALING_PATHWAY',
    ]);
  });

  it('resolves a curated common name: orexin -> HCRT', () => {
    const r = searchAll(VOCAB, 'orexin');
    expect(r.best?.kind === 'gene' && r.best.hit.entry.symbol).toBe('HCRT');
    expect(r.genes[0]).toMatchObject({ match: 'synonym', matchedText: 'orexin' });
    expect(geneMatchLabel(r.genes[0])).toBe('Common name “orexin”');
    // The receptor is found through its other name's word.
    expect(r.genes[1]).toMatchObject({ match: 'name-word' });
    expect(r.genes[1].entry.symbol).toBe('HCRTR1');
  });

  it('matches an alias, preferring the one spelled as typed: OT -> OXT', () => {
    const r = searchAll(VOCAB, 'OT');
    expect(r.genes.slice(0, 2).map((h) => [h.entry.symbol, h.match])).toEqual([['OXT', 'alias'], ['GLRA1', 'alias']]);
    expect(r.best?.kind === 'gene' && r.best.hit.entry.symbol).toBe('OXT');
    expect(geneMatchLabel(r.genes[0])).toBe('Alias “OT”');
  });

  it('lists symbol prefixes by reach and is not decisive: POM', () => {
    const r = searchAll(VOCAB, 'POM');
    // POMP and POM121 tie on reach; the shorter symbol goes first.
    expect(symbols(r)).toEqual(['POMP', 'POM121', 'POMC']);
    expect(r.genes.every((h) => h.match === 'symbol-prefix')).toBe(true);
    expect(geneMatchLabel(r.genes[0])).toBe('Symbol starts with “POM”');
    expect(r.best).toBeNull();
  });

  it('an exact symbol outranks everything, case-insensitively and through punctuation', () => {
    expect(searchAll(VOCAB, 'pomc').genes[0]).toMatchObject({ match: 'symbol' });
    expect(searchAll(VOCAB, 'Ins-2').genes[0].entry.symbol).toBe('INS2');
    expect(geneMatchLabel(searchAll(VOCAB, 'LEP').genes[0])).toBe('Symbol');
  });

  it('keeps one hit per gene, under its strongest match', () => {
    const r = searchAll(VOCAB, 'leptin');
    expect(symbols(r)).toEqual(['LEP', 'LEPR']);
    expect(r.genes[0].match).toBe('name');
    expect(geneMatchLabel(r.genes[0])).toBe('Gene name');
    expect(geneMatchLabel(r.genes[1])).toBe('Name starts with “leptin”');
  });

  it('requires every word of a multi-word query to start some name word', () => {
    const r = searchAll(VOCAB, 'receptor insulin');
    expect(symbols(r).sort()).toEqual(['IGF1R', 'INSR', 'IRS1']);
    expect(geneMatchLabel(r.genes[0])).toBe('Name contains “receptor insulin”');
  });

  it('returns nothing for a query under two characters', () => {
    for (const q of ['', ' ', 'o', ' P ']) {
      expect(searchAll(VOCAB, q)).toEqual({ query: q.trim(), genes: [], pathways: [], best: null });
    }
  });

  it('honours the limits', () => {
    const r = searchAll(VOCAB, 'insulin', { geneLimit: 2, pathwayLimit: 1 });
    expect(r.genes).toHaveLength(2);
    expect(r.pathways).toHaveLength(1);
  });
});

describe('searchAll — pathways', () => {
  it('matches every word in any order: insulin signaling', () => {
    const r = searchAll(VOCAB, 'insulin signaling');
    expect(r.genes).toEqual([]);
    expect(r.pathways.map((p) => p.id)).toEqual([
      'KEGG_INSULIN_SIGNALING_PATHWAY',          // title prefix
      'REACTOME_SIGNALING_BY_INSULIN_RECEPTOR',  // every word, either order
      'GOBP_INSULIN_RECEPTOR_SIGNALING_PATHWAY',
    ]);
    expect(r.best).toBeNull();
  });

  it('a pasted gs_name is the best match', () => {
    const r = searchAll(VOCAB, 'GOBP_INSULIN_SECRETION');
    expect(r.best).toMatchObject({ kind: 'pathway', hit: { id: 'GOBP_INSULIN_SECRETION', dbLabel: 'GO BP', title: 'Insulin secretion' } });
    expect(searchAll(VOCAB, 'gobp insulin secretion').best?.kind).toBe('pathway');
  });

  it('a whole title is the best match when no gene is decisive', () => {
    const r = searchAll(VOCAB, 'insulin secretion');
    expect(r.best).toMatchObject({ kind: 'pathway', hit: { id: 'GOBP_INSULIN_SECRETION' } });
    expect(r.pathways[1].id).toBe('GOBP_REGULATION_OF_INSULIN_SECRETION');
  });

  it('matches the collection name as a word: kegg insulin', () => {
    expect(searchAll(VOCAB, 'kegg insulin').pathways.map((p) => p.id)).toEqual(['KEGG_INSULIN_SIGNALING_PATHWAY']);
  });
});

describe('describePathway', () => {
  it('strips the collection prefix and sentence-cases the title', () => {
    expect(describePathway('GOBP_INSULIN_SECRETION')).toEqual({ db: 'GO_BP', dbLabel: 'GO BP', title: 'Insulin secretion' });
    expect(describePathway('KEGG_INSULIN_SIGNALING_PATHWAY')).toEqual({ db: 'KEGG', dbLabel: 'KEGG', title: 'Insulin signaling pathway' });
    expect(describePathway('REACTOME_DNA_REPLICATION')).toEqual({ db: 'REACTOME', dbLabel: 'Reactome', title: 'DNA replication' });
  });

  it('keeps acronyms and gene-like tokens upper case', () => {
    expect(describePathway('HALLMARK_TNFA_SIGNALING_VIA_NFKB')).toEqual({ db: 'HALLMARK', dbLabel: 'Hallmark', title: 'TNFA signaling via NFKB' });
    expect(describePathway('HALLMARK_MTORC1_SIGNALING').title).toBe('MTORC1 signaling');
    expect(describePathway('HALLMARK_G2M_CHECKPOINT').title).toBe('G2M checkpoint');
    expect(describePathway('REACTOME_TRANSLATION_OF_MRNA').title).toBe('Translation of mRNA');
  });

  it('labels an unknown collection Other', () => {
    expect(describePathway('WP_SOMETHING_ODD')).toEqual({ db: 'OTHER', dbLabel: 'Other', title: 'Wp something odd' });
  });
});

describe('searchSynonyms', () => {
  it('matches regardless of case, spacing and punctuation', () => {
    for (const q of ['GLP-1', 'glp1', 'glp 1', 'Glp_1']) {
      expect(lookupSynonyms(q).map((e) => e.symbols[0])).toEqual(['GCG']);
    }
    expect(synonymKey('α-MSH')).toBe(synonymKey('alpha-MSH'));
    expect(lookupSynonyms('α-MSH')[0].symbols).toEqual(['POMC']);
  });

  it('is well formed: upper-case symbols and no duplicate terms', () => {
    const keys = SEARCH_SYNONYMS.map((e) => synonymKey(e.term));
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of SEARCH_SYNONYMS) {
      expect(e.symbols.length).toBeGreaterThan(0);
      for (const s of e.symbols) expect(s).toBe(s.toUpperCase());
    }
  });
});

// ── The loader ──────────────────────────────────────────────────────────────

const NAMES_FIXTURE = {
  v: 1,
  rows: [
    ['HCRT', 'hypocretin neuropeptide precursor', 'hypocretin', 'orexin A|orexin B', 103],
    ['OXT', 'oxytocin/neurophysin I prepropeptide', 'oxytocin', 'OT|Oxy', 107],
  ],
};

function serveNames(value: unknown): BundleTransport {
  return async (url) => (url.includes('/nomenclature/names.js') && value !== undefined
    ? { status: 'ok', value }
    : { status: 'load-failed' });
}

describe('loadSearchVocabulary', () => {
  beforeEach(() => {
    _resetSearchVocabulary();
    _resetBundleCache();
    vi.mocked(loadGeneIndex).mockResolvedValue(['GM12345', 'HCRT', 'OXT', 'POMC']);
    vi.mocked(loadPathwayIndex).mockResolvedValue(['GOBP_INSULIN_SECRETION']);
  });

  afterEach(() => {
    _setBundleTransport(null);
    _resetBundleCache();
    _resetSearchVocabulary();
    vi.mocked(loadGeneIndex).mockReset();
    vi.mocked(loadPathwayIndex).mockReset();
  });

  it('joins the names to every index symbol, once each', async () => {
    _setBundleTransport(serveNames(NAMES_FIXTURE));
    const vocab = await loadSearchVocabulary();
    expect(vocab.genes.map((g) => g.symbol)).toEqual(['HCRT', 'OXT', 'GM12345', 'POMC']);
    expect(vocab.genes[1]).toEqual({
      symbol: 'OXT', name: 'oxytocin/neurophysin I prepropeptide', otherNames: ['oxytocin'], aliases: ['OT', 'Oxy'], datasets: 107,
    });
    expect(vocab.genes[3]).toEqual({ symbol: 'POMC', name: '', otherNames: [], aliases: [], datasets: 0 });
    expect(vocab.pathways).toEqual(['GOBP_INSULIN_SECRETION']);
    // Memoized: a second caller shares the first load.
    expect(await loadSearchVocabulary()).toBe(vocab);
    expect(loadGeneIndex).toHaveBeenCalledTimes(1);
  });

  it('without names.js, symbols are still searchable', async () => {
    _setBundleTransport(serveNames(undefined));
    const vocab = await loadSearchVocabulary();
    expect(vocab.genes.map((g) => g.symbol)).toEqual(['GM12345', 'HCRT', 'OXT', 'POMC']);
    expect(searchAll(vocab, 'POMC').best).toMatchObject({ kind: 'gene', hit: { match: 'symbol' } });
    // The curated dictionary needs only the symbol.
    expect(searchAll(vocab, 'orexin').best).toMatchObject({ kind: 'gene', hit: { entry: { symbol: 'HCRT' } } });
    expect(searchAll(vocab, 'oxytocin').genes).toEqual([]);
  });

  it('treats a names payload of another wire version as absent', async () => {
    _setBundleTransport(serveNames({ ...NAMES_FIXTURE, v: 2 }));
    const vocab = await loadSearchVocabulary();
    expect(vocab.genes.every((g) => g.name === '')).toBe(true);
  });

  it('degrades to the names alone when both indexes fail, and never rejects', async () => {
    _setBundleTransport(serveNames(NAMES_FIXTURE));
    vi.mocked(loadGeneIndex).mockRejectedValue(new Error('offline'));
    vi.mocked(loadPathwayIndex).mockRejectedValue(new Error('offline'));
    const vocab = await loadSearchVocabulary();
    expect(vocab.genes.map((g) => g.symbol)).toEqual(['HCRT', 'OXT']);
    expect(vocab.pathways).toEqual([]);
    expect(searchAll(vocab, 'oxytocin').best).toMatchObject({ kind: 'gene', hit: { entry: { symbol: 'OXT' } } });
  });

  it('does not memoize an all-empty result, so the next call retries', async () => {
    _setBundleTransport(serveNames(undefined));
    vi.mocked(loadGeneIndex).mockResolvedValue([]);
    vi.mocked(loadPathwayIndex).mockResolvedValue([]);
    expect(await loadSearchVocabulary()).toEqual({ genes: [], pathways: [] });
    vi.mocked(loadGeneIndex).mockResolvedValue(['POMC']);
    expect((await loadSearchVocabulary()).genes.map((g) => g.symbol)).toEqual(['POMC']);
  });
});

// ── The committed names.js ──────────────────────────────────────────────────

describe('public/nomenclature/names.js', () => {
  const text = readFileSync(path.resolve('public/nomenclature/names.js'), 'utf8');
  const payload = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as typeof NAMES_FIXTURE;
  const row = (symbol: string) => payload.rows.find((r) => r[0] === symbol);

  it('is a version-1 classic script assigning HX_SEARCH_NAMES', () => {
    expect(text).toMatch(/^\/\/ AUTO-GENERATED by scripts\/build_search_names\.mts/);
    expect(text).toContain('var HX_SEARCH_NAMES = {"v":1,');
    expect(payload.rows.length).toBeGreaterThan(30_000);
  });

  it('carries the names the search depends on', () => {
    const oxt = row('OXT')!;
    expect(oxt[1]).toBe('oxytocin/neurophysin I prepropeptide');
    expect(String(oxt[2]).split('|')).toContain('oxytocin');
    expect(String(oxt[3]).split('|')).toContain('OT');
    expect(row('INS')?.[1]).toBe('insulin');
    expect(row('INS2')?.[1]).toBe('insulin II');
  });

  it('is sorted by symbol with one row per symbol', () => {
    const keys = payload.rows.map((r) => r[0] as string);
    expect(keys).toEqual([...new Set(keys)].sort());
  });

  it('resolves oxytocin and insulin end to end', async () => {
    _resetSearchVocabulary();
    _resetBundleCache();
    vi.mocked(loadGeneIndex).mockResolvedValue([]);
    vi.mocked(loadPathwayIndex).mockResolvedValue(PATHWAYS);
    _setBundleTransport(serveNames(payload));
    try {
      const vocab = await loadSearchVocabulary();
      expect(searchAll(vocab, 'oxytocin').best).toMatchObject({ kind: 'gene', hit: { match: 'name', entry: { symbol: 'OXT' } } });
      expect(searchAll(vocab, 'OT').best).toMatchObject({ kind: 'gene', hit: { match: 'alias', entry: { symbol: 'OXT' } } });
      const insulin = searchAll(vocab, 'insulin');
      expect(insulin.best).toMatchObject({ kind: 'gene', hit: { entry: { symbol: 'INS2' } } });
      expect(insulin.genes.slice(0, 3).map((h) => h.entry.symbol)).toEqual(['INS2', 'INS1', 'INS']);
      expect(insulin.pathways.map((p) => p.id)).toContain('GOBP_INSULIN_SECRETION');
    } finally {
      _setBundleTransport(null);
      _resetBundleCache();
      _resetSearchVocabulary();
    }
  });
});
