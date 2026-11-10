// Serve the app from this checkout only, with no data origin.
//
//   pnpm run dev:offline [<vite options>]      e.g. --port 5199
//
// Vite lets an inherited VITE_BUNDLE_BASE_URL override .env files, so a shell
// that still has the hosted origin set would quietly load bundles from it. This
// launcher forces the base empty (same-origin) and refuses to start until
// `pnpm run data:offline` has restored the bundles and built the query indexes.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (relative) => path.join(ROOT, relative);
const restored = existsSync(at('public/datasets')) && readdirSync(at('public/datasets'), { withFileTypes: true })
  .some((entry) => entry.isDirectory() && readdirSync(at(`public/datasets/${entry.name}`)).some((file) => file.startsWith('track_')));
const missing = [
  !restored && 'the dataset bundles (public/datasets/*/track_*.js)',
  !existsSync(at('public/query/tracks.js')) && 'the query index (public/query/tracks.js)',
  !existsSync(at('public/query/expression-manifest.js')) && 'the expression index (public/query/expression-manifest.js)',
].filter(Boolean);
if (missing.length) {
  console.error(`dev:offline needs ${missing.join(', ')}.\nRun \`pnpm run data:offline\` first.`);
  process.exit(1);
}

const inherited = process.env.VITE_BUNDLE_BASE_URL;
if (inherited) console.warn(`dev:offline: ignoring VITE_BUNDLE_BASE_URL=${inherited} from the environment; serving public/ same-origin.`);
// `pnpm run dev:offline -- --port 5199` passes the `--` through; Vite would then
// ignore the options after it, so drop a leading separator.
const viteArgs = process.argv.slice(2);
if (viteArgs[0] === '--') viteArgs.shift();
const child = spawn(process.execPath, [at('node_modules/vite/bin/vite.js'), '--mode', 'offline', ...viteArgs], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_BUNDLE_BASE_URL: '' },
});
// Pass termination on to Vite, so stopping the launcher stops the server too.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
for (const signal of SIGNALS) {
  try { process.on(signal, () => { if (child.exitCode === null) child.kill(signal); }); } catch { /* not supported on this platform */ }
}
child.on('exit', (code, signal) => {
  // Re-raise the child's signal so callers see how it ended; fall back to 1.
  if (signal) {
    for (const s of SIGNALS) process.removeAllListeners(s);
    try { process.kill(process.pid, signal); } catch { /* fall through */ }
    process.exit(1);
  }
  process.exit(code ?? 0);
});
