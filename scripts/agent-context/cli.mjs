#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affectedReferences, buildModel, checkReviews, CONTEXT_DIR, fingerprints, GENERATED_DIR, withoutOverview } from "./model.mjs";
import { checkLinks, renderFiles } from "./render.mjs";
import { loadSnapshot, normalize } from "./snapshot.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function pushedRevisions(input) {
  const revisions = new Set();
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const fields = line.split(/\s+/);
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (fields.length !== 4 || !localRef || !remoteRef || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(localSha ?? "") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(remoteSha ?? "")) throw new Error("Malformed pre-push ref input");
    if (!/^0+$/.test(localSha)) revisions.add(localSha);
  }
  return [...revisions];
}

export function checkSnapshot(snapshot) {
  const model = buildModel(snapshot);
  const output = renderFiles(snapshot, model);
  const errors = checkLinks(snapshot, output);
  for (const [name, contents] of output) if (!snapshot.files.includes(name) || snapshot.read(name) !== contents) errors.push(`Stale generated context: ${name}`);
  for (const name of snapshot.files.filter((name) => name.startsWith(`${GENERATED_DIR}/`))) if (!output.has(name)) errors.push(`Obsolete generated context: ${name}`);
  if (!/^@AGENTS\.md\s*$/m.test(snapshot.read("CLAUDE.md"))) errors.push("CLAUDE.md must import @AGENTS.md on its own line");
  errors.push(...checkReviews(snapshot, fingerprints(snapshot, model)));
  if (errors.length) throw new Error(errors.join("\n") + "\nReview affected sources, update review records, run pnpm run context:generate, then context:check.");
  return model;
}

export function run(argv = process.argv.slice(2), root = defaultRoot) {
  const args = [...argv];
  const command = args.shift();
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (["--ref", "--base"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) options[args[i].slice(2)] = args[++i];
    else if (args[i] === "--pre-push") options.prePush = true;
    else if (args[i] === "--staged") options.staged = true;
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  if (!["check", "generate", "review"].includes(command)) throw new Error("Usage: cli.mjs generate [--staged] | review [--base REF] [--staged] | check [--staged | --ref REF | --pre-push]");
  if (options.staged && options.ref) throw new Error("Cannot combine --staged with --ref");
  if (options.prePush) {
    if (command !== "check" || options.ref || options.base || options.staged) throw new Error("--pre-push is only valid for check without other options");
    const revisions = pushedRevisions(readFileSync(0, "utf8"));
    for (const revision of revisions) { checkSnapshot(loadSnapshot(root, revision)); console.log(`[context] Verified pushed revision ${revision.slice(0, 12)}`); }
    return;
  }
  if (command === "generate" && (options.ref || options.base)) throw new Error("Generation only writes the working tree");
  const snapshot = loadSnapshot(root, options.ref, { staged: options.staged });
  if (command === "check") {
    if (options.base) throw new Error("--base belongs to context:review");
    const model = checkSnapshot(snapshot);
    console.log(`[context] Current: ${model.modules.length} source areas, ${model.datasets.length} datasets; review records and startup configuration verified.`);
    return;
  }
  const model = buildModel(snapshot);
  if (command === "generate") {
    const output = renderFiles(snapshot, model);
    const errors = checkLinks(snapshot, output);
    if (errors.length) throw new Error(errors.join("\n"));
    if (options.staged) {
      const currentAgents = normalize(readFileSync(path.join(root, "AGENTS.md"), "utf8"));
      if (currentAgents !== output.get("AGENTS.md") && withoutOverview(currentAgents) !== withoutOverview(snapshot.read("AGENTS.md"))) {
        throw new Error("AGENTS.md has unstaged authored changes; stage its intended hunks or generate in an isolated checkout to preserve them");
      }
    }
    // Validate every destination before any mutation, including ancestors. A
    // linked generated directory must never redirect writes/deletes elsewhere.
    for (const name of [...output.keys(), ...snapshot.files.filter((n) => n.startsWith(`${GENERATED_DIR}/`))]) {
      let destination = path.resolve(root);
      for (const segment of name.split('/')) {
        if (!segment || segment === '..' || segment === '.') throw new Error(`Unsafe generated path: ${name}`);
        destination = path.join(destination, segment);
        if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing linked output path: ${name}`);
      }
      if (path.relative(path.resolve(root), destination).startsWith('..')) throw new Error(`Unsafe generated path: ${name}`);
      if (!output.has(name) && !/^docs\/agent-context\/generated\/[a-z0-9-]+\.md$/.test(name)) throw new Error(`Refusing to remove unexpected generated path: ${name}`);
    }
    for (const name of snapshot.files.filter((name) => name.startsWith(`${GENERATED_DIR}/`) && !output.has(name))) {
      // Only individual generated markdown files in this owned directory.
      if (!/^docs\/agent-context\/generated\/[a-z0-9-]+\.md$/.test(name)) throw new Error(`Refusing to remove unexpected generated path: ${name}`);
      rmSync(path.join(root, name), { force: true });
    }
    let changed = 0;
    for (const [name, content] of output) {
      // With --staged, compare the output destination as well as the input: a
      // staged artifact may be current while its working copy is stale.
      let current;
      try { current = normalize(readFileSync(path.join(root, name), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current === content) continue;
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content, "utf8");
      changed++;
    }
    console.log(`[context] Updated ${changed} generated files${options.staged ? " from the index; stage the generated files before checking --staged" : ""}. Review records and the index were not changed.`);
    return;
  }
  const current = fingerprints(snapshot, model);
  let previous = {};
  if (options.base) {
    const base = loadSnapshot(root, options.base);
    if (base.files.includes(`${CONTEXT_DIR}/catalog.json`)) previous = fingerprints(base, buildModel(base));
  }
  const affected = Object.entries(current).filter(([area, state]) => !previous[area] || previous[area].fingerprint !== state.fingerprint);
  console.log(JSON.stringify({
    checklist: ["Review code responsibilities and canonical entry points", "Review schema, relationships, JSON validators and access rules", "Review operational commands, outputs and current-state lookups", "Update context or explain why the change has no context impact; generation is not semantic review"],
    affected: affected.map(([area, state]) => ({ area, fingerprint: state.fingerprint, sourceFiles: state.files, affectedReferences: affectedReferences(area, model), reviewFile: `${CONTEXT_DIR}/reviews/${area}.json` })),
    removedAreas: Object.keys(previous).filter((area) => !current[area]),
    reviewErrors: checkReviews(snapshot, current),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { console.error(`[context] ${error.message}`); process.exitCode = 1; }
}
