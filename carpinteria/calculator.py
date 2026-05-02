"""Cotización (placa + canto + recargos) on top of the new ProductCatalog.

Quotation lines are produced in UYU because that's what the customer sees,
even though the catalog stores USD-canonicalized prices. The TC used is
explicit in the function signature so the caller controls conversion.
"""
from __future__ import annotations

import math

from carpinteria.catalog import PlacaMatch, ProductCatalog
from carpinteria.lista_precios_parser import Producto
from carpinteria.schemas import (
    CutPiece,
    Quotation,
    QuotationLine,
)
from carpinteria.settings import (
    CUTS_BASE_MAX,
    CUTS_PERCENT,
    LABOR_PERCENT,
    MACHINERY_PERCENT,
    PARTIAL_BOARD_FULL_THRESHOLD,
    PARTIAL_BOARD_TIERS,
    PAYMENT_DELAY_MAX_DAYS,
    PAYMENT_DELAY_TIERS,
    PROFIT_PERCENT,
    STATE_SURCHARGE_PERCENT,
    WASTE_PERCENT,
)
from carpinteria.shipping import ShippingProvider


# ---------------------------------------------------------------------------
# Geometry / surcharge helpers (unchanged from the legacy code)
# ---------------------------------------------------------------------------

def estimate_boards_needed(pieces: list[CutPiece], placa: Producto) -> int:
    board_area = (placa.ancho_mm or 0) * (placa.largo_mm or 0)
    if board_area <= 0:
        return 1
    total_piece_area = sum(p.width_mm * p.height_mm * p.quantity for p in pieces)
    return max(1, math.ceil(total_piece_area / board_area * 1.15))


def board_usage_percent(pieces: list[CutPiece], placa: Producto, boards_needed: int) -> float:
    board_area = (placa.ancho_mm or 0) * (placa.largo_mm or 0) * boards_needed
    if board_area <= 0:
        return 100.0
    piece_area = sum(p.width_mm * p.height_mm * p.quantity for p in pieces)
    return min(round(piece_area / board_area * 100, 1), 100.0)


def partial_board_surcharge(usage_pct: float) -> tuple[float, str]:
    if usage_pct >= PARTIAL_BOARD_FULL_THRESHOLD:
        return 0.0, "placa entera"
    for tier_min, surcharge in PARTIAL_BOARD_TIERS:
        if usage_pct >= tier_min:
            return surcharge, f"uso {usage_pct:.0f}% → +{surcharge:.0f}%"
    return PARTIAL_BOARD_TIERS[-1][1], f"uso {usage_pct:.0f}% → +{PARTIAL_BOARD_TIERS[-1][1]:.0f}%"


def payment_surcharge(payment_days: int) -> tuple[float, str]:
    if payment_days > PAYMENT_DELAY_MAX_DAYS:
        return -1.0, f">{PAYMENT_DELAY_MAX_DAYS} días — no cotizable"
    delay_pct = 0.0
    for max_days, pct in PAYMENT_DELAY_TIERS:
        if payment_days <= max_days:
            delay_pct = pct
            break
    else:
        delay_pct = PAYMENT_DELAY_TIERS[-1][1]
    total_pct = STATE_SURCHARGE_PERCENT + delay_pct
    return total_pct, f"estado {STATE_SURCHARGE_PERCENT:.0f}% + demora {payment_days}d {delay_pct}%"


def total_edge_banding_meters(pieces: list[CutPiece]) -> float:
    total_mm = 0.0
    for piece in pieces:
        for side in piece.edge_sides:
            if side in ("top", "bottom"):
                total_mm += piece.width_mm * piece.quantity
            elif side in ("left", "right"):
                total_mm += piece.height_mm * piece.quantity
    return total_mm / 1000.0


def total_cuts(pieces: list[CutPiece]) -> int:
    return sum(p.quantity * 2 for p in pieces)


# ---------------------------------------------------------------------------
# Public quote function
# ---------------------------------------------------------------------------

