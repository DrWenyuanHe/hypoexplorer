#!/usr/bin/env bash
# Detached entry point: runs every dataset in remaining.txt, seven at a time.
S="$(cd "$(dirname "$0")" && pwd)"
export PATH="/c/Users/hekev/Tools/node/node-v24.22.1-win-x64:$PATH"
bash "$S/run_wave.sh" "$S/${1:-remaining.txt}" 7 > "$S/../logs/run.out" 2>&1
