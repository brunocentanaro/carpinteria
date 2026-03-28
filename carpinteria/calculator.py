from __future__ import annotations

import math

from carpinteria.schemas import (
    Board,
    CutPiece,
    EdgeBanding,
    PriceList,
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
    PROFIT_PERCENT,
    WASTE_PERCENT,
)


def _board_score(board_color_lower: str, color_words: list[str]) -> int:
    score = sum(1 for w in color_words if w in board_color_lower)
    if "1/cara" in board_color_lower:
        score -= 10
    if "laca" in board_color_lower:
        score -= 1
    return score


class BoardMatch:
    def __init__(self, board: Board, requested_thickness: float):
        self.board = board
        self.requested_thickness = requested_thickness
        self.is_approx = board.thickness_mm != requested_thickness

    @property
    def thickness_note(self) -> str:
        if not self.is_approx:
            return ""
        return f"(no hay {self.requested_thickness:.0f}mm, se usó {self.board.thickness_mm:.0f}mm más cercano)"


def _find_in_candidates(candidates: list[Board], material_l: str, color_l: str, color_words: list[str]) -> Board | None:
    for board in candidates:
        if board.material.lower() == material_l and board.color.lower() == color_l:
            return board

    substring_matches = []
    for board in candidates:
        if board.material.lower() == material_l:
            bl = board.color.lower()
            if color_l in bl or bl in color_l:
                substring_matches.append((_board_score(bl, color_words), board))
    if substring_matches:
        substring_matches.sort(key=lambda x: x[0], reverse=True)
        return substring_matches[0][1]

    scored = []
    for board in candidates:
        if board.material.lower() == material_l:
            s = _board_score(board.color.lower(), color_words)
            if s > 0:
                scored.append((s, board))
    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    scored = []
    for board in candidates:
        s = _board_score(board.color.lower(), color_words)
        if s > 0:
            scored.append((s, board))
    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    return None


def find_board(price_list: PriceList, material: str, thickness_mm: float, color: str) -> BoardMatch | None:
    material_l = material.lower()
    color_l = color.lower()
    color_words = [w for w in color_l.split() if len(w) > 2]

    exact = [b for b in price_list.boards if b.thickness_mm == thickness_mm]
    result = _find_in_candidates(exact, material_l, color_l, color_words)
    if result:
        return BoardMatch(result, thickness_mm)

    available = sorted(set(b.thickness_mm for b in price_list.boards))
    closest = min(available, key=lambda t: abs(t - thickness_mm)) if available else None
    if closest is not None and closest != thickness_mm:
        approx = [b for b in price_list.boards if b.thickness_mm == closest]
        result = _find_in_candidates(approx, material_l, color_l, color_words)
        if result:
            return BoardMatch(result, thickness_mm)

    return None


def find_edge_banding(price_list: PriceList, name: str) -> EdgeBanding | None:
    name_l = name.lower()
    for eb in price_list.edge_bandings:
        if eb.color.lower() == name_l:
            return eb
    for eb in price_list.edge_bandings:
        if name_l in eb.color.lower() or eb.color.lower() in name_l:
            return eb
    words = [w for w in name_l.split() if len(w) > 2]
    scored = []
    for eb in price_list.edge_bandings:
        eb_l = eb.color.lower()
        s = sum(1 for w in words if w in eb_l)
        if s > 0:
            scored.append((s, eb))
    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    return None


def find_cut_service(price_list: PriceList) -> CutService | None:
    if price_list.cut_services:
        return price_list.cut_services[0]
    return None


def estimate_boards_needed(pieces: list[CutPiece], board: Board) -> int:
    board_area = board.width_mm * board.height_mm
    total_piece_area = sum(p.width_mm * p.height_mm * p.quantity for p in pieces)
    return max(1, math.ceil(total_piece_area / board_area * 1.15))


def board_usage_percent(pieces: list[CutPiece], board: Board, boards_needed: int) -> float:
    board_area = board.width_mm * board.height_mm * boards_needed
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


