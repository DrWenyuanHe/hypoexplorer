import { expect, it } from 'vitest';
import { DATASET_CATEGORIES } from '../data/datasetCategories';
import { GENE_STUDY_CATEGORIES } from '../crossdataset/geneStudyScope';

it('offers every category once without assigning a gene', () => {
  expect(GENE_STUDY_CATEGORIES.map((item) => item.category)).toEqual(DATASET_CATEGORIES);
});
