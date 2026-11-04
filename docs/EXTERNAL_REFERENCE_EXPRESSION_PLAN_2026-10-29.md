# External reference expression: implementation plan (2026-10-29)

Status: proposal. Phase 0 measurements are done (see
[Phase 0 results](#phase-0-results)); no browser product is built.

This plan covers adding public reference expression from GTEx, the Human Protein
Atlas (HPA) and the Allen Institute (mouse ISH, human microarray and the Allen
Brain Cell (ABC) Atlas) to the expression survey (`#/expression`) and to the gene
portal on the search page. It does not touch the differential-expression registry,
the Explorer tabs or any track bundle.

## Decision: snapshot, not live API

All three providers send `Access-Control-Allow-Origin: *`, so a browser on
hypoexplorer.com could call GTEx and HPA directly. We will not do that.

- The survey only says "verified" when every value matches a retained source
  (see [the survey runbook](EXPRESSION_SURVEY.md)). Live responses cannot be
  archived, hashed or replayed by a `--check` mode.
- Third-party uptime becomes ours. On 2026-10-29 the Allen human microarray
  service returned `"Informatics service request failed"` for every query, and the
  Allen forum shows the same failure in Dec 2024 and Jun 2026.
- HPA sends `Cache-Control: no-store`, so live use re-downloads on every view.
- GTEx v10 needs the versioned GENCODE v39 ID; an unversioned ID returns
  `"data": []` with HTTP 200. A live client would need a second lookup per gene and
  could not tell "absent" from "wrong ID".

Each source therefore gets an offline builder that follows the NeuroSeq and OXT
reference pattern: retained source bytes with SHA-256, a deterministic build, a
`--check` mode that compares every emitted value with the source, and lazy
per-gene shards in the browser.

## Probe results (2026-10-29)

Requests sent with `Origin: https://hypoexplorer.com`. "Verified" means observed in
a response; "docs" means read in provider documentation only.

| Source | Hypothalamus coverage | Bulk input | Unit | License |
| --- | --- | --- | --- | --- |
| GTEx v10 | Brain_Hypothalamus, 257 samples (verified) | Hypothalamus per-sample TPM gct.gz, 33.3 MB (verified) | TPM | Open-access tier; cite and acknowledge GTEx (docs) |
| HPA 25.1 | Human hypothalamus region nTPM; mouse and pig hypothalamus; single-nucleus clusters (verified) | `rna_brain_region_hpa.tsv.zip` 2.45 MB; `rna_brain_hpa.tsv.zip` 33.1 MB; `rna_single_nuclei_cluster_type` 3.7 MB (verified) | nTPM | CC BY 4.0; cite HPA and link v25.proteinatlas.org (docs) |
| Allen mouse ISH | 91 structures under HY (structure 1097) (verified) | RMA `StructureUnionize` per SectionDataSet, ~1 s per query; grid downloads (verified) | Expression energy (unitless) | Allen terms: noncommercial, citation policy (docs) |
| Allen human microarray | 92 hypothalamic structures in ontology graph 10 (verified) | Six donor zips, ~425 MB each (verified for donor 9861) | log2 normalized intensity, per probe | Allen terms (docs) |
| ABC Atlas | Mouse WMB HY: 10Xv3 7.25 GB, 10Xv2 2.91 GB; cluster stats h5 1.38 GB; human WHB neurons 32.8 GB (verified) | Static h5ad/h5 only; no query API (verified) | log2 CPM (cluster mean) | Allen terms (docs) |

The initial probe responses were not retained. Phase 0 reran the load-bearing
requests and retained them under
[`data/expression/external-reference/phase0-2026-10-29/`](../data/expression/external-reference/phase0-2026-10-29/README.md).
Where the two disagree, the Phase 0 figures below supersede this table.

## Phase 0 results

Measured 2026-10-29. Every input's URL, byte count and SHA-256 is in the retained
measurement files.

| Source | Measured | Data shape | Product estimate |
| --- | --- | --- | --- |
| GTEx v10 hypothalamus | 59,033 genes × 257 samples from 257 donors (193 male, 64 female; 131 aged 60–69). Up to six decimals in the source | Per sample | 101.5 MB JSON, 33.8 MB gzip; 256 shards of up to 466 KB |
| HPA human, 8 hypothalamic subregions | 20,162 genes × arcuate, dorsomedial, lateral hypothalamic area, mammillary body, paraventricular, preoptic, supraoptic, ventromedial | One summary value per subregion (TPM, pTPM, nTPM) | 11.3 MB JSON, 1.6 MB gzip |
| HPA human hypothalamus region | 20,162 genes, one consensus row each | Summary | 1.3 MB JSON, 0.27 MB gzip |
| HPA mouse hypothalamus | 22,246 genes × 4 animals (F 1, F 2, M 1, M 2) | Per animal | 7.8 MB JSON, 1.1 MB gzip |
| HPA pig hypothalamus | 22,063 genes × 4 animals (F 1, F 2, M 1, M 2) | Per animal | 7.7 MB JSON, 1.3 MB gzip |
| HPA human single-nucleus hypothalamus | 19,580 genes × 26 clusters from 134,430 nuclei; HPA credits Siletti et al. as the source | Cluster summary (read count, nCPM) | 43.7 MB JSON, 3.9 MB gzip |
| Allen human microarray | 102 hypothalamic samples across six donors (9 to 22 each); 58,784 probes covering 29,180 Allen gene IDs. Donor zips total 1.68 GB | Per sample (well), per probe | Inferred about 50 MB JSON for hypothalamic wells × all probes |
| Allen mouse ISH | 22,152 expression datasets (3,318 coronal for 3,190 genes; 18,834 sagittal for 17,547 genes); 91 HY structures | Per dataset (one animal), per structure | Crawl about 1 h in batches of 50 (about 461 MB of raw responses); product size to measure after the crawl |
| ABC mouse WMB | 5,322 clusters; 773 in HY classes (strict) or 1,404 with the CNU-HYa classes; stats h5 1.38 GB | Cluster summary | Not measured: needs h5py |
| ABC human WHB (Siletti) | No cluster × gene summary under 2 GB. The stats h5 is 8.7 GB and hypothalamic dissections are tagged only per cell | Cluster summary | Not measured |

What this changes:

- **HPA is richer than planned.** Mouse and pig have per-animal hypothalamus data,
  so they fit the existing per-sample contract. Human data covers eight named
  hypothalamic nuclei. These are summaries, so decision 3 still applies.
- **The human single-cell slot does not need the 32.8 GB WHB file.** HPA's
  single-nucleus table is a cluster summary of the same Siletti hypothalamic
  dissections, at 3.9 MB gzip. Its 26 clusters use HPA's whole-brain cluster-type
  labels, some of them cortical ("deep-layer intratelencephalic"). The survey must
  show those labels as HPA states them and must not present them as hypothalamic
  cell types. Confirm the Siletti data terms before shipping.
- **GTEx needs smaller shards.** At 256 shards one gene costs a 466 KB download
  (about 150 KB gzip). Use 1,024 or 2,048 shards to get under about 40 KB gzip per
  request.
- **Allen human microarray is smaller than estimated.** The donor zips total
  1.68 GB, not 2.5 GB. The hypothalamic sample lists are already retained.
- **ABC mouse has no cluster-level region field.** Choosing HY clusters means using
  the taxonomy class (the strict or broad set above), or the per-cell
  `region_of_interest` in a 1.0 GB cell metadata CSV. Record which.

## Decisions

All four were resolved on 2026-10-29. Decisions 2–4 follow the recommendations
below, which the project owner accepted.

1. **Allen licensing. Resolved 2026-10-29:** the project owner confirmed that
   HypoExplorer is noncommercial. Allen's terms permit noncommercial display and
   derived works and require written permission for commercial redistribution.
   Each Allen source README under `data/expression/` restates this basis and the
   Allen citation policy. A move to commercial use reopens this decision before any
   Allen-derived values may stay published.
2. **Bulk tissue scope. Resolved 2026-10-29:** the tracker's `GTEx-v11` rejection
   (2026-08-31, non-bulk RNA-seq only) governs differential-expression intake. A
   reference panel in the survey's **Tissue & bulk** section is outside it. The
   `GTEx-v11` review in `src/data/tracker/reviews.json` keeps its status and now
   carries a note saying so.
3. **Summary-only sources. Resolved 2026-10-29: option (a).** `ExpressionSource` and `ExpressionGroupResult` assume
   per-sample values with an arithmetic group mean. HPA region nTPM and ABC cluster
   means are already summaries with no sample rows. Choose one:
   - (a) add `valueKind: 'samples' | 'summary'` to `ExpressionSource` plus a
     `summary` field (statistic name, n, value) on the group result, shown without a
     recomputed mean; or
   - (b) ship only per-sample sources (GTEx, Allen microarray, Allen ISH) and leave
     HPA and ABC as outbound links.
   Recommendation: (a). Storing a consensus value as one fake sample would misreport
   n and break the survey's "profiles, not animals" wording.
4. **Species in one view. Resolved 2026-10-29: allow, label, never merge.** GTEx, HPA human and Allen human are human; Allen ISH and
   ABC are mouse. The survey already shows sources side by side on their own scales.
   Gene lookup must not map orthologs silently: a mouse query of `Pomc` may match
   human `POMC` by the existing case-insensitive fallback in `resolveNeuroseqGenes`.
   Decide whether that fallback is allowed across species. Recommendation: allow it,
   label the matched species and symbol on every result row, and never merge rows.

## Contract changes (shared by every phase)

- `src/types/index.ts`: extend `ExpressionSource.collection` with `'external'`, or
  add one value per provider if per-provider filtering in the collection picker is
  wanted. Add `valueKind` if decision 3 is (a). Add `license` and `release` fields so
  attribution is data, not copy.
- `src/expression-survey/expressionData.ts`: route the new collection to a reader.
  Generalize `referenceJson` (which only accepts `/expression/oxt-reference/...`
  paths) into one guarded reader keyed by an allowlisted source root, so each new
  source does not copy the reader.
- `ExpressionSurveyView.tsx`: source cards and the Sources & validation section show
  the provider, release, license and required citation. The caption that says
  HypoMap and the Allen atlas "are not included in this module" changes when ABC
  data ships.
- `src/search/SearchPage.tsx`: the `single-cell-mouse` and `single-cell-human`
  placeholder slots read ABC and HPA single-nucleus summaries once they exist. A
  tissue-baseline card for GTEx/HPA can sit beside `BaselineSection`. Keep the
  portal cheap: one gene-index request plus one shard per source.
- Every builder writes `validation.json`, and the UI refuses to say "verified" unless
  the report shows exact agreement, as `loadExpressionValidation` already does for
  NeuroSeq.

## Delivery

| Product | Measured size (Phase 0) | Location |
| --- | --- | --- |
| HPA, all four sources (built) | 21 MB on disk in 1,024 value and 1,024 lookup files | Same-origin generated artifact `public/expression/hpa/` (Phase 1 outcome) |
| GTEx hypothalamus, 257 samples per gene (built) | 99 MB on disk in 2,048 value and 1,024 lookup files | Same-origin generated artifact `public/expression/gtex/` (Phase 1 outcome; this plan first proposed R2) |
| Allen human microarray hypothalamic wells (built) | 114 MB on disk in 2,048 value and 1,024 lookup files (Phase 0 inferred about 50 MB) | Same-origin generated artifact `public/expression/allen-human/` (Phase 2 outcome; this plan first proposed R2) |
| Allen mouse ISH HY structures | Measure after the crawl | Decided by measured size |
| ABC cluster means for HY clusters | Not measured | Decided by measured size |

Rule: products over ~20 MB of JSON, or with per-gene payloads large enough to matter
on mobile, go to R2 with an immutable build ID. Smaller ones ship with the app. Source
archives over a few MB go through Git LFS, which the repository already uses. Multi-GB
inputs (Allen donor zips, ABC h5ad/h5) are not committed: retain URL, byte count and
SHA-256 in `source-manifest.json`, and commit only the extracted hypothalamic subset
that `--check` replays.

## Phases

### Phase 0: decisions and measurement (no product code)

- Decision 1 is resolved. Decisions 2–4 still need confirmation.
- Done 2026-10-29: probes rerun and retained, sizes and sample counts recorded (see
  [Phase 0 results](#phase-0-results)).
- Still open: Allen mouse ISH product size (needs the crawl) and ABC cluster means
  (needs h5py). Both belong to their own phases.

### Phase 1: GTEx and HPA

**Built 2026-10-29** (not yet deployed). Five sources ship: GTEx hypothalamus, and
HPA human subregions, human snRNA clusters, and mouse and pig hypothalamus. The
build differs from the plan below in four ways:

- **Delivery is same-origin, not R2.** Products live under
  `public/expression/{gtex,hpa}/` as gitignored build artifacts written by
  `pnpm run build:expression-external` (run by `prebuild` and the CI artifact
  step). Workers static assets serve them without R2 read charges, and 1,024
  lookup files plus 1,024–2,048 value files fit the asset file-count limit. The
  repository keeps only the retained sources: the GTEx GCT under Git LFS and
  hypothalamic extracts for the rest.
- **No full gene index.** Key-sharded lookups replace the 4 MB `gene-index.json`
  that NeuroSeq and OXT ship. A gene costs one lookup and one value request.
- **HPA's region source is dropped.** For every gene, its "hypothalamus" region
  value is the maximum of the eight subregion values. The build verifies this.
- **Independent API checks.** Each builder retains provider API responses for four
  checkpoint genes and requires agreement: the GTEx median, and HPA's hypothalamus
  nTPM.

The gene page's human single-cell slot now shows the HPA snRNA clusters (Phase 2
outcome). The mouse slot is still a placeholder.

- `scripts/build_gtex_reference.mts` (TypeScript, like `build_oxt_reference.mts`):
  - Input: v10 Brain_Hypothalamus per-sample TPM gct.gz and the open-access sample
    and subject attribute files (sex, age decade, Hardy scale).
  - Keep the GENCODE ID as the stable feature ID, with the symbol as display. Keep
    symbol collisions as separate features. Do not collapse versions or round TPM.
  - Default grouping: all donors. Sex and age decade go in sample metadata, not in
    synthetic conditions.
  - `--fetch` restores pinned bytes; `--check` replays every value.
- `scripts/build_hpa_reference.mts`: HPA 25.1 files `rna_brain_hpa` (eight human
  hypothalamic subregions), `rna_brain_region_hpa` (consensus),
  `rna_mouse_brain_sample_hpa` and `rna_pig_brain_sample_hpa` (four animals each),
  and `rna_single_nuclei_brain_cluster` (26 hypothalamic clusters). Record the HPA
  version in every product. Keep TPM, pTPM and nTPM as stored; show nTPM by default
  and say which one is shown. Third-party columns inside HPA files
  (for example `rna_brain_gtex`) keep their own license and are excluded in favour
  of the primary GTEx import.
- `package.json`: `build:`/`check:` scripts for each source. Add the checks to
  `prebuild` only after they pass from a clean clone (see the author-validation
  clean-clone notes before doing this).
- Tests: adapter tests on a small committed fixture; a route test for the new
  collection; a test that a mouse-symbol query against a human source labels the
  species.
- Docs: a GTEx/HPA section in `EXPRESSION_SURVEY.md`, runbooks in
  `data/expression/gtex/README.md` and `data/expression/hpa/README.md`, and the
  acknowledgements view (`src/acknowledgements/`) with the required citations.
- Exit: survey shows GTEx per-sample hypothalamus TPM and HPA region nTPM for any
  gene, both checks pass, and browser checks cover desktop and 390 px.

### Phase 2: Allen human microarray

**Built 2026-10-29** (not yet deployed). One source ships:
`allen-human-hypothalamus-microarray`, with 58,692 probes × 102 tissue samples from
six donors (9, 22, 17, 20, 16 and 18 samples, as Phase 0 counted). The build
replays all 5,986,584 values exactly. For every donor, the hypothalamic structure
list in the zip equals the Allen API's. Outcomes against the plan below:

- **Delivery is same-origin.** The products are 114 MB in 3,074 files under
  `public/expression/allen-human/`, more than twice the Phase 0 inference. The
  three providers now total about 230 MB in 8,198 files, which fits the Workers
  asset limits. The retained extracts are 47 MB, with the expression extracts
  under Git LFS.
- **The zips are read in memory, the large member line by line.**
  `MicroarrayExpression.csv` is up to 966 MB uncompressed, beyond V8's string
  limit, so the builder scans it as bytes. `--fetch --from <dir>` accepts zips
  fetched separately, since the Allen server throttles single-stream downloads.
- **API checkpoints are pinned.** A `--fetch` without `--record` now compares the
  fresh API answer with the retained one, ignoring its retrieval time, instead of
  rewriting it. This also fixes the GTEx and HPA builders, where a plain
  `--fetch` would have broken the next offline build's hash check.
- **Gene page.** The gene page shows the reference atlases. The human single-cell
  card shows HPA's snRNA clusters. A "Human hypothalamus" card shows GTEx median
  TPM, the top HPA subregions, and each Allen probe's median and range of donor
  means.

Decisions, resolved 2026-10-29 (the project owner accepted the recommendations):

- **Probes:** one result row per probe, labelled with its probe name. A gene query
  returns every probe of that gene, and a probe-name query returns that probe.
  Sources mark this with `featureLevel: 'probe'`, and their results are never
  reported as ambiguous because a gene has several probes.
- **Grouping:** one condition per donor (6 groups of 9–22 tissue samples). Each
  sample keeps its structure, hemisphere and MNI coordinates, so n counts tissue
  samples within one donor, never people.
- **Delivery:** measured after the build; same-origin generated artifacts, as in
  Phase 1, unless the size rules that out.

- Builder downloads the six donor zips offline (1.68 GB total, not committed). The
  102 hypothalamic samples to keep are already listed in the Phase 0 evidence.
- Keep wells whose structure descends from the hypothalamus in ontology graph 10,
  with donor, hemisphere, structure and MNI coordinates as sample metadata. Samples
  are wells, not donors; say so in `replicateUnit`.
- Probes: keep each probe as its own feature under the gene, with probe ID shown.
  Any probe-selection rule (for example abagen-style) is a separate, disclosed
  derived product, never a silent collapse.
- Do not depend on `service::human_microarray_expression`.
- Exit: per-probe values for hypothalamic wells, replayed exactly against the donor
  CSVs.

### Phase 3: Allen mouse ISH

- Crawl `StructureUnionize` for every SectionDataSet, restricted to structures under
  HY 1097, with responses archived and hashed. At ~1 s per query this is an
  overnight job; make it resumable.
- Keep sagittal and coronal datasets separate, with plane and dataset ID shown.
  Coronal datasets cover far fewer genes but are the better hypothalamic reference.
- Fields: expression energy, expression density and sum, as published. No
  re-normalization.
- Exit: per-structure ISH values for HY substructures with an exact replay check.

### Phase 4: ABC Atlas

- Mouse first: cluster-level means from the precomputed stats h5 (1.38 GB), limited
  to clusters annotated to HY, with taxonomy labels from the matching release
  manifest (latest seen: `releases/20261031`).
- Requires `h5py` in a local, project-scoped Python environment. Check with the
  install-tools rules before adding it.
- Human (Siletti whole human brain): Phase 1's HPA single-nucleus table already
  gives a hypothalamic cluster summary from the same source. Native WHB summaries
  (8.7 GB stats h5, per-cell dissection labels) are deferred until that table proves
  too coarse.
- These fill the search page's single-cell placeholder slots.
- Exit: cluster-mean summaries per gene for HY clusters, shown as summaries
  (decision 3), with taxonomy release pinned.

## Context maintenance

Each phase changes source under `src/`, `scripts/`, `data/` and `docs/`, so each
PR runs the [maintenance procedure](agent-context/README.md): `context:review`,
`context:generate`, per-area review records, `context:check` and `test:context`.
Expected areas: `expression-survey`, `search`, `types`, `acknowledgements`.

## Not in scope

- Live third-party API calls from the browser.
- Cross-source normalization, orthology-based merging, or any differential
  expression derived from these references.
- Registering any reference as a dataset in `src/data/datasets.ts`.
