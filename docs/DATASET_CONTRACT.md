# Dataset contract

The source of truth for adding a dataset to HypoExplorer. The explorer is
multi-dataset and multi-modality: each dataset is described by a **manifest** in
`src/data/datasets.ts` and backed by data **bundles** under
`public/datasets/<id>/`. This file documents both shapes and the data-layer API
that consumes them.

## Terminology

- **Dataset** — one study/modality (e.g. macaque snRNA, mouse bulk HFD, miRNA array).
- **Track** — the unit a user selects *within* a dataset. Single-cell = a cell
  population (`e9`, `Ast1`); bulk/miRNA whole-tissue = a single track (e.g.
  `whole`) or a few regions.
- **Group** — an experimental arm `{ key, label, color }` (Normal, Obese, HFD, chow…).
  A dataset may declare **N groups** (e.g. fed / fast24 / refed; the four estrous
  stages; a ZT/CT timecourse).
- **Contrast** — a baseline→case comparison referencing two group keys, carrying a
  DE table (and, when supported, a pathway table). A dataset may declare **multiple
  contrasts** (e.g. `fast24_vs_fed`, `refed_vs_fed`); when it does, the explorer
  renders a **contrast selector** and the user picks which precomputed comparison to
  view. DE is always **precomputed upstream** — selecting a contrast switches which
  baked table is shown, it does not compute DE live.
- **Feature** — the row entity: a gene (default) or a miRNA. Stored under the
  `gene` key in `de`; `featureType`/`featureLabel` drive the UI label.

## Manifest (`src/data/datasets.ts`, a bundled ES module)

Entries are authored through `defineDataset({...})`, which derives the seven
bundle-locator fields from `id` (all can still be overridden per entry, e.g.
`bundleBaseUrl: ''`):

```
bundleBaseUrl      = BUNDLE_BASE (src/data/bundleBase.ts)
metaFile           = /datasets/<id>/meta.js
metaGlobalKey      = HX_<ID>_META            // <ID> = id.toUpperCase()
qcFile             = /datasets/<id>/qc_global.js
qcGlobalKey        = HX_<ID>_QC
bundleFileTemplate = /datasets/<id>/track_{trackId}.js
globalKeyTemplate  = HX_<ID>_{TRACKID}       // {TRACKID} = trackId.toUpperCase()
```

```js
defineDataset({
  id: 'macaque_snrna',                 // unique slug; namespaces tracks + globals
  category: 'Primate atlas',           // REQUIRED; one of DATASET_CATEGORIES
                                       //   (selector groups, hub chips, report
                                       //   sections, meta-analysis strata)
  name: 'Macaque hypothalamus (snRNA-seq)',
  organism: 'Macaca fascicularis',
  modality: 'snRNA-seq',
  featureType: 'gene',                 // 'gene' | 'mirna'
  featureLabel: 'Gene',                // UI label for the feature column
  expressionUnit: 'CPM',               // axis/export unit label (e.g. 'CPM' | 'CPM (TMM-normalized)' | 'log2-normalized')
  supportsPathways: true,              // false → Pathway tab hidden, allPathways = []
  citation: 'Lei et al., Cell Metab 2024',
  doi: '10.1016/j.cmet.2024.01.003',
  geo: '',                             // optional GEO/SRA accession (e.g. 'GSE220533')
  isDefault: true,                     // exactly one dataset; eager-loaded at startup
  defaultTrack: 'e9',
  defaultCompareTracks: ['e9', 'i23'],  // optional; Compare view's initial pair (>=2-track datasets)
  trackNoun: 'population',               // optional, default 'population'; UI noun for a track
                                         //   (QC prose/columns). 'population' for single-cell,
                                         //   'track' for bulk tissue/region.
  trackCategoryOrder: ['Glutamatergic','GABAergic','Histaminergic','Oxytocin','Non-neuronal'],
  groups: [ { key:'normal', label:'Normal', color:'#3775BA' },
            { key:'obese',  label:'Obese',  color:'#B64342' } ],
  contrasts: [ { id:'obese_vs_normal', baseline:'normal', case:'obese', isDefault:true } ],
})
```

### Multiple contrasts (N-group designs)

A dataset whose biology isn't a single binary comparison declares N `groups` and a
list of `contrasts`. Each contrast is still a **pairwise** baseline→case (the unit
edgeR/limma emits); a multi-level design is expressed as several pairwise contrasts
against a shared baseline. The optional `label` names it in the selector (else a
`"<case> vs <baseline>"` default is derived); `isDefault:true` marks the one shown
first.

```js
groups: [ { key:'fed',    label:'Fed',        color:'#3775BA' },
          { key:'fast24', label:'Fasted 24h', color:'#B64342' },
          { key:'refed',  label:'Refed',      color:'#59A14F' } ],
contrasts: [
  { id:'fast24_vs_fed', baseline:'fed', case:'fast24', isDefault:true, label:'Fasted 24h vs Fed' },
  { id:'refed_vs_fed',  baseline:'fed', case:'refed',                  label:'Refed vs Fed' },
],
```

