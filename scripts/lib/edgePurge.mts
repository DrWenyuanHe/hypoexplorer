// Edge cache purge after an R2 publication. The data host's cache rule ignores
// the query string (cloudflare/http_request_cache_settings/), so `?v=` no longer
// separates releases at the edge: an object rewritten under the same key keeps
// being served from cache, for up to a year on immutable bundles, until it is
// purged. Every upload that changes objects must therefore purge them.
//
// Free plan (verified 2026-10-01): every purge type is available, 5 requests per
// minute (bucket of 25), at most 100 prefixes per request, prefixes are given
// without a scheme and match any query string.
//   https://developers.cloudflare.com/cache/how-to/purge-cache/
//   https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/
import { DATA_HOST, ZONE_ID } from './edgeRules.mjs';
import { CloudflareApiError, type CloudflareClient } from './cloudflareApi.mjs';

export const MAX_PREFIXES_PER_PURGE = 100;

export type PurgeRequest = { prefixes: string[] } | { hosts: string[] };

/**
 * The narrowest prefix that covers a changed key: one directory per dataset or
 * query build, one for the QC PDF pool, and the exact key for top-level files
 * such as the two query pointers.
 */
export function purgePrefixForKey(key: string): string {
  const clean = key.replace(/^\/+/, '');
  const parts = clean.split('/');
  if (parts[0] === 'qc') return 'qc/';
  if (parts[0] === 'query' && parts[1] === 'expression' && parts.length >= 4) return `${parts.slice(0, 3).join('/')}/`;
  if (parts.length >= 3) return `${parts.slice(0, 2).join('/')}/`;
  return clean;
}

export function purgeRequestForKeys(keys: readonly string[], host = DATA_HOST): PurgeRequest | null {
  const prefixes = [...new Set(keys.filter(Boolean).map(purgePrefixForKey))].sort().map((prefix) => `${host}/${prefix}`);
  if (!prefixes.length) return null;
  return prefixes.length > MAX_PREFIXES_PER_PURGE ? { hosts: [host] } : { prefixes };
}

export async function purgeEdgeCache(client: CloudflareClient, zoneId: string, request: PurgeRequest, options: {
  attempts?: number;
  wait?: (ms: number) => Promise<void>;
} = {}): Promise<void> {
  const attempts = options.attempts ?? 3;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      await client.request('POST', `/zones/${zoneId}/purge_cache`, request);
      return;
    } catch (error) {
      const retryable = error instanceof CloudflareApiError && (error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= attempts) throw error;
      // Free allows 5 purge requests per minute; back off past the refill.
      await wait(15_000 * attempt);
    }
  }
}

/** The exact recovery steps printed whenever a needed purge did not happen. */
export function manualPurgeInstructions(zoneId = ZONE_ID, host = DATA_HOST): string {
  return [
    'Purge the data host before deploying an app that references the new data:',
    `  npm run edge:apply -- --purge-host            (CLOUDFLARE_EDGE_TOKEN with Cache Purge)`,
    `  or dashboard: ${host.split('.').slice(-2).join('.')} > Caching > Configuration > Purge Cache > Custom Purge > Hostname > ${host}`,
    `  or: curl -X POST https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache -H "Authorization: Bearer $CLOUDFLARE_EDGE_TOKEN" -H "Content-Type: application/json" --data '{"hosts":["${host}"]}'`,
    'Until then the edge keeps serving the previous bytes for these keys (cache key ignores ?v=).',
  ].join('\n');
}
