import type { R2HttpMetadata, R2RemoteObject } from './r2Incremental.mjs';

// Official API: /api/resources/r2/subresources/buckets/subresources/objects/methods/list/
// Wrangler currently has no object-list command. Keep authentication on the
// same official API origin and never include response bodies/tokens in errors.
export function createR2InventoryReader(options: {
  account: string;
  bucket: string;
  token: string;
  prefixes: readonly string[];
  fetch?: typeof fetch;
}): () => Promise<Map<string, R2RemoteObject>> {
  if (!/^[a-f0-9]{32}$/i.test(options.account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.');
  if (!/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(options.bucket)) throw new Error('Invalid R2 bucket name.');
  if (!options.token.trim()) throw new Error('CLOUDFLARE_API_TOKEN is required for verified incremental uploads.');
  const request = options.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${options.account}/r2/buckets/${options.bucket}/objects`;
  return async () => {
    const objects = new Map<string, R2RemoteObject>();
    for (const prefix of options.prefixes) {
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      do {
        const url = new URL(base);
        url.searchParams.set('prefix', prefix);
        url.searchParams.set('per_page', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await request(url, {
          headers: { Authorization: `Bearer ${options.token}`, 'Cache-Control': 'no-store' },
          redirect: 'error', signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`R2 origin inventory request failed (HTTP ${response.status}); no unverified fallback upload is allowed.`);
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true
          || !('result' in body) || !Array.isArray(body.result)) throw new Error('Invalid R2 inventory response.');
        for (const raw of body.result) {
          if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string' || !raw.key.startsWith(prefix)
            || typeof raw.etag !== 'string' || !Number.isSafeInteger(raw.size) || raw.size < 0
            || (raw.http_metadata !== undefined && (!raw.http_metadata || typeof raw.http_metadata !== 'object' || Array.isArray(raw.http_metadata)))) {
            throw new Error('Incomplete R2 object metadata; refusing unverifiable publication.');
          }
          const metadata: R2HttpMetadata = {};
          const rawMetadata = raw.http_metadata ?? {};
          for (const field of ['cacheControl', 'cacheExpiry', 'contentDisposition', 'contentEncoding', 'contentLanguage', 'contentType'] as const) {
            if (rawMetadata[field] !== undefined && typeof rawMetadata[field] !== 'string') throw new Error('Invalid R2 HTTP metadata.');
            if (rawMetadata[field] !== undefined) metadata[field] = rawMetadata[field];
          }
          if (objects.has(raw.key)) throw new Error(`Repeated object in R2 inventory: ${raw.key}`);
          objects.set(raw.key, { key: raw.key, etag: raw.etag.replace(/^"|"$/g, ''), size: raw.size,
            httpMetadata: metadata, lastModified: typeof raw.last_modified === 'string' ? raw.last_modified : undefined });
        }
        const info = 'result_info' in body && body.result_info && typeof body.result_info === 'object' ? body.result_info : null;
        // The production API omits result_info on a short final page (verified
        // September 2026). Never infer completeness from a full page without it.
        if (!info && body.result.length < 1000) break;
        if (!info || !('is_truncated' in info) || typeof info.is_truncated !== 'boolean') throw new Error('R2 inventory pagination status is missing.');
        if (!info.is_truncated) break;
        if (!('cursor' in info) || typeof info.cursor !== 'string' || !info.cursor || seenCursors.has(info.cursor)) throw new Error('R2 inventory pagination cursor is missing or repeated.');
        cursor = info.cursor;
        seenCursors.add(cursor);
      } while (cursor);
    }
    return objects;
  };
}
