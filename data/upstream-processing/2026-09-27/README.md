# CNP0003785 upstream review

> Dated record (2026-09-27). The current upstream-processing table is `geo_replication/config/upstream_processing.tsv`, checked by `pnpm run check:upstream`. The review records in this folder are tracked and can be read in any checkout; replaying the source audit needs downloads that are not, see [Files not in this repository](../../../docs/PROJECT_GUIDANCE.md#files-not-in-this-repository).

The [retained review](CNP0003785-review.json) records the macaque snRNA-seq
methods from the coauthor-uploaded full text of
[Lei et al. 2024](https://doi.org/10.1016/j.cmet.2024.01.003).
The review identifies STAR 2.5.3 and the Macaca_fascicularis_5.0 pre-mRNA reference.
Annotation provider/release and the snRNA-seq counting tool remain unstated.
The separate Stereo-seq workflow does not supply those missing snRNA details.

`MHD-tree.json` and `MHD-source-audit.json` identify all 24 files inspected at
author-code commit `3c39247bb43fe99d877d1ed0a9ea21486f41bbf2`, with blob IDs,
UTF-8 response hashes and matches for reference/annotation and input-loading
terms. The programs start from processed objects. They do not recover the
missing raw-read processing parameters.

The upstream table hashes the retained review, not the inaccessible publisher
download. Regenerate through the normal producer:

```powershell
pnpm exec tsx scripts/build_upstream_processing.mts --mark-reviewed=CNP0003785
pnpm run check:upstream
```

The displayed review note preserves the remaining source limitations.
This metadata review does not change differential-expression results, pipeline
QC or author-concordance status.
