# September 5 discovery intake

14 new studies, 22 tracks and 51 fitted comparisons. 14 new studies are registered in the explorer.

The original discovery files are preserved. Download manifests record source URLs, file sizes and SHA-256 checksums. Animal or independent pool identifiers define replication; cells and technical runs are never promoted to independent animals.

Count analyses use edgeR quasi-likelihood with TMM normalization; deposited normalized matrices use limma. RSEM imports use lengthScaledTPM. Each comparison has an explicit direction, sample sheet, design, DE table, standard errors and input/output checksums. Pathways use the repository’s schema-3 FGSEA workflow and four MSigDB collections.

These are local pipeline results. Source and bundle checks do not constitute agreement with independently published author results, which remains a separate review.

| Study | Tracks | Comparisons | Source and design notes |
|---|---:|---:|---|
| GSE317867 | 1 | 1 | Five control and four rebound pools, each containing seven mice. Only immunoprecipitated RNA is compared. Input assays are paired to these pools and excluded from this track. |
| GSE278158 | 1 | 1 | Three wild-type and three SRC-1 knockout hypothalamus samples. GEO sample descriptions explicitly map YX3878-YX3883 to the featureCounts columns. |
| GSE309435 | 1 | 1 | Nine Wistar and ten spontaneously hypertensive rats. Sex is a model covariate; the deposited cohort lacks Wistar male 1. |
| GSE148252 | 1 | 4 | NPAS4 bulk experiment only. Each genotype/light arm has three independent pools of six SCN pairs. Time-course and ChIP assays are separate experiments and excluded. |
| E-MTAB-15488 | 1 | 2 | Only hypothalamus is included. Multiple organs from the same mouse are not extra replicates. D09Hy and Op57Hy are absent from processed counts. WT/DSS and Opa1/flox cohorts are analyzed separately. |
| E-MTAB-15489 | 1 | 1 | Only hypothalamus is included. Multiple organs from the same mouse are not extra replicates. |
| GSE337822 | 3 | 3 | Twenty independently sequenced mice, five of each sex per oxygen/isoflurane arm. Submitted excitatory, inhibitory and non-neuronal nuclei are summed within each mouse. Treatment models adjust for sex. GSE243489 supplies the reference taxonomy and contributes no samples. |
| GSE262407 | 7 | 28 | ARC/VMH cells aggregated by hashed mouse after submitted discard/doublet filtering. DVC cells are excluded using cell anatomy and Arc animal IDs. Major classes require 20 nuclei per mouse; Ghrh requires 10. Each displayed population retains at least three mice in all four arms. The pilot GSE262408 is a separate cohort and is not included. |
| GSE314184 | 1 | 4 | One animal per submitted Seurat object, with no pooling. RNA count layers are aggregated by mouse after excluding submitted doublet calls. Three naive control, three alloparental, three infanticidal males, four sires and four dams. Dam-versus-sire differences combine sex and parental-role differences; they are not an isolated hormone effect. |
| GSE113576 | 1 | 1 | Three independent female pools and three independent male pools, each containing three mice. GEO explicitly maps matrix barcode suffixes 1-6 to the six pools. Cells are summed within each pool; the 18 mice do not provide 18 independent transcriptomic replicates. This track aggregates all submitted preoptic cell types. |
| GSE135007 | 1 | 1 | Ten four-week-old Gough Island and ten WSB hypothalamus samples, each strain with five females and five males. RSEM expected counts, TPM and effective lengths supply a lengthScaledTPM import that preserves library totals. The model adjusts for sex. Litter identity is unavailable in the deposited sample metadata, so litter effects cannot be separated. |
| GSE224274 | 1 | 1 | Six POMC-RiboTag mice per condition after a 16-hour fast. Only the 5,764 genes in the deposited CPM matrix are available; results and pathway coverage are restricted to that gene universe. The matrix is summed on the linear scale for duplicate symbols and transformed as log2(CPM+1) for limma. Counts are not reconstructed from CPM. Cage identifiers are not deposited. |
| GSE308884 | 1 | 2 | Six mice each in lean untreated, diet-induced obese vehicle and DIO TN-783 groups. Limma uses the author-supplied log2 CPM sheet without a second logarithm or count model. Duplicate gene-symbol rows are averaged on the supplied log scale. Salmon estimates are retained in the workbook but are not treated as integer raw counts. |
| GSE281701 | 1 | 1 | Three CT-26 cachexia and three healthy mice. Only hypothalamus samples are included. Deposited RSEM gene TPM, effective lengths and expected counts are imported with lengthScaledTPM correction; fractional estimates are retained. Each corrected library preserves its original expected-count total. |

