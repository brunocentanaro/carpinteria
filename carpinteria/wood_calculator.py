from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

from openpyxl import load_workbook

from carpinteria.quote_router import WOOD_SPECIES, norm_text
from carpinteria.schemas import Quotation, QuotationLine

try:
    from carpinteria.settings import (
        LABOR_DAY_PRICE_UYU,
        MACHINERY_PERCENT,
        PROFIT_PERCENT,
        WASTE_PERCENT,
    )
except Exception:
    LABOR_DAY_PRICE_UYU = 2500
    MACHINERY_PERCENT = 7.5
    PROFIT_PERCENT = 65
    WASTE_PERCENT = 15


WOOD_PRICE_PATHS = (
    Path(r"C:\Users\Peluca\Documents\La casa del Carpintero\Cotizador_Madera_V2_Corregido.xlsx"),
    Path(r"C:\Users\Peluca\Downloads\Cotizador_Madera_V2_Corregido (2).xlsx"),
    Path(r"C:\Users\Peluca\Downloads\Cotizador_Madera_V2_Corregido.xlsx"),
)


@dataclass(frozen=True)
class WoodMaterial:
    id: str
    species: str
    features: str
    thickness_in: float
    length_m: float
    width_in: float
    price_uyu: float
    supplier: str = ""

    @property
    def width_cm_for_quote(self) -> float:
        # The existing woodworking sheet uses 1" = 2.25 cm for board coverage.
        return self.width_in * 2.25

    @property
    def price_per_meter_uyu(self) -> float:
        return self.price_uyu / self.length_m if self.length_m else 0.0


FALLBACK_WOOD_MATERIALS = (
    WoodMaterial("Pino Clear 1'", "Pino", "Clear", 1, 3.3, 6, 304.5, "fallback"),
    WoodMaterial("Pino Clear 3'", "Pino", "Clear", 3, 3.3, 3, 409.5, "fallback"),
    WoodMaterial("Euca Clear 1'", "Euca", "Clear", 1, 3.3, 6, 561, "fallback"),
    WoodMaterial("Roble Americano 1'", "Roble", "Americano", 1, 2.5, 11.11111111, 2583, "fallback"),
    WoodMaterial("Cedro Mara Clear 1'", "Cedro Mara", "Clear", 1, 2.4, 8.888888889, 1890, "fallback"),
    WoodMaterial("Abeto Clear 1.5'", "Abeto", "Clear", 1.5, 2.25, 10, 815.85, "fallback"),
)


