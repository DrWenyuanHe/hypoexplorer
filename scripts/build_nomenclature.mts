// Build the GENE NOMENCLATURE TABLE: every gene symbol the corpus actually
// stores, joined against the official nomenclature authority for its species,
// so a reader can check whether a symbol on screen is the current one.
//
// THE PROBLEM
// -----------
// A symbol in a DE table is whatever the upstream analysis called it on the day
// it was run. Nomenclature moves: symbols get replaced (the old one becomes a
// `prev_symbol` on the new record), and informal names circulate for years as
// aliases. Nothing in the explorer could tell those apart, so three questions
// had no answer anywhere on the site:
//
//   1. Is the symbol I am looking at the CURRENT one?
//   2. I know this gene by another name — is it in here under a different one?
//   3. What does the corpus actually call it, so I can search for it?
//
// This script answers all three offline, once, and writes the answer down.
//
// THE OUTPUT IS SOURCE, NOT AN ARTIFACT
// -------------------------------------
// `data/nomenclature/nomenclature.tsv` is COMMITTED and is the source of truth.
// That is deliberate and is the opposite of how public/query/ is treated (a
// build artifact, gitignored, regenerated at will):
//
//   * It is small enough to track (a few MB) and changes only when a nomenclature
//     authority does or when a dataset joins the corpus — a handful of times a
//     year, not on every data rebuild.
//   * It is the thing being CHECKED. A reviewer asking "was AGRP current when
//     you published?" needs a file with a history, not a regenerated snapshot of
//     whatever HGNC says today. The git log IS the audit trail.
//   * The upstream authority files are gitignored — same
//     split as scripts/lib/MRK_ENSEMBL.rpt vs the derived mmus_ens2sym.json.
//
// `public/nomenclature/*.js` are the runtime projections of that TSV, also
// committed, because they ship with the app rather than with the bundles (see
// the note above emitJsonp).
//
// AUTHORITIES
// -----------
//   Mus musculus         -> MGI (informatics.jax.org), MRK_List1.rpt, which is
//                           the only MGI report carrying WITHDRAWN symbols and
//                           their replacements — the whole point of column 14.
//   Rattus norvegicus    -> RGD (download.rgd.mcw.edu), GENES_RAT.txt plus
//                           GENES_OBSOLETE_IDS.txt for retired replacements.
//   Macaca fascicularis  -> HGNC (genenames.org), hgnc_complete_set.txt.
//   Macaca mulatta       -> HGNC for the same human-ortholog namespace reason.
//   Homo sapiens         -> HGNC.
//   Gallus gallus        -> NCBI Gene's species-specific gene_info export.
//   Danio rerio          -> NCBI Gene's species-specific gene_info export.
//   Sus scrofa           -> NCBI Gene's species-specific gene_info export.
//   Bos taurus           -> NCBI Gene's species-specific gene_info export.
//   Phodopus sungorus    -> MGI, because every accepted hamster dataset carries
//                           an explicit AUTHOR-PROVIDED mouse feature projection.
//   Eliomys quercinus    -> MGI for the same author-provided mouse projection.
//
// Using a HUMAN authority for macaque is a deliberate call, not an oversight.
// The macaque tables carry human-style symbols (DNASE1L2, C4orf33) because the
// upstream Lei et al. analysis mapped its features onto human orthologs; those
// symbols live in the human namespace and HGNC is what governs them. The
// explorer says so wherever the result is shown — see NomenclatureView's
// authority note. Checking them against a Macaca gene set instead would score
// every human-specific name as unrecognized and teach the reader nothing.
//
// Usage:
//   tsx scripts/build_nomenclature.mts --fetch    download the authority files first
//   tsx scripts/build_nomenclature.mts            rebuild from the cached downloads
//   tsx scripts/build_nomenclature.mts --check    rebuild in memory and diff against
//                                                 the committed outputs (CI guard)
//   --refresh-authority=RGD                       refresh rat classifications only;
//                                                 retain other authority decisions
//   --refresh-authority=RGD --fetch               fetch only the two RGD files first
//   --allow-missing                               accept datasets with no local
//                                                 bundles (otherwise a hard error)

