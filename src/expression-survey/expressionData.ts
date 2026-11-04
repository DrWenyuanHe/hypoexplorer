import { EXISTING_EXPRESSION_SOURCES } from './existingCatalog';
import { loadExistingExpression } from './existingExpression';
import { expressionJson, loadNeuroseqExpression, loadNeuroseqManifest, neuroseqSources } from './neuroseqExpression';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';
import { loadExternalExpression, loadExternalSources } from './externalReference';
import type { ExternalProvider } from './externalReferenceFormat';
import { loadReferenceExpression, loadReferenceManifest } from './referenceExpression';

/** External providers that fail to load are left out here and reported by `loadExternalSources`. */
export async function loadExpressionSources(): Promise<ExpressionSource[]> {
  const [manifest, reference, external] = await Promise.all([loadNeuroseqManifest(), loadReferenceManifest(), loadExternalSources()]);
  return [...neuroseqSources(manifest), ...reference.sources, ...EXISTING_EXPRESSION_SOURCES, ...external.sources];
}

export { loadExternalManifest, loadExternalValidation } from './externalReference';

/** Providers whose generated products are missing or inconsistent, with the reason. */
export async function loadExternalSourceErrors(): Promise<Partial<Record<ExternalProvider, string>>> {
  return (await loadExternalSources()).errors;
}

export function loadExpressionGenes(source: ExpressionSource, genes: string[]): Promise<ExpressionGeneResult[]> {
  if (source.collection === 'neuroseq') return loadNeuroseqExpression(source.id, genes);
  if (source.collection === 'reference') return loadReferenceExpression(source.id, genes);
  if (source.collection === 'external') return loadExternalExpression(source, genes);
  return loadExistingExpression(source.id, genes);
}

export interface ExpressionValidation {
  status: 'verified';
  geneCount: number;
  sampleCount: number;
  populationCount: number;
  sourceGroupCount: number;
  comparedValues: number;
  exactMatches: number;
  maxAbsoluteDifference: number;
  precision: string;
  checkpoints: Array<{ gene: string; sampleId: string; expected: number; actual: number; passed: boolean }>;
  sourceUrl: string;
  notes: string[];
}

/** The built report is validated before the UI is allowed to say verified. */
export async function loadExpressionValidation(): Promise<ExpressionValidation> {
  const manifest = await loadNeuroseqManifest();
  const report = await expressionJson<ExpressionValidation>(manifest.validationPath);
  if (report.status !== 'verified' || report.exactMatches !== manifest.geneCount * manifest.sampleCount ||
      report.comparedValues !== report.exactMatches || report.maxAbsoluteDifference !== 0 ||
      !report.checkpoints.length || report.checkpoints.some((point) => !point.passed || point.actual !== point.expected)) {
    throw new Error('The NeuroSeq validation report does not establish exact source agreement.');
  }
  return report;
}
