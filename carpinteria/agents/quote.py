from __future__ import annotations

from agents import Agent, function_tool

from carpinteria.calculator import calculate_quotation
from carpinteria.catalog import ProductCatalog
from carpinteria.exchange_rate import fetch_bcu_usd
from carpinteria.schemas import CutPiece, Quotation
from carpinteria.settings import AGENT_MODEL, AGENT_MODEL_SETTINGS
from carpinteria.vision import analyze_cutting_plan


def _tc() -> float:
    try:
        return fetch_bcu_usd()[0]
    except Exception:
        return 40.0


@function_tool
def analyze_image(image_path: str) -> str:
    results = analyze_cutting_plan(image_path)
    if not results:
        return "No se pudo extraer información de la imagen."

    output_parts = []
    for i, plan in enumerate(results):
        lines = [
            f"## Plan {i + 1}",
            f"Material: {plan.board_material}",
            f"Espesor: {plan.board_thickness_mm}mm",
            f"Color: {plan.board_color}",
            f"Placas necesarias: {plan.boards_needed}",
            f"Desperdicio: {plan.waste_description}",
            "",
            "Piezas:",
        ]
        for p in plan.pieces:
            sides = ", ".join(p.edge_sides) if p.edge_sides else "sin cantos"
            lines.append(f"  - {p.width_mm}x{p.height_mm}mm x{p.quantity} ({sides})")
        output_parts.append("\n".join(lines))

    return "\n\n".join(output_parts)


@function_tool
def read_prices() -> str:
    catalog = ProductCatalog.from_activa()
    placas = catalog.filter(tipo_producto="PLACA")
    cantos = catalog.filter(tipo_producto="CANTO")
    lines = ["## Placas"]
    for p in placas:
        lines.append(
            f"  - {p.material or p.familia} {(p.espesor_mm or 0):.0f}mm {p.nombre} "
            f"({p.ancho_mm or 0:.0f}x{p.largo_mm or 0:.0f}mm): USD {p.precio_usd_simp}"
        )
    lines.append("\n## Cantos")
    for c in cantos:
        lines.append(f"  - {c.familia} {c.nombre}: USD {c.precio_usd_simp}/m")
    return "\n".join(lines)


@function_tool
def calculate_quote(
    pieces_json: str,
    material: str,
    thickness_mm: float,
    color: str,
    boards_needed: int = 0,
    edge_banding_name: str = "",
    payment_days: int = 0,
    destination: str = "",
) -> str:
    import json
    from carpinteria.shipping import FixedShippingProvider
    pieces_data = json.loads(pieces_json)
    pieces = [CutPiece(**p) for p in pieces_data]
    catalog = ProductCatalog.from_activa()
    shipping = FixedShippingProvider({"Rivera": 15000}) if destination else None
    quotation = calculate_quotation(
        pieces=pieces,
        catalog=catalog,
        tc=_tc(),
        material=material,
        thickness_mm=thickness_mm,
        color=color,
        boards_needed=boards_needed if boards_needed > 0 else None,
        edge_banding_name=edge_banding_name or None,
        payment_days=payment_days if payment_days > 0 else None,
        shipping_provider=shipping,
        destination=destination,
    )
    return _format_quotation(quotation)


def _format_quotation(q: Quotation) -> str:
    if q.notes and not q.lines:
        return f"Error: {q.notes}"

    lines = ["# Cotización", ""]
    lines.append(f"{'Concepto':<55} {'Cant':>6} {'Unidad':<8} {'P.Unit':>10} {'Subtotal':>10}")
    lines.append("-" * 95)
    for line in q.lines:
        lines.append(
            f"{line.concept:<55} {line.quantity:>6.1f} {line.unit:<8} {line.unit_price:>10.2f} {line.subtotal:>10.2f}"
        )
    lines.append("-" * 95)
    lines.append(f"{'Subtotal':>85} {q.subtotal:>10.2f}")
    lines.append(f"{'Margen ' + str(q.margin_percent) + '%':>85} {q.margin_amount:>10.2f}")
    lines.append(f"{'TOTAL':>85} {q.total:>10.2f}")
    if q.notes:
        lines.append("")
        lines.append(f"Nota: {q.notes}")
    return "\n".join(lines)


QUOTE_INSTRUCTIONS = """\
Sos un cotizador de carpintería. Tu trabajo es generar cotizaciones para proyectos de muebles.

Flujo:
1. Si el usuario te da una imagen de un plano de corte, usá `analyze_image` para extraer las piezas.
2. Usá `read_prices` para ver los precios disponibles.
3. Usá `calculate_quote` para generar la cotización.
   - pieces_json: JSON array de piezas [{width_mm, height_mm, quantity, label, edge_sides}]
   - material, thickness_mm, color: datos del plano o los que el usuario indique
   - boards_needed: si lo sabés del plano, pasalo; si no, se estima automáticamente

El precio final se calcula automáticamente: costo USD x TC x multiplicador mano de obra (x2) + ganancia (60%).

Si faltan datos (ej: qué lados llevan canto), preguntale al usuario.
Si no se encuentra la placa en el listado de precios, mostrá las opciones disponibles.

Respondé siempre en español.
"""


def create_quote_agent() -> Agent:
    return Agent(
        name="Cotizador",
        instructions=QUOTE_INSTRUCTIONS,
        model=AGENT_MODEL,
        model_settings=AGENT_MODEL_SETTINGS,
        tools=[analyze_image, read_prices, calculate_quote],
    )
