/**
 * Refresh the committed SEO title snapshot from official source metadata.
 * Normal builds read data/seo/studySources.json and never need these local inputs
 * or a network connection. Missing local inputs preserve existing snapshot rows.
 *
 * npx tsx scripts/refresh_seo_sources.mts [--fetch-series] [--fetch-papers] [--check]
 * --fetch-series fills missing titles and publication links from official GEO records.
 * --fetch-papers requests PMIDs registered locally or linked by the source series.
 * No tracker survey prose, abstracts, author affiliation guesses, or credentials.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DATASETS } from '../src/data/datasets';
import { datasetPmid } from '../src/utils/datasetLinks';

interface SourceRecord {
  sourceTitle?: string;
  sourceUrl?: string;
  sourceMetadataPath?: string;
  sourceSha256?: string;
  sourceMetadataUrl?: string;
  sourceMetadataSha256?: string;
  sourcePubmedIds?: string[];
  paperTitle?: string;
  paperUrl?: string;
  paperPmid?: string;
  paperDoi?: string;
  paperAuthors?: string[];
  paperCollectiveAuthors?: string[];
  paperYear?: string;
  paperJournal?: string;
  paperMetadataUrl?: string;
  paperIsPreprint?: boolean;
  paperRelationship?: 'methods';
  paperRelationshipNote?: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'data/seo/studySources.json');
const previous: Record<string, SourceRecord> = existsSync(output)
  ? JSON.parse(readFileSync(output, 'utf8')) : {};
const datasets = Object.values(DATASETS);
const keys = new Set(datasets.map((dataset) => dataset.geo || dataset.id));
const snapshot: Record<string, SourceRecord> = Object.fromEntries(
  Object.entries(previous).filter(([key]) => keys.has(key)),
);

// Removes markup until none remains, so a removal cannot join a new tag.
function stripTags(value: string): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Decodes every entity in one pass, so an escaped entity such as &amp;lt; stays the text "&lt;".
function plain(value: string): string {
  return stripTags(value)
    .replace(/&(?:#(\d+)|#[xX]([\da-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_, decimal, hex, name) => (
      decimal ? String.fromCodePoint(Number(decimal)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : NAMED_ENTITIES[name]))
    .replace(/\s+/g, ' ').trim();
}

let localTitles = 0;
const localRoot = resolve(root, 'geo_replication/datasets');
if (existsSync(localRoot)) {
  for (const entry of readdirSync(localRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const metadata = resolve(localRoot, entry.name, 'metadata');
    if (!existsSync(metadata)) continue;
    for (const filename of readdirSync(metadata).sort()) {
      if (!filename.endsWith('_family.soft.gz')) continue;
      const path = resolve(metadata, filename);
      const bytes = readFileSync(path);
      const series = gunzipSync(bytes).toString('utf8').split(/^\^SAMPLE/m)[0];
      const accession = /^!Series_geo_accession = (.+)$/m.exec(series)?.[1].trim();
      const title = /^!Series_title = (.+)$/m.exec(series)?.[1].trim();
      if (!accession || !title || !keys.has(accession)) continue;
      const existing = snapshot[accession] || {};
      if (existing.sourceTitle && existing.sourceTitle !== title) {
        throw new Error(`Conflicting source titles for ${accession}: review the source record before replacing it.`);
      }
      snapshot[accession] = {
        ...existing,
        sourceTitle: title,
        sourceUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
        sourceMetadataPath: relative(root, path).replaceAll('\\', '/'),
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      };
      localTitles++;
    }
  }
}

if (process.argv.includes('--fetch-series')) {
  const accessions = [...new Set(datasets.map((dataset) => dataset.geo)
    .filter((accession): accession is string => !!accession && /^GSE\d+$/.test(accession)))].sort();
  for (const accession of accessions) {
    const existing = snapshot[accession] || {};
    if (existing.sourceTitle && (existing.paperTitle || existing.sourcePubmedIds)) continue;
    const url = `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}&targ=self&form=text&view=quick`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`GEO metadata request failed for ${accession}: HTTP ${response.status}`);
    const text = await response.text();
    const series = text.split(/^\^SAMPLE/m)[0];
    const returnedAccession = /^!Series_geo_accession = (.+)$/m.exec(series)?.[1].trim();
    const title = /^!Series_title = (.+)$/m.exec(series)?.[1].trim();
    if (returnedAccession !== accession || !title) throw new Error(`GEO returned no matching series metadata for ${accession}`);
    if (existing.sourceTitle && existing.sourceTitle !== title) throw new Error(`GEO title changed for ${accession}; review before replacing it.`);
    snapshot[accession] = { ...existing, sourceTitle: title,
      sourceUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
      sourceMetadataUrl: url, sourceMetadataSha256: createHash('sha256').update(text).digest('hex'),
      sourcePubmedIds: [...series.matchAll(/^!Series_pubmed_id = (\d+)\s*$/gm)].map((match) => match[1]),
    };
    console.log(`Verified GEO title: ${accession}`);
    // Stay below NCBI's unauthenticated request rate.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  for (const accession of [...keys].filter((key) => /^E-MTAB-\d+$/.test(key) && !snapshot[key]?.sourceTitle)) {
    const url = `https://www.ebi.ac.uk/biostudies/api/v1/studies/${accession}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`BioStudies request failed for ${accession}: HTTP ${response.status}`);
    const text = await response.text();
    const body = JSON.parse(text) as { accno?: string; attributes?: { name: string; value: string }[] };
    const title = body.attributes?.find((attribute) => attribute.name === 'Title')?.value;
    if (body.accno !== accession || !title) throw new Error(`BioStudies returned no matching metadata for ${accession}`);
    snapshot[accession] = { ...snapshot[accession], sourceTitle: plain(title),
      sourceUrl: `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${accession}`,
      sourceMetadataUrl: url, sourceMetadataSha256: createHash('sha256').update(text).digest('hex') };
  }
}

// A single source-linked PMID can fill a missing registry citation. Multiple
// papers require review; never pick an arbitrary article from a superseries.
const pmidFor = (dataset: typeof datasets[number]): string | undefined => {
  const registered = datasetPmid(dataset);
  if (registered) return registered;
  const linked = snapshot[dataset.geo || dataset.id]?.sourcePubmedIds;
  return linked?.length === 1 ? linked[0] : undefined;
};

if (process.argv.includes('--fetch-papers')) {
  const pmids = [...new Set(datasets.map(pmidFor).filter((pmid): pmid is string => !!pmid && /^\d+$/.test(pmid)))];
  for (let offset = 0; offset < pmids.length; offset += 100) {
    const batch = pmids.slice(offset, offset + 100);
    const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    url.search = new URLSearchParams({ db: 'pubmed', id: batch.join(','), retmode: 'json', tool: 'HypoExplorer' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`NCBI metadata request failed: HTTP ${response.status}`);
    const body = await response.json() as { result?: Record<string, unknown> };
    for (const pmid of batch) {
      const paper = body.result?.[pmid] as { uid?: string; title?: string; authors?: { name?: string; authtype?: string }[]; articleids?: { idtype: string; value: string }[]; pubdate?: string; fulljournalname?: string; error?: string } | undefined;
      if (!paper || paper.uid !== pmid || !paper.title || paper.error) {
        console.warn(`No official paper title returned for PMID ${pmid}; keeping existing metadata.`);
        continue;
      }
      const title = plain(paper.title);
      const doi = paper.articleids?.find((id) => id.idtype === 'doi')?.value;
      const authors = paper.authors?.map((author) => author.name).filter((name): name is string => !!name);
      const collectives = paper.authors?.filter((author) => author.authtype === 'CollectiveName').map((author) => author.name).filter((name): name is string => !!name);
      const year = paper.pubdate?.match(/^\d{4}/)?.[0];
      for (const dataset of datasets.filter((dataset) => pmidFor(dataset) === pmid)) {
        const key = dataset.geo || dataset.id;
        snapshot[key] = { ...snapshot[key], paperTitle: title,
          paperUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, paperPmid: pmid,
          ...(doi ? { paperDoi: doi } : {}), ...(authors?.length ? { paperAuthors: authors } : {}),
          ...(collectives?.length ? { paperCollectiveAuthors: collectives } : {}),
          ...(year ? { paperYear: year } : {}), ...(paper.fulljournalname ? { paperJournal: plain(paper.fulljournalname) } : {}) };
      }
    }
  }
  for (const dataset of datasets) {
    const key = dataset.geo || dataset.id;
    if (snapshot[key]?.paperTitle || !/^10\.\d{4,9}\//.test(dataset.doi || '')) continue;
    const url = `https://api.crossref.org/works/${encodeURIComponent(dataset.doi)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Crossref request failed for ${key}: HTTP ${response.status}`);
    const { message: paper } = await response.json() as { message: { DOI?: string; title?: string[]; type?: string; subtype?: string;
      author?: { given?: string; family?: string; name?: string }[]; published?: { 'date-parts'?: number[][] }; 'container-title'?: string[] } };
    if (paper.DOI?.toLowerCase() !== dataset.doi.toLowerCase() || !paper.title?.[0]
      || !['journal-article', 'posted-content'].includes(paper.type || '')) throw new Error(`Crossref returned no matching publication for ${key}`);
    const year = paper.published?.['date-parts']?.[0]?.[0];
    snapshot[key] = { ...snapshot[key], paperTitle: plain(paper.title[0]), paperDoi: dataset.doi,
      paperUrl: `https://doi.org/${dataset.doi}`, paperMetadataUrl: url,
      paperAuthors: paper.author?.map((author) => plain(author.name || [author.given, author.family].filter(Boolean).join(' '))).filter(Boolean),
      ...(year ? { paperYear: String(year) } : {}),
      ...(paper['container-title']?.[0] ? { paperJournal: plain(paper['container-title'][0]) } : {}),
      ...(paper.subtype === 'preprint' ? { paperIsPreprint: true } : {}),
    };
  }
}

const serialized = `${JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== serialized) {
    throw new Error('SEO source snapshot differs; run scripts/refresh_seo_sources.mts and review the changes.');
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, serialized);
}
console.log(`SEO sources: ${Object.keys(snapshot).length} integrated records, ${Object.values(snapshot).filter((row) => row.sourceTitle).length} official series titles, ${Object.values(snapshot).filter((row) => row.paperTitle).length} official paper titles (${localTitles} local source files checked).`);
