import { getPopData } from '../data/popCache';
import { columnsForGroups, valueAt } from '../utils/sampleValues';
import type { Dataset, RawTrack } from '../types';
import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

const featureIndexes = new WeakMap<RawTrack, Map<string, string[]>>();

function featureKey(value: string): string {
  const key = value.trim().toUpperCase();
  // Version matching is safe only for an explicit Ensembl identifier. Symbol
  // suffixes such as Gene.1 remain separate source features.
  return /^ENS[A-Z]*G\d+(?:\.\d+)?$/.test(key) ? key.replace(/\.\d+$/, '') : key;
}

function featureIndex(raw: RawTrack): Map<string, string[]> {
  let index = featureIndexes.get(raw);
  if (index) return index;
  index = new Map();
  for (const feature of Object.keys(raw.cpm ?? {})) {
    const key = featureKey(feature);
    const matches = index.get(key) ?? [];
    matches.push(feature);
    index.set(key, matches);
  }
  featureIndexes.set(raw, index);
  return index;
}

/** Resolve symbols (case-insensitive) or explicitly retained Ensembl IDs. No alias guesses or DE fallback. */
export function expressionForGenes(
  source: ExpressionSource,
  raw: RawTrack,
  dataset: Dataset,
  genes: string[],
): ExpressionGeneResult[] {
  if (source.datasetId !== dataset.id) throw new Error('Expression source does not match the loaded study.');
  const popData = getPopData(raw, dataset, null);
  if (!popData) throw new Error('Expression data are unavailable for this source.');
  if (popData.expressionUnit !== source.unit) {
    throw new Error(`Expression unit changed for ${source.id}: expected ${source.unit}, received ${popData.expressionUnit}.`);
  }
  const groups = source.conditions.map((condition) => {
    const registered = dataset.groups.find((group) => group.key === condition.key);
    if (!registered) throw new Error(`Expression condition is not registered: ${condition.key}`);
    return registered;
  });
  const columns = columnsForGroups(popData, groups);
  const keptIds = raw.meta?.samplesKept ?? raw.qc?.samplesKept;
  const kept = keptIds ? new Set(keptIds) : null;
  const index = featureIndex(raw);
  return genes.map((query) => {
    const matches = index.get(featureKey(query)) ?? [];
    const base = { sourceId: source.id, query, unit: source.unit };
    if (!matches.length) return { ...base, status: 'not-retained', groups: [] };
    if (matches.length > 1) return { ...base, status: 'ambiguous', candidates: [...matches], groups: [] };
    const gene = matches[0];
    return {
      ...base,
      status: 'available',
      gene,
      ...(/^ENS[A-Z]*G\d+(?:\.\d+)?$/i.test(gene) ? { geneId: gene } : {}),
      groups: columns.map((column, groupIndex) => {
        const samples = column.samples.map((sample) => {
          const stored = valueAt(popData, gene, sample.index);
          return {
            id: sample.id,
            value: (kept && !kept.has(sample.id)) || stored === null || !Number.isFinite(stored) ? null : stored,
          };
        });
        const values = samples.flatMap((sample) => sample.value === null ? [] : [sample.value]);
        return {
          key: column.key,
          label: source.conditions[groupIndex].label,
          referenceEligible: source.conditions[groupIndex].referenceEligible,
          samples,
          mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          n: values.length,
          totalSamples: samples.length,
        };
      }),
    };
  });
}

