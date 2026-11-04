// Minimal Cloudflare v4 API client for the edge tooling (apply_edge_rules.mts,
// upload_bundles_r2.mts). Errors carry the HTTP status and Cloudflare's own
// error messages, never the token or request headers.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ZONE_ID } from './edgeRules.mjs';

export const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface CloudflareClient {
  request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', pathname: string, body?: unknown): Promise<T>;
}

export function createCloudflareClient(token: string, fetchImpl: typeof fetch = fetch): CloudflareClient {
  if (!token.trim()) throw new Error('A Cloudflare API token is required.');
  return {
    async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', pathname: string, body?: unknown): Promise<T> {
      const response = await fetchImpl(`${API_BASE}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      type Envelope = { success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> };
      const parsed = await (response.json() as Promise<Envelope>).catch(() => null); // null: non-JSON error page
      if (!response.ok || !parsed || parsed.success !== true) {
        const detail = parsed?.errors?.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).filter(Boolean).join('; ');
        throw new CloudflareApiError(`${method} ${pathname} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`, response.status);
      }
      return parsed.result as T;
    },
  };
}

/**
 * Edge credentials: the process environment first, then an explicit --env-file,
 * then the git-ignored .env.local. Only CLOUDFLARE_EDGE_TOKEN and
 * CLOUDFLARE_ZONE_ID are read from files, and nothing is exported back into
 * the environment, so an R2-scoped token in .env.local cannot shadow
 * Wrangler's OAuth login for the other commands in the same process.
 */
export function resolveEdgeCredentials(options: {
  env?: NodeJS.ProcessEnv;
  envFile?: string;
  cwd?: string;
} = {}): { token: string | undefined; zoneId: string } {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const files = [options.envFile, '.env.local'].filter((file): file is string => !!file).map((file) => path.resolve(cwd, file));
  const fromFiles: Record<string, string | undefined> = {};
  for (const file of files.reverse()) {
    if (!existsSync(file)) continue;
    Object.assign(fromFiles, parseEnv(readFileSync(file, 'utf8')));
  }
  const pick = (name: string) => (env[name]?.trim() || fromFiles[name]?.trim() || undefined);
  const zoneId = pick('CLOUDFLARE_ZONE_ID') ?? ZONE_ID;
  if (!/^[a-f0-9]{32}$/.test(zoneId)) throw new Error('CLOUDFLARE_ZONE_ID must be a 32-character zone ID.');
  return { token: pick('CLOUDFLARE_EDGE_TOKEN'), zoneId };
}
