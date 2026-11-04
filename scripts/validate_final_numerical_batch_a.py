"""Bounded source/estimand audit. Never score different contrasts as disagreement.

Run the companion R script first. Originals are opened read-only. TSV/JSON outputs
are audit evidence, not production expression or DE outputs.
"""
from pathlib import Path
import hashlib
import json
import zipfile
import numpy as np
import openpyxl
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data/author-validation/continued-sources/final-numerical-batch-a"
DATA = ROOT / "geo_replication/datasets"
DIRS = {
    "GSE189945": "GSE189945_mmus_arc_development",
    "GSE266472": "GSE266472_mmus_scn_photoperiod",
    "GSE128660": "GSE128660_mmus_hypothalamus_heat",
}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def rel(path):
    return path.relative_to(ROOT).as_posix()


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    dev = BASE / "GSE189945"
    sheets = []
    for path in sorted((dev / "tables").glob("*.xlsx")):
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet in book:
            sheets.append({"file": rel(path), "sheet": sheet.title,
                           "worksheetDeclaredDataRows": sheet.max_row - 1,
                           "columns": list(next(sheet.values))})
        book.close()
    write_json(dev / "workbook-inventory.json", {"schemaVersion": 1, "sheets": sheets,
               "dimensionNote": "Inventory row counts use worksheet dimensions; S1 and S4b are fully parsed below."})
    author_samples = pd.read_excel(dev / "tables/sciadv.abo3991_table_s1.xlsx")
    author_samples.to_csv(dev / "author-sample-metadata.tsv", sep="\t", index=False)
    author = pd.read_excel(dev / "tables/sciadv.abo3991_table_s4.xlsx", sheet_name="Table S4b - age_neuron")
    author.to_csv(dev / "author-pooled-sex-age-DE.tsv", sep="\t", index=False, na_rep="NA")
    local_dir = DATA / DIRS["GSE189945"]
    local_samples = pd.read_csv(local_dir / "metadata/GSE189945_samplesheet.tsv", sep="\t")
    cohort = local_samples.merge(author_samples[["sample_id", "cell_type", "age", "sex", "exclude_rna"]],
                                 left_on="sample", right_on="sample_id", how="left", suffixes=("_local", "_author"), validate="one_to_one")
    assert len(cohort) == 10 and cohort.sample_id.notna().all()
    assert (cohort.exclude_rna == 0).all() and (cohort.sex_author == "f").all()
    assert (cohort.age == cohort.age_days).all() and (cohort.cell_type_author == "neuron").all()
    cohort.to_csv(dev / "local-author-cohort-audit.tsv", sep="\t", index=False)
    source = pd.read_csv(local_dir / "raw/GSE189945_MacKay_ARH_RNAseq_VSD.csv.gz")
    matrix = pd.read_csv(local_dir / "processed/GSE189945_analysis_matrix.tsv.gz", sep="\t")
    assert len(source) == len(matrix)
    annotated = source.gene_name.notna()
    assert source.loc[annotated, "gene_name"].equals(matrix.loc[annotated, "symbol"])
    placeholders = [f"UNANNOT_ROW_{index + 1}" for index in source.index[~annotated]]
    assert matrix.loc[~annotated, "symbol"].tolist() == placeholders
    sample_ids = local_samples["sample"].tolist()
    delta = source[sample_ids].to_numpy() - matrix[sample_ids].to_numpy()
    assert np.isfinite(delta).all() and np.abs(delta).max() < 1e-8
    sig = (author.padj < .05) & (author.iloc[:, 3].abs() > 1)
    assert int(sig.sum()) == 863
    code = dev / "code/RNA-seq/DESeq2 analysis/1 - deseq2 analysis rev2.R"
    assert 'coef="group_neuron35f_vs_neuron12f"' in code.read_text(encoding="utf-8-sig")
    archive_paths = zipfile.ZipFile(dev / "author_code.zip").namelist()
    data_files = [p for p in archive_paths if p.lower().endswith((".csv", ".tsv", ".rds", ".rdata"))]
    csv_outputs = [p for p in data_files if p.startswith("RNA-seq/")]
    assert not csv_outputs
    assert set(data_files) == {"WGBS/Binning/file_list.csv", "WGBS/Binning/mm10_chromlength.csv"}
    write_json(dev / "author-summary.json", {
        "schemaVersion": 1, "authorRows": len(author), "uniqueAuthorSymbols": int(author.gene_name.nunique()),
        "duplicateSymbolExcessRows": int(author.gene_name.duplicated().sum()),
        "finiteAdjustedP": int(author.padj.notna().sum()), "paperRule": "padj < 0.05 and abs(shrunken log2FC) > 1",
        "authorPooledSexAgeSignificant": int(sig.sum()),
        "authorSampleRows": len(author_samples), "authorIncludedRNA": int((author_samples.exclude_rna == 0).sum()),
        "authorExcludedRNA": author_samples.loc[author_samples.exclude_rna != 0, "sample_id"].tolist(),
        "localSamplesExactAuthorMetadataMatch": len(cohort), "localGroups": local_samples.group.value_counts().to_dict(),
        "sourceVSDRows": len(source), "sourceVSDSamples": len(source.columns) - 4,
        "unannotatedSourceRowsWithExplicitPlaceholders": int((~annotated).sum()),
        "localInputCellsCompared": int(delta.size), "exactNumericCells": int((delta == 0).sum()),
        "maximumAbsoluteInputDifference": float(np.abs(delta).max()),
        "femaleAgeCoefficientInArchivedCode": "group_neuron35f_vs_neuron12f",
        "RNAResultFilesInCodeArchive": csv_outputs, "unrelatedWGBSMetadataFiles": data_files,
        "localAuthorDEComparisonPerformed": False,
        "reason": "S4b is pooled-sex age; the local result is female-only. Tables S2/S3 female-age entries concern methylation, not RNA differential expression. Archived female-age code is not a deposited numerical output."
    })

    scn_dir = DATA / DIRS["GSE266472"]
    scn_samples = pd.read_csv(scn_dir / "metadata/GSE266472_samplesheet.tsv", sep="\t")
    assert len(scn_samples) == 18 and (scn_samples.projected_zt == 12).all()
    assert scn_samples.group.value_counts().to_dict() == {"case": 9, "control": 9}
    scn_samples.to_csv(BASE / "GSE266472/local-cohort.tsv", sep="\t", index=False)
    scn_author = json.loads((BASE / "GSE266472/author-summary.json").read_text())
    assert (scn_author["rows"], scn_author["significant"], scn_author["positive"], scn_author["negative"]) == (16856, 1518, 546, 972)
    write_json(BASE / "GSE266472/local-scope-summary.json", {
        "schemaVersion": 1, "localSamples": len(scn_samples), "groups": scn_samples.group.value_counts().to_dict(),
        "projectedZT": [12], "batchGroupCounts": scn_samples.groupby(["seq_batch", "group"]).size().reset_index(name="n").to_dict("records"),
        "authorLocalDEComparisonPerformed": False, "reason": "Local pZT12 versus author all circadian times. Author workbook has no pZT12-specific DE result."
    })

    heat_dir = DATA / DIRS["GSE128660"]
    retrieval_log = json.loads((BASE / "GSE128660/retrieval-log.json").read_text(encoding="utf-8"))
    for attempt in retrieval_log["attempts"]:
        if "savedResponse" not in attempt:
            continue
        response = BASE / "GSE128660" / attempt["savedResponse"]
        assert response.suffix in {".xml", ".html"}, "Failed responses must not use scientific-data extensions"
        assert response.stat().st_size == attempt["bytes"] and digest(response) == attempt["sha256"]
        assert not zipfile.is_zipfile(response), "Failed-response record unexpectedly contains an archive"
    heat_samples = pd.read_csv(heat_dir / "metadata/GSE128660_samplesheet.tsv", sep="\t")
    heat_source_inventory = []
    for path in sorted((heat_dir / "raw").glob("*.FPKM.xlsx")):
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)
        headers = list(next(book.active.values))
        assert headers[0] == "gene_id" and len(headers) == 2
        heat_source_inventory.append({"file": rel(path), "columns": headers,
                                      "meaning": "One-sample FPKM expression, not counts or differential-expression results"})
        book.close()
    assert len(heat_source_inventory) == 16
    assert heat_samples.group.value_counts().to_dict() == {"control": 8, "case": 8}
    write_json(BASE / "GSE128660/source-data-audit.json", {
        "schemaVersion": 1, "localGroups": heat_samples.group.value_counts().to_dict(),
        "files": heat_source_inventory, "resultComparisonPerformed": False,
        "reason": "Official supplemental XLSX not retrieved; public sample workbooks contain only FPKM. Do not reconstruct DESeq2 counts from FPKM or interpret failed access as disagreement."
    })

    files = [p for p in BASE.rglob("*") if p.is_file() and p.name != "manifest.json"]
    files += [Path(__file__), ROOT / "scripts/validate_final_numerical_batch_a.R"]
    for accession, directory in DIRS.items():
        local = DATA / directory
        files += [local / f"metadata/{accession}_samplesheet.tsv", local / f"processed/{accession}_DE.tsv"]
    files += [local_dir / "raw/GSE189945_MacKay_ARH_RNAseq_VSD.csv.gz", local_dir / "processed/GSE189945_analysis_matrix.tsv.gz"]
    files += sorted((heat_dir / "raw").glob("*.FPKM.xlsx"))
    entries = [{"path": rel(p), "bytes": p.stat().st_size, "sha256": digest(p)} for p in sorted(set(files))]
    write_json(BASE / "manifest.json", {"schemaVersion": 1, "algorithm": "SHA-256", "reviewedAt": "2026-09-04", "files": entries})
    print(json.dumps({"filesHashed": len(entries), "developmentAuthorDEGs": 863, "photoperiodAuthorDEGs": 1518,
                      "developmentInputMaxAbsDifference": float(np.abs(delta).max()),
                      "heatFPKMFilesInspected": len(heat_source_inventory),
                      "filesOver100MB": [entry for entry in entries if entry["bytes"] > 100_000_000]}, indent=2))


if __name__ == "__main__":
    main()
