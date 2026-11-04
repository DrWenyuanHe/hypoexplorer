// Read-only live probes of the data host's zone edge rules. Run AFTER
// `npm run edge:apply -- --apply` (docs/EDGE_PROTECTION.md). About a dozen small
// requests; it never probes the rate limit (that would block this address).
//
//   npm run verify:edge
//   npm run verify:edge -- --allow-gate      # before the gate Worker is deleted
//   DATA_ORIGIN=https://data.example.org npm run verify:edge
//
// Checks:
//   1. the cache key ignores ?v=: the same pointer fetched with two fresh random
//      ?v= values is a cache HIT the second time;
//   2. both query pointers carry a 300-second browser TTL (max-age=300);
//   3. a disallowed method and disallowed paths are blocked (403) by the WAF,
//      with no sign of an R2 response (no ETag / Last-Modified / cf-cache-status);
//   4. GET and HEAD of a real object still succeed;
//   5. no response carries x-hypoexplorer-gate (the retired gate Worker is gone).
import { randomBytes } from 'node:crypto';

const origin = (process.env.DATA_ORIGIN ?? 'https://data.hypoexplorer.com').replace(/\/+$/, '');
// --allow-gate: the cutover check run while the retired gate Worker is still
// routed (runbook step 3). It skips check 5 and only reports whether the gate answered.
const allowGate = process.argv.includes('--allow-gate');
let gateSeen = false;
const POINTERS = ['/query/tracks.js', '/query/expression-manifest.js'] as const;
const results: Array<{ ok: boolean; name: string; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => results.push({ ok, name, detail });
const version = () => randomBytes(16).toString('hex');

async function probe(method: string, path: string): Promise<Response & { bodyBytes: number }> {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'hypoexplorer-verify-edge/1' },
  });
  const bodyBytes = method === 'HEAD' ? 0 : (await response.arrayBuffer()).byteLength;
  const gate = response.headers.get('x-hypoexplorer-gate');
  if (gate !== null) gateSeen = true;
  if (!allowGate) check(`no gate header: ${method} ${path}`, gate === null, gate === null ? 'absent' : `x-hypoexplorer-gate: ${gate}`);
  return Object.assign(response, { bodyBytes });
}

function maxAge(cacheControl: string | null): number | null {
  const match = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl ?? '');
  return match ? Number(match[1]) : null;
}

const describe = (response: Response) =>
  `HTTP ${response.status}, cf-cache-status=${response.headers.get('cf-cache-status') ?? '-'}, cache-control=${response.headers.get('cache-control') ?? '-'}`;

// 1 + 2 + 4: query-string-insensitive cache and the pointer TTL.
for (const pointer of POINTERS) {
  const first = await probe('GET', `${pointer}?v=${version()}`);
  const second = await probe('GET', `${pointer}?v=${version()}`);
  check(`GET ${pointer} succeeds`, first.status === 200 && second.status === 200, `${describe(first)}; ${describe(second)}`);
  check(`cache key ignores ?v= (${pointer})`, second.headers.get('cf-cache-status') === 'HIT',
    `first ${first.headers.get('cf-cache-status') ?? '-'}, second (new random ?v=) ${second.headers.get('cf-cache-status') ?? '-'}`);
  const age = maxAge(second.headers.get('cache-control'));
  check(`300 s browser TTL (${pointer})`, age === 300, `cache-control: ${second.headers.get('cache-control') ?? '(none)'}`);
}
const head = await probe('HEAD', POINTERS[0]);
check(`HEAD ${POINTERS[0]} succeeds`, head.status === 200, describe(head));

// 3: WAF blocks, answered before cache or R2.
const blocked = async (method: string, path: string, rule: string) => {
  const response = await probe(method, path);
  const fromOrigin = ['etag', 'last-modified', 'cf-cache-status'].filter((name) => response.headers.has(name));
  check(`${rule}: ${method} ${path} blocked`, response.status === 403 && !fromOrigin.length,
    `HTTP ${response.status}${fromOrigin.length ? `, origin headers present: ${fromOrigin.join(', ')}` : ''}`);
};
await blocked('POST', POINTERS[0], 'method rule');
await blocked('OPTIONS', POINTERS[0], 'method rule');
await blocked('GET', `/robots.txt?v=${version()}`, 'path rule');
await blocked('GET', `/elsewhere/${version()}.js`, 'path rule');
await blocked('GET', `/datasets/${version()}.txt`, 'path rule');

for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
if (allowGate) console.log(`INFO  gate Worker ${gateSeen ? 'still answers (expected before its deletion)' : 'did not answer'}; rerun without --allow-gate after deleting it.`);
const failures = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failures}/${results.length} checks passed against ${origin}.`);
if (failures) {
  console.error('Edge protection is not in the expected state. docs/EDGE_PROTECTION.md lists the rollback for each step.');
  process.exitCode = 1;
}
