import { getDataset } from '../data/datasets';
import type { ExpressionCondition, ExpressionSource } from './expressionTypes';

type ConditionSpec = [key: string, sampleCount: number, referenceEligible: boolean, feedingState: string, notes?: string];
type SourceSpec = Pick<ExpressionSource, 'populationId' | 'populationLabel' | 'region' | 'assay' | 'rnaFraction' | 'identityMethod' | 'replicateUnit'>
  & Partial<Pick<ExpressionSource, 'scope' | 'driverOrMarker' | 'notes' | 'sharedSampleNote' | 'unit'>>
  & { datasetId: string; trackId: string; suffix?: string; conditions: ConditionSpec[] };

const COVERAGE = 'Only genes retained in the existing expression bundle are searchable; an absent row is not evidence of zero expression.';
const HENRY_OVERLAP = 'Five fed libraries in this population have metadata-supported matches in NeuroSeq. Different accessions do not establish independent biological replication; raw-read identity is not yet confirmed.';

function source(spec: SourceSpec): ExpressionSource {
  const dataset = getDataset(spec.datasetId);
  if (!dataset) throw new Error(`Unknown expression dataset: ${spec.datasetId}`);
  const conditions: ExpressionCondition[] = spec.conditions.map(([key, sampleCount, referenceEligible, feedingState, notes]) => {
    const registered = dataset.groups.find((group) => group.key === key);
    if (!registered) throw new Error(`Unknown expression group: ${dataset.id}/${key}`);
    return {
      key, label: registered.label, sampleCount, referenceEligible, feedingState,
      notes: notes ?? (referenceEligible ? 'Study-specific reference condition; see source design before comparing studies.' : 'Retained as a separate reported condition.'),
    };
  });
  const unit = spec.unit ?? dataset.expressionUnit ?? 'CPM';
  return {
    id: `${dataset.id}:${spec.trackId}${spec.suffix ? `:${spec.suffix}` : ''}`,
    label: `${spec.populationLabel} · ${dataset.geo ?? dataset.id}`,
    collection: 'existing',
    scope: spec.scope ?? 'population',
    populationId: spec.populationId,
    populationLabel: spec.populationLabel,
    region: spec.region,
    species: dataset.organism,
    assay: spec.assay,
    rnaFraction: spec.rnaFraction,
    unit,
    normalization: `Stored per-sample ${unit}. Group means use this stored scale without back-transformation or cross-study normalization.`,
    identityMethod: spec.identityMethod,
    driverOrMarker: spec.driverOrMarker,
    replicateUnit: spec.replicateUnit,
    conditions,
    datasetId: dataset.id,
    trackId: spec.trackId,
    sourceUrl: dataset.geo ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.geo}` : `https://doi.org/${dataset.doi}`,
    citation: dataset.geo === 'GSE68177'
      ? 'Henry et al., eLife 2015; manually sorted fluorescent ARC neurons (GSE68177). Existing HypoExplorer CPM reanalysis.'
      : dataset.citation,
    notes: [spec.notes, COVERAGE].filter(Boolean).join(' '),
    sampleCount: conditions.reduce((sum, condition) => sum + (condition.sampleCount ?? 0), 0),
    sourceGroupIds: conditions.map((condition) => condition.key),
    sharedSampleNote: spec.sharedSampleNote,
  };
}

const TOTAL = 'Total RNA';
const RIBOSOME = 'Ribosome-bound RNA';
const UNKNOWN = 'Not established in this catalog';
const MOUSE_LIBRARY = 'Sequenced library; consult the study for animal and pooling design';

