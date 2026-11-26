"""MGI report readers used by the HypoMap export.

Written by Helene Li (DrWenyuanHe/hypoexplorer-data#1, 51755a3).
"""

import csv
import gzip
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class CanonicalGene:
    canonical_gene_id: str
    canonical_symbol: str
    marker_name: str
    ensembl_gene_id: str = ""

    def as_candidate(self, matched_by: str = "") -> dict:
        out = {
            "canonical_gene_id": self.canonical_gene_id,
            "canonical_symbol": self.canonical_symbol,
            "marker_name": self.marker_name,
            "ensembl_gene_id": self.ensembl_gene_id,
        }
        if matched_by:
            out["matched_by"] = matched_by
        return out


def norm_symbol(symbol: object) -> str:
    return str(symbol).strip()


def norm_key(symbol: object) -> str:
    return norm_symbol(symbol).casefold()


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", newline="", errors="replace")
    return path.open("rt", newline="", errors="replace")


def read_mgi_markers(marker_path: Path) -> tuple[dict[str, CanonicalGene], dict[str, set[str]], dict[str, set[str]]]:
    """Return canonical genes and symbol indexes from MGI MRK_List1.

    `current_index` maps current official symbols to MGI IDs.
    `alias_index` maps synonyms and withdrawn symbols to current MGI IDs.
    """
    raw_rows: dict[str, dict] = {}
    current_index: dict[str, set[str]] = defaultdict(set)
    alias_index: dict[str, set[str]] = defaultdict(set)

    with open_text(marker_path) as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            if row.get("Marker Type") != "Gene":
                continue
            mgi_id = norm_symbol(row.get("MGI Accession ID", ""))
            symbol = norm_symbol(row.get("Marker Symbol", ""))
            if not mgi_id or not symbol:
                continue
            raw_rows[mgi_id] = row

    canonical_by_id: dict[str, CanonicalGene] = {}
    for mgi_id, row in raw_rows.items():
        current_id = norm_symbol(row.get("Current MGI Accession ID (if withdrawn)", ""))
        current_symbol = norm_symbol(row.get("Current Marker Symbol (if withdrawn)", ""))
        if row.get("Status") == "W" and current_id:
            continue
        canonical_by_id[mgi_id] = CanonicalGene(
            canonical_gene_id=mgi_id,
            canonical_symbol=norm_symbol(row.get("Marker Symbol", "")),
            marker_name=norm_symbol(row.get("Marker Name", "")),
        )

    for mgi_id, row in raw_rows.items():
        symbol = norm_symbol(row.get("Marker Symbol", ""))
        status = row.get("Status")
        current_id = norm_symbol(row.get("Current MGI Accession ID (if withdrawn)", ""))
        current_symbol = norm_symbol(row.get("Current Marker Symbol (if withdrawn)", ""))
        target_id = current_id if status == "W" and current_id else mgi_id
        if target_id not in canonical_by_id:
            continue

        if status == "W":
            alias_index[norm_key(symbol)].add(target_id)
            if current_symbol:
                alias_index[norm_key(current_symbol)].add(target_id)
        else:
            current_index[norm_key(symbol)].add(target_id)
            synonyms = norm_symbol(row.get("Marker Synonyms (pipe-separated)", ""))
            for synonym in [s.strip() for s in synonyms.split("|") if s.strip()]:
                alias_index[norm_key(synonym)].add(target_id)

    return canonical_by_id, current_index, alias_index


def add_ensembl_ids(canonical_by_id: dict[str, CanonicalGene], coord_path: Path) -> dict[str, CanonicalGene]:
    with coord_path.open("rt", newline="", errors="replace") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            mgi_id = norm_symbol(row.get("1. MGI accession id", ""))
            ensembl_id = norm_symbol(row.get("11. Ensembl gene id", ""))
            if not mgi_id or not ensembl_id or mgi_id not in canonical_by_id:
                continue
            gene = canonical_by_id[mgi_id]
            if not gene.ensembl_gene_id:
                canonical_by_id[mgi_id] = CanonicalGene(
                    canonical_gene_id=gene.canonical_gene_id,
                    canonical_symbol=gene.canonical_symbol,
                    marker_name=gene.marker_name,
                    ensembl_gene_id=ensembl_id,
                )
    return canonical_by_id


def load_gene_source_indexes(source_dir: Path) -> tuple[dict[str, CanonicalGene], dict[str, set[str]], dict[str, set[str]]]:
    marker_path = source_dir / "MRK_List1.rpt.gz"
    coord_path = source_dir / "MGI_Gene_Model_Coord.rpt"
    canonical_by_id, current_index, alias_index = read_mgi_markers(marker_path)
    canonical_by_id = add_ensembl_ids(canonical_by_id, coord_path)
    return canonical_by_id, current_index, alias_index