import { readFile, writeFile, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { listDatasets } from '../src/data/datasets';
import {
  NOMENCLATURE_AUTHORITIES,
  NOMENCLATURE_AUTHORITY_BY_ORGANISM,
  NOMENCLATURE_AUTHORITY_ID_PREFIX,
  NOMENCLATURE_STORED_DATASET_OVERRIDES,
  NOMENCLATURE_STATUS,
  nomenclatureAuthorityForStoredDatasetSymbols,
  type NomenclatureAuthority,
  type NomenclatureStatus,
} from '../src/data/nomenclatureWire';
import {
  NOMENCLATURE_TSV_COLUMNS as TSV_COLUMNS,
  nomenclatureKey,
  parseRetainedNomenclature,
  refreshRetainedRgdSources,
  reuseRetainedNomenclature,
  type NomenclatureRow,
  type NomenclatureSourceFacts,
} from './lib/nomenclatureRetained.mjs';
import { selectRgdRecords } from './lib/rgdRecords.mjs';

const DATASETS_DIR = path.resolve('public/datasets');
const CACHE_DIR = path.resolve('scripts/lib/nomenclature-cache');
const TSV_OUT = path.resolve('data/nomenclature/nomenclature.tsv');
const META_OUT = path.resolve('data/nomenclature/sources.json');
const RUNTIME_DIR = path.resolve('public/nomenclature');

const HGNC_URL = 'https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt';
const MGI_URL = 'https://www.informatics.jax.org/downloads/reports/MRK_List1.rpt';
const RGD_GENES_URL = 'https://download.rgd.mcw.edu/pub/data_release/GENES_RAT.txt';
const RGD_OBSOLETE_URL = 'https://download.rgd.mcw.edu/pub/data_release/GENES_OBSOLETE_IDS.txt';
const NCBI_GENE_INFO_BASE = 'https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO';

interface NcbiGeneInfoSource {
  authority: NomenclatureAuthority;
  organism: string;
  taxId: string;
  file: string;
  url: string;
  sourceKey: string;
}

const NCBI_GENE_INFO_SOURCES: NcbiGeneInfoSource[] = [
  {
    authority: 'NCBI Gene (Gallus gallus)', organism: 'Gallus gallus', taxId: '9031',
    file: 'Gallus_gallus.gene_info.gz', sourceKey: 'ncbiGeneGallusGallus',
    url: `${NCBI_GENE_INFO_BASE}/Non-mammalian_vertebrates/Gallus_gallus.gene_info.gz`,
  },
  {
    authority: 'NCBI Gene (Danio rerio)', organism: 'Danio rerio', taxId: '7955',
    file: 'Danio_rerio.gene_info.gz', sourceKey: 'ncbiGeneDanioRerio',
    url: `${NCBI_GENE_INFO_BASE}/Non-mammalian_vertebrates/Danio_rerio.gene_info.gz`,
  },
  {
    authority: 'NCBI Gene (Sus scrofa)', organism: 'Sus scrofa', taxId: '9823',
    file: 'Sus_scrofa.gene_info.gz', sourceKey: 'ncbiGeneSusScrofa',
    url: `${NCBI_GENE_INFO_BASE}/Mammalia/Sus_scrofa.gene_info.gz`,
  },
  {
    authority: 'NCBI Gene (Bos taurus)', organism: 'Bos taurus', taxId: '9913',
    file: 'Bos_taurus.gene_info.gz', sourceKey: 'ncbiGeneBosTaurus',
    url: `${NCBI_GENE_INFO_BASE}/Mammalia/Bos_taurus.gene_info.gz`,
  },
];

const argv = new Set(process.argv.slice(2));
const FETCH = argv.has('--fetch');
const CHECK = argv.has('--check');
const refreshArguments = [...argv].filter(arg => arg.startsWith('--refresh-authority'));
if (refreshArguments.length && (refreshArguments.length !== 1 || refreshArguments[0] !== '--refresh-authority=RGD')) {
  throw new Error('The only supported bounded refresh is --refresh-authority=RGD');
}
const REFRESH_RGD = refreshArguments.length === 1;
// Escape hatch for a machine that legitimately lacks some local bundles (the
// data is moving to R2). WITHOUT it, a dataset scanning to zero symbols is a
// hard error: silently skipping would shrink aliases.js/table.js and deflate
// every datasetCount, and --check would then enforce the shrunken table as
// the committed truth.
const ALLOW_MISSING = argv.has('--allow-missing');

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * How a stored symbol relates to its authority.
 *
 *   current      the authority's approved symbol — nothing to do
 *   previous     the authority REPLACED this symbol; `currentSymbol` is what it
 *                is called now. This is the finding that matters.
 *   alias        never an official symbol, but a recognized informal name for
 *                one. Not an error: plenty of pipelines legitimately emit these.
 *   unrecognized the authority has no record of it under any of the three. Mostly
 *                predicted-gene and clone identifiers (Gm…, …Rik, LOC…), which is
 *                why the page reports them as a class rather than as defects.
 */
type Authority = NomenclatureAuthority;
type SymbolStatus = NomenclatureStatus;

interface AuthorityRecord {
  symbol: string;
  name: string;
  id: string;
  locusType: string;
  aliases: string[];
  prevSymbols: string[];
}

/** One authority, indexed three ways so a lookup can say WHY it matched. */
interface AuthorityIndex {
  name: Authority;
  /** UPPERCASE symbol -> the approved record. */
  approved: Map<string, AuthorityRecord>;
  /** UPPERCASE retired symbol -> the approved symbols that replaced it. */
  previous: Map<string, string[]>;
  /** UPPERCASE alias -> the approved symbols that list it. */
  alias: Map<string, string[]>;
  /** Provenance, written to sources.json so the page can cite a release. */
  source: { url: string; file: string; bytes: number; records: number };
  /** Extra authority files needed to classify retired symbols. */
  supplementarySources?: Array<{ url: string; file: string; bytes: number; records: number }>;
  /** Active IDs cannot be uniquely selected; never turn these names into redirects. */
  ambiguities?: Map<string, string[]>;
}

// ── Small helpers ───────────────────────────────────────────────────────────

/**
 * Split one of HGNC's pipe-joined multi-value cells.
 *
 * HGNC wraps a cell in literal double quotes when it holds more than one value
 * ("Agrt|ART|ASIP2") — those are CONTENT in a tab-separated file, not CSV
 * quoting, so nothing upstream strips them and a naive split would carry a quote
 * into the first and last alias.
 */
function splitCell(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^"/, '')
    .replace(/"$/, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** RGD uses semicolons for every multi-value field in its tab-delimited exports. */
function splitSemicolonCell(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(';').map((s) => s.trim()).filter(Boolean);
}

/** NCBI gene_info uses '-' for missing and pipes for multi-value cells. */
function splitNcbiCell(value: string | undefined): string[] {
  if (!value || value === '-') return [];
  return value.split('|').map((s) => s.trim()).filter((s) => s && s !== '-');
}

function ncbiValue(value: string | undefined): string {
  return !value || value === '-' ? '' : value;
}

/** Record a one-to-many mapping (retired symbols and aliases are not unique). */
function pushMulti(map: Map<string, string[]>, key: string, value: string): void {
  const at = map.get(key);
  if (at) { if (!at.includes(value)) at.push(value); }
  else map.set(key, [value]);
}

async function fileFacts(file: string): Promise<{ file: string; bytes: number }> {
  const s = await stat(file);
  return { file: path.basename(file), bytes: s.size };
}

// ── Fetching the authority files ────────────────────────────────────────────

/**
 * Download an authority file into the gitignored cache.
 *
 * Written to a `.part` file and renamed only on success, so an interrupted
 * download can never leave a truncated file that the next run would silently
 * parse as a complete (and much smaller) nomenclature.
 */
async function download(url: string, dest: string): Promise<void> {
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 1_000_000) {
    throw new Error(`${url} returned only ${body.length} bytes — refusing to cache a truncated authority file`);
  }
  await writeFile(`${dest}.part`, body);
  await rename(`${dest}.part`, dest);
  process.stdout.write(`    ${(body.length / 1e6).toFixed(1)} MB -> ${path.relative(process.cwd(), dest)}\n`);
}

// ── Parsing the authorities ─────────────────────────────────────────────────

async function loadHGNC(): Promise<AuthorityIndex> {
  const file = path.join(CACHE_DIR, 'hgnc_complete_set.txt');
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t');
  const col = (n: string) => {
    const i = header.indexOf(n);
    if (i === -1) throw new Error(`hgnc_complete_set.txt has no '${n}' column — the format changed`);
    return i;
  };
  const iSym = col('symbol'), iName = col('name'), iId = col('hgnc_id');
  const iLocus = col('locus_type'), iStatus = col('status');
  const iAlias = col('alias_symbol'), iPrev = col('prev_symbol');

  const index: AuthorityIndex = {
    name: 'HGNC',
    approved: new Map(), previous: new Map(), alias: new Map(),
    source: { url: HGNC_URL, ...(await fileFacts(file)), records: 0 },
  };

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const symbol = c[iSym];
    // The complete set is approved-only today, but the status column exists and
    // an entry withdrawn between releases must not become a 'current' verdict.
    if (!symbol || c[iStatus] !== 'Approved') continue;
    const aliases = splitCell(c[iAlias]);
    const prevSymbols = splitCell(c[iPrev]);
    index.approved.set(symbol.toUpperCase(), {
      symbol, name: c[iName] ?? '', id: c[iId] ?? '', locusType: c[iLocus] ?? '',
      aliases, prevSymbols,
    });
    for (const p of prevSymbols) pushMulti(index.previous, p.toUpperCase(), symbol);
    for (const a of aliases) pushMulti(index.alias, a.toUpperCase(), symbol);
    index.source.records++;
  }
  return index;
}

/**
 * MGI, from MRK_List1.rpt.
 *
 * List1 rather than List2 because List1 is the one that still carries WITHDRAWN
 * markers, and a withdrawn row is where a retired mouse symbol names its
 * replacement (column 14). List2 drops them, which would leave every outdated
 * mouse symbol scored 'unrecognized' — indistinguishable from a clone id.
 *
 * Streamed line by line: the report is ~86 MB and mostly non-gene markers
 * (BAC/YAC ends, DNA segments), so reading it whole would cost more memory than
 * the entire rest of this script.
 */
async function loadMGI(): Promise<AuthorityIndex> {
  const file = path.join(CACHE_DIR, 'MRK_List1.rpt');
  const index: AuthorityIndex = {
    name: 'MGI',
    approved: new Map(), previous: new Map(), alias: new Map(),
    source: { url: MGI_URL, ...(await fileFacts(file)), records: 0 },
  };

  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let first = true;
  // Withdrawn rows are collected separately: a symbol withdrawn INTO a marker
  // that is itself absent from the gene rows is not a usable redirect, and the
  // gene rows are not all seen until the stream ends.
  const withdrawn: Array<[string, string]> = [];
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split('\t');
    const symbol = c[6];
    if (!symbol) continue;
    const status = c[7];
    const markerType = c[9];
    if (status === 'W') {
      const current = c[13];
      if (current && current !== symbol) withdrawn.push([symbol, current]);
      continue;
    }
    // Genes only. The report also lists BAC/YAC ends, DNA segments, QTLs and
    // cytogenetic markers, none of which a DE table can contain.
    if (markerType !== 'Gene') continue;
    const aliases = splitCell(c[11]);
    index.approved.set(symbol.toUpperCase(), {
      symbol, name: c[8] ?? '', id: c[0] === 'NULL' ? '' : (c[0] ?? ''),
      locusType: c[10] || markerType, aliases, prevSymbols: [],
    });
    for (const a of aliases) pushMulti(index.alias, a.toUpperCase(), symbol);
    index.source.records++;
  }

  // MGI states withdrawals as their own rows rather than as a prev_symbol column,
  // so the reverse direction is assembled here — and only where the replacement
  // is a marker we actually kept, so a redirect can never point at nothing.
  for (const [old, current] of withdrawn) {
    const target = index.approved.get(current.toUpperCase());
    if (!target) continue;
    pushMulti(index.previous, old.toUpperCase(), target.symbol);
    if (!target.prevSymbols.includes(old)) target.prevSymbols.push(old);
  }
  return index;
}

