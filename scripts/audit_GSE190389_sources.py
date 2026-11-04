"""Audit original TMM expression, retained samples and exact-symbol source scale."""
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd

root = Path(__file__).resolve().parents[1]
out = root / "data/author-validation/continued-sources/GSE190389"
expression_path = root / "data/author-validation/continued-sources/GSE190389_TMM_workbook.xlsx"
assert hashlib.sha256(expression_path.read_bytes()).hexdigest() == "a02b41bc076b2d472cb5fe4a64a3d051c109f847b830648b156aa7c5419c8fa4"
ds = root / "geo_replication/datasets/GSE190389_mmus_scn_trf"
expression = pd.read_excel(expression_path, sheet_name="SCN")
inventory = pd.read_excel(expression_path, sheet_name="Sample list")
author_de = pd.read_excel(root / "data/author-validation/continued-sources/GSE190389_DE_workbook.xlsx", sheet_name="SCN")
raw = pd.read_csv(ds / "raw/GSE190389_SCN_TRF_vs_ALF_count_estimates.tsv.gz", sep="\t")
samples = pd.read_csv(ds / "metadata/GSE190389_samplesheet.tsv", sep="\t")
raw_source_path = ds / "raw/GSE190389_raw.csv.gz"
assert hashlib.sha256(raw_source_path.read_bytes()).hexdigest() == "fb595d00aac0860a8921f53b26ad7ea817abb80f27517321017d5a6340f172f6"
source_columns = ["Unnamed: 0", *samples["sample"]]
# The deposited CSV includes single-byte Western European gene-name characters;
# decode those bytes explicitly, then require exact prepared-symbol/count equality.
original = pd.read_csv(raw_source_path, usecols=source_columns, encoding="latin1")
collapsed_rows = original.groupby("Unnamed: 0", sort=False)[list(samples["sample"])].sum()
prepared_rows = raw.set_index("symbol").loc[collapsed_rows.index, list(samples["sample"])]
assert np.array_equal(collapsed_rows.to_numpy(), prepared_rows.to_numpy())
assert expression.ensembl_gene_id.is_unique and author_de.ensembl_gene_id.is_unique
assert set(expression.ensembl_gene_id) == set(author_de.ensembl_gene_id)
author_de = author_de.set_index("ensembl_gene_id").loc[expression.ensembl_gene_id].reset_index()
bridge = expression[["ensembl_gene_id", "external_gene_name"]].merge(
    author_de[["ensembl_gene_id", "external_gene_name"]], on="ensembl_gene_id", validate="one_to_one",
    suffixes=("_expression", "_DE"))
bridge.to_csv(out / "observed_identifier_bridge.tsv", sep="\t", index=False)
columns = [c for c in expression if c.startswith("SCN_")]
assert set(columns) == set(samples["sample"]) and len(columns) == 45
sample_inventory = inventory[inventory["Sample name"].astype(str).str.startswith("SCN_")]
assert len(sample_inventory) in (45, 48)
outlier_names = set(sample_inventory.loc[sample_inventory.Comments.fillna("").str.lower() == "outlier", "Sample name"])
assert outlier_names == set(sample_inventory["Sample name"]) - set(columns)
sample_inventory.to_csv(out / "author_sample_inventory.tsv", sep="\t", index=False)
expression[["ensembl_gene_id", "description", "external_gene_name", "gene_biotype", "ensembl_peptide_id"]].to_csv(out / "author_identifier_inventory.tsv", sep="\t", index=False)
expected = {f"SCN_ZT{zt}_{feeding}_{rep}_1" for zt in range(0,24,2) for feeding in ["ALF","TRF"] for rep in [1,2]}
valid = expression.external_gene_name.notna() & ~expression.external_gene_name.duplicated(keep=False)
shared = expression[valid].merge(raw, left_on="external_gene_name", right_on="symbol", suffixes=("_author", "_raw"), validate="one_to_one")
factors = []
residuals = []
for sample in columns:
    x = shared[sample + "_raw"].to_numpy()
    y = shared[sample + "_author"].to_numpy()
    positive = (x > 0) & (y > 0)
    ratio = x[positive] / y[positive]
    factor = np.median(ratio)
    expected_expression = x/factor
    residual = np.abs(y-expected_expression)/np.maximum(1, np.abs(y))
    residuals.append(residual)
    factors.append({"sample":sample,"raw_per_author_normalized_unit_median":factor,
                    "ratio_q01":np.quantile(ratio,.01),"ratio_q99":np.quantile(ratio,.99),
                    "genes_relative_residual_le_1e5":int((residual<=1e-5).sum()),
                    "median_relative_residual":np.median(residual),"max_relative_residual":np.max(residual)})
