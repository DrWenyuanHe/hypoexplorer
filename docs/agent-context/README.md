# Maintained agent context

Generate facts, author meaning, and review both when their sources change. Start
with the bounded map in [AGENTS.md](../../AGENTS.md), then the relevant
[workflow](workflows.md), [code map](generated/codebase.md),
[dataset map](generated/datasets.md) or [contract map](generated/contracts.md).

## Canonical sources and scope

This repository has a static dataset/bundle architecture, not a relational
database or installed-module registry. Source directories under `src/` define
navigation areas; `AppView` and `EXPLORER_TABS` define view/tab inventories.
`src/types/index.ts` supplies every exported shared interface/type declaration.
The catalog requires exact coverage of those inventories and dataset categories.

Dataset IDs and study meanings already live in `src/data/datasets.ts` and its
registered JSON sidecars. The generator requires unique IDs, valid categories
and nonempty authored study descriptions instead of maintaining a duplicate
dataset catalog. It statically recognizes the two factory call shapes, sidecar
registration callbacks and the guarded literal metadata correction. A new
registration or correction style must extend the adapter and its tests.
It does not run factories, interpret scientific results or inventory live data.

## Change procedure

1. Run `pnpm run context:review` (optionally `-- --base origin/main` after obtaining
   that base through the normal Git workflow). Inspect each affected area's
   source list, canonical references and operational implications.
2. Update catalog meanings and authored runbooks where needed. Run
   `pnpm run context:generate` to derive the maps. Generation never writes reviews
   or stages files.
3. Rerun `pnpm run context:review`. For each affected area, author its JSON record
   under `reviews/` using the final reported fingerprint, `updated` or `no-impact`,
   a specific explanation of at least 40 trimmed characters and existing source
   or documentation references. There is deliberately no approve-all command.
4. Run `pnpm run context:check` and `pnpm run test:context`. Include intended source,
   authored context, generated pages and review records in the same commit.
5. After incorporating other changes, repeat review/generation/check for the
   combined result. After committing, check `pnpm run context:check --ref HEAD`.

The review command reports JSON and may include review errors while exiting
successfully. The check command is the pass/fail gate. For clean JSON invoke
`node scripts/agent-context/cli.mjs review` directly.

## Snapshot modes and shared checkouts

Default commands read tracked and non-ignored new working files. `--staged` reads
index blobs, rejects unresolved merges and supports partial commits. `check --ref
HEAD` reads committed blobs independently of local edits. `--staged` and `--ref`
cannot be combined. Revision checks use the locally invoked checker program.

For a partial commit, stage intended authored changes first, then use `--staged`
for generate, review and check. Stage the generated files after generation; rerun
the staged report and author/stage the corresponding reviews. Never use working
fingerprints for a different index snapshot. Staged generation refuses to
overwrite unstaged authored AGENTS text. It never stages anything.

## Fingerprint coverage

The executable allowlist is `isSource` in
[model.mjs](../../scripts/agent-context/model.mjs). It covers text code/config/docs
under `src`, `scripts`, `workers`, `docs`, `data`, `geo_replication`,
`nar-research`, `.github`, `.agents`, `.claude` and `.codex`,
tracked hooks and root configuration/instruction files. Extensions include
TS/JS, JSON/JSONC, Markdown, SQL, Python, R, PowerShell, YAML, TOML, CSS, HTML and
shell. Root ignore rules and VERSION participate. Ignored files do not enter any
snapshot unless already tracked.

Generated context pages, review records and the generated root block are excluded
to avoid self-invalidating reviews. Downloaded/archived author code, dependency
trees, runtime caches, scientific CSV/TSV/matrix products, binary assets and
JSON evidence products under analysis directories are outside this guard.
Their existing provenance, numerical and bundle checks remain necessary. This
is an explicit boundary, not whole-repository scientific certification.

Each source belongs to a `module-<directory>`, `platform`, `edge`, `analysis` or
`repository` area. Workflow ownership overlaps those areas using configured
modules and exact files or prefixes ending in `/`. Catalog fragments additionally
invalidate their relevant areas. Paths and normalized LF content participate in
SHA-256 fingerprints, detecting additions, removals, renames and comment changes.

## Startup and enforcement

`CLAUDE.md` imports `@AGENTS.md` on its own line. Authored policy lives in
[project guidance](../PROJECT_GUIDANCE.md); startup points to relevant detail.
Reread the map and check it after a branch switch or context recovery.
The overview is limited to 6 KiB and root AGENTS to 16 KiB of normalized UTF-8.

Run `pnpm run context:install-hook` once per clone. The installer wraps the existing
pre-push hook, preserves its input and arguments, and runs the context check before
the original hook (including this checkout's redaction and Git LFS checks).
It refuses unknown existing wrapper/backup states. Pushed tips are checked once
each; deletions are skipped. A branch lacking the baseline fails the check.

The context CI workflow runs tests and checks the candidate commit/PR merge ref
with read-only repository permissions. It does not generate or approve reviews.
Local hooks can be bypassed; required-check settings on the hosting service must
be configured separately. Installing this feature does not configure that setting.

## Evidence limits

A fresh fingerprint establishes that reviewed sources have not changed. It
cannot prove the explanation is truthful or the scientific results are correct.
Link checks cover context Markdown and the generated root block, using Markdown
ATX heading anchors and explicit HTML IDs; this is not a full Markdown parser.
See [evaluation](evaluation.md) for the checks actually performed. No live service,
credential, model call or production deployment is needed by this feature.
