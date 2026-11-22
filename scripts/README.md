# Scripts

Run these through the `pnpm run` names in `package.json` where one exists.

| Folder | Contents |
| --- | --- |
| `deploy/` | Release build, verification, R2 upload and Cloudflare edge rules. |
| `fetch/` | Restoring the public data release, query catalog, reference atlases and HypoMap. |
| `dev/` | Offline dev server, brand assets and SEO source snapshots. |
| `lib/` | Shared modules and their tests. |
| `regen-r460/` | Current R 4.6.0 producers. |
| `agent-context/` | Context map generator, review and check. |
| `smoke/` | Playwright smoke tests. |

## Why most files stay at this level

The loose `audit_*`, `build_*`, `prep_*`, `validate_*`, `followup*` and similar files
produced committed bundles, assessments and evidence. Evidence records under `data/`
and `geo_replication/` (and the maintainer's retained audit cache) pin them by exact
path and SHA-256, and [project guidance](../docs/PROJECT_GUIDANCE.md#analysis-environment)
requires replaced producers to stay byte-identical. Moving or editing one invalidates
that provenance, so they stay here. Put new producers and evidence checks at this level
only when a record will pin them; put tooling in a folder above.

`check_public_safety.mts` and `install_safety_hook.mjs` also stay here: installed
pre-commit hooks call the checker by this path.
