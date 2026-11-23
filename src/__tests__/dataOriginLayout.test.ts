import { describe, expect, it } from 'vitest';
import { hypomapFileAllowed } from '../../scripts/lib/hypomapAtlas.mjs';
import {
  BUNDLE_EXTENSIONS, BUNDLE_TREES, expressionManifestKey, generationPrefixes, HYPOMAP_FIXED_FILES, HYPOMAP_KEY_PREFIX,
  HYPOMAP_TAG, inGeneration, isBuildId, isPointerKey, isPointerRequest, originObject, parseBuildId, parsePointer,
  POINTER_MAX_AGE_SECONDS, POINTER_NAMES, POINTERS, uploadDecision, verifyExpressionManifest, type OriginObject,
  type QueryGeneration,
} from '../data/dataOriginLayout';
import { expressionIndexGlobal } from '../expression-survey/expressionIndexFormat';

const TRACKS = '98dhrb1c2an0x';
const EXPRESSION = '468473da6fb9d9b6b4368fd049c6ce158f58a8ed737f07b15017bbcf4235370d';
const ATLAS = HYPOMAP_KEY_PREFIX;
const POINTER = 'public, max-age=300';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const JS = 'application/javascript; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const BINARY = 'application/octet-stream';

type Row = Omit<OriginObject, 'key' | 'compressible'>;
const bundle = (tree: OriginObject['tree'], purgePrefix: string, contentType = JS): Row =>
  ({ tree, mutable: false, cacheControl: IMMUTABLE, contentType, purgePrefix, wafAllowed: true });
const refused = (tree: OriginObject['tree'], purgePrefix: string, contentType = BINARY): Row =>
  ({ tree, mutable: false, cacheControl: IMMUTABLE, contentType, purgePrefix, wafAllowed: false });

