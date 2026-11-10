import { createHash } from 'node:crypto';
import { compare } from './snapshot.mjs';
import { readStructure } from './source.mjs';

export const CONTEXT_DIR = 'docs/agent-context';
export const GENERATED_DIR = `${CONTEXT_DIR}/generated`;
export const START = '<!-- agent-context:start -->';
export const END = '<!-- agent-context:end -->';
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export function withoutOverview(text) {
  const start = text.indexOf(START), end = text.indexOf(END);
  if (start < 0 && end < 0) return text;
  if (start < 0 || end < start || text.indexOf(START, start + START.length) >= 0 || text.indexOf(END, end + END.length) >= 0) throw new Error('Invalid AGENTS.md generated markers');
  return text.slice(0, start) + text.slice(end + END.length);
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const string = (value) => typeof value === 'string' && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(string);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const equalKeys = (keys, entries, label) => assert(JSON.stringify([...keys].sort(compare)) === JSON.stringify(Object.keys(entries).sort(compare)), `${label} catalog coverage changed; add/remove reviewed descriptions`);
export function requireReference(snapshot, name) {
  assert(string(name) && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..') && !name.includes(':'), `Invalid repository reference: ${name}`);
  assert(snapshot.has(name.replace(/\/$/, '')), `Unresolved repository reference: ${name}`);
}

export function isSource(name) {
  if (name.startsWith(`${GENERATED_DIR}/`) || name.startsWith(`${CONTEXT_DIR}/reviews/`)) return false;
  // Data products (CSV/TSV, bundles, archives) have their own scientific checks.
  // Include repository-owned analysis code/docs, excluding downloaded author code.
  if (/(?:^|\/)(?:node_modules|__pycache__|archive|downloads|extracted-source|runtime|region-code|author-code)\//.test(name)) return false;
  if (/^(?:src|scripts|workers|docs|data|geo_replication|nar-research|\.github|\.agents|\.claude|\.codex)\//.test(name)) {
    const ext = /\.(?:[cm]?[jt]sx?|md|sql|py|[rR]|ps1|ya?ml|toml|css|html|sh|jsonc?)$/.test(name);
    if (/^(?:data|geo_replication|nar-research)\//.test(name) && /\.json$/.test(name)) return false;
    return ext;
  }
  return name.startsWith('.githooks/') || /^[^/]+\.(?:[cm]?[jt]s|jsonc?|md|toml|html|ya?ml)$/.test(name) || ['.gitignore', '.gitattributes', 'VERSION'].includes(name);
}

export function buildModel(snapshot) {
  snapshot.preload(snapshot.files.filter((name) => isSource(name) || name.startsWith(`${CONTEXT_DIR}/`)));
  const catalog = JSON.parse(snapshot.read(`${CONTEXT_DIR}/catalog.json`));
  assert(catalog.version === 1, 'Unsupported context catalog version');
  for (const key of ['directories', 'modules', 'categories', 'contracts', 'views', 'tabs', 'workflows']) assert(object(catalog[key]), `Invalid catalog.${key}`);
  assert(strings(catalog.relationships), 'Invalid relationships');
  const ids = [...new Set(snapshot.files.filter((n) => /^src\/[^/]+\//.test(n) && isSource(n)).map((n) => n.split('/')[1]))].sort(compare);
  equalKeys(ids, catalog.modules, 'Module');
  const structure = readStructure(snapshot);
  equalKeys(structure.categories, catalog.categories, 'Category');
  equalKeys(structure.contracts.map((c) => c.name), catalog.contracts, 'Contract');
  equalKeys(structure.views, catalog.views, 'View');
  equalKeys(structure.tabs.map((t) => t[0]), catalog.tabs, 'Tab');
  for (const key of ['categories', 'contracts']) for (const [id, meaning] of Object.entries(catalog[key])) assert(string(meaning), `Missing ${key} meaning: ${id}`);
  const modules = ids.map((id) => {
    const spec = catalog.modules[id];
    assert(object(spec) && string(spec.summary) && strings(spec.references) && spec.references.length, `Invalid module: ${id}`);
    spec.references.forEach((r) => { requireReference(snapshot, r); });
    return { id, ...spec, files: snapshot.files.filter((n) => n.startsWith(`src/${id}/`) && isSource(n)) };
  });
  for (const group of ['views', 'tabs']) for (const [id, ref] of Object.entries(catalog[group])) {
    assert(ids.includes(ref), `Unknown module for ${group}.${id}: ${ref}`);
  }
  for (const [dir, summary] of Object.entries(catalog.directories)) { requireReference(snapshot, dir); assert(string(summary), `Missing directory meaning: ${dir}`); }
  for (const [id, flow] of Object.entries(catalog.workflows)) {
    assert(/^[a-z][a-z-]*$/.test(id) && object(flow) && string(flow.summary) && strings(flow.modules) && strings(flow.sources), `Invalid workflow: ${id}`);
    requireReference(snapshot, flow.runbook);
    for (const module of flow.modules) assert(ids.includes(module), `Unknown workflow module: ${module}`);
    for (const source of flow.sources) requireReference(snapshot, source);
  }
  return { catalog, modules, ...structure };
}

export function fingerprints(snapshot, model) {
  const areas = new Map();
  const add = (area, name, content) => {
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area).push([name, sha256(content)]);
  };
  const sources = snapshot.files.filter(isSource);
  snapshot.preload(sources);
  for (const name of sources) {
    const module = name.match(/^src\/([^/]+)\//)?.[1];
    const content = name === 'AGENTS.md' ? withoutOverview(snapshot.read(name)) : snapshot.read(name);
    const area = module ? `module-${module}` : name.startsWith('src/') ? 'platform' : name.startsWith('workers/') ? 'edge' : /^(?:data|geo_replication|nar-research)\//.test(name) ? 'analysis' : 'repository';
    add(area, name, content);
    for (const [id, flow] of Object.entries(model.catalog.workflows)) {
      if (flow.modules.includes(module) || flow.sources.some((s) => s.endsWith('/') ? name.startsWith(s) : name === s)) add(`workflow-${id}`, name, content);
    }
  }
  for (const module of model.modules) add(`module-${module.id}`, 'catalog:module', JSON.stringify(model.catalog.modules[module.id]));
  add('module-data', 'catalog:categories', JSON.stringify(model.catalog.categories));
  add('module-types', 'catalog:contracts', JSON.stringify(model.catalog.contracts));
  add('platform', 'catalog:routing', JSON.stringify({ views: model.catalog.views, tabs: model.catalog.tabs, relationships: model.catalog.relationships }));
  for (const [id, flow] of Object.entries(model.catalog.workflows)) add(`workflow-${id}`, 'catalog:workflow', JSON.stringify(flow));
  return Object.fromEntries([...areas].sort(([a], [b]) => compare(a, b)).map(([area, files]) => [area, { fingerprint: sha256(JSON.stringify(files.sort(([a], [b]) => compare(a, b)))), files: files.map(([name]) => name) }]));
}

export function checkReviews(snapshot, areas) {
  const errors = [];
  for (const [area, state] of Object.entries(areas)) {
    const name = `${CONTEXT_DIR}/reviews/${area}.json`;
    if (!snapshot.files.includes(name)) { errors.push(`Missing review for ${area}`); continue; }
    try {
      const review = JSON.parse(snapshot.read(name));
      assert(review.version === 1 && review.area === area, `Invalid review identity: ${area}`);
      assert(['updated', 'no-impact'].includes(review.outcome) && string(review.explanation) && review.explanation.trim().length >= 40, `Review ${area} needs an outcome and a substantive explanation`);
      assert(strings(review.references) && review.references.length, `Review ${area} needs affected references`);
      review.references.forEach((r) => { requireReference(snapshot, r); });
      assert(review.fingerprint === state.fingerprint, `Stale review for ${area}; run pnpm run context:review`);
    } catch (error) { errors.push(error.message); }
  }
  for (const file of snapshot.files.filter((n) => n.startsWith(`${CONTEXT_DIR}/reviews/`))) {
    const area = file.slice(`${CONTEXT_DIR}/reviews/`.length, -5);
    if (!file.endsWith('.json') || !areas[area]) errors.push(`Remove obsolete review: ${file}`);
  }
  return errors;
}

export function affectedReferences(area, model) {
  const module = model.modules.find((m) => area === `module-${m.id}`);
  if (module) return [`${GENERATED_DIR}/codebase.md`, ...module.references];
  const flow = area.startsWith('workflow-') && model.catalog.workflows[area.slice(9)];
  if (flow) return [`${CONTEXT_DIR}/workflows.md`, flow.runbook];
  return ['AGENTS.md', `${CONTEXT_DIR}/README.md`, 'CONTEXT.md'];
}
