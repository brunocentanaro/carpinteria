"""Price lookup for factory molduras/listones/barrotes.

The latest molduras workbook has cached values in the sheet XML. Reading it
with openpyxl is expensive because some companion workbooks have full-column
ranges, so this module streams only the catalog columns we need.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile


IVA_RATE = 1.22

DEFAULT_PRICE_FILES = [
    Path(r"C:\Users\Peluca\Documents\La casa del Carpintero\Licitaciones 2026\Listado de precios Molduras 26.5.26.xlsx"),
    Path(r"C:\Users\Peluca\Downloads\Listado de precios Molduras 2026 - Mio util arreglado MANU.xlsx"),
]


@dataclass(frozen=True)
class MolduraPrice:
    code: str
    family: str
    description: str
    width_mm: float
    height_mm: float
    price_meter_iva: float
    price_varilla_iva: float
    source_path: str
    sheet_name: str

    @property
    def price_varilla_without_iva(self) -> float:
        return self.price_varilla_iva / IVA_RATE

    @property
    def price_meter_without_iva(self) -> float:
        return self.price_meter_iva / IVA_RATE


@dataclass(frozen=True)
class MolduraQuote:
    item: MolduraPrice
    quantity: float
    unit: str
    unit_price: float
    total: float
    iva_included: bool
    scale_hint: bool


def _norm(text: object) -> str:
    raw = str(text or "").strip().lower()
    raw = unicodedata.normalize("NFKD", raw)
    return "".join(ch for ch in raw if not unicodedata.combining(ch))


def _float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def _column(cell_ref: str) -> str:
    match = re.match(r"([A-Z]+)", cell_ref)
    return match.group(1) if match else ""


def _load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    values: list[str] = []
    for si in root.findall(ns + "si"):
        values.append("".join(t.text or "" for t in si.iter(ns + "t")))
    return values


def _workbook_sheets(zf: zipfile.ZipFile) -> dict[str, str]:
    ns_main = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    ns_rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_by_id = {
        rel.attrib["Id"]: rel.attrib["Target"].lstrip("/")
        for rel in rels
        if rel.attrib.get("Id") and rel.attrib.get("Target")
    }
    sheets: dict[str, str] = {}
    for sheet in wb.findall(ns_main + "sheets/" + ns_main + "sheet"):
        rid = sheet.attrib.get(ns_rel + "id", "")
        target = rel_by_id.get(rid)
        if not target:
            continue
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        sheets[sheet.attrib.get("name", "")] = target
    return sheets


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    value = cell.find(ns + "v")
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        try:
            return shared_strings[int(value.text)]
        except (ValueError, IndexError):
            return ""
    return value.text


def _read_catalog_sheet(
    zf: zipfile.ZipFile,
    sheet_name: str,
    sheet_path: str,
    shared_strings: list[str],
    source_path: Path,
) -> list[MolduraPrice]:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    items: list[MolduraPrice] = []
    with zf.open(sheet_path) as fh:
        for _, row in ET.iterparse(fh, events=("end",)):
            if row.tag != ns + "row":
                continue
            cells: dict[str, str] = {}
            for cell in row.findall(ns + "c"):
                cells[_column(cell.attrib.get("r", ""))] = _cell_value(cell, shared_strings)
            code = str(cells.get("A", "")).strip()
            family = str(cells.get("B", "")).strip()
            description = str(cells.get("C", "")).strip()
            width = _float(cells.get("D"))
            height = _float(cells.get("E"))
            meter = _float(cells.get("F"))
            varilla = _float(cells.get("G"))
            if code and family and description and width and height and meter and varilla:
                items.append(MolduraPrice(
                    code=code,
                    family=family,
                    description=description,
                    width_mm=width,
                    height_mm=height,
                    price_meter_iva=meter,
                    price_varilla_iva=varilla,
                    source_path=str(source_path),
                    sheet_name=sheet_name,
                ))
            row.clear()
    return items


def _candidate_paths() -> list[Path]:
    env_path = os.getenv("MOLDURAS_PRICE_FILE")
    paths = [Path(env_path)] if env_path else []
    paths.extend(DEFAULT_PRICE_FILES)
    return paths


@lru_cache(maxsize=4)
def load_prices(path: str | None = None) -> tuple[MolduraPrice, ...]:
    paths = [Path(path)] if path else _candidate_paths()
    errors: list[str] = []
    for candidate in paths:
        if not candidate or not candidate.exists():
            errors.append(f"{candidate}: no existe")
            continue
        try:
            with zipfile.ZipFile(candidate) as zf:
                shared_strings = _load_shared_strings(zf)
                sheets = _workbook_sheets(zf)
                for wanted in ("FINAL", "Molduras.", "Molduras. (2)"):
                    sheet_path = sheets.get(wanted)
                    if sheet_path:
                        items = _read_catalog_sheet(
                            zf, wanted, sheet_path, shared_strings, candidate
                        )
                        if items:
                            return tuple(items)
                for sheet_name, sheet_path in sheets.items():
                    items = _read_catalog_sheet(
                        zf, sheet_name, sheet_path, shared_strings, candidate
                    )
                    if items:
                        return tuple(items)
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    raise RuntimeError("No pude leer el listado de molduras. " + " | ".join(errors))


def _material_score(code: str, material: str | None) -> int:
    code_n = _norm(code)
    mat = _norm(material)
    if not mat:
        return 0
    if mat in {"pino", "pn", "nac", "nacional"}:
        if "nac" in code_n:
            return 30
        if "pn" in code_n:
            return 25
        return -100
    if mat in {"euca", "eucaliptus", "eucalipto", "imp", "importado"}:
        return 30 if "imp" in code_n else -100
    return 0


def _family_score(family: str, description: str, query_family: str | None) -> int:
    haystack = f"{_norm(family)} {_norm(description)}"
    query = _norm(query_family)
    if query:
        aliases = {
            "liston": ("liston", "listones"),
            "barrote": ("barrote", "barrotes"),
            "zocalo": ("zocalo", "zocalos"),
            "contravidrio": ("contravidrio", "contravidrios"),
            "media cana": ("media cana",),
            "moldura": ("moldura",),
        }
        for alias in aliases.get(query, (query,)):
            if alias in haystack:
                return 40
        return -20
    if "liston" in haystack:
        return 12
    if "barrote" in haystack:
        return 8
    return 0


def find_price(
    width_mm: float,
    height_mm: float,
    material: str | None = None,
    family: str | None = None,
) -> MolduraPrice | None:
    width = float(width_mm)
    height = float(height_mm)
    exact = [
        item for item in load_prices()
        if abs(item.width_mm - width) < 0.01 and abs(item.height_mm - height) < 0.01
    ]
    if not exact:
        return None
    ranked = sorted(
        exact,
        key=lambda item: (
            _material_score(item.code, material),
            _family_score(item.family, item.description, family),
            -len(item.code),
        ),
        reverse=True,
    )
    best = ranked[0]
    if _material_score(best.code, material) < 0:
        return None
    return best


def quote_price(
    width_mm: float,
    height_mm: float,
    quantity: float = 1,
    material: str | None = None,
    family: str | None = None,
    unit: str = "varilla",
    include_iva: bool = True,
) -> MolduraQuote | None:
    item = find_price(width_mm, height_mm, material=material, family=family)
    if item is None:
        return None
    unit_n = _norm(unit)
    is_meter = unit_n in {"m", "mt", "mts", "metro", "metros"}
    if is_meter:
        unit_price = item.price_meter_iva if include_iva else item.price_meter_without_iva
        unit_label = "metro"
    else:
        unit_price = item.price_varilla_iva if include_iva else item.price_varilla_without_iva
        unit_label = "varilla"
    return MolduraQuote(
        item=item,
        quantity=float(quantity),
        unit=unit_label,
        unit_price=unit_price,
        total=unit_price * float(quantity),
        iva_included=include_iva,
        scale_hint=unit_label == "varilla" and float(quantity) > 20,
    )

