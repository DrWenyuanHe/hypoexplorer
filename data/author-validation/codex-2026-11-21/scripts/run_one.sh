#!/usr/bin/env bash
# Worker then refuter for one dataset; skips steps whose outputs already exist.
set -u
id="$1"; WT="C:/Github Projects/hypoexplorer-review"; D="$WT/data/author-validation/codex-2026-11-21"
LOG="$D/logs"; mkdir -p "$LOG" "$D/findings" "$D/verdicts" "$D/corrected"
read -r cat acc < <(node -e "const q=require(process.argv[1]);const x=q.find(e=>e.datasetId===process.argv[2]);console.log(x.category,x.accession)" "$D/queue.json" "$id")
fill(){ sed -e "s/{{DATASET_ID}}/$id/g" -e "s/{{CATEGORY}}/$cat/g" -e "s/{{ACCESSION}}/$acc/g" "$1"; }
cx(){ codex exec -m gpt-6.2-astra -c 'model_reasoning_effort="xhigh"' -s workspace-write \
  -c 'sandbox_workspace_write.network_access=true' -C "$WT" --output-schema "$D/result.schema.json" "$@"; }
if [ ! -s "$D/findings/$id.json" ]; then
  echo "$(date -Is) worker start $id" >> "$LOG/progress.log"
  prompt="$(fill "$D/WORKER_PROMPT.md")"
  if [ -s "$D/round1/$id.verdict.json" ]; then
    prompt="$prompt

## Second round

An earlier proposal for this dataset was refuted. Read \`data/author-validation/codex-2026-11-21/round1/$id.findings.json\` and the refuter's verdict in \`data/author-validation/codex-2026-11-21/round1/$id.verdict.json\`. Address every problem the verdict names, and check its counter-claims yourself rather than adopting them. Earlier evidence is in \`continued-sources/$acc/codex-2026-11-21/\`; reuse saved bytes only after re-hashing them, and add new files beside them."
  fi
  cx -o "$LOG/$id.worker.json" "$prompt" > "$LOG/$id.worker.log" 2>&1
  echo "$(date -Is) worker exit=$? $id" >> "$LOG/progress.log"
fi
if [ -s "$D/findings/$id.json" ] && [ ! -s "$D/verdicts/$id.json" ]; then
  echo "$(date -Is) refuter start $id" >> "$LOG/progress.log"
  cx -o "$LOG/$id.refuter.json" "$(fill "$D/REFUTER_PROMPT.md")" > "$LOG/$id.refuter.log" 2>&1
  echo "$(date -Is) refuter exit=$? $id" >> "$LOG/progress.log"
fi
