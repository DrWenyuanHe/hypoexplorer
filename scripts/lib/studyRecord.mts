// One study's publication record: the single place a build script decides which
// verified paper describes a dataset, which repository record it links, which
// comparison it headlines and how many samples each track has in that
// comparison. The static study pages, the citation guide and the agent export
// all render from this record, so a dataset cannot have a verified paper on its
// study page and none in the export.
//
// Pure: the caller supplies the dataset, the committed source snapshot
// (data/seo/studySources.json) and the dataset meta as values. Nothing here
// reads a file, so either meta reader works and tests need no fixtures on disk.
import { contrastArmCounts, getActiveContrast } from '../../src/data/contrasts';
import type { Dataset, DatasetMeta, ResolvedContrast } from '../../src/types';
import { datasetPmid } from '../../src/utils/datasetLinks';
import { groupLabels } from '../../src/utils/sampleValues';
import { digits, normDoi } from './trackerIntegration.mjs';

/**
 * One entry of data/seo/studySources.json, keyed by dataset id or repository
 * accession. Only metadata verified against a source record belongs there.
 */
export interface StudySource {
  paperTitle?: string;
  paperUrl?: string;
  paperPmid?: string;
  paperDoi?: string;
  paperAuthors?: string[];
  paperCollectiveAuthors?: string[];
  paperYear?: string;
  paperJournal?: string;
  paperIsPreprint?: boolean;
  sourcePubmedIds?: string[];
  paperRelationship?: string;
  paperRelationshipNote?: string;
  sourceTitle?: string;
  summary?: string;
  overallDesign?: string;
  sourceUrl?: string;
}

export type StudySources = Readonly<Record<string, StudySource>>;

/**
 * The paper a study cites, or an explicit none. A verified publication carries
 * the whole snapshot entry (`source`) so renderers read authors, journal and
 * year from the same record whose identity was checked.
 */
export type StudyPublication =
  | {
    status: 'verified';
    source: StudySource;
    title: string;
    /** The PMID that tied the snapshot to the dataset; absent for a DOI-only match. */
    pmid: string | undefined;
    /** The snapshot's DOI without a doi.org URL prefix; absent when it records none. */
    doi: string | undefined;
    /** The snapshot's paper link, only when it is an https URL. */
    url: string | undefined;
  }
  | { status: 'none' };

/** One track's row: its sample counts in the default comparison, null when unknown. */
export interface StudyTrack {
  id: string;
  label: string;
  features: number | null;
  nBaseline: number | null;
  nCase: number | null;
}

export interface StudyRecord {
  /**
   * The snapshot entry for this dataset, or `{}`. Repository prose (title,
   * summary, design, relationship note) describes the deposit, not the paper,
   * so it renders whether or not the publication is verified.
   */
  source: StudySource;
  publication: StudyPublication;
  /** The PMID the study links: the registry's, else the verified publication's. */
  pmid: string | undefined;
  /** The DOI the study links: the verified publication's, else the registry's. */
  doi: string | undefined;
  /** The snapshot's repository record, only when it is an https URL. */
  repositoryUrl: string | undefined;
  /** The comparison the explorer opens first (`getActiveContrast`). */
  defaultContrast: ResolvedContrast | null;
  /** Its arm labels, with neutral fallbacks (`groupLabels`). */
  armLabels: { baselineLabel: string; caseLabel: string };
  /** Every track in the meta, in meta order; empty without meta. */
  tracks: StudyTrack[];
}

/** The snapshot entry for a dataset: keyed by its id, else by its accession. */
function sourceFor(dataset: Dataset, sources: StudySources): StudySource {
  return sources[dataset.id] ?? (dataset.geo ? sources[dataset.geo] : undefined) ?? {};
}

function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// A PMID compares by its digits ('PMID: 123' is 123). A value with no digits
// keeps its text, so a malformed registry PMID stays present and mismatched
// rather than reading as "no PMID".
const pmidKey = (value: string | null | undefined): string => (value?.trim() ? digits(value) || value.trim() : '');
const doiKey = (value: string | null | undefined): string => (value?.trim() ? normDoi(value.trim()) : '');
// The DOI to render: as recorded, but without a doi.org URL prefix, because
// renderers build the https://doi.org/ link themselves.
const bareDoi = (value: string | undefined): string | undefined =>
  value?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || undefined;

