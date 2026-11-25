import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NOMENCLATURE_TSV_COLUMNS } from './nomenclatureRetained.mjs';

const builder = fileURLToPath(new URL('../build_search_names.mts', import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
type NameRow = [string, string, string, string, number];
type RenamesPayload = { v: number; authorities: string[]; groups: Array<[number, string, ...string[]]> };

/** Exercise the actual command with source and public output confined to a fixture. */
function buildNames(rows: string[][]): NameRow[] {
  return buildOutputs(rows).names;
}

/** Both outputs; rename groups decoded to [authority, current, ...retired]. */
function buildOutputs(rows: string[][]): { names: NameRow[]; renames: string[][] } {
  const fixture = mkdtempSync(join(tmpdir(), 'hypoexplorer-search-names-'));
  try {
    const input = join(fixture, 'data/nomenclature');
    mkdirSync(input, { recursive: true });
    writeFileSync(join(input, 'nomenclature.tsv'),
      [NOMENCLATURE_TSV_COLUMNS.join('\t'), ...rows.map(row => row.join('\t')), ''].join('\n'));
    const result = spawnSync(process.execPath, [tsxCli, builder], {
      cwd: fixture, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    const script = readFileSync(join(fixture, 'public/nomenclature/names.js'), 'utf8');
    const payload = /var HX_SEARCH_NAMES = (.*);/.exec(script);
    assert.ok(payload, 'Builder must emit its public wire payload');
    const renamesScript = readFileSync(join(fixture, 'public/nomenclature/renames.js'), 'utf8');
    const renamesPayload = /var HX_SYMBOL_RENAMES = (.*);/.exec(renamesScript);
    assert.ok(renamesPayload, 'Builder must emit the rename payload');
    const decoded = JSON.parse(renamesPayload[1]) as RenamesPayload;
    assert.equal(decoded.v, 1);
    return {
      names: (JSON.parse(payload[1]) as { rows: NameRow[] }).rows,
      renames: decoded.groups.map(([code, ...members]) => [decoded.authorities[code], ...members]),
    };
  } finally {
    assert.equal(dirname(fixture), resolve(tmpdir()), 'Cleanup must stay in the intended temporary directory');
    assert.ok(basename(fixture).startsWith('hypoexplorer-search-names-'));
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('unresolved RGD candidate IDs do not become searchable gene names', () => {
  assert.deepEqual(buildNames([
    ['Snora74', 'RGD', 'ambiguous', '',
      'Ambiguous active RGD IDs: RGD:15011897; RGD:15012213; RGD:15012654',
      '', '', '', '', '1'],
  ]), []);
});

test('ambiguous rows contribute no names or redirects while another authority stays searchable', () => {
  const current = ['AGBL4', 'HGNC', 'current', 'AGBL4', 'AGBL carboxypeptidase 4',
    'CCP6', 'OLDAGBL4', 'HGNC:1', 'protein coding', '4'];
  const ambiguous = ['Agbl4', 'RGD', 'ambiguous', 'WrongCurrent',
    'Ambiguous active RGD IDs: RGD:6493177; RGD:738373762',
    'WrongAlias', 'WrongPrevious', '', '', '9'];
  for (const rows of [[current, ambiguous], [ambiguous, current]]) {
    assert.deepEqual(buildNames(rows), [
      ['AGBL4', 'AGBL carboxypeptidase 4', '', 'OLDAGBL4|CCP6', 4],
    ]);
  }
});

// [symbol, authority, status, current, name, aliases, previous, id, locus, n]
const row = (symbol: string, authority: string, status: string, current: string, aliases: string, prev: string, id: string, n = '5') =>
  [symbol, authority, status, current, `${current || symbol} gene`, aliases, prev, id, 'protein coding', n];

test("a retired symbol joins its current symbol only on the authority's own link", () => {
  const { renames } = buildOutputs([
    row('Fam237b', 'MGI', 'current', 'Fam237b', 'Gm8773', 'EG667705|Gm8773', 'MGI:3646213', '42'),
    row('Gm8773', 'MGI', 'previous', 'Fam237b', 'Gm8773', 'EG667705|Gm8773', 'MGI:3646213', '39'),
    // A lowercase allele name listed as a previous symbol is not the gene.
    row('Pcdh15', 'MGI', 'current', 'Pcdh15', '', 'av', 'MGI:1891428'),
    row('av', 'MGI', 'previous', 'Pcdh15', '', 'av', 'MGI:1891428', '1'),
    // A split, and an ID the current row does not share, never join.
    row('Splitold', 'MGI', 'previous', 'Spla|Splb', '', '', 'MGI:1'),
    row('Spla', 'MGI', 'current', 'Spla', '', 'Splitold', 'MGI:1'),
    row('Mismatch1', 'MGI', 'previous', 'Target', '', '', 'MGI:2'),
    row('Target', 'MGI', 'current', 'Target', '', 'Mismatch1', 'MGI:3'),
    // RGD names its placeholders as aliases: a placeholder joins, a named alias does not.
    row('Nhsl3', 'RGD', 'current', 'Nhsl3', 'RGD1561149', '', 'RGD:1561149'),
    row('RGD1561149', 'RGD', 'alias', 'Nhsl3', 'RGD1561149', '', 'RGD:1561149'),
    row('Eola1', 'RGD', 'current', 'Eola1', 'Eola2', '', 'RGD:9'),
    row('Eola2', 'RGD', 'alias', 'Eola1', 'Eola2', '', 'RGD:9'),
  ]);
  assert.deepEqual(renames, [['MGI', 'Fam237b', 'Gm8773'], ['RGD', 'Nhsl3', 'RGD1561149']]);
});

test("rename partners are always each other's search aliases, placeholders included", () => {
  const { names } = buildOutputs([
    row('Fam237b', 'MGI', 'current', 'Fam237b', 'Gm8773', 'EG667705|Gm8773', 'MGI:3646213', '42'),
    row('Gm8773', 'MGI', 'previous', 'Fam237b', 'Gm8773', 'EG667705|Gm8773', 'MGI:3646213', '1'),
  ]);
  const byKey = new Map(names.map((r) => [r[0], r]));
  assert.equal(byKey.get('FAM237B')?.[3], 'Gm8773');
  // The retired placeholder gets a row of its own, under the gene's name.
  assert.deepEqual(byKey.get('GM8773'), ['GM8773', 'Fam237b gene', '', 'Fam237b', 1]);
});

test('an alias its own authority approves for another stored gene is dropped, across authorities it is kept', () => {
  const { names } = buildOutputs([
    // Pig NCBI lists its own FAM237A under FAM237B.
    row('FAM237B', 'NCBI Gene (Sus scrofa)', 'current', 'FAM237B', 'FAM237A', '', 'GeneID:106504950'),
    row('FAM237A', 'NCBI Gene (Sus scrofa)', 'current', 'FAM237A', '', '', 'GeneID:1'),
    // HGNC's previous OBFC1 for STN1 is still a pig study's current symbol: the same gene.
    row('STN1', 'HGNC', 'current', 'STN1', '', 'OBFC1', 'HGNC:26200'),
    row('OBFC1', 'NCBI Gene (Sus scrofa)', 'current', 'OBFC1', '', '', 'GeneID:2'),
  ]);
  const byKey = new Map(names.map((r) => [r[0], r]));
  assert.equal(byKey.get('FAM237B')?.[3], '');
  assert.equal(byKey.get('STN1')?.[3], 'OBFC1');
});
