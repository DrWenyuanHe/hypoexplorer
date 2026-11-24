#!/usr/bin/env bash
# Usage: run_wave.sh <ids-file> [parallelism]
S="$(dirname "$0")"; xargs -a "$1" -P "${2:-6}" -I{} bash "$S/run_one.sh" {}
echo "wave done: $1"
