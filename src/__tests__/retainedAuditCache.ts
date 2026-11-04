/**
 * Tests whose result depends on the retained audit cache, and the CI-only gate that skips them.
 *
 * The retained audit cache is the set of gitignored source downloads and raw inputs that exist only on
 * the computer that ran the original audits (docs/PROJECT_GUIDANCE.md, "Retained audit cache"). On a
 * clean checkout the evidence readers below cannot open those files, so they report `not_assessed`:
 * a test that expects `pass` fails, and a test that expects a rejection passes without reaching the
 * check it names. Neither result says anything about the evidence.
 *
 * The gate tells "the cache is absent" apart from "the evidence is wrong". It skips a declared test
 * only when both hold:
 *   1. HYPOEXPLORER_RETAINED_CACHE=absent is declared (the GitHub Actions test step sets it), and
 *   2. every retained input the test declares is missing from the checkout.
 * When any declared input is present, the test runs and must pass, so a partial or altered cache still
 * fails. Without the variable nothing changes. Each skip is named in the job output.
 *
 * The pinned evidence tests are not edited: the gate runs from setup.ts, keyed by test file and full
 * test name. The declared inputs are the gitignored files each test reaches first on a clean checkout;
 * retainedAuditCache.test.ts checks that git ignores every one of them and tracks none.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { afterAll, beforeEach } from 'vitest';

export const RETAINED_CACHE_ENV = 'HYPOEXPLORER_RETAINED_CACHE';

export interface CacheDependentTest {
  /** Test file as Vitest reports it, relative to the repository root. */
  file: string;
  /** Suite and test name joined by ' > ', as Vitest's `fullTestName`. */
  test: string;
  /** Gitignored retained inputs the test reads; all must be absent for a skip. */
  inputs: readonly string[];
}

const AUTHENTICITY = 'data/internal-qc/source-authenticity-2026-09-05';
const round2 = (accession: string, file: string) => `${AUTHENTICITY}/round2/downloads/${accession}/${file}`;

// countConservationEvidence.test.ts and reviewedFgseaSpecies.test.ts run inside this wrapper.
const SEALED = 'src/__tests__/sealedEvidenceProjection.test.ts';
const CONSERVATION = 'complete source-to-input conservation evidence';
const GSE198437 = [`${AUTHENTICITY}/downloads/GSE198437/GSE198437_Raw_gene_count_matrix.txt.gz`];
const GSE245727 = [round2('GSE245727', 'GSE245727_RAW.tar')];
const GSE254155 = [round2('GSE254155', 'GSE254155_RAW.tar')];
const GSE289833 = [round2('GSE289833', 'GSE289833_RAW.tar')];
const GSE201207 = [round2('GSE201207', 'GSE201207_count_216.csv.gz')];
const GSE314817 = [round2('GSE314817', 'GSE314817_mouse_raw_counts_wo_muscle.txt.gz')];
const SPECIES = 'reviewed retained pathway species';
const GSE262407 = ['geo_replication/datasets/GSE262407_discovery_20260905/raw/GSE262407_barcodes.tsv.gz'];
const KEYED = 'src/__tests__/keyedSourceRelationship.test.ts';
const RELATIONSHIP = 'complete unique-gene source relationship';
const GSE254155_SOURCES = ['GSE254155_RAW.tar', 'GSE254155_RAW.tar.download.json', 'GSE254155_family.soft.gz',
  'GSE254155_family.soft.gz.download.json'].map(file => round2('GSE254155', file));
const REPLICATION = 'src/__tests__/replicationEvidence.test.ts';

const tests = (file: string, suite: string, inputs: readonly string[], names: readonly string[]) =>
  names.map((name): CacheDependentTest => ({ file, test: `${suite} > ${name}`, inputs }));