Two optional flags carry design intent the arm names cannot:

- `exploratory: true` marks a comparison that must be read as exploratory, for one
  of two reasons: the SOURCE STUDY never ran it (a re-analysis whose meaning does
  not follow from its arm names), or the re-fit cannot support gene-level
  significance. GSE87544 is the second case: `~ batch + group` on seven units
  leaves one residual degree of freedom, so only effect sizes and pathway ranks
  are presented. `description` must say which reason applies. The flag drives the
  "exploratory contrast" badge beside the volcano. Deliberately NOT inferred from
  `description` being present: a description also annotates a faithful re-fit of
  the paper's own axis, which must not be branded exploratory. A study built with
  `defineBulkStudy` sets both through `contrastNote: { exploratory, description }`
  on its single default contrast.
- `group: '<label>'` buckets the selector. Contrasts sharing a `group` render under
  one `<optgroup>` (and one spanning band in the across-comparisons matrix), so a
  factorial design's axes are visible in the selector itself; ungrouped contrasts
  render flat. Only ADJACENT contrasts sharing a value merge, so manifest order is
  the grouping order.

The selector appears only when `contrasts.length > 1`; single-contrast datasets are
unchanged. Switching a contrast keeps the active track and selected genes (gene names
are contrast-independent) and re-reads the bundle's per-contrast DE/pathway tables.

## Per-dataset metadata (`<id>/meta.js`)

Assigns `window[metaGlobalKey]` = the track registry for the dataset (the legacy
`POP_META` shape, scoped to one dataset):

```js
HX_MACAQUE_SNRNA_META = {
  populations: [ ...trackIds ],
  labels:  { trackId -> string },
  types:   { trackId -> category },          // ordered by trackCategoryOrder in the sidebar
  nGenes:  { trackId -> int },
  colors:  { trackId -> hex },
  qcFlags: { trackId -> { is3v3, nNormal, nObese, minCells, status, elapsedSec } },
  qaReportFilenames: { trackId -> pdf },
  // Factorial designs ONLY (optional). Replicate count per GROUP key, for arms the
  // legacy nNormal/nObese pair cannot describe (a design cell like chow_p0). Read by
  // the hero pills and the dataset info panel as a pre-bundle fallback; once the track
  // loads, groupSamples ∩ samplesKept outranks it.
  //
  // ALSO the only source the BROWSE surfaces have for a factorial default. The
  // library card, the study record and the query index headline the DEFAULT
  // CONTRAST's two arms, whose labels come from that contrast — and qcFlags holds
  // only the pooled control/case pair, so on a factorial default it names different
  // groups than the labels do. `defaultArmCounts` (src/data/contrasts.ts) resolves
  // the contrast, reads groupN, and falls back to the pooled pair; a bundle omitting
  // groupN therefore degrades to the pooled numbers rather than to blanks.
  groupN: { groupKey -> int },
}
```

## Per-track bundle (`<id>/track_<trackId>.js`)

Assigns `window[globalKey]` (e.g. `HX_MACAQUE_SNRNA_E9`):

```js
HX_MACAQUE_SNRNA_E9 = {
  meta: {
    code, label, type, nGenes,
    sampleNames: [...],                       // legacy; canonical sample order
    sampleOrder: [...sampleIds],              // value arrays in `cpm` align to this order
    groupSamples: { normal:[ids], obese:[ids] },  // per-group sample membership (per-track)
  },
  qc: { ... },                                // track-level QC
  de: [ { gene, logFC, logCPM, PValue, FDR, se, rank_score, rankPos }, ... ],   // DEFAULT contrast's table
  //   `se` = per-gene logFC standard error (log2 scale): limma |logFC|/|t|, or for
  //   edgeR-QL the QL-adjusted Wald SE from a refit of the same model (<stem>_SE.tsv).
  //   Never derived from the QL F (see src/utils/seRecovery.ts). Optional — absent on
  //   bundles built before v0.7.0.0 and null where no SE exists (the macaque atlas).
  //   Powers the Layer-2 random-effects pooling.
  cpm: { <feature>: [ ...numbers ] },         // positionally aligned to meta.sampleOrder; null = dropped sample
  //   Values are in `expressionUnit`. For count data they are TMM-normalized CPM computed
  //   with the DE fit's own TMM factors (<stem>_CPM_TMM.tsv.gz, macaque normcpm.csv);
  //   matrix data keep the deposited unit. See docs/REAL_DATA_SHAPES.md.
  pathways: { GO_BP:[], HALLMARK:[], KEGG:[], REACTOME:[] } | null,   // null/omitted when !supportsPathways
  // Multi-contrast bundles ONLY (optional). Per-contrast tables keyed by Contrast.id;
  // buildPopData prefers these for the active contrast and falls back to de/pathways.
  // Single-contrast bundles omit both fields entirely.
  deByContrast:       { <contrastId>: [ ...GeneDERecord ] },
  pathwaysByContrast: { <contrastId>: { GO_BP:[], HALLMARK:[], KEGG:[], REACTOME:[] } },
}
```

