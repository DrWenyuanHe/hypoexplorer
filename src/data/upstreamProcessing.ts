// The depositor's upstream processing for each study: the aligner, genome build,
// annotation and quantifier that produced the matrix HypoExplorer starts from.
//
// HypoExplorer reuses deposited matrices rather than realigning reads, so these
// are the DEPOSITORS' choices, recorded from their repository processing notes
// (GEO !Sample_data_processing, ArrayExpress IDF protocols) or the paper's
// methods. The reviewed table is geo_replication/config/upstream_processing.tsv;
// scripts/build_upstream_processing.mts emits the compact JSON read here.

import upstream from './upstreamProcessing.generated.json';
import type { Dataset } from '../types';

export type UpstreamEvidenceKind = 'geo_data_processing' | 'ae_idf_protocol' | 'paper_methods' | 'not_stated';
export type UpstreamReviewStatus = 'parsed' | 'reviewed' | 'not_stated' | 'needs_review';

/** One accession's upstream processing. An absent field was not stated. */
export interface UpstreamProcessing {
  aligner?: string;
  genome?: string;
  annotation?: string;
  quantifier?: string;
  /** Qualified source-method details, retained in the reviewed evidence row. */
  notes?: string;
  evidence: UpstreamEvidenceKind;
  status: UpstreamReviewStatus;
}

/**
 * Registered datasets whose source accession is not a `geo` field. The macaque
 * atlas's deposit is the CNGB project, which the registry does not carry as `geo`.
 */
export const NON_GEO_ACCESSIONS: Readonly<Record<string, string>> = {
  macaque_snrna: 'CNP0003785',
};

export const UPSTREAM_PROCESSING = upstream as Record<string, UpstreamProcessing>;

/** The source accession an upstream-processing record is keyed by. */
export function sourceAccession(dataset: Pick<Dataset, 'id' | 'geo'>): string | undefined {
  return dataset.geo || NON_GEO_ACCESSIONS[dataset.id];
}

export function upstreamProcessingFor(dataset: Pick<Dataset, 'id' | 'geo'>): UpstreamProcessing | undefined {
  const accession = sourceAccession(dataset);
  return accession ? UPSTREAM_PROCESSING[accession] : undefined;
}

const EVIDENCE_LABEL: Record<UpstreamEvidenceKind, string> = {
  geo_data_processing: "the depositor's GEO data-processing notes",
  ae_idf_protocol: "the depositor's ArrayExpress protocols",
  paper_methods: "the source paper's methods",
  not_stated: 'no depositor record',
};

/**
 * "STAR 2.5.1b · mm9 · Ensembl 67 (as deposited)", or null when the depositor
 * stated none of the four. The quantifier is listed only when it is not the
 * aligner itself (Cell Ranger, Salmon and CLC do both).
 */
export function upstreamSummary(record: UpstreamProcessing | undefined): string | null {
  if (!record) return null;
  const parts = [record.aligner, record.genome, record.annotation];
  const alignerName = record.aligner?.split(' ')[0];
  if (record.quantifier && record.quantifier.split(' ')[0] !== alignerName) parts.push(record.quantifier);
  const stated = parts.filter((part): part is string => !!part);
  return stated.length ? `${stated.join(' · ')} (as deposited)` : null;
}

/** Tooltip text naming where the summary came from. */
export function upstreamSource(record: UpstreamProcessing | undefined): string {
  if (!record) return 'No upstream-processing record for this accession.';
  const review = record.status === 'needs_review'
    ? ' Not yet confirmed against the source.'
    : record.status === 'parsed' ? ' Parsed automatically; not yet reviewed.' : '';
  const notes = record.notes ? ` ${record.notes}` : '';
  return `From ${EVIDENCE_LABEL[record.evidence]}.${review}${notes} HypoExplorer starts from the deposited matrix and does not realign reads.`;
}

export const UPSTREAM_NOT_STATED = 'Not stated by depositor';
export const UPSTREAM_PENDING = "Not yet recorded from the source paper's methods";

/**
 * The one-line fact both the study record and the prerendered study page show.
 * Null only when the accession has no record at all, which the closure check
 * in scripts/build_upstream_processing.mts --check forbids for registered data.
 */
export function upstreamDisplay(record: UpstreamProcessing | undefined): string | null {
  if (!record) return null;
  const summary = upstreamSummary(record);
  if (summary) return summary;
  return record.status === 'needs_review' ? UPSTREAM_PENDING : UPSTREAM_NOT_STATED;
}