describe('originObject: one answer per key', () => {
  it.each<[string, Row]>([
    // The two pointers: the only mutable objects, purged by exact key.
    ['query/tracks.js', { tree: 'query', mutable: true, cacheControl: POINTER, contentType: JS, purgePrefix: 'query/tracks.js', wafAllowed: true }],
    ['query/expression-manifest.js', { tree: 'query', mutable: true, cacheControl: POINTER, contentType: JS, purgePrefix: 'query/expression-manifest.js', wafAllowed: true }],
    // A request path names the same object.
    ['/query/tracks.js', { tree: 'query', mutable: true, cacheControl: POINTER, contentType: JS, purgePrefix: 'query/tracks.js', wafAllowed: true }],
    // Generations: one purge prefix per build.
    [`query/${TRACKS}/genes/g042.js`, bundle('query', `query/${TRACKS}/`)],
    [`query/${TRACKS}/cards/mouse_gse254155.js`, bundle('query', `query/${TRACKS}/`)],
    [`query/expression/${EXPRESSION}/manifest.js`, bundle('query', `query/expression/${EXPRESSION}/`)],
    [`query/expression/${EXPRESSION}/shards/e042.js`, bundle('query', `query/expression/${EXPRESSION}/`)],
    // Dataset bundles: one purge prefix per dataset, nested files included.
    ['datasets/macaque_snrna/meta.js', bundle('datasets', 'datasets/macaque_snrna/')],
    ['datasets/cattle_arc_nutrition_gse153498/track_arcuate.pathways.js', bundle('datasets', 'datasets/cattle_arc_nutrition_gse153498/')],
    ['datasets/macaque_snrna/sub/track.js', bundle('datasets', 'datasets/macaque_snrna/')],
    // QC PDFs: one pool.
    ['qc/Ast1__Astrocyte_1.pdf', bundle('qc', 'qc/', 'application/pdf')],
    // The pinned atlas: one purge prefix for the release; gzip stored as-is.
    [`${ATLAS}manifest.json`, bundle('hypomap', ATLAS, JSON_TYPE)],
    [`${ATLAS}metadata.json.gz`, bundle('hypomap', ATLAS, 'application/gzip')],
    [`${ATLAS}genes-0123.json.gz`, bundle('hypomap', ATLAS, 'application/gzip')],
    // The edge cannot test shard digits (no regex on Free): admitted, then a 404.
    [`${ATLAS}genes-abcd.json.gz`, bundle('hypomap', ATLAS, 'application/gzip')],
    // Inside a tree but refused by the path rule: wrong extension, wrong atlas
    // file or tag, traversal, doubled slash, over-long.
    ['datasets/x/meta.json', refused('datasets', 'datasets/x/', JSON_TYPE)],
    ['datasets/x/notes.txt', refused('datasets', 'datasets/x/')],
    ['datasets/x/table.csv', refused('datasets', 'datasets/x/')],
    ['datasets/x/bundle.js.map', refused('datasets', 'datasets/x/')],
    ['query/x.json.gz', refused('query', 'query/x.json.gz', 'application/gzip')],
    ['datasets/../x.js', refused('datasets', 'datasets/../', JS)],
    ['datasets//x.js', refused('datasets', 'datasets//', JS)],
    [`datasets/${'a'.repeat(250)}.js`, refused('datasets', `datasets/${'a'.repeat(250)}.js`, JS)],
    [`${ATLAS}manifest.js`, refused('hypomap', ATLAS, JS)],
    [`${ATLAS}metadata.json`, refused('hypomap', ATLAS, JSON_TYPE)],
    [`${ATLAS}genes-000.json.gz`, refused('hypomap', ATLAS, 'application/gzip')],
    [`${ATLAS}genes-00000.json.gz`, refused('hypomap', ATLAS, 'application/gzip')],
    [`${ATLAS}other-0000.json.gz`, refused('hypomap', ATLAS, 'application/gzip')],
    [`${ATLAS}x/manifest.json`, refused('hypomap', ATLAS, JSON_TYPE)],
    [`${ATLAS}genes-..00.json.gz`, refused('hypomap', ATLAS, 'application/gzip')],
    ['hypomap/hypomap-atlas-2000-01-01/manifest.json', refused('hypomap', 'hypomap/hypomap-atlas-2000-01-01/', JSON_TYPE)],
    [`hypomap/${HYPOMAP_TAG}.old/manifest.json`, refused('hypomap', `hypomap/${HYPOMAP_TAG}.old/`, JSON_TYPE)],
    ['hypomap/x.js', refused('hypomap', 'hypomap/x.js', JS)],
    [`datasets/${HYPOMAP_TAG}/genes-0000.json.gz`, refused('datasets', `datasets/${HYPOMAP_TAG}/`, 'application/gzip')],
    // Outside every tree.
    ['robots.txt', refused(null, 'robots.txt')],
    ['other/x.js', refused(null, 'other/x.js', JS)],
    ['datasets', refused(null, 'datasets')],
  ])('%s', (key, expected) => {
    const { key: _key, compressible: _compressible, ...row } = originObject(key);
    expect(row).toEqual(expected);
  });

  it('compresses text types only: never PDFs or already-gzipped atlas files', () => {
    expect(originObject('datasets/x/meta.js').compressible).toBe(true);
    expect(originObject(`${ATLAS}manifest.json`).compressible).toBe(true);
    expect(originObject('qc/x.pdf').compressible).toBe(false);
    expect(originObject(`${ATLAS}genes-0000.json.gz`).compressible).toBe(false);
  });

  it('agrees with the uploader-side atlas check on names, which also requires shard digits', () => {
    for (const file of [...HYPOMAP_FIXED_FILES, 'genes-0000.json.gz', 'genes-9999.json.gz']) {
      expect([file, hypomapFileAllowed(file), originObject(`${ATLAS}${file}`).wafAllowed]).toEqual([file, true, true]);
    }
    expect(hypomapFileAllowed('genes-abcd.json.gz')).toBe(false);
  });
});