/**
 * RGD, from the active rat-gene export plus the obsolete-ID replacement table.
 *
 * GENES_RAT.txt is explicitly an active-gene export. OLD_SYMBOL contains the
 * active record's synonym list, while GENES_OBSOLETE_IDS.txt is the separate
 * source that distinguishes a genuinely retired symbol from an informal alias.
 * Replacement chains are followed by RGD ID until they reach an active record;
 * this avoids pointing a retired symbol at another record that was later retired.
 */
async function loadRGD(): Promise<AuthorityIndex> {
  const genesFile = path.join(CACHE_DIR, 'GENES_RAT.txt');
  const obsoleteFile = path.join(CACHE_DIR, 'GENES_OBSOLETE_IDS.txt');
  const obsoleteSource = { url: RGD_OBSOLETE_URL, ...(await fileFacts(obsoleteFile)), records: 0 };
  const index: AuthorityIndex = {
    name: 'RGD',
    approved: new Map(), previous: new Map(), alias: new Map(),
    source: { url: RGD_GENES_URL, ...(await fileFacts(genesFile)), records: 0 },
    supplementarySources: [obsoleteSource],
  };

  const activeById = new Map<string, AuthorityRecord>();
  const activeRecords: Array<AuthorityRecord & { nomenclatureStatus: string }> = [];
  const geneLines = createInterface({ input: createReadStream(genesFile, 'utf8'), crlfDelay: Infinity });
  let ratTaxonomyVerified = false;
  let geneHeader: string[] | null = null;
  let geneCols: Record<'id' | 'symbol' | 'name' | 'aliases' | 'status' | 'type', number> | null = null;
  for await (const line of geneLines) {
    if (line.startsWith('# SPECIES:')) {
      if (!line.includes('Rattus norvegicus') || !line.includes('NCBI:txid10116')) throw new Error('GENES_RAT.txt does not declare the rat taxon');
      ratTaxonomyVerified = true;
    }
    if (!line || line.startsWith('#')) continue;
    if (!geneHeader) {
      geneHeader = line.split('\t');
      const col = (name: string) => {
        const at = geneHeader!.indexOf(name);
        if (at === -1) throw new Error(`GENES_RAT.txt has no '${name}' column — the format changed`);
        return at;
      };
      geneCols = {
        id: col('GENE_RGD_ID'), symbol: col('SYMBOL'), name: col('NAME'),
        aliases: col('OLD_SYMBOL'), status: col('NOMENCLATURE_STATUS'), type: col('GENE_TYPE'),
      };
      continue;
    }
    const c = line.split('\t');
    const symbol = c[geneCols!.symbol];
    const id = c[geneCols!.id];
    if (!symbol || !id) continue;
    // This file promises active genes; retaining the published status as a
    // required field makes a malformed/shifted row fail closed instead of being
    // misclassified as current.
    if (!c[geneCols!.status]) {
      throw new Error(`GENES_RAT.txt active gene ${id} (${symbol}) has no NOMENCLATURE_STATUS`);
    }
    const aliases = splitSemicolonCell(c[geneCols!.aliases]);
    const record: AuthorityRecord = {
      symbol,
      name: c[geneCols!.name] ?? '',
      id: `RGD:${id}`,
      locusType: c[geneCols!.type] ?? '',
      aliases,
      prevSymbols: [],
    };
    activeById.set(id, record);
    activeRecords.push({ ...record, nomenclatureStatus: c[geneCols!.status] });
    index.source.records++;
  }
  if (!geneHeader || !index.source.records || !ratTaxonomyVerified) {
    throw new Error('GENES_RAT.txt contained no active gene records');
  }
  const selectedRecords = selectRgdRecords(activeRecords);
  index.ambiguities = new Map();
  for (const [key, { selected, candidates }] of selectedRecords) {
    if (selected) {
      index.approved.set(key, selected);
      // Reuse the selected object so obsolete-ID previous-symbol additions
      // reach the exact record emitted in the public table.
      activeById.set(selected.id.replace(/^RGD:/, ''), selected);
      for (const alias of selected.aliases) pushMulti(index.alias, alias.toUpperCase(), selected.symbol);
      const supportedAliases = new Set(selected.aliases.map(alias => alias.toUpperCase()));
      for (const alias of new Set(candidates.filter(record => record.id !== selected.id).flatMap(record => record.aliases))) {
        if (supportedAliases.has(alias.toUpperCase())) continue;
        for (const candidate of candidates) pushMulti(index.ambiguities, alias.toUpperCase(), candidate.id);
      }
    } else {
      index.ambiguities.set(key, candidates.map(record => record.id));
      for (const alias of new Set(candidates.flatMap(record => record.aliases))) {
        for (const candidate of candidates) pushMulti(index.ambiguities, alias.toUpperCase(), candidate.id);
      }
    }
  }
  process.stdout.write(`  RGD ${[...selectedRecords.values()].filter(choice => choice.candidates.length > 1).length} colliding active symbols; ` +
    `${[...selectedRecords.values()].filter(choice => !choice.selected).length} unresolved\n`);

  type ObsoleteRow = { oldId: string; oldSymbol: string; status: string; newId: string };
  const obsoleteRows: ObsoleteRow[] = [];
  const obsoleteByOldId = new Map<string, ObsoleteRow>();
  const obsoleteLines = createInterface({ input: createReadStream(obsoleteFile, 'utf8'), crlfDelay: Infinity });
  let obsoleteHeader: string[] | null = null;
  let obsoleteCols: Record<'species' | 'oldId' | 'oldSymbol' | 'status' | 'newId', number> | null = null;
  for await (const line of obsoleteLines) {
    if (!line || line.startsWith('#')) continue;
    if (!obsoleteHeader) {
      obsoleteHeader = line.split('\t');
      const col = (name: string) => {
        const at = obsoleteHeader!.indexOf(name);
        if (at === -1) throw new Error(`GENES_OBSOLETE_IDS.txt has no '${name}' column — the format changed`);
        return at;
      };
      obsoleteCols = {
        species: col('SPECIES'), oldId: col('OLD_GENE_RGD_ID'),
        oldSymbol: col('OLD_GENE_SYMBOL'), status: col('OLD_GENE_STATUS'),
        newId: col('NEW_GENE_RGD_ID'),
      };
      continue;
    }
    const c = line.split('\t');
    if (c[obsoleteCols!.species]?.toLowerCase() !== 'rat') continue;
    obsoleteSource.records++;
    const row: ObsoleteRow = {
      oldId: c[obsoleteCols!.oldId] ?? '',
      oldSymbol: c[obsoleteCols!.oldSymbol] ?? '',
      status: c[obsoleteCols!.status] ?? '',
      newId: c[obsoleteCols!.newId] ?? '',
    };
    if (!row.oldId) continue;
    obsoleteRows.push(row);
    obsoleteByOldId.set(row.oldId, row);
  }
  if (!obsoleteHeader || !obsoleteSource.records) {
    throw new Error('GENES_OBSOLETE_IDS.txt contained no rat records');
  }

  for (const row of obsoleteRows) {
    if (row.status !== 'RETIRED' || !row.oldSymbol || !row.newId) continue;
    let nextId = row.newId;
    const seen = new Set([row.oldId]);
    let target: AuthorityRecord | undefined;
    while (nextId && !seen.has(nextId)) {
      seen.add(nextId);
      target = activeById.get(nextId);
      if (target) break;
      nextId = obsoleteByOldId.get(nextId)?.newId ?? '';
    }
    if (!target || row.oldSymbol.toUpperCase() === target.symbol.toUpperCase()) continue;
    if (index.approved.get(target.symbol.toUpperCase())?.id !== target.id) {
      const candidates = selectedRecords.get(target.symbol.toUpperCase())!.candidates;
      for (const candidate of candidates) pushMulti(index.ambiguities!, row.oldSymbol.toUpperCase(), candidate.id);
      continue;
    }
    pushMulti(index.previous, row.oldSymbol.toUpperCase(), target.symbol);
    if (!target.prevSymbols.includes(row.oldSymbol)) target.prevSymbols.push(row.oldSymbol);
  }

  // A reverse alias attached to a different row would otherwise bypass the
  // ambiguous row's empty redirect fields in the browser search index.
  for (const [key] of index.ambiguities!) {
    if (index.approved.has(key)) continue;
    index.alias.delete(key);
    index.previous.delete(key);
  }
  for (const record of index.approved.values()) {
    const safe = (symbol: string) => !index.ambiguities!.has(symbol.toUpperCase()) || index.approved.has(symbol.toUpperCase());
    record.aliases = record.aliases.filter(safe);
    record.prevSymbols = record.prevSymbols.filter(safe);
  }

  return index;
}

