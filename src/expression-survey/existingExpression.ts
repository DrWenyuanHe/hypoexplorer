import { getDataset } from '../data/datasets';
import { getExistingExpressionSource } from './existingCatalog';
import type { ExpressionGeneResult } from './expressionTypes';
import { loadIndexedExpression } from './expressionIndex';

export { expressionForGenes } from './existingExpressionValues';

/** Resolve a source against the lossless gene index; full tracks remain an offline validation reference. */
export async function loadExistingExpression(sourceId: string, genes: string[]): Promise<ExpressionGeneResult[]> {
  const source = getExistingExpressionSource(sourceId);
  if (!source?.datasetId || !source.trackId) throw new Error(`Unknown expression source: ${sourceId}`);
  const dataset = getDataset(source.datasetId);
  if (!dataset) throw new Error(`Unknown expression dataset: ${source.datasetId}`);
  return loadIndexedExpression(source, genes);
}