def calculate_quotation(
    pieces: list[CutPiece],
    catalog: ProductCatalog,
    material: str,
    thickness_mm: float,
    color: str,
    tc: float,
    boards_needed: int | None = None,
    edge_banding_name: str | None = None,
    machinery_percent: float = MACHINERY_PERCENT,
    waste_percent: float = WASTE_PERCENT,
    labor_percent: float = LABOR_PERCENT,
    cuts_percent: float = CUTS_PERCENT,
    cuts_base_max: int = CUTS_BASE_MAX,
    profit_percent: float = PROFIT_PERCENT,
    payment_days: int | None = None,
    shipping_provider: ShippingProvider | None = None,
    destination: str = "",
    placa_sku: str | None = None,
) -> Quotation:
    """Calcular cotización para una pieza/placa de placa + cantos + recargos.

    `tc` se usa para convertir precios USD del catálogo a UYU (la moneda en la
    que el cliente recibe la cotización).

    Si `placa_sku` se pasa, se usa esa placa exacta del catálogo y se saltea el
    matching heurístico por material/grosor/color. Útil cuando el usuario eligió
    manualmente una placa desde la UI tras un mismatch.
    """
    lines: list[QuotationLine] = []
    notes_parts: list[str] = []

    match: PlacaMatch | None = None
    if placa_sku:
        pinned = catalog.find_by_sku(placa_sku)
        if pinned is not None:
            match = PlacaMatch(pinned, thickness_mm, is_approx=False)
    if match is None:
        match = catalog.find_placa(material, thickness_mm, color)
    if match is None:
        sample = [
            f"  - {p.material} {p.espesor_mm or '?'}mm: {p.nombre} (USD {p.precio_usd_simp})"
            for p in catalog.filter(tipo_producto="PLACA")[:10]
        ]
        return Quotation(
            notes=(
                f"No se encontró placa: {material} {thickness_mm}mm {color}\n\n"
                f"Algunas placas disponibles:\n" + "\n".join(sample)
            )
        )

    placa = match.producto
    if match.is_approx:
        notes_parts.append(match.thickness_note)

    placa_label = (
        f"Placa {placa.material or placa.familia} "
        f"{(placa.espesor_mm or 0):.0f}mm {placa.nombre}"
    )
    placa_unit_uyu = round(placa.precio_usd_simp * tc, 2)
    approx_suffix = f" {match.thickness_note}" if match.is_approx else ""

    # Quantity of placas
    from_plan = boards_needed is not None
    if boards_needed is None:
        boards_needed = estimate_boards_needed(pieces, placa)

    if from_plan:
        placa_total_uyu = round(boards_needed * placa_unit_uyu, 2)
        lines.append(QuotationLine(
            concept=f"{placa_label}{approx_suffix}",
            quantity=boards_needed,
            unit="placa",
            unit_price=placa_unit_uyu,
            subtotal=placa_total_uyu,
        ))
    else:
        board_area = (placa.ancho_mm or 0) * (placa.largo_mm or 0)
        piece_area = sum(p.width_mm * p.height_mm * p.quantity for p in pieces)

        full_boards = max(0, int(piece_area // board_area)) if board_area > 0 else 0
        leftover_area = piece_area - full_boards * board_area
        leftover_pct = round(leftover_area / board_area * 100, 1) if board_area > 0 else 0.0

        placa_total_uyu = 0.0
        if full_boards > 0:
            full_total = round(full_boards * placa_unit_uyu, 2)
            placa_total_uyu += full_total
            lines.append(QuotationLine(
                concept=f"{placa_label}{approx_suffix}",
                quantity=full_boards,
                unit="placa",
                unit_price=placa_unit_uyu,
                subtotal=full_total,
            ))
        if leftover_area > 0:
            surcharge_pct, surcharge_label = partial_board_surcharge(leftover_pct)
            if leftover_pct >= PARTIAL_BOARD_FULL_THRESHOLD:
                partial_price = placa_unit_uyu
            else:
                proportional = round(placa_unit_uyu * leftover_pct / 100, 2)
                partial_price = round(proportional * (1 + surcharge_pct / 100), 2)
            placa_total_uyu += partial_price
            lines.append(QuotationLine(
                concept=f"{placa_label} parcial ({surcharge_label}){approx_suffix}",
                quantity=1,
                unit="placa",
                unit_price=partial_price,
                subtotal=partial_price,
            ))
        placa_total_uyu = round(placa_total_uyu, 2)

    # Cantos
    has_edge_sides = any(p.edge_sides for p in pieces)
    canto_total_uyu = 0.0
    if has_edge_sides:
        canto_query = edge_banding_name or color
        canto = catalog.find_canto(canto_query)
        meters = total_edge_banding_meters(pieces)
        if canto and meters > 0:
            canto_unit_uyu = round(canto.precio_usd_simp * tc, 2)
            canto_total_uyu = round(meters * canto_unit_uyu, 2)
            lines.append(QuotationLine(
                concept=f"Canto {canto.nombre}",
                quantity=round(meters, 2),
                unit="metro",
                unit_price=canto_unit_uyu,
                subtotal=canto_total_uyu,
            ))
        elif meters > 0:
            lines.append(QuotationLine(
                concept="Canto (sin precio - especificar tipo)",
                quantity=round(meters, 2),
                unit="metro",
                unit_price=0.0,
                subtotal=0.0,
            ))

    # Recargos sobre material (placa + canto)
    material_subtotal = round(placa_total_uyu + canto_total_uyu, 2)

    n_cuts = total_cuts(pieces)
    cuts_factor = n_cuts / cuts_base_max if cuts_base_max else 0
    cuts_effective = round(cuts_percent * cuts_factor, 1)
    cuts_amount = round(material_subtotal * cuts_effective / 100, 2)
    lines.append(QuotationLine(
        concept=f"Cortes ({n_cuts}/{cuts_base_max} = {cuts_effective:.1f}%)",
        quantity=1, unit="recargo",
        unit_price=cuts_amount, subtotal=cuts_amount,
    ))

    labor_amount = round(material_subtotal * labor_percent / 100, 2)
    lines.append(QuotationLine(
        concept=f"Mano de obra ({labor_percent:.0f}%)",
        quantity=1, unit="recargo",
        unit_price=labor_amount, subtotal=labor_amount,
    ))

    machinery_amount = round(material_subtotal * machinery_percent / 100, 2)
    lines.append(QuotationLine(
        concept=f"Maquinaria ({machinery_percent:.0f}%)",
        quantity=1, unit="recargo",
        unit_price=machinery_amount, subtotal=machinery_amount,
    ))

    waste_amount = round(material_subtotal * waste_percent / 100, 2)
    lines.append(QuotationLine(
        concept=f"Merma ({waste_percent:.0f}%)",
        quantity=1, unit="recargo",
        unit_price=waste_amount, subtotal=waste_amount,
    ))

    subtotal = round(material_subtotal + cuts_amount + labor_amount + machinery_amount + waste_amount, 2)
    profit_amount = round(subtotal * profit_percent / 100, 2)
    total = round(subtotal + profit_amount, 2)

    if payment_days is not None:
        pay_pct, pay_label = payment_surcharge(payment_days)
        if pay_pct < 0:
            return Quotation(notes=pay_label)
        pay_amount = round(total * pay_pct / 100, 2)
        lines.append(QuotationLine(
            concept=f"Recargo financiero ({pay_label} = {pay_pct:.1f}%)",
            quantity=1, unit="recargo",
            unit_price=pay_amount, subtotal=pay_amount,
        ))
        total = round(total + pay_amount, 2)

    if shipping_provider and destination:
        sq = shipping_provider.get_quote(destination)
        if sq:
            lines.append(QuotationLine(
                concept=sq.description,
                quantity=1, unit="flete",
                unit_price=sq.price, subtotal=sq.price,
            ))
            total = round(total + sq.price, 2)

    return Quotation(
        lines=lines,
        subtotal=subtotal,
        margin_percent=profit_percent,
        margin_amount=profit_amount,
        total=total,
        notes="\n".join(notes_parts) if notes_parts else "",
    )


# ---------------------------------------------------------------------------
# Back-compat helpers (callers may still import these names)
# ---------------------------------------------------------------------------

def find_board(catalog: ProductCatalog, material: str, thickness_mm: float, color: str) -> PlacaMatch | None:
    return catalog.find_placa(material, thickness_mm, color)


def find_edge_banding(catalog: ProductCatalog, name: str) -> Producto | None:
    return catalog.find_canto(name)
