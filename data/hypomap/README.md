# Mouse HypoMap atlas release

The HypoMap views (`src/search/hypomap/`) and the co-detection service
(`services/hypomap/`) read one release built from the published mouse HypoMap
atlas (Steuernagel et al. 2022, *Nature Metabolism*,
[doi:10.1038/s42255-022-00657-y](https://doi.org/10.1038/s42255-022-00657-y)):
384,925 cells from 18 datasets, as deposited on CELLxGENE Discover.
`hypomap-release.json` pins the release the app installs, and
[`provenance.json`](provenance.json) pins every input and the expected outputs.

Helene Li wrote the exporter and packaging recipe (DrWenyuanHe/hypoexplorer-data#1).
They live in `scripts/hypomap/` with the export logic unchanged.

## Inputs

| Input | Where it comes from | Tracked |
| --- | --- | --- |
| `source/<datasetVersion>.h5ad` (3.8 GB) | The CELLxGENE dataset version pinned in `provenance.json` (`atlas.url`) | No |
| `HypoMap_study_display_card.csv` | One row per study, curated by Helene Li against the paper's Supplementary Table 1. Its `GEO_Acc` column names the datasets, and `N_cells_in_HypoMap` must match the atlas | Yes |
| `source/mgi/MRK_List1.rpt.gz`, `source/mgi/MGI_Gene_Model_Coord.rpt` | MGI reports downloaded 2026-07-20, used for symbols, names and aliases. MGI publishes only the current reports, so these exact bytes come from Helenel430/hypoexplorer-mini | No |

`source/` is gitignored. `build_release.py` checks each file's size and SHA-256
against `provenance.json` before building, and refuses to build on any mismatch.

## Rebuilding the release

```sh
pnpm run build:hypomap      # python scripts/hypomap/build_release.py
python scripts/hypomap/build_release.py --atlas /path/to/existing.h5ad   # reuse a copy
```

`--atlas` reads a copy kept elsewhere, which is still checked against the pin.

Requires Python 3.11+ with h5py, NumPy, pandas and SciPy. The build reads one
dataset at a time from `raw/X` (about 2.5 minutes on a desktop with 30 GB of
memory) and writes `build/<tag>/` (gitignored):

- `export/`: the browser files (`manifest.json`, `metadata.json.gz`,
  `search-index.json.gz` and 201 `genes-NNNN.json.gz` shards, 63 MB).
- `hypomap-atlas.tar.gz`: those files packaged for the release (65 MB).
- `comparison-index/`: per-dataset detection bitsets and cell-to-gene lists for
  `services/hypomap/comparison_service.py` (5.4 GB; kept on the service host,
  never published).

The release's pinned timestamp and shard size are passed through, so a matching
input reproduces the manifest and archive byte for byte. Output bytes do not depend
on the operating system (fixed gzip headers, LF line endings), but compressed bytes
depend on the zlib version; `release.runtime` in `provenance.json` records the one
used. The script compares both
hashes with the pins and exits non-zero if either differs.

To use a local build in the app:

```sh
pnpm run fetch:hypomap data/hypomap/build/<tag>/hypomap-atlas.tar.gz
```

Then start the app with `VITE_HYPOMAP_EXPRESSION=1`. For co-expression, also set
`VITE_HYPOMAP_COEXPRESSION=1` and run the service against the comparison index
(`services/hypomap/README.md`).

## Metric definitions

- **Detection:** a stored count of at least 1 in `raw/X`.
- **Expression when detected:** ln(1 + 10,000 × count / the cell's total `raw/X`
  counts), summed over detected cells. The app divides by detected cells.
- **Regions:** `Region_summarized`. Blank and `NA` become *No HypoMap region*.
- **Populations:** `C7_named`. Blank and `NA` become *Unannotated C7*.
- **Pooled metrics** add cells across the datasets that measured the gene. Every
  dataset shares the atlas's single feature list, so the feature list says nothing
  about per-study assay coverage.

The exporter does not read `is_primary_data`, and does not need to. CELLxGENE marks
21,421 cells as non-primary (363,504 primary). All of them, and only them, are the
Mousebrainorg10x dataset (Zeisel et al. 2018), which CELLxGENE also publishes as
primary data in its own collection. They are not copies of other HypoMap cells, so
no cell is counted twice in the pooled metrics. The release keeps HypoMap's full
384,925-cell cohort (`COHORT` in `src/search/hypomap/atlas.ts`).

## Publishing

`hypomap-release.json` points `fetch:hypomap` at a release asset on
DrWenyuanHe/hypoexplorer-data that has not been published yet. The pinned
`hypomap-atlas-2026-11-26` replaces `hypomap-atlas-2026-11-05`, which was never
published either and was built from an H5AD that is not the pinned CELLxGENE file
(`provenance.json`, `release.supersedes`). The archive holds
only aggregated counts and sums per gene, dataset and region, plus the symbol
index; it contains no per-cell data. Before attaching it, confirm the
redistribution terms and attribution for the CELLxGENE atlas, the MGI reports
and the study card. Also note that hypoexplorer-data is a private repository,
so an anonymous `fetch:hypomap` cannot download from it.
