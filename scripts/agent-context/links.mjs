import path from 'node:path';
import { CONTEXT_DIR, GENERATED_DIR } from './model.mjs';
export function checkLinks(snapshot, output) {
  const errors = [];
  const pages = new Map(output);
  for (const file of snapshot.files.filter((name) => name.startsWith(`${CONTEXT_DIR}/`) && name.endsWith(".md") && !name.startsWith(`${GENERATED_DIR}/`))) pages.set(file, snapshot.read(file));
  for (const [file, text] of pages) {
    for (const match of text.matchAll(/\[[^\]\n]+\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
      const target = match[1] ?? match[2];
      if (/^https?:/.test(target)) continue;
      const local = decodeURIComponent(target.split("#")[0]);
      const resolved = local ? path.posix.normalize(path.posix.join(path.posix.dirname(file), local)) : file;
      if (resolved.startsWith("../") || (!output.has(resolved) && !snapshot.has(resolved))) {
        errors.push(`Broken context link in ${file}: ${target}`);
        continue;
      }
      const fragment = target.includes("#") ? decodeURIComponent(target.slice(target.indexOf("#") + 1)) : "";
      if (fragment && resolved.endsWith(".md")) {
        const contents = output.get(resolved) ?? snapshot.read(resolved);
        if (!markdownAnchors(contents).has(fragment)) errors.push(`Broken context anchor in ${file}: ${target}`);
      }
    }
  }
  return errors;
}

// Removes markup until none remains, so a removal cannot join a new tag.
function stripTags(text) {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current;
}

function markdownAnchors(text) {
  const anchors = new Set(), counts = new Map();
  // These repository references use ATX headings and optional explicit HTML ids.
  const prose = text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
  for (const match of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = stripTags(match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")).toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    anchors.add(count ? `${slug}-${count}` : slug);
    counts.set(slug, count + 1);
  }
  for (const match of prose.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
  return anchors;
}
