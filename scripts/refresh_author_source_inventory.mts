/**
 * Refresh the official database/paper-access inventory used by the author
 * validation review. This script intentionally records only what the
 * repositories themselves expose; scientific interpretation of a file (for
 * example, whether a DE table is the same contrast as ours) lives in the
 * reviewed validation sidecar, not in filename heuristics here.
 *
 * Network refresh:
 *   npx tsx scripts/refresh_author_source_inventory.mts
 * Incremental refresh (preserves other records and report metadata):
 *   npx tsx scripts/refresh_author_source_inventory.mts --dataset=<registry-id>
 * Offline closure check:
 *   npx tsx scripts/refresh_author_source_inventory.mts --check
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS } from '../src/data/datasets';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'data', 'author-validation', 'source-inventory.generated.json');
const CHECK = process.argv.includes('--check');
const EXCLUDED_DATASET = 'macaque_snrna';
const args = process.argv.slice(2);
const datasetArgs = args.filter((arg) => arg.startsWith('--dataset='));
if (datasetArgs.length > 1 || args.some((arg) => arg !== '--check' && !arg.startsWith('--dataset='))) {
  throw new Error('Usage: refresh_author_source_inventory.mts [--check] [--dataset=<registry-id>]');
}
const datasetId = datasetArgs[0]?.slice('--dataset='.length);
if (datasetArgs.length && (!datasetId || !DATASETS.some((dataset) => dataset.id === datasetId))) {
  throw new Error(`Unknown registry dataset: ${datasetId || '(empty)'}`);
}
const selectedDatasets = datasetId ? DATASETS.filter((dataset) => dataset.id === datasetId) : DATASETS;

interface DepositedFile {
  name: string;
  url: string;
  bytes: number | null;
  repositorySection: string | null;
}

interface InventoryRecord {
  datasetId: string;
  accession: string;
  /** Accession whose supplementary directory contains the analysis input.
   *  Usually the registry accession; two GEO SuperSeries delegate it. */
  processedDataAccession: string;
  database: 'GEO' | 'BioStudies' | 'CNGB';
  databaseRecordUrl: string;
  processedInventoryUrl: string;
  processedInventoryAccess: 'listed' | 'empty' | 'unavailable' | 'excluded';
  processedInventoryHttpStatus: number | null;
  depositedFiles: DepositedFile[];
  pmid: string | null;
  paperAccess: 'pmc_full_text' | 'pubmed_record_only' | 'no_linked_publication';
  pubmedUrl: string | null;
  pmcId: string | null;
  pmcUrl: string | null;
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const PROCESSED_DATA_ACCESSION: Record<string, string> = {
  // The registry entries are public SuperSeries. Their own /suppl directories
  // correctly 404; the named SubSeries carry the matrices used by our tracks.
  GSE162563: 'GSE155314',
  GSE153551: 'GSE153549',
};

async function fetchWithRetry(url: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'MonkeyBrainAuthorValidation/1.0' },
        redirect: 'follow',
      });
      if (response.status !== 429 && response.status < 500) return response;
      last = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      last = error;
    }
    await sleep(500 * (attempt + 1));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function geoSeriesStem(accession: string): string {
  return accession.replace(/\d{3}$/, 'nnn');
}