## Candidates retained for further processing

These records are retained in the discovery tracker and have not been presented as analyzed explorer studies.

| Study | Hold | Required next step |
|---|---|---|
| GSE344527 | adapter required | Targeted Xenium assay: needs panel-aware analysis and an animal/section/slide map before the RNA-seq explorer can represent it. |
| GSE337251 | annotation required | Goat counts, lengths and CPM were downloaded. The current intake adapter supports mouse and rat annotation; goat identifiers and pathway ortholog coverage require a validated mapping. |
| GSE335323 | annotation required | Sheep expression matrix was downloaded. Sheep gene annotation and pathway ortholog mapping are not implemented in this intake adapter. |
| GSE329974 | design review required | Companion allelic-expression series. Requires explicit allele, animal and tissue bindings and a suitable normalized-expression or raw-read workflow. |
| GSE329973 | design review required | Allelic-expression design requires explicit parental-allele and animal bindings before standard contrasts can be fitted. |
| GSE266965 | raw reprocessing required | Public processed inputs are coverage tracks rather than a gene-by-sample count matrix; raw reads must be quantified first. |
| GSE214011 | annotation required | Hamster RSEM data use de novo Trinity identifiers. A validated gene/transcript annotation and length-aware import are required. |
| GSE181298 | annotation required | Hamster RSEM data use de novo Trinity identifiers. A validated gene/transcript annotation and length-aware import are required. |
| GSE137737 | raw reprocessing required | Deposited differential-expression tables cannot replace sample-level input; raw reads need gene quantification. |
| GSE137626 | raw reprocessing required | Deposited differential-expression tables cannot replace sample-level input; raw reads need gene quantification. |
| E-MTAB-16695 | length metadata required | Unscaled Salmon gene counts were downloaded, but effective lengths or quant.sf files are absent from the reviewed processed deposit. This non-3-prime assay needs length-aware import. |
| E-MTAB-8012 | raw reprocessing required | The reviewed deposit supplies raw sequencing reads without a processed gene matrix. |
| E-ERAD-404 | raw reprocessing required | The reviewed deposit supplies raw sequencing reads; technical runs must be combined within the ten biological mice before analysis. |
| E-MTAB-14688 | raw reprocessing required | The reviewed deposit supplies raw sequencing reads without a processed gene matrix. The actual sample table supports three mice per arm. |

GSE214683 was already integrated and was not duplicated. Initial discovery exclusions and exploratory atlas/pilot leads remain documented in the source discovery report; they are not promoted to eligible studies by this intake.

## Reproduce

Run the source fetcher and accession-specific preparers, then:
```powershell
Rscript scripts/run_september5_pipeline.R
$ids = (Get-Content data/intake/september5-2026/analyses.json -Raw | ConvertFrom-Json).analysisId
Rscript scripts/run_mouse_fgsea.R @ids --force
npx tsx scripts/build_september5_bundles.mts
npx tsx scripts/audit_september5_intake.mts
python scripts/report_september5_intake.py
```

The prepared study manifest and per-study source notes specify the importer and analysis lane. Downloading and preparing raw-read-only or unsupported-species candidates requires the additional work listed above.