/** Reviewed expression sources, with arm-level identity and disjoint condition membership. */
export const EXISTING_EXPRESSION_SOURCES: ExpressionSource[] = [
  source({ datasetId: 'mouse_agrp_fedfast_gse68177', trackId: 'agrp', populationId: 'agrp', populationLabel: 'ARC AgRP', region: 'ARC',
    assay: 'RNA-seq · manually sorted neurons', rnaFraction: TOTAL, identityMethod: 'Fluorescent reporter and manual micropipette sorting', driverOrMarker: 'NPY-hrGFP (source identifies AGRP neurons)',
    replicateUnit: 'One male brain per library; 44–214 manually sorted neurons', conditions: [['control', 5, true, 'Fed'], ['case', 6, false, 'Fasted 24 h']], sharedSampleNote: HENRY_OVERLAP,
    notes: 'Three manual sorting rounds, not FACS. Related to the NeuroSeq ARC NPY reporter population; original driver labels are retained.' }),
  source({ datasetId: 'mouse_arc_agrp_trap_gse240484', trackId: 'agrp', populationId: 'agrp', populationLabel: 'ARC AgRP', region: 'ARC',
    assay: 'NuTRAP RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted NuTRAP', driverOrMarker: 'AgRP', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 3, true, 'Ad libitum fed'], ['case', 4, false, 'Overnight fasted']], notes: 'The leptin-injected arm is excluded from this bundled track. Legacy annotation lacks Igfbp7 and Irs2.' }),
  source({ datasetId: 'mouse_agrp_fedfast_gse124693', trackId: 'agrp', populationId: 'agrp', populationLabel: 'ARC AgRP', region: 'ARC',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted RiboTag', driverOrMarker: 'AgRP', replicateUnit: 'Sequenced RiboTag profile; pool independence remains under review',
    conditions: [['control', 4, true, 'Ad libitum fed', 'Collected at ZT14.'], ['case', 5, false, 'Fasted 24 h', 'Collected at ZT14.']],
    unit: 'log2(DESeq2-normalized count + 1)', notes: 'Mean expression is the arithmetic mean of stored log2 values, not a log-transformed linear mean.' }),
  source({ datasetId: 'mouse_pomc_fedfast_gse68177', trackId: 'pomc', populationId: 'pomc', populationLabel: 'ARC POMC', region: 'ARC',
    assay: 'RNA-seq · manually sorted neurons', rnaFraction: TOTAL, identityMethod: 'Fluorescent reporter and manual micropipette sorting', driverOrMarker: 'Pomc-topazFP',
    replicateUnit: 'One male brain per library; manually sorted neurons', conditions: [['control', 5, true, 'Fed'], ['case', 5, false, 'Fasted 24 h']], sharedSampleNote: HENRY_OVERLAP,
    notes: 'Three manual sorting rounds, not FACS. The CPM reanalysis is not the NeuroSeq TPM processing.' }),
  source({ datasetId: 'mouse_arc_pomc_drd2_gse210311', trackId: 'pomc', suffix: 'pomc', populationId: 'pomc', populationLabel: 'ARC POMC', region: 'ARC',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted broad POMC population', driverOrMarker: 'POMC', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 3, true, UNKNOWN, 'Broad POMC identity reference; feeding state is not established here.']], notes: 'The Drd2+ POMC libraries are a distinct population subset, cataloged separately.' }),
  source({ datasetId: 'mouse_arc_pomc_drd2_gse210311', trackId: 'pomc', suffix: 'drd2', populationId: 'pomc-drd2', populationLabel: 'ARC POMC ∩ Drd2', region: 'ARC',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Intersectional genetic targeting', driverOrMarker: 'POMC ∩ Drd2', replicateUnit: MOUSE_LIBRARY,
    conditions: [['case', 3, true, UNKNOWN, 'Drd2+ POMC identity, not a treatment condition; feeding state is not established here.']], notes: 'Kept separate from the broad POMC population.' }),
  source({ datasetId: 'mouse_pomc_maternal_hfd_gse135639', trackId: 'pomc', populationId: 'pomc', populationLabel: 'ARC POMC', region: 'ARC',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted RiboTag', driverOrMarker: 'POMC', replicateUnit: MOUSE_LIBRARY,
    conditions: [['chow_p0', 5, true, 'Maternal chow', 'Offspring P0; maternal diet reference, not an adult fed baseline.'], ['chow_p21', 3, true, 'Maternal chow', 'Offspring P21.'], ['hfd_p0', 5, false, 'Maternal HFD', 'Offspring P0.'], ['hfd_p21', 4, false, 'Maternal HFD', 'Offspring P21.']],
    notes: 'Age-specific groups are disjoint. Overlapping pooled maternal-chow/HFD convenience groups are excluded from this survey.' }),
  source({ datasetId: 'gse224274', trackId: 'hypothalamus', populationId: 'pomc', populationLabel: 'ARC POMC', region: 'ARC',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted RiboTag', driverOrMarker: 'POMC', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 6, false, 'Fasted 16 h', 'Nonedible object; the control is still fasted.'], ['food', 6, false, 'Fasted 16 h', 'Food-cue exposure.']], unit: 'log2(CPM + 1)',
    notes: 'This track profiles POMC neurons despite its legacy hypothalamus track ID. No fed/reference-eligible condition; 5,143 genes retained.' }),
  source({ datasetId: 'mouse_arc_pnoc_trap_gse292416', trackId: 'pnoc', populationId: 'pnoc-arc', populationLabel: 'ARC PNOC', region: 'ARC',
    assay: 'bacTRAP RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted bacTRAP', driverOrMarker: 'Pnoc', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 4, true, UNKNOWN, 'LepR wild-type study reference.'], ['case', 4, false, UNKNOWN, 'LepR knockout.']] }),
  source({ datasetId: 'mouse_leprb_stat3_gse123983', trackId: 'leprb', populationId: 'leprb', populationLabel: 'Hypothalamic LepRb', region: 'Hypothalamus',
    assay: 'TRAP RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted TRAP', driverOrMarker: 'LepRb', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 3, true, UNKNOWN, 'Stat3-intact study reference.'], ['case', 3, false, UNKNOWN, 'Stat3 knockout.']] }),
  source({ datasetId: 'mouse_gnrh_androgen_gse162563', trackId: 'poa', populationId: 'gnrh', populationLabel: 'POA GnRH', region: 'POA',
    assay: 'TRAP RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted TRAP', driverOrMarker: 'GnRH', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 5, true, UNKNOWN, 'Prenatal vehicle reference.'], ['case', 6, false, UNKNOWN, 'Prenatal DHT exposure.']] }),
  source({ datasetId: 'mouse_hypo_oxt_trap_gse242245', trackId: 'oxytocin', populationId: 'oxt', populationLabel: 'Hypothalamic OXT', region: 'Hypothalamus',
    assay: 'RiboTag RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted RiboTag', driverOrMarker: 'Oxt', replicateUnit: 'Pool of 2–3 hypothalami per library',
    conditions: [['control', 4, true, UNKNOWN, 'Vehicle injection reference.'], ['case', 3, false, UNKNOWN, 'CCK-8s injection.']], notes: 'HFHS libraries were excluded from this track after failed IP purity.' }),
  source({ datasetId: 'rat_son_salt_gse65663', trackId: 'son', scope: 'tissue', populationId: 'son-tissue', populationLabel: 'SON tissue', region: 'SON',
    assay: 'Microarray', rnaFraction: TOTAL, identityMethod: 'Anatomical microdissection', replicateUnit: 'Independent RNA pool of five male rats per array',
    conditions: [['control', 5, true, UNKNOWN, 'Euhydrated study reference.'], ['salt', 5, false, UNKNOWN, 'Seven days of 2% saline drinking water.']],
    notes: 'Bulk SON tissue contains multiple cell types and is not purified OXT or AVP neurons. Values are deposited median-baselined log2 RMA; negative values are valid relative expression. Means use this stored scale. Five pools per arm are the independent replicates.' }),
  source({ datasetId: 'mouse_mpoa_pnoc_bactrap_gse306829', trackId: 'mpoa', suffix: 'ip', populationId: 'pnoc-mpoa', populationLabel: 'mPOA PNOC', region: 'mPOA',
    assay: 'bacTRAP RNA-seq', rnaFraction: RIBOSOME, identityMethod: 'Genetically targeted bacTRAP', driverOrMarker: 'NuTRAP::Pnoc-Cre', replicateUnit: 'Three independent pools of three mice; matched input/IP',
    conditions: [['case', 3, true, UNKNOWN, 'Female, 17–18 weeks; PNOC ribosome IP, not a treatment arm.']], notes: 'Matched total input is tissue and has a separate catalog entry; it is never included in PNOC expression.' }),
  source({ datasetId: 'mouse_sst_neuron_sex_gse224254', trackId: 'sst_neurons', populationId: 'sst-tuberal', populationLabel: 'Tuberal SST', region: 'Tuberal nucleus',
    assay: 'FACS RNA-seq', rnaFraction: TOTAL, identityMethod: 'Fluorescent SST neuron sorting by FACS', driverOrMarker: 'Sst', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 4, true, UNKNOWN, 'Female; retained separately from males.'], ['case', 4, true, UNKNOWN, 'Male; retained separately from females.']] }),
  source({ datasetId: 'mouse_vlpo_galanin_sleep_gse132308', trackId: 'vlpo_galanin', populationId: 'galanin-vlpo', populationLabel: 'VLPO galanin', region: 'VLPO',
    assay: 'Laser-capture RNA-seq', rnaFraction: TOTAL, identityMethod: 'Laser-capture microdissection of identified neurons', driverOrMarker: 'Galanin', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 6, true, UNKNOWN, 'Spontaneous sleep; ZT6.'], ['case', 6, false, UNKNOWN, 'Sleep deprivation; ZT6.']] }),
  source({ datasetId: 'mouse_vmh_sf1_sex_gse143818', trackId: 'vmh_sf1', populationId: 'sf1-vmh', populationLabel: 'VMH Sf1 lineage', region: 'VMH',
    assay: 'scRNA-seq animal pseudobulk', rnaFraction: 'Cell transcriptome pseudobulk', identityMethod: 'Developmental genetic lineage; cell annotation', driverOrMarker: 'Sf1 lineage', replicateUnit: 'Animal pseudobulk; P10 mice',
    conditions: [['control', 3, true, UNKNOWN, 'Female, P10.'], ['case', 3, true, UNKNOWN, 'Male, P10.']], notes: 'Developmental lineage and P10 sampling do not establish adult Sf1-neuron equivalence.' }),
  source({ datasetId: 'mouse_pvn_crh_ela_gse174085', trackId: 'crh_pvn', populationId: 'crh-pvn', populationLabel: 'PVN CRH', region: 'PVN',
    assay: 'scRNA-seq litter pseudobulk', rnaFraction: 'Cell transcriptome pseudobulk', identityMethod: 'CRH neuron selection and cell annotation', driverOrMarker: 'Crh', replicateUnit: 'Litter pseudobulk; P10–12',
    conditions: [['control', 14, true, UNKNOWN, 'Control litter; P10–12.'], ['case', 10, false, UNKNOWN, 'Early-life adversity; P10–12.']] }),
  source({ datasetId: 'gse262407', trackId: 'ghrh', populationId: 'ghrh', populationLabel: 'ARC/VMH Ghrh cluster', region: 'ARC / VMH',
    assay: 'snRNA-seq mouse pseudobulk', rnaFraction: 'Nuclear transcriptome pseudobulk', identityMethod: 'Transcriptomic cluster annotation', driverOrMarker: 'Ghrh', replicateUnit: 'Mouse pseudobulk',
    conditions: [['chow_saline', 3, true, 'Chow', 'Saline injection reference.'], ['hfd_saline', 4, false, 'HFD', 'Saline injection.'], ['chow_glucose', 4, false, 'Chow', 'Glucose injection.'], ['hfd_glucose', 4, false, 'HFD', 'Glucose injection.']], notes: 'Transcriptomic cluster, not a genetically targeted population.' }),
  source({ datasetId: 'mouse_arc_neun_development_gse189945', trackId: 'arc_neun', scope: 'isolated-neurons', populationId: 'arc-neun', populationLabel: 'ARC NeuN+ nuclei', region: 'ARC',
    assay: 'FANS RNA-seq', rnaFraction: 'Nuclear RNA', identityMethod: 'NeuN-positive nuclei sorted by FANS', driverOrMarker: 'NeuN', replicateUnit: 'Four-mouse pool per library; female',
    conditions: [['control', 5, true, UNKNOWN, 'PND12; developmental reference.'], ['case', 5, true, UNKNOWN, 'PND35; kept separate from PND12.']], unit: 'DESeq2 variance-stabilized expression' }),
  ...(['excitatory', 'inhibitory'] as const).map((trackId) => source({ datasetId: 'gse337822', trackId, scope: 'isolated-neurons', populationId: `poa-${trackId}`, populationLabel: `POA ${trackId} neurons`, region: 'POA',
    assay: 'snRNA-seq pseudobulk', rnaFraction: 'Nuclear transcriptome pseudobulk', identityMethod: 'Broad transcriptomic neuronal class', replicateUnit: 'Per-sample neuronal-class pseudobulk',
    conditions: [['control', 10, true, UNKNOWN, 'Oxygen control.'], ['isoflurane', 10, false, UNKNOWN, 'Isoflurane exposure.']] })),
  source({ datasetId: 'gse262407', trackId: 'neuron', scope: 'isolated-neurons', populationId: 'arc-vmh-neurons', populationLabel: 'ARC/VMH broad neurons', region: 'ARC / VMH',
    assay: 'snRNA-seq mouse pseudobulk', rnaFraction: 'Nuclear transcriptome pseudobulk', identityMethod: 'Broad transcriptomic neuronal class', replicateUnit: 'Mouse pseudobulk',
    conditions: [['chow_saline', 4, true, 'Chow', 'Saline injection reference.'], ['hfd_saline', 5, false, 'HFD', 'Saline injection.'], ['chow_glucose', 5, false, 'Chow', 'Glucose injection.'], ['hfd_glucose', 6, false, 'HFD', 'Glucose injection.']] }),
  source({ datasetId: 'mouse_mpoa_pnoc_bactrap_gse306829', trackId: 'mpoa', suffix: 'input', scope: 'tissue', populationId: 'mpoa-tissue', populationLabel: 'mPOA total input', region: 'mPOA',
    assay: 'Input RNA-seq from bacTRAP study', rnaFraction: TOTAL, identityMethod: 'Dissected regional tissue input', replicateUnit: 'Three independent pools of three mice; matched input/IP',
    conditions: [['control', 3, true, UNKNOWN, 'Female, 17–18 weeks; total input tissue.']], notes: 'Mixed tissue input is not a PNOC-neuron expression estimate. Matched PNOC IP is cataloged separately.' }),
  source({ datasetId: 'mouse_arc_fasting_gse96627', trackId: 'arcuate', scope: 'tissue', populationId: 'arc-tissue', populationLabel: 'ARC tissue', region: 'ARC',
    assay: 'Laser-capture regional RNA-seq', rnaFraction: TOTAL, identityMethod: 'Anatomical microdissection', replicateUnit: 'Individual male mouse',
    conditions: [['control', 5, true, 'Ad libitum fed'], ['case', 5, false, 'Food deprived 24 h']], unit: 'log2(RPKM + 1)' }),
  source({ datasetId: 'mouse_arc_hfd_gse225038', trackId: 'arcuate', scope: 'tissue', populationId: 'arc-tissue', populationLabel: 'ARC tissue', region: 'ARC',
    assay: 'Bulk RNA-seq', rnaFraction: TOTAL, identityMethod: 'Anatomical dissection', replicateUnit: MOUSE_LIBRARY,
    conditions: [['chow', 3, true, 'Chow'], ['hfd', 4, false, 'HFD']], notes: 'The profiled material is ARC tissue; genetic perturbation targets do not make it an AgRP-neuron profile.' }),
  source({ datasetId: 'mouse_arc_hfd_gse284408', trackId: 'arcuate', scope: 'tissue', populationId: 'arc-tissue', populationLabel: 'ARC tissue', region: 'ARC',
    assay: 'Bulk RNA-seq', rnaFraction: TOTAL, identityMethod: 'Anatomical dissection', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', 3, true, 'Normal chow'], ['case', 3, false, 'HFD']] }),
  ...([
    ['mouse_hypo_fedfast_gse254155', 10, 10, 'Fasted 16 h'],
    ['mouse_hypo_fasting_gse289833', 3, 3, 'Fasted 18 h'],
    ['mouse_hypo_fasting_gse294478', 3, 3, 'Fasted 72 h'],
  ] as const).map(([datasetId, fedN, fastedN, fasting]) => source({ datasetId, trackId: 'hypothalamus', scope: 'tissue', populationId: 'hypothalamus-tissue', populationLabel: 'Whole hypothalamus', region: 'Hypothalamus',
    assay: 'Bulk RNA-seq', rnaFraction: TOTAL, identityMethod: 'Anatomical dissection', replicateUnit: MOUSE_LIBRARY,
    conditions: [['control', fedN, true, 'Fed'], ['case', fastedN, false, fasting]] })),
  source({ datasetId: 'mouse_hypo_hfd_gse220533', trackId: 'whole', scope: 'tissue', populationId: 'hypothalamus-tissue', populationLabel: 'Whole hypothalamus', region: 'Hypothalamus',
    assay: 'Bulk RNA-seq', rnaFraction: TOTAL, identityMethod: 'Anatomical dissection', replicateUnit: MOUSE_LIBRARY,
    conditions: [['chow', 7, true, 'Chow'], ['hfd', 8, false, 'HFD']] }),
  source({ datasetId: 'mouse_lha_hfd_gse130597', trackId: 'lha', scope: 'tissue', populationId: 'lha-tissue', populationLabel: 'LHA mixed-cell pseudobulk', region: 'LHA',
    assay: 'scRNA-seq all-cell pseudobulk', rnaFraction: 'Mixed-cell transcriptome pseudobulk', identityMethod: 'Regional all-cell aggregation', replicateUnit: 'Sample pseudobulk',
    conditions: [['control', 7, true, 'Chow'], ['case', 7, false, 'HFD']], notes: 'The public source lacks a retained barcode-to-cell-type map. This mixed-cell estimate is not isolated-neuron expression.' }),
];

export function getExistingExpressionSource(id: string): ExpressionSource | undefined {
  return EXISTING_EXPRESSION_SOURCES.find((entry) => entry.id === id);
}
