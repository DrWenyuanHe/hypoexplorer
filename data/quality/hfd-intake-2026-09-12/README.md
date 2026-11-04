# High-fat diet intake, September 12, 2026

Two additional studies provide three analysis tracks. The registry increases from 159 to 161 studies. Existing study entries and scientific review decisions are preserved.

| Study | Track and comparison | Replication | Analysis | Public genes |
| --- | --- | --- | --- | --- |
| [GSE104709](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE104709) | Mouse ventral/circumventricular hypothalamus, chronic HFD versus regular chow | Five independent RNA pools per arm, two mice per pool | limma on log2(PORT-normalized read count + 1) | 20,681 |
| [GSE107324](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE107324) | Male P10 offspring hypothalamus, maternal HFD versus control diet | Six profiles per arm; the paper defines n as litters | edgeR-QL on deposited integer counts | 11,455 |
| GSE107324 | Female P10 offspring hypothalamus, same diet comparison | Six profiles per arm; analyzed separately from males | edgeR-QL on deposited integer counts | 11,388 |

GSE104709 contributes 13 genes at FDR < 0.05. Neither GSE107324 track has genes below that threshold in this reanalysis. All three tracks include GO Biological Process, Hallmark, KEGG and Reactome pathway results with the repository's pinned FGSEA provenance.

## Source and interpretation

GSE104709's input is author-normalized PORT expression. Same-symbol rows are summed before the logarithm. Diet-switch arms are excluded. All animals underwent forced wakefulness before collection, and the chronic contrast includes the associated difference in body weight. Individual membership of the two-mouse pools is not deposited.

GSE107324's two workbooks contain twelve raw-count columns each, alongside normalized values and independent author statistics. This corrects the earlier survey's claim that no counts were deposited. The source universe is limited to workbook rows. Forty-seven Excel-damaged gene labels retain distinct, unassigned identifiers and their count contributions; they are excluded from public gene and alias results. GEO lacks sample-to-litter identifiers, so the sexes are analyzed separately and their profiles are not pooled as independent litter replicates.

The original rat logFC direction is reversed before comparison. Across the displayed genes, effect correlations are 0.999888 for males and 0.999900 for females. Significance calls differ: the authors' paired universes contain 8 male and 86 female FDR discoveries, compared with zero in each pipeline fit. The verification record explicitly retains that difference. For GSE104709, a complete matching author effect table was not obtained; its Dryad archive returned access errors. Pipeline reproduction does not establish author-result agreement.

GSE127056 was excluded because the deposited chow and HFD groups occupy different age ranges. GSE203125 remains deferred because its stated linear processing conflicts with the apparent scale of the deposited matrix. The discovery and exclusion evidence is retained in this directory.

## Reproduction

Run from the repository root with the installed Python, R and Node dependencies:

```powershell
python scripts/prepare_hfd_104709.py --offline
python scripts/prepare_hfd_maternal.py
npm run analyze:hfd
npm run build:hfd-bundles
Rscript scripts/verify_hfd_104709.R
python scripts/verify_hfd_107324_source.py
Rscript scripts/verify_hfd_107324.R
python scripts/compare_hfd_authors.py --check
npm run check:hfd-intake
```

Preparation scripts document download options for a fresh machine. Source files are pinned by URL, byte count and SHA-256. The independent replay commands and measured tolerances are described in `data/internal-qc/hfd-intake-2026-09-12/INDEPENDENT_REPLAYS.md`. The HFD audit is included in `prebuild` and refuses stale source, analysis or public-bundle evidence.

The initial working tree already contained publication-review changes. `working-tree.before.txt` records that state. Historical verification inputs are preserved by exact checksum under `preserved-inputs/`; their checks continue to require equality for the original studies while allowing new registry rows. The registry golden was refreshed for these additions and the prior reviewed metadata corrections, whose pre-intake snapshot failure is retained in `registry-before.log`.

Verification command results are recorded in the adjacent logs. `VERIFICATION.md` records the final completed checks and any remaining limitations.
