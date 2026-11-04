# Publication release

Use this procedure to freeze a reviewable HypoExplorer snapshot. Local verification
and packaging do not publish the website, create a release tag, or register a DOI.

## Verify the candidate

Gene and pathway reports serialize category, individual-study and sample/quality
filters in a validated version-1 URL payload. The gene report passes its resolved
cohort into bar comparisons, whose loaders and category controls stay within it.
Explorer links preserve contrast, selected genes, volcano/pathway settings and
chart scale. Unsupported settings fail visibly instead of broadening the analysis.
Share analysis explains that links use the recipient's deployed data; a link is
not a substitute for archived results.

Gene result exports obtain dataset identity through `buildPopData` and add retained
method/replication evidence, settings and release metadata through
`src/utils/exportProvenance.ts`. CSV metadata travels in the same file; Excel uses
readable Metadata rows. File-level CSV metadata appears once, in the first result
row; dataset, track and contrast identifiers remain on every row. Units and
scientific precision still come from the shared
sample-value and workbook helpers.

1. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run typecheck:app`,
   `pnpm test --maxWorkers=2`, and `pnpm run lint`.
2. Build the ignored indexes on a fresh clone: `pnpm run build:query-index` and
   `pnpm run build:expression-index`. Retained historical checks require the Git
   history and the documented analysis environments. See the
   [delivery contract](agent-context/delivery.md).
3. Run `pnpm run build`. This includes the scientific prebuild gates; the app CI
   build and browser tests do not replace these checks.
4. Run `pnpm run verify:release` and `pnpm run test:smoke`. The verification compares
   the built source/data fingerprint with the current checkout and checks public
   citation documents. Editing source after building intentionally fails it.
5. Run `pnpm run context:check` and `pnpm run test:context` after reviewing affected
   architecture records. Inspect the candidate in a browser, including the shared
   analysis links and exports.

`release.json` identifies the app version, source commit, canonical-LF source
fingerprint, uncommitted-source flag, query catalog checksum, immutable query and
expression build IDs, and analysis/gene-set package versions. The source hash
includes the allow-listed code and config named by `releaseSourceFiles`; it is
not a claim that the entire historical evidence repository is in the web bundle.
The same identity is compiled into exports and linked from the version dialog.
`version.json` carries its release ID so same-version source/data updates are
detected. Both files revalidate through the app host and service worker.
Mutable data-bundle URLs use a 32-character release fingerprint as their cache
key, so an update under the same app version cannot reuse the previous release's
browser or service-worker bundle entry. Immutable index URLs retain their
content-addressed paths.

## Prepare and deposit

Run `pnpm run prepare:publication` after verifying `dist`. For an isolated output,
pass the directory to both commands, e.g. `pnpm run verify:release .tmp/release-dist`
and `pnpm run prepare:publication .tmp/release-dist`.

The packager writes `.tmp/publication-release/<releaseId>/` and refuses to overwrite
an existing snapshot. It contains source, built-app and browser-data archives,
every data file's SHA-256, a package `SHA256SUMS`, citation and reuse files. It uses
the system `tar` command. It excludes secrets, tool worktrees, downloaded original
articles and raw reads. It preserves browsable results, not a full raw-read
reproduction environment. The repository and original accession records retain
the links to those inputs and methods.

For a public release, commit the reviewed source, select a release version/tag,
rebuild, repeat the gates, and package that committed state. Deposit the frozen
package in a repository offering immutable versions (such as Zenodo) only after
approval. Record the returned DOI and archive URL in `CITATION.cff` and the public
citation guide; never invent or borrow a DOI. A local package is not a public
archive. Keep old deposited versions accessible when updating the site.

The [MIT license](../LICENSE) covers original code. [REUSE.md](../REUSE.md) applies
CC BY 4.0 to original contributions to derived outputs and explicitly preserves
source-study and third-party terms. The archive does not grant rights the author
does not hold.

After an authorized website deployment, run `pnpm run verify:deploy` against the
target origin. It checks the deployed release fingerprint, exact query/expression
manifest bytes and two representative track bundles. These sampled track checks
do not establish a checksum match for every remote object. Use the uploader's
read-only remote comparison for the complete planned inventory, as described in
the delivery runbook. Publish the frozen data generations before their pointers
and the app shell.
