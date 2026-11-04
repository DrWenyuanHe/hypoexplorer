import { describe, it, expect } from 'vitest';
import { GROUP_ORDER, groupByType } from '../utils/popGroups';

// groupByType drives both the sidebar (App) and the Compare cell picker. It is
// pure: the id→type map and category order arrive as explicit inputs (from the
// active dataset's meta), never from an ambient global. These tests pin the
// non-neuronal behaviour: every non-neuronal population is tagged type
// "Non-neuronal" by preprocessing and must collapse into a single group
// rendered after the four neuronal groups.
describe('groupByType (sidebar + compare grouping)', () => {
  const MACAQUE_TYPES = {
    e9: 'Glutamatergic', e10: 'Glutamatergic', i23: 'GABAergic', o30: 'Oxytocin',
    Ast1: 'Non-neuronal', Ast2: 'Non-neuronal', TanyA: 'Non-neuronal', OPC: 'Non-neuronal',
  };

  it('collapses all non-neuronal populations under one "Non-neuronal" group', () => {
    const groups = groupByType(['e9', 'Ast1', 'i23', 'TanyA', 'OPC', 'Ast2', 'o30', 'e10'], { types: MACAQUE_TYPES });
    expect(Object.keys(groups)).toContain('Non-neuronal');
    // natural sort within the group: Ast1, Ast2, OPC, TanyA
    expect(groups['Non-neuronal']).toEqual(['Ast1', 'Ast2', 'OPC', 'TanyA']);
  });

  it('orders neuronal groups first, Non-neuronal last', () => {
    const groups = groupByType(['Ast1', 'o30', 'e9', 'i23'], { types: MACAQUE_TYPES });
    expect(Object.keys(groups)).toEqual(['Glutamatergic', 'GABAergic', 'Oxytocin', 'Non-neuronal']);
  });

  it('sorts ids naturally within a group (e2 < e10)', () => {
    const types = { e2: 'Glutamatergic', e10: 'Glutamatergic', e9: 'Glutamatergic' };
    const groups = groupByType(['e10', 'e2', 'e9'], { types });
    expect(groups.Glutamatergic).toEqual(['e2', 'e9', 'e10']);
  });

  it('GROUP_ORDER lists Non-neuronal last', () => {
    expect(GROUP_ORDER[GROUP_ORDER.length - 1]).toBe('Non-neuronal');
  });
});

// groupByType(ids, { types, categoryOrder }): the dataset-driven opts let the
// sidebar group any dataset's tracks by its own category order.
describe('groupByType (opts-driven, multi-dataset)', () => {
  it('uses opts.types and opts.categoryOrder', () => {
    const types = { e9: 'Glutamatergic', a1: 'Non-neuronal', i23: 'GABAergic' };
    const categoryOrder = ['Glutamatergic', 'GABAergic', 'Histaminergic', 'Oxytocin', 'Non-neuronal'];
    const groups = groupByType(['a1', 'i23', 'e9'], { types, categoryOrder });
    expect(Object.keys(groups)).toEqual(['Glutamatergic', 'GABAergic', 'Non-neuronal']);
    expect(groups.Glutamatergic).toEqual(['e9']);
  });

  it('orders by a custom categoryOrder', () => {
    const types = { w: 'Whole tissue', x: 'Other type' };
    const groups = groupByType(['x', 'w'], { types, categoryOrder: ['Whole tissue'] });
    // Whole tissue first (in categoryOrder), then remaining alphabetically.
    expect(Object.keys(groups)).toEqual(['Whole tissue', 'Other type']);
  });

  it('a single-category dataset collapses to one group (sidebar skips headers)', () => {
    const types = { whole: 'Whole tissue' };
    const groups = groupByType(['whole'], { types, categoryOrder: ['Whole tissue'] });
    expect(Object.keys(groups)).toEqual(['Whole tissue']);
    expect(Object.keys(groups).length).toBe(1); // <= 1 → App skips grouping headers
  });

  it('falls back to "Other" for ids without a known type', () => {
    const groups = groupByType(['mystery'], { types: {}, categoryOrder: ['Glutamatergic'] });
    expect(groups.Other).toEqual(['mystery']);
  });

  it('a null types map (meta still loading) lands every id in "Other"', () => {
    const groups = groupByType(['e9', 'i23'], { types: null });
    expect(groups.Other).toEqual(['e9', 'i23']);
  });
});
