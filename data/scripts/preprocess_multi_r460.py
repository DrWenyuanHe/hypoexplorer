# R 4.6.0 regeneration (2026-09-25) successor of data/scripts/preprocess_multi.py, whose
# exact bytes are pinned by retained evidence and therefore stay unchanged. One difference:
# fgsea 1.38 can return NA pval/padj/NES for a pathway (unbalanced gene-level statistics);
# those rows are dropped here, as the bulk builders already drop them, instead of crashing.
"""
preprocess_multi.py — Regenerate per-population JS bundles + QC artifacts from
Macques results (47+ populations, 4 FGSEA DBs, QC tab data, trimmed QA PDFs).

Run from repo root:
    /c/Python312/python data/scripts/preprocess_multi.py

Inputs:
    data/raw/results/_global/{composition,summary,qa_compiled}/
    data/raw/results/{pop}/{de,fgsea,qc}/

Outputs:
    public/pop_{id}.js               per-pop DE + CPM + 4-DB FGSEA + qc block
    public/pop_meta.js               ids + labels + types + colors + qcFlags + qaReportFilenames
    public/qc_global.js              run_status + DE/FGSEA summaries + composition tables
    public/qc/{popId}__{genes}.pdf   trimmed (last 2 pages dropped) + compressed QA PDFs

Deps:
    pip install pypdf pandas
    Ghostscript on PATH (optional; falls back to trim-only)
"""

import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

# ── Configuration ──────────────────────────────────────────────────────────────

REPO_ROOT  = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW_DIR    = os.path.join(REPO_ROOT, "data", "raw", "results")
OUT_DIR    = os.path.join(REPO_ROOT, "public")
QC_OUT_DIR = os.path.join(OUT_DIR, "qc")

EPS        = 1e-300
RANK_CAP   = 1000.0

# Canonical sample layout. 2v3 pops drop one of these; we null-pad to preserve index.
CANONICAL_SAMPLES = [
    "HCA_Macaque001_S001",
    "HCA_Macaque001_S002",
    "HCA_Macaque001_S003",
    "HCA_Macaque001_S004",
    "HCA_Macaque001_S005",
    "HCA_Macaque001_S006",
]

TYPE_BY_PREFIX = {"e": "Glutamatergic", "i": "GABAergic", "h": "Histaminergic", "o": "Oxytocin"}

# Neuronal ids look like "<eiho><digits>" (e9, i23, h44, o30). Anything else
# coming out of the pipeline (Ast1, Oligo1, OPC, TanyA, …) is non-neuronal and
# is grouped under a single "Non-neuronal" type in the web UI.
NEURONAL_RE = re.compile(r"^[eiho]\d+$")

# Composition / DA tables key on the raw celltype label ("Ast-1"); the rest of
# the dataset (run_status, DE/FGSEA, pop_<id>.js) keys on the clean id ("Ast1").
# Remap so the QC tab's composition rows stay joinable to population ids (color
# dot + click-to-navigate). Keep in sync with nonneuronal_map in run_all_clusters.R.
# Idempotent: a future full R run already emits clean ids, so these never match.
NONNEURONAL_LABEL_TO_ID = {
    "ast-1": "Ast1", "ast-2": "Ast2", "oligo-1": "Oligo1", "oligo-2": "Oligo2",
    "opc": "OPC", "cop": "COP", "micro-1": "Micro1", "micro-2": "Micro2",
    "endothelial": "Endo", "ependy-1": "Ependy1", "ependy-2": "Ependy2",
    "fibro-1": "Fibro1", "fibro-2": "Fibro2", "tany_a": "TanyA", "tany_b": "TanyB",
}


def type_of(pop_id):
    if NEURONAL_RE.match(pop_id):
        return TYPE_BY_PREFIX.get(pop_id[0], "Unknown")
    return "Non-neuronal"


def relabel_composition(rows):
    """Map each row's raw 'cluster' label to the clean population id, in place."""
    for r in rows:
        c = r.get("cluster")
        if isinstance(c, str):
            r["cluster"] = NONNEURONAL_LABEL_TO_ID.get(c.strip().lower(), c)
    return rows

DB_FILES = {
    "GO_BP":    "FGSEA_GO_BP.csv",
    "HALLMARK": "FGSEA_Hallmark.csv",
    "KEGG":     "FGSEA_KEGG.csv",
    "REACTOME": "FGSEA_Reactome.csv",
}

# Curated 6 (stable across releases); remaining pops get HSL-generated colors.
CURATED_COLORS = {
    "e9":  "#4C78A8",
    "i23": "#59A14F",
    "e33": "#E45756",
    "i26": "#B07AA1",
    "i40": "#FF9DA7",
    "o30": "#9C755F",
}