**Multi-contrast bundles:** carry `de`/`pathways` for the **default** contrast (so
single-contrast consumers and the cross-dataset report keep working unchanged) AND
`deByContrast`/`pathwaysByContrast` with an entry per **non-default** contrast.
The default contrast lives in `de`/`pathways` and is deliberately NOT repeated
inside `deByContrast` — `buildPopData` selects the active contrast's table and
falls back to `de`/`pathways`, and on the default contrast that fallback is the
format working as designed, not a stale bundle. (Read
`src/data/buildPopData.ts` before writing any validator against this section:
an "an entry per declared contrast id" rule would reject the shipped GSE135639
bundle, and the stale-bundle warning exempts the default contrast for exactly
this reason.)

**Key design point:** `cpm` value arrays stay positionally aligned to
`meta.sampleOrder` (NOT re-shaped into group-keyed arrays). Group membership lives
in `meta.groupSamples`. The single seam `getGroupedValues()` maps
`group → sampleId → index in sampleOrder → cpm value`, dropping nulls. Nothing
downstream assumes 6 samples or a positional 3+3 split, so 2v3 / 5v5 / N-sample
designs work without code changes.

## Pathway sibling bundle (`<id>/track_<trackId>.pathways.js`)

Enrichment ships in a SIBLING file, not in the track bundle: it is only needed when
the Pathway Explorer opens, so keeping it out of `track_<id>.js` keeps it off the
first-paint path. The file sets `HX_<NAMESPACE>_<TRACKID>_PATH` and has two shapes:

```js
// Legacy / single-contrast: the plain block.
HX_MOUSE_BULK_HFD_WHOLE_PATH = { GO_BP:[], HALLMARK:[], KEGG:[], REACTOME:[] };

// Multi-contrast: the wrapper. `default` is the default contrast's block (what every
// legacy consumer wants); `byContrast` carries the NON-default contrasts, keyed by
// Contrast.id. Same split as the track bundle's `de` vs `deByContrast`.
HX_MOUSE_POMC_MATERNAL_HFD_GSE135639_POMC_PATH = {
  default:    { GO_BP:[], HALLMARK:[], KEGG:[], REACTOME:[] },
  byContrast: { '<contrastId>': { GO_BP:[], HALLMARK:[], KEGG:[], REACTOME:[] } },
};
```

Consumers MUST unwrap through `src/data/rawTrack.ts` rather than sniffing
`'byContrast' in v` inline. Track hydration and the eager store seed use the
permissive accessors (`siblingDefaultPathways()` / `siblingPathwaysByContrast()`);
the cross-dataset pathway query (`crossDataset.findPathway`) and
`scripts/build_query_index.mts` resolve through `strictSiblingPathwaysFor()`,
which enforces the strict default-witness rule — a non-default contrast must be
explicit in `byContrast`, only the registered default may fall back to `default`
— and reports HOW it resolved (`explicit` / `legacy-default` / `refused`) so the
index can audit unverifiable attributions. Hand-spelling the shape at call sites
is how a format change breaks three of them silently.

`pathways_index.js` (`HX_<NAMESPACE>_PATHIDX`) is the sorted union of pathway names
across EVERY block, so autocomplete reaches a pathway that appears only in a
non-default contrast.

## Data-layer API

`src/data/datasets.ts`
- `listDatasets()` → DATASETS
- `getDataset(id)` → manifest | null
- `getDefaultDataset()` → the `isDefault` manifest (else `DATASETS[0]`)
- `getActiveContrast(dataset, contrastId?)` → `{ id, baseline:{key,label,color}, caseGroup:{key,label,color}, supportsPathways, label }` (resolves by `contrastId`, else the `isDefault` contrast, else the first; group keys resolved to full objects; the case-group field is `caseGroup`, never `case`; `label` is the authored `Contrast.label` or a derived `"<case> vs <baseline>"`)
- `listContrasts(dataset)` → `ResolvedContrast[]` — every declared contrast resolved (skips self-comparisons); drives the contrast selector
- `resolveTrackUrl(dataset, trackId)` → `bundleBaseUrl + bundleFileTemplate` with `{trackId}` replaced
- `resolveTrackGlobalKey(dataset, trackId)` → `globalKeyTemplate` with `{TRACKID}` → `trackId.toUpperCase()`

