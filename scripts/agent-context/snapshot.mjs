import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const normalize = (text) => text.replace(/\r\n?/g, "\n");
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function git(root, args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, ...options });
}

export function resolveRevision(root, ref) {
  return git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
}

// A revision snapshot reads Git blobs, never checks out files or consults dirty
// working files. Batch reads avoid a git process per source on Windows.
export function loadSnapshot(root, ref, { staged = false } = {}) {
  if (ref && staged) throw new Error("Cannot combine --staged with --ref");
  const revision = ref ? resolveRevision(root, ref) : undefined;
  const fromGit = Boolean(revision || staged);
  const objects = new Map();
  let files;
  if (revision) {
    for (const entry of git(root, ["ls-tree", "-rz", "--full-tree", revision]).split("\0").filter(Boolean)) {
      const [, mode, oid, name] = entry.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/) ?? [];
      if (name) objects.set(name, { mode, oid });
    }
    files = [...objects.keys()];
  } else if (staged) {
    for (const entry of git(root, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean)) {
      const [, mode, oid, stage, name] = entry.match(/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/) ?? [];
      if (!name) throw new Error("Cannot parse Git index entry");
      if (stage !== "0") throw new Error(`Resolve the unmerged index entry before reviewing context: ${name}`);
      if (mode !== "160000") objects.set(name, { mode, oid });
    }
    files = [...objects.keys()];
  } else {
    files = [...new Set(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))]
      .filter((name) => existsSync(path.join(root, name)));
  }
  files.sort(compare);
  const names = new Set(files);
  const cache = new Map();
  function preload(requested) {
    const missing = [...new Set(requested)].filter((name) => !cache.has(name));
    for (const name of missing) {
      if (!names.has(name)) throw new Error(`Missing context source: ${name}`);
      if (fromGit ? objects.get(name).mode === "120000" : lstatSync(path.join(root, name)).isSymbolicLink()) {
        throw new Error(`Context sources must not be symlinks: ${name}`);
      }
    }
    if (!missing.length) return;
    if (!fromGit) {
      for (const name of missing) cache.set(name, readFileSync(path.join(root, name)));
      return;
    }
    const result = git(root, ["cat-file", "--batch"], {
      input: missing.map((name) => objects.get(name).oid).join("\n") + "\n",
      encoding: null,
    });
    let offset = 0;
    for (const name of missing) {
      const end = result.indexOf(10, offset);
      const header = result.subarray(offset, end).toString("utf8");
      const match = header.match(/^[a-f0-9]+ blob (\d+)$/);
      if (!match) throw new Error(`Cannot read Git blob for ${name}: ${header}`);
      const size = Number(match[1]);
      cache.set(name, result.subarray(end + 1, end + 1 + size));
      offset = end + size + 2;
    }
  }
  return {
    revision, staged, files, preload,
    has: (name) => names.has(name) || files.some((file) => file.startsWith(`${name}/`)),
    read(name) { preload([name]); return normalize(cache.get(name).toString("utf8")); },
  };
}