describe('invariants', () => {
  const generation: QueryGeneration = { tracks: TRACKS, expression: EXPRESSION };
  // Every shape a local public/ tree can hold, admissible or not.
  const names = ['meta.js', 'track_a.pathways.js', 'report.pdf', 'meta.json', 'notes.txt', 'data.csv', 'x.js.map', '.htaccess', '.public-data-release.json', 'x.json.gz', 'README'];
  const candidates = [
    ...BUNDLE_TREES.flatMap((tree) => names.flatMap((name) => [`${tree}/${name}`, `${tree}/sub/${name}`])),
    ...names.flatMap((name) => [`query/${TRACKS}/genes/${name}`, `query/oldbuild/genes/${name}`, `query/expression/${EXPRESSION}/shards/${name}`]),
    ...POINTER_NAMES.map((name) => POINTERS[name].key),
    ...[...HYPOMAP_FIXED_FILES, 'genes-0000.json.gz', 'genes-abcd.json.gz', 'extra.json'].map((file) => `${ATLAS}${file}`),
  ];

  it('the uploader selects only keys the edge admits', () => {
    for (const current of [generation, { tracks: null, expression: EXPRESSION }, null]) {
      for (const key of candidates) {
        if (uploadDecision(key, current) === 'selected') expect(originObject(key).wafAllowed, key).toBe(true);
      }
    }
  });

  it('the uploader reports admissible-tree files the edge would refuse, and skips dotfiles and other generations quietly', () => {
    expect(uploadDecision('datasets/x/meta.js', generation)).toBe('selected');
    expect(uploadDecision('qc/x.pdf', generation)).toBe('selected');
    expect(uploadDecision('datasets/x/meta.json', generation)).toBe('refused');
    expect(uploadDecision('datasets/.htaccess', generation)).toBe('dotfile');
    expect(uploadDecision('datasets/.public-data-release.json', generation)).toBe('dotfile');
    expect(uploadDecision(`query/${TRACKS}/genes/g001.json`, generation)).toBe('refused');
    expect(uploadDecision('query/oldbuild/genes/g001.js', generation)).toBe('other-generation');
    expect(uploadDecision('query/oldbuild/genes/g001.json', generation)).toBe('other-generation');
    expect(uploadDecision('query/tracks.js', { tracks: null, expression: EXPRESSION })).toBe('other-generation');
    expect(uploadDecision('query/tracks.js', null)).toBe('other-generation');
    expect(uploadDecision('nomenclature/x.js', generation)).toBe('outside');
  });

  it('every pointer is mutable with the short TTL, and nothing else is', () => {
    expect(POINTER_MAX_AGE_SECONDS).toBe(300);
    for (const name of POINTER_NAMES) {
      expect(originObject(POINTERS[name].key)).toMatchObject({ mutable: true, cacheControl: POINTER });
      expect(isPointerKey(POINTERS[name].key)).toBe(true);
    }
    const others = candidates.filter((key) => !isPointerKey(key));
    expect(others.length).toBeGreaterThan(50);
    for (const key of others) expect(originObject(key), key).toMatchObject({ mutable: false, cacheControl: IMMUTABLE });
  });

  it('the service-worker matcher recognizes exactly the pointers', () => {
    const matches = (key: string) => isPointerRequest({ url: new URL(`https://data.example.test/${key}?v=1`) });
    for (const name of POINTER_NAMES) expect(matches(POINTERS[name].key)).toBe(true);
    for (const key of candidates.filter((candidate) => !isPointerKey(candidate))) expect(matches(key), key).toBe(false);
    // Workbox serializes it with toString(): the body must stand alone.
    expect(new Function(`return ${isPointerRequest.toString()}`)()({ url: new URL('https://x.test/query/tracks.js') })).toBe(true);
  });

  it('the bundle trees share the edge extension list', () => {
    expect([BUNDLE_TREES, BUNDLE_EXTENSIONS]).toEqual([['datasets', 'query', 'qc'], ['.js', '.pdf']]);
  });
});

describe('build ids', () => {
  it.each<[keyof typeof POINTERS, unknown, boolean]>([
    ['tracks', TRACKS, true],
    ['tracks', 'a', true],
    ['tracks', 'a'.repeat(64), true],
    ['tracks', 'a'.repeat(65), false],
    ['tracks', 'ABC', false],
    ['tracks', '../other', false],
    ['tracks', 'build/child', false],
    ['tracks', '', false],
    ['tracks', ' ', false],
    ['tracks', undefined, false],
    ['tracks', 42, false],
    ['expression', EXPRESSION, true],
    ['expression', 'a'.repeat(63), false],
    ['expression', 'g'.repeat(64), false],
    ['expression', EXPRESSION.toUpperCase(), false],
    ['expression', TRACKS, false],
    ['expression', null, false],
  ])('%s %j valid: %s', (name, value, valid) => {
    expect(isBuildId(name, value)).toBe(valid);
    if (valid) expect(parseBuildId(name, value)).toBe(value);
    else expect(() => parseBuildId(name, value)).toThrow(`${POINTERS[name].key} names an invalid build id`);
  });
});