export const CACHE_DEPENDENT_TESTS: readonly CacheDependentTest[] = [
  ...tests(SEALED, CONSERVATION, GSE198437, [
    'accepts the independently remeasured exact priority source',
    'does not trust an altered saved dataset status',
    'rejects missing per-cell mismatch evidence',
    'rejects a partial selected-sample audit',
    'rejects duplicate selected samples',
    'detects changed actual source bytes through a read-only injection',
    'refuses a different current sample roster',
    'keeps a current measured total disagreement visible',
    'preserves an existing failure',
    'requires the complete number of retained count cells',
    'requires nonempty source column names',
    'does not count the same source column as two independent selected columns',
  ]),
  ...tests(SEALED, CONSERVATION, GSE245727, [
    'accepts complete independently reread recovered source counts for GSE245727',
    'requires the selected source member mapping',
    'requires original recovered source acquisition logs',
  ]),
  ...tests(SEALED, CONSERVATION, GSE254155, [
    'accepts complete independently reread recovered source counts for GSE254155',
    'keeps keyed conservation distinct from strict GSE254155 reconstruction',
    'requires all recovered original archive members in the inventory',
  ]),
  ...tests(SEALED, CONSERVATION, GSE289833, [
    'accepts complete independently reread recovered source counts for GSE289833',
    'rejects a swapped case/control source mapping',
  ]),
  ...tests(SEALED, CONSERVATION, GSE201207, [
    'accepts complete independently reread recovered source counts for GSE201207_young_vs_old',
    'does not hide an original-to-aggregate discrepancy behind matching output totals',
  ]),
  ...tests(SEALED, CONSERVATION, GSE314817, [
    'accepts complete independently reread recovered source counts for GSE314817_6v27mo',
    'requires original pre-aggregation library totals',
  ]),
  ...tests(SEALED, SPECIES, GSE262407, [
    'verifies all four unchanged mouse-reference artifacts while retaining the biological species correction',
    'rejects unknown tracks, contrasts, changed display species and borrowed DE paths',
    'cannot mix a cached review with later substituted specification bytes',
  ]),
  ...tests(KEYED, RELATIONSHIP, GSE254155_SOURCES, [
    'validates both current path forms and preserves a prior failure',
    `rejects changed evidence at ${AUTHENTICITY}/round5-keyed/complete-reconstructed-input.tsv.gz`,
    ...GSE254155_SOURCES.map(path => `rejects changed evidence at ${path}`),
  ]),
  ...tests(REPLICATION, 'primary-source biological replication evidence', [
    round2('GSE273038', 'GSE273038_IRISeq_df_cell.txt.gz'),
    `${AUTHENTICITY}/round5/region-code/dmb-zenodo_0.9.2.zip`,
    round2('GSE205313', 'GSE205313_family.soft.gz'),
    `${AUTHENTICITY}/downloads/GSE174085/GSE174085_new_allcells111620.matrix.txt.gz`,
  ], ['validates current provenance before returning a reviewed pass or review blocker']),
];

/** Whether the environment declares the retained cache absent. Any value but `absent` is refused. */
export function retainedCacheDeclaredAbsent(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[RETAINED_CACHE_ENV];
  if (value === undefined || value === '') return false;
  if (value === 'absent') return true;
  throw new Error(`${RETAINED_CACHE_ENV} must be unset or "absent", not ${JSON.stringify(value)}`);
}

/** The skip note for a declared test whose retained inputs are all missing, else null (run it). */
export function retainedCacheSkip(entry: CacheDependentTest, exists: (path: string) => boolean): string | null {
  if (entry.inputs.some(exists)) return null;
  const [first, ...rest] = entry.inputs;
  return `retained audit cache absent: ${first}${rest.length ? ` and ${rest.length} more` : ''}`;
}

const key = (file: string, test: string) => `${file}\0${test}`;

/** Register the gate for the current test file. Does nothing unless the cache is declared absent. */
export function installRetainedCacheGate(root = process.cwd()): void {
  if (!retainedCacheDeclaredAbsent()) return;
  const declared = new Map(CACHE_DEPENDENT_TESTS.map(entry => [key(entry.file, entry.test), entry]));
  const skipped: string[] = [];
  let file = '';
  beforeEach(context => {
    file = relative(root, context.task.file.filepath).replace(/\\/g, '/');
    const entry = declared.get(key(file, context.task.fullTestName));
    const note = entry && retainedCacheSkip(entry, path => existsSync(resolve(root, path)));
    if (!note) return;
    skipped.push(`${context.task.fullTestName} (${note})`);
    context.skip(note);
  });
  afterAll(() => {
    if (!skipped.length) return;
    const title = `Skipped ${skipped.length} test(s) that need the retained audit cache in ${file}`;
    const annotation = process.env.GITHUB_ACTIONS === 'true' ? `::warning file=${file},title=Retained audit cache absent::${title}\n` : '';
    // Written to stderr directly: Vitest does not print console output from a passing file.
    process.stderr.write(`${annotation}${title}:\n${skipped.map(name => `  - ${name}\n`).join('')}`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) appendFileSync(summary, `### ${title}\n\n${skipped.map(name => `- ${name}`).join('\n')}\n\n`);
  });
}
