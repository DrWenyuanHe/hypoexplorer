import type { ExpressionGeneResult, ExpressionSource } from './expressionTypes';

export interface NeuroseqSample {
  id: string;
  label: string;
  sourceGroupId: string;
  populationId: string;
  region: string;
  driver: string;
  transmitter: string;
  sex: string;
  ageDays: number | null;
  pooledCellCount: number | null;
  feedingState: string;
  feedingEvidence: string;
  referenceEligible: boolean;
  geo: string;
  henryOverlapCandidate: { henryColumn: string; henryGeo: string; status: string } | null;
}

export interface NeuroseqManifest {
  schemaVersion: number;
  id: string;
  title: string;
  unit: string;
  organism: string;
  processing: string;
  geneCount: number;
  sampleCount: number;
  populationCount: number;
  sourceGroupCount: number;
  geneIndexPath: string;
  validationPath: string;
  samples: NeuroseqSample[];
  sourceGroups: Array<{ id: string; label: string; populationId: string; region: string; transmitter: string; sampleIds: string[] }>;
  populations: Array<{ id: string; label: string; region: string; sourceGroupIds: string[]; sampleIds: string[] }>;
  source: { portalUrl: string; paperUrl: string };
  notes: string[];
}

interface GeneEntry { id: string; symbol: string; ensemblId: string; shard: string }
interface GeneValues extends Omit<GeneEntry, 'shard'> { description: string; values: number[] }

const requests = new Map<string, Promise<unknown>>();

