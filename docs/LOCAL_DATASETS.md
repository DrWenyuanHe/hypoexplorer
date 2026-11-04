# Local datasets

HypoExplorer's Local datasets workspace reads differential expression and pathway enrichment results on the user's device. Open it from the home page or at `#/local-datasets`.

## Import and explore

1. Choose **Import results**, then select or drop files. A pasted comma-separated or tab-separated table also works. Every non-empty workbook sheet appears in the review list.
2. Review each sheet's result type, header row, suggested columns, source preview, usable row count, and data notes. Column suggestions recognize common edgeR, DESeq2, limma, Seurat, FGSEA, and overrepresentation analysis names. All suggestions remain editable.
3. Give each new comparison a dataset name and organism. Use the same name and organism on its DE and FGSEA sheets to combine them. The **Add to dataset** selector attaches results to an existing saved comparison. Exclude notes, metadata, and other sheets that contain no results.
4. Confirm each included sheet after checking its assignments and notes. Changing the mapping or dataset assignment clears that sheet's confirmation. The save button stays disabled until every included sheet is confirmed.
5. Save the confirmed datasets locally. Select a gene in the searchable table or volcano plot to inspect its supplied pathway links. Select a pathway to inspect its supplied member genes. The comparison table shows the selected result across saved datasets with compatible organisms.

The gene and pathway tables support sorting, pagination, search, and adjusted P cutoffs. Gene filtering also supports a minimum absolute log2 fold change. The volcano plot can show raw or adjusted P values. The comparison table continues to use adjusted significance when the chart shows raw P.

## Accepted data and interpretation

| Input | Supported forms |
| --- | --- |
| Delimited text | CSV, TSV, TXT, and TAB. Comma, tab, semicolon, and whitespace separators; quoted cells and embedded line breaks. |
| Workbooks | XLSX, XLS, XLSM, XLSB, and ODS. Every non-empty sheet is available for review. |
| Differential expression | A gene symbol or identifier and a log2 fold change. Raw and adjusted P values are optional. An additional gene ID column can accompany symbols. |
| Pathway enrichment | A pathway ID or name. Optional description, NES, adjusted P, raw P, size, database, and leading-edge or member genes. |
| Pathway gene lists | Slash, comma, semicolon, pipe, or whitespace separators; common R vector and JSON array text forms. |

Use one experimental comparison per sheet. A long table containing several contrasts should be split before import. Within a sheet, repeated identical identifiers retain the first valid row and produce a duplicate warning. When merging sheets into one dataset, conflicting statistics for the same gene or pathway stop the import. They should be assigned to separate comparisons.

Fold changes must already use a log2 scale. HypoExplorer does not rerun differential expression, enrichment, multiple-testing correction, normalization, or raw-count analysis. The uploader cannot infer the experimental direction from a table, so use a comparison name that states it, such as treatment versus control.

Missing, malformed, non-finite, and out-of-range probabilities remain unavailable. A raw P value never replaces a missing adjusted P value. Rows with no usable gene identifier or finite log2 fold change are skipped, with counts and notes shown before confirmation. Overrepresentation results without NES have no inferred enrichment direction. Gene-to-pathway links reflect only the supplied gene lists. An FGSEA leading edge is a subset of a pathway, so a missing link does not establish that the gene is absent from that pathway.

Each file is limited to 50 MiB, or 52,428,800 bytes. Tables are intended for up to 250,000 result rows, with a 100-row allowance for headers and preamble. The parser rejects tables beyond 250,100 physical rows or 512 columns. Automatic header detection examines the first 100 rows. Manual header selection remains available. Large files still require enough browser memory to parse and display them.

## Comparison rules

Gene evidence matches imported identifiers after trimming surrounding whitespace and ignoring letter case. It preserves alias names and identifier version suffixes, so gene IDs and symbols are not interchangeable. No online lookup, gene alias resolution, Ensembl-to-symbol conversion, or ortholog inference runs on imported identifiers.

Pathway evidence matches the imported pathway ID and database. Database labels ignore case and surrounding whitespace; pathway IDs retain case. Matching a description alone does not establish that two pathway definitions are identical.

Cross-dataset evidence requires compatible organism names. It trims and normalizes whitespace, ignores letter case, and recognizes human, mouse, rat, cynomolgus macaque, and rhesus macaque as their scientific names. Enter scientific names for other organisms. Broad labels such as macaque or monkey remain ambiguous. Different or unknown organisms appear as incompatible; the source dataset can still display its own results. The module does not pool effect sizes or treat absence from an imported results table as evidence that a gene or pathway was unchanged. Pre-filtered significant-only tables cannot answer whether an unlisted result was tested.

## Local storage and privacy

File reading, column matching, normalization, searches, plots, and local comparisons run in the browser. Uploaded file contents, filenames, genes, and pathway selections are not sent to a server. The local route contains no dataset, gene, or pathway identifiers.

The workspace saves normalized results and source assignments to IndexedDB under `hypoexplorer-local-datasets`, schema version 1. Every import batch uses one transaction. A failed write cannot leave a partially saved batch, and success is reported only after the transaction commits. Dataset payloads do not use localStorage. Storage failures, quota exhaustion, blocked connections, and unreadable records produce actionable errors.

Saved data belongs to the current site origin and browser profile. It does not sync across devices, browsers, ports, or profiles. Clearing site data, storage eviction, or ending private browsing can remove it. Keep original files and export useful comparisons. Local browser storage is not an encrypted vault against other software or people with access to the same browser profile.

