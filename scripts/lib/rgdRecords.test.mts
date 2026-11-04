import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRgdRecords } from './rgdRecords.mjs';

test('later provisional strain/assembly records cannot replace an explicitly approved rat symbol', () => {
  const records = [
    {
      id: 'RGD:1566032',
      symbol: '1700029M20Rikl',
      nomenclatureStatus: 'APPROVED',
      name: 'RIKEN cDNA 1700029M20 gene like',
      locusType: 'ncrna',
    },
    {
      id: 'RGD:738374434',
      symbol: '1700029M20Rikl',
      nomenclatureStatus: 'PROVISIONAL',
      name: '',
      locusType: 'protein-coding',
    },
    {
      id: 'RGD:738950590',
      symbol: '1700029M20Rikl',
      nomenclatureStatus: 'PROVISIONAL',
      name: '',
      locusType: 'protein-coding',
    },
    {
      id: 'RGD:739527777',
      symbol: '1700029M20Rikl',
      nomenclatureStatus: 'PROVISIONAL',
      name: '',
      locusType: 'protein-coding',
    },
  ];
  for (const order of [records, [...records].reverse()]) {
    const choice = selectRgdRecords(order).get('1700029M20RIKL')!;
    assert.equal(choice.selected?.id, 'RGD:1566032');
    assert.equal(choice.selected?.locusType, 'ncrna');
    assert.equal(choice.candidates.length, 4);
  }
});

test('ambiguous active RGD IDs stay unresolved rather than depending on row order', () => {
  const records = [
    { id: 'RGD:15004998', symbol: '3110082J24Rik', nomenclatureStatus: 'PROVISIONAL' },
    { id: 'RGD:739527351', symbol: '3110082J24Rik', nomenclatureStatus: 'PROVISIONAL' },
    { id: 'RGD:1', symbol: 'Case', nomenclatureStatus: 'APPROVED' },
    { id: 'RGD:2', symbol: 'case', nomenclatureStatus: 'APPROVED' },
  ];
  for (const order of [records, [...records].reverse()]) {
    const choices = selectRgdRecords(order);
    assert.equal(choices.get('3110082J24RIK')!.selected, null);
    assert.deepEqual(
      choices.get('3110082J24RIK')!.candidates.map((record) => record.id),
      ['RGD:15004998', 'RGD:739527351'],
    );
    assert.equal(choices.get('CASE')!.selected, null);
  }
  assert.equal(
    selectRgdRecords([{ id: 'RGD:3', symbol: 'Single', nomenclatureStatus: 'PROVISIONAL' }]).get(
      'SINGLE',
    )!.selected?.id,
    'RGD:3',
  );
  assert.throws(() => selectRgdRecords([records[0], records[0]]), /Duplicate active RGD ID/);
});
