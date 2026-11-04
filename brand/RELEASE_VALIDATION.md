# Brand release 0.14.3 — 2026-09-16

Based on fetched `origin/main` at `a0392572`, in the isolated `codex/brand-identity` worktree.

The approved concept A is used by the app and generated public-page headers. The logo returns home, with native modifier-click behavior. Browser and installed-app icons share the brain artwork. Desktop and 360 px mobile layouts were inspected, including home navigation from the library, tracker and public About page.

## Checks completed

- 92 focused branding, navigation and public-page tests passed (the public-page suite was rerun after updating its XSS image selectors).
- App, build-config and data-gate TypeScript checks passed.
- Lint completed without errors; 4 warnings and 25 informational findings predate this change.
- Context check and all 20 context tests passed.
- HFD intake, September intake, full query-index and full expression-index checks passed.
- Tracker generation, Vite production build and precompression passed. Production HTML, icon files, installed-app manifest and service-worker precache were checked. Dataset/query/QC trees are excluded from the site deployment and remain on the existing data origin.

## Existing validation limits

The baseline full suite reported 1,961 passing, 17 failing and 4 skipped tests. The failures concern missing archived scientific inputs. After restoring three small GEO metadata files and verifying their recorded hashes, all 5 tests in `reviewedFgseaSpecies.test.ts` passed, resolving its two initial failures. Missing original source counts still prevent the conservation, keyed-source and replication checks from completing.

The canonical `deploy:dist` prebuild was attempted. Separate author-validation and quality checks remain blocked: `intake-numeric-2026-09-11/jobs.json` is missing, and several original source archives needed to replay retained conservation evidence are absent. The GSE281503 workbook is also absent. The scientific evidence was not regenerated to hide these failures. Existing dead-code findings remain in author-validation and site-info helpers, plus the pre-existing unlisted esbuild/Python/R dependencies.

The website-only artifact was built with `npm run build:tracker`, `npx vite build` and `npm run precompress` after the available checks above. This is not a claim that the complete scientific prebuild passed.

## Expression validation metadata repair

The retained expression validation record had three bundle byte hashes sealed with a final CRLF, while Git checks out their final line endings as LF. Replacing the final LF with CRLF reproduced each old hash exactly. Regenerating validation into a scratch directory confirmed that only those three SHA-256 values and byte counts differed: every expression value, artifact and build ID was identical. The record now describes the checked-in LF bytes. Dataset bundles, query products, analysis values and scientific generators are unchanged.
