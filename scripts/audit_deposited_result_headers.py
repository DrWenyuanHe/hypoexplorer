"""Bounded read-only header audit of source-only datasets; never open derived processed outputs."""
import csv
import gzip
import io
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path.cwd()
records = json.loads((ROOT / "data/author-validation/validation-records.generated.json").read_text(encoding="utf-8"))["records"]
inventory = {d["datasetId"]: d for d in json.loads((ROOT / "data/author-validation/source-inventory.generated.json").read_text(encoding="utf-8"))["datasets"]}
base = ROOT / "geo_replication/datasets"
pattern = re.compile(r"log[ _.-]*2?[ _.-]*(?:fold[ _.-]*change|fc)|fold[ _.-]*change|(?:^|[_ .-])padj(?:$|[_ .-])|p[_. -]*value|p[_. -]*val(?:$|[_ .-])|q[_. -]*value|adj[_. -]*p|p[_. -]*adj|(?:^|[_ .-])fdr(?:$|[_ .-])|(?:^|[_ .-])stat(?:$|[_ .-])|statistic|t[_. -]*stat", re.I)
results, skipped = [], []
scope = [r for r in records if r.get("comparisonLevel") == "processed_source" and r.get("accession")]

def official_files(record, folder):
    names = {f["name"]: {"url":f.get("url"), "basis":"official source inventory"} for f in inventory.get(record["datasetId"],{}).get("depositedFiles",[])}
    manifests = sorted((folder/"metadata").glob("*source_files.tsv")) if (folder/"metadata").is_dir() else []
    for manifest in manifests:
        for row in csv.DictReader(manifest.open(encoding="utf-8-sig"), delimiter="\t"):
            name = row.get("file") or row.get("filename") or row.get("name")
            url = row.get("source") or row.get("url") or row.get("source_url")
            if name and url and url.startswith(("https://", "http://", "ftp://")):
                names[Path(name).name] = {"url":url,"basis":str(manifest.relative_to(ROOT)).replace("\\","/")}
    return names

def scan(path):
    if path.suffix.lower() == ".xlsx":
        workbook = openpyxl.load_workbook(path,read_only=True,data_only=True)
        sheets = []
        for sheet in workbook:
            matches = []
            header = []
            for row_i, row in enumerate(sheet.iter_rows(min_row=1,max_row=min(20,sheet.max_row),max_col=min(1000,sheet.max_column),values_only=True),1):
                if row_i == 1: header = [str(v)[:200] if v is not None else "" for v in row]
                fields = [{"column":openpyxl.utils.get_column_letter(i),"value":str(v)[:200]} for i,v in enumerate(row,1) if isinstance(v,str) and pattern.search(v)]
                if fields: matches.append({"row":row_i,"fields":fields})
            sheets.append({"sheet":sheet.title,"rows":sheet.max_row,"columns":sheet.max_column,"header":header,"matches":matches})
        workbook.close()
        return {"kind":"xlsx","sheets":sheets,"candidate":any(s["matches"] for s in sheets)}
    opener = gzip.open if path.suffix.lower() == ".gz" else open
    with opener(path,"rb") as handle:
        data = handle.read(262144)
    if b"\x00" in data[:1000]:
        return {"kind":"binary","candidate":False,"limitation":"not text; contents not scanned"}
    lines = data.decode("utf-8-sig",errors="replace").splitlines()
    if "series_matrix" in path.name:
        found = next((i for i,line in enumerate(lines) if line.startswith("!series_matrix_table_begin")),None)
        lines = lines[found+1:found+6] if found is not None else []
    else:
        lines = lines[:20]
    matches = []
    for row_i,line in enumerate(lines,1):
        delim = "\t" if "\t" in line else ","
        values = next(csv.reader([line],delimiter=delim))
        fields = [{"column":i,"value":v[:200]} for i,v in enumerate(values,1) if pattern.search(v)]
        if fields: matches.append({"row":row_i,"fields":fields})
    return {"kind":"text","header":lines[0][:1800] if lines else "", "matches":matches,"candidate":bool(matches)}

for record in scope:
    acc = re.sub(r"[^A-Z0-9]","",record["accession"].upper())
    folders = [p for p in base.iterdir() if p.is_dir() and re.sub(r"[^A-Z0-9]","",p.name.split("_")[0].upper()) == acc]
    if not folders:
        skipped.append({"datasetId":record["datasetId"],"reason":"no matching local dataset directory"})
    for folder in folders:
        known = official_files(record,folder)
        for part in ("raw","metadata"):
            directory = folder/part
            if not directory.is_dir(): continue
            for file in sorted(directory.iterdir()):
                name = file.name.lower()
                if not file.is_file(): continue
                if any(x in name for x in ("family.soft","samplesheet","source_files","preprocessing","sdrf","idf","readme")): continue
                if not re.search(r"\.(txt|csv|tsv|xls)(\.gz)?$|\.xlsx$",name):
                    skipped.append({"datasetId":record["datasetId"],"path":str(file.relative_to(ROOT)).replace("\\","/"),"reason":"non-tabular or archive; no archive traversal in this pass"})
                    continue
                try:
                    detail = scan(file)
                except Exception as exc:
                    detail = {"candidate":False,"error":str(exc)}
                results.append({"datasetId":record["datasetId"],"accession":record["accession"],"availabilityBeforeAudit":record.get("verification",{}).get("resultAvailability"),"path":str(file.relative_to(ROOT)).replace("\\","/"),"bytes":file.stat().st_size,"provenance":known.get(file.name),**detail})

positive_control_path = ROOT/"geo_replication/datasets/GSE128148_mmus_arc_corticosterone/metadata/GSE128148_2019_Wray_4week_normalised_outliers_excluded.txt.gz"
positive_control = scan(positive_control_path)
assert positive_control["candidate"], "Known deposited author-DE table was not detected"
payload = {"reviewDate":"2026-09-04","scope":"Only comparisonLevel=processed_source; raw and metadata, never processed; first20textrows/256KiB or first20xlsxrows/1000columns per sheet. No tar traversal. Header hits require human confirmation of contrast and provenance.","datasetCount":len(scope),"fileCount":len(results),"candidateCount":sum(r.get("candidate",False) for r in results),"positiveControl":{"path":str(positive_control_path.relative_to(ROOT)).replace("\\","/"),"expected":"known GSE128148 author-DE table, excluded from discovery scope because already directly reviewed",**positive_control},"files":results,"skipped":skipped}
destination = ROOT/"data/author-validation/continued-sources/HEADER_AUDIT_2026-09-04.json"
destination.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print(json.dumps({"datasets":len(scope),"files":len(results),"candidates":[r for r in results if r.get("candidate")],"errors":[r for r in results if r.get("error")]},indent=2,ensure_ascii=False))
