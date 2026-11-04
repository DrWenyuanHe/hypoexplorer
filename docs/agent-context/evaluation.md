# Context evaluation

## Static navigation audit

Representative routes for public-dataset changes, scientific evidence review,
UI/navigation changes, local imports and delivery are recorded in
[workflows.md](workflows.md). Their references were selected from repository
code, package commands and existing runbooks. Dataset maps preserve declared
study meanings and the reviewed GSE314184 metadata correction. The map uses
shared interfaces instead of inventing a database schema.

The review baseline covers context responsibilities and navigation references.
It does not reapprove retained scientific evidence or certify concurrent app/SEO
changes as release-ready. Analysis data products still need their existing checks.

## Reproducible verification

The initial local context suite passed all 20 tests on Windows. It includes real
Git index/revision snapshots, a one-batch blob-read assertion and shell execution
proving that the hook forwards stdin/arguments and stops before the original
hook when the context check fails. The original local redaction/LFS hook was
preserved when installing the wrapper. CI configuration was inspected locally;
no hosted CI run has occurred for these uncommitted changes.

Run `pnpm run test:context` for fixture and disposable-Git tests of deterministic
generation, inventory/reference validation, review freshness and working/index/
commit isolation. Run `pnpm run context:check` for the current working snapshot
and `pnpm run context:check --ref HEAD` after committing the baseline.
The latter is expected to fail on a historical revision without this feature.

## Agent evaluation still needed

Fresh Claude/Codex startup sessions, automatic import loading, navigation success,
obsolete-command use, read/search counts, elapsed time and token costs have not
been measured. Passing structural checks is not evidence of improved agent
performance. Keep any future private task traces outside Git and record only
appropriate aggregate results here.
