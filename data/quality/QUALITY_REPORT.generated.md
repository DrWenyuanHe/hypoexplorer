# Pipeline quality, experimental design and author concordance

Three separate assessments. A pass applies only to the recorded checks and scope. Exact author P values or FDR are not required for biological-effect concordance. Detailed author-reproduction classifications remain in the separate author-validation ledger.

| Status | Pipeline QC | Experimental design | Author concordance |
|---|---:|---:|---:|
| Passed | 143 | 85 | 27 |
| Review needed | 16 | 60 | 31 |
| Failed | 0 | 0 | 0 |
| Not assessed | 3 | 17 | 103 |
| Not applicable | 0 | 0 | 1 |

Experimental design covers independent biological replication and retained sample support. All other recorded checks remain in pipeline QC, including source integrity, species mapping, normalization and model pairing. The separation preserves each source check, status, requirement and evidence reference.

Explicitly reviewed source/model concerns embedded in replication notes also remain required pipeline checks. These companion checks reuse the original evidence and grant no new positive evidence.

A pipeline pass does not resolve experimental-design limitations. Empty evidence is not assessed. The JSON internalQc field retains the original combined assessment for historical audit compatibility; it is not the Pipeline QC badge.

QC separation policy: qc-separation-v1. The source internal-QC policy and all underlying evidence remain unchanged.

Author concordance policy: author-concordance-v2. See the JSON policy for exact thresholds; these are project defaults, not universal scientific cutoffs.

The JSON includes every checklist and per-comparison assessment. The TSV includes dataset and comparison decisions. Regenerate with `npm run build:quality`; verify freshness with `npm run check:quality`.
