# External reference expression: Phase 0 evidence (2026-10-29)

Measurements behind the Phase 0 section of
[the implementation plan](../../../../docs/EXTERNAL_REFERENCE_EXPRESSION_PLAN_2026-10-29.md).
Nothing here is a browser product, and no app code reads these files.

Source downloads are not committed. Each measurement file records the URL, byte
count, SHA-256 and UTC retrieval time of every input, so a builder can pin and
re-fetch the same bytes. The builders that later ship values must retain their
own source archives (Git LFS for files over a few MB) as the plan describes.

## Contents

| Path | What it records |
| --- | --- |
| `gtex/measurements.json` | GTEx v10 Brain_Hypothalamus per-sample TPM: file hashes, genes, samples, donor sex and age band, value precision, and the size of a 256-shard per-gene JSON product |
| `hpa/measurements.json` | HPA 25.1 brain files: hashes, columns and hypothalamus rows. `subregionPass` holds the corrected subregion, per-animal and single-nucleus counts |
| `allen/measurements.json` | Allen human microarray, mouse ISH and ABC Atlas counts. Every figure is tagged `verified-by-request` or inferred. `requests` logs all 94 requests with URL, status, UTC time and SHA-256 |
| `allen/h_hy_samples_<donor>.json` | Raw RMA responses listing each donor's hypothalamic microarray samples (wells), with structure and slide |
| `allen/h_hy_root.json`, `allen/h_hy_desc.json` | Hypothalamus (`Hy`, id 4540, graph 10) and its 176 descendant structures |
| `allen/_derived_*.json` | Summaries computed from the retained or logged responses |
| `scripts/` | The GTEx and HPA measurement scripts (Python stdlib; run with `python -I`) |

The Allen counts came from ad hoc RMA queries. The queries that worked are recorded
verbatim in `allen/measurements.json` (`working_sample_query` and the `requests`
log); the throwaway query scripts were not retained.

## Definitions that change the counts

- **HPA human subregions.** The first pass in `measure_hpa.py` matched rows containing
  the text "hypothalam", which misses subregions such as "arcuate nucleus". Use
  `subregionPass`, which maps subregions to regions with HPA's own
  `rna_brain_hpa_subregions` table.
- **Allen human hypothalamus.** Samples whose structure path contains `/4540/` in
  graph 10. That set has 176 structures, including lateralized and unlateralized
  nodes. An earlier probe's figure of 92 used a different filter.
- **Allen human hemisphere.** The specimen `hemisphere` field is null for donors 9861
  and 10021, so sides come from ", left"/", right" in structure names.
- **ABC HY clusters.** The `class` column of the WMB taxonomy pivoted membership file
  (release 20231215 metadata, listed in manifest `releases/20261031`). "Strict" is
  classes 12, 14, 15 and 16. "Broad" adds the CNU-HYa classes 11 and 13. The release
  has no cluster-level dominant-region file.

## Licensing basis

On 2026-10-29 the project owner confirmed that HypoExplorer is noncommercial, which
is the basis for displaying Allen-derived values under the Allen Institute terms of
use. HPA data is CC BY 4.0. GTEx summary and TPM data are open access. HPA's
single-nucleus brain data credits Siletti et al. as its source; confirm that
source's terms before shipping it.
