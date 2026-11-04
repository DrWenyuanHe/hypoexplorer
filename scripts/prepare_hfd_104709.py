#!/usr/bin/env python3
"""Prepare authenticated GSE104709 normalized expression for the HFD intake.

Run from any directory with Python 3, numpy and pandas. Downloads are optional
when the pinned source files are already present. This script never edits the
shared pipeline configuration or explorer registry and does not perform DE.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ACC = "GSE104709"
BASE = ROOT / "geo_replication/datasets/GSE104709_mmus_cvh_hfd_rnaseq"
OUT = ROOT / "data/quality/hfd-intake-2026-09-12"
SOURCE_FILES = [
    ("raw/GSE104709_Gene_quant.txt.gz",
     "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104709/suppl/GSE104709_Gene_quant.txt.gz",
     "b3fb650e9b152a8e7c82397769b33d7aca2eadc2829e4c1be346db653da2fc70",
     "Official GEO author PORT-normalized read counts and author gene symbols"),
    ("raw/GSE104709_series_matrix.txt.gz",
     "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104709/matrix/GSE104709_series_matrix.txt.gz",
     "da8858ef0d49af913a74ccc5b67098e68152d7f7925c3dfb59abc821886878a1",
     "Official GEO sample metadata; expression table is empty for this RNA-seq study"),
    ("metadata/GSE104709_family.soft.gz",
     "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE104nnn/GSE104709/soft/GSE104709_family.soft.gz",
     "388b1839a555c90322cba62f00b735b9ac58921e0db1a72783bb1b28af7713fc",
     "Official GEO family metadata with GSM and BioSample identifiers"),
    ("metadata/PMC5945034_author_article.xml",
     "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5945034/fullTextXML",
     "ca7814649b9c1b5acabe7434959d436ac6e5747f5b71be38eebff1ba049d3973",
     "Author open-access article; two-mouse RNA pools, diet and normalization methods"),
]


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_tsv(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = frame.to_csv(sep="\t", index=False, lineterminator="\n").encode("utf-8")
    path.write_bytes(gzip.compress(data, mtime=0) if path.suffix == ".gz" else data)


def matrix_metadata(path: Path) -> dict[str, list[list[str]]]:
    meta: dict[str, list[list[str]]] = {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for row in csv.reader(stream, delimiter="\t"):
            if row and row[0].startswith("!") and len(row) > 1:
                meta.setdefault(row[0], []).append(row[1:])
    return meta


def source_manifest(offline: bool) -> None:
    rows = []
    for filename, url, expected, role in SOURCE_FILES:
        path = BASE / filename
        if not path.exists():
            if offline:
                raise FileNotFoundError(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(url, timeout=120) as response:
                payload = response.read()
            if hashlib.sha256(payload).hexdigest() != expected:
                raise ValueError(f"Source changed at {url}; review before replacing pinned input")
            path.write_bytes(payload)
        observed = sha(path)
        assert observed == expected, f"Source checksum mismatch: {path}"
        rows.append(dict(file=relative(path), bytes=path.stat().st_size,
                         sha256=expected, source=url, role=role,
                         observed_bytes=path.stat().st_size,
                         observed_sha256=observed, fetched="2026-09-12"))
    write_tsv(pd.DataFrame(rows), BASE / "metadata/GSE104709_source_files.tsv")


def exclusion_evidence() -> dict:
    path = OUT / "excluded/GSE127056/GSE127056_series_matrix.txt.gz"
    if not path.exists():
        return dict(accession="GSE127056", decision="excluded", reason="Diet and age confounded")
    meta = matrix_metadata(path)
    gsms = meta["!Sample_geo_accession"][0]
    titles = meta["!Sample_title"][0]
    ages = next(row for row in meta["!Sample_characteristics_ch1"] if row[0].startswith("age:"))
    diets = next(row for row in meta["!Sample_characteristics_ch1"] if row[0].startswith("diet:"))
    assert ages == ["age: 10-12 wks"] * 3 + ["age: 12-14 wks"] * 3 + ["age: 14-16 wks"] * 3
    write_tsv(pd.DataFrame(dict(gsm=gsms, title=titles, age=ages, diet=diets)),
              path.parent / "GSE127056_age_diet_evidence.tsv")
    result = dict(
        accession="GSE127056", decision="excluded",
        reason="No age-matched normal-chow controls are deposited. Diet and age are inseparable in this series.",
        control="GSM3625298-GSM3625300: normal chow, 10-12 weeks of age",
        hfd_4wk="GSM3625301-GSM3625303: HFD for 4 weeks, 12-14 weeks of age",
        hfd_8wk="GSM3625304-GSM3625306: HFD for 8 weeks, 14-16 weeks of age",
        sample_counts=dict(control=3, hfd_4wk=3, hfd_8wk=3),
        source=relative(path), sha256=sha(path),
        source_url="https://ftp.ncbi.nlm.nih.gov/geo/series/GSE127nnn/GSE127056/matrix/GSE127056_series_matrix.txt.gz",
        geo_url="https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE127056",
        publication_doi="10.1038/s41398-019-0470-1",
        notes="Deposited expression is authentic log2 RMA-normalized array data. No statistical age adjustment can separate age from diet because age strata do not overlap between arms. Exclusion concerns this deposited comparison, not every experiment in the publication.",
    )
    (path.parent / "exclusion.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def prepare(offline: bool) -> None:
    source_manifest(offline)
    OUT.mkdir(parents=True, exist_ok=True)
    meta = matrix_metadata(BASE / "raw/GSE104709_series_matrix.txt.gz")
    assert meta["!Series_platform_id"][0] == ["GPL21103"]
    assert "high throughput sequencing" in meta["!Series_type"][0][0]
    processing = " ".join(row[0] for row in meta["!Sample_data_processing"])
    assert "PORT-normalized" in processing and "randomly re-samples" in processing
    article = ET.parse(BASE / "metadata/PMC5945034_author_article.xml")
    article_text = " ".join(article.getroot().itertext())
    assert "two mRNA samples per condition were randomly chosen and pooled equally" in article_text
    assert "remaining 21 samples" in article_text

    frame = pd.read_csv(BASE / "raw/GSE104709_Gene_quant.txt.gz", sep="\t", keep_default_na=False)
    assert frame.shape == (21654, 23), "Deposited matrix shape changed"
    assert not frame.id.duplicated().any()
    assert frame.id.str.fullmatch(r"ENSMUSG\d+").all()
    columns = frame.columns[1:-1].tolist()
    values = frame[columns].to_numpy(dtype=float)
    assert np.isfinite(values).all() and (values >= 0).all()
    assert np.equal(values, np.floor(values)).all()

    gsm = meta["!Sample_geo_accession"][0]
    titles = meta["!Sample_title"][0]
    conditions = next(row for row in meta["!Sample_characteristics_ch1"]
                      if row[0].startswith("dietary condition:"))
    # GEO omits the leading zero in single-digit sample numbers. This exact
    # reversible formatting rule maps all 21 deposited expression columns.
    rows = []
    for accession, title, condition in zip(gsm, titles, conditions, strict=True):
        prefix, number = title.rsplit(".", 1)
        sample = f"{prefix}.{int(number):02d}"
        assert sample in columns
        group = "control" if condition == "dietary condition: RC Only" else (
            "case" if condition == "dietary condition: HFD Only" else "exclude")
        rows.append(dict(sample=accession, source_sample=sample, group=group, included=group != "exclude",
                         gsm=accession, geo_title=title, geo_condition=condition,
                         unit_id=accession, unit_type="two-mouse RNA pool", pool_size=2,
                         pool_members="not deposited", sex="male",
                         tissue="ventral/circumventricular hypothalamus",
                         exclusion_reason="" if group != "exclude" else "diet-switch arm outside chronic HFD vs chow contrast"))
    sheet = pd.DataFrame(rows)
    assert set(sheet["source_sample"]) == set(columns) and not sheet["sample"].duplicated().any()
    assert sheet.group.value_counts().to_dict() == dict(exclude=11, control=5, case=5)
    selected = sheet.loc[sheet.included, "source_sample"].tolist()
    write_tsv(sheet, BASE / "metadata/GSE104709_samplesheet.tsv")

    symbols = frame.geneSymbol.str.strip()
    assert symbols.str.len().gt(0).all() and not symbols.str.contains(r"\s|;|///").any()
    gene_map = pd.DataFrame(dict(gene_id=frame.id, symbol=symbols,
                                mapping_source="author geneSymbol in deposited quantification table"))
    write_tsv(gene_map, BASE / "metadata/GSE104709_author_gene_map.tsv")
    # Sum same-symbol rows on the author's linear normalized-read scale before
    # applying log2(x+1). Do not average log expression, infer raw counts, or
    # choose a representative row using a significance statistic.
    linear = frame[columns].groupby(symbols, sort=False).sum()
    linear.index.name = "symbol"
    assert np.array_equal(linear.sum().to_numpy(), frame[columns].sum().to_numpy())
    transformed = np.log2(linear[selected].astype(float) + 1)
    assert transformed.index.is_unique and np.isfinite(transformed.to_numpy()).all()
    transformed.columns = sheet.loc[sheet.included, "sample"].tolist()
    output_frame = transformed.reset_index()
    output_frame.insert(0, "gene_id", output_frame.symbol)
    expr_path = BASE / "processed/GSE104709_log2_PORT_expression.tsv.gz"
    write_tsv(output_frame, expr_path)
    sums = pd.DataFrame(dict(sample=columns, before_symbol_sum=frame[columns].sum().to_numpy(),
                            after_symbol_sum=linear.sum().to_numpy()))
    write_tsv(sums, BASE / "processed/GSE104709_aggregation_qc.tsv")

    base_geo = BASE.relative_to(ROOT / "geo_replication").as_posix()
    config = dict(id=ACC, dir=base_geo, organism="Mus musculus", id_type="SYMBOL",
                  id_col="symbol", id_map="NA", input_kind="matrix",
                  input_path=f"{base_geo}/processed/GSE104709_log2_PORT_expression.tsv.gz",
                  samplesheet=f"{base_geo}/metadata/GSE104709_samplesheet.tsv", batch_var="NA", status="ready")
    write_tsv(pd.DataFrame([config]), BASE / "metadata/GSE104709_config_proposal.tsv")
    note = (
        "Chronic 45%-fat HFD versus regular chow in male C57BL/6J ventral/circumventricular hypothalamus. "
        "Five RNA pools per arm, each pooled from two mice; individual pool members are not deposited. "
        "Diet-switch arms are excluded. Technical sequencing runs were merged by the authors and are not replicates. "
        "The author supplied PORT-normalized resampled read counts, not raw counts. Same-symbol rows are summed "
        "on the deposited linear scale and transformed as log2(PORT-normalized read count + 1) for the matrix/limma route. "
        "All mice underwent three hours of forced wakefulness before ZT6-7 collection with food available. "
        "The chronic contrast includes diet and resulting obesity, and does not isolate diet from body weight. "
        "The downloaded file contains 21,654 Ensembl rows and 21,518 unique trimmed author symbols, "
        "whereas the paper reports 21,517 detected genes; the authentic file is retained without forcing its dimensions to match the paper."
    )
    qc = dict(accession=ACC, source_rows=len(frame), source_samples=len(columns),
              symbol_rows=len(linear), duplicate_symbol_rows_collapsed=len(frame) - len(linear),
              selected_samples=len(selected), control_pools=5, hfd_pools=5, pool_size=2,
              individual_pool_members_known=False, library_sum_conservation=True,
              expression_transform="log2(PORT-normalized read count + 1)",
              source_is_raw_counts=False, finite_values=True,
              expression_sha256=sha(expr_path), sample_mapping="GEO sample title with terminal numeric component zero-padded to two digits",
              notes=note)
    (BASE / "processed/GSE104709_preparation_qc.json").write_text(json.dumps(qc, indent=2) + "\n", encoding="utf-8")
    proposal = dict(accession=ACC, dataset_id="mouse_cvh_hfd_gse104709", track_id="cvh",
                    title="Mouse ventral hypothalamus chronic HFD",
                    modality="RNA-seq, author-normalized matrix", region="Ventral hypothalamus",
                    category="High-fat diet & obesity", species="Mus musculus", biological_unit="RNA pool",
                    unit_size=2, n_control=5, n_case=5, source_dir=relative(BASE), config=config,
                    expression_path=relative(expr_path), expression_id_column="symbol",
                    expressionUnit="log2(PORT-normalized read count + 1)",
                    sample_sheet=relative(BASE / "metadata/GSE104709_samplesheet.tsv"),
                    gene_map=relative(BASE / "metadata/GSE104709_author_gene_map.tsv"),
                    source_manifest=relative(BASE / "metadata/GSE104709_source_files.tsv"),
                    citation=dict(authors="Perron et al.", year=2018,
                                  title="Dietary challenges differentially affect activity and sleep/wake behavior in mus musculus: Isolating independent associations with diet/energy balance and body weight",
                                  journal="PLOS ONE", doi="10.1371/journal.pone.0196743", pmid="29746501",
                                  pmcid="PMC5945034", accession=ACC),
                    controls=sheet.loc[sheet.group == "control", "sample"].tolist(),
                    cases=sheet.loc[sheet.group == "case", "sample"].tolist(),
                    note=note, preparation_qc=qc)
    (OUT / "array-proposals.json").write_text(json.dumps(dict(included=[proposal], excluded=[exclusion_evidence()]), indent=2) + "\n", encoding="utf-8")
    print(json.dumps(qc, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Require every source file to be present")
    prepare(parser.parse_args().offline)