describe('pointers', () => {
  const tracksSource = `// AUTO-GENERATED\n// manifest\nvar HX_QUERY_TRACKS = {"v":2,"buildId":"${TRACKS}","tracks":[]};\n`;
  const expressionManifest = { schemaVersion: 1, buildId: EXPRESSION, shardCount: 512, sources: [{ id: 's' }] };
  const expressionSource = `var HX_EXPRESSION_MANIFEST = ${JSON.stringify(expressionManifest)};\n`;

  it('read the build id and payload from the generators\' exact wrapper', () => {
    const tracks = parsePointer('tracks', tracksSource);
    expect([tracks.key, tracks.buildId, tracks.manifest.v, tracks.text]).toEqual(['query/tracks.js', TRACKS, 2, tracksSource]);
    expect(parsePointer('expression', expressionSource).buildId).toBe(EXPRESSION);
  });

  it.each([
    ['another global', `var HX_EXPRESSION_MANIFEST = {"buildId":"${TRACKS}"};`],
    ['code after the payload', `var HX_QUERY_TRACKS = {"buildId":"${TRACKS}"}; alert(1);`],
    ['code before the payload', `alert(1); var HX_QUERY_TRACKS = {"buildId":"${TRACKS}"};`],
    ['a non-object payload', 'var HX_QUERY_TRACKS = [1];'],
    ['malformed JSON', 'var HX_QUERY_TRACKS = {buildId: 1};'],
    ['a missing build id', 'var HX_QUERY_TRACKS = {"tracks":[]};'],
    ['an invalid build id', 'var HX_QUERY_TRACKS = {"buildId":"../x"};'],
  ])('refuse %s', (_label, source) => {
    expect(() => parsePointer('tracks', source)).toThrow();
  });

  it('match the expression pointer to its immutable manifest', () => {
    const pointer = parsePointer('expression', expressionSource);
    const immutable = (value: object) => `var ${expressionIndexGlobal(EXPRESSION, 'manifest')} = ${JSON.stringify(value)};\n`;
    expect(() => verifyExpressionManifest(pointer, immutable(expressionManifest))).not.toThrow();
    expect(() => verifyExpressionManifest(pointer, immutable({ ...expressionManifest, sources: [] }))).toThrow('does not match');
    expect(() => verifyExpressionManifest(pointer, expressionSource)).toThrow('single');
  });
});

describe('generations', () => {
  it('name each build directory and the pointer that names it', () => {
    expect(generationPrefixes({ tracks: TRACKS, expression: EXPRESSION })).toEqual([
      `query/${TRACKS}/`, 'query/tracks.js', `query/expression/${EXPRESSION}/`, 'query/expression-manifest.js',
    ]);
    expect(generationPrefixes({ tracks: null, expression: EXPRESSION })).toEqual([`query/expression/${EXPRESSION}/`, 'query/expression-manifest.js']);
    expect(expressionManifestKey(EXPRESSION)).toBe(`query/expression/${EXPRESSION}/manifest.js`);
  });

  it('refuse a build id that could leave its directory', () => {
    expect(() => generationPrefixes({ tracks: '../other', expression: EXPRESSION })).toThrow('invalid build id');
    expect(() => generationPrefixes({ tracks: TRACKS, expression: 'build/child' })).toThrow('invalid build id');
  });

  it('hold their keys and nothing else', () => {
    const generation = { tracks: TRACKS, expression: EXPRESSION };
    expect(inGeneration(`query/${TRACKS}/genes/g001.js`, generation)).toBe(true);
    expect(inGeneration('query/tracks.js', generation)).toBe(true);
    expect(inGeneration(`query/${TRACKS}x/genes/g001.js`, generation)).toBe(false);
    expect(inGeneration('query/tracks.js.bak', generation)).toBe(false);
    expect(inGeneration('datasets/x/meta.js', generation)).toBe(false);
  });
});
