#!/usr/bin/env bash
# Run the standardized pipeline over every dataset in config/datasets.tsv. Datasets whose input matrix isn't present
# are reported and skipped (see status column / dataset README for how to fetch).
#
# Usage:  bash geo_replication/scripts/run_all.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# locate Rscript (env override, PATH, or the known Windows install)
RSCRIPT="${RSCRIPT:-}"
if [[ -z "$RSCRIPT" ]]; then
  # Outputs are produced only by the R on PATH (R 4.6); there is deliberately no
  # fallback to another installed R version.
  if command -v Rscript >/dev/null 2>&1; then RSCRIPT="$(command -v Rscript)"
  else echo "ERROR: no Rscript found. Set RSCRIPT=..." >&2; exit 1; fi
fi
echo "[run_all] Rscript: $RSCRIPT"

# iterate dataset ids (skip header)
tail -n +2 "$ROOT/config/datasets.tsv" | while IFS=$'\t' read -r id dir org idt idcol idmap kind inpath ss batch status; do
  [[ -z "$id" ]] && continue
  echo "==================== $id ($status) ===================="
  if [[ "$status" == deferred* ]]; then
    echo "[$id] deferred ($status) -> skipping"; continue
  fi
  if [[ -f "$ROOT/$inpath" ]]; then
    "$RSCRIPT" "$ROOT/scripts/run_dataset.R" "$id" || echo "[$id] run failed (see error above)"
  else
    echo "[$id] input missing: $inpath  -> skipping (status=$status; see datasets/*/README.md to fetch)"
  fi
done