/**
 * The identity rule. A snapshot describes the dataset's publication only when
 * it has a title and one of these ties it to the registry:
 *   - its PMID equals the registry's PMID (the `pmid` field, else one named in
 *     the citation);
 *   - the registry names no PMID and the PMID is the source record's ONLY
 *     linked PubMed id;
 *   - its DOI equals the registry's DOI. Two empty DOIs are not a match.
 * PMIDs compare by digits and DOIs case-insensitively without a doi.org prefix,
 * as the dataset tracker matches publications. A snapshot that fails is dropped
 * whole: its title and authors are never shown beside another paper's DOI.
 */
function verifiedPublication(dataset: Dataset, source: StudySource): StudyPublication {
  if (!source.paperTitle) return { status: 'none' };
  const paperPmid = pmidKey(source.paperPmid);
  const registeredPmid = pmidKey(datasetPmid(dataset));
  const linkedIds = source.sourcePubmedIds ?? [];
  const pmidMatches = Boolean(paperPmid) && (paperPmid === registeredPmid
    || (!registeredPmid && linkedIds.length === 1 && pmidKey(linkedIds[0]) === paperPmid));
  const paperDoi = doiKey(source.paperDoi);
  const doiMatches = Boolean(paperDoi) && paperDoi === doiKey(dataset.doi);
  if (!pmidMatches && !doiMatches) return { status: 'none' };
  return {
    status: 'verified',
    source,
    title: source.paperTitle,
    pmid: pmidMatches ? paperPmid : undefined,
    doi: bareDoi(source.paperDoi),
    url: httpsUrl(source.paperUrl),
  };
}

const UNKNOWN = { nBaseline: null, nCase: null } as const;

/**
 * Per-track sample counts for the default contrast, through the arm-count
 * seam's tiers. `groupN` is study-wide (the bundle writer takes it from the
 * default track's design cells), so it counts the default track only. Every
 * other track has just its QC pair, which counts the study's pooled arms; that
 * pair stands for the default contrast's arms unless the default track shows
 * otherwise (its `groupN` count disagrees with its own pair, as on a factorial
 * default). Anything else is unknown and renders '–', never the study-wide n.
 */
function trackRows(dataset: Dataset, contrast: ResolvedContrast | null, meta: DatasetMeta | undefined): StudyTrack[] {
  if (!meta?.populations?.length) return [];
  const pooledOnly = { qcFlags: meta.qcFlags };
  const onDefault = contrastArmCounts(contrast, null, meta, dataset.defaultTrack);
  const pooledOnDefault = contrastArmCounts(contrast, null, pooledOnly, dataset.defaultTrack);
  const pooledIsDefaultContrast = !meta.groupN
    || (onDefault.nBaseline === pooledOnDefault.nBaseline && onDefault.nCase === pooledOnDefault.nCase);
  return meta.populations.map((id) => {
    const counts = id === dataset.defaultTrack ? onDefault
      : pooledIsDefaultContrast ? contrastArmCounts(contrast, null, pooledOnly, id)
        : UNKNOWN;
    return {
      id,
      label: meta.labels?.[id] || id,
      features: meta.nGenes?.[id] ?? null,
      nBaseline: counts.nBaseline,
      nCase: counts.nCase,
    };
  });
}

export function studyRecord(dataset: Dataset, sources: StudySources, meta?: DatasetMeta): StudyRecord {
  const source = sourceFor(dataset, sources);
  const publication = verifiedPublication(dataset, source);
  const defaultContrast = getActiveContrast(dataset);
  const verified = publication.status === 'verified' ? publication : undefined;
  return {
    source,
    publication,
    pmid: datasetPmid(dataset) || verified?.pmid,
    doi: (verified ? verified.doi : undefined) ?? dataset.doi,
    repositoryUrl: httpsUrl(source.sourceUrl),
    defaultContrast,
    armLabels: groupLabels(defaultContrast),
    tracks: trackRows(dataset, defaultContrast, meta),
  };
}
