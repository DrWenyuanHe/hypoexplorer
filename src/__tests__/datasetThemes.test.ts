import { describe, it, expect } from 'vitest';
import { DATASET_CATEGORIES } from '../data/datasetCategories';
import { DATASET_THEMES } from '../data/datasetThemes';

describe('DATASET_THEMES', () => {
  it('places every category in exactly one theme', () => {
    // The themes ARE the category facet's rendering. A category in no theme is
    // unreachable from the rail — its studies would still be in the results and
    // still counted, with no way to filter to them; a category in two would draw
    // the same checkbox twice and let the two copies disagree.
    const placements = DATASET_CATEGORIES.map((category) => ({
      category,
      themes: DATASET_THEMES.filter((t) => t.categories.includes(category)).map((t) => t.id),
    }));
    expect(placements.filter((p) => p.themes.length !== 1)).toEqual([]);
  });

  it('names a single-category theme after its category', () => {
    // Otherwise the rail cannot collapse it to one row without renaming it on
    // screen, and the rail would disagree with the card view's section headers.
    for (const theme of DATASET_THEMES) {
      if (theme.categories.length === 1) expect(theme.title).toBe(theme.categories[0]);
    }
  });

  it('lists categories in registry order', () => {
    // The rail reads top-to-bottom in DATASET_CATEGORIES order, the same order
    // the card view groups by, so the two surfaces stay comparable.
    const flat = DATASET_THEMES.flatMap((t) => t.categories);
    expect(flat).toEqual([...DATASET_CATEGORIES].filter((c) => flat.includes(c)));
  });
});