function htmlFiles(html: string, baseUrl: string): DepositedFile[] {
  const out: DepositedFile[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi)) {
    const href = match[1];
    // Apache's standard footer links to the HHS disclosure policy. Only
    // relative directory entries are deposited files; absolute/root links are
    // navigation, never evidence for the study.
    if (!href || href.startsWith('/') || /^[a-z]+:/i.test(href) || href === '../' || href === 'filelist.txt') continue;
    const name = decodeURIComponent(href).replace(/\/$/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, url: new URL(href, baseUrl).toString(), bytes: null, repositorySection: 'supplementary' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function collectBioStudiesFiles(value: unknown, baseUrl: string, section: string | null = null): DepositedFile[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectBioStudiesFiles(item, baseUrl, section));
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  const currentSection = typeof row.type === 'string' && row.type !== 'file' ? row.type : section;
  const own = row.type === 'file' && typeof row.path === 'string'
    ? [{
        name: row.path,
        url: new URL(encodeURIComponent(row.path).replaceAll('%2F', '/'), baseUrl).toString(),
        bytes: typeof row.size === 'number' ? row.size : null,
        repositorySection: currentSection,
      }]
    : [];
  return [
    ...own,
    ...Object.values(row).flatMap((item) => collectBioStudiesFiles(item, baseUrl, currentSection)),
  ];
}

async function paperMap(datasets: typeof DATASETS): Promise<Map<string, string>> {
  const pmids = [...new Set(datasets.map((dataset) => dataset.pmid).filter((id): id is string => Boolean(id)))];
  if (!pmids.length) return new Map();
  const url = new URL('https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/');
  url.searchParams.set('ids', pmids.join(','));
  url.searchParams.set('format', 'json');
  url.searchParams.set('tool', 'MonkeyBrainAuthorValidation');
  const response = await fetchWithRetry(url.toString());
  if (!response.ok) throw new Error(`PMC id converter: ${response.status} ${response.statusText}`);
  const payload = await response.json() as { records?: Array<{ pmid?: number | string; pmcid?: string }> };
  return new Map(
    (payload.records ?? [])
      .filter((record): record is { pmid: number | string; pmcid: string } => Boolean(record.pmid && record.pmcid))
      .map((record) => [String(record.pmid), record.pmcid]),
  );
}

async function inventory(dataset: (typeof DATASETS)[number], pmcByPmid: Map<string, string>): Promise<InventoryRecord> {
  const accession = dataset.geo ?? '';
  const pmid = dataset.pmid ?? null;
  const pmcId = pmid ? pmcByPmid.get(pmid) ?? null : null;
  const paper = {
    pmid,
    paperAccess: !pmid
      ? 'no_linked_publication' as const
      : pmcId
        ? 'pmc_full_text' as const
        : 'pubmed_record_only' as const,
    pubmedUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
    pmcId,
    pmcUrl: pmcId ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcId}/` : null,
  };

  if (dataset.id === EXCLUDED_DATASET) {
    return {
      datasetId: dataset.id,
      accession,
      processedDataAccession: accession,
      database: 'CNGB',
      databaseRecordUrl: 'https://db.cngb.org/search/project/CNP0003785/',
      processedInventoryUrl: 'https://db.cngb.org/search/project/CNP0003785/',
      processedInventoryAccess: 'excluded',
      processedInventoryHttpStatus: null,
      depositedFiles: [],
      ...paper,
    };
  }

  if (accession.startsWith('GSE')) {
    const processedDataAccession = PROCESSED_DATA_ACCESSION[accession] ?? accession;
    const base = `https://ftp.ncbi.nlm.nih.gov/geo/series/${geoSeriesStem(processedDataAccession)}/${processedDataAccession}/suppl/`;
    try {
      const response = await fetchWithRetry(base);
      const html = response.ok ? await response.text() : '';
      const files = response.ok ? htmlFiles(html, base) : [];
      return {
        datasetId: dataset.id,
        accession,
        processedDataAccession,
        database: 'GEO',
        databaseRecordUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
        processedInventoryUrl: base,
        processedInventoryAccess: !response.ok ? 'unavailable' : files.length ? 'listed' : 'empty',
        processedInventoryHttpStatus: response.status,
        depositedFiles: files,
        ...paper,
      };
    } catch {
      return {
        datasetId: dataset.id,
        accession,
        processedDataAccession,
        database: 'GEO',
        databaseRecordUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
        processedInventoryUrl: base,
        processedInventoryAccess: 'unavailable',
        processedInventoryHttpStatus: null,
        depositedFiles: [],
        ...paper,
      };
    }
  }

  const api = `https://www.ebi.ac.uk/biostudies/api/v1/studies/${accession}`;
  const base = `https://www.ebi.ac.uk/biostudies/files/${accession}/`;
  try {
    const response = await fetchWithRetry(api);
    const payload = response.ok ? await response.json() : null;
    const files = response.ok
      ? collectBioStudiesFiles(payload, base).filter((file, index, all) =>
          all.findIndex((other) => other.name === file.name) === index)
      : [];
    return {
      datasetId: dataset.id,
      accession,
      processedDataAccession: accession,
      database: 'BioStudies',
      databaseRecordUrl: `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${accession}`,
      processedInventoryUrl: api,
      processedInventoryAccess: !response.ok ? 'unavailable' : files.length ? 'listed' : 'empty',
      processedInventoryHttpStatus: response.status,
      depositedFiles: files.sort((a, b) => a.name.localeCompare(b.name)),
      ...paper,
    };
  } catch {
    return {
      datasetId: dataset.id,
      accession,
      processedDataAccession: accession,
      database: 'BioStudies',
      databaseRecordUrl: `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${accession}`,
      processedInventoryUrl: api,
      processedInventoryAccess: 'unavailable',
      processedInventoryHttpStatus: null,
      depositedFiles: [],
      ...paper,
    };
  }
}

