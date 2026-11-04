"""Extract only the two named author supplements and inspect their table content."""
from pathlib import Path
import json
import zipfile
from pypdf import PdfReader
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/author-validation/continued-sources/final-numerical-batch-d"
for archive, member in [
    ("PMC12376962_supplements.zip", "JNC-169-0-s006.xlsx"),
    ("PMC12461651_supplements.zip", "mmc1.pdf"),
]:
    with zipfile.ZipFile(OUT / archive) as z:
        target = OUT / member
        raw = z.read(member)
        if target.exists() and target.read_bytes() != raw:
            raise ValueError(f"Refusing to overwrite differing original: {target}")
        target.write_bytes(raw)

book = load_workbook(OUT / "JNC-169-0-s006.xlsx", read_only=True, data_only=True)
for sheet in book:
    values = list(sheet.values)
    print(json.dumps({"sheet": sheet.title, "rows": sheet.max_row,
                      "columns": sheet.max_column,
                      "actual_data_rows": len(values) - 1,
                      "header": values[0],
                      "first_gene": values[1][0]}, default=str))
book.close()
pdf = PdfReader(OUT / "mmc1.pdf")
texts = [page.extract_text() or "" for page in pdf.pages]
(OUT / "mmc1.extracted.txt").write_text(
    "\n\n".join(f"PAGE {i + 1}\n{text}" for i, text in enumerate(texts)), encoding="utf-8")
print(json.dumps({"pdf_pages": len(texts), "pages": [
    {"page": i + 1, "characters": len(text), "prefix": text[:180]}
    for i, text in enumerate(texts)]}, ensure_ascii=True))