/**
 * One species' current NCBI Gene namespace, from its official gene_info file.
 *
 * gene_info is intentionally treated as a CURRENT-symbol plus synonym source.
 * It does not distinguish historical symbols from informal synonyms, so none
 * are promoted to `previous`; claiming a retirement without a source that says
 * so would be more misleading than the less-specific `alias` classification.
 * Keeping one AuthorityIndex per taxon is essential: POMC in human, chicken,
 * pig and cattle is the same spelling but four independently governed records.
 */
async function loadNcbiGeneInfo(source: NcbiGeneInfoSource): Promise<AuthorityIndex> {
  const file = path.join(CACHE_DIR, source.file);
  const index: AuthorityIndex = {
    name: source.authority,
    approved: new Map(), previous: new Map(), alias: new Map(),
    source: { url: source.url, ...(await fileFacts(file)), records: 0 },
  };

  const input = createReadStream(file).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let cols: Record<'taxId' | 'id' | 'symbol' | 'locusTag' | 'aliases' | 'name' | 'type' | 'authoritySymbol' | 'authorityName', number> | null = null;
  const duplicateSymbols = new Set<string>();
  let otherTaxa = 0;

  for await (const line of lines) {
    if (!line) continue;
    if (!cols) {
      const header = line.replace(/^#/, '').split('\t');
      const col = (name: string) => {
        const at = header.indexOf(name);
        if (at === -1) throw new Error(`${source.file} has no '${name}' column — the format changed`);
        return at;
      };
      cols = {
        taxId: col('tax_id'), id: col('GeneID'), symbol: col('Symbol'),
        locusTag: col('LocusTag'), aliases: col('Synonyms'), name: col('description'),
        type: col('type_of_gene'), authoritySymbol: col('Symbol_from_nomenclature_authority'),
        authorityName: col('Full_name_from_nomenclature_authority'),
      };
      continue;
    }
    if (line.startsWith('#')) continue;
    const c = line.split('\t');
    // NCBI's named species files can include a small number of related taxon or
    // subspecies records (for example 37 non-9031 rows in the chicken export).
    // They are valid upstream records but not part of this namespace.
    if (c[cols.taxId] !== source.taxId) { otherTaxa++; continue; }
    const id = c[cols.id];
    const symbol = ncbiValue(c[cols.symbol]);
    if (!id || !symbol) continue;
    index.source.records++;
    const key = symbol.toUpperCase();
    if (index.approved.has(key)) {
      // A case-insensitive duplicate cannot be represented honestly as one
      // GeneID, so remove it from exact resolution instead of picking a winner.
      index.approved.delete(key);
      duplicateSymbols.add(key);
      continue;
    }
    if (duplicateSymbols.has(key)) continue;

    const authoritySymbol = ncbiValue(c[cols.authoritySymbol]);
    const aliases = [
      ...splitNcbiCell(c[cols.aliases]),
      ...splitNcbiCell(c[cols.locusTag]),
      ...(authoritySymbol && authoritySymbol.toUpperCase() !== key ? [authoritySymbol] : []),
    ].filter((alias, at, all) => alias.toUpperCase() !== key
      && all.findIndex((other) => other.toUpperCase() === alias.toUpperCase()) === at);
    const record: AuthorityRecord = {
      symbol,
      name: ncbiValue(c[cols.authorityName]) || ncbiValue(c[cols.name]),
      id: `GeneID:${id}`,
      locusType: ncbiValue(c[cols.type]),
      aliases,
      prevSymbols: [],
    };
    index.approved.set(key, record);
    for (const alias of aliases) pushMulti(index.alias, alias.toUpperCase(), symbol);
  }

  if (!cols || !index.source.records) {
    throw new Error(`${source.file} contained no NCBI Gene records`);
  }
  if (duplicateSymbols.size) {
    for (const [alias, targets] of index.alias) {
      const kept = targets.filter((target) => !duplicateSymbols.has(target.toUpperCase()));
      if (kept.length) index.alias.set(alias, kept); else index.alias.delete(alias);
    }
    process.stdout.write(`  ${source.file}: omitted ${duplicateSymbols.size} case-colliding current symbols\n`);
  }
  if (otherTaxa) {
    process.stdout.write(`  ${source.file}: ignored ${otherTaxa} records outside tax_id ${source.taxId}\n`);
  }
  return index;
}

// ── Scanning the corpus for the symbols it actually stores ──────────────────

/**
 * Every symbol a dataset's DE tables contain, unioned over its tracks.
 *
 * Scanned with a regex over the raw bundle text rather than JSON.parse, because
 * the corpus is hundreds of MB across more than 150 track bundles and the gene column is the only
 * field wanted from any of them — parsing each into an object graph to read one
 * key would cost gigabytes of transient heap for nothing.
 */
async function scanDatasetSymbols(datasetId: string): Promise<Set<string>> {
  const dir = path.join(DATASETS_DIR, datasetId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return new Set();
  }
  const tracks = entries.filter((f) => f.startsWith('track_') && f.endsWith('.js') && !f.endsWith('.pathways.js'));
  const symbols = new Set<string>();
  for (const f of tracks) {
    const text = await readFile(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/"gene":"((?:[^"\\]|\\.)*)"/g)) {
      // A JSON string escape (\" or \\) in a gene symbol is vanishingly rare but
      // the regex admits it, so undo it rather than storing the escaped form.
      symbols.add(m[1].replace(/\\(.)/g, '$1'));
    }
  }
  return symbols;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Score one stored symbol against its authority.
 *
 * Order matters and is the whole rule: APPROVED wins over everything. A symbol
 * that is currently approved AND happens to be listed as some other gene's alias
 * is current, not an alias — reporting it otherwise would flag a correct symbol
 * as a problem, which is the one outcome that would make this table untrustworthy.
 */
