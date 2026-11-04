"""Compare unchanged GSE156859 female author Table S5 with retained source and DE.

Run from repository root with bundled Python. --check verifies deterministic outputs.
Author averages are reconstructed as mean(2**deposited_log2_expression), not mean(log2).
Only the published significant-gene table is available; absent rows are not author negatives.
"""
import argparse
import csv
from decimal import Decimal
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

from docx import Document
import numpy as np
from scipy.stats import pearsonr, spearmanr


ROOT = Path.cwd()
OUT = ROOT / "data/author-validation/continued-sources/GSE156859"
DATA = ROOT / "geo_replication/datasets/GSE156859_rnor_fetal_hypothalamus_ozone"
DOCX = OUT / "mmc1.docx"
RAW = DATA / "raw/GSE156859_RNAseq_24_Normalized_counts_Female.txt.gz"
DE = DATA / "processed/GSE156859_DE.tsv"
SCRIPT = ROOT / "scripts/validate_GSE156859_author.py"


def relative(path):
    return path.relative_to(ROOT).as_posix()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def signed_ratio(ratio):
    return ratio if ratio >= 1 else -1 / ratio


def signed_log2(value):
    return math.copysign(math.log2(abs(value)), value)


def correlation(a, b):
    return {"pearson": float(pearsonr(a, b).statistic), "spearman": float(spearmanr(a, b).statistic)}


def half_print_unit(value):
    return 0.5 * 10 ** Decimal(value).as_tuple().exponent