/** Same-origin JSON belongs to the app release; failed loads remain retryable. */
export function expressionJson<T>(path: string): Promise<T> {
  if (!path.startsWith('/expression/neuroseq/') || path.includes('..')) {
    return Promise.reject(new Error('Invalid NeuroSeq asset path.'));
  }
  let request = requests.get(path);
  if (!request) {
    request = fetch(`${path}?v=${encodeURIComponent(__APP_VERSION__)}`, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Expression data unavailable (${response.status}). Please retry.`);
      return response.json();
    }).catch((error: unknown) => { requests.delete(path); throw error; });
    requests.set(path, request);
  }
  return request as Promise<T>;
}

export async function loadNeuroseqManifest(): Promise<NeuroseqManifest> {
  const manifest = await expressionJson<NeuroseqManifest>('/expression/neuroseq/manifest.json');
  if (manifest.schemaVersion !== 1 || manifest.samples.length !== manifest.sampleCount ||
      new Set(manifest.samples.map((s) => s.id)).size !== manifest.sampleCount) {
    throw new Error('NeuroSeq sample metadata is inconsistent.');
  }
  return manifest;
}

const POPULATIONS: Record<string, [string, string]> = {
  'HY.ARH_GABA_NPY-hrGFP': ['agrp', 'ARC NPY reporter / AgRP'],
  'HY.ARH_glu_Pomc-GFP': ['pomc', 'ARC POMC'],
  'HY.DMHp_glu_Grp.KH288': ['dmh-grp', 'DMHp Grp'],
  'HY.LHA_glu_MCH': ['lha-mch', 'LHA MCH'],
  'HY.MM_glu_HSD2-Cre': ['mm-hsd2', 'MM HSD2'],
  'HY.MM_glu_Slc17a6.OX23': ['mm-slc17a6', 'MM Slc17a6'],
  'HY.MPN_GABA_P170': ['mpn-p170', 'MPN P170'],
  'HY.PVH_glu_Crh.ZJH': ['crh-pvn', 'PVH CRH'],
  'HY.PVH_glu_Oxytocin-GFP': ['oxt', 'PVH oxytocin'],
  'HY.PVHd_glu_MCH': ['pvhd-mch', 'PVHd MCH'],
  'HY.PVHp_glu_AVP.QZ20': ['pvh-avp', 'PVHp AVP'],
  'HY.SCH_GABA_AVP.QZ20': ['scn-avp', 'SCN AVP'],
  'HY.SFO_glu,GABA_Gng7.KH67': ['sfo-gng7', 'SFO Gng7'],
  'HY.SFO_glu,GABA_Grm2.MR90': ['sfo-grm2', 'SFO Grm2'],
  'HY.SO_glu_AVP.QZ20': ['so-avp', 'SO AVP'],
};

export function neuroseqSources(manifest: NeuroseqManifest): ExpressionSource[] {
  return manifest.populations.map((population) => {
    const samples = manifest.samples.filter((sample) => sample.populationId === population.id);
    const names = POPULATIONS[population.id] ?? [population.id, population.label];
    const overlap = samples.some((sample) => sample.henryOverlapCandidate);
    return {
      id: population.id, label: `${names[1]} · NeuroSeq`, collection: 'neuroseq', scope: 'population',
      populationId: names[0], populationLabel: names[1], region: population.region === 'ARH' ? 'ARC' : population.region,
      species: manifest.organism, assay: 'RNA-seq of manually sorted neurons', rnaFraction: 'Total RNA',
      unit: 'TPM', normalization: `${manifest.processing}; published portal values at 2 decimal places`,
      replicateUnit: 'Pooled neurons per RNA library; inspect sample metadata for cell counts',
      identityMethod: 'Fluorescent reporter / driver; manual neuron sorting', driverOrMarker: samples[0]?.driver,
      conditions: population.sourceGroupIds.map((id) => {
        const groupSamples = samples.filter((sample) => sample.sourceGroupId === id);
        const fed = groupSamples.length > 0 && groupSamples.every((sample) => sample.feedingState === 'fed');
        return { key: id, label: id, referenceEligible: fed && groupSamples.every((sample) => sample.referenceEligible), feedingState: fed ? 'fed' : 'not reported',
          notes: fed ? 'Fed state is explicit in the published source group.' : 'Atlas reference samples; feeding state not reported. Excluded by the eligible reference filter.',
          sampleCount: groupSamples.length, sex: [...new Set(groupSamples.map((s) => s.sex))].join(', '),
          age: `${[...new Set(groupSamples.map((s) => s.ageDays).filter((age) => age != null))].join(', ')} days` };
      }),
      sourceUrl: manifest.source.portalUrl, citation: 'Sugino et al., eLife 2019, e38619; contributing studies retained in source metadata.',
      notes: `Original NeuroSeq label: ${population.label}. Source groups remain separate. Library means use the published TPM scale.`,
      sampleCount: samples.length, sourceGroupIds: population.sourceGroupIds, boundary: population.region === 'SFO',
      sharedSampleNote: overlap ? 'Metadata identifies candidate shared fed libraries with Henry GSE68177. Treat them as reused samples, not independent replication; raw-read identity remains unconfirmed.' : undefined,
    };
  });
}

/** Resolve exact source symbols and stable IDs without merging duplicate names. */
export function resolveNeuroseqGenes(entries: GeneEntry[], query: string): GeneEntry[] {
  const key = query.trim().toLowerCase();
  const ids = entries.filter((entry) => entry.id.toLowerCase() === key || (/^ENS[A-Z]*G\d+/i.test(entry.ensemblId) && entry.ensemblId.toLowerCase() === key));
  if (ids.length) return ids;
  const exact = entries.filter((entry) => entry.symbol === query.trim());
  return exact.length ? exact : entries.filter((entry) => entry.symbol.toLowerCase() === key);
}

function geneIdentifier(row: Pick<GeneEntry, 'id' | 'ensemblId'>): string {
  return /^ENS[A-Z]*G\d+/i.test(row.ensemblId) ? row.ensemblId : row.id;
}

export function neuroseqGeneResult(manifest: NeuroseqManifest, sourceId: string, query: string, row: GeneValues): ExpressionGeneResult {
  if (row.values.length !== manifest.sampleCount || row.values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('NeuroSeq expression values do not match the sample manifest.');
  }
  const source = neuroseqSources(manifest).find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error('Unknown NeuroSeq population.');
  return {
    sourceId, query, status: 'available', gene: row.symbol, geneId: geneIdentifier(row), unit: 'TPM',
    groups: source.conditions.map((condition) => {
      const samples = manifest.samples.flatMap((sample, index) => sample.sourceGroupId === condition.key
        ? [{ id: sample.label, value: row.values[index] }] : []);
      return { key: condition.key, label: condition.label, referenceEligible: condition.referenceEligible,
        samples, mean: samples.length ? samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length : null,
        n: samples.length, totalSamples: samples.length };
    }),
  };
}

export async function loadNeuroseqExpression(sourceId: string, genes: string[]): Promise<ExpressionGeneResult[]> {
  const manifest = await loadNeuroseqManifest();
  const index = await expressionJson<{ schemaVersion: number; genes: GeneEntry[] }>(manifest.geneIndexPath);
  if (index.schemaVersion !== 1 || index.genes.length !== manifest.geneCount) throw new Error('NeuroSeq gene index is inconsistent.');
  return Promise.all(genes.map(async (query) => {
    const matches = resolveNeuroseqGenes(index.genes, query);
    const base = { sourceId, query, unit: 'TPM', groups: [] };
    if (!matches.length) return { ...base, status: 'not-retained' as const };
    if (matches.length > 1) return { ...base, status: 'ambiguous' as const, candidates: matches.map((m) => `${m.symbol} (${geneIdentifier(m)})`) };
    const entry = matches[0];
    const shard = await expressionJson<{ schemaVersion: number; genes: Record<string, GeneValues> }>(entry.shard);
    const row = shard.genes[entry.id];
    if (shard.schemaVersion !== 1 || !row || row.id !== entry.id || row.ensemblId !== entry.ensemblId) throw new Error('NeuroSeq gene shard is inconsistent.');
    return neuroseqGeneResult(manifest, sourceId, query, row);
  }));
}

export function resetExpressionRequests(): void { requests.clear(); }
