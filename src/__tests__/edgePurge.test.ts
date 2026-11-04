import { describe, expect, it, vi } from 'vitest';
import { CloudflareApiError, createCloudflareClient, resolveEdgeCredentials } from '../../scripts/lib/cloudflareApi.mjs';
import { MAX_PREFIXES_PER_PURGE, manualPurgeInstructions, purgeEdgeCache, purgePrefixForKey, purgeRequestForKeys } from '../../scripts/lib/edgePurge.mjs';

const EXPRESSION = `query/expression/${'a'.repeat(64)}`;

describe('purgePrefixForKey', () => {
  it('collapses each changed key to the narrowest directory that groups a release', () => {
    expect(purgePrefixForKey('datasets/macaque_snrna/meta.js')).toBe('datasets/macaque_snrna/');
    expect(purgePrefixForKey('datasets/macaque_snrna/sub/track.js')).toBe('datasets/macaque_snrna/');
    expect(purgePrefixForKey('qc/Ast1__Astrocyte_1.pdf')).toBe('qc/');
    expect(purgePrefixForKey('query/1es70pa3wryw0/genes/a1.js')).toBe('query/1es70pa3wryw0/');
    expect(purgePrefixForKey(`${EXPRESSION}/s0001.js`)).toBe(`${EXPRESSION}/`);
    expect(purgePrefixForKey(`${EXPRESSION}/genes/s0001.js`)).toBe(`${EXPRESSION}/`);
  });

  it('keeps top-level files exact, including both pointers', () => {
    expect(purgePrefixForKey('query/tracks.js')).toBe('query/tracks.js');
    expect(purgePrefixForKey('query/expression-manifest.js')).toBe('query/expression-manifest.js');
    expect(purgePrefixForKey('/query/tracks.js')).toBe('query/tracks.js');
  });
});

describe('purgeRequestForKeys', () => {
  it('dedupes, sorts and prefixes the host without a scheme', () => {
    expect(purgeRequestForKeys([
      'query/tracks.js', 'datasets/b/meta.js', 'datasets/a/meta.js', 'datasets/a/track_x.js', 'qc/x.pdf', 'qc/y.pdf',
    ])).toEqual({ prefixes: [
      'data.hypoexplorer.com/datasets/a/',
      'data.hypoexplorer.com/datasets/b/',
      'data.hypoexplorer.com/qc/',
      'data.hypoexplorer.com/query/tracks.js',
    ] });
  });

  it('returns null when nothing changed', () => {
    expect(purgeRequestForKeys([])).toBeNull();
  });

  it('uses up to 100 prefixes per request and falls back to the hostname beyond that', () => {
    const keys = (count: number) => Array.from({ length: count }, (_, index) => `datasets/d${index}/meta.js`);
    expect(purgeRequestForKeys(keys(MAX_PREFIXES_PER_PURGE))).toMatchObject({ prefixes: expect.any(Array) });
    expect(purgeRequestForKeys(keys(MAX_PREFIXES_PER_PURGE + 1))).toEqual({ hosts: ['data.hypoexplorer.com'] });
  });
});

describe('purgeEdgeCache', () => {
  const ok = () => new Response(JSON.stringify({ success: true, result: { id: 'x' } }), { status: 200 });
  const limited = () => new Response(JSON.stringify({ success: false, errors: [{ code: 1015, message: 'rate limited' }] }), { status: 429 });

  it('posts the request to the zone purge endpoint', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await purgeEdgeCache(createCloudflareClient('t', fetchImpl as unknown as typeof fetch), 'z'.repeat(32), { hosts: ['h'] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/zones/${'z'.repeat(32)}/purge_cache`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ hosts: ['h'] });
  });

  it('retries a rate-limited purge, then gives up with the API error', async () => {
    const wait = vi.fn(async () => {});
    const flaky = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok());
    await purgeEdgeCache(createCloudflareClient('t', flaky as unknown as typeof fetch), 'z', { prefixes: ['p'] }, { wait });
    expect(flaky).toHaveBeenCalledTimes(2);
    const always = vi.fn(async () => limited());
    await expect(purgeEdgeCache(createCloudflareClient('t', always as unknown as typeof fetch), 'z', { prefixes: ['p'] }, { wait }))
      .rejects.toBeInstanceOf(CloudflareApiError);
    expect(always).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permission error, and never leaks the token', async () => {
    const denied = vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 }));
    const error = await purgeEdgeCache(createCloudflareClient('secret-token', denied as unknown as typeof fetch), 'z', { hosts: ['h'] }, { wait: async () => {} })
      .then(() => new Error('expected a rejection'), (caught: unknown) => caught as Error);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(error.message).toContain('HTTP 403');
    expect(error.message).not.toContain('secret-token');
  });

  it('prints a recovery path that names the host and zone', () => {
    const text = manualPurgeInstructions('2646afd72ee9db3111c4a475c4d43a58');
    expect(text).toContain('npm run edge:apply -- --purge-host');
    expect(text).toContain('zones/2646afd72ee9db3111c4a475c4d43a58/purge_cache');
    expect(text).toContain('"hosts":["data.hypoexplorer.com"]');
  });
});

describe('resolveEdgeCredentials', () => {
  it('prefers the environment and defaults the zone', () => {
    const resolved = resolveEdgeCredentials({ env: { CLOUDFLARE_EDGE_TOKEN: 'from-env' }, cwd: '/nonexistent-dir' });
    expect(resolved).toEqual({ token: 'from-env', zoneId: '2646afd72ee9db3111c4a475c4d43a58' });
  });

  it('reports a missing token as undefined rather than throwing', () => {
    expect(resolveEdgeCredentials({ env: {}, cwd: '/nonexistent-dir' }).token).toBeUndefined();
  });
});
