# NeuroSeq baseline-expression import

This import preserves the public **gene_tpm** viewer's hypothalamic (HY) data:
35,358 genes × 54 pooled-neuron libraries, in 17 original source groups and 15
display populations. The source HY classification includes three SFO libraries.

## Sources and retained evidence

- [NeuroSeq gene expression viewer](https://neuroseq.janelia.org/heatmap/d/gene_tpm):
  the page labels this dataset as HTSeq gene TPM using Gencode.vM4. The API reports
  mouse/mm10. Use this precise processing identity, rather than inferring the
  expression annotation from the final publication's other analyses.
- [Sugino et al., eLife 2019](https://elifesciences.org/articles/38619) and its
  [sample supplement](https://cdn.elifesciences.org/articles/38619/elife-38619-supp2-v2.xlsx)
  supply source sample metadata and the source-group/display-population crosswalk.
- [Public scripting help](https://neuroseq.janelia.org/help/scripting) documents
  the sample `Columns` filter. The archived public viewer client defines the
  read-only form POST to `/heatmap/filter/gene_tpm`, with `filter`, `page`, `q`,
  and `script` parameters. Each page supplies 100 genes.

`source/catalog.json` retains the prior source review, all 29 supplement fields
for every HY sample, GEO crosswalks, ten Henry overlap candidates, and three
browser-observed expression checkpoints. Its source supplement hash is pinned.
The catalog's original mockup/research status describes that earlier review;
the completed import's current status lives in the generated validation report.
The retained catalog uses its original CRLF line endings and its exact-byte
hash must survive checkout; its Git attributes therefore disable text conversion.
Generated JSON uses LF and follows the repository's `*.json eol=lf` rule.

`source/portal-export.zip` contains the original bytes of all 354 API page
responses, a separate three-gene/two-sample query, the viewer HTML, the public
client JavaScript and help pages. `source/portal-source-manifest.json` pins the
archive and each uncompressed response by SHA-256, byte count, source URL,
retrieval date, and exact filter. The archive uses fixed ZIP timestamps; it is a
compact container for source bytes, not a replacement matrix or recomputation.

## Reproduction and validation

From the repository root, using Python 3.10 or newer and its standard library:

```text
python scripts/build_neuroseq_expression.py
python scripts/build_neuroseq_expression.py --check
```

Build and check are offline. `--fetch` explicitly refreshes all public source
pages and their evidence, with at most three concurrent requests. A changed
source gene count or processing label requires review rather than silently
changing scope.

The checker verifies hashes for all retained responses, complete page coverage,
gene and sample alignment, the partition into 17 original groups, the 15 portal
population memberships on every page, finite nonnegative TPM values, source
precision, index/shard closure, and equality of **all 1,909,332 emitted values**
to their source cells. It also checks six cells against the separate API query
and these browser checkpoints:

| Gene | Source sample | Portal/imported TPM |
| --- | --- | ---: |
| Lepr | HY.ARH_glu_Pomc-GFP_m51_383 | 27.94 |
| Agrp | HY.ARH_GABA_NPY-hrGFP_m46_100 | 3034.68 |
| Pomc | HY.ARH_glu_Pomc-GFP_m51_383 | 22795.34 |

This establishes fidelity to the public portal export and displayed precision.
The API already rounds to two decimals. It does not establish original
unrounded TPM agreement or independently reproduce an analysis from raw reads.

## Browser products

`public/expression/neuroseq/manifest.json` carries the source, population,
source-group and sample metadata. Each expression vector follows its `samples`
array. `gene-index.json` maps portal gene IDs, symbols and Ensembl IDs to 256
shards chosen by the first two SHA-256 hex digits of the portal gene ID.
`shards/<hex>.json` preserves each gene record and its 54 original TPM values.
`validation.json` exposes validation counts, checkpoints and limitations.

Portal gene IDs remain distinct. Duplicate gene symbols would be retained
separately and never summed; this pinned source contains no exact duplicate
symbols. It has 20 case-insensitive collisions (for example, `ANKRD23` and
`Ankrd23`); the uppercase source record lacks an Ensembl ID. Prefer an exact
symbol match and require disambiguation if a case-insensitive query matches
multiple records. All collision IDs are retained in the validation report.
The source's current gene annotation is preserved without renaming symbols.
No population means or statistical tests are precomputed in this import.

## Scientific inclusion rules

- Source groups with `.fed_` in their published name supply 13 explicitly fed
  libraries. These alone have `referenceEligible: true`. Other libraries have
  `feedingState: "not-reported"` and `referenceEligible: false`; their reference
  atlas origin is recorded separately as `atlasReference: true`.
- Two NPY source groups share one display population, as do two AVP/SO source
  groups. Preserve all 17 group IDs in analysis and show the display label as
  descriptive metadata.
- Every library represents a pool of isolated neurons. It is not an individual
  neuron, a positive-cell fraction, or whole-hypothalamus tissue expression.
- Ten Henry fed libraries match NeuroSeq samples on seven metadata fields but
  have different deposition IDs. They remain overlap candidates pending raw-read
  identity confirmation and must not count as independent replication.
- [Henry et al. 2015](https://elifesciences.org/articles/09800) and its original
  [TPM table](https://ftp.ncbi.nlm.nih.gov/geo/series/GSE68nnn/GSE68177/suppl/GSE68177_Agrp.Pomc.fedfast.tpm.txt.gz)
  use different published values. For example, the candidate matching Lepr
  source sample 383 is 28.266 TPM in Henry and 27.94 TPM in this portal. The
  current import uses only the exact NeuroSeq values.
