#!/usr/bin/env bash
# Fetch the COUNT-LEVEL inputs for the 5 datasets promoted to "pipeline" in the
# dataset tracker (2026-06) and processed into geo_replication/. These large raw
# files are gitignored; this script is the provenance-as-code that regenerates
# them. Run from anywhere. (GSE247825 is fetched by the original fetch_inputs.sh.)
#
#   bash geo_replication/scripts/fetch_inputs_2026pipeline.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B="https://ftp.ncbi.nlm.nih.gov/geo/series"
RS="${RSCRIPT:-Rscript}"   # the single R 4.6 runtime on PATH; set RSCRIPT to override
dl(){ mkdir -p "$(dirname "$2")"; if [ -s "$2" ]; then echo "  exists: $2"; else curl -fsSL -o "$2" "$1" && echo "  OK: $2" || echo "  FAIL: $1"; fi; }

# --- GSE236077: mouse brain atlas; hypothalamus chow-vs-HFD (Exp1, 16h) ---------
d="$ROOT/datasets/GSE236077_mmus_hypothalamus_hfd"
echo "[GSE236077] raw counts (Ensembl, 185 GSM cols) + per-GSM metadata ..."
dl "$B/GSE236nnn/GSE236077/suppl/GSE236077_counts.csv.gz"        "$d/raw/GSE236077_counts.csv.gz"
dl "$B/GSE236nnn/GSE236077/suppl/GSE236077_gsm_meta_long.csv.gz" "$d/metadata/GSE236077_gsm_meta_long.csv.gz"
echo "[GSE236077] disambiguate region-collapsed columns -> hypothalamus-only matrix ..."
"$RS" "$ROOT/scripts/prep_GSE236077.R"

# --- GSE294478: fasting/refeeding time-course; Fed vs 72h-fasted (core file) -----
d="$ROOT/datasets/GSE294478_mmus_hypothalamus_fasting"
echo "[GSE294478] core raw count matrix (Fed + 24h/72h/72h+cold fasted) + series matrix ..."
dl "$B/GSE294nnn/GSE294478/suppl/GSE294478_HungryHypothalamusCountsEns001_Feb2023.txt.gz" "$d/raw/GSE294478_core_Feb2023.txt.gz"
dl "$B/GSE294nnn/GSE294478/matrix/GSE294478_series_matrix.txt.gz"                          "$d/metadata/GSE294478_series_matrix.txt.gz"
# (refeed/refed-1mo cohort files are not needed for the Fed-vs-72h contrast)

# --- GSE305719: HFD multi-organ time-course; hypothalamus 0d vs 12w --------------
d="$ROOT/datasets/GSE305719_mmus_hypothalamus_hfd_timecourse"
echo "[GSE305719] combined raw count matrix (gene_symbol; 1104 sample cols, ~25MB) ..."
dl "$B/GSE305nnn/GSE305719/suppl/GSE305719_data_count.csv.gz" "$d/raw/GSE305719_data_count.csv.gz"

# --- GSE282067: Treg FACS-sorted; hypothalamus BL6 Treg SD vs HFD ----------------
d="$ROOT/datasets/GSE282067_mmus_hypothalamus_treg"
echo "[GSE282067] per-GSM Salmon .sf bundle (RAW.tar, ~24MB) + per-platform series matrices ..."
dl "$B/GSE282nnn/GSE282067/suppl/GSE282067_RAW.tar"                       "$d/raw/GSE282067_RAW.tar"
dl "$B/GSE282nnn/GSE282067/suppl/filelist.txt"                            "$d/metadata/filelist.txt"
dl "$B/GSE282nnn/GSE282067/matrix/GSE282067-GPL19057_series_matrix.txt.gz" "$d/metadata/GSE282067-GPL19057_series_matrix.txt.gz"
dl "$B/GSE282nnn/GSE282067/matrix/GSE282067-GPL34290_series_matrix.txt.gz" "$d/metadata/GSE282067-GPL34290_series_matrix.txt.gz"
echo "[GSE282067] assemble symbol-keyed count matrix from the 8 BL6-Treg .sf files ..."
"$RS" "$ROOT/scripts/prep_GSE282067.R"

# --- GSE292416: PNOC bacTRAP; WT vs LepR-KO (Pulldown fraction) ------------------
d="$ROOT/datasets/GSE292416_mmus_arc_pnoc_bactrap"
echo "[GSE292416] Salmon merged gene counts (gene_id+gene_name; 16 sample cols) ..."
dl "$B/GSE292nnn/GSE292416/suppl/GSE292416_salmon.merged.gene_counts.tsv.gz" "$d/raw/GSE292416_salmon.merged.gene_counts.tsv.gz"

echo "done. next: bash geo_replication/scripts/run_all.sh   (or run_dataset.R <id> per dataset)"