def tsv_text(rows):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]), delimiter="\t", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def build():
    document = Document(DOCX)
    expected_header = ["Gene ID", "0.8 ppm Ozone Average", "Air Average", "Fold Change from Air", "P-value"]
    assert [cell.text for cell in document.tables[4].rows[0].cells] == expected_header
    author = [{"symbol": row.cells[0].text, "ozone": float(row.cells[1].text), "air": float(row.cells[2].text),
               "signed_fold_change": float(row.cells[3].text), "rounded_pvalue": float(row.cells[4].text)}
              for row in document.tables[4].rows[1:]]
    assert len(author) == 168 and len({r["symbol"] for r in author}) == 168
    assert sum(r["signed_fold_change"] > 0 for r in author) == 79
    assert sum(r["signed_fold_change"] < 0 for r in author) == 89
    with gzip.open(RAW, "rt", encoding="utf-8-sig") as handle:
        source = list(csv.DictReader(handle, delimiter="\t"))
    with DE.open(encoding="utf-8-sig") as handle:
        local_rows = list(csv.DictReader(handle, delimiter="\t"))
    local = {row["symbol"]: row for row in local_rows}
    assert len(local) == len(local_rows) == 11083
    assert set(local) == set(source[0]) - {"Sample name", "Exposure", "Gender"}
    assert len(source) == 12 and all(r["Gender"] == "Female" for r in source)
    ozone = np.array([r["Exposure"] == "0.8 ppm ozone" for r in source])
    air = np.array([r["Exposure"] == "Air" for r in source])
    assert sum(ozone) == sum(air) == 6 and np.all(ozone | air)
    stats = {}
    for gene in local:
        z = np.array([float(r[gene]) for r in source])
        uncertainty = np.array([half_print_unit(r[gene]) for r in source])
        transformed = 2 ** z
        source_ozone, source_air = float(np.mean(transformed[ozone])), float(np.mean(transformed[air]))
        stats[gene] = {
            "source_ozone_average": source_ozone,
            "source_air_average": source_air,
            "source_signed_ratio": signed_ratio(source_ozone / source_air),
            "source_log2_ratio_arithmetic_means": math.log2(source_ozone / source_air),
            "source_difference_mean_log2": float(np.mean(z[ozone]) - np.mean(z[air])),
            "ozone_bounds": [float(np.mean(2 ** (z[ozone] - uncertainty[ozone]))), float(np.mean(2 ** (z[ozone] + uncertainty[ozone])))],
            "air_bounds": [float(np.mean(2 ** (z[air] - uncertainty[air]))), float(np.mean(2 ** (z[air] + uncertainty[air])))],
        }
    per_gene = []
    for row in author:
        gene = row["symbol"]
        ss, ll = stats[gene], local[gene]
        average_intervals_overlap = all(
            bounds[0] <= row[group] + 0.005 and bounds[1] >= row[group] - 0.005
            for group, bounds in (("ozone", ss["ozone_bounds"]), ("air", ss["air_bounds"]))
        )
        per_gene.append({
            "symbol": gene,
            "author_ozone_average": row["ozone"], "author_air_average": row["air"],
            "author_signed_linear_fold_change": row["signed_fold_change"],
            "author_pvalue_rounded_2dp": row["rounded_pvalue"],
            "source_ozone_average": ss["source_ozone_average"], "source_air_average": ss["source_air_average"],
            "source_signed_linear_ratio": ss["source_signed_ratio"],
            "source_averages_rounding_intervals_overlap": average_intervals_overlap,
            "signed_ratio_absolute_difference": abs(ss["source_signed_ratio"] - row["signed_fold_change"]),
            "author_signed_ratio_as_log2": signed_log2(row["signed_fold_change"]),
            "source_log2_ratio_arithmetic_means": ss["source_log2_ratio_arithmetic_means"],
            "source_difference_mean_log2": ss["source_difference_mean_log2"],
            "local_log2FC": float(ll["logFC"]), "local_pvalue": float(ll["pvalue"]), "local_padj": float(ll["padj"]),
            "direction_agrees": math.copysign(1, row["signed_fold_change"]) == math.copysign(1, float(ll["logFC"])),
            "local_nominal_p_le_005": float(ll["pvalue"]) <= 0.05,
        })
    authors = {r["symbol"] for r in author}
    ratio_rule = {g for g, r in local.items() if float(r["pvalue"]) <= .05 and abs(stats[g]["source_signed_ratio"]) >= 1.3}
    local_effect_rule = {g for g, r in local.items() if float(r["pvalue"]) <= .05 and abs(float(r["logFC"])) >= math.log2(1.3)}
    mistaken_log_rule = {g for g, r in local.items() if float(r["pvalue"]) <= .05 and abs(float(r["logFC"])) >= 1.3}
    all_local_delta = max(abs(stats[g]["source_difference_mean_log2"] - float(r["logFC"])) for g, r in local.items())
    summary = {
        "datasetId": "rat_fetal_hypo_ozone_gse156859", "reviewDate": "2026-09-04",
        "source": {"pmid": "33031959", "pmcid": "PMC7588867", "doi": "10.1016/j.molmet.2020.101094",
                   "article": "https://pmc.ncbi.nlm.nih.gov/articles/PMC7588867/",
                   "supplementLink": "https://pmc.ncbi.nlm.nih.gov/articles/instance/7588867/bin/mmc1.docx",
                   "retrievedVia": "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7588867/supplementaryFiles",
                   "docx": relative(DOCX), "table": "Table S5; DOCX zero-based table index 4; rendered pages 8-11",
                   "evidenceScope": "Published 168 significant female genes only, rounded means/signed linear ratios/raw p values. Not a full all-gene DE table; no author FDR supplied."},
        "cohort": {"localAirN": 6, "localOzoneN": 6, "sex": "female", "age": "GD21", "authorBiologicalUnit": "six litters per arm", "sampleNames": [r["Sample name"] for r in source]},
        "coverage": {"authorGenes": 168, "authorUp": 79, "authorDown": 89, "localGenes": len(local), "matchedAuthorGenes": len(per_gene), "authorCoverageFraction": 1, "localCoverageFraction": len(per_gene)/len(local)},
        "expressionReconstruction": {
            "formula": "mean(2**deposited_log2_expression) within exposure; signed ratio is ozone/air if up, -air/ozone if down",
            "arithmeticMeanRoundingIntervalMatches": sum(r["source_averages_rounding_intervals_overlap"] for r in per_gene),
            "roundingIntervalAssumption": "Each deposited numeric value is rounded to its printed precision; Table S5 group means are rounded to 0.01. Compare overlapping intervals after exponentiation.",
            "maxOzoneAverageAbsoluteDifference": max(abs(r["source_ozone_average"]-r["author_ozone_average"]) for r in per_gene),
            "maxAirAverageAbsoluteDifference": max(abs(r["source_air_average"]-r["author_air_average"]) for r in per_gene),
            "maxSignedRatioAbsoluteDifference": max(r["signed_ratio_absolute_difference"] for r in per_gene),
            "signedRatioCorrelation": correlation([r["author_signed_linear_fold_change"] for r in per_gene], [r["source_signed_linear_ratio"] for r in per_gene]),
            "allLocalGenesMeanLog2DifferenceMaxDelta": all_local_delta,
        },
        "registeredEffects": {
            "directionAgreement": sum(r["direction_agrees"] for r in per_gene), "directionCompared": len(per_gene),
            "estimandWarning": "Registered limma effect is difference of mean log2 values; author Table S5 uses log2 ratio of arithmetic means when converted to log2. These are different estimands.",
            "log2EffectCorrelation": correlation([r["author_signed_ratio_as_log2"] for r in per_gene], [r["local_log2FC"] for r in per_gene]),
            "log2EffectMeanAbsoluteDifference": float(np.mean([abs(r["author_signed_ratio_as_log2"]-r["local_log2FC"]) for r in per_gene])),
            "log2EffectMaxAbsoluteDifference": max(abs(r["author_signed_ratio_as_log2"]-r["local_log2FC"]) for r in per_gene),
        },
        "statisticalCalls": {
            "sourceThresholdIssue": "Paper prose states log2FC>=1.3 or<=-1.3, but Table S5 is signed linear fold ratio>=1.3. Do not treat 1.3 as the log2 threshold for this table. Author p values are nominal and rounded, not FDR.",
            "authorPublishedSet": 168,
            "matchedAuthorGenesWithLocalNominalPLe005": sum(r["local_nominal_p_le_005"] for r in per_gene),
            "diagnosticSameArithmeticRatioPlusLocalNominalPRule": {"localCalls": len(ratio_rule), "overlap": len(authors & ratio_rule), "authorOnly": sorted(authors-ratio_rule), "localNotListed": sorted(ratio_rule-authors), "descriptiveListJaccard": len(authors & ratio_rule)/len(authors | ratio_rule)},
            "registeredMeanLog2EffectPlusNominalPRule": {"log2EffectCutoff": math.log2(1.3), "localCalls": len(local_effect_rule), "overlap": len(authors & local_effect_rule)},
            "incorrectLiteralLog2CutoffDiagnostic": {"log2EffectCutoff": 1.3, "localCalls": len(mistaken_log_rule)},
            "localFDRLe005": sum(float(r["padj"]) <= .05 for r in local.values()),
            "limitations": "No author nonsignificant-gene p values or adjusted p values. Local-not-listed genes are not called author false negatives. Partek gene-specific multimodel versus limma eBayes is not an identical statistical method; no exact Partek refit claimed.",
        },
        "recommendedStatus": "validated_with_notes / partial",
        "interpretation": "All 168 author genes are present, all directions agree, and all published group averages/signed ratios are reproduced to display/source precision; all 11,083 registered effects equal deposited mean-log2 contrasts. Nominal significance differs for 9 published genes and there are 13 additional diagnostic local calls. Strong partial positive evidence; not full inferential replication or missing processed data.",
    }
    assert summary["expressionReconstruction"]["arithmeticMeanRoundingIntervalMatches"] == 168
    assert summary["expressionReconstruction"]["maxSignedRatioAbsoluteDifference"] <= .005
    assert all_local_delta < 1e-12 and summary["registeredEffects"]["directionAgreement"] == 168
    return {"comparison.summary.json": json.dumps(summary, indent=2, ensure_ascii=False)+"\n", "comparison.per-gene.tsv": tsv_text(per_gene)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build()
    inputs = [DOCX, OUT/"europepmc-supplementary.download", RAW, DE, DATA/"metadata/GSE156859_family.soft.gz", DATA/"metadata/GSE156859_source_files.tsv", SCRIPT]
    manifest = {"reviewDate": "2026-09-04", "inputs": [{"path":relative(p), "bytes":p.stat().st_size, "sha256":sha(p)} for p in inputs],
                "outputs": [{"path":relative(OUT/name), "bytes":len(content.encode("utf-8")), "sha256":hashlib.sha256(content.encode("utf-8")).hexdigest()} for name,content in outputs.items()]}
    outputs["artifact-manifest.json"] = json.dumps(manifest, indent=2)+"\n"
    for name, content in outputs.items():
        target = OUT / name
        if args.check:
            assert target.read_text(encoding="utf-8") == content, f"Output drift: {target}"
        else:
            target.write_text(content, encoding="utf-8", newline="")
    print("GSE156859 author comparison " + ("check passed" if args.check else "written"))
    print(outputs["comparison.summary.json"])
