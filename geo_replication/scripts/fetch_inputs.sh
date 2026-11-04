#!/usr/bin/env bash
# Fetch the COUNT-LEVEL inputs the standardized pipeline consumes (matrices, not
# FASTQ/CEL — see download_raw.sh for those). These large files are gitignored;
# this script is the provenance-as-code that regenerates them. Run from anywhere.
#
#   bash geo_replication/scripts/fetch_inputs.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ds() { echo "$ROOT/datasets/$1"; }

# --- GSE198437: GEO raw gene-count matrix (ENTREZID-keyed; has SYMBOL column) ---
A="$(ds GSE198437_mmus_hypothalamus_rnaseq)"; mkdir -p "$A/raw"
echo "[GSE198437] raw count matrix ..."
curl -fsSL -o "$A/raw/GSE198437_Raw_gene_count_matrix.txt.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE198nnn/GSE198437/suppl/GSE198437_Raw_gene_count_matrix.txt.gz"

# --- GSE113943: GEO series matrix (RMA values) + GPL7440 probe->symbol map ------
B="$(ds GSE113943_mmus_hypothalamus_array)"; mkdir -p "$B/metadata"
echo "[GSE113943] series matrix ..."
curl -fsSL -o "$B/metadata/GSE113943_series_matrix.txt.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE113nnn/GSE113943/matrix/GSE113943_series_matrix.txt.gz"
echo "[GSE113943] GPL7440 probe->symbol map (downloads 74MB soft, keeps only the map) ..."
tmp="$B/metadata/GPL7440_family.soft.gz"
curl -fsSL -o "$tmp" "https://ftp.ncbi.nlm.nih.gov/geo/platforms/GPL7nnn/GPL7440/soft/GPL7440_family.soft.gz"
gunzip -c "$tmp" | awk -F'\t' '/platform_table_begin/{f=1;next} /platform_table_end/{exit} \
  f && $1!="ID" && $4!="" && $4!="---" {print $1"\t"$4}' > "$B/metadata/GPL7440_probe2symbol.tsv"
rm -f "$tmp"
echo "  probe->symbol rows: $(wc -l < "$B/metadata/GPL7440_probe2symbol.tsv")"

# --- GSE225038: arcuate (bulk) AgRP-Cre/Klf4 model — GeneCount.xlsx -> TSV -------
PY="${PYTHON:-/c/Python312/python}"
E="$(ds GSE225038_mmus_arc_bulk_rnaseq)"; mkdir -p "$E/raw"
echo "[GSE225038] GeneCount.xlsx -> TSV ..."
curl -fsSL -o "$E/raw/GSE225038_GeneCount.xlsx" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE225nnn/GSE225038/suppl/GSE225038_GeneCount.xlsx"
"$PY" -c "import pandas as pd,sys; pd.read_excel(sys.argv[1]).to_csv(sys.argv[2],sep='\t',index=False)" \
  "$E/raw/GSE225038_GeneCount.xlsx" "$E/raw/GSE225038_GeneCount.tsv.gz"

# --- GSE220533: whole hypothalamus, GPR101 WT/KO × diet — log-normalized matrix --
F2="$(ds GSE220533_mmus_hypothalamus_rnaseq)"; mkdir -p "$F2/raw" "$F2/metadata"
echo "[GSE220533] log-normalized counts csv (no raw counts exist on GEO) + series matrix ..."
curl -fsSL -o "$F2/raw/GSE220533_normalized_counts.csv.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE220nnn/GSE220533/suppl/GSE220533_gpr101_ko_normalized_counts.csv.gz"
curl -fsSL -o "$F2/metadata/GSE220533_series_matrix.txt.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE220nnn/GSE220533/matrix/GSE220533_series_matrix.txt.gz"

# --- GSE214683: hypothalamic astrocyte TRAP-seq — raw counts (symbols) ----------
G="$(ds GSE214683_mmus_hypo_astrocyte_trap)"; mkdir -p "$G/raw" "$G/metadata"
echo "[GSE214683] astrocyte raw counts + series matrix ..."
curl -fsSL -o "$G/raw/GSE214683_raw_counts.txt.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE214nnn/GSE214683/suppl/GSE214683_gene_level_raw_counts_matrix_for_deconvolution.txt.gz"
curl -fsSL -o "$G/metadata/GSE214683_series_matrix.txt.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE214nnn/GSE214683/matrix/GSE214683_series_matrix.txt.gz"

# --- GSE247825: whole hypothalamus, control vs overfeeding — raw counts (Ensembl) -
H="$(ds GSE247825_mmus_hypothalamus_overfeed)"; mkdir -p "$H/raw"
echo "[GSE247825] overfeeding raw counts ..."
curl -fsSL -o "$H/raw/GSE247825_hypothalamus_counts.csv.gz" \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE247nnn/GSE247825/suppl/GSE247825_hypothalamus_counts.csv.gz"

# --- GSE330152 (rat, DEFERRED): VST matrix — uncomment to re-include -------------
# C="$(ds GSE330152_rnor_vmh_rnaseq)"; mkdir -p "$C/processed"
# curl -fsSL -o "$C/processed/GSE330152_VST.csv.gz" "<GEO supplementary VST CSV url>"

echo "done. next: bash geo_replication/scripts/run_all.sh"
