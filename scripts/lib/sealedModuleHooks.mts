/**
 * Module loader hooks for scripts/run_sealed_ts_check.mts (registered with
 * node:module register; they run on the loader thread).
 *
 * A sealed producer that imports a superseded JSON document as a module (the
 * internal-QC and author ledgers imported by src/data/*.ts) receives the same
 * verified pre-regeneration bytes that the runner's fs projection serves: an
 * output only when the current bytes are the recorded regeneration and the
 * pre-swap git blob is the recorded one, a ledger only after the transition is
 * proven to touch nothing but regenerated datasets. The verified bytes are
 * written to a private temporary copy that the next loader (tsx) compiles, so
 * the module has the same shape as the original.
 *
 * src/data/datasets.ts is served as a module that imports the current registry,
 * reverts the recorded regeneration edits in place, removes the additive
 * intake's datasets and re-exports it (scripts/lib/registryEdits.mts), so every
 * importer sees one registry.
 *
 * Every other module, and every module under a query string, loads unchanged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SupersessionOptions } from './historicalEvidence.mjs';

// Node 24 can strip types in this loader worker without inheriting tsx's
// .mjs -> .mts resolver. Bootstrap from the actual source URLs; the type-only
// imports keep the existing TypeScript module contracts without emitted files.
const { readAdditiveIntake, supersededPaths, supersession } = await import(new URL('./historicalEvidence.mts', import.meta.url).href) as typeof import('./historicalEvidence.mjs');
const { REGISTRY_MODULE } = await import(new URL('./registryEdits.mts', import.meta.url).href) as typeof import('./registryEdits.mjs');

interface HookData { root: string; folder: string; manifestSha?: string | null; registryEditsSha?: string | null }
let root = '';
let folder = '';
let options: SupersessionOptions = {};
let registryEditsSha: string | null = null;
let targets = new Map<string, string>();
const served = new Map<string, string>();
const key = (path: string): string => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));

export async function initialize(data: HookData): Promise<void> {
  root = data.root;
  folder = data.folder;
  options = data.manifestSha === undefined ? {} : { manifestSha: data.manifestSha };
  registryEditsSha = data.registryEditsSha ?? null;
  targets = new Map([...supersededPaths(root, options)].filter((name) => name.endsWith('.json')).map((name) => [key(resolve(root, name)), name]));
}

function servedUrl(name: string): string {
  if (!served.has(name)) {
    const state = supersession(root, options);
    const bytes = state.records.has(name) ? state.readOutput(name, state.servedPin(name)) : state.ledger(name);
    const target = resolve(folder, String(served.size), basename(name));
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, bytes);
    served.set(name, pathToFileURL(target).href);
  }
  return served.get(name)!;
}

function registryModule(url: string): string {
  const current = JSON.stringify(`${url}?sealed-registry=current`);
  const edits = JSON.stringify(new URL('./registryEdits.mts', import.meta.url).href);
  return [
    `import * as registry from ${current};`,
    `import { projectRegistryModule } from ${edits};`,
    `projectRegistryModule(registry.DATASETS, ${JSON.stringify(root)}, ${JSON.stringify(registryEditsSha)}, ${JSON.stringify([...readAdditiveIntake(root).datasetIds])});`,
    `export * from ${current};`,
    '',
  ].join('\n');
}

export async function load(url: string, context: any, nextLoad: (url: string, context: any) => Promise<any>): Promise<any> {
  if (url.startsWith('file:')) {
    const parsed = new URL(url);
    if (!parsed.search) {
      const path = key(fileURLToPath(parsed));
      const name = targets.get(path);
      if (name !== undefined) return nextLoad(servedUrl(name), context);
      if (registryEditsSha && path === key(resolve(root, REGISTRY_MODULE))) {
        return { format: 'module', shortCircuit: true, source: registryModule(url) };
      }
    }
  }
  return nextLoad(url, context);
}
