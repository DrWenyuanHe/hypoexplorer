# UI and description review

Reviewed on September 13, 2026 using the requested Unslop skill. Three subagents reviewed analytical tools, reference interfaces, and public pages. The coordinating pass covered the homepage, shared controls, local imports, update/error messages, integration, and browser checks.

## Changes

- Replaced promotional labels, vague promises and dense explanations with the action or result a researcher can expect.
- Kept the removed homepage heading and subtitle absent. Updated the sharing image to the current homepage.
- Renamed the homepage's "KO vs baseline" shortcut to "Diet comparison". Its existing destination is the GSE220533 chow-versus-high-fat-diet analysis.
- Removed "Flagship" from the planned feature. Planned tools still explain what data they need.
- Corrected descriptions that called all exported expression values CPM, promised instant searches, or described the current collection as only macaque and mouse.
- Simplified import, matching, loading and error text. Data-server messages now distinguish observed failures from possible causes.
- Clarified the meaning of raw-p stars, separate study estimates, FDR tallies and shared animals. The BY help text now describes the harmonic multiplier used by the existing calculation, about 10.2 at 15,000 tests.
- Added semantic headings to Statistics and the shared Methodology/Data sources sections while retaining their existing appearance.
- Fixed Pathway Explorer losing its category selection when submitting a search. The selection now lives above the error boundary that remounts for each pathway.
- Rewrote release notes without changing their dates, order, historical counts or scientific values. The page now says that features and counts reflect each release date.

## Coverage

| Area | Review coverage |
| --- | --- |
| Homepage and navigation | Tool descriptions, search forms, planned-tool modal, badges, accessible names and reference links |
| Gene Explorer | Search, aliases, volcano, charts, comparison matrix, summary table, pathway details, tooltips and exports |
| Pathway Explorer | Search, scope, results, filters, pathway details, leading-edge genes, heatmaps and exports |
| Comparisons | Population comparison, compare-set drawer and columns, cross-dataset gene/pathway reports, empty/error states and statistical caveats |
| Circadian analysis | Method and correction descriptions, trace captions, result states and exports; algorithms and numerical results preserved |
| Local datasets | Import and column mapping, storage/privacy notice, public-reference picker, matching rules, results and empty states |
| Dataset library | Filters, cards, study records, count notes and empty results |
| Dataset trackers | Published tracker and standalone research app; feasibility labels, filters, summaries, records and errors |
| Reference pages | Quality control, Statistics, verification, nomenclature, Methodology, data sources and acknowledgements |
| Shared UI | Chart-scale help, gene-list import, study metadata, generic errors, loading, updates and version controls |
| Public documents | All 161 study descriptions; catalog; topic index and four guides; Methods; citation; About; shared navigation and metadata |
| Release history | All 29 entries and 93 notes |

The 25 curated editorial records, including 13 study-scope notes and 12 limitation notes, were read and retained where already specific and clear. All 34 selected-study notes in the topic guides were reviewed.

Original publication titles, source citations, accessions, gene and pathway identifiers, evidence records, dataset values, model calculations and scientific thresholds were preserved. Generic display labels in `src/data/authorVerification.ts` changed; verification state logic did not.

## Validation

- 511 tests passed across 53 selected suites, including the new pathway-scope regression. Text assertions were updated where labels changed. No new tests were added merely to repeat copy.
- One suite, `src/__tests__/compareSet.test.tsx`, stalled before its first result in both batch and isolated runs. Those processes were stopped. It is not counted as passed. The changed compare-set interface passed its dedicated component suite, and the library rendered and responded with all 161 studies in the production preview.
- Application and Node-script TypeScript checks passed. Scoped Biome lint and whitespace checks passed.
- Final Vite production compilation passed into `.tmp/unslop-verified/`, including PWA output and generated public pages. The standalone tracker build also passed. Vite still reports the existing large-chunk warning. The scientific-data regeneration and full deployment pipeline were not run for these interface changes.
- All 170 generated public documents outside the homepage passed checks for unique titles/descriptions, one H1, canonical URLs, JSON-LD, internal links and page anchors. The sitemap retains 171 URLs including the homepage.
- Changelog rendering retained all 29 dates and 93 notes, with the same numerical values per release.
- The refreshed social image is a valid 1200 by 630 JPEG, 74,446 bytes.

The final App regression covers selecting Primate atlas before submitting a pathway, searching a second pathway, and clearing the category filter. The compiled browser check also retained Primate atlas and showed only its 60 tracks. The final Statistics page exposes its title and sections as semantic headings, and the two joined FDR phrases are corrected. Application type checking and final lint passed after these changes.

## Browser review

The local compiled app was inspected in the Codex browser. Desktop checks covered the homepage, library, tracker, local-results interface, gene-search landing and scoped gene report, expression comparison, pathway search and report, Statistics, verification, nomenclature landing, Quality control, Methodology, data-source credits and changelog.

Public-page checks covered Methods, the macaque study page, topic index, About and the citation guide. Phone-width screenshots at 390 pixels covered the homepage, planned-tool dialog, Methods and study page. The homepage and public guide had no horizontal overflow at that width. The removed homepage introduction and "Flagship" label were absent.

These are source-wide reviews and representative browser checks, not an exhaustive run of every dataset, modal, imported file, network failure or browser. The dataset explorer's persistent navigation remains dense at phone width; its sidebar was not redesigned in this pass.

Detailed inventories and validation output remain in `.tmp/unslop-review/`. No commit, push or deployment was made.
