import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOMENCLATURE_TSV_COLUMNS,
  nomenclatureKey,
  parseRetainedNomenclature,
  refreshRetainedRgdSources,
  reuseRetainedNomenclature,
} from './nomenclatureRetained.mjs';

const header = NOMENCLATURE_TSV_COLUMNS.join('\t');
const retainedText =
  `${header}\nold\tHGNC\tprevious\tNEW\tName\talias1|alias2\told\tHGNC:1\tprotein coding\t2\n` +
  'Unknown\tMGI\tunrecognized\t\t\t\t\t\t\t1\n' +
  'old\tRGD\tcurrent\told\tRat gene\t\t\tRGD:1\tgene\t1\n';

test('bounded refresh preserves every retained non-RGD decision field while updating incidence', () => {
  const rows = parseRetainedNomenclature(retainedText);
  const prior = rows.get(nomenclatureKey('HGNC', 'old'))!;
  const reused = reuseRetainedNomenclature(rows, 'HGNC', 'old', 3);
  assert.deepEqual(reused, { ...prior, datasetCount: 3 });
  assert.equal(prior.datasetCount, 2, 'Rebuild must not mutate the retained snapshot');
  assert.equal(reused.status, 'previous');
  assert.equal(reused.currentSymbol, 'NEW');
  assert.deepEqual(reused.aliases, ['alias1', 'alias2']);
  assert.equal(reuseRetainedNomenclature(rows, 'MGI', 'Unknown', 2).status, 'unrecognized');
  assert.throws(
    () => reuseRetainedNomenclature(rows, 'HGNC', 'NEW_UNSEEN', 1),
    /no retained classification/,
  );
  assert.throws(
    () => reuseRetainedNomenclature(rows, 'HGNC', 'Unknown', 1),
    /cannot classify another authority/,
  );
  assert.throws(
    () => reuseRetainedNomenclature(rows, 'HGNC', 'OLD', 1),
    /no retained classification/,
    'Stored spelling is exact, not a case-insensitive cross-namespace match',
  );
});

test('bounded refresh changes only the two RGD source metadata entries', () => {
  const source = (file: string) => ({
    url: `https://authority.example/${file}`,
    file,
    bytes: 123,
    records: 2,
  });
  const retained = {
    builtFrom: {
      hgnc: source('human'),
      mgi: source('mouse'),
      rgd: source('old-rat'),
      rgdObsolete: source('old-obsolete'),
    },
    authorityNotes: { mouse: 'Retained authority-release note' },
    extension: { reviewed: true },
  };
  const rgd = source('new-rat');
  const obsolete = source('new-obsolete');
  const refreshed = refreshRetainedRgdSources(retained, rgd, obsolete);
  assert.deepEqual(refreshed, {
    ...retained,
    builtFrom: { ...retained.builtFrom, rgd, rgdObsolete: obsolete },
  });
  assert.deepEqual(retained.builtFrom.rgd, source('old-rat'));
  assert.throws(
    () => refreshRetainedRgdSources({ builtFrom: {} }, rgd, obsolete),
    /both RGD files/,
  );
});

test('invalid retained decisions cannot silently enter a bounded authority refresh', () => {
  for (const invalid of [
    retainedText.replace('n_datasets', 'wrong'),
    retainedText.replace('previous\t', 'approved\t'),
    retainedText.replace('HGNC\t', 'Other\t'),
    retainedText.replace('protein coding\t2', 'protein coding\tNaN'),
    retainedText.replace('protein coding\t2', 'protein coding\t0'),
    `${retainedText}${retainedText.split('\n')[1]}\n`,
  ])
    assert.throws(() => parseRetainedNomenclature(invalid), /retained nomenclature/i);
});