def calculate_quotation(
    pieces: list[CutPiece],
    price_list: PriceList,
    material: str,
    thickness_mm: float,
    color: str,
    boards_needed: int | None = None,
    edge_banding_name: str | None = None,
    machinery_percent: float = MACHINERY_PERCENT,
    waste_percent: float = WASTE_PERCENT,
    labor_percent: float = LABOR_PERCENT,
    cuts_percent: float = CUTS_PERCENT,
    cuts_base_max: int = CUTS_BASE_MAX,
    profit_percent: float = PROFIT_PERCENT,
) -> Quotation:
    lines: list[QuotationLine] = []
    notes_parts: list[str] = []

    match = find_board(price_list, material, thickness_mm, color)
    if match is None:
        available = [
            f"  - {b.material} {b.thickness_mm}mm: {b.color} (USD {b.price_usd})"
            for b in price_list.boards
            if b.material.lower() == material.lower()
        ]
        avail_str = "\n".join(available[:10]) if available else "  (ninguna)"
        return Quotation(
            notes=f"No se encontró placa: {material} {thickness_mm}mm {color}\n\nPlacas disponibles de {material}:\n{avail_str}"
        )

    board = match.board
    if match.is_approx:
        notes_parts.append(match.thickness_note)

    from_plan = boards_needed is not None
    if boards_needed is None:
        boards_needed = estimate_boards_needed(pieces, board)

    tc = price_list.exchange_rate.buy
    board_cost_uyu = round(board.price_usd * tc, 2)
    approx_suffix = f" {match.thickness_note}" if match.is_approx else ""
    board_label = f"Placa {board.material} {board.thickness_mm}mm {board.color}"

    if from_plan:
        board_total = round(boards_needed * board_cost_uyu, 2)
        lines.append(QuotationLine(
            concept=f"{board_label}{approx_suffix}",
            quantity=boards_needed,
            unit="placa",
            unit_price=board_cost_uyu,
            subtotal=board_total,
        ))
    else:
        board_area = board.width_mm * board.height_mm
        piece_area = sum(p.width_mm * p.height_mm * p.quantity for p in pieces)

        full_boards = max(0, int(piece_area // board_area))
        leftover_area = piece_area - full_boards * board_area
        leftover_pct = round(leftover_area / board_area * 100, 1) if board_area > 0 else 0.0

        board_total = 0.0

        if full_boards > 0:
            full_total = round(full_boards * board_cost_uyu, 2)
            board_total += full_total
            lines.append(QuotationLine(
                concept=f"{board_label}{approx_suffix}",
                quantity=full_boards,
                unit="placa",
                unit_price=board_cost_uyu,
                subtotal=full_total,
            ))

        if leftover_area > 0:
            surcharge_pct, surcharge_label = partial_board_surcharge(leftover_pct)
            if leftover_pct >= PARTIAL_BOARD_FULL_THRESHOLD:
                partial_price = board_cost_uyu
            else:
                proportional = round(board_cost_uyu * leftover_pct / 100, 2)
                partial_price = round(proportional * (1 + surcharge_pct / 100), 2)
            board_total += partial_price
            lines.append(QuotationLine(
                concept=f"{board_label} parcial ({surcharge_label}){approx_suffix}",
                quantity=1,
                unit="placa",
                unit_price=partial_price,
                subtotal=partial_price,
            ))

        board_total = round(board_total, 2)

    has_edge_sides = any(p.edge_sides for p in pieces)
    eb_total = 0.0
    if has_edge_sides:
        eb = find_edge_banding(price_list, edge_banding_name or color)
        if eb:
            meters = total_edge_banding_meters(pieces)
            if meters > 0:
                eb_cost_uyu = round(eb.price_usd_per_meter * tc, 2)
                eb_total = round(meters * eb_cost_uyu, 2)
                lines.append(QuotationLine(
                    concept=f"Canto {eb.color}",
                    quantity=round(meters, 2),
                    unit="metro",
                    unit_price=eb_cost_uyu,
                    subtotal=eb_total,
                ))
        else:
            meters = total_edge_banding_meters(pieces)
            lines.append(QuotationLine(
                concept="Canto (sin precio - especificar tipo)",
                quantity=round(meters, 2),
                unit="metro",
                unit_price=0.0,
                subtotal=0.0,
            ))

    material_subtotal = round(board_total + eb_total, 2)

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

    labor_amount = round(material_subtotal * labor_percent / 100, 2)
    lines.append(QuotationLine(
        concept=f"Mano de obra ({labor_percent:.0f}%)",
        quantity=1, unit="recargo",
        unit_price=labor_amount, subtotal=labor_amount,
    ))

    n_cuts = total_cuts(pieces)
    cuts_factor = n_cuts / cuts_base_max
    cuts_effective = round(cuts_percent * cuts_factor, 1)
    cuts_amount = round(material_subtotal * cuts_effective / 100, 2)
    lines.append(QuotationLine(
        concept=f"Cortes ({n_cuts}/{cuts_base_max} = {cuts_effective:.1f}%)",
        quantity=1, unit="recargo",
        unit_price=cuts_amount, subtotal=cuts_amount,
    ))

    subtotal = round(material_subtotal + machinery_amount + waste_amount + labor_amount + cuts_amount, 2)
    profit_amount = round(subtotal * profit_percent / 100, 2)
    total = round(subtotal + profit_amount, 2)

    return Quotation(
        lines=lines,
        subtotal=subtotal,
        margin_percent=profit_percent,
        margin_amount=profit_amount,
        total=total,
        notes="\n".join(notes_parts) if notes_parts else "",
    )