The website still downloads its application assets. An optional **Add a public study for local comparison** control downloads the complete public track and contrast chosen by the user, then saves its DE and pathway results locally. Public requests depend only on that public study and track. The local module never passes imported selections into `queryIndex.ts`, whose normal public search requests use identifier-derived shards. It also does not open external gene or pathway search links for local selections. If a public comparison has no available pathway results, the interface says that the saved copy contains gene results only.

## Export and removal

**Export selected dataset** creates an Excel workbook locally with differential expression, pathway enrichment, and dataset details sheets. This exports the normalized results, rather than a byte-for-byte copy of the original files or a full IndexedDB backup.

To restore an export, import its results sheets, give them the same dataset name and organism, and exclude the Dataset details sheet. Review and confirm the mappings again. Name and organism are recorded in the details sheet but are not automatically applied during reimport.

**Remove selected dataset** asks before deleting its browser copy. The most recent removal can be undone while the workspace remains open. Closing or reloading the workspace clears that undo state.

## Verification

Automated coverage includes real browser File reads and generated multi-sheet Excel files, common column aliases, numeric edge cases, mandatory per-sheet confirmation, mapping edits, dataset grouping, conflicting imports, storage transaction completion and aborts, public track downloads, source preservation, local evidence rules, explorer interaction, and route behavior.

The user-supplied processing folder is for local QA only. Derived PAL and IGF examples under `.tmp/local-datasets-qa/` retain full result rows for browser testing and include a provenance record. They stay outside `public/`, application source, and production assets. Production artifact scans found no processing-directory paths, fixture filenames, or private result assets.

The browser workbook check imported the PAL and IGF DE/FGSEA sheets into two comparisons and verified the CXCL2 links to `HALLMARK_TNFA_SIGNALING_VIA_NFKB`, along with the displayed cross-dataset gene and pathway evidence. Reference values from the original paired-result and Hallmark FGSEA CSVs are below. The interface displays rounded values.

| Reference | PAL | IGF |
| --- | --- | --- |
| DE result rows | 19,996 | 20,665 |
| Hallmark pathway rows | 50 | 50 |
| CXCL2 log2 fold change | 6.31950238808393 | 1.48847257400155 |
| CXCL2 adjusted P | 0 as exported | 1.48273380474236e-09 |
| TNFA/NFKB pathway NES | 2.73656635741925 | 2.28619011442944 |
| TNFA/NFKB pathway adjusted P | 8.00315720761201e-34 | 8.20370065652377e-11 |
| TNFA/NFKB pathway size | 193 | 191 |

Both pathway leading edges contain CXCL2. The PAL zero probability is retained from the source file; it does not establish a mathematically exact zero.

Additional browser checks on 2026-09-05 passed:

- The four-sheet workbook required confirmation for every included sheet before saving. It produced 19,976 PAL gene rows and 20,636 IGF gene rows after the disclosed duplicate-symbol exclusions, plus 50 Hallmark pathways each.
- The original PAL Hallmark CSV imported directly. A 50-row TXT extract of the IGF DE table imported and merged into IGF without duplicating gene results.
- The saved datasets survived repeated reloads. KISS1 was shown as passing in PAL and below cutoff in IGF. Missing adjusted probabilities remained unavailable.
- Selecting CXCL2 showed its two supplied Hallmark pathway links. Selecting the TNFA/NFKB pathway showed both datasets' enrichment scores. Clicking an actual volcano point selected TRIB3 and displayed its four supplied pathway links.
- A public GSE208722 comparison downloaded and saved 16,746 genes and 5,006 pathways. CXCL2 then showed PAL and IGF passing, and the public comparison below cutoff.
- Excel export downloaded an actual workbook with 20,636 DE rows, 50 pathway rows, and one metadata row. Reading that file confirmed full-precision CXCL2 and TNFA/NFKB values. Workbook reimport behavior is covered by automated parsing and import-form tests; the exported file was inspected locally rather than reimported through the browser picker.
- Desktop and 390-pixel mobile views were inspected visually. Controls, plot axes, source previews, and selected-result panels fit their layouts. The final build also handled lowercase gene search. Browser error logs were empty.

Privacy validation combines network-free importer/explorer tests, fixed-public-download tests, and production artifact scanning. Browser requests were not separately captured in a network trace. The test preview uses `local-preview.html` on the same origin to inspect freshly built assets while preserving IndexedDB data when an older service worker caches the root document.

Targeted commands avoid the unrelated analysis-data regeneration in the normal prebuild hook:

```powershell
pnpm exec vitest run src/__tests__/localImport.test.ts src/__tests__/localImportPanel.test.tsx src/__tests__/localDatasetStorage.test.ts src/__tests__/publicReferencePicker.test.tsx src/local-datasets/comparison.test.ts src/local-datasets/LocalExplorer.test.tsx src/__tests__/localRoutes.test.tsx
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vite build --outDir .tmp/local-datasets-build
```

The isolated Vite build checks production bundling. It does not replace the repository's analysis-provenance checks or authorize deployment.

After the final explorer and uploader changes, all 59 targeted local-module tests passed and both the browser and Node TypeScript configurations passed. The isolated production build completed successfully. Its local workspace JavaScript is a separate lazy-loaded chunk, approximately 57 kB before compression. The existing main application chunk still exceeds Vite's size-warning threshold.