# Population folders are "<id>__<safe_label>". The id is everything before the
# first "__" — neuronal ("e9") or non-neuronal ("Ast1", "TanyA", "OPC").
POP_RE = re.compile(r"^(.+?)__")


# ── Shared helpers ─────────────────────────────────────────────────────────────

def safe_log10(x):
    return math.log10(max(float(x), EPS))


def cap(v):
    return max(-RANK_CAP, min(RANK_CAP, v))


def _try_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def split_leading_edge(raw):
    """Auto-detect separator. New files use ';', legacy used '|'."""
    if raw is None:
        return []
    s = raw.strip().strip('"')
    if not s or s == "NA":
        return []
    for sep in (";", "|", ","):
        if sep in s:
            return [g.strip() for g in s.split(sep) if g.strip()]
    return [s]


# ── Readers ────────────────────────────────────────────────────────────────────

def read_de(path):
    """Read DE_all.csv; compute rank_score; sort desc; assign rankPos."""
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            gene = row["gene"].strip()
            logfc = float(row["logFC"])
            logcpm = float(row["logCPM"])
            pval = float(row["PValue"])
            fdr = float(row["FDR"])
            sign = 1.0 if logfc >= 0 else -1.0
            rank_score = cap(sign * (-safe_log10(fdr)))
            rows.append({
                "gene": gene,
                "logFC": round(logfc, 4),
                "logCPM": round(logcpm, 4),
                "PValue": pval,
                "FDR": fdr,
                "rank_score": round(rank_score, 4),
            })
    rows.sort(key=lambda r: r["rank_score"], reverse=True)
    for i, r in enumerate(rows):
        r["rankPos"] = i + 1
    names = [r["gene"] for r in rows]
    if len(names) != len(set(names)):
        raise ValueError(f"Duplicate genes in {path}")
    return rows, names


def read_cpm(path):
    """Read normcpm.csv. Null-pad to canonical 6-slot layout keyed by CANONICAL_SAMPLES."""
    cpm = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        gene_col = header[0]
        present_cols = [c for c in header[1:] if c in CANONICAL_SAMPLES]
        # Map each canonical slot → source column (or None if dropped)
        col_by_slot = [c if c in present_cols else None for c in CANONICAL_SAMPLES]
        for row in reader:
            gene = row[gene_col].strip()
            vals = []
            for src in col_by_slot:
                if src is None:
                    vals.append(None)
                else:
                    v = _try_float(row[src])
                    vals.append(round(v, 4) if v is not None else None)
            cpm[gene] = vals
    return cpm, present_cols


def read_fgsea(path):
    """Read FGSEA CSV. Auto-detect leadingEdge separator."""
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if any(_try_float(row[k]) is None or not math.isfinite(_try_float(row[k])) for k in ("pval", "padj", "NES")):
                continue
            leading = split_leading_edge(row.get("leadingEdge", ""))
            rows.append({
                "pathway": row["pathway"].strip(),
                "pval": float(row["pval"]),
                "padj": float(row["padj"]),
                "NES": round(float(row["NES"]), 4),
                "size": int(row["size"]),
                "leadingEdge": leading,
            })
    return rows


