# Search discovery for HypoExplorer

HypoExplorer serves one public HTML page for each integrated dataset at
`/studies/<dataset-id>/`, a browsable directory at `/studies/`, curated research
guides at `/topics/`, methods at `/methods/`, citation guidance at `/how-to-cite/`,
and an author and contact page at `/about/`. These pages work without JavaScript and link to the
existing interactive hash routes. `/datasets/` remains reserved for data bundles.

`scripts/lib/seoPages.mts` generates the pages, `sitemap.xml`, and `robots.txt`
during `pnpm run build`. The same renderer serves these routes in `pnpm run dev`.
The sitemap contains the homepage, directory, About page, all seven supporting
documents, and every registered study. It excludes interactive filter combinations and invents no modification
dates. Workbox excludes these public documents from precaching and limits its HTML
fallback to the root application, preserving public documents and missing-page
responses.

Each study has a unique title, description, canonical URL, social metadata,
Dataset structured data, source identifiers, available comparisons, and original
source links. The directory links every study within two clicks of the homepage.
`seoStudyContent.mts` adds the actual selected comparison, replicate counts,
preparation, expression scale and evidence status. `studyEditorial.json` supplies
13 reviewed scientific scope notes with repository evidence paths, plus concise
title overrides. Titles retain accessions and full scientific terms; a character
target never cuts a word or drops a material distinction.
The homepage includes readable HTML and navigation before React starts. Headers
state that the app is currently in beta testing.

## Sources and attribution

`src/data/datasets.ts` defines the integrated studies and comparisons.
`public/datasets/<id>/meta.js` provides track and sample information, read as
JSON rather than executed. `data/seo/studySources.json` is a committed snapshot
of official GEO/BioStudies titles and PubMed/Crossref publication metadata; builds need no network
connection or ignored analysis inputs. Missing titles remain absent rather than
being inferred from a study's display name.

Refresh the snapshot with:

```sh
pnpm exec tsx scripts/refresh_seo_sources.mts --fetch-series --fetch-papers
pnpm exec tsx scripts/refresh_seo_sources.mts --check
```

The first command fills missing titles from official GEO or EMBL-EBI records,
then fetches registered PMIDs or a single unambiguous source-linked PMID. It
backs up registered DOIs with exact Crossref matches when no PubMed title is
available. It does not search by a loosely matching paper title. Locally
available GEO SOFT records also supply series titles; the snapshot preserves
metadata when those optional files are absent. Review the resulting changes. Dataset
accessions identify the data; DOI and PMID identify the source publication.
`isBasedOn` links reanalysis pages to the original repository. Wenyuan He is
identified as the application author, separately from the original researchers.
The public author details and beta wording are shared in `src/data/siteInfo.ts`.
Publication authors, journal, year and verified preprint status appear on study
pages and in the cited ScholarlyArticle schema. PubMed collective authors are
Organizations, not Persons. Dataset creator, license and download URLs are not
inferred from a paper byline or from public availability.

