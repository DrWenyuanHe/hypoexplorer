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

/** Exercise the actual command with source and public output confined to a fixture. */
function buildNames(rows: string[][]): NameRow[] {
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
    return (JSON.parse(payload[1]) as { rows: NameRow[] }).rows;
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
