#!/usr/bin/env bash
# Download raw data for a geo_replication dataset into its raw/ folder.
# Usage: bash geo_replication/scripts/download_raw.sh <GSE113943|GSE198437|GSE329539|GSE330152>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DS="${1:-}"
case "$DS" in
  GSE113943) DIR="$ROOT/datasets/GSE113943_mmus_hypothalamus_array/raw" ;;
  GSE198437) DIR="$ROOT/datasets/GSE198437_mmus_hypothalamus_rnaseq/raw" ;;
  GSE329539) DIR="$ROOT/datasets/GSE329539_mmus_hypothalamus_rnaseq/raw" ;;
  GSE330152) DIR="$ROOT/datasets/GSE330152_rnor_vmh_rnaseq/raw" ;;
  *) echo "usage: $0 <GSE113943|GSE198437|GSE329539|GSE330152>"; exit 1 ;;
esac
mkdir -p "$DIR"; cd "$DIR"

# Download every FASTQ for an ENA study accession (skips runs with no mirrored FASTQ).
ena_fastq() {
  local study="$1" got=0
  curl -s "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=${study}&result=read_run&fields=run_accession,fastq_ftp&format=tsv" \
    | awk -F'\t' 'NR>1{n=split($2,a,";"); for(i=1;i<=n;i++) if(a[i]!="") print a[i]}' \
    | while read -r u; do echo "  fetching $u"; curl -fsS -O "https://$u"; done
  got=$(ls -1 ./*.fastq.gz 2>/dev/null | wc -l)
  [ "$got" -gt 0 ] || { echo "  WARNING: ENA returned no FASTQ for $study (not mirrored yet)."; return 1; }
}

case "$DS" in
  GSE113943)
    echo "[GSE113943] CEL tar (~160 MB) from GEO ..."
    curl -fL -o GSE113943_RAW.tar \
      "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE113nnn/GSE113943/suppl/GSE113943_RAW.tar"
    tar -xf GSE113943_RAW.tar && echo "  untarred CEL files into $DIR"
    ;;
  GSE198437)
    echo "[GSE198437] FASTQ from ENA (PRJNA815307) ..."
    ena_fastq PRJNA815307
    ;;
  GSE329539)
    echo "[GSE329539] FASTQ lives in SRA (SRP696087) and is NOT mirrored to ENA yet."
    if command -v prefetch >/dev/null 2>&1; then
      prefetch SRP696087 -O .
      find . -name '*.sra' -execdir fasterq-dump --split-files {} \; && echo "  done."
    else
      echo "  SRA Toolkit not installed. Either:"
      echo "    1) install it (https://github.com/ncbi/sra-tools), then re-run this script; or"
      echo "    2) skip raw — processed counts are already in ../processed/GSE329539_HP_OB.counts.csv.gz"
    fi
    ;;
  GSE330152)
    echo "[GSE330152] FASTQ lives in SRA (not on ENA yet)."
    if command -v esearch >/dev/null 2>&1 && command -v prefetch >/dev/null 2>&1; then
      SRP=$(esearch -db sra -query GSE330152 | efetch -format runinfo | awk -F, 'NR==2{print $21}')
      echo "  resolved study: $SRP"
      prefetch "$SRP" -O .
      find . -name '*.sra' -execdir fasterq-dump --split-files {} \;
    else
      echo "  Needs Entrez Direct + SRA Toolkit. Once installed:"
      echo "    SRP=\$(esearch -db sra -query GSE330152 | efetch -format runinfo | awk -F, 'NR==2{print \$21}')"
      echo "    prefetch \$SRP -O . && find . -name '*.sra' -execdir fasterq-dump --split-files {} \;"
    fi
    ;;
esac
echo "done -> $DIR"