function assertClosure(report: { datasets: InventoryRecord[] }): void {
  const expected = DATASETS.map((dataset) => dataset.id).sort();
  const observed = report.datasets.map((dataset) => dataset.datasetId).sort();
  if (new Set(observed).size !== observed.length || JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new Error('source inventory does not contain exactly one record per registry dataset');
  }
  const excluded = report.datasets.find((dataset) => dataset.datasetId === EXCLUDED_DATASET);
  if (excluded?.processedInventoryAccess !== 'excluded') {
    throw new Error(`${EXCLUDED_DATASET} must be explicitly marked excluded`);
  }
}

function priorInventory(): Record<string, unknown> & { datasets: InventoryRecord[] } {
  if (!existsSync(OUTPUT)) throw new Error('Incremental refresh requires an existing source inventory');
  const report = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Record<string, unknown> & { datasets: InventoryRecord[] };
  if (!Array.isArray(report.datasets)) throw new Error('Existing source inventory has no dataset records');
  const previousIds = report.datasets.map((record) => record.datasetId);
  const registryIds = new Set(DATASETS.map((dataset) => dataset.id));
  if (new Set(previousIds).size !== previousIds.length || previousIds.some((id) => !registryIds.has(id))) {
    throw new Error('Incremental refresh cannot repair duplicate or unregistered existing records');
  }
  const missingOther = DATASETS.filter((dataset) => dataset.id !== datasetId && !previousIds.includes(dataset.id));
  if (missingOther.length) {
    throw new Error(`Incremental refresh cannot supply unrelated missing records: ${missingOther.map((dataset) => dataset.id).join(', ')}`);
  }
  return report;
}

if (CHECK) {
  if (!existsSync(OUTPUT)) throw new Error('source inventory is missing; run the refresh first');
  const report = JSON.parse(readFileSync(OUTPUT, 'utf8')) as { datasets: InventoryRecord[] };
  assertClosure(report);
  process.stdout.write(`author source inventory has registry closure (${report.datasets.length} datasets)\n`);
} else {
  // Validate local coverage before making any requests. An incremental intake
  // must not silently refresh unrelated repository or publication observations.
  const previous = datasetId ? priorInventory() : null;
  const pmcByPmid = await paperMap(selectedDatasets);
  const records: InventoryRecord[] = [];
  // A small fixed pool is courteous to the public archives and still reduces
  // the 144 independent round trips from minutes to seconds.
  const queue = [...selectedDatasets];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const dataset = queue.shift();
      if (dataset) records.push(await inventory(dataset, pmcByPmid));
    }
  });
  await Promise.all(workers);
  records.sort((a, b) => DATASETS.findIndex((dataset) => dataset.id === a.datasetId)
    - DATASETS.findIndex((dataset) => dataset.id === b.datasetId));
  const fullReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      geo: 'NCBI GEO official supplementary directories',
      biostudies: 'EMBL-EBI BioStudies API',
      paperAccess: 'NCBI PMC ID Converter',
    },
    datasets: records,
  };
  const replacements = new Map(records.map((record) => [record.datasetId, record]));
  const report = previous ? {
    ...previous,
    datasets: [
      ...previous.datasets.map((record) => replacements.get(record.datasetId) ?? record),
      ...records.filter((record) => !previous.datasets.some((prior) => prior.datasetId === record.datasetId)),
    ],
  } : fullReport;
  assertClosure(report);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  const unavailable = records.filter((record) => record.processedInventoryAccess === 'unavailable').length;
  const fullText = records.filter((record) => record.paperAccess === 'pmc_full_text').length;
  process.stdout.write(`wrote official source inventory: ${report.datasets.length} datasets; refreshed ${records.length}${datasetId ? ` (${datasetId})` : ''}, ${unavailable} unavailable inventories, ${fullText} PMC full texts\n`);
}
