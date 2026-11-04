# GSE224274: the deposited CPM matrix is a renormalized gene subset

The [September 11 review](../continuation-round2-2026-09-11/intake-author/README.md#gse224274-a-source-universe-discrepancy)
found that the 14,952 readable genes in the authors' Figure 1c workbook share no gene with
the 5,764 genes in the GEO matrix `GSE224274_CPM-Gys.txt.gz`. It recorded the cause as not
established. This measurement adds evidence on what the deposit contains. It reads only
retained files and changes no registered output or ledger.

Reproduce or check it from the repository root:

```text
python -I data/author-validation/gse224274-deposit-slice-2026-10-29/measure.py
python -I data/author-validation/gse224274-deposit-slice-2026-10-29/measure.py --check
```

The inputs and their SHA-256 values are pinned in `measurement.json`. The GEO matrix is a
retained local input under `geo_replication/` and is not tracked; where it is absent, fetch
it from the [GEO series files](https://ftp.ncbi.nlm.nih.gov/geo/series/GSE224nnn/GSE224274/suppl/)
and confirm the pinned SHA-256 before running the check.

## What the measurement shows

- **The CPMs were computed within these 5,764 genes.** Every sample column sums to
  1,000,000 (six exactly, six between 999,936 and 999,990). A CPM matrix sums to one million
  over its normalization universe, so no other gene contributed to the library sizes used.
  GEO describes the file as "all the gene expressions (CPM) for all the samples".
- **The two universes are complements, not overlapping samples of one universe.** The
  deposit and the author table share 0 genes and together hold 20,716. Actb, Gapdh, Pomc,
  Agrp, Cartpt and Gys1 occur only in the author table. All 5,143 registered DE genes come
  from the deposit, so none is in the author table.
- **The deposited genes are sparse.** The mean gene is nonzero in 4.2 of 12 samples. 3,095
  genes are nonzero in three or fewer samples, 621 are zero in all twelve, and 232 are
  nonzero in all twelve.
- **The values are discrete.** In every sample, every nonzero value is a whole multiple of
  one twentieth of that sample's smallest nonzero value (tolerance 0.02 step); 83–88% are
  whole multiples of the smallest value itself.

## What it does not establish

The discreteness shows that the values derive from a small set of count-like quantities.
It does not identify the counting unit. Fractional multi-mapping assignment and a smaller
true unit both fit, so no library size is inferred. The measurement also does not show why
the authors' genes are missing. The most direct reading is that the deposit holds the genes
excluded by the authors' stated 10-read expression cutoff, renormalized among themselves,
but that remains an inference until the authors or GEO confirm it.

## Consequence for the registered output

The registered `food_cues_vs_object` result is computed from this subset. Its Pipeline QC
checks pass because they test internal consistency: the matrix is finite, the samples
match, and the replay reproduces the published rows. They do not test whether the deposit
represents the experiment's expressed transcriptome. Until a complete matrix is obtained,
the displayed DE should be read as an analysis of the deposited low-detection genes, not of
the POMC translatome the paper reports. The follow-up is tracked in `TODOS.md`.
