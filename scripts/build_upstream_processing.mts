/**
 * Record each registered study's UPSTREAM processing: the aligner, genome build,
 * annotation and quantifier the depositor used to make the matrix HypoExplorer
 * starts from. HypoExplorer does not realign reads, so these are the depositors'
 * choices, parsed from their own repository records:
 *   GEO           !Sample_data_processing (family SOFT, series matrix, or a
 *                 fetched GSM record under data/upstream-processing/)
 *   ArrayExpress  IDF alignment / data-transformation protocols
 *   paper         the source paper's methods (overrides only)
 *
 * npx tsx scripts/build_upstream_processing.mts            regenerate
 * npx tsx scripts/build_upstream_processing.mts --check    fail on drift
 * npx tsx scripts/build_upstream_processing.mts --mark-reviewed=GSE1,GSE2|all
 *
 * Outputs geo_replication/config/upstream_processing.tsv (one row per source
 * accession) and src/data/upstreamProcessing.generated.json (compact display
 * fields). Offline: evidence is read only from files in the working tree that
 * git tracks or would track, and every row carries its evidence's sha256
 * (raw bytes for .gz; LF-normalized bytes for plain text, so a CRLF checkout
 * hashes the same).
 *
 * Hand review lives in geo_replication/config/upstream_processing.overrides.json:
 *   overrides[acc] = { fields: {column: value}, reason }   corrected parses
 *   reviewed[acc]  = pin                                    rows a person checked
 * A pin hashes the evidence sha256 and the row's final values, so a changed
 * record or a changed extractor drops that row back to review_status=parsed and
 * --check fails until someone re-reviews it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { listDatasets } from '../src/data/datasets';
import { sourceAccession } from '../src/data/upstreamProcessing';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSV = resolve(ROOT, 'geo_replication/config/upstream_processing.tsv');
const OVERRIDES = resolve(ROOT, 'geo_replication/config/upstream_processing.overrides.json');
const JSON_OUT = resolve(ROOT, 'src/data/upstreamProcessing.generated.json');
const CONFIG = resolve(ROOT, 'geo_replication/config/datasets.tsv');
const CHECK = process.argv.includes('--check');
const MARK = process.argv.find((arg) => arg.startsWith('--mark-reviewed='))?.split('=')[1];

const COLUMNS = [
  'accession', 'repository', 'assay_class', 'platform_gpl', 'instrument', 'library_strategy',
  'aligner', 'aligner_version', 'genome_build', 'annotation', 'annotation_version',
  'quantifier', 'quantifier_version', 'deposited_file', 'evidence_kind', 'evidence_path',
  'evidence_sha256', 'verbatim', 'review_status', 'notes',
] as const;
type Column = typeof COLUMNS[number];
type Row = Record<Column, string>;
const NA = 'NA';
const ASSAY_CLASSES = new Set(['rnaseq_counts', 'rnaseq_normalized', 'sc_counts', 'microarray']);
const EVIDENCE_KINDS = new Set(['geo_data_processing', 'ae_idf_protocol', 'paper_methods', 'not_stated']);
const REVIEW_STATUSES = new Set(['parsed', 'reviewed', 'not_stated', 'needs_review']);
const VERBATIM_LIMIT = 1500;

interface OverrideFile {
  overrides: Record<string, { fields: Partial<Row>; reason: string }>;
  reviewed: Record<string, string>;
}

// ── Evidence discovery ───────────────────────────────────────────────────────

interface Evidence {
  path: string;
  sha256: string;
  kind: 'soft' | 'matrix' | 'idf' | 'other';
  processing: string[];
  platforms: string[];
  instruments: string[];
  strategies: string[];
  supplementary: string[];
}

const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: ROOT, maxBuffer: 256 * 1024 * 1024,
}).toString('utf8').split('\0').filter(Boolean);

const SOFT = /(?:^|\/)(GSE\d+)_(?:family|gsm_brief)\.soft(?:\.gz)?$/;
const MATRIX = /(?:^|\/)(GSE\d+)(?:-GPL\d+)?_series_matrix\.txt(?:\.gz)?$/;
const IDF = /(?:^|\/)(E-MTAB-\d+)\.idf\.txt$/;

function candidateAccession(path: string): string | undefined {
  return SOFT.exec(path)?.[1] ?? MATRIX.exec(path)?.[1] ?? IDF.exec(path)?.[1];
}

function readText(path: string): { text: string; sha256: string } {
  const bytes = readFileSync(resolve(ROOT, path));
  if (path.endsWith('.gz')) {
    return { text: gunzipSync(bytes).toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  return { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [...new Set(values.map(clean).filter(Boolean))];
const basename = (value: string) => value.replace(/\/+$/, '').split('/').at(-1) ?? value;

function parseSoft(text: string): Omit<Evidence, 'path' | 'sha256' | 'kind'> {
  const field = (name: string) => [...text.matchAll(new RegExp(`^!${name} = (.*)$`, 'gm'))].map((m) => m[1]);
  return {
    processing: unique(field('Sample_data_processing')),
    platforms: unique(field('Sample_platform_id')).sort(),
    instruments: unique(field('Sample_instrument_model')).sort(),
    strategies: unique(field('Sample_library_strategy')).sort(),
    supplementary: unique(field('Series_supplementary_file').map(basename)),
  };
}

function parseMatrix(text: string): Omit<Evidence, 'path' | 'sha256' | 'kind'> {
  const rows = (name: string) => text.split('\n').filter((line) => line.startsWith(`!${name}\t`))
    .map((line) => line.split('\t').slice(1).map((cell) => cell.replace(/^"|"$/g, '')));
  // Transpose so the order matches a SOFT file: sample 1's lines, then sample 2's.
  const processing = rows('Sample_data_processing');
  const width = Math.max(0, ...processing.map((row) => row.length));
  const bySample: string[] = [];
  for (let sample = 0; sample < width; sample++) for (const row of processing) bySample.push(row[sample] ?? '');
  return {
    processing: unique(bySample),
    platforms: unique(rows('Sample_platform_id').flat()).sort(),
    instruments: unique(rows('Sample_instrument_model').flat()).sort(),
    strategies: unique(rows('Sample_library_strategy').flat()).sort(),
    supplementary: unique(rows('Series_supplementary_file').flat().map(basename)),
  };
}

function parseIdf(text: string): Omit<Evidence, 'path' | 'sha256' | 'kind'> {
  const row = (name: string) => text.split('\n').find((line) => line.startsWith(`${name}\t`))?.split('\t').slice(1) ?? [];
  const types = row('Protocol Type');
  const descriptions = row('Protocol Description');
  const software = row('Protocol Software');
  const processing: string[] = [];
  types.forEach((type, index) => {
    if (!/alignment|normali[sz]ation data transformation|data transformation/i.test(type)) return;
    if (descriptions[index]?.trim()) processing.push(`${clean(type)}: ${descriptions[index]}`);
    if (software[index]?.trim()) processing.push(`Software: ${software[index]}`);
  });
  return {
    processing: unique(processing), platforms: [], instruments: [],
    strategies: unique(row('Comment[AEExperimentType]')), supplementary: [],
  };
}

const evidenceCache = new Map<string, Evidence>();
function loadEvidence(path: string): Evidence {
  const cached = evidenceCache.get(path);
  if (cached) return cached;
  const { text, sha256 } = readText(path);
  const kind = SOFT.test(path) ? 'soft' : MATRIX.test(path) ? 'matrix' : IDF.test(path) ? 'idf' : 'other';
  const parsed = kind === 'soft' ? parseSoft(text) : kind === 'matrix' ? parseMatrix(text)
    : kind === 'idf' ? parseIdf(text) : { processing: [], platforms: [], instruments: [], strategies: [], supplementary: [] };
  const evidence: Evidence = { path, sha256, kind, ...parsed };
  evidenceCache.set(path, evidence);
  return evidence;
}

const LOCATION_RANK = [/^data\/upstream-processing\//, /^geo_replication\/datasets\//, /^data\/internal-qc\//, /^data\/author-validation\//];
const locationRank = (path: string) => {
  const index = LOCATION_RANK.findIndex((pattern) => pattern.test(path));
  return index < 0 ? LOCATION_RANK.length : index;
};

// ── Conservative extractor ───────────────────────────────────────────────────

interface Tool { name: string; pattern: RegExp; roles: Array<'aligner' | 'quantifier'> }

const TOOLS: Tool[] = [
  { name: 'STARsolo', pattern: /\bSTAR ?solo\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'STAR', pattern: /(?:\bRNA-STAR\b|\bSTAR\b(?! ?solo| Methods)|\b[Ss]tar(?= (?:aligner|alignment|v?\d+\.\d))|\([Ss]tar\))/, roles: ['aligner'] },
  { name: 'HISAT2', pattern: /\bhisat2\b/i, roles: ['aligner'] },
  { name: 'HISAT', pattern: /\bhisat\b(?!2)/i, roles: ['aligner'] },
  { name: 'TopHat2', pattern: /\btophat ?2\b/i, roles: ['aligner'] },
  { name: 'TopHat', pattern: /\btophat\b(?! ?2)/i, roles: ['aligner'] },
  { name: 'Bowtie2', pattern: /\bbowtie ?2\b/i, roles: ['aligner'] },
  { name: 'Bowtie', pattern: /\bbowtie\b(?! ?2)/i, roles: ['aligner'] },
  { name: 'BWA', pattern: /\bBWA\b/i, roles: ['aligner'] },
  { name: 'GSNAP', pattern: /\bG(?:S|MAP\/GS)NAP\b/i, roles: ['aligner'] },
  { name: 'minimap2', pattern: /\bminimap2\b/i, roles: ['aligner'] },
  { name: 'Novoalign', pattern: /\bnovoalign\b/i, roles: ['aligner'] },
  { name: 'MapSplice', pattern: /\bMapSplice\b/i, roles: ['aligner'] },
  { name: 'SeqMan NGen', pattern: /\bSeqMan ?NGen\b/i, roles: ['aligner'] },
  { name: 'Subread', pattern: /\bR?subread[- ]align\w*|\b(?:align|mapp)\w*\s+(?:\S+\s+){0,12}(?:using|with)\s+(?:the\s+)?R?subread\b(?!\s*(?:package\s*)?(?:v?[\d.]+\s*)?\)?[\s:]*feature)/i, roles: ['aligner'] },
  { name: 'Cell Ranger', pattern: /\bcell ?ranger\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'CLC Genomics Workbench', pattern: /\bCLC\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'Partek Flow', pattern: /\bPartek Flow\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'Partek', pattern: /\bPartek\b(?! Flow)/i, roles: ['aligner', 'quantifier'] },
  { name: 'DRAGEN', pattern: /\bDRAGEN\b/, roles: ['aligner', 'quantifier'] },
  { name: 'DNBelab C4', pattern: /\bDNBelab\b|\bDNBC4\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'ArrayStudio', pattern: /\bArray ?Studio\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'Salmon', pattern: /\bsalmon\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'kallisto', pattern: /\bkallisto\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'zUMIs', pattern: /\bzUMIs\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'dropSeqPipe', pattern: /\bdropSeqPipe\b/i, roles: ['aligner', 'quantifier'] },
  { name: 'Drop-seq tools', pattern: /\bdrop-?seq[_ ]tools\b/i, roles: ['quantifier'] },
  { name: 'featureCounts', pattern: /\bfeat(?:ure|ur)? ?counts?\b/i, roles: ['quantifier'] },
  { name: 'HTSeq', pattern: /\bht-?seq\b/i, roles: ['quantifier'] },
  { name: 'RSEM', pattern: /\bRSEM\b/i, roles: ['quantifier'] },
  { name: 'Cufflinks', pattern: /\bcuff(?:links|quant|norm)\b/i, roles: ['quantifier'] },
  { name: 'StringTie', pattern: /\bstringtie\b/i, roles: ['quantifier'] },
  { name: 'eXpress', pattern: /\beXpress\b/, roles: ['quantifier'] },
  { name: 'bedtools', pattern: /\bbedtools\b/i, roles: ['quantifier'] },
  { name: 'summarizeOverlaps', pattern: /\bsummarizeOverlaps\b/, roles: ['quantifier'] },
  { name: 'PORT', pattern: /\bPORT\b/, roles: ['quantifier'] },
  { name: 'HOMER', pattern: /\bHOMER\b/i, roles: ['quantifier'] },
  { name: 'EMASE', pattern: /\bEMASE\b/, roles: ['quantifier'] },
  { name: 'UMI-tools', pattern: /\bumi[_-]tools\b/i, roles: ['quantifier'] },
  { name: 'STAR', pattern: /quant ?mode|\bGeneCounts\b|ReadsPerGene|counts (?:generated|produced) by STAR/i, roles: ['quantifier'] },
];

const VERSION = /^[\s(,:;/._'"-]*(?:(?:aligner|alignment|software|suite|package|subread|tool|program|pipeline|single[- ]cell|genomics workbench|workbench|flow|count|align|quant)\s*[,()]?\s*){0,4}(?:v\.?|ver\.?|version)?\s*[:=]?\s*(\d+(?:\.\d+){1,3}(?:[a-z]\d*)?)(?![\d.]*\s*(?:%|million|reads|bp|nt|mm|kb))/i;

interface Found { name: string; version: string | null; at: number }

function findTools(text: string, role: 'aligner' | 'quantifier'): Found[] {
  const found: Found[] = [];
  for (const tool of TOOLS.filter((t) => t.roles.includes(role))) {
    const match = new RegExp(tool.pattern.source, tool.pattern.flags.includes('g') ? tool.pattern.flags : `${tool.pattern.flags}g`).exec(text);
    if (!match) continue;
    let version: string | null = null;
    for (const m of text.matchAll(new RegExp(tool.pattern.source, `${tool.pattern.flags.replace('g', '')}g`))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
      const v = VERSION.exec(after)?.[1];
      if (v) { version = v; break; }
    }
    if (found.some((f) => f.name === tool.name)) continue;
    found.push({ name: tool.name, version, at: match.index });
  }
  // "hisat output" beside "HISAT2 v2.0.4" is the same tool, not a second one.
  return found.filter((f) => !found.some((g) => g.name !== f.name && g.name.startsWith(f.name) && !g.name.includes(' ')))
    .sort((a, b) => a.at - b.at);
}

const GENOMES: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/(?<![A-Za-z0-9])GRCm39(?!\d)/, () => 'GRCm39'], [/(?<![A-Za-z0-9])GRCm38(?:\.p\d+)?(?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])mm39(?!\d)/i, () => 'mm39'],
  [/(?<![A-Za-z0-9])mm10(?!\d)/i, () => 'mm10'], [/(?<![A-Za-z0-9])mm9(?!\d)/i, () => 'mm9'], [/(?<![A-Za-z0-9])NCBIM37(?!\d)/, () => 'NCBIM37'],
  [/(?<![A-Za-z0-9])mRatBN7\.2(?!\d)/i, () => 'mRatBN7.2'], [/(?<![A-Za-z0-9])Rnor[_ ]?([56])(?:\.0)?(?!\d)/i, (m) => `Rnor_${m[1]}.0`], [/(?<![A-Za-z0-9])rn[4-7](?!\d)/i, (m) => m[0].toLowerCase()],
  [/(?<![A-Za-z0-9])GRCh3[78](?:\.p\d+)?(?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])hg(?:19|38)(?!\d)/, (m) => m[0]],
  [/(?<![A-Za-z0-9])Mmul[_ ]?(8\.0\.1|10)(?!\d)/i, (m) => `Mmul_${m[1]}`], [/(?<![A-Za-z0-9])rheMac(?:8|10)(?!\d)/, (m) => m[0]],
  [/(?<![A-Za-z0-9])Macaca_fascicularis_([56])\.0(?!\d)/i, (m) => `Macaca_fascicularis_${m[1]}.0`], [/(?<![A-Za-z0-9])MFA1912RKSv2(?!\d)/, (m) => m[0]],
  [/(?<![A-Za-z0-9])Sscrofa ?(1[01](?:\.1)?)(?!\d)/i, (m) => `Sscrofa${m[1]}`], [/(?<![A-Za-z0-9])susScr1[01](?!\d)/, (m) => m[0]],
  [/(?<![A-Za-z0-9])ARS-UCD ?1\.[23](?!\d)/, (m) => m[0].replace(' ', '')], [/(?<![A-Za-z0-9])UMD ?3\.1(?:\.1)?(?!\d)/, (m) => m[0].replace(' ', '')], [/(?<![A-Za-z0-9])bosTau[689](?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])Btau_?4\.0(?!\d)/, () => 'Btau_4.0'],
  [/(?<![A-Za-z0-9])galGal[4-7](?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])GRCg(?:6a|7b|7w)(?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])Gallus_gallus[-_]([45])\.0(?!\d)/i, (m) => `Gallus_gallus-${m[1]}.0`], [/(?<![A-Za-z0-9])bGalGal1(?!\d)/, (m) => m[0]],
  [/(?<![A-Za-z0-9])GRCz1[01](?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])danRer1[01](?!\d)/, (m) => m[0]], [/(?<![A-Za-z0-9])Zv9(?!\d)/, () => 'Zv9'],
];

function findGenomes(text: string): string[] {
  const hits: Array<{ value: string; at: number }> = [];
  for (const [pattern, name] of GENOMES) {
    const m = new RegExp(pattern.source, pattern.flags).exec(text);
    if (m) hits.push({ value: name(m), at: m.index });
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.value))];
}

const ENSEMBL_ASSEMBLY = String.raw`(?:GRC[mhz]\d{2}|Rnor_6\.0|mRatBN7\.2|Sscrofa11\.1|ARS-UCD1\.[23]|GRCg6a|GRCg7b|Mmul_10|Mmul_8\.0\.1|Macaca_fascicularis_[56]\.0)`;

function findAnnotation(text: string): { name: string; version: string | null } | null {
  const hits: Array<{ name: string; version: string | null; at: number }> = [];
  const push = (m: RegExpExecArray | null, name: string, version: (m: RegExpExecArray) => string | null) => {
    if (m) hits.push({ name, version: version(m), at: m.index });
  };
  push(/\bEnsembl(?:e|\.org)?\b[^.;|]{0,40}?\b(?:release|rel\.?|version|v|build|annotation)\s*[:#]?\s*(\d{2,3})\b/i.exec(text), 'Ensembl', (m) => m[1]);
  push(/\bEnsembl\s*[(]?\s*(\d{2,3})\b/i.exec(text), 'Ensembl', (m) => m[1]);
  push(new RegExp(String.raw`\b${ENSEMBL_ASSEMBLY}\.(\d{2,3})(?:\.gtf|\b)`).exec(text), 'Ensembl', (m) => m[1]);
  push(/\bEnsembl\b/i.exec(text), 'Ensembl', () => null);
  push(/\bgencode\b[^.;|]{0,45}?\b(?:release|version|v)?\s*(M?\d{1,2})\b/i.exec(text), 'GENCODE', (m) => m[1]);
  push(/\bgencode\.v(M?\d{1,2})\b/i.exec(text), 'GENCODE', (m) => m[1]);
  push(/\bgencode\b/i.exec(text), 'GENCODE', () => null);
  push(/\b(?:NCBI\s+)?(?:RefSeq|annotation release)\b[^.;|]{0,30}?\b(?:release|version)\s*(\d+(?:\.\d+)?)\b/i.exec(text), 'RefSeq', (m) => m[1]);
  push(/\bRefSeq\b/i.exec(text), 'RefSeq', () => null);
  push(/\bUCSC\s+(?:known ?genes?|refGene)\b/i.exec(text), 'UCSC genes', () => null);
  push(/\b((?:mm10|mm39|GRCm38|GRCm39|hg19|GRCh38)-(?:\d+\.\d+\.\d+|\d{4}-A))\b/.exec(text), 'Cell Ranger reference', (m) => m[1]);
  push(/\brefdata-(?:gex-|cellranger-)?([A-Za-z0-9_.-]+?)(?=\.tar|[\s,;)|]|$)/.exec(text), 'Cell Ranger reference', (m) => m[1]);
  if (!hits.length) return null;
  // The earliest mention names the source; a later, more specific hit for the
  // SAME source supplies its version.
  hits.sort((a, b) => a.at - b.at);
  const first = hits[0];
  const versioned = hits.find((h) => h.name === first.name && h.version);
  return { name: first.name, version: versioned?.version ?? null };
}

// ── Build rows ───────────────────────────────────────────────────────────────

const datasets = listDatasets();
const accessions = new Map<string, string[]>();
for (const dataset of datasets) {
  const accession = sourceAccession(dataset);
  if (!accession) throw new Error(`${dataset.id} has no source accession; add it to NON_GEO_ACCESSIONS.`);
  accessions.set(accession, [...(accessions.get(accession) ?? []), dataset.id]);
}
const datasetById = new Map(datasets.map((d) => [d.id, d]));

const overrideFile: OverrideFile = existsSync(OVERRIDES)
  ? JSON.parse(readFileSync(OVERRIDES, 'utf8')) : { overrides: {}, reviewed: {} };
for (const [accession, entry] of Object.entries(overrideFile.overrides)) {
  if (!accessions.has(accession)) throw new Error(`Override for unregistered accession ${accession}`);
  if (!entry.reason?.trim()) throw new Error(`Override for ${accession} has no reason`);
  for (const key of Object.keys(entry.fields)) {
    if (!(COLUMNS as readonly string[]).includes(key) || key === 'accession') throw new Error(`Override for ${accession} sets unknown column ${key}`);
  }
}

const candidates = new Map<string, string[]>();
for (const path of listed) {
  const accession = candidateAccession(path);
  if (accession && accessions.has(accession)) candidates.set(accession, [...(candidates.get(accession) ?? []), path]);
}

const configRows = readFileSync(CONFIG, 'utf8').replace(/\r\n/g, '\n').trim().split('\n').map((line) => line.split('\t'));
const configHeader = configRows.shift() ?? [];
const configFor = (accession: string) => configRows
  .filter((row) => row[0] === accession || row[0].startsWith(`${accession}_`))
  .map((row) => Object.fromEntries(configHeader.map((key, index) => [key, row[index]])));

function chooseEvidence(accession: string): Evidence | null {
  const forced = overrideFile.overrides[accession]?.fields.evidence_path;
  if (forced && forced !== NA) return loadEvidence(forced);
  const loaded = (candidates.get(accession) ?? []).map(loadEvidence);
  const kindRank = (e: Evidence) => (e.processing.length ? 0 : 2) + (e.kind === 'matrix' ? 1 : 0);
  loaded.sort((a, b) => kindRank(a) - kindRank(b) || locationRank(a.path) - locationRank(b.path) || a.path.localeCompare(b.path));
  return loaded[0] ?? null;
}

function truncate(text: string): string {
  if (text.length <= VERBATIM_LIMIT) return text;
  const cut = text.slice(0, VERBATIM_LIMIT);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), VERBATIM_LIMIT - 40))} …`;
}

const toolColumns = (found: Found[]) => ({
  name: found.length ? found.map((f) => f.name).join('; ') : NA,
  version: found.some((f) => f.version) ? found.map((f) => f.version ?? NA).join('; ') : NA,
});

function assayClass(accession: string): string {
  const registered = (accessions.get(accession) ?? []).map((id) => datasetById.get(id)!);
  if (registered.some((d) => /single|scRNA|snRNA/i.test(`${d.modality} ${d.preparation}`))) return 'sc_counts';
  const kinds = new Set(configFor(accession).map((row) => row.input_kind));
  if (kinds.has('counts')) return 'rnaseq_counts';
  if (kinds.has('matrix')) return 'rnaseq_normalized';
  return NA;
}

// The series' supplementary files, from every cached copy of the series record
// (a fetched GSM-only record carries none).
function depositedFile(accession: string, evidence: Evidence | null): string {
  const inputs = configFor(accession).map((row) => basename(row.input_path ?? ''));
  const listedFiles = [...(evidence?.supplementary ?? []), ...(candidates.get(accession) ?? []).flatMap((path) => loadEvidence(path).supplementary)];
  const supplementary = [...new Set(listedFiles)].filter((file) => file !== 'NONE' && !/_RAW\.tar$|filelist\.txt$|\.(?:gtf|gff3?|fa|fasta|bed|bw|bigwig)(?:\.gz)?$/i.test(file));
  const matched = [...new Set(inputs.filter((file) => supplementary.includes(file)))];
  if (matched.length) return matched.join('; ');
  return supplementary.length === 1 ? supplementary[0] : NA;
}

function rowPin(row: Row): string {
  const body = COLUMNS.filter((c) => c !== 'review_status').map((c) => row[c]).join('\t');
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

const rows: Row[] = [];
for (const accession of [...accessions.keys()].sort()) {
  const evidence = chooseEvidence(accession);
  const text = evidence?.processing.join(' | ') ?? '';
  const aligners = toolColumns(findTools(text, 'aligner'));
  const quantifiers = toolColumns(findTools(text, 'quantifier'));
  const annotation = findAnnotation(text);
  const repository = accession.startsWith('GSE') ? 'GEO' : accession.startsWith('E-MTAB') ? 'ArrayExpress' : accession.startsWith('CNP') ? 'CNGB' : NA;
  const row: Row = {
    accession, repository, assay_class: assayClass(accession),
    platform_gpl: evidence?.platforms.join('; ') || NA,
    instrument: evidence?.instruments.join('; ') || NA,
    library_strategy: evidence?.strategies.join('; ') || NA,
    aligner: aligners.name, aligner_version: aligners.version,
    genome_build: findGenomes(text).join('; ') || NA,
    annotation: annotation?.name ?? NA, annotation_version: annotation?.version ?? NA,
    quantifier: quantifiers.name, quantifier_version: quantifiers.version,
    deposited_file: depositedFile(accession, evidence),
    evidence_kind: !text ? 'not_stated' : evidence?.kind === 'idf' ? 'ae_idf_protocol' : 'geo_data_processing',
    evidence_path: evidence?.path ?? NA, evidence_sha256: evidence?.sha256 ?? NA,
    verbatim: text ? truncate(clean(text)) : NA,
    review_status: 'parsed', notes: NA,
  };
  const override = overrideFile.overrides[accession];
  if (override) {
    Object.assign(row, override.fields);
    row.notes = clean(override.reason);
  }
  // Keep the evidence hash honest: an override may point at a record but never
  // assert its hash.
  if (row.evidence_path !== NA) {
    const actual = readText(row.evidence_path).sha256;
    if (override?.fields.evidence_sha256 && override.fields.evidence_sha256 !== actual) {
      throw new Error(`${accession}: evidence_sha256 ${override.fields.evidence_sha256} does not match ${row.evidence_path} (${actual})`);
    }
    row.evidence_sha256 = actual;
  }
  const allNa = [row.aligner, row.genome_build, row.annotation, row.quantifier].every((v) => v === NA);
  if (override?.fields.review_status) {
    // An explicit status (needs_review) stands.
  } else if (row.evidence_kind === 'not_stated') {
    row.review_status = 'not_stated';
  } else {
    const pin = rowPin(row);
    if (MARK && (MARK === 'all' || MARK.split(',').includes(accession))) overrideFile.reviewed[accession] = pin;
    if (overrideFile.reviewed[accession] === pin) row.review_status = allNa ? 'not_stated' : 'reviewed';
  }
  rows.push(row);
}

// ── Validate and emit ────────────────────────────────────────────────────────

const problems: string[] = [];
for (const row of rows) {
  for (const column of COLUMNS) {
    if (!row[column] || /[\t\n\r]/.test(row[column])) problems.push(`${row.accession}: bad ${column} value`);
  }
  if (!ASSAY_CLASSES.has(row.assay_class)) problems.push(`${row.accession}: assay_class ${row.assay_class}`);
  if (!EVIDENCE_KINDS.has(row.evidence_kind)) problems.push(`${row.accession}: evidence_kind ${row.evidence_kind}`);
  if (!REVIEW_STATUSES.has(row.review_status)) problems.push(`${row.accession}: review_status ${row.review_status}`);
}
const rowAccessions = new Set(rows.map((row) => row.accession));
for (const dataset of datasets) {
  if (!rowAccessions.has(sourceAccession(dataset)!)) problems.push(`${dataset.id}: no upstream-processing row`);
}
for (const accession of Object.keys(overrideFile.reviewed)) {
  if (!rowAccessions.has(accession)) problems.push(`reviewed pin for unregistered accession ${accession}`);
}
if (problems.length) throw new Error(`upstream processing table is invalid:\n${problems.join('\n')}`);

const tsv = `${[COLUMNS.join('\t'), ...rows.map((row) => COLUMNS.map((c) => row[c]).join('\t'))].join('\n')}\n`;
const withVersion = (name: string, version: string) => {
  if (name === NA) return undefined;
  const names = name.split('; ');
  const versions = version === NA ? [] : version.split('; ');
  return names.map((n, i) => (versions[i] && versions[i] !== NA ? `${n} ${versions[i]}` : n)).join('; ');
};
const compact = Object.fromEntries(rows.map((row) => [row.accession, {
  ...(row.aligner !== NA ? { aligner: withVersion(row.aligner, row.aligner_version) } : {}),
  ...(row.genome_build !== NA ? { genome: row.genome_build } : {}),
  ...(row.annotation !== NA ? { annotation: withVersion(row.annotation, row.annotation_version) } : {}),
  ...(row.quantifier !== NA ? { quantifier: withVersion(row.quantifier, row.quantifier_version) } : {}),
  ...(row.evidence_kind === 'paper_methods' && row.notes !== NA ? { notes: row.notes } : {}),
  evidence: row.evidence_kind,
  status: row.review_status,
}]));
const json = `${JSON.stringify(compact, null, 2)}\n`;
const sortedReviewed = Object.fromEntries(Object.entries(overrideFile.reviewed).sort(([a], [b]) => a.localeCompare(b)));
const overridesText = `${JSON.stringify({ ...overrideFile, reviewed: sortedReviewed }, null, 2)}\n`;

const outputs: Array<[string, string]> = [[TSV, tsv], [JSON_OUT, json]];
if (MARK) outputs.push([OVERRIDES, overridesText]);
if (CHECK) {
  const stale = outputs.filter(([file, content]) => !existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content);
  if (stale.length) {
    console.error(`upstream processing is stale: ${stale.map(([file]) => file.slice(ROOT.length + 1)).join(', ')}. Run npx tsx scripts/build_upstream_processing.mts and review the diff.`);
    process.exit(1);
  }
} else {
  for (const [file, content] of outputs) writeFileSync(file, content);
}
const count = (column: Column) => Object.entries(rows.reduce<Record<string, number>>((acc, row) => {
  acc[row[column]] = (acc[row[column]] ?? 0) + 1; return acc;
}, {})).map(([k, v]) => `${k}=${v}`).join(', ');
console.log(`upstream processing: ${rows.length} accessions for ${datasets.length} datasets; evidence ${count('evidence_kind')}; review ${count('review_status')}${CHECK ? ' (check passed)' : ''}`);