E-MTAB-12340 needs a deliberate exception: PMID 36221127 is a related methods and
shared-cohort reference, not a publication of this hypothalamus deposit. The
[official record](https://www.ebi.ac.uk/biostudies/api/v1/studies/E-MTAB-12340)
describes that relationship; the [pituitary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9552479/)
deposits E-MTAB-9459 and E-MTAB-9460. The snapshot retains this reviewed annotation
across refreshes, and the page and directory label it explicitly.

## Curated guides

`seoTopics.mts` defines four reviewed collections with 34 total study memberships:

- `/topics/hypothalamic-aging/`: eight age-comparison datasets.
- `/topics/hypothalamic-obesity/`: nine obesity and metabolic datasets.
- `/topics/hypothalamic-fasting-feeding/`: ten fasting and feeding datasets.
- `/topics/single-cell-hypothalamus/`: seven single-cell/single-nucleus datasets.

Membership follows the comparison actually served, rather than every condition
in a source paper. The guides distinguish age comparisons from maturation,
feeding interventions from obesity, and population tracks from animal pseudobulk.
Study pages link back to their guides. Missing or duplicate members fail generation.
`seoGuides.mts` documents source-specific methods and gives real citation examples;
it does not invent an app publication, DOI, release date or dataset license.

During the initial source check, three registry citation errors were corrected:

- GSE236077: DOI `10.1038/s41597-023-02888-4`, associated with PMID 38184639,
  replaces an unresolvable DOI; the first author is Todorov.
- GSE282067: DOI `10.1038/s41467-025-57918-z`, associated with PMID 40113758,
  replaces a DOI for an unrelated medical-imaging article.

## Verification and publishing

Run `pnpm run typecheck`, `pnpm test`, and `pnpm run build`. The focused
`seoPages.test.ts` checks registry coverage, unique metadata, sitemap URLs,
structured data, source attribution, safe HTML/JSON rendering, development routes,
sample-count semantics, and author contact details.

After publishing the built assets, confirm the homepage, `/studies/`, `/about/`,
`/topics/`, `/methods/`, `/how-to-cite/`, and a study page return their own HTML
with status 200. Unknown study or guide paths must
return 404. Check a browser with an existing service worker as well as a fresh
session. Verify the canonical host is `https://hypoexplorer.com` and that `www`
permanently redirects to it; [Workers static-asset redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)
do not support domain-level matching. Configure a Cloudflare zone Redirect Rule:
match `http.host eq "www.hypoexplorer.com"`, send status 301 to
`concat("https://hypoexplorer.com", http.request.uri.path)`, and preserve the query
string. Do not add an unconditional path redirect, which would redirect the apex
to itself. This external rule has not been applied.

Submit `https://hypoexplorer.com/sitemap.xml` in Google Search Console after
deployment, then inspect representative accession pages. Indexing and ranking
are determined by search engines and require crawling; a successful local build
does not establish search visibility. Monitor impressions for GEO accessions and
paper titles and check whether Google selects the declared canonical URLs.

The implementation follows Google's [JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
and [Dataset structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/dataset).

## Verification on 2026-09-04

- Production assets generated successfully: 145 study pages and 148 sitemap URLs.
- 54 focused tests passed across SEO output, registry, source links, homepage,
  and dataset information; the SEO suite explicitly uses the jsdom environment.
- TypeScript and targeted lint passed. The existing author-validation prebuild
  checks also passed. The application compilation was retried successfully after
  a concurrent edit temporarily left `authorVerification.ts` incomplete.
- Browser checks covered desktop and phone layouts, author/contact details,
  directory links, and study-to-explorer navigation. Eight representative studies
  were reviewed for citations, sample counts, units, and interpretation caveats.
- Local Cloudflare preview returned 200 for the public documents and 404 for
  unknown studies and paths. The bundled local runtime required a CLI-only
  compatibility-date override to 2026-05-03; production configuration was retained.
- The full-suite run during concurrent application edits was not clean: it
  observed unrelated corpus-tracking, validation-filter, and pathway smoke-test
  failures, plus worker timeouts. It also caught the SEO test file while its
  environment was being changed; the final focused rerun passed all 54 tests.

These changes have not been deployed or submitted to Search Console.

## Further optimization review on 2026-09-04

Applied the globally installed `seo-content`, `seo-page`, `seo-programmatic`,
`seo-schema`, `seo-sitemap` and `seo-technical` skills across three implementation
subagents plus independent attribution and schema reviews. The optional skill
Python runtime reports that its managed environment is missing; its Python
auditors were not run. Project tests, generated-document inspection, HTTP probes
and browser checks supplied the verification below.

- 145 study pages and 155 sitemap URLs (154 generated HTML pages plus homepage).
- 143 verified repository titles and 127 publication titles in 144 source records.
  Remaining unlinked publications are not guessed or labeled unpublished.
- All 145 search titles remain unique; median length decreased from 81 to 69
  characters. One title is 81 characters to preserve the Ins2 overexpression term.
- 66 focused tests and both TypeScript projects pass. Targeted lint has no errors.
- All 155 local preview sitemap URLs return 200; unknown studies/topics/guides
  return 404. All generated HTML has self-canonical metadata, one H1, valid
  JSON-LD and working internal links. Topic Dataset descriptions are present.
- Desktop and 390px phone previews cover topics, Methods and citation guidance,
  with visible beta notices and no horizontal page overflow.
- Production compilation and PWA generation pass in `.tmp/seo-final-production`.
  The standard build first encountered a transient stale validation record during
  concurrent work; the final authoritative generation check passes with zero
  scientific differences and no regenerated evidence files. A shared `dist`
  cleanup collision was avoided by using the isolated output directory. All
  author-validation prebuild stages pass, and rebuilding the tracker leaves its
  content unchanged. The existing large app-bundle warning remains; static SEO
  documents require no application JavaScript.
- Live read-only checks: apex and www return 200, `/studies/` and `/sitemap.xml`
  return 404, and robots.txt returns 200. Deployment and the www redirect are
  still needed. No Search Console connector was available to submit a sitemap
  or inspect indexing; no ranking, traffic or Core Web Vitals score is inferred.

## Copy review on 2026-09-04

Installed [Humanizer](https://github.com/blader/humanizer) and
[Unslop](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop)
globally in the maintainer's Codex skills directory and applied both to the public
study pages, research topics, Methods, citation guidance, About page and homepage
introduction, as well as the in-app methodology text. Three subagents edited
separate sections; an independent review compared the combined edits with the
saved originals. The edits shorten dense sentences and remove vague phrasing
while retaining scientific terminology, source attribution, uncertainty and
study-specific limitations.

- All 66 focused tests, both TypeScript projects and targeted lint pass.
- Production compilation and PWA generation pass in
  `.tmp/seo-humanized-production`. The existing large-bundle warning remains.
- A before-and-after check of all 154 generated HTML documents confirms unchanged
  search titles, canonical URLs, robots directives, link targets, data tables
  and numeric details in the edited copy. Structured data remains unchanged
  apart from the corresponding topic-description wording.
- Source metadata, author identity, editorial identifiers, evidence paths and
  verification-rendering code are unchanged. Concurrent validation work updated
  the evidence notes for GSE156859 and GSE190389; those notes retain their
  evidence-driven wording and were excluded from the prose-number comparison.
- All 155 sitemap URLs return 200 in the local production preview. The revised
  About page was checked in the browser, including the beta notice, author
  credential and public email address.

This copy review has not been deployed. Original copy and the comparison report
are retained locally in `.tmp/seo-copy-before` and
`.tmp/seo-humanized-audit.json`.

## Full SEO audit on 2026-09-13

The current audit is in
the maintainer's retained audit report (not part of the public repository),
with crawl evidence, performance observations, specialist findings and a
prioritized action plan. It supersedes the historical live-status/count
observations above: all **171 canonical sitemap URLs**, including **161 study
pages**, now return 200 in the live crawl. They have unique titles/descriptions,
self-canonicals, and are reachable within two internal document links.

Repository changes add social previews, local licensed IBM Plex fonts, clearer
gene-search/export guidance, topic navigation/bylines/cross-links, Dataset
canonical identities, a missing-DOI citation guard and homepage text contrast.
Scientific data and source identities are unchanged. The SEO suite remains
repository-local under `.agents/skills/` and is used only when relevant.

The public mobile Lighthouse baseline was performance 73 with 4.5-second LCP;
desktop was 98 with 0.9-second LCP. No CrUX field data was available. Local font
assets remove the external Google Fonts dependency; a post-release performance
gain has not yet been measured.

The local changes passed 93 focused tests, both TypeScript projects, targeted
lint, production Vite/PWA compilation and generated document/link verification.
The full scientific prebuild pipeline was not rerun for these website changes.

**Not yet released:** these improvements and the edge redirects. HTTP apex
still serves without an HTTPS redirect, and HTTPS www still serves a stale
Hostinger copy without a canonical. Consolidate them directly to HTTPS apex,
preserving path/query, using host-level configuration.

For maintenance, refresh `public/social-preview.jpg` with a real 1200×630 JPEG
homepage capture when the interface changes. Keep the MIME and dimensions in
both head templates in sync. Font source URLs, hashes, coverage and the OFL
license are in `public/fonts/`; use new font filenames when their bytes change.
The maintainer checks a build against this retained baseline with the audit's
`verify-production.mjs`. Its
171-page count assertion intentionally describes this audit's corpus; update
it after a verified dataset intake changes the sitemap.
