"""Compare new HFD fits with original deposited author statistics.

GSE107324 is read directly from its GEO XLSX on every run. Its author logFC
direction is explicitly reversed in the paper (control/HFD), so the comparison
negates it once. Outputs distinguish agreement of effects from significance.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import io
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import openpyxl
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/author-validation/hfd-intake-2026-09-12"
MATERNAL = ROOT / "geo_replication/datasets/GSE107324_rnor_hypothalamus_maternal_hfd"
PAPER = ROOT / "data/quality/hfd-intake-2026-09-12/discovery/GSE107324/paper.html"
CHECK = '--check' in sys.argv


def save_text(path, text, newline=None):
    if CHECK:
        assert path.read_text(encoding='utf-8') == text, f'Stale author evidence: {rel(path)}'
    else:
        path.write_text(text, encoding='utf-8', newline=newline)


def rel(path):
    return path.relative_to(ROOT).as_posix()


def file_record(path):
    with path.open("rb") as handle:
        sha = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"path": rel(path), "sha256": sha, "bytes": path.stat().st_size}


def save_table(path, header, rows):
    handle = io.StringIO(newline='')
    writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    # A table's SHA-256 is recorded in its measurement, so write its LF bytes on any OS.
    save_text(path, handle.getvalue(), newline='')


def compare_maternal(sex):
    target = OUT / "GSE107324"
    if not CHECK: target.mkdir(parents=True, exist_ok=True)
    workbook = MATERNAL / "raw/source" / f"GSE107324_{sex}DifferentialCounts0_50_topTable_edgeR_tabular_processed_data.xlsx"
    de_file = MATERNAL / "processed" / f"GSE107324_{sex}_DE.tsv"
    with de_file.open(encoding="utf-8") as handle:
        pipeline_rows = list(csv.DictReader(handle, delimiter="\t"))
    pipeline = {r["symbol"]: r for r in pipeline_rows}
    assert len(pipeline) == len(pipeline_rows), "Pipeline has duplicate tested symbols"
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    original_rows = list(wb.active.values)
    assert original_rows[0][0:6] == ("Name", "logFC", "logCPM", "LR", "PValue", "adj.p.value")
    paired, author_only, excluded = [], [], []
    source_gene_names = set()
    all_author_fdr05 = 0
    for xlsx_row, row in enumerate(original_rows[1:], 2):
        if not isinstance(row[0], str):
            excluded.append({"xlsxRow": xlsx_row, "reason": "Excel-damaged source identifier", "sourceValue": str(row[0])})
            continue
        gene = row[0].strip()
        assert gene not in source_gene_names, "Duplicate source symbol would invalidate pairing"
        source_gene_names.add(gene)
        author_lfc = -float(row[1])
        author_p, author_q = float(row[4]), float(row[5])
        all_author_fdr05 += author_q < 0.05
        if gene not in pipeline:
            author_only.append({"gene": gene, "xlsxRow": xlsx_row, "authorPadj": author_q})
            continue
        fitted = pipeline[gene]
        ours = float(fitted["logFC"])
        assert all(math.isfinite(v) for v in [author_lfc, ours, author_p, author_q])
        paired.append([gene, xlsx_row, float(row[1]), author_lfc, ours, author_p, author_q,
                       float(fitted["pvalue"]), float(fitted["padj"]), bool(np.sign(author_lfc) == np.sign(ours))])
    wb.close()
    assert len(paired) > 1000
    a = np.array([r[3] for r in paired])
    b = np.array([r[4] for r in paired])
    pearson = float(np.corrcoef(a, b)[0, 1])
    spearman = float(spearmanr(a, b).statistic)
    nonzero = (a != 0) & (b != 0)
    direction_agreement = float((np.sign(a[nonzero]) == np.sign(b[nonzero])).mean())
    author_sig = [r for r in paired if r[6] < 0.05]
    paired_path = target / f"{sex}-paired-effects.tsv"
    save_table(paired_path, ["gene", "xlsx_row", "source_logFC_control_vs_hfd", "author_logFC_hfd_vs_control", "pipeline_logFC_hfd_vs_control",
                             "author_pvalue", "author_padj", "pipeline_pvalue", "pipeline_padj", "direction_agrees"], paired)
    report = {
        "accession": "GSE107324", "studyId": "rat_hypo_maternal_hfd_gse107324", "track": sex,
        "contrast": "hfd_vs_control", "analysisId": f"GSE107324_{sex}", "reviewed": "2026-09-12",
        "evidenceKind": "independent_deposited_author_table", "sourceWorkbook": file_record(workbook),
        "pipelineDE": file_record(de_file), "paper": file_record(PAPER), "pairedEffects": file_record(paired_path),
        "sourceUrl": "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE107324",
        "paperUrl": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0189492",
        "directionSource": "Paper Results subsection Maternal high fat diet alters neonatal hypothalamic transcriptome at PN10 explicitly defines negative source logFC as higher expression in HFD. Workbook columns 2 and 21-32 agree with that convention.",
        "sourceMultiplier": -1, "nAuthorRows": len(original_rows) - 1, "nAuthorValidSymbols": len(source_gene_names),
        "nPipelineRows": len(pipeline_rows), "nPaired": len(paired), "nNonzeroPaired": int(nonzero.sum()),
        "pearson": pearson, "spearman": spearman, "directionAgreement": direction_agreement,
        "authorFdr05InFullValidSource": all_author_fdr05, "authorFdr05InPairedUniverse": len(author_sig),
        "pipelineFdr05InPairedUniverse": sum(r[8] < 0.05 for r in paired),
        "authorFdr05RetainedByPipeline": sum(r[8] < 0.05 for r in author_sig),
        "authorSignificantDirectionAgreement": sum(r[9] for r in author_sig) / len(author_sig) if author_sig else None,
        "authorOnly": author_only, "excludedIdentifiers": excluded,
        "effectAgreementRule": "Pearson >= 0.9 OR direction agreement >= 0.9 across all comparable tested named genes.",
        "effectAgreementPass": bool(pearson >= 0.9 or direction_agreement >= 0.9),
        "significanceConcordance": "The standardized edgeR quasi-likelihood refit does not reproduce the deposited author's significance calls. Effect agreement must not be described as reproduction of those discoveries.",
        "cohortCaveat": "Six samples per sex and diet. Paper defines n as litters; deposited GSM-to-litter identifiers are unavailable. Sexes remain separate, with no pooled cross-sex replication claim."
    }
    report_path = target / f"{sex}-measurement.json"
    save_text(report_path, json.dumps(report, indent=2) + "\n")
    summary = {k: report[k] for k in ["accession", "track", "analysisId", "nPaired", "pearson", "spearman", "directionAgreement", "authorFdr05InPairedUniverse", "pipelineFdr05InPairedUniverse", "effectAgreementPass"]}
    summary["measurement"] = rel(report_path)
    return summary


def review_gse104709():
    target = OUT / "GSE104709"
    if not CHECK: target.mkdir(parents=True, exist_ok=True)
    article = ROOT / "geo_replication/datasets/GSE104709_mmus_cvh_hfd_rnaseq/metadata/PMC5945034_author_article.xml"
    tree = ET.parse(article)
    seen, inventory = set(), []
    for item in tree.iter("supplementary-material"):
        media = item.find("media")
        if media is None:
            continue
        name = media.get("{http://www.w3.org/1999/xlink}href")
        if name in seen:
            continue
        seen.add(name)
        inventory.append({"filename": name, "label": item.findtext("label"),
                          "description": " ".join("".join(item.find("caption").itertext()).split())})
    report = {"accession": "GSE104709", "reviewed": "2026-09-12", "article": file_record(article),
              "status": "matching_author_effect_table_unavailable", "supplementaryInventory": inventory,
              "sourceUrl": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0196743",
              "datasetUrl": "https://datadryad.org/dataset/doi%3A10.5061/dryad.qm01v75",
              "reason": "The article supplies a significant-gene membership table across filtering/model choices, targeted expression figures, and an ANOVA result supplement; these do not provide a complete comparable chronic-HFD gene-effect table. The GSEA supplement tests opposing diet-switch arms, which differs from the chronic HFD versus chow comparison.",
              "downloadAttempts": [{"url": "https://datadryad.org/api/v2/files/77613/download", "httpStatus": 401},
                                   {"url": "https://datadryad.org/downloads/file_stream/77613", "httpStatus": 403}],
              "dryadEvidence": [file_record(target / filename) for filename in ["dryad-dataset.json", "dryad-files.json", "dryad-page.html"]],
              "conclusion": "No numerical author concordance claimed; narrative marker agreement and internal refits are not substituted for independent author statistics."}
    path = target / "author-source-review.json"
    save_text(path, json.dumps(report, indent=2) + "\n")
    return {"accession": "GSE104709", "measurement": rel(path), "status": report["status"]}


if __name__ == "__main__":
    if not CHECK: OUT.mkdir(parents=True, exist_ok=True)
    results = [compare_maternal(sex) for sex in ["male", "female"]]
    results.append(review_gse104709())
    save_text(OUT / "summary.json", json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))
