# September 5 intake validation

The intake adds 14 studies, 22 tracks and 51 fitted comparisons. The explorer registry now contains 159 studies and its query index contains 226 tracks.

Completed checks:

- All 51 comparisons passed the independent intake audit: source-to-prepared count conservation where applicable, expression values, DE values, sample membership, model support, and pathway provenance.
- All 51 comparisons completed the schema-3 FGSEA workflow across four collections. The repository pathway refresh check verified 158 in-scope studies, 198 comparisons and 324 pathway files without changing protected analysis bundles.
- Author-validation mechanical coverage passed for 158 in-scope studies and 172 registered default-track contrasts. Additional intake tracks are checked by the separate 51-comparison intake audit.
- Query-index checks passed for all 159 studies and 226 tracks; recomputed values matched all 1,280 shards.
- All required prebuild gates and the production Vite build passed. A stale generated advancement report was refreshed, its check rerun, and the remaining prebuild gates and build completed successfully.
- Application and script TypeScript checks passed.
- 102 selected tests passed across registry, intake, author validation, internal QC, quality consistency, dataset library/filtering, dataset switching and contrast switching suites.

The 14 new studies still await independent author-result comparison. Their pipeline and bundle audits are not scientific concordance sign-off. Fourteen further discovery candidates remain held for the source, annotation or design requirements listed in [REPORT.md](REPORT.md); one already integrated study was not duplicated.

Browser automation and local preview requests timed out, so visual browser QA is not claimed. The changes and generated bundles are local and have not been deployed. The production build retains the configured public data origin; publishing requires uploading the updated bundles and query index along with the application.

Detailed numerical evidence is in [audit.generated.json](audit.generated.json). The study and comparison manifests are [studies.json](studies.json) and [analyses.json](analyses.json).