pd.DataFrame(factors).to_csv(out / "author_expression_column_scaling.tsv", sep="\t", index=False, float_format="%.15g")
residuals = np.stack(residuals,axis=1)
shared["max_relative_residual_after_column_scaling"] = residuals.max(axis=1)
shared["median_relative_residual_after_column_scaling"] = np.median(residuals,axis=1)
alf = [c+"_author" for c in columns if "_ALF_" in c]
trf = [c+"_author" for c in columns if "_TRF_" in c]
shared["author_expression_mean_ALF"] = shared[alf].mean(axis=1)
shared["author_expression_mean_TRF"] = shared[trf].mean(axis=1)
with np.errstate(divide="ignore", invalid="ignore"):
    shared["log2_ratio_author_expression_means"] = np.log2(shared.author_expression_mean_TRF/shared.author_expression_mean_ALF)
joined = shared[["ensembl_gene_id", "symbol", "max_relative_residual_after_column_scaling",
                 "median_relative_residual_after_column_scaling", "author_expression_mean_ALF",
                 "author_expression_mean_TRF", "log2_ratio_author_expression_means"]].merge(
    author_de[["ensembl_gene_id", "logFC (TRF/ALF)", "FDR"]], on="ensembl_gene_id", validate="one_to_one")
joined.to_csv(out / "author_expression_source_comparison.tsv", sep="\t", index=False, float_format="%.15g")
discrepant = joined[joined.max_relative_residual_after_column_scaling > 1e-5].sort_values("max_relative_residual_after_column_scaling", ascending=False)
discrepant.to_csv(out / "same_symbol_expression_discrepancies.tsv", sep="\t", index=False, float_format="%.15g")
summary = {
    "schemaVersion":1,
    "authorExpressionRows":len(expression),"exactlySharedRawSymbols":len(shared),
    "preparedCountsExactlyEqualOriginalGEOAfterTwoDuplicateSymbolRowsSummed":True,
    "originalSourceRows":len(original),"preparedRows":len(raw),
    "originalCSVDecoding":"latin1; exact prepared Unicode symbols and all selected counts checked",
    "all45AuthorExpressionColumnsEqualLocalRetainedSampleSet":True,
    "absentFromNominal48Design":sorted(expected-set(columns)),
    "sampleInventoryRows":len(sample_inventory),
    "explicitAuthorOutlierNames":sorted(outlier_names),
    "sampleInventoryColumns":list(sample_inventory.columns),
    "sampleInventoryRecords":sample_inventory.fillna("").to_dict(orient="records"),
    "authorExpressionAndDERowsHaveExactSameEnsemblIDSet":True,
    "authorExpressionVersusDESymbolDifferences":int((bridge.external_gene_name_expression.fillna("") != bridge.external_gene_name_DE.fillna("")).sum()),
    "genesConsistentWithSingleColumnScalingAll45Samples_rtol1e5":int((residuals.max(axis=1)<=1e-5).sum()),
    "genesFailSingleColumnScalingInAnySample":int((residuals.max(axis=1)>1e-5).sum()),
    "sameSymbolDiscrepantRowsWithAuthorFDR_le_005":int((discrepant.FDR<=.05).sum()),
    "authorDERelationshipToLog2MeanTMMRatioPearson":float(joined["logFC (TRF/ALF)"].corr(joined.log2_ratio_author_expression_means.replace([np.inf,-np.inf],np.nan))),
    "warnings":["The read-only spreadsheet parser warned of unsupported extension; original XLSX bytes were never rewritten.",
        "A fixed 1e-5 numerical residual threshold checks exported expression correspondence, not a biological significance rule.",
        "No aliases were inferred from names or numeric fingerprint matches. Discordant same-symbol rows remain flagged, not reassigned.",
        "GEO says resequencings are collapsed; published method specifies DESeq2 collapseReplicates. Fractional entries alone do not establish averaging."],
}
(out / "source_audit.summary.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
print(json.dumps({k:v for k,v in summary.items() if k!="sampleInventoryRecords"},indent=2))
print(sample_inventory.to_string(index=False))
