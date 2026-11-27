# HYPOMAP human Visium reference, by region

Retained source for the expression survey's Visium source
(`visium-hypomap-regions`): the human hypothalamus 10x Visium sections of
HYPOMAP (Tadross et al. 2025), reduced to donor × region pseudobulk counts. It
is an expression-only reference and not a registered dataset. Per-spot section
maps are a separate, later piece of work and are not built from these files.

## Source

| | |
| --- | --- |
| Publication | Tadross JA, Steuernagel L, Dowsett GKC, et al. A comprehensive spatio-cellular map of the human hypothalamus. *Nature* 2025;639(8055):708–716. [doi:10.1038/s41586-024-08504-8](https://doi.org/10.1038/s41586-024-08504-8), PMID 39910307 |
| Dataset | University of Cambridge repository, [doi:10.17863/CAM.111988](https://doi.org/10.17863/CAM.111988) |
| File | `humanHYPOMAP_spatial.rds` (Seurat V4 object), 2,632,769,082 bytes, MD5 `b7cab4381a6a279d14bc35f03e7061e2` (the repository's checksum), SHA-256 `9a49bc028cf4cfa0f89551f7f0cea6d51fb60e3c7ecd3778db25e3d4291d1cf3` |
| Licence | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Contents | 86,041 spots × 18,085 genes (probe panel; gene symbols, no Ensembl IDs) from 9 FFPE sections of 7 donors, with the authors' region labels |

The RDS is not committed. `source-manifest.json` pins it by URL, bytes, MD5 and
SHA-256, and pins every retained file by bytes and SHA-256.

## Files

| File | What it is |
| --- | --- |
| `source-manifest.json` | The pinned RDS, the extractor script's SHA-256 and runtime, and each retained file's bytes and SHA-256 |
| `cells.tsv` | One row per donor × region cell (143): display-local donor, the authors' grouped region, spots, sections, library size (sum of the cell's spot counts) |
| `counts.tsv.gz` | Gene, then one integer count column per cell in `cells.tsv` order, genes in the object's panel order (18,085 rows; gzip level 9, content also pinned uncompressed) |
| `sections.tsv` | Spots per donor × section × region, for section coverage |
| `labels.tsv` | The authors' named region label (`regional_clusters_named`), its grouped label (`regional_clusters_grouped`) and spots |

[`scripts/extract_visium_reference.R`](../../../scripts/extract_visium_reference.R)
writes these four tables from the RDS. It sums each donor's spot counts within
each grouped region across that donor's sections, so a cell is a donor × region,
not a donor × section × region. Donors are written only as `Donor 1`–`Donor 7`,
numbered in the C-locale order of the source donor codes. Source donor codes,
sex, age, BMI and spot coordinates are not written, so they are in neither the
retained files nor the products.

## Commands

```bash
pnpm run build:expression-visium    # verify the retained tables, write products, read back and recompute every value
pnpm run check:expression-visium    # byte-compare existing products instead
pnpm exec tsx scripts/build_visium_reference.mts --fetch                   # download the RDS, re-extract; refuses any change
pnpm exec tsx scripts/build_visium_reference.mts --fetch --from <rds>      # the same from an RDS already on disk
```

`--fetch` needs R with Seurat, SeuratObject and Matrix to read the Seurat object
(Seurat supplies the VisiumV1 image class); `HYPOEXPLORER_RSCRIPT` names `Rscript`
when it is not on the path. The retained tables were first extracted
under R 4.4.1 (SeuratObject 5.1.0, Matrix 1.7.0) and re-extracted on 2026-11-27
under R 4.6.0 (Seurat 6.0.0, SeuratObject 5.4.0, Matrix 1.7.5); all four tables
were byte-identical, and the manifest records the R 4.6.0 runtime. SeuratObject 5.4
turned the `slot =` argument of `GetAssayData` into an error, so the extractor uses `layer =`,
which SeuratObject 5.1 also accepts. `--fetch` compares the
re-extracted tables' content with the pinned hashes; `--fetch --record` is for a
deliberate source update and rewrites the hashes.

Because the extract is tracked, a checkout builds the products itself in about
five seconds: CI runs `pnpm run build:expression-visium` and `prepare:deploy`
builds the atlas when it is missing, instead of fetching it from the app host.

## Derivation

- Samples are donor × region cells with at least 10 spots: 121 of the 143 cells,
  across 23 grouped regions. 22 cells with 1–9 spots are left out.
- CPM = 10^6 × count / library size, where both are summed over the cell's
  spots. Stored to six significant digits (`toPrecision(6)`); a zero count is 0.
  The unit is "FFPE Visium probe-count CPM". It is not TPM, HPA nTPM/nCPM or
  microarray intensity, and the app never puts it on a scale shared with them.
- Groups are regions and samples are donors, so n counts donors and one donor
  appears in several regions. A region's survey mean is the mean over its donors.
- 16 groups are hypothalamic areas. Fx/LH, Fx/OT/ac and OT (fibre tracts),
  Vascular, Ventricular, Thalamus and Unassigned are kept as their own groups
  and are not ranked with the nuclei on the gene page.
- Regions with fewer than three donors are flagged as sparse wherever regions
  are ranked: POA (1 donor), ME and MAM (2 each).
- All 18,085 panel genes are included. Six (BPIFB6, HNRNPCL3, LRRC70, PRH2,
  PVRIG, TSPY1) have no count in any spot and are stored as measured zeros.
  Genes outside the panel, such as IGF2 and HCRT, are reported as "Not measured
  in this Visium probe panel", never as zero.

## What the build checks

- The four retained files match their pinned bytes and SHA-256, and the counts
  table's uncompressed content matches its own pin.
- Each cell's counts sum to its library size, so every count of every spot is in
  the table. Spot totals agree between `cells.tsv`, `sections.tsv` and
  `labels.tsv`, and section counts agree with `sections.tsv`.
- The grouped labels equal the builder's region map; gene symbols are unique
  (also case-insensitively); the zero-count genes and the off-panel genes are as
  listed above.
- Sample metadata carries only allow-listed fields (display donor, region,
  spots, sections, library size).
- All 2,188,285 emitted values are read back and compared exactly, then each is
  recomputed from its count and library size by a separate routine: within half
  a unit of the sixth significant digit, and exactly 0 for a zero count.

Independently of the builder, the retained counts were rebuilt from the
spot-level counts of a Parquet export of the same RDS with DuckDB, and agreed in
all 2,586,155 values (143 cells × 18,085 genes; 2,161,091 nonzero), with the
same spots, sections and library sizes per cell. That check is a one-off
recorded here; it needs the Parquet export, which is not in this repository.

Agreement is with the CPM derived from the retained counts. The authors did not
publish region CPM, so there is no published value to compare against.

## Interpretation limits

A 55 µm Visium spot mixes several cells, so a region value is a tissue average,
not a cell type. Region labels are the authors' spatial clusters. Sections and
donors cover regions unevenly (ARC has 6 donors; POA has 1), and postmortem FFPE
probe capture differs from fresh-tissue RNA-seq. Feeding and circadian state are
unknown, so no group is eligible for the fed / reference filter.

## Attribution

Tadross JA, Steuernagel L, Dowsett GKC, et al. A comprehensive spatio-cellular
map of the human hypothalamus. Nature 2025;639(8055):708–716,
doi:10.1038/s41586-024-08504-8. Visium data from the University of Cambridge
repository, doi:10.17863/CAM.111988, used under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Transformed by HypoExplorer:
spot counts summed per donor and region and converted to CPM.
