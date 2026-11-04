"""Extract the explicitly labeled Figure 3A/B author effects without changing the workbook."""

import hashlib
from pathlib import Path

import pandas as pd

root = Path(__file__).resolve().parents[1]
directory = root / "data/author-validation/continued-sources/GSE234483"
source = directory / "mmc3_Table_S1.xlsx"
assert hashlib.sha256(source.read_bytes()).hexdigest() == (
    "bdaa33d6c0130c850070f27c79b5c62db9134859126040a12528654ec3f36474"
)
sheet = pd.read_excel(source, sheet_name="Figure 3", header=None)
records = []
for column, label in [(0, "Figure 3A"), (6, "Figure 3B")]:
    assert sheet.iloc[0, column].startswith(label + ": Log fold changes")
    assert sheet.iloc[1, column + 1 : column + 5].tolist() == ["GL1", "GL2", "GL3", "GL4"]
    for row in range(2, 23):
        symbol = sheet.iloc[row, column]
        if pd.isna(symbol):
            continue
        values = pd.to_numeric(sheet.iloc[row, column + 1 : column + 5], errors="raise")
        assert values.notna().all()
        records.append({"symbol": symbol, "figure": label, "excel_row": row + 1,
                        **{f"GL{i + 1}": value for i, value in enumerate(values)}})
result = pd.DataFrame.from_records(records)
assert len(result) == 32 and result["symbol"].is_unique
target = directory / "figure3_author_effects.generated.tsv"
result.to_csv(target, sep="\t", index=False, float_format="%.15g")
print(f"Extracted {len(result)} genes with four author sample effects each to {target}")
