# Data host edge protection

`data.hypoexplorer.com` is the R2 custom domain for bucket `hypoexplorer-datasets`
(zone `hypoexplorer.com`, zone ID `2646afd72ee9db3111c4a475c4d43a58`, account
`2991a2961440d6e0618f39bc2a0a423b`, Cloudflare Free plan). This runbook replaces
the retired data gate Worker with zone rules, a purge step in the uploader and a
cron-only spend guard. Nothing in the repository applies these changes by itself;
every live step below is an operator action.

## Cost model

R2 egress is free. The one cost an anonymous visitor can cause is an R2 Class B
read (`GetObject`, `HeadObject`), and only on an edge-cache miss. The first 10
million Class B operations per month are free; after that they cost $0.36 per
million ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). A miss is
cheap to force in two ways: a unique `?v=` value (cache busting) and a random
path that R2 must look up before answering 404.

## What each piece does

| Piece | Where | Effect |
| --- | --- | --- |
| `hypoexplorer_data_cache` | cache rule, [payload](../cloudflare/http_request_cache_settings/hypoexplorer_data_cache.json) | Every response on the data host is eligible for cache. The cache key ignores the query string, so `?v=` values cannot force misses. Edge and browser TTLs follow the origin's `Cache-Control`. |
| `hypoexplorer_data_methods` | custom rule, [payload](../cloudflare/http_request_firewall_custom/hypoexplorer_data_methods.json) | Blocks every method except GET and HEAD on the data host. |
| `hypoexplorer_data_paths` | custom rule, [payload](../cloudflare/http_request_firewall_custom/hypoexplorer_data_paths.json) | Blocks paths outside `/datasets/`, `/query/` and `/qc/`, paths not ending in `.js` or `.pdf`, paths containing `..` or `//`, and paths longer than 256 bytes. |
| `hypoexplorer_data_shutoff` | custom rule, [payload](../cloudflare/http_request_firewall_custom/hypoexplorer_data_shutoff.json) | Blocks every request to the data host. Created **disabled**. Only the spend guard toggles it. |
| `hypoexplorer_data_burst` | rate limiting rule, [payload](../cloudflare/http_ratelimit/hypoexplorer_data_burst.json) | More than 400 requests in 10 seconds from one IP at one Cloudflare location blocks that IP for 10 seconds. |
| Upload purge | [uploader](../scripts/upload_bundles_r2.mts) | After a real upload, purges the changed keys from the edge cache. |
| Spend guard | [Worker](../workers/spend-guard/src/index.ts) | Every 10 minutes, enables the shutoff rule when month-to-date Class B operations on the bucket reach 8,000,000, and disables it again when they are below that (on the first run of each UTC month). |

Blocked requests are answered by the WAF with Cloudflare's 403 page before the
cache or R2 is consulted, so they cost nothing.

The allow-list mirrors the retired gate's `checkPath()`. The gate also limited
key characters to `[A-Za-z0-9_./-]`. That check needs a regular expression, which
Free custom rules do not support, so it was dropped. A random path with an
allowed prefix and extension still reaches R2 and costs one Class B read. The rate
limit and the spend guard bound that cost.

### Freshness: pointers and the purge