`src/data/loadTrack.js`
- `loadTrack(dataset, trackId)` → `Promise<rawTrack>` — cache key `dataset.id + '::' + trackId` (collision-free across datasets); seeds from an eager-set global without re-injecting; in-flight dedup; rejects on missing global / load error
- `_resetTrackCache()`

`src/data/loadDatasetMeta.js`
- `loadDatasetMeta(dataset)` → `Promise<metaObj>` (seed from `metaGlobalKey` else inject `metaFile`; cached by dataset id)
- `loadDatasetQC(dataset)` → `Promise<qcObj>` (seed from `qcGlobalKey` else inject `qcFile`; cached by dataset id)
- `_resetDatasetMetaCache()`

`src/data/buildPopData.js`
- `buildPopData(rawTrack, dataset, contrast)` → `{ de, deByGene, geneNames, cpm, qc, volcanoPts, allPathways, meta, contrast, groups, groupSamples, sampleOrder }`. `dataset` and `contrast` are REQUIRED — they used to default to the macaque dataset, which is how the Compare tab came to render one contrast's numbers under another's labels. Selects the active contrast's `deByContrast`/`pathwaysByContrast` table when present, else falls back to `de`/`pathways`. `allPathways = []` when `!supportsPathways` or no pathways block.

`src/utils/sampleValues.js` (the sample-value seam)
- `getGroupColumns(popData, contrast?)`, `valueAt(popData, feature, index)`, `getRawSampleRows(popData, features)`, `valueColumnName(popData)`, `meanColumnLabel(popData, groupLabel)`.
- `getGroupedValues(popData, feature, contrast)` → `[ { key, label, color, values:number[], n }, ... ]` in order `[baseline, caseGroup]`.

`src/utils/popGroups.js`
- `groupByType(ids, { types, categoryOrder })` — pure; `types` comes from the active dataset's meta (may be null mid-load), `categoryOrder` defaults to the macaque `GROUP_ORDER`.

## Loading model

- **Eager (index.html):** the default dataset's `meta.js` + default `track_<defaultTrack>.js` (two `<script>` tags). The registry itself is bundled (imported), so it needs no tag.
- **Lazy:** every other track (on selection, via `loadTrack`), each dataset's `meta.js` (on dataset switch, via `loadDatasetMeta`), and each dataset's `qc_global.js` (on first QC-tab open, via `loadDatasetQC`).

## Adding a new dataset (checklist)

1. Produce bundles under `public/datasets/<id>/`: `meta.js`, `qc_global.js`, and `track_<trackId>.js` for each track, matching the shapes above. For a worked modern generator read `scripts/build_normalized_bundles.mts` (multi-contrast, factorial, emits `groupN`) or `scripts/build_explorer_bundles_batch2.mts`; `docs/REAL_DATA_SHAPES.md` has the real bulk/miRNA conventions. Do NOT copy `scripts/migrate_macaque_bundles.mts` — it is the macaque MIGRATION step, downstream of `data/scripts/preprocess_multi.py`, and its output shape (`groupSamples: { normal, obese }`, no `expressionUnit`, no `groupN`, pathways inline) is two format revisions behind this contract. The DE-table header contract every builder shares lives in `scripts/lib/deTable.mts`.
2. Add a manifest entry to `DATASETS` in `src/data/datasets.ts`.
3. Set `supportsPathways:false` for modalities without enrichment (e.g. miRNA array); the Pathway tab hides automatically.
4. For a multi-level design, declare N `groups` + multiple `contrasts` (with `label`s) and emit `deByContrast` in each track bundle, plus `de` for the default contrast. Per-contrast enrichment goes in the SIBLING file's `{ default, byContrast }` wrapper, not in the track bundle. The contrast selector appears automatically.
5. For a FACTORIAL design (e.g. a 2×2), also emit the design-cell groups in `meta.groupSamples` beside the pooled arms — a sample legitimately belongs to both its pooled arm and its cell — and `meta.groupN` so the hero pills can count a cell arm before the bundle resolves. Tag the contrasts the source study never ran with `exploratory:true`, and give the design's axes a `group` label so the selector buckets them.
6. No component changes needed — the contract + `getGroupedValues` seam handle variable groups, sample counts, feature types, and contrast selection.
7. Regenerate the two CORPUS-WIDE derivations, both of which are keyed off the registry and go stale the moment it grows: `pnpm exec tsx scripts/build_query_index.mts` (the cross-dataset index; `--check` verifies value-level closure) and `pnpm run build:nomenclature` (the committed nomenclature table — a new study contributes symbols). `pnpm exec tsx scripts/check_datasets.mts` is the structural gate over the result (default tracks by default; pass `--all-tracks` to parse every track). Neither is caught by `tsc` or the test suite: the index falls back to the slow path and the nomenclature table simply omits the new study's symbols, so a missed rebuild is silent.
