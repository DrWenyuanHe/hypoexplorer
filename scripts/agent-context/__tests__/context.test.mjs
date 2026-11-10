import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSnapshot, normalize, git } from '../snapshot.mjs';
import { buildModel, fingerprints, checkReviews, isSource, START, END } from '../model.mjs';
import { renderFiles, injectOverview, checkLinks } from '../render.mjs';
import { literalReader } from '../source.mjs';
import { checkSnapshot, pushedRevisions, run } from '../cli.mjs';
import { installHook, WRAPPER } from '../install-hook.mjs';

function fixture() {
  const catalog = {
    version: 1, directories: { src: 'Application' },
    modules: { data: { summary: 'Registry', references: ['src/data/datasets.ts'] }, types: { summary: 'Types', references: ['src/types/index.ts'] }, explorer: { summary: 'Navigation', references: ['src/explorer/explorerTabs.ts'] } },
    categories: { Studies: 'Reviewed study category' }, contracts: { Dataset: 'Study identity', Row: 'Expression row' }, views: { hub: 'explorer', explorer: 'explorer' }, tabs: { gene: 'explorer' }, relationships: ['Datasets supply tracks.'],
    workflows: { intake: { summary: 'Review intake', runbook: 'docs/intake.md', modules: ['data'], sources: ['scripts/'] } },
  };
  return new Map(Object.entries({
    'AGENTS.md': '# Guidance\n\nKeep authored policy.\n', 'CLAUDE.md': '@AGENTS.md\n',
    'CONTEXT.md': '# Terms\n', 'docs/intake.md': '# Intake\n\n## Verify\n',
    'docs/DATASET_CONTRACT.md': '# Contract\n', 'docs/REAL_DATA_SHAPES.md': '# Shapes\n', 'data/author-validation/README.md': '# Evidence\n',
    'docs/agent-context/README.md': '# Context\n', 'docs/agent-context/workflows.md': '# Workflows\n\n## intake\n',
    'docs/agent-context/catalog.json': JSON.stringify(catalog),
    'src/data/datasets.ts': `export const DATASETS = [defineDataset({id:'one', name:'First', category:'Studies', organism:'Mouse', modality:'RNA', citation:'Reviewed first study'}), defineBulkStudy({id:'two', name:'Second', category:'Studies', organism:'Rat', modality:'RNA', citation:'Reviewed second study'})];`,
    'src/data/datasetCategories.ts': `export const DATASET_CATEGORIES = ['Studies'] as const;`,
    'src/data/reviewedStudyMetadata.ts': 'export {};',
    'src/types/index.ts': 'export interface Dataset { id: string; }\nexport type Row = { gene: string; value?: number };',
    'src/appRouter.ts': `export type AppView = 'hub' | 'explorer';`,
    'src/explorer/explorerTabs.ts': `export const EXPLORER_TABS = [['gene', 'Genes']] as const;`,
    'src/utils-placeholder.ts': 'export {};', 'src/main.tsx': 'export {};', 'src/App.tsx': 'export {};',
    // link target only; no extra module inventory in the synthetic snapshot
    'scripts/build.mjs': '// Build behavior.\n',
  }));
}
function memory(files) {
  const names = [...files.keys()].sort();
  return { files: names, staged: false, has: (n) => files.has(n) || names.some((p) => p.startsWith(n + '/')), preload: () => {}, read: (n) => { assert.ok(files.has(n), `Missing fixture ${n}`); return normalize(files.get(n)); } };
}
function model(files) { return buildModel(memory(files)); }
function editCatalog(files, edit) { const value = JSON.parse(files.get('docs/agent-context/catalog.json')); edit(value); files.set('docs/agent-context/catalog.json', JSON.stringify(value)); }
// Only fixtures synthesize reviews; production has no approval command.
function approveFixture(files) {
  const snapshot = memory(files), m = buildModel(snapshot);
  for (const [area, value] of Object.entries(fingerprints(snapshot, m))) files.set(`docs/agent-context/reviews/${area}.json`, JSON.stringify({ version: 1, area, fingerprint: value.fingerprint, outcome: 'no-impact', explanation: 'Synthetic fixture review covering the known fixture source and contract.', references: ['CONTEXT.md'] }));
}
function generatedFixture() {
  const files = fixture();
  // The renderer's shared appLinks link exists as a directory reference target
  // while the synthetic model only has three modules.
  files.set('src/utils/appLinks.ts', 'export {};');
  editCatalog(files, (c) => { c.modules.utils = { summary: 'Links', references: ['src/utils/appLinks.ts'] }; });
  for (const [name, text] of renderFiles(memory(files), model(files))) files.set(name, text);
  approveFixture(files);
  return files;
}
function writeFiles(root, files) { for (const [name, text] of files) { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); } }
function repository(t, files = generatedFixture()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hypo-context-test-'));
  t.after(() => {
    const target = realpathSync(root), parent = realpathSync(os.tmpdir());
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith('hypo-context-test-'));
    rmSync(target, { recursive: true, force: true });
  });
  git(root, ['init', '-q']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'user.name', 'Context Fixture']);
  git(root, ['config', 'user.email', 'context-fixture@example.invalid']);
  writeFiles(root, files);
  return root;
}
function commit(root) {
  git(root, ['add', '--all']);
  git(root, ['-c', `core.hooksPath=${path.join(root, 'no-hooks')}`, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
}

test('static inventories and deterministic generation preserve authored text', () => {
  const files = generatedFixture(), snapshot = memory(files), m = model(files);
  assert.equal(m.datasets.length, 2);
  assert.equal(m.contracts.length, 2);
  const output = renderFiles(snapshot, m);
  assert.deepEqual([...output], [...renderFiles(snapshot, m)]);
  assert.ok(output.get('AGENTS.md').startsWith('# Guidance\n\nKeep authored policy.\n'));
  assert.deepEqual(checkLinks(snapshot, output), []);
  checkSnapshot(snapshot);
});
test('LF, CRLF and CR produce the same output and hashes', () => {
  const lf = generatedFixture(), crlf = new Map([...lf].map(([p, s]) => [p, s.replace(/\n/g, '\r\n')]));
  assert.deepEqual(fingerprints(memory(lf), model(lf)), fingerprints(memory(crlf), model(crlf)));
  assert.deepEqual(renderFiles(memory(lf), model(lf)), renderFiles(memory(crlf), model(crlf)));
  assert.equal(normalize('a\rb\r\nc'), 'a\nb\nc');
});
test('inventory additions and removals require authored catalog changes', () => {
  for (const mutate of [
    (f) => f.set('src/new-feature/index.ts', 'export {};'),
    (f) => f.delete('src/types/index.ts'),
    (f) => f.set('src/types/index.ts', f.get('src/types/index.ts') + '\nexport type NewType = string;'),
    (f) => editCatalog(f, (c) => { c.modules.obsolete = { summary: 'Gone', references: ['CONTEXT.md'] }; }),
    (f) => f.set('src/data/datasetCategories.ts', `export const DATASET_CATEGORIES = ['Studies', 'New'];`),
    (f) => f.set('src/appRouter.ts', `export type AppView = 'hub' | 'explorer' | 'new';`),
  ]) { const files = fixture(); mutate(files); assert.throws(() => model(files)); }
});
test('dataset meanings, IDs, categories and registration syntax are validated', () => {
  for (const [before, after] of [["id:'two'", "id:'one'"], ["citation:'Reviewed first study'", "citation:''"], ["category:'Studies'", "category:'Missing'"], ["id:'one'", "id:makeId()"], ['defineDataset({', 'arbitraryFactory({']]) {
    const files = fixture(); files.set('src/data/datasets.ts', files.get('src/data/datasets.ts').replace(before, after)); assert.throws(() => model(files));
  }
  const files = fixture(); files.set('src/data/datasets.ts', files.get('src/data/datasets.ts') + '\nDATASETS.push(makeDataset());'); assert.throws(() => model(files), /mutation/);
});
test('registered sidecar and reviewed metadata are extracted without running code', () => {
  const files = fixture();
  files.set('src/data/datasets.ts', `import EXTRA from './extra.json';\n${files.get('src/data/datasets.ts')}\nDATASETS.push(...EXTRA.map((study) => defineDataset(reviewedStudyMetadata(study as Dataset))));`);
  files.set('src/data/extra.json', JSON.stringify([{ id: 'three', name: 'Old', organism: 'Old species', modality: 'RNA', citation: 'Original citation', category: 'Studies' }]));
  files.set('src/data/reviewedStudyMetadata.ts', `export function reviewedStudyMetadata(study: Dataset) { if (study.id !== 'three') return study; return {...study, name: 'Corrected', organism: 'Correct species'}; }`);
  assert.equal(model(files).datasets[2].organism, 'Correct species');
  files.set('src/data/reviewedStudyMetadata.ts', `export function reviewedStudyMetadata(study: Dataset) { return fetch('https://invalid'); }`);
  assert.throws(() => model(files), /Unsupported reviewed metadata/);
});
test('a unit-only relabel may wrap a sidecar record, and nothing broader', () => {
  const files = fixture();
  const base = `import EXTRA from './extra.json';\n${files.get('src/data/datasets.ts')}\n`;
  const push = 'DATASETS.push(...EXTRA.map((study) => defineDataset(reviewedStudyMetadata(relabel(study as Dataset)))));';
  files.set('src/data/reviewedStudyMetadata.ts', `export function reviewedStudyMetadata(study: Dataset) { if (study.id !== 'none') return study; return {...study, name: 'Unused'}; }`);
  files.set('src/data/extra.json', JSON.stringify([{ id: 'three', name: 'Old', organism: 'Mouse', modality: 'RNA', citation: 'Original citation', category: 'Studies', expressionUnit: 'CPM' }]));
  files.set('src/data/datasets.ts', `${base}const relabel = (study: Dataset): Dataset => study.expressionUnit === 'CPM' ? { ...study, expressionUnit: 'TMM' } : study;\n${push}`);
  assert.equal(model(files).datasets[2].name, 'Old');
  files.set('src/data/datasets.ts', `${base}const relabel = (study: Dataset): Dataset => study.expressionUnit === 'CPM' ? { ...study, name: 'Changed' } : study;\n${push}`);
  assert.throws(() => model(files), /Unsupported DATASETS mutation/);
  files.set('src/data/datasets.ts', `${base}const relabel = (study: Dataset): Dataset => ({ ...study, expressionUnit: 'TMM', citation: 'x' });\n${push}`);
  assert.throws(() => model(files), /Unsupported DATASETS mutation/);
});
test('literal resolver handles named aliases, and rejects unresolved/circular values', () => {
  const files = new Map([['a.ts', `import { value as other } from './b'; export const result = (other satisfies string);`], ['b.ts', `export const value = 'ok';`]]);
  assert.equal(literalReader(memory(files)).constant('a.ts', 'result'), 'ok');
  files.set('b.ts', `import { result } from './a'; export const value = result;`);
  assert.throws(() => literalReader(memory(files)).constant('a.ts', 'result'), /Circular/);
  files.delete('b.ts'); assert.throws(() => literalReader(memory(files)).constant('a.ts', 'result'), /resolve/);
});
test('source additions, removal, rename and hidden behavior changes invalidate reviews', () => {
  const files = generatedFixture(), initial = fingerprints(memory(files), model(files));
  const output = renderFiles(memory(files), model(files));
  files.set('scripts/build.mjs', '// Changed operational behavior.\n');
  assert.deepEqual(renderFiles(memory(files), model(files)), output);
  let changed = fingerprints(memory(files), model(files));
  assert.notEqual(changed.repository.fingerprint, initial.repository.fingerprint);
  assert.notEqual(changed['workflow-intake'].fingerprint, initial['workflow-intake'].fingerprint);
  files.set('scripts/new.mjs', 'content');
  const added = fingerprints(memory(files), model(files));
  files.delete('scripts/new.mjs'); files.set('scripts/renamed.mjs', 'content');
  assert.notEqual(fingerprints(memory(files), model(files)).repository.fingerprint, added.repository.fingerprint);
  files.delete('scripts/renamed.mjs'); assert.equal(fingerprints(memory(files), model(files)).repository.fingerprint, changed.repository.fingerprint);
});
test('generated outputs and reviews do not invalidate themselves; agent/config/R changes do', () => {
  const files = generatedFixture(), initial = fingerprints(memory(files), model(files));
  files.set('docs/agent-context/generated/old.md', 'old'); files.set('docs/agent-context/reviews/old.json', '{}');
  assert.deepEqual(fingerprints(memory(files), model(files)), initial);
  for (const name of ['.agents/skills/demo/SKILL.md', '.codex/config.toml', '.github/workflows/check.yml', 'scripts/model.R', 'data/quality/audit.py', 'workers/demo/rules.ts']) assert.equal(isSource(name), true, name);
  for (const name of ['public/datasets/a.js', 'data/results.csv', 'data/evidence.json', 'data/archive/author.py', 'src/node_modules/pkg/a.ts']) assert.equal(isSource(name), false, name);
});
test('review gate rejects missing, stale, invalid and obsolete records', () => {
  const files = generatedFixture(), areas = fingerprints(memory(files), model(files)), name = 'docs/agent-context/reviews/repository.json';
  const record = JSON.parse(files.get(name));
  for (const patch of [{ fingerprint: 'wrong' }, { version: 2 }, { area: 'wrong' }, { explanation: 'short' }, { outcome: 'approved' }, { references: ['missing.md'] }, { references: [] }]) {
    files.set(name, JSON.stringify({ ...record, ...patch })); assert.ok(checkReviews(memory(files), areas).length);
  }
  files.delete(name); assert.ok(checkReviews(memory(files), areas).length);
  files.set(name, JSON.stringify(record)); assert.deepEqual(checkReviews(memory(files), areas), []);
  files.set('docs/agent-context/reviews/obsolete.json', '{}'); assert.match(checkReviews(memory(files), areas).join(), /obsolete/);
});
test('markers, size budgets, references and anchors fail closed', () => {
  for (const invalid of [START, END, END + START, START + END + START + END]) assert.throws(() => injectOverview(invalid, 'map'), /markers/);
  const files = generatedFixture();
  files.set('AGENTS.md', 'x'.repeat(17 * 1024)); assert.throws(() => renderFiles(memory(files), model(files)), /16 KiB/);
  files.set('AGENTS.md', '# Root\n'); editCatalog(files, (c) => { c.relationships = ['x'.repeat(7 * 1024)]; }); assert.throws(() => renderFiles(memory(files), model(files)), /6 KiB/);
  editCatalog(files, (c) => { c.modules.data.references = ['../escape']; }); assert.throws(() => model(files), /reference/);
  const snapshot = memory(generatedFixture());
  assert.match(checkLinks(snapshot, new Map([['docs/agent-context/test.md', '[bad](../intake.md#missing)']])).join(), /anchor/);
  assert.deepEqual(checkLinks(snapshot, new Map([['docs/agent-context/test.md', '[ok](../intake.md#verify)']])), []);
});
test('snapshot isolation: index, revision, new files and working repairs', (t) => {
  const root = repository(t); commit(root);
  checkSnapshot(loadSnapshot(root, 'HEAD'));
  writeFileSync(path.join(root, 'scripts/build.mjs'), '// new working behavior');
  assert.throws(() => checkSnapshot(loadSnapshot(root)), /Stale review/);
  checkSnapshot(loadSnapshot(root, 'HEAD'));
  checkSnapshot(loadSnapshot(root, undefined, { staged: true }));
  git(root, ['add', 'scripts/build.mjs']);
  assert.throws(() => checkSnapshot(loadSnapshot(root, undefined, { staged: true })), /Stale review/);
  commit(root);
  writeFileSync(path.join(root, 'scripts/build.mjs'), '// Build behavior.\n');
  checkSnapshot(loadSnapshot(root));
  assert.throws(() => checkSnapshot(loadSnapshot(root, 'HEAD')), /Stale review/);
  assert.throws(() => loadSnapshot(root, 'HEAD', { staged: true }), /combine/);
});
test('generate twice leaves reviews and index untouched; staged generation protects authored root text', (t) => {
  const root = repository(t); commit(root);
  const index = readFileSync(path.join(root, '.git/index'));
  const review = readFileSync(path.join(root, 'docs/agent-context/reviews/repository.json'));
  run(['generate'], root); run(['generate'], root);
  assert.deepEqual(readFileSync(path.join(root, '.git/index')), index);
  assert.deepEqual(readFileSync(path.join(root, 'docs/agent-context/reviews/repository.json')), review);
  writeFileSync(path.join(root, 'AGENTS.md'), readFileSync(path.join(root, 'AGENTS.md'), 'utf8') + '\nUnstaged policy.\n');
  assert.throws(() => run(['generate', '--staged'], root), /unstaged authored/);
  assert.ok(readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('Unstaged policy.'));
});
test('symlink sources and unmerged index entries are rejected', (t) => {
  const root = repository(t); commit(root);
  const blob = git(root, ['hash-object', '-w', '--stdin'], { input: 'CONTEXT.md' }).trim();
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${blob},scripts/link.mjs`]);
  assert.throws(() => loadSnapshot(root, undefined, { staged: true }).read('scripts/link.mjs'), /symlinks/);
  git(root, ['update-index', '--force-remove', 'scripts/link.mjs']);
  git(root, ['update-index', '--index-info'], { input: `100644 ${blob} 1\tconflict.ts\n100644 ${blob} 2\tconflict.ts\n` });
  assert.throws(() => loadSnapshot(root, undefined, { staged: true }), /unmerged/);
});
test('pre-push validates distinct pushed tips, skips deletions and rejects malformed refs', (t) => {
  const root = repository(t); commit(root); const good = git(root, ['rev-parse', 'HEAD']).trim(), zero = '0'.repeat(40);
  assert.deepEqual(pushedRevisions(`refs/heads/a ${good} refs/heads/a ${zero}\nrefs/heads/b ${good} refs/heads/b ${zero}\n(delete) ${zero} refs/heads/c ${good}\n`), [good]);
  assert.throws(() => pushedRevisions('bad input'), /Malformed/);
  const cli = new URL('../cli.mjs', import.meta.url).href;
  const invoke = (input) => execFileSync(process.execPath, ['--input-type=module', '-e', `import {run} from ${JSON.stringify(cli)}; run(['check','--pre-push'], process.argv[1]);`, root], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(invoke(`refs/heads/a ${good} refs/heads/a ${zero}\n`), /Verified pushed revision/);
  writeFileSync(path.join(root, 'scripts/build.mjs'), '// stale'); commit(root); const bad = git(root, ['rev-parse', 'HEAD']).trim();
  assert.throws(() => invoke(`refs/heads/a ${good} refs/heads/a ${zero}\nrefs/heads/b ${bad} refs/heads/b ${zero}\n`), /Stale review/);
});
test('hook installer preserves prior hook, is idempotent and refuses conflicting backups', (t) => {
  const root = repository(t), hook = path.join(root, '.git/hooks/pre-push');
  const original = '#!/bin/sh\ngit lfs pre-push "$@"\n'; writeFileSync(hook, original);
  assert.equal(installHook(root), true);
  assert.equal(readFileSync(hook, 'utf8'), WRAPPER);
  assert.equal(readFileSync(hook + '.context-original', 'utf8'), original);
  assert.equal(installHook(root), false);
  writeFileSync(hook, '#!/bin/sh\necho changed\n'); assert.throws(() => installHook(root), /differs/);
});
test('all extraction inputs are preloaded before the first read', () => {
  const files = generatedFixture(), snapshot = memory(files), loaded = new Set();
  const guarded = { ...snapshot, preload: (names) => { names.forEach((n) => { loaded.add(n); }); }, read: (n) => { assert.ok(loaded.has(n), `Unbatched read: ${n}`); return snapshot.read(n); } };
  checkSnapshot(guarded);
});

test('nested registry mutations and assignment cannot silently escape extraction', () => {
  for (const addition of ['function add() { DATASETS.push(make()); }', 'DATASETS[0] = make();', 'DATASETS.length++;']) {
    const files = fixture(); files.set('src/data/datasets.ts', files.get('src/data/datasets.ts') + '\n' + addition);
    assert.throws(() => model(files), /Unsupported/);
  }
});

test('hook forwards exact stdin and arguments, and stops before original on failure', (t) => {
  const root = repository(t);
  const shell = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/sh';
  assert.ok(existsSync(shell), `Git shell required for hook test: ${shell}`);
  writeFiles(root, new Map([
    ['scripts/agent-context/cli.mjs', `import {readFileSync,writeFileSync} from 'node:fs'; writeFileSync('context-input.txt', readFileSync(0)); process.exit(process.env.CONTEXT_TEST_FAIL ? 1 : 0);`],
    ['.git/hooks/pre-push', '#!/bin/sh\ncat > original-input.txt\nprintf "%s\\n" "$@" > original-args.txt\n'],
  ]));
  installHook(root);
  const input = 'refs/heads/topic 123 refs/heads/topic 456\n\n';
  execFileSync(shell, ['.git/hooks/pre-push', 'origin', '/tmp/remote with spaces'], { cwd: root, input });
  assert.equal(readFileSync(path.join(root, 'context-input.txt'), 'utf8'), input);
  assert.equal(readFileSync(path.join(root, 'original-input.txt'), 'utf8'), input);
  assert.equal(readFileSync(path.join(root, 'original-args.txt'), 'utf8'), 'origin\n/tmp/remote with spaces\n');
  writeFileSync(path.join(root, 'original-input.txt'), 'unchanged');
  assert.throws(() => execFileSync(shell, ['.git/hooks/pre-push'], { cwd: root, input, env: { ...process.env, CONTEXT_TEST_FAIL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }));
  assert.equal(readFileSync(path.join(root, 'original-input.txt'), 'utf8'), 'unchanged');
});

test('committed sources with spaces are read in one Git blob batch', (t) => {
  const root = repository(t);
  writeFileSync(path.join(root, 'scripts/source with spaces.mjs'), '// unicode: β\n');
  commit(root);
  const trace = path.join(root, '.git/context-trace.log').replace(/\\/g, '/');
  const previous = process.env.GIT_TRACE;
  try {
    process.env.GIT_TRACE = trace;
    const snapshot = loadSnapshot(root, 'HEAD');
    const m = buildModel(snapshot);
    fingerprints(snapshot, m);
    assert.equal(snapshot.read('scripts/source with spaces.mjs'), '// unicode: β\n');
  } finally {
    if (previous === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = previous;
  }
  assert.equal((readFileSync(trace, 'utf8').match(/git cat-file --batch/g) || []).length, 1);
});

test('stale/obsolete output and missing startup import are rejected, with narrow cleanup', (t) => {
  const files = generatedFixture();
  files.set('CLAUDE.md', '# Missing import\n'); assert.throws(() => checkSnapshot(memory(files)), /must import/);
  files.set('CLAUDE.md', '@AGENTS.md\n');
  files.set('docs/agent-context/generated/obsolete.md', 'old'); assert.throws(() => checkSnapshot(memory(files)), /Obsolete generated/);
  const root = repository(t, files);
  run(['generate'], root);
  assert.equal(existsSync(path.join(root, 'docs/agent-context/generated/obsolete.md')), false);
  writeFiles(root, new Map([['docs/agent-context/generated/notes.txt', 'keep']]));
  assert.throws(() => run(['generate'], root), /unexpected generated path/);
  assert.equal(readFileSync(path.join(root, 'docs/agent-context/generated/notes.txt'), 'utf8'), 'keep');
});
