# Lossless existing-source expression index

The expression survey indexes the original per-sample measurements for all 31
curated sources in 29 registered tracks. This index is separate from the rounded,
default-track-only expression family used by the older cross-dataset comparison.
It introduces no statistical transformation or gene-symbol merging.

## Build and verify

From the repository root:

```powershell
npm run build:expression-index
npm run check:expression-index
```

The equivalent commands are `npx tsx scripts/build_expression_index.mts` and the
same command with `--check`. Both read local source bundles only. The check mode
rebuilds the expected representation in memory, compares every expected file and
the retained evidence, and writes nothing. Missing source files, changed catalog
sample counts or units, fidelity failures and stale products fail the command.

`public/query/` is an ignored build artifact. Regenerate before building the app
or publishing bundles. An app build pins the expression build ID, so all its
requests use that immutable generation. Deployment must publish these data objects
before the app that references them.

## Files and publication

- `public/query/expression-manifest.js` is a mutable discovery pointer.
- `public/query/expression/<buildId>/manifest.js` holds the complete source catalog,
  units and ordered condition/sample scaffolding for that generation.
- `public/query/expression/<buildId>/shards/e000.js` through `e511.js` hold gene rows.
- [validation.json](validation.json) records the exact source hashes, every generated
  object hash, full fidelity counts and local compression measurements.

The SHA-256 build ID derives from the source catalog, sample scaffolding, totals
and every emitted gene row. A rerun with identical expression content has the same
ID and bytes; no timestamp forces another upload. Each immutable path and JavaScript
global includes the build ID. An existing immutable file with conflicting contents
causes an error. Previous generations remain available; this builder never deletes
them. It writes the pointer only after every immutable object has been written and
verified. The R2 publisher must apply its own remote publication barrier.

Each normalized key hashes into one of 512 FNV-1a buckets. A row stores a source
index, the original feature spelling and an array flattened in condition/sample
order. The source index refers only to the same build's manifest. Multiple original
features with the same normalized key retain their original candidate order and
remain ambiguous. Ensembl version suffixes can match their versionless identifier;
ordinary symbol suffixes such as `Gene.1` remain distinct. There is no DE fallback.

## Scientific fidelity

The builder first aligns each feature directly to the raw bundle's `sampleOrder`
(or legacy `sampleNames`) and the selected conditions' sample IDs. A dropped sample,
missing column or missing/nonfinite measurement becomes `null`, matching the existing
adapter. Finite values, including zero and long decimal values, retain the exact
JavaScript number parsed from the original JSON. JSON round-trip equality is checked.

It then compares every normalized query with `expressionForGenes`, covering source
identity, units, original feature IDs, ambiguity candidate order, condition labels,
reference eligibility, sample IDs, values, arithmetic means and sample counts.
Ambiguous features remain unreported by that adapter; their individual stored values
are independently aligned to the raw arrays and checked for lossless serialization.
No cross-study averaging, normalization or RNA-fraction pooling occurs.

The initial build verifies 534,346 feature rows, 534,332 normalized source queries,
5,785,609 sample values and 14 ambiguous source keys. It includes nondefault tracks,
the four disjoint maternal POMC conditions, separate broad/Drd2 POMC sources and
separate PNOC immunoprecipitated/input sources.

## Download estimate

For Igf1r, the initial immutable manifest plus one shard total 183,159 decoded bytes
or **62,429 bytes with local gzip level 6**. This replaces an estimated 4,948,561 gzip
bytes of whole-track downloads for the four whole-hypothalamus studies: **98.74% less**.
The same shard already covers every indexed source, so selecting another source does
not request another full track. A warm manifest or repeated shard reduces it further.

These are reproducible local byte estimates, excluding HTTP overhead, app JavaScript
and server latency. They do not claim measured production transfer or latency; R2/CDN
may negotiate another compression representation. The full index is about 62 MB of
uncompressed objects, but a single-gene query downloads only its manifest and bucket.