function resolve(symbol: string, index: AuthorityIndex): Omit<NomenclatureRow, 'datasetCount' | 'symbol' | 'authority'> {
  const u = symbol.toUpperCase();

  const approved = index.approved.get(u);
  if (approved) {
    return {
      status: 'current', currentSymbol: approved.symbol, geneName: approved.name,
      aliases: approved.aliases, prevSymbols: approved.prevSymbols,
      authorityId: approved.id, locusType: approved.locusType,
    };
  }

  const ambiguous = index.ambiguities?.get(u);
  if (ambiguous?.length) return {
    status: 'ambiguous', currentSymbol: '', geneName: `Ambiguous active RGD IDs: ${[...new Set(ambiguous)].sort().join('; ')}`,
    aliases: [], prevSymbols: [], authorityId: '', locusType: '',
  };

  for (const [status, map] of [['previous', index.previous], ['alias', index.alias]] as const) {
    const targets = map.get(u);
    if (!targets?.length) continue;
    // The first target supplies the descriptive fields; every target is named in
    // currentSymbol, so a symbol that was split across genes reads as ambiguous
    // rather than silently resolving to whichever record was parsed first.
    const head = index.approved.get(targets[0].toUpperCase());
    return {
      status, currentSymbol: targets.join('|'), geneName: head?.name ?? '',
      aliases: head?.aliases ?? [], prevSymbols: head?.prevSymbols ?? [],
      authorityId: head?.id ?? '', locusType: head?.locusType ?? '',
    };
  }

  return {
    status: 'unrecognized', currentSymbol: '', geneName: '',
    aliases: [], prevSymbols: [], authorityId: '', locusType: '',
  };
}