def _num(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def load_wood_materials() -> list[WoodMaterial]:
    path = next((p for p in WOOD_PRICE_PATHS if p.exists()), None)
    if path is None:
        return list(FALLBACK_WOOD_MATERIALS)

    wb = load_workbook(path, data_only=True, read_only=True)
    if "Datos" not in wb.sheetnames:
        return list(FALLBACK_WOOD_MATERIALS)
    ws = wb["Datos"]
    out: list[WoodMaterial] = []
    accepted = {norm_text(s) for s in WOOD_SPECIES}
    for row in ws.iter_rows(min_row=4, values_only=True):
        species = norm_text(row[1] if len(row) > 1 else "")
        if species not in accepted:
            continue
        material = WoodMaterial(
            id=str(row[0] or "").strip(),
            species=str(row[1] or "").strip(),
            features=str(row[2] or "").strip(),
            thickness_in=_num(row[3]),
            length_m=_num(row[5]),
            width_in=_num(row[7]),
            price_uyu=_num(row[9]),
            supplier=str(row[11] or "").strip() if len(row) > 11 else "",
        )
        if material.id and material.thickness_in and material.length_m and material.width_in and material.price_uyu:
            out.append(material)
    return out or list(FALLBACK_WOOD_MATERIALS)


def _extract_species(text: str, material: str | None = None) -> str:
    normalized = norm_text(f"{text} {material or ''}")
    for species in ("cedro mara", "eucaliptus", "eucalipto", "euca", "roble", "abeto", "pino"):
        if species in normalized:
            return "euca" if species in {"eucaliptus", "eucalipto"} else species
    return "pino"


def _extract_inches(text: str, default: float = 1.0) -> float:
    normalized = norm_text(text)
    if "una pulgada" in normalized or "1 pulgada" in normalized or "1'" in normalized:
        return 1.0
    if "pulgada y media" in normalized or "1.5" in normalized or "1,5" in normalized:
        return 1.5
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:pulgadas?|')", normalized)
    if match:
        return float(match.group(1).replace(",", "."))
    return default


def _extract_leg_section(text: str) -> tuple[float, float] | None:
    normalized = norm_text(text)
    match = re.search(r"patas?.{0,25}?(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:pulgadas?|')?", normalized)
    if not match:
        match = re.search(r"(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:pulgadas?|').{0,25}?patas?", normalized)
    if not match:
        return None
    return float(match.group(1).replace(",", ".")), float(match.group(2).replace(",", "."))


def _dimensions_from_text(text: str) -> tuple[float | None, float | None, float | None]:
    normalized = norm_text(text).replace(",", ".")
    nums = [float(n) for n in re.findall(r"\b\d+(?:\.\d+)?\b", normalized)]
    meters = [n for n in nums if 0.1 <= n <= 5]
    if len(meters) >= 3:
        return meters[0] * 1000, meters[2] * 1000, meters[1] * 1000
    return None, None, None


def _match_material(
    materials: list[WoodMaterial],
    *,
    species: str,
    thickness_in: float,
    width_in: float | None = None,
) -> WoodMaterial:
    species_norm = norm_text(species)
    scoped = [m for m in materials if norm_text(m.species) in {species_norm, "euca" if species_norm.startswith("euca") else species_norm}]
    if not scoped:
        scoped = materials
    if width_in:
        exact_width = [m for m in scoped if abs(m.width_in - width_in) < 0.01 and abs(m.thickness_in - thickness_in) < 0.01]
        if exact_width:
            return exact_width[0]
    exact = [m for m in scoped if abs(m.thickness_in - thickness_in) < 0.01]
    if exact:
        return sorted(exact, key=lambda m: abs((width_in or m.width_in) - m.width_in))[0]
    return min(scoped, key=lambda m: abs(m.thickness_in - thickness_in))


def quote_solid_wood_table(
    *,
    description: str,
    name: str,
    quantity: int = 1,
    width_mm: float | None = None,
    height_mm: float | None = None,
    depth_mm: float | None = None,
    material: str | None = None,
    thickness_mm: float | None = None,
    waste_percent: float = WASTE_PERCENT,
    machinery_percent: float = MACHINERY_PERCENT,
    profit_percent: float = PROFIT_PERCENT,
    labor_day_price_uyu: float = LABOR_DAY_PRICE_UYU,
) -> Quotation:
    if not (width_mm and height_mm and depth_mm):
        parsed_w, parsed_h, parsed_d = _dimensions_from_text(description)
        width_mm = width_mm or parsed_w
        height_mm = height_mm or parsed_h
        depth_mm = depth_mm or parsed_d
    if not (width_mm and height_mm and depth_mm):
        return Quotation(notes="Faltan medidas para cotizar madera maciza: largo, ancho y altura.")

    species = _extract_species(description, material)
    top_thickness = _extract_inches(description, (thickness_mm or 25.4) / 25.4 if thickness_mm else 1.0)
    leg_section = _extract_leg_section(description)
    leg_thickness = leg_section[0] if leg_section else 3.0
    leg_width = leg_section[1] if leg_section else leg_thickness

    materials = load_wood_materials()
    top = _match_material(materials, species=species, thickness_in=top_thickness)
    legs = _match_material(materials, species=species, thickness_in=leg_thickness, width_in=leg_width)

    units = max(1, int(quantity or 1))
    top_length_m = width_mm / 1000
    top_width_cm = depth_mm / 10
    leg_length_m = height_mm / 1000
    leg_count = 4
    glue_extra_percent = 15.0

    raw_boards = top_width_cm / top.width_cm_for_quote if top.width_cm_for_quote else 0.0
    board_count = max(1, math.ceil(raw_boards))
    base_linear_m = board_count * top_length_m
    top_total_linear_m = base_linear_m * (1 + glue_extra_percent / 100)
    top_material = round(top_total_linear_m * top.price_per_meter_uyu * units, 2)

    legs_linear_m = leg_count * leg_length_m * units
    legs_material = round(legs_linear_m * legs.price_per_meter_uyu, 2)
    material_total = round(top_material + legs_material, 2)
    waste_amount = round(material_total * waste_percent / 100, 2)
    labor_days = 0.25 * units
    labor_amount = round(labor_days * labor_day_price_uyu, 2)
    machinery_base = material_total + waste_amount + labor_amount
    machinery_amount = round(machinery_base * machinery_percent / 100, 2)
    glue_amount = round((top_length_m * top_width_cm / 100) * 0.25 * 900 * units, 2)
    planing_amount = round(0.25 * labor_day_price_uyu * units, 2)

    lines = [
        QuotationLine(
            concept=f"{top.id} - tablas para tapa encolada ({board_count} tablas x {top_length_m:.2f}m + {glue_extra_percent:.0f}% agregado)",
            quantity=round(top_total_linear_m * units, 2),
            unit="metro",
            unit_price=round(top.price_per_meter_uyu, 2),
            subtotal=top_material,
        ),
        QuotationLine(
            concept=f"{legs.id} - patas {leg_thickness:g}x{leg_width:g} pulgadas ({leg_count} patas x {leg_length_m:.2f}m)",
            quantity=round(legs_linear_m, 2),
            unit="metro",
            unit_price=round(legs.price_per_meter_uyu, 2),
            subtotal=legs_material,
        ),
        QuotationLine(
            concept=f"Merma ({waste_percent:.0f}%)",
            quantity=1,
            unit="recargo",
            unit_price=waste_amount,
            subtotal=waste_amount,
        ),
        QuotationLine(
            concept=f"Mano de obra madera ({labor_days:.2f} dias x UYU {labor_day_price_uyu:.0f})",
            quantity=1,
            unit="recargo",
            unit_price=labor_amount,
            subtotal=labor_amount,
        ),
        QuotationLine(
            concept=f"Maquinaria / cargos fabriles ({machinery_percent:.0f}%)",
            quantity=1,
            unit="recargo",
            unit_price=machinery_amount,
            subtotal=machinery_amount,
        ),
        QuotationLine(
            concept="Encolado - adhesivo para formar tapa",
            quantity=1,
            unit="insumo",
            unit_price=glue_amount,
            subtotal=glue_amount,
        ),
        QuotationLine(
            concept="Cepillado / nivelado posterior al encolado",
            quantity=1,
            unit="proceso",
            unit_price=planing_amount,
            subtotal=planing_amount,
        ),
    ]
    subtotal = round(sum(line.subtotal for line in lines), 2)
    profit = round(subtotal * profit_percent / 100, 2)
    total = round(subtotal + profit, 2)
    return Quotation(
        lines=lines,
        subtotal=subtotal,
        margin_percent=profit_percent,
        margin_amount=profit,
        total=total,
        notes="Cotizacion por madera maciza: se forma la tapa encolando tablas. No usa placas ni cantos.",
        metadata={
            "quote_type": "madera_maciza",
            "subtype": "tablas_encoladas",
            "top_material": top.__dict__,
            "leg_material": legs.__dict__,
            "raw_boards_for_width": raw_boards,
            "board_count_for_width": board_count,
            "base_linear_m_top": base_linear_m,
            "top_total_linear_m": top_total_linear_m,
        },
    )
