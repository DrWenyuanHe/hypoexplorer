// Where data bundles are served from. THE single definition.
//
// Deliberately its own module, and deliberately DOM-free: `datasets.ts` needs
// this value and is also type-checked under tsconfig.node.json (the Node scripts
// import it), so it cannot reach into a module that touches window/document.
// datasets.ts is the sole importer — every dataset's bundleBaseUrl is a
// projection of this constant, so the app and any script share one authority
// instead of redefining it.
//
// Defaults to '' (same-origin), so bundles ship from the app host. Set
// VITE_BUNDLE_BASE_URL at build time (e.g. a Cloudflare R2 origin) to serve them
// off-origin with zero code changes.
//
// Any trailing slash is stripped here. The file templates are absolute
// ("/datasets/..."), so a configured base of "https://host/" would otherwise
// concatenate to "https://host//datasets/...", which object stores treat as a
// different key and 404 — silently breaking every bundle while the build still
// succeeds. Normalizing once here covers every consumer.
export const BUNDLE_BASE: string = (
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BUNDLE_BASE_URL ?? ''
).replace(/\/+$/, '');

// Whether the configured bundle origin sends CORS headers.
//
// Off-origin bundles are read with a <script> tag, which needs no CORS but also
// reports no byte progress — a progress bar over a 4 MB track bundle can only be
// indeterminate. A streaming fetch() reports every chunk, but cross-origin it
// needs Access-Control-Allow-Origin on the bucket.
//
// That is a DEPLOY fact, not a build fact, and the expensive way to be wrong is
// to assume it: a rejected cross-origin fetch has already pulled the bytes down
// before the browser discards them, so an optimistic default would double the
// transfer of every bundle on any deploy that had not configured CORS. Hence
// opt-in, and default off. Ignored (and unnecessary) when BUNDLE_BASE is empty,
// since same-origin bundles stream either way.
export const BUNDLE_BASE_IS_CORS_ENABLED: boolean =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BUNDLE_CORS === 'true';
