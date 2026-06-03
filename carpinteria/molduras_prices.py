"""Price lookup for factory molduras/listones/barrotes.

The latest molduras workbook has cached values in the sheet XML. Reading it
with openpyxl is expensive because some companion workbooks have full-column
ranges, so this module streams only the catalog columns we need.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile


IVA_RATE = 1.22
VARILLA_LENGTH_M = 3.3
SCALE_THRESHOLD_VARILLAS = 20
ESTIMATED_MOLDURA_SURCHARGE = 1.15

# Excel maestros del dueño (solo existen en su Windows). En Mac/Railway no
# existen, así que se cae a los CSV commiteados (fuente de verdad cross-platform),
# que se regeneran con scripts/flatten_price_sheets.py.
DEFAULT_PRICE_FILES = [
    Path(r"C:\Users\Peluca\Documents\La casa del Carpintero\Licitaciones 2026\Listado de precios Molduras 26.5.26.xlsx"),
    Path(r"C:\Users\Peluca\Documents\La casa del Carpintero\Licitaciones 2026\Listado de precios Molduras 2026 - Mio util arreglado MANU.xlsx"),
    Path(r"C:\Users\Peluca\Downloads\Listado de precios Molduras 2026 - Mio util arreglado MANU.xlsx"),
]
DATA_DIR = Path(__file__).resolve().parent / "data"
MOLDURAS_CSV = DATA_DIR / "molduras_catalog.csv"
WOOD_DATA_CSV = DATA_DIR / "wood_datos.csv"


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
    estimated: bool = False
    note: str = ""
    source: str = "listado"
    breakdown: dict[str, float | str] | None = None


@dataclass(frozen=True)
class WoodTable:
    material: str
    name: str
    thickness_in: float
    width_in: float
    length_m: float
    price_uyu: float

    @property
    def thickness_cm(self) -> float:
        return self.thickness_in * 2.25

    @property
    def width_cm(self) -> float:
        return self.width_in * 2.25


@dataclass(frozen=True)
class FamilyCost:
    name: str
    minutes: float
    setup_days: float
    profit_percent: float


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


def _read_catalog_csv(path: Path) -> list[MolduraPrice]:
    """Lee el catálogo de molduras desde el CSV commiteado (fuente de verdad)."""
    if not path.exists():
        return []
    items: list[MolduraPrice] = []
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            code = str(row.get("code", "")).strip()
            family = str(row.get("family", "")).strip()
            description = str(row.get("description", "")).strip()
            width = _float(row.get("width_mm"))
            height = _float(row.get("height_mm"))
            meter = _float(row.get("price_meter_iva"))
            varilla = _float(row.get("price_varilla_iva"))
            if code and family and description and width and height and meter and varilla:
                items.append(MolduraPrice(
                    code=code, family=family, description=description,
                    width_mm=width, height_mm=height,
                    price_meter_iva=meter, price_varilla_iva=varilla,
                    source_path=str(path), sheet_name="csv",
                ))
    return items


@lru_cache(maxsize=4)
def load_prices(path: str | None = None) -> tuple[MolduraPrice, ...]:
    paths = [Path(path)] if path else _candidate_paths()
    errors: list[str] = []
    for candidate in paths:
        if not candidate or not candidate.exists():
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
    # Sin Excel local utilizable (caso Mac/Railway): CSV commiteado.
    csv_items = _read_catalog_csv(MOLDURAS_CSV)
    if csv_items:
        return tuple(csv_items)
    detail = " | ".join(errors) if errors else f"{MOLDURAS_CSV}: no existe"
    raise RuntimeError("No pude leer el listado de molduras. " + detail)


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
        if "impc" in code_n:
            return 20
        return -100
    if mat in {"euca", "eucaliptus", "eucalipto", "imp", "importado"}:
        if "impc" in code_n:
            return -100
        return 30 if "imp" in code_n else -100
    return 0


def _material_kind(material: str | None) -> str:
    mat = _norm(material)
    if mat in {"euca", "eucaliptus", "eucalipto", "imp", "importado"}:
        return "euca"
    return "pino"


def _family_group(family: str | None, description: str = "") -> str:
    haystack = f"{_norm(family)} {_norm(description)}"
    if any(token in haystack for token in ("barrote", "barrotes")):
        return "Barrotes"
    if any(token in haystack for token in ("liston", "listones", "tabla", "tablas")):
        return "Listones / Tablas"
    if any(token in haystack for token in ("montante", "montantes")):
        return "Listones / Tablas"
    return "Molduras"


def _family_cost(group: str, material: str | None) -> FamilyCost:
    kind = _material_kind(material)
    table = {
        "pino": {
            "Listones / Tablas": FamilyCost("Listones / Tablas", 7, 0.1, 0.75),
            "Molduras": FamilyCost("Molduras", 12, 0.3125, 0.625),
            "Barrotes": FamilyCost("Barrotes", 14.5, 0.625, 0.375),
        },
        "euca": {
            "Listones / Tablas": FamilyCost("Listones / Tablas", 7, 0.1, 0.8),
            "Molduras": FamilyCost("Molduras", 12, 0.3125, 0.625),
            "Barrotes": FamilyCost("Barrotes", 14.5, 0.625, 0.45),
        },
    }
    return table[kind].get(group, table[kind]["Molduras"])


@lru_cache(maxsize=4)
def load_wood_tables(path: str | None = None) -> tuple[WoodTable, ...]:
    paths = [Path(path)] if path else _candidate_paths()
    for candidate in paths:
        if not candidate or not candidate.exists():
            continue
        try:
            with zipfile.ZipFile(candidate) as zf:
                shared_strings = _load_shared_strings(zf)
                sheet_path = _workbook_sheets(zf).get("Datos")
                if not sheet_path:
                    continue
                ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                rows: list[WoodTable] = []
                with zf.open(sheet_path) as fh:
                    for _, row in ET.iterparse(fh, events=("end",)):
                        if row.tag != ns + "row":
                            continue
                        row_idx = int(row.attrib.get("r", "0") or 0)
                        if row_idx < 4:
                            row.clear()
                            continue
                        cells: dict[str, str] = {}
                        for cell in row.findall(ns + "c"):
                            col = _column(cell.attrib.get("r", ""))
                            if col in {"B", "C", "D", "F", "H", "J"}:
                                cells[col] = _cell_value(cell, shared_strings)
                        material = str(cells.get("B", "")).strip()
                        if not material:
                            row.clear()
                            continue
                        features = str(cells.get("C", "")).strip()
                        thickness = _float(cells.get("D"))
                        length = _float(cells.get("F"))
                        width = _float(cells.get("H"))
                        price = _float(cells.get("J"))
                        if thickness and width and length and price:
                            rows.append(WoodTable(
                                material=material,
                                name=f"{material} {features}".strip(),
                                thickness_in=thickness,
                                width_in=width,
                                length_m=length,
                                price_uyu=price,
                            ))
                        row.clear()
                if rows:
                    return tuple(rows)
        except Exception:
            continue
    # Sin Excel local utilizable (Mac/Railway): CSV commiteado de la solapa Datos.
    return _wood_tables_from_csv(WOOD_DATA_CSV)


def _wood_tables_from_csv(path: Path) -> tuple[WoodTable, ...]:
    if not path.exists():
        return ()
    rows: list[WoodTable] = []
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            material = str(row.get("species", "")).strip()
            thickness = _float(row.get("thickness_in"))
            length = _float(row.get("length_m"))
            width = _float(row.get("width_in"))
            price = _float(row.get("price_uyu"))
            if material and thickness and width and length and price:
                features = str(row.get("features", "")).strip()
                rows.append(WoodTable(
                    material=material,
                    name=f"{material} {features}".strip(),
                    thickness_in=thickness,
                    width_in=width,
                    length_m=length,
                    price_uyu=price,
                ))
    return tuple(rows)


def _select_wood_table(width_mm: float, height_mm: float, material: str | None) -> WoodTable | None:
    kind = _material_kind(material)
    thick_cm = min(width_mm, height_mm) / 10
    wide_cm = max(width_mm, height_mm) / 10
    candidates: list[tuple[float, WoodTable]] = []
    for table in load_wood_tables():
        table_kind = _material_kind(table.material)
        if table_kind != kind:
            continue
        if table.thickness_cm + 0.01 < thick_cm or table.width_cm + 0.01 < wide_cm:
            continue
        capacity = max((table.thickness_cm / thick_cm) * (table.width_cm / wide_cm) * (1 - 0.35), 0.01)
        mp_per_varilla = table.price_uyu / capacity
        waste_ratio = (table.thickness_cm * table.width_cm - thick_cm * wide_cm) / max(thick_cm * wide_cm, 1)
        candidates.append((mp_per_varilla + waste_ratio * 0.05, table))
    if candidates:
        return sorted(candidates, key=lambda row: row[0])[0][1]
    fallback = [t for t in load_wood_tables() if _material_kind(t.material) == kind]
    return sorted(fallback, key=lambda t: (t.price_uyu, t.width_cm), reverse=False)[0] if fallback else None


def estimate_price_from_conversor(
    width_mm: float,
    height_mm: float,
    material: str | None = None,
    family: str | None = None,
) -> MolduraPrice | None:
    table = _select_wood_table(width_mm, height_mm, material)
    if table is None:
        return None
    group = _family_group(family)
    cost = _family_cost(group, material)

    thick_cm = min(width_mm, height_mm) / 10
    wide_cm = max(width_mm, height_mm) / 10
    if thick_cm <= 0 or wide_cm <= 0:
        return None
    molduras_per_table = (table.thickness_cm / thick_cm) * (table.width_cm / wide_cm)
    molduras_per_table = max(molduras_per_table * (1 - 0.35), 0.01)
    mp_per_varilla = table.price_uyu / molduras_per_table

    labor_day = 2300.0
    labor_hour = labor_day / 8
    setup_avg = 20.0
    machinery_pct = 0.10
    mo_per_varilla = (cost.minutes / 60) * labor_hour
    setup_per_varilla = (cost.setup_days * labor_day) / setup_avg
    machinery = (mp_per_varilla + mo_per_varilla) * machinery_pct
    base_cost = mp_per_varilla + mo_per_varilla + setup_per_varilla + machinery
    profit = base_cost * cost.profit_percent
    price_varilla = (base_cost + profit) * IVA_RATE * ESTIMATED_MOLDURA_SURCHARGE
    price_meter = price_varilla / VARILLA_LENGTH_M * 1.20

    item = MolduraPrice(
        code="EST-CONVERSOR",
        family=f"{(family or group)} estimativo",
        description=f"No stock, calculado con conversor sobre {table.name} {table.thickness_in:g}x{table.width_in:g}\"",
        width_mm=float(width_mm),
        height_mm=float(height_mm),
        price_meter_iva=round(price_meter, 2),
        price_varilla_iva=round(price_varilla, 2),
        source_path="Conversor MANU",
        sheet_name=f"Conversor ({'EUCA' if _material_kind(material) == 'euca' else 'PN'})",
    )
    object.__setattr__(item, "_breakdown", {
        "madera": table.name,
        "tabla_espesor_pulg": table.thickness_in,
        "tabla_ancho_pulg": table.width_in,
        "precio_tabla_uyu": table.price_uyu,
        "molduras_por_tabla_merma": round(molduras_per_table, 4),
        "materia_prima_varilla": round(mp_per_varilla, 2),
        "mo_minutos": cost.minutes,
        "mo_varilla": round(mo_per_varilla, 2),
        "seteo_varilla": round(setup_per_varilla, 2),
        "maquinaria": round(machinery, 2),
        "ganancia_pct": cost.profit_percent,
        "recargo_modelo_no_listado": ESTIMATED_MOLDURA_SURCHARGE - 1,
    })
    return item


def _family_score(family: str, description: str, query_family: str | None) -> int:
    haystack = f"{_norm(family)} {_norm(description)}"
    query = _norm(query_family)
    if query:
        def model_token(text: str) -> str | None:
            explicit = re.search(r"\b(?:n|no|num|numero|nro)\s*[°º.]?\s*([a-z0-9-]+)\b", text)
            if explicit:
                return explicit.group(1)
            all_tokens = re.findall(r"\b(?:z-\d+|\d+[a-z]?)\b", text)
            return all_tokens[-1] if all_tokens else None

        query_no = model_token(query)
        if "contravidrio" in query and query_no:
            wanted = query_no
            found = model_token(haystack)
            if found and found == wanted:
                return 80
            return -40
        media_no = model_token(query)
        if "media cana" in query and media_no:
            wanted = media_no
            found = model_token(haystack)
            if found and found == wanted:
                return 80
            return -40
        cuadro_no = model_token(query)
        if "cuadro" in query and cuadro_no:
            wanted = cuadro_no
            found = model_token(haystack)
            if found and found == wanted:
                return 80
            return -40
        aliases = {
            "liston": ("liston", "listones"),
            "barrote": ("barrote", "barrotes"),
            "zocalo": ("zocalo", "zocalos"),
            "contravidrio": ("contravidrio", "contravidrios"),
            "media cana": ("media cana",),
            "montante": ("montante", "montantes"),
            "moldura": ("moldura",),
        }
        for alias in aliases.get(query, (query,)):
            if alias in haystack:
                return 40
        return -20
    if "liston" in haystack:
        return 12
    if "montante" in haystack:
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
            _family_score(item.family, item.description, family),
            _material_score(item.code, material),
            -len(item.code),
        ),
        reverse=True,
    )
    best = ranked[0]
    if _material_score(best.code, material) < 0:
        return None
    if family and _family_score(best.family, best.description, family) < 0:
        return None
    return best


def estimate_price(
    width_mm: float,
    height_mm: float,
    material: str | None = None,
    family: str | None = None,
) -> MolduraPrice | None:
    """Return a competitive estimate for a non-stock moldura."""
    from_conversor = estimate_price_from_conversor(width_mm, height_mm, material=material, family=family)
    if from_conversor is not None:
        return from_conversor

    # Fallback if the MANU conversor cannot be read: use the nearest listed item.
    width = float(width_mm)
    height = float(height_mm)
    candidates: list[tuple[float, MolduraPrice]] = []
    try:
        listed_items = load_prices()
    except RuntimeError:
        listed_items = ()
    for item in listed_items:
        mat_score = _material_score(item.code, material)
        fam_score = _family_score(item.family, item.description, family)
        if mat_score < 0:
            continue
        if family and fam_score < 0:
            continue
        dw = abs(item.width_mm - width) / max(width, item.width_mm, 1)
        dh = abs(item.height_mm - height) / max(height, item.height_mm, 1)
        score = dw + dh - (mat_score + max(fam_score, 0)) / 1000
        candidates.append((score, item))
    if not candidates and family:
        return estimate_price(width, height, material=material, family=None)
    if not candidates:
        return None

    _, ref = sorted(candidates, key=lambda row: row[0])[0]
    ref_area = max(ref.width_mm * ref.height_mm, 1)
    requested_area = max(width * height, 1)
    area_factor = requested_area / ref_area
    meter = ref.price_meter_iva * area_factor * ESTIMATED_MOLDURA_SURCHARGE
    varilla = ref.price_varilla_iva * area_factor * ESTIMATED_MOLDURA_SURCHARGE
    fam = family or ref.family
    return MolduraPrice(
        code=f"EST-{ref.code}",
        family=f"{fam} estimativo",
        description=f"No stock, estimado segun {ref.code} {ref.width_mm:g}x{ref.height_mm:g}",
        width_mm=width,
        height_mm=height,
        price_meter_iva=round(meter, 2),
        price_varilla_iva=round(varilla, 2),
        source_path=ref.source_path,
        sheet_name=ref.sheet_name,
    )


def quote_price(
    width_mm: float,
    height_mm: float,
    quantity: float = 1,
    material: str | None = None,
    family: str | None = None,
    unit: str = "varilla",
    include_iva: bool = True,
) -> MolduraQuote | None:
    try:
        item = find_price(width_mm, height_mm, material=material, family=family)
    except RuntimeError:
        item = None
    estimated = False
    note = ""
    if item is None:
        item = estimate_price(width_mm, height_mm, material=material, family=family)
        if item is None:
            return None
        estimated = True
        note = "No disponemos de esa moldura en stock/listado; este es un precio estimativo."
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
        scale_hint=unit_label == "varilla" and float(quantity) > SCALE_THRESHOLD_VARILLAS,
        estimated=estimated,
        note=note,
        source="conversor" if estimated and item.code == "EST-CONVERSOR" else ("estimado-listado" if estimated else "listado"),
        breakdown=getattr(item, "_breakdown", None),
    )