// ── Emitting ────────────────────────────────────────────────────────────────

/**
 * Wire codes are positions in the CLIENT'S exported arrays. Importing those
 * arrays here makes a reorder impossible on one side only.
 */
const STATUS_CODE = Object.fromEntries(
  NOMENCLATURE_STATUS.map((status, code) => [status, code]),
) as Record<SymbolStatus, number>;
const AUTHORITY_CODE = Object.fromEntries(
  NOMENCLATURE_AUTHORITIES.map((authority, code) => [authority, code]),
) as Record<Authority, number>;

function toTSV(rows: NomenclatureRow[]): string {
  const out = [TSV_COLUMNS.join('\t')];
  for (const r of rows) {
    out.push([
      r.symbol, r.authority, r.status, r.currentSymbol, r.geneName,
      r.aliases.join('|'), r.prevSymbols.join('|'), r.authorityId, r.locusType,
      r.datasetCount,
    // A tab or newline inside an authority's gene name would shift every later
    // column of that row. Neither has ever appeared, which is exactly why it
    // would go unnoticed — so they are neutralized rather than trusted.
    ].map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t'));
  }
  return `${out.join('\n')}\n`;
}

/**
 * Write a runtime artifact as JSONP.
 *
 * Same convention as every data bundle — a classic script assigning a window
 * global rather than JSON — so it loads through the one seam in
 * data/bundleSource.ts and inherits its caching, dedupe and never-reject policy.
 *
 * These live in public/nomenclature/ and are therefore served SAME-ORIGIN with
 * the app, unlike public/datasets and public/query which move to R2. The table
 * is the app's own reference content rather than a dataset's payload: shipping
 * it with the deploy means it is never out of step with the UI that reads it,
 * and it costs the deploy a couple of MB rather than the corpus's 400.
 */
function emitJsonp(globalKey: string, payload: unknown, note: string): string {
  return `// AUTO-GENERATED by scripts/build_nomenclature.mts — do not edit\n// ${note}\nvar ${globalKey} = ${JSON.stringify(payload)};\n`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  if (FETCH) {
    process.stdout.write(`Fetching ${REFRESH_RGD ? 'RGD' : 'nomenclature'} authorities…\n`);
    if (!REFRESH_RGD) {
      await download(HGNC_URL, path.join(CACHE_DIR, 'hgnc_complete_set.txt'));
      await download(MGI_URL, path.join(CACHE_DIR, 'MRK_List1.rpt'));
    }
    await Promise.all([
      download(RGD_GENES_URL, path.join(CACHE_DIR, 'GENES_RAT.txt')),
      download(RGD_OBSOLETE_URL, path.join(CACHE_DIR, 'GENES_OBSOLETE_IDS.txt')),
    ]);
    if (!REFRESH_RGD) {
      for (const source of NCBI_GENE_INFO_SOURCES) {
        await download(source.url, path.join(CACHE_DIR, source.file));
      }
    }
  }

  process.stdout.write('Loading authorities…\n');
  const retainedRows = REFRESH_RGD ? parseRetainedNomenclature(await readFile(TSV_OUT, 'utf8')) : null;
  const retainedSources = REFRESH_RGD ? JSON.parse(await readFile(META_OUT, 'utf8')) as {
    builtFrom: Record<string, NomenclatureSourceFacts>;
    [key: string]: unknown;
  } : null;
  const authorities = await Promise.all(REFRESH_RGD ? [loadRGD()] : [
    loadHGNC(), loadMGI(), loadRGD(), ...NCBI_GENE_INFO_SOURCES.map(loadNcbiGeneInfo),
  ]);
  for (const authority of authorities) {
    process.stdout.write(`  ${authority.name} ${authority.source.records} current, ${authority.previous.size} retired, ${authority.alias.size} aliases\n`);
  }
  if (REFRESH_RGD) process.stdout.write('  Retaining all non-RGD authority decisions and source metadata\n');

  // Which authority governs which dataset. An organism with no authority here is
  // a hard error rather than a silent skip: a new species joining the corpus must
  // be a decision someone makes, not a column that quietly reads 'unrecognized'.
  const authorityByName = new Map<Authority, AuthorityIndex>(
    authorities.map((authority) => [authority.name, authority]),
  );
  const rgd = authorityByName.get('RGD')!;

  process.stdout.write('Scanning corpus bundles…\n');
  // symbol-as-stored + authority -> the datasets that store it. Keyed by both
  // because a mouse Pomc and a macaque POMC are different records under
  // different authorities, and collapsing them would report one's status for the
  // other.
  const usage = new Map<string, { symbol: string; authority: Authority; datasets: Set<string> }>();
  const unscanned: string[] = [];

  for (const dataset of listDatasets()) {
    // A corrected biological species can retain historical reference-symbol
    // spellings. A documented dataset override classifies those spellings
    // without assigning that reference authority to the species as a whole.
    const authorityName = nomenclatureAuthorityForStoredDatasetSymbols(dataset);
    if (!authorityName || (!REFRESH_RGD && !authorityByName.has(authorityName))) {
      throw new Error(
        `No nomenclature authority is registered for organism '${dataset.organism}' (dataset ${dataset.id}). ` +
        'Review its native or explicitly dataset-scoped stored-symbol namespace in src/data/nomenclatureWire.ts.',
      );
    }
    const symbols = await scanDatasetSymbols(dataset.id);
    if (!symbols.size) {
      unscanned.push(dataset.id);
      process.stdout.write(`  ${dataset.id}: no local bundles — skipped\n`);
      continue;
    }
    for (const symbol of symbols) {
      const key = nomenclatureKey(authorityName, symbol);
      const at = usage.get(key);
      if (at) at.datasets.add(dataset.id);
      else usage.set(key, { symbol, authority: authorityName, datasets: new Set([dataset.id]) });
    }
    process.stdout.write(`  ${dataset.id}: ${symbols.size} symbols\n`);
  }
  if (unscanned.length && !ALLOW_MISSING) {
    throw new Error(
      `${unscanned.length} registered dataset(s) have no local bundles under public/datasets/ ` +
      `(${unscanned.join(', ')}). Building anyway would drop them from the nomenclature table and ` +
      'deflate every datasetCount. Restore the bundles, or pass --allow-missing to accept the shrunken table.',
    );
  }
  if (!usage.size) {
    throw new Error('Zero symbols scanned across the whole corpus — refusing to write empty nomenclature outputs.');
  }

  process.stdout.write('Resolving…\n');
  const rows: NomenclatureRow[] = [];
  for (const { symbol, authority, datasets } of usage.values()) {
    if (REFRESH_RGD && authority !== 'RGD') {
      rows.push(reuseRetainedNomenclature(retainedRows!, authority, symbol, datasets.size));
    } else {
      rows.push({ symbol, authority, ...resolve(symbol, authorityByName.get(authority)!), datasetCount: datasets.size });
    }
  }
  // Sorted so the committed TSV has a stable diff: a rebuild that changes one
  // gene's status must show as one changed line, not a reshuffled file.
  rows.sort((a, b) =>
    a.authority.localeCompare(b.authority) ||
    a.symbol.toUpperCase().localeCompare(b.symbol.toUpperCase()) ||
    a.symbol.localeCompare(b.symbol));

  const tally = { current: 0, previous: 0, alias: 0, unrecognized: 0, ambiguous: 0 };
  for (const r of rows) tally[r.status]++;
  process.stdout.write(
    `  ${rows.length} rows — ${tally.current} current, ${tally.previous} outdated, ` +
    `${tally.alias} alias-only, ${tally.unrecognized} unrecognized, ${tally.ambiguous} ambiguous\n`,
  );

  // ── The committed source of truth ─────────────────────────────────────────
  const tsv = toTSV(rows);
  const sources = REFRESH_RGD ? {
    ...refreshRetainedRgdSources(retainedSources!, rgd.source, rgd.supplementarySources![0]),
    rows: rows.length,
    tally,
  } : {
    builtFrom: {
      hgnc: authorityByName.get('HGNC')!.source,
      mgi: authorityByName.get('MGI')!.source,
      rgd: rgd.source,
      rgdObsolete: rgd.supplementarySources![0],
      ...Object.fromEntries(NCBI_GENE_INFO_SOURCES.map(source => [source.sourceKey, authorityByName.get(source.authority)!.source])),
    },
    rows: rows.length,
    tally,
    authorityByOrganism: NOMENCLATURE_AUTHORITY_BY_ORGANISM,
    storedDatasetNamespaceOverrides: Object.fromEntries(
      listDatasets()
        .filter(dataset => NOMENCLATURE_STORED_DATASET_OVERRIDES[dataset.id]?.organism === dataset.organism)
        .map(dataset => [dataset.id, NOMENCLATURE_STORED_DATASET_OVERRIDES[dataset.id]]),
    ),
    authorityNotes: {
      'Macaca fascicularis': 'Upstream features are explicitly mapped to human ortholog symbols; HGNC governs that namespace.',
      'Macaca mulatta': 'Upstream features are explicitly mapped to human ortholog symbols; HGNC governs that namespace.',
      'Phodopus sungorus': 'Accepted datasets use explicit author-provided mouse feature projections; MGI governs the stored namespace.',
      'Eliomys quercinus': 'Accepted dataset uses an explicit author-provided mouse feature projection; MGI governs the stored namespace.',
      nativeNcbiSpecies: 'Chicken, zebrafish, pig and cattle remain in separate native NCBI Gene taxon namespaces.',
    },
  };
  const sourcesJson = `${JSON.stringify(sources, null, 2)}\n`;

  // ── Runtime projections ───────────────────────────────────────────────────
  // Split in two because the two readers want opposite things.
  //
  // aliases.js is on the SEARCH path: the gene box loads it so that typing a
  // retired symbol still finds the gene. It carries only symbols that have
  // something to redirect, which drops the ~4/5 of the corpus (Gm…, …Rik, clone
  // ids) that has no alias, no previous symbol and nothing to say.
  //
  // table.js is the reference page's payload — every row, every column. Nobody
  // pays for it until they open the page.
  const aliasRows = rows.filter((r) => r.status !== 'current' || r.aliases.length || r.prevSymbols.length);
  const aliasPayload = {
    v: 1,
    rows: aliasRows.map((r) => [
      r.symbol,
      AUTHORITY_CODE[r.authority],
      STATUS_CODE[r.status],
      // 0 rather than '' for 'nothing to redirect to' — it is one byte instead of
      // two across tens of thousands of rows, and both are falsy at the reader.
      r.status === 'current' ? 0 : r.currentSymbol,
      r.aliases.join('|'),
      r.prevSymbols.join('|'),
    ]),
  };

  // Locus types are interned. There are a few dozen distinct values ('gene with
  // protein product', 'protein coding gene', 'RNA, long non-coding', …) repeated
  // across every row, and spelling them out costs about a megabyte for no
  // information the index does not already carry.
  const locusTypes = [...new Set(rows.map((r) => r.locusType))].sort();
  const locusIx = new Map(locusTypes.map((t, i) => [t, i]));
  const tablePayload = {
    v: 1,
    columns: TSV_COLUMNS,
    locusTypes,
    tally,
    sources: sources.builtFrom,
    rows: rows.map((r) => [
      r.symbol, AUTHORITY_CODE[r.authority], STATUS_CODE[r.status], r.currentSymbol,
      r.geneName, r.aliases.join('|'), r.prevSymbols.join('|'),
      // The authority prefix is implied by the authority column, so 'HGNC:5461'
      // and 'GeneID:373854' ship without the repeated prefix. The reader restores it.
      r.authorityId.replace(new RegExp(`^${NOMENCLATURE_AUTHORITY_ID_PREFIX[r.authority]}:`), ''),
      locusIx.get(r.locusType) ?? -1,
      r.datasetCount,
    ]),
  };

  const outputs: Array<[string, string]> = [
    [TSV_OUT, tsv],
    [META_OUT, sourcesJson],
    [path.join(RUNTIME_DIR, 'aliases.js'), emitJsonp('HX_NOMENCLATURE_ALIASES', aliasPayload,
      'symbols with an alias, a previous symbol, or a non-current status (search-path subset)')],
    [path.join(RUNTIME_DIR, 'table.js'), emitJsonp('HX_NOMENCLATURE_TABLE', tablePayload,
      'the full nomenclature table — every corpus symbol, joined to its species-appropriate authority')],
  ];

  if (CHECK) {
    let drift = 0;
    for (const [file, content] of outputs) {
      const existing = await readFile(file, 'utf8').catch(() => null);
      if (existing !== content) {
        drift++;
        process.stdout.write(`  DRIFT ${path.relative(process.cwd(), file)}${existing === null ? ' (missing)' : ''}\n`);
      }
    }
    if (drift) {
      process.stdout.write('\nRun `npm run build:nomenclature` and commit the result.\n');
      process.exit(1);
    }
    process.stdout.write('  committed outputs are up to date\n');
    return;
  }

  await mkdir(path.dirname(TSV_OUT), { recursive: true });
  await mkdir(RUNTIME_DIR, { recursive: true });
  for (const [file, content] of outputs) {
    await writeFile(file, content);
    process.stdout.write(`  wrote ${path.relative(process.cwd(), file)} (${(content.length / 1e6).toFixed(2)} MB)\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