def read_group_sizes(path):
    """Parse single-row qc/group_sizes.csv."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        row = next(reader)
    return {
        "cluster":      row["cluster"],
        "clusterLabel": row.get("cluster_label", ""),
        "minCells":     int(row["min_cells"]),
        "nNormal":      int(row["n_normal"]),
        "nObese":       int(row["n_obese"]),
        "is3v3":        str(row["is_3v3"]).strip().lower() in ("true", "1", "t", "yes"),
        "samplesKept":  [s.strip() for s in row["samples_kept"].split(";") if s.strip()],
    }


def read_csv_rows(path):
    """Generic CSV → list[dict] with numeric coercion."""
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            clean = {}
            for k, v in row.items():
                if v == "" or v is None:
                    clean[k] = None
                    continue
                fv = _try_float(v)
                if fv is not None and re.fullmatch(r"-?\d+(\.\d+)?([eE][+-]?\d+)?", v.strip()):
                    clean[k] = fv
                elif v.strip().lower() in ("true", "false"):
                    clean[k] = v.strip().lower() == "true"
                else:
                    clean[k] = v
            out.append(clean)
    return out


# ── Color palette ──────────────────────────────────────────────────────────────

def build_palette(pop_ids):
    """Curated 6 + HSL-N for the rest, starting at hue=30, skipping curated hues."""
    colors = {}
    remaining = [p for p in pop_ids if p not in CURATED_COLORS]
    n = max(1, len(remaining))
    for i, p in enumerate(remaining):
        hue = round((i * 360 / n + 30) % 360, 1)
        colors[p] = f"hsl({hue}, 65%, 55%)"
    for pid, c in CURATED_COLORS.items():
        if pid in pop_ids:
            colors[pid] = c
    return {p: colors[p] for p in pop_ids}


# ── QA PDF pipeline ────────────────────────────────────────────────────────────

def has_ghostscript():
    for name in ("gswin64c", "gs"):
        if shutil.which(name):
            return name
    return None


def process_qa_pdf(src_path, dst_path, gs_bin):
    """Trim last 2 pages, optionally compress via Ghostscript /ebook."""
    from pypdf import PdfReader, PdfWriter
    # Idempotent: skip if up-to-date
    if os.path.exists(dst_path) and os.path.getmtime(dst_path) >= os.path.getmtime(src_path):
        return "skipped", os.path.getsize(dst_path)

    reader = PdfReader(src_path)
    n = len(reader.pages)
    keep = max(1, n - 2) if n > 2 else n
    if n <= 2:
        print(f"    WARN: {os.path.basename(src_path)} has only {n} pages — copying verbatim")

    tmp = dst_path + ".tmp.pdf"
    writer = PdfWriter()
    for i in range(keep):
        writer.add_page(reader.pages[i])
    with open(tmp, "wb") as f:
        writer.write(f)

    if gs_bin:
        try:
            subprocess.run(
                [gs_bin, "-dNOPAUSE", "-dBATCH", "-dQUIET",
                 "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
                 "-dPDFSETTINGS=/ebook",
                 f"-sOutputFile={dst_path}", tmp],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            os.remove(tmp)
            return "compressed", os.path.getsize(dst_path)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"    WARN: gs failed for {os.path.basename(src_path)} ({e}) — using trimmed-only")
            shutil.move(tmp, dst_path)
            return "trimmed-only", os.path.getsize(dst_path)
    else:
        shutil.move(tmp, dst_path)
        return "trimmed-only", os.path.getsize(dst_path)


# ── Main ───────────────────────────────────────────────────────────────────────

def discover_pops(raw_dir):
    pops = []
    for d in sorted(os.listdir(raw_dir)):
        if d == "_global":
            continue
        m = POP_RE.match(d)
        if not m:
            continue
        pop_id = m.group(1)
        pops.append({"id": pop_id, "folder": d, "prefix": pop_id[0]})
    return pops


def emit_pop_js(pop, qc, de_rows, cpm_out, fgsea_by_db):
    de_json    = json.dumps(de_rows, separators=(",", ":"))
    cpm_json   = json.dumps(cpm_out, separators=(",", ":"))
    path_json  = json.dumps(fgsea_by_db, separators=(",", ":"))
    qc_json    = json.dumps(qc, separators=(",", ":"))
    type_ = type_of(pop["id"])
    label_suffix = qc["clusterLabel"] or pop["id"]
    label = f"{pop['id']} ({label_suffix})"
    samples_kept = qc["samplesKept"]
    # normalSamples / obeseSamples are always the CANONICAL 3-slot halves, so
    # consumers can index vals[0..2] and vals[3..5]. Dropped samples show as
    # null values in `cpm[gene]`; exports should filter those out. samplesKept
    # lists only the actually-present samples (for warnings / audit).
    normal_canonical = CANONICAL_SAMPLES[0:3]
    obese_canonical  = CANONICAL_SAMPLES[3:6]

    meta = {
        "code": pop["id"],
        "label": label,
        "type": type_,
        "sampleNames": CANONICAL_SAMPLES,
        "samplesKept": samples_kept,
        "normalSamples": normal_canonical,
        "obeseSamples": obese_canonical,
        "nGenes": len(de_rows),
    }
    var_name = f"POP_{pop['id'].upper()}"
    js = (
        f"// AUTO-GENERATED by data/scripts/preprocess_multi.py — do not edit\n"
        f"// Population: {pop['id']}\n"
        f"var {var_name} = {{\n"
        f"  meta: {json.dumps(meta, separators=(',', ':'))},\n"
        f"  qc: {qc_json},\n"
        f"  de: {de_json},\n"
        f"  cpm: {cpm_json},\n"
        f"  pathways: {path_json},\n"
        f"}};\n"
    )
    out = os.path.join(OUT_DIR, f"pop_{pop['id']}.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(js)
    return out, os.path.getsize(out)


def main():
    if not os.path.isdir(RAW_DIR):
        sys.exit(f"ERROR: {RAW_DIR} missing. Run the copy step first.")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(QC_OUT_DIR, exist_ok=True)

    all_pops = discover_pops(RAW_DIR)
    pops = []
    skipped = []
    for p in all_pops:
        de_all = os.path.join(RAW_DIR, p["folder"], "de", "DE_all.csv")
        if os.path.exists(de_all):
            pops.append(p)
        else:
            skipped.append(p["id"])
    print(f"Discovered {len(all_pops)} populations; processing {len(pops)} with DE data; skipping {len(skipped)}: {skipped}\n")

    qc_flags = {}
    qa_filenames = {}
    labels = {}
    types_ = {}
    n_genes = {}
    pop_ids = [p["id"] for p in pops]

    # ── Per-pop processing ───────────────────────────────────────────────
    t_pop = time.time()
    for pop in pops:
        pop_dir = os.path.join(RAW_DIR, pop["folder"])
        print(f"── {pop['id']}  ({pop['folder']})")

        de_rows, gene_names = read_de(os.path.join(pop_dir, "de", "DE_all.csv"))
        cpm_dict, present_cols = read_cpm(os.path.join(pop_dir, "de", "normcpm.csv"))
        cpm_out = {g: cpm_dict.get(g, [None] * 6) for g in gene_names}

        qc = read_group_sizes(os.path.join(pop_dir, "qc", "group_sizes.csv"))

        fgsea_by_db = {}
        for db, fname in DB_FILES.items():
            fgsea_by_db[db] = read_fgsea(os.path.join(pop_dir, "fgsea", fname))

        out_path, size = emit_pop_js(pop, qc, de_rows, cpm_out, fgsea_by_db)
        n_genes[pop["id"]] = len(de_rows)
        labels[pop["id"]]  = f"{pop['id']} ({qc['clusterLabel'] or pop['id']})"
        types_[pop["id"]]  = type_of(pop["id"])
        qc_flags[pop["id"]] = {
            "is3v3":   qc["is3v3"],
            "nNormal": qc["nNormal"],
            "nObese":  qc["nObese"],
            "minCells": qc["minCells"],
        }
        n_counts = [sum(1 for f in v if f is not None) for v in cpm_out.values()]
        avg_present = sum(n_counts) / max(1, len(n_counts))
        print(f"    DE={len(de_rows)}  CPM genes={len(cpm_out)}  cols_present={len(present_cols)}  avg_vals={avg_present:.2f}")
        print(f"    FGSEA: GO_BP={len(fgsea_by_db['GO_BP'])} HALL={len(fgsea_by_db['HALLMARK'])} "
              f"KEGG={len(fgsea_by_db['KEGG'])} REACT={len(fgsea_by_db['REACTOME'])}")
        print(f"    → {out_path}  ({size/1_000_000:.1f} MB)")
    print(f"\nPer-pop processing took {time.time()-t_pop:.1f}s\n")

    # ── Run status lookup for elapsedSec ─────────────────────────────────
    run_status = read_csv_rows(os.path.join(RAW_DIR, "_global", "summary", "run_status.csv"))
    status_map = {row["cluster"]: row for row in run_status if row.get("cluster")}
    for pid in pop_ids:
        rs = status_map.get(pid)
        if rs:
            qc_flags[pid]["status"] = rs.get("status")
            qc_flags[pid]["elapsedSec"] = rs.get("elapsed_sec")

    # ── QA PDF pipeline ──────────────────────────────────────────────────
    print("── QA PDFs ──")
    gs_bin = has_ghostscript()
    print(f"Ghostscript: {gs_bin or 'NOT FOUND — trim-only fallback'}")
    qa_src_dir = os.path.join(RAW_DIR, "_global", "qa_compiled")
    available = {f.replace(".pdf", ""): f for f in os.listdir(qa_src_dir) if f.endswith(".pdf")}
    total_in = 0
    total_out = 0
    counts = {"compressed": 0, "trimmed-only": 0, "skipped": 0}
    for pop in pops:
        key = pop["folder"]
        if key in available:
            src = os.path.join(qa_src_dir, available[key])
            dst = os.path.join(QC_OUT_DIR, available[key])
            total_in += os.path.getsize(src)
            outcome, size = process_qa_pdf(src, dst, gs_bin)
            counts[outcome] = counts.get(outcome, 0) + 1
            total_out += size
            qa_filenames[pop["id"]] = available[key]
        else:
            qa_filenames[pop["id"]] = None
            print(f"    {pop['id']}: no QA PDF")
    missing = sum(1 for v in qa_filenames.values() if v is None)
    print(f"  Processed {sum(counts.values())} PDFs: "
          f"{counts['compressed']} compressed, {counts['trimmed-only']} trim-only, "
          f"{counts['skipped']} skipped (up-to-date); {missing} missing sources")
    if total_in:
        print(f"  Size: {total_in/1_000_000:.1f} MB → {total_out/1_000_000:.1f} MB "
              f"({100*(1-total_out/total_in):.0f}% reduction)")

    # ── qc_global.js ─────────────────────────────────────────────────────
    print("\n── qc_global.js ──")
    comp_dir = os.path.join(RAW_DIR, "_global", "composition")
    qc_global = {
        "runStatus":     run_status,
        "deSummary":     read_csv_rows(os.path.join(RAW_DIR, "_global", "summary", "DE_summary_all_clusters.csv")),
        "fgseaSummary":  read_csv_rows(os.path.join(RAW_DIR, "_global", "summary", "FGSEA_summary_all_clusters.csv")),
        "composition": {
            "countsLong":     relabel_composition(read_csv_rows(os.path.join(comp_dir, "cell_counts_by_sample_and_cluster_long.csv"))),
            "countsWide":     relabel_composition(read_csv_rows(os.path.join(comp_dir, "cell_counts_by_sample_and_cluster_wide.csv"))),
            "propsLong":      relabel_composition(read_csv_rows(os.path.join(comp_dir, "cell_proportions_by_sample_and_cluster_long.csv"))),
            "propsWide":      relabel_composition(read_csv_rows(os.path.join(comp_dir, "cell_proportions_by_sample_and_cluster_wide.csv"))),
            "daQuasiAll":     relabel_composition(read_csv_rows(os.path.join(comp_dir, "DA_composition_quasibinomial_all_clusters.csv"))),
            "daPropellerVsQuasi": relabel_composition(read_csv_rows(os.path.join(comp_dir, "DA_composition_propeller_vs_quasibinomial.csv"))),
        },
    }
    qc_global_path = os.path.join(OUT_DIR, "qc_global.js")
    with open(qc_global_path, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by data/scripts/preprocess_multi.py — do not edit\n")
        f.write("var QC_GLOBAL = ")
        f.write(json.dumps(qc_global, separators=(",", ":")))
        f.write(";\n")
    qcg_size = os.path.getsize(qc_global_path) / 1_000_000
    print(f"  Written: {qc_global_path}  ({qcg_size:.2f} MB)")
    for section, v in qc_global.items():
        if isinstance(v, list):
            print(f"    {section}: {len(v)} rows")
        else:
            for k2, v2 in v.items():
                print(f"    composition.{k2}: {len(v2)} rows")

    # ── pop_meta.js ──────────────────────────────────────────────────────
    print("\n── pop_meta.js ──")
    palette = build_palette(pop_ids)
    meta = {
        "populations":       pop_ids,
        "labels":            labels,
        "types":             types_,
        "nGenes":            n_genes,
        "colors":            palette,
        "qcFlags":           qc_flags,
        "qaReportFilenames": qa_filenames,
    }
    meta_path = os.path.join(OUT_DIR, "pop_meta.js")
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by data/scripts/preprocess_multi.py — do not edit\n")
        f.write(f"// {len(pop_ids)} populations\n")
        f.write("var POP_META = ")
        f.write(json.dumps(meta, separators=(",", ":")))
        f.write(";\n")
    meta_size = os.path.getsize(meta_path) / 1_000_000
    print(f"  Written: {meta_path}  ({meta_size:.2f} MB)")

    # ── Totals ───────────────────────────────────────────────────────────
    pop_total = sum(os.path.getsize(os.path.join(OUT_DIR, f"pop_{p}.js")) for p in pop_ids)
    qc_pdf_total = sum(os.path.getsize(os.path.join(QC_OUT_DIR, f)) for f in os.listdir(QC_OUT_DIR) if f.endswith(".pdf"))
    print(f"\n── DONE ──")
    print(f"  pop_*.js total:   {pop_total/1_000_000:.1f} MB  ({len(pop_ids)} files)")
    print(f"  pop_meta.js:      {meta_size:.2f} MB")
    print(f"  qc_global.js:     {qcg_size:.2f} MB")
    print(f"  qc/*.pdf total:   {qc_pdf_total/1_000_000:.1f} MB")
    print(f"  Grand total:      {(pop_total + meta_size*1e6 + qcg_size*1e6 + qc_pdf_total)/1_000_000:.1f} MB")


if __name__ == "__main__":
    main()