The uploader stores `Cache-Control: public, max-age=300` on `query/tracks.js` and
`query/expression-manifest.js`, and `public, max-age=31536000, immutable` on
everything else ([r2Incremental.mts](../scripts/lib/r2Incremental.mts)). With both
TTLs set to "respect origin", the pointers stay at 300 seconds at the edge and in
browsers. A zone-level Browser Cache TTL longer than the origin's value once
forced four hours on the pointers. Cloudflare raises the browser TTL to the zone
setting when the origin's is lower, unless a cache rule says otherwise
([Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/#browser-cache-ttl)).
The cache rule's `browser_ttl: respect_origin` is that override.

Because the cache key ignores `?v=`, an object rewritten under the same key keeps
being served from the edge until it is purged. For immutable bundles that can
last up to a year. `pnpm run upload:bundles` therefore purges after every real
upload, by prefix: one prefix per changed dataset directory, per query build
directory and per expression generation, `qc/` for any PDF, and each changed
pointer exactly. If more than 100 prefixes are needed, it purges the whole
hostname instead. Keys whose PUT failed or was interrupted are purged too.

- A real upload refuses to start without `CLOUDFLARE_EDGE_TOKEN`. It exits
  non-zero if the purge fails, and prints the manual commands.
- `--dry-run` and `--remote-dry-run` never purge.
- `--no-purge` skips the purge and prints the manual steps. Use it only when you
  purge by other means.
- Free plan purge limits: all purge types are available, 5 requests per minute,
  and at most 100 prefixes per request
  ([purge limits](https://developers.cloudflare.com/cache/how-to/purge-cache/),
  [prefix semantics](https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/)).

**Order of a data release:** upload the data (which purges) **before** deploying
an app shell whose `?v=` names that release. If the app goes first, a browser can
fetch the new URL while the edge still holds the old bytes, and then keep those
bytes for a year under the immutable header. A purge cannot reach browser caches.

### CORS

CORS is not needed. Every production request to the data host is a no-CORS
request:

- bundles load as `<script src>` ([bundleSource.ts](../src/data/bundleSource.ts));
- QC PDFs load in an `<iframe>` or `<a>` ([QCTab.tsx](../src/qc/QCTab.tsx));
- the reachability probe uses `fetch(..., { mode: 'no-cors' })`
  ([originHealth.ts](../src/data/originHealth.ts)).

The only CORS fetch path is the optional streaming transport, enabled by
`VITE_BUNDLE_CORS=true` at build time. Neither `.env.local` nor `.env.example`
sets it, so it is off. The gate's `Access-Control-Allow-Origin: *` therefore
disappears without effect. If streaming is ever enabled, give the bucket a CORS
policy first:

```json
{ "rules": [ { "allowed": { "origins": ["https://hypoexplorer.com"], "methods": ["GET", "HEAD"] },
               "exposeHeaders": ["Content-Length", "Content-Encoding", "Content-Range", "ETag"] } ] }
```

Apply it with `pnpm exec wrangler r2 bucket cors set hypoexplorer-datasets --file cors.json`, then purge the
host ([R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)).

### Free plan constraints that shaped the design

All verified on 2026-10-01:

- **Rate limiting:** one rule. The expression may use only the URI path (and
  Verified Bot), so the rule cannot name the host and it also counts the apex's
  legacy `/datasets/` redirects. It counts per IP with a mandatory `cf.colo.id`.
  The period and the mitigation timeout are both 10 seconds. It cannot exclude
  cached requests, so cache hits count too. See
  [availability](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability)
  and [parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/).
  `edge:apply` stops if that one slot holds a rule it does not own.
- **Custom rules:** five per zone, and no `matches` regex (Business and up). This
  design uses three. See
  [custom rules](https://developers.cloudflare.com/waf/custom-rules/#availability)
  and [operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/).
  There is no custom block response, so blocked requests get Cloudflare's 403 page.
- **Cache rules:** 10 per zone. "Ignore query string" in the cache key
  (`custom_key.query_string.exclude.all`) is listed for every plan; per-parameter
  query string keys are Enterprise-only. See
  [cache keys](https://developers.cloudflare.com/cache/how-to/cache-keys/#availability).
  If the API rejects the cache key on this zone, the only Free alternative is
  the zone-wide Caching Level "Ignore Query String"
  ([caching levels](https://developers.cloudflare.com/cache/how-to/set-caching-levels/)).
  That setting also affects the apex, so it needs a separate decision.
- **Workers Free:** five Cron Triggers per account and 10 ms CPU per cron
  invocation ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
  The guard uses one trigger.

## Tokens

Create both in the dashboard under **My Profile > API Tokens > Create Token >
Custom token**.

**Edge token** (`CLOUDFLARE_EDGE_TOKEN`; put it in the git-ignored `.env.local`):

| Permission group | Permission | Access |
| --- | --- | --- |
| Zone | Cache Rules | Edit |
| Zone | Zone WAF | Edit |
| Zone | Cache Purge | Purge |

Set **Zone Resources** to *Include > Specific zone > hypoexplorer.com*. In API
terms these are Cache Settings Write, Zone WAF Write and Cache Purge (from the
Cloudflare OpenAPI token groups for the entry-point and `purge_cache` endpoints).
The [cache rules API page](https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/)
also lists *Account Rulesets > Edit*. Add it only if writing the cache rule
returns 403 with the three permissions above. `edge:apply` and `upload:bundles`
read this variable from the environment, from `--env-file`, or from
`.env.local`. They never export it, so the R2 token in `.env.local` cannot
shadow Wrangler's OAuth login. An upload host that never applies rules needs
only Cache Purge.

**Guard token** (`CF_GUARD_TOKEN`; a Worker secret only, kept in no file):

| Permission group | Permission | Access |
| --- | --- | --- |
| Account | Account Analytics | Read |
| Zone | Zone WAF | Edit |

Set **Account Resources** to the HypoExplorer account and **Zone Resources** to
hypoexplorer.com. Do not add a client IP filter, because the Worker's egress
addresses are not fixed.

## Cutover

Run each step from the repository root. Do not start a step until the previous
step's check passes.

| # | Do | Check | Roll back |
| --- | --- | --- | --- |
| 1 | Create both tokens. Add `CLOUDFLARE_EDGE_TOKEN=...` to `.env.local`. | `pnpm run edge:apply` prints a plan instead of a token error. | Delete the tokens. |
| 2 | `pnpm run edge:apply` (dry run). Review it: 5 rules created, or updates for `hypoexplorer_data_methods` and `hypoexplorer_data_burst` if the retired gate's payloads were ever published, and no `!` lines. Then run `pnpm run edge:apply --apply`. It writes the firewall and rate-limit rules first and the cache rule last, re-reads all three phases, and purges `data.hypoexplorer.com` because the cache key changed. | The last line says `Applied.` and the process exits 0. | In the dashboard, under **Security > Security rules** and **Caching > Cache Rules**, disable or delete the rule by name (`hypoexplorer_data_*`). Then run `pnpm run edge:apply --purge-host`. |
| 3 | `pnpm run verify:edge --allow-gate` (the gate is still routed). | Every check passes. The WAF answers 403 before the gate does. | Same as step 2. |
| 4 | Delete the gate Worker. Dry run first: `pnpm exec wrangler delete hypoexplorer-data-gate --env-file .env.cfdeploy --dry-run`, then run it without `--dry-run` and confirm the prompt. **Always pass the name.** Without it, Wrangler reads the root `wrangler.jsonc` and targets the site Worker `hypoexplorer`. Wrangler 4.86 takes the name as a positional argument (`wrangler delete [name]`); the [docs](https://developers.cloudflare.com/workers/wrangler/commands/workers/#delete) also list `--name`. Deleting a Worker removes "all associated Cloudflare developer platform resources": its `data.hypoexplorer.com/*` route and its Durable Object counter. | **Websites > hypoexplorer.com > Workers Routes** lists no route for `data.hypoexplorer.com`. Delete any leftover route there. | Restore the gate from git (`workers/data-gate/` at the commit before its removal) and deploy it with `pnpm exec wrangler deploy --config workers/data-gate/wrangler.jsonc --env-file .env.cfdeploy`. |
| 5 | `pnpm run verify:edge`, then `pnpm run verify:deploy`. | Every check passes, and no response carries `x-hypoexplorer-gate`. | Step 4 rollback. |
| 6 | Deploy the guard in observe mode: `pnpm run guard:deploy --var GUARD_MODE:observe`. Set its secret: `pnpm exec wrangler secret put CF_GUARD_TOKEN --config workers/spend-guard/wrangler.jsonc --env-file .env.cfdeploy`. Watch the next run (on every tenth minute): `pnpm exec wrangler tail hypoexplorer-spend-guard --env-file .env.cfdeploy`, or open **Workers & Pages > hypoexplorer-spend-guard > Logs**. When a run logs `classB` as a number and `shutoffEnabled: false`, run `pnpm run guard:deploy` to switch to enforce. | One `spend-guard` log line per run with `decision: "unchanged"` and no `error`. | `pnpm exec wrangler delete hypoexplorer-spend-guard --env-file .env.cfdeploy`. The shutoff rule keeps its current state, so check that it is disabled. |
| 7 | Dashboard only: **Manage Account > Billing > Billable Usage > Set Budget Alert**, at $1. | An email address is listed for the alert. | Remove the alert. |

After the cutover, `GATE_STATUS_KEY` in `.env.local` is unused and can be deleted.

## Spend guard

`workers/spend-guard/` runs on a 10-minute cron. It has no routes, no
`workers.dev` URL and no fetch handler. Each run:

1. Queries `r2OperationsAdaptiveGroups` through the GraphQL Analytics API for the
   current UTC calendar month, grouped by bucket and action
   ([R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)).
   It sums Class B operations (`HeadBucket`, `HeadObject`, `GetObject`,
   `UsageSummary`, `GetBucketEncryption`, `GetBucketLocation`, `GetBucketCors`,
   `GetBucketLifecycleConfiguration`) on `hypoexplorer-datasets`. It also logs
   Class A operations and account-wide totals, since the free tier is
   account-wide, plus any action type it cannot classify.
2. Reads the `http_request_firewall_custom` entry point and finds
   `hypoexplorer_data_shutoff`.
3. Sets the desired state: enabled when Class B is at or above
   `CLASS_B_MONTHLY_LIMIT`. It PATCHes the rule only when the desired state
   differs from the current one, so most runs write nothing. On the first run of
   a new month the count is low again, and the run disables the rule.

The guard is configured through `vars` in
[wrangler.jsonc](../workers/spend-guard/wrangler.jsonc):

- `GUARD_MODE`:
  - `enforce` writes.
  - `observe` logs the change it would make.
  - `off` does nothing.
  - Any other value is treated as `enforce`.
- `CLASS_B_MONTHLY_LIMIT` defaults to `8000000`, which leaves headroom for
  analytics lag and the polling interval. An unparseable value falls back to the
  default and never means "no limit".

To change a value, edit `vars` and run `pnpm run guard:deploy`.

**Fail-safe choice: when analytics cannot be read, the guard does not close the
host.** It logs a `spend-guard` error instead. Missing analytics is not evidence
of abuse. An analytics outage, an expired token or a revoked permission must not
take the data offline for every visitor. During that time the cache rule, the
WAF and the rate limit keep protecting the bucket, and the guard catches up on
its next successful read. There is one exception. If the shutoff rule was last
changed in an earlier UTC month, the guard reopens the host even without
analytics, because the monthly counter has reset.

**Limits:**

- The guard acts at most every 10 minutes, on analytics that lag by minutes.
  Spend between polls is not capped, so a large distributed attack can overshoot
  the threshold before the next run.
- Workers Free CPU (10 ms) is enough for one query and one rule read.
- `pnpm run guard:dev` runs locally on port 8791 with `GUARD_MODE` forced to
  `observe`. Put a token in the git-ignored `workers/spend-guard/.dev.vars` as
  `CF_GUARD_TOKEN=...`, then trigger a run with
  `curl "http://127.0.0.1:8791/__scheduled?cron=*/10+*+*+*+*"`.

## Closing or reopening the data host by hand

The guard re-evaluates every 10 minutes. It reopens a host it considers under
the limit, and it closes a host it considers over the limit. Settle the guard
before changing the rule by hand:

- **Close manually:** run `pnpm run guard:deploy --var GUARD_MODE:off`. Then
  enable **Security > Security rules > Custom rules >
  hypoexplorer_data_shutoff** in the hypoexplorer.com zone.
- **Reopen manually** (for example, after deciding to pay for a month's
  overage): disable the same rule, and stop the guard from closing it again. You
  can raise `CLASS_B_MONTHLY_LIMIT` and redeploy, or deploy with
  `--var GUARD_MODE:observe`.
- **Restore normal operation:** run `pnpm run guard:deploy`. This restores the
  checked-in `vars`, so the guard is back in enforce mode.

`pnpm run edge:apply` never changes the shutoff rule's `enabled` state. It only
creates the rule, disabled, when the rule is missing.

## Routine operation

- **Publishing data:** `pnpm run upload:bundles --env-file .env.cfdeploy`
  (purges automatically), then deploy the app.
- **Changing a rule:** edit `scripts/lib/edgeRules.mts`, then run
  `pnpm run edge:apply --write-payloads` to re-render `cloudflare/*.json`. The
  unit test in `src/__tests__/edgeRules.test.ts` fails if they drift. Then run
  `pnpm run edge:apply` and `pnpm run edge:apply --apply`, followed by
  `pnpm run verify:edge`.
- **Watching:**
  - the guard's log lines;
  - **R2 > hypoexplorer-datasets > Metrics** for operations;
  - **Security > Events** for WAF and rate-limit blocks.
- **Never** load-test the rate limit against production. A burst blocks the
  operator's own address.
