# Historical R executable and library relocation

Three sealed checks refer to machine-specific or retired R installations.
`scripts/run_historical_check.py` enters the narrow adapter in
`scripts/historical_native_runtime.py` before its other input projections. The
sealed producers and R scripts remain unchanged. This is a runtime relocation,
not a new statistical analysis or a replacement of historical evidence.

The default private-library root is `.tmp/historical-native-runtime/` under the
repository. Set `HYPOEXPLORER_NATIVE_RUNTIME_ROOT` to an absolute directory to
use a prepared private closure elsewhere. No download or package installation
occurs in the runner.

Required layout under that root:

```text
runtime-library/             # supplemental R 4.6.0 library (may be empty)
historical-r441/library/     # historical R 4.4.1 private package closure
```

The R 4.6.0 executable is
`.tmp/oxt-avp-intake/runtime/R-4.6.0/bin/Rscript.exe`; its second private library
is `.tmp/oxt-avp-intake/runtime/library/`. The R 4.4.1 executable is
`C:/Program Files/R/R-4.4.1/bin/Rscript.exe`. Every configured library directory
must exist. A missing closure is an error, not permission to use an unrelated
user library.

| Sealed check | Required primary versions |
| --- | --- |
| GSE278158 author comparison | R 4.6.0; edgeR 4.10.1; limma 3.68.4 |
| GSE102471 author comparison | R 4.4.1; edgeR 4.2.2; limma 3.60.6; AnnotationDbi 1.66.0; org.Rn.eg.db 3.19.1 |
| September 5 intake numerical replay | R 4.6.0; edgeR 4.10.1; limma 3.68.4; data.table 1.18.6.1; jsonlite 2.0.0; Matrix 1.7.5 |

Each allowed producer, requested executable, flag prefix and complete R-script
path must match the fixed allowlist; producer and R-script SHA-256 values must
also match. Only the executable and library environment are relocated. All
remaining command arguments, scientific inputs, output comparisons and
tolerances are preserved. Other executable calls are not relocated, and a
request to run an unlisted script through a known executable is rejected.

A base-R probe loads the required packages, verifies R and primary package
versions, and checks that every loaded namespace comes from a declared private
library or the selected R installation. It records the actual dependency
versions; this is not a claim that every dependency is the original version.
The selected R installation and loaded package files are hashed and rechecked
around every replay, including concurrent intake workers.

Optionally set `HYPOEXPLORER_NATIVE_RUNTIME_RECEIPT_DIR` to a directory inside
repository `output/`. Each replay then writes a new exclusive JSON receipt with
requested and executed commands, source pins, runtime/package paths and
versions, complete runtime file hashes, return code and post-replay recheck.
Receipts do not overwrite scientific records.

Example, after preparing the declared libraries:

```powershell
$env:HYPOEXPLORER_NATIVE_RUNTIME_ROOT = 'C:/path/to/prepared-private-runtime'
$env:HYPOEXPLORER_NATIVE_RUNTIME_RECEIPT_DIR = 'C:/path/to/repository/output/runtime-receipts'
python scripts/run_historical_check.py data/internal-qc/source-recovery-2026-09-11/author-GSE278158/compare_author.py --check
```

The historical checks may write their existing scratch logs. Preserve those
logs before a release audit and restore only changes made by the audit. A
successful runtime probe alone does not establish that the scientific replay
passed; report the producer's final result separately.

Focused adapter tests:

```text
python scripts/test_historical_native_runtime.py
python scripts/test_historical_check.py
```
