"""Chat agent for the cotizador.

Agent SDK tools mutate a `QuotationSession` (Mongo doc) by id. The
`session_id` is injected through `RunContextWrapper.context` so the
model never has to pass it.

History is owned by OpenAI's Responses API: we just remember the
`last_response_id` per session and pass it on the next turn.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from agents import Agent, RunContextWrapper, Runner, function_tool

from carpinteria.calculator import calculate_quotation
from carpinteria.catalog import ProductCatalog
from carpinteria.exchange_rate import fetch_bcu_usd
from carpinteria.hardware_catalog import CURATED_HARDWARE, DEFAULT_HARDWARE_PRICES_UYU, get_by_code
from carpinteria.hardware_prices_sheet import read_all as read_hw_prices, upsert_price as upsert_hw_price
from carpinteria import memory as agent_memory
from carpinteria.molduras_prices import quote_price
from carpinteria.openai_errors import friendly_openai_error
from carpinteria.pliego import analyze_pliego, decompose_furniture
from carpinteria.quote_router import classify_quote_type, validate_quote_lines
from carpinteria.settings import AGENT_MODEL, DEFAULT_BID_DESTINATION, DEFAULT_BID_PAYMENT_DAYS
from carpinteria.shipping import default_shipping_provider
from carpinteria.wood_calculator import quote_solid_wood_table
from carpinteria.quotation_session import (
    CutPiece,
    HardwareUsage,
    MolduraQuoteItem,
    QuotationItem,
    QuotationSession,
    append_message,
    find_item,
    get_session,
    save_session,
)
from carpinteria.schemas import QuotationLine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tc() -> float:
    """Current USD/UYU rate from BCU. Let exceptions propagate — sin TC no
    podemos cotizar, mejor explotar fuerte que producir cifras inventadas."""
    return fetch_bcu_usd()[0]


def _hw_prices_map() -> dict[str, float]:
    rows = read_hw_prices()
    prices = dict(DEFAULT_HARDWARE_PRICES_UYU)
    for code, d in rows.items():
        price = float(d.get("precio_uyu") or 0)
        if price > 0:
            prices[code] = price
    return prices


def _payment_days_from_text(text: str) -> int | None:
    matches = [int(m.group(1)) for m in re.finditer(r"(\d{1,3})\s*d[ií]as?", text.lower())]
    return max(matches) if matches else None


def _effective_payment_days(session: QuotationSession) -> int:
    return (
        session.payment_days
        or _payment_days_from_text(session.general_specs.payment_terms)
        or DEFAULT_BID_PAYMENT_DAYS
    )


def _effective_destination(session: QuotationSession) -> str:
    return session.destination or session.general_specs.delivery_location or DEFAULT_BID_DESTINATION


def _recalculate_item(
    item: QuotationItem,
    session: QuotationSession,
    catalog: ProductCatalog | None = None,
    tc: float | None = None,
    hw_prices: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Run the calculator on the current item state and cache the result.

    Optional `catalog`/`tc`/`hw_prices` are reused across items by callers that
    recalculate many items in one go (otherwise we'd hit the sheet/BCU per item).
    """
    if (item.last_quote or {}).get("metadata", {}).get("quote_type") == "madera_maciza":
        q = quote_solid_wood_table(
            description=item.description,
            name=item.name,
            quantity=item.quantity,
            width_mm=item.dimensions.get("width_mm"),
            height_mm=item.dimensions.get("height_mm"),
            depth_mm=item.dimensions.get("depth_mm"),
            material=item.material,
            thickness_mm=item.thickness_mm,
        )
        base = q.model_dump()
        base["hardware_lines"] = []
        base["pending_hardware_codes"] = []
        base["total_with_hardware"] = round(base.get("total", 0), 2)
        item.last_quote = base
        return base

    if not item.pieces:
        item.last_quote = None
        return {"error": "El item no tiene piezas todavía"}
    try:
        if catalog is None:
            catalog = ProductCatalog.from_activa()
        if tc is None:
            tc = _tc()
    except Exception as exc:
        msg = (
            "No pude acceder al listado de precios Activa. "
            f"Detalle: {exc}"
        )
        item.last_quote = {
            "error": msg,
            "notes": msg,
            "lines": [],
            "total": 0,
            "total_with_hardware": 0,
            "pending_hardware_codes": [],
        }
        return item.last_quote

    def is_drawer_base(label: str) -> bool:
        norm = _norm_text(label)
        return "caj" in norm and ("base" in norm or "parte de abajo" in norm)

    item.pieces = [p for p in item.pieces if not is_drawer_base(p.label)]
    pieces = [
        type("P", (), {  # CutPiece-shaped duck for calculator (avoid pydantic re-validation)
            "width_mm": p.width_mm,
            "height_mm": p.height_mm,
            "quantity": p.quantity,
            "label": p.label,
            "edge_sides": list(p.edge_sides or []),
        })()
        for p in item.pieces
    ]

    color = item.color or session.color_default or "blanco"
    material = item.material or "melamínico"
    eb_name = item.edge_banding or color

    if hw_prices is None:
        hw_prices = _hw_prices_map()
    hw_lines = []
    pending = []
    quote_hw_lines: list[QuotationLine] = []
    for hu in item.hardware:
        spec = get_by_code(hu.code)
        if spec is None:
            continue
        unit_price = float(hw_prices.get(hu.code, 0.0))
        subtotal = round(hu.quantity * unit_price, 2)
        line = {
            "code": hu.code,
            "concept": f"Herraje: {spec.name}",
            "category": spec.category,
            "quantity": hu.quantity,
            "unit": hu.unit or spec.unit,
            "unit_price": round(unit_price, 2),
            "subtotal": subtotal,
        }
        hw_lines.append(line)
        quote_hw_lines.append(QuotationLine(
            concept=line["concept"],
            quantity=hu.quantity,
            unit=hu.unit or spec.unit,
            unit_price=round(unit_price, 2),
            subtotal=subtotal,
        ))
        if unit_price <= 0:
            pending.append(hu.code)

    payment_days = _effective_payment_days(session)
    destination = _effective_destination(session)

    q = calculate_quotation(
        pieces=pieces,
        catalog=catalog,
        tc=tc,
        material=material,
        thickness_mm=float(item.thickness_mm or 18),
        color=color,
        edge_banding_name=eb_name,
        payment_days=payment_days,
        shipping_provider=default_shipping_provider() if destination else None,
        destination=destination,
        placa_sku=item.placa_sku,
        shipping_units=item.quantity,
        extra_input_lines=quote_hw_lines,
    )
    base = q.model_dump()
    route = classify_quote_type(item.description, material=item.material)
    ok, forbidden = validate_quote_lines(route, [line.get("concept", "") for line in base.get("lines", [])])
    if not ok:
        msg = (
            f"Cotizacion rechazada: el pedido fue clasificado como {route.quote_type}, "
            f"pero aparecieron conceptos prohibidos: {', '.join(forbidden)}"
        )
        item.last_quote = {
            "error": msg,
            "notes": msg,
            "lines": [],
            "total": 0,
            "total_with_hardware": 0,
            "pending_hardware_codes": [],
            "metadata": {"quote_type": route.quote_type, "validation_error": forbidden},
        }
        return item.last_quote

    base["hardware_lines"] = hw_lines
    base["pending_hardware_codes"] = pending
    base["total_with_hardware"] = round(base.get("total", 0), 2)
    base["tc"] = tc
    item.last_quote = base
    return base


def _format_item_summary(item: QuotationItem) -> str:
    q = item.last_quote or {}
    parts = [
        f"### {item.code} — {item.name} (x{item.quantity})",
        f"- Material: {item.material or '?'} {item.thickness_mm:.0f}mm "
        f"color={item.color or 'sin definir'}",
        f"- Piezas: {len(item.pieces)} ({sum(p.quantity for p in item.pieces)} totales)",
        f"- Herrajes: " + (
            ", ".join(f"{h.code}×{h.quantity}" for h in item.hardware) if item.hardware else "—"
        ),
    ]
    if q:
        parts.append(
            f"- Total c/herrajes: UYU {q.get('total_with_hardware', 0):,.2f}  "
            f"(unit UYU {q.get('total_with_hardware', 0):,.2f}, x{item.quantity}: "
            f"UYU {q.get('total_with_hardware', 0)*item.quantity:,.2f})"
        )
        if q.get("pending_hardware_codes"):
            parts.append(
                f"- ⚠️ Faltan precios de herrajes: {', '.join(q['pending_hardware_codes'])}"
            )
    return "\n".join(parts)


def _norm_text(text: object) -> str:
    raw = str(text or "").strip().lower()
    raw = unicodedata.normalize("NFKD", raw)
    return "".join(ch for ch in raw if not unicodedata.combining(ch))


def _format_uyu(value: float) -> str:
    text = f"{float(value):,.2f}"
    return "UYU " + text.replace(",", "_").replace(".", ",").replace("_", ".")


def _parse_quantity(text: str) -> float:
    normalized = _norm_text(text)
    words = {
        "un": 1,
        "una": 1,
        "uno": 1,
        "dos": 2,
        "tres": 3,
        "cuatro": 4,
        "cinco": 5,
        "seis": 6,
        "siete": 7,
        "ocho": 8,
        "nueve": 9,
        "diez": 10,
        "once": 11,
        "doce": 12,
        "trece": 13,
        "catorce": 14,
        "quince": 15,
        "veinte": 20,
    }
    qty_match = re.search(
        r"\b(\d+(?:[.,]\d+)?)\s*(?:varillas?|listones?|barrotes?|zocalos?|molduras?|metros?|mts?|m)\b",
        normalized,
    )
    if qty_match:
        return float(qty_match.group(1).replace(",", "."))
    for word, qty in words.items():
        if re.search(
            rf"\b{word}\s+(?:varillas?|listones?|barrotes?|zocalos?|molduras?|metros?|mts?|m)\b",
            normalized,
        ):
            return float(qty)
    return 1.0


def _parse_moldura_query(message: str) -> dict[str, Any] | None:
    normalized = _norm_text(message)
    if not any(token in normalized for token in (
        "varilla", "liston", "barrote", "zocalo", "moldura", "contravidrio", "media cana", "montante", "picado",
    )):
        return None
    dim_match = re.search(
        r"\b(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\b",
        normalized,
    )
    diameter_match = re.search(
        r"(?:ø|diametro|diam|redondo\s+de)\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\b",
        normalized,
    ) or re.search(
        r"\b(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*(?:de\s+)?(?:diametro|diam|redondo)\b",
        normalized,
    )
    if dim_match:
        width = float(dim_match.group(1).replace(",", "."))
        height = float(dim_match.group(2).replace(",", "."))
    elif diameter_match:
        width = height = float(diameter_match.group(1).replace(",", "."))
    else:
        return None
    material = None
    if any(token in normalized for token in ("pino", "nac", "nacional", " pn")):
        material = "pino"
    elif any(token in normalized for token in ("euca", "eucalipto", "eucaliptus", "imp", "importado")):
        material = "euca"
    family = None
    for candidate in ("liston", "barrote", "zocalo", "contravidrio", "media cana", "cuadro", "montante", "moldura"):
        if candidate in normalized:
            family = candidate
            break
    if family is None and "picado" in normalized:
        family = "montante"
    if family == "contravidrio":
        model_match = re.search(r"\b(?:n|no|num|numero|nro|nro\.)\s*[°º.]?\s*(\d{1,3})\b", normalized)
        if model_match:
            family = f"contravidrio {model_match.group(1)}"
    if family == "media cana":
        model_match = re.search(r"\b(?:n|no|num|numero|nro|nro\.)\s*[°º.]?\s*([a-z0-9-]+)\b", normalized)
        if model_match:
            family = f"media cana {model_match.group(1)}"
    if family == "cuadro":
        model_match = re.search(r"\b(?:n|no|num|numero|nro|nro\.)\s*[°º.]?\s*([a-z0-9-]+)\b", normalized)
        if model_match:
            family = f"cuadro {model_match.group(1)}"
    text_for_unit = normalized.replace(",", ".")
    length_match = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(?:mts?|metros?)\s*(?:de\s+)?(?:largo|longitud)?\b", normalized)
    length_m = float(length_match.group(1).replace(",", ".")) if length_match else None
    product_quantity = re.search(r"\b\d+(?:[.,]\d+)?\s*(?:varillas?|listones?|barrotes?|zocalos?|molduras?)\b", normalized)
    if product_quantity or length_m:
        unit = "varilla"
    else:
        unit = "metro" if re.search(r"\b(?:metros?|mts?|m)\b", normalized) and "3.3" not in text_for_unit else "varilla"
    return {
        "width_mm": width,
        "height_mm": height,
        "material": material,
        "family": family,
        "quantity": _parse_quantity(message),
        "unit": unit,
        "length_m": length_m,
    }


def _pliego_moldura_request(raw: dict[str, Any]) -> dict[str, Any] | None:
    text = _norm_text(" ".join(str(raw.get(k) or "") for k in ("code", "name", "description", "material")))
    if not any(token in text for token in ("barrote", "barrotes", "moldura", "molduras", "liston", "listones", "zocalo", "montante", "contravidrio", "media cana")):
        return None
    if any(token in text for token in ("melamin", "mdf", "puerta", "cajon", "armario", "mueble", "placa")) and "barrote" not in text:
        return None

    material = "euca" if any(token in text for token in ("euca", "eucaliptus", "eucalipto", "clear", "imp")) else "pino"
    family = None
    for candidate in ("barrote", "liston", "zocalo", "contravidrio", "media cana", "montante", "moldura"):
        if candidate in text:
            family = candidate
            break

    dims = []
    raw_dims = raw.get("dimensions") or {}
    raw_cross = []
    for key in ("width_mm", "height_mm"):
        value = raw_dims.get(key)
        if value is not None:
            try:
                raw_cross.append(float(value))
            except Exception:
                pass
    explicit_pair = re.search(
        r"\b(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\b",
        text,
    )
    if len(raw_cross) >= 2:
        width, height = raw_cross[0], raw_cross[1]
    elif explicit_pair:
        width = float(explicit_pair.group(1).replace(",", "."))
        height = float(explicit_pair.group(2).replace(",", "."))
    else:
        width = height = 0.0

    for value in raw_dims.values():
        if value is not None:
            try:
                dims.append(float(value))
            except Exception:
                pass
    if not width or not height:
        for match in re.finditer(r"\b(\d+(?:[.,]\d+)?)\s*(?:mm|milimetros?)?\b", text):
            value = float(match.group(1).replace(",", "."))
            if value >= 6:
                dims.append(value)
    dims = sorted(set(round(v, 2) for v in dims))
    cross = [v for v in dims if 5 <= v <= 300]
    long_values = [v for v in dims if v > 1000]
    length_match = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(?:mts?|metros?)\b", text)
    length_m = None
    if length_match:
        length_m = float(length_match.group(1).replace(",", "."))
    elif long_values:
        length_m = max(long_values) / 1000

    if width and height:
        pass
    elif len(cross) >= 2:
        width, height = cross[0], cross[1]
    elif len(cross) == 1:
        width = height = cross[0]
    else:
        return None

    quantity = float(raw.get("quantity") or 1)
    return {
        "width_mm": width,
        "height_mm": height,
        "material": material,
        "family": family,
        "quantity": quantity,
        "unit": "varilla",
        "length_m": length_m,
        "include_iva": True,
    }


def _format_moldura_quote_reply(q: Any) -> str:
    item = q.item
    iva_label = "IVA inc." if q.iva_included else "sin IVA"
    qty = int(q.quantity) if float(q.quantity).is_integer() else q.quantity
    unit_name = "varilla 3,3 m" if q.unit == "varilla" else "metro"
    lines = [
        f"{qty} x {item.family} {item.description} {item.width_mm:g}x{item.height_mm:g}mm ({item.code})",
        f"Unitario {unit_name}: {_format_uyu(q.unit_price)} {iva_label}",
        f"Total: {_format_uyu(q.total)} {iva_label}",
    ]
    if getattr(q, "estimated", False):
        lines.insert(0, "No disponemos de esa moldura en stock/listado; este es el precio estimativo.")
        if getattr(q, "source", "") == "conversor":
            bd = getattr(q, "breakdown", None) or {}
            lines.append(
                "Calculo: conversor MANU "
                f"(MP {_format_uyu(float(bd.get('materia_prima_varilla', 0) or 0))}, "
                f"MO {bd.get('mo_minutos', 0)} min, seteo {_format_uyu(float(bd.get('seteo_varilla', 0) or 0))}, "
                f"ganancia {float(bd.get('ganancia_pct', 0) or 0):.0%})."
            )
        else:
            lines.append("Para producirla a medida, tomé una referencia competitiva del listado y le sumé recargo por modelo no listado.")
    if q.scale_hint:
        lines.append("Como son mas de 20 varillas, te conviene revisar opcion de cotizar a escala.")
    return "\n".join(lines)


def _moldura_session_quote(q: Any, parsed: dict[str, Any]) -> MolduraQuoteItem:
    item = q.item
    requested_family = str(parsed.get("family") or "").strip()
    family = item.family
    if requested_family and getattr(q, "estimated", False):
        family = f"{requested_family} estimativo"
    length_m = parsed.get("length_m")
    length_factor = float(length_m or 3.3) / 3.3
    unit_price = float(q.unit_price) * length_factor
    total = unit_price * float(q.quantity)
    breakdown = dict(getattr(q, "breakdown", None) or {})
    if length_m:
        breakdown["largo_solicitado_m"] = float(length_m)
        breakdown["ajuste_largo_sobre_3_3"] = length_factor
    return MolduraQuoteItem(
        code=item.code,
        family=family,
        description=item.description,
        width_mm=float(item.width_mm),
        height_mm=float(item.height_mm),
        material=str(parsed.get("material") or ""),
        quantity=float(q.quantity),
        unit=str(q.unit),
        unit_price=unit_price,
        total=total,
        iva_included=bool(q.iva_included),
        estimated=bool(getattr(q, "estimated", False)),
        source=str(getattr(q, "source", "")),
        note=str(getattr(q, "note", "")),
        breakdown=breakdown,
    )


def _try_direct_moldura_quote(message: str) -> tuple[str, MolduraQuoteItem] | None:
    parsed = _parse_moldura_query(message)
    if parsed is None:
        return None
    q = quote_price(**{k: v for k, v in parsed.items() if k != "length_m"}, include_iva=True)
    if q is None:
        reply = (
            "No encontre una referencia suficiente para estimar esa moldura. Pasame material, medida en mm "
            "y si es liston/barrote/zocalo/moldura para ubicarla mejor."
        )
        return reply, MolduraQuoteItem(
            code="SIN-REFERENCIA",
            family=str(parsed.get("family") or ""),
            description=reply,
            width_mm=float(parsed.get("width_mm") or 0),
            height_mm=float(parsed.get("height_mm") or 0),
            material=str(parsed.get("material") or ""),
            quantity=float(parsed.get("quantity") or 1),
            unit=str(parsed.get("unit") or "varilla"),
            note=reply,
        )
    moldura_quote = _moldura_session_quote(q, parsed)
    length_m = parsed.get("length_m")
    if length_m and abs(float(length_m) - 3.3) > 0.001:
        item = q.item
        iva_label = "IVA inc." if q.iva_included else "sin IVA"
        qty = int(q.quantity) if float(q.quantity).is_integer() else q.quantity
        reply = "\n".join([
            f"{qty} x {item.family} {item.description} {item.width_mm:g}x{item.height_mm:g}mm ({item.code})",
            f"Largo solicitado: {float(length_m):g} m. Base listado: 3,3 m.",
            f"Unitario proporcional sin recargo 20%: {_format_uyu(moldura_quote.unit_price)} {iva_label}",
            f"Total: {_format_uyu(moldura_quote.total)} {iva_label}",
            "No asumo recargo 20% por cambio de largo/corte; confirmame si queres aplicarlo.",
        ])
        if q.scale_hint:
            reply += "\nComo son mas de 20 varillas, te conviene revisar opcion de cotizar a escala."
        return reply, moldura_quote
    return _format_moldura_quote_reply(q), moldura_quote


def _try_direct_moldura_reply(message: str) -> str | None:
    result = _try_direct_moldura_quote(message)
    return result[0] if result else None


def _format_state(session: QuotationSession) -> str:
    if not session.items and not session.moldura_quotes:
        return "Sesión vacía. Subí un pliego o agregá items para empezar."
    services = []
    if session.additional_services.rectification:
        services.append("rectificacion de medidas")
    if session.additional_services.installation:
        services.append("colocacion")
    if session.additional_services.painting:
        services.append("pintura")
    if session.additional_services.varnishing:
        services.append("barniz")
    if session.additional_services.polishing:
        services.append("lustre")
    body = [
        f"**Sesión** id `{session.id}`",
        f"Color por defecto: `{session.color_default or '—'}` | "
        f"Pago: {session.payment_days or '—'}d | "
        f"Destino: `{session.destination or '—'}`",
        f"Servicios adicionales: {', '.join(services) if services else 'sin adicionales'}",
        "",
    ]
    grand = 0.0
    for item in session.items:
        body.append(_format_item_summary(item))
        body.append("")
        if item.last_quote:
            grand += float(item.last_quote.get("total_with_hardware", 0)) * item.quantity
    if session.moldura_quotes:
        body.append(f"Molduras/barrotes: {len(session.moldura_quotes)}")
        grand += sum(float(q.total or 0) for q in session.moldura_quotes)
    body.append(f"**Total estimado: UYU {grand:,.2f}**")
    return "\n".join(body)


def _ensure_session(ctx: RunContextWrapper) -> QuotationSession:
    sid = str(ctx.context)
    s = get_session(sid)
    if s is None:
        raise RuntimeError(f"Sesión no encontrada: {sid}")
    return s


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@function_tool
def get_state(ctx: RunContextWrapper[str]) -> str:
    """Devuelve el estado completo de la cotización en markdown: items, herrajes, totales."""
    return _format_state(_ensure_session(ctx))


def _ingest_pliego_into_session(session_id: str, file_paths: list[str]) -> str:
    s = get_session(session_id)
    if s is None:
        return f"Sesión no encontrada: {session_id}"
    pliego = analyze_pliego(file_paths)
    items_payload = pliego.get("items") or []
    s.items = []
    s.moldura_quotes = []
    for raw in items_payload:
        if not raw.get("wood_only", True):
            # Skip non-carpentry items per the prompt's classification
            continue
        moldura_request = _pliego_moldura_request(raw)
        if moldura_request is not None:
            q = quote_price(**{k: v for k, v in moldura_request.items() if k != "length_m"})
            if q is not None:
                mq = _moldura_session_quote(q, moldura_request)
                mq.note = "Pliego estatal: cotizar con conversor/listado de molduras, no como mueble de placa."
                s.moldura_quotes.append(mq)
            continue
        try:
            decomp = decompose_furniture(raw)
        except Exception as e:
            decomp = {"pieces": [], "hardware": [], "_error": str(e)}
        pieces = [
            CutPiece(
                width_mm=p.get("width_mm", 0),
                height_mm=p.get("height_mm", 0),
                quantity=p.get("quantity", 1),
                label=p.get("label", ""),
                edge_sides=list(p.get("edge_sides") or []),
            )
            for p in decomp.get("pieces", [])
        ]
        hardware = [
            HardwareUsage(
                code=h.get("code", ""),
                name=h.get("name", ""),
                category=h.get("category", ""),
                unit=h.get("unit", "unidad"),
                quantity=int(h.get("quantity", 0) or 0),
            )
            for h in decomp.get("hardware", []) if h.get("code")
        ]
        # The pliego analyzer can leave dimension keys unset (None) when it
        # can't extract a measurement; pydantic's `dict[str, float]` rejects
        # those. Drop them rather than coercing to 0 — 0 would silently lie.
        raw_dims = raw.get("dimensions") or {}
        dims = {k: float(v) for k, v in raw_dims.items() if v is not None}
        item = QuotationItem(
            code=raw.get("code", "?"),
            name=raw.get("name", ""),
            quantity=int(raw.get("quantity", 1) or 1),
            description=raw.get("description", ""),
            dimensions=dims,
            material=raw.get("material", "melamínico"),
            thickness_mm=float(raw.get("thickness_mm", 18) or 18),
            edge_banding=raw.get("edge_banding") or "",
            pieces=pieces,
            hardware=hardware,
        )
        s.items.append(item)

    gs = pliego.get("general_specs") or {}
    s.general_specs = type(s.general_specs)(
        delivery_location=gs.get("delivery_location", ""),
        delivery_days=gs.get("delivery_days"),
        payment_terms=gs.get("payment_terms", ""),
        materials=gs.get("materials", ""),
        colors=list(gs.get("colors") or []),
        edge_banding=gs.get("edge_banding") or "",
        offer_maintenance_days=gs.get("offer_maintenance_days"),
        samples_required=gs.get("samples_required", ""),
        bid_guarantee=gs.get("bid_guarantee", ""),
        performance_guarantee=gs.get("performance_guarantee", ""),
        product_warranty=gs.get("product_warranty", ""),
        other_conditions=gs.get("other_conditions", ""),
    )
    if gs.get("delivery_location") and not s.destination:
        s.destination = gs["delivery_location"]
    if not s.payment_days:
        pay_days = _payment_days_from_text(str(gs.get("payment_terms", "")))
        s.payment_days = pay_days or DEFAULT_BID_PAYMENT_DAYS
    if not s.destination:
        s.destination = DEFAULT_BID_DESTINATION
    s.pliego_filenames = list({*s.pliego_filenames, *file_paths})

    # Auto-title from the first pliego filename when the session has no
    # title yet. Strip the path and the trailing rand suffix added by the
    # upload route, leaving a readable stub like "pliego-cocina-pereira".
    if not s.title and file_paths:
        import os.path as _p
        first = _p.basename(file_paths[0])
        stem = first.rsplit(".", 1)[0]
        # Files arrive as e.g. "pliego-1777522799927-1.xlsx" — drop the digits.
        parts = [p for p in stem.split("-") if not p.isdigit()]
        s.title = ("-".join(parts) or stem)[:60]

    # Initial recalculation — reuse catalog/TC/hw_prices across items so we
    # don't hit Sheets + BCU N times for an N-item pliego.
    catalog = ProductCatalog.from_activa()
    tc = _tc()
    hw_prices = _hw_prices_map()
    for item in s.items:
        try:
            _recalculate_item(item, s, catalog=catalog, tc=tc, hw_prices=hw_prices)
        except Exception:
            pass

    save_session(s)
    return f"Ingerido pliego con {len(s.items)} muebles y {len(s.moldura_quotes)} molduras/barrotes. {_format_state(s)}"


def _next_manual_code(session: QuotationSession) -> str:
    existing = {it.code.upper() for it in session.items}
    i = 1
    while f"M{i}" in existing:
        i += 1
    return f"M{i}"


def _item_from_description(
    *,
    session: QuotationSession,
    code: str | None,
    name: str,
    description: str,
    quantity: int,
    width_mm: float | None,
    height_mm: float | None,
    depth_mm: float | None,
    material: str | None,
    thickness_mm: float | None,
    color: str | None,
    edge_banding: str | None,
) -> QuotationItem:
    dims = {}
    if width_mm:
        dims["width_mm"] = float(width_mm)
    if height_mm:
        dims["height_mm"] = float(height_mm)
    if depth_mm:
        dims["depth_mm"] = float(depth_mm)

    item = QuotationItem(
        code=(code or _next_manual_code(session)).strip().upper(),
        name=name.strip() or "mueble a medida",
        quantity=max(1, int(quantity or 1)),
        description=description.strip(),
        dimensions=dims,
        material=(material or "melamínico").strip(),
        thickness_mm=float(thickness_mm or 18),
        color=(color or session.color_default or "").strip(),
        edge_banding=(edge_banding or "").strip(),
    )

    decomp_input = {
        "code": item.code,
        "name": item.name,
        "quantity": item.quantity,
        "description": item.description,
        "dimensions": item.dimensions,
        "material": item.material,
        "thickness_mm": item.thickness_mm,
        "hardware": [],
        "edge_banding": item.edge_banding,
    }
    decomp = decompose_furniture(decomp_input)
    item.pieces = [
        CutPiece(
            width_mm=p.get("width_mm", 0),
            height_mm=p.get("height_mm", 0),
            quantity=p.get("quantity", 1),
            label=p.get("label", ""),
            edge_sides=list(p.get("edge_sides") or []),
        )
        for p in decomp.get("pieces", [])
    ]
    item.hardware = [
        HardwareUsage(
            code=h.get("code", ""),
            name=h.get("name", ""),
            category=h.get("category", ""),
            unit=h.get("unit", "unidad"),
            quantity=int(h.get("quantity", 0) or 0),
        )
        for h in decomp.get("hardware", [])
        if h.get("code")
    ]
    return item


@function_tool
def ingest_pliego(ctx: RunContextWrapper[str], file_paths: list[str]) -> str:
    """Lee uno o más archivos de pliego (PDF / XLSX), extrae los muebles y descompone cada uno.
    Pisa los items existentes en la sesión.
    """
    return _ingest_pliego_into_session(str(ctx.context), file_paths)


@function_tool
def quote_moldura_price(
    ctx: RunContextWrapper[str],
    width_mm: float,
    height_mm: float,
    quantity: float = 1,
    material: str | None = None,
    family: str | None = None,
    unit: str = "varilla",
) -> str:
    """Busca precio de venta directa de molduras/listones/barrotes por medida.

    Usala para consultas simples como "2 varillas de pino 10x10 de 3.3 m".
    Guarda la moldura cotizada en la sesion para poder exportar el Excel del razonamiento.
    """
    session = _ensure_session(ctx)
    q = quote_price(
        width_mm=width_mm,
        height_mm=height_mm,
        quantity=quantity,
        material=material,
        family=family,
        unit=unit,
        include_iva=True,
    )
    if q is None:
        return (
            "No encontre una referencia suficiente para estimar esa moldura. Pasame material, medida en mm "
            "y si es liston/barrote/zocalo/moldura para ubicarla mejor."
        )
    parsed = {
        "material": material or "",
        "family": family or "",
    }
    session.moldura_quotes.append(_moldura_session_quote(q, parsed))
    save_session(session)
    return _format_moldura_quote_reply(q)


@function_tool
def add_custom_item(
    ctx: RunContextWrapper[str],
    description: str,
    name: str = "mueble a medida",
    quantity: int = 1,
    width_mm: float | None = None,
    height_mm: float | None = None,
    depth_mm: float | None = None,
    material: str | None = None,
    thickness_mm: float | None = None,
    color: str | None = None,
    edge_banding: str | None = None,
    code: str | None = None,
) -> str:
    """Agrega a la sesión un mueble descrito por texto libre y lo cotiza.

    Usala cuando el usuario describa un mueble sin subir pliego. Conviene pasar
    medidas en mm si aparecen en el texto; si vienen en metros o cm, convertilas
    a mm antes de llamar la tool.
    """
    s = _ensure_session(ctx)
    if not description.strip():
        return "Necesito una descripción del mueble para poder cotizarlo."

    route = classify_quote_type(description, material=material)
    if route.quote_type == "madera_maciza":
        item = QuotationItem(
            code=(code or _next_manual_code(s)).strip().upper(),
            name=name.strip() or "mueble en madera maciza",
            quantity=max(1, int(quantity or 1)),
            description=description.strip(),
            dimensions={
                **({"width_mm": float(width_mm)} if width_mm else {}),
                **({"height_mm": float(height_mm)} if height_mm else {}),
                **({"depth_mm": float(depth_mm)} if depth_mm else {}),
            },
            material=(material or "pino").strip(),
            thickness_mm=float(thickness_mm or 25.4),
            color=(color or "").strip(),
            edge_banding="",
            last_quote={"metadata": {"quote_type": "madera_maciza", "subtype": "tablas_encoladas"}},
        )
        q = quote_solid_wood_table(
            description=item.description,
            name=item.name,
            quantity=item.quantity,
            width_mm=item.dimensions.get("width_mm"),
            height_mm=item.dimensions.get("height_mm"),
            depth_mm=item.dimensions.get("depth_mm"),
            material=item.material,
            thickness_mm=item.thickness_mm,
        )
        item.last_quote = q.model_dump()
        item.last_quote["hardware_lines"] = []
        item.last_quote["pending_hardware_codes"] = []
        item.last_quote["total_with_hardware"] = round(item.last_quote.get("total", 0), 2)
        ok, forbidden = validate_quote_lines(route, [line.get("concept", "") for line in item.last_quote.get("lines", [])])
        if not ok:
            return f"No puedo guardar esta cotizacion de madera: aparecieron conceptos prohibidos ({', '.join(forbidden)})."
        s.items.append(item)
        save_session(s)
        return "Agregue el mueble en madera maciza a la cotizacion.\n\n" + _format_item_summary(item)

    try:
        item = _item_from_description(
            session=s,
            code=code,
            name=name,
            description=description,
            quantity=quantity,
            width_mm=width_mm,
            height_mm=height_mm,
            depth_mm=depth_mm,
            material=material,
            thickness_mm=thickness_mm,
            color=color,
            edge_banding=edge_banding,
        )
    except Exception as e:
        return f"No pude descomponer ese mueble todavía: {e}. Pasame ancho, alto, profundidad, material, espesor y puertas/cajones."

    if not item.pieces:
        return "No pude extraer piezas de placa. Pasame ancho, alto, profundidad, material, espesor y cómo está compuesto."

    s.items.append(item)
    try:
        _recalculate_item(item, s)
    except Exception as e:
        item.last_quote = {"error": str(e), "notes": str(e), "total_with_hardware": 0}
    save_session(s)
    return "Agregué el mueble a la cotización.\n\n" + _format_item_summary(item)


@function_tool
def set_color(ctx: RunContextWrapper[str], color: str, item_code: str | None = None) -> str:
    """Setea el color de la placa para un item, o el color por defecto de la sesión si no pasás item_code."""
    s = _ensure_session(ctx)
    if item_code:
        it = find_item(s, item_code)
        if it is None:
            return f"No encontré el item `{item_code}`."
        it.color = color
        _recalculate_item(it, s)
        save_session(s)
        return f"Color de {item_code} = {color}. {_format_item_summary(it)}"
    s.color_default = color
    catalog = ProductCatalog.from_activa()
    tc = _tc()
    hw_prices = _hw_prices_map()
    for item in s.items:
        if not item.color:
            _recalculate_item(item, s, catalog=catalog, tc=tc, hw_prices=hw_prices)
    save_session(s)
    return f"Color por defecto = {color}."


@function_tool
def set_payment_days(ctx: RunContextWrapper[str], days: int) -> str:
    """Días de pago de la cotización (afecta el recargo financiero)."""
    s = _ensure_session(ctx)
    s.payment_days = int(days)
    catalog = ProductCatalog.from_activa()
    tc = _tc()
    hw_prices = _hw_prices_map()
    for item in s.items:
        _recalculate_item(item, s, catalog=catalog, tc=tc, hw_prices=hw_prices)
    save_session(s)
    return f"Días de pago = {days}."


@function_tool
def set_destination(ctx: RunContextWrapper[str], destination: str) -> str:
    """Destino de entrega (para flete)."""
    s = _ensure_session(ctx)
    s.destination = destination
    for item in s.items:
        _recalculate_item(item, s)
    save_session(s)
    return f"Destino = {destination}."


@function_tool
def set_additional_services(
    ctx: RunContextWrapper[str],
    rectification: bool = False,
    installation: bool = False,
    painting: bool = False,
    varnishing: bool = False,
    polishing: bool = False,
) -> str:
    """Setea servicios adicionales de la cotizacion: rectificacion de medidas, colocacion, pintura, barniz y lustre."""
    s = _ensure_session(ctx)
    s.additional_services.rectification = bool(rectification)
    s.additional_services.installation = bool(installation)
    s.additional_services.painting = bool(painting)
    s.additional_services.varnishing = bool(varnishing)
    s.additional_services.polishing = bool(polishing)
    save_session(s)
    selected = []
    if s.additional_services.rectification:
        selected.append("rectificacion de medidas")
    if s.additional_services.installation:
        selected.append("colocacion")
    if s.additional_services.painting:
        selected.append("pintura")
    if s.additional_services.varnishing:
        selected.append("barniz")
    if s.additional_services.polishing:
        selected.append("lustre")
    return "Servicios adicionales: " + (", ".join(selected) if selected else "sin adicionales")


@function_tool
def set_hardware_quantity(
    ctx: RunContextWrapper[str],
    item_code: str,
    hardware_code: str,
    quantity: int,
) -> str:
    """Setea la cantidad de un herraje en un item específico (override sobre lo que dijo la IA).
    Si quantity=0, lo saca. Si el código no existe en el item, lo agrega.
    Usá códigos del catálogo curado (BISAGRA_FRENO, GUIA_TELESC_400, etc).
    """
    s = _ensure_session(ctx)
    it = find_item(s, item_code)
    if it is None:
        return f"No encontré el item `{item_code}`."
    spec = get_by_code(hardware_code)
    if spec is None:
        return f"`{hardware_code}` no está en el catálogo de herrajes."
    found = next((h for h in it.hardware if h.code == hardware_code), None)
    if quantity <= 0:
        it.hardware = [h for h in it.hardware if h.code != hardware_code]
        msg = f"Saqué {hardware_code} de {item_code}."
    elif found is None:
        it.hardware.append(HardwareUsage(
            code=spec.code, name=spec.name, category=spec.category,
            unit=spec.unit, quantity=quantity,
        ))
        msg = f"Agregué {quantity} × {hardware_code} a {item_code}."
    else:
        found.quantity = quantity
        msg = f"Setee {hardware_code} = {quantity} en {item_code}."
    _recalculate_item(it, s)
    save_session(s)
    return f"{msg} {_format_item_summary(it)}"


@function_tool
def set_hardware_price(
    ctx: RunContextWrapper[str],
    hardware_code: str,
    price_uyu: float,
) -> str:
    """Setea el precio unitario UYU de un herraje (se guarda en el sheet, vale para todas las sesiones)."""
    s = _ensure_session(ctx)
    spec = get_by_code(hardware_code)
    if spec is None:
        return f"`{hardware_code}` no está en el catálogo."
    upsert_hw_price(spec.code, float(price_uyu), updated_by="chat")
    for item in s.items:
        _recalculate_item(item, s)
    save_session(s)
    return f"Precio de {spec.name} = UYU {price_uyu:,.2f}."


@function_tool
def list_hardware_catalog(ctx: RunContextWrapper[str]) -> str:
    """Lista los códigos de herrajes disponibles (catálogo curado)."""
    by_cat: dict[str, list[str]] = {}
    for h in CURATED_HARDWARE:
        by_cat.setdefault(h.category, []).append(f"{h.code} ({h.name})")
    out = []
    for cat in sorted(by_cat):
        out.append(f"**{cat}**")
        for line in by_cat[cat]:
            out.append(f"  - {line}")
    return "\n".join(out)


@function_tool
def set_piece_quantity(
    ctx: RunContextWrapper[str],
    item_code: str,
    piece_label: str,
    quantity: int,
) -> str:
    """Cambia la cantidad de una pieza por su label dentro de un item."""
    s = _ensure_session(ctx)
    it = find_item(s, item_code)
    if it is None:
        return f"No encontré el item `{item_code}`."
    label_l = piece_label.strip().lower()
    found = next((p for p in it.pieces if p.label.lower() == label_l), None)
    if found is None:
        return f"No hay pieza con label `{piece_label}` en {item_code}. Piezas: {[p.label for p in it.pieces]}"
    found.quantity = max(0, int(quantity))
    _recalculate_item(it, s)
    save_session(s)
    return f"Pieza `{piece_label}` en {item_code} ahora tiene cantidad={quantity}. {_format_item_summary(it)}"


@function_tool
def recalculate(ctx: RunContextWrapper[str], item_code: str | None = None) -> str:
    """Recalcula la cotización (un item específico o todos)."""
    s = _ensure_session(ctx)
    if item_code:
        it = find_item(s, item_code)
        if it is None:
            return f"No encontré el item `{item_code}`."
        _recalculate_item(it, s)
        save_session(s)
        return _format_item_summary(it)
    for item in s.items:
        _recalculate_item(item, s)
    save_session(s)
    return _format_state(s)


# ---------------------------------------------------------------------------
# Memory tools (cross-session facts the user wants the agent to remember)
# ---------------------------------------------------------------------------

@function_tool
def remember_fact(ctx: RunContextWrapper[str], text: str, tags: list[str] | None = None) -> str:
    """Guarda un hecho/regla/preferencia para todas las cotizaciones futuras.

    Usalo cuando el usuario diga explícitamente "acordate que…", "anotá…", "recordá…".
    Si vos detectás una preferencia recurrente, NO llames esto sin antes preguntarle
    al usuario y esperar su confirmación en el siguiente turno.
    Tags útiles: "regla", "cliente:nombre", "default", "material", "herraje".
    """
    fact = agent_memory.add_fact(text, tags or [])
    return f"Anotado (id `{fact.id[:8]}`): {fact.text}"


@function_tool
def forget_fact(ctx: RunContextWrapper[str], fact_id: str) -> str:
    """Borra un hecho recordado por su id (o prefijo de 8 chars). Pedile al usuario
    confirmación antes de borrar si no fue una orden directa."""
    fid = fact_id.strip()
    facts = agent_memory.list_facts()
    matches = [f for f in facts if f.id == fid or f.id.startswith(fid)]
    if not matches:
        return f"No hay un hecho con id `{fact_id}`."
    if len(matches) > 1:
        return f"Hay {len(matches)} hechos que matchean `{fact_id}`. Usá un id más largo."
    target = matches[0]
    agent_memory.delete_fact(target.id)
    return f"Olvidé: {target.text}"


@function_tool
def list_facts(ctx: RunContextWrapper[str]) -> str:
    """Lista todos los hechos guardados (los tenés en el system prompt, esto es
    útil si el usuario te pregunta qué cosas recordás)."""
    facts = agent_memory.list_facts()
    if not facts:
        return "No tengo nada anotado todavía."
    lines = []
    for f in facts:
        tag_str = f" [{', '.join(f.tags)}]" if f.tags else ""
        lines.append(f"- `{f.id[:8]}` {f.text}{tag_str}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

INSTRUCTIONS_BASE = """\
Sos el asistente de cotización de carpintería. Trabajás sobre una sesión de cotización persistida.

Cómo trabajás:
- Si el usuario pregunta cómo está la cotización, llamá `get_state`.
- Cuando el usuario te diga "subí este pliego" / "ingestá este archivo" y te pase paths, usá `ingest_pliego`.
- Si el usuario pide precio de venta de varillas/listones/barrotes/zócalos/molduras por medida (ej: "2 varillas de pino 10x10 de 3.3 m"), usá `quote_moldura_price`. No uses `add_custom_item` para eso y no armes pliego/diseño. Si la medida no existe en stock/listado, igual devolvé precio estimativo y aclaralo.
- Si el usuario describe un mueble a medida en texto ("cotizame un bajo mesada...", "armame precio para...") sin subir pliego, usá `add_custom_item`.
  Convertí medidas a mm antes de llamar la tool. Si faltan medidas/material/espesor, pedí solo esos datos.
- Si el usuario corrige un plano/despiece diciendo que faltan puertas, cajones, estantes, perchero u otro componente, rehacé el item con `add_custom_item` usando la descripción completa corregida; no respondas solo con una disculpa.
- Si te pide cambiar cantidades de herrajes ("3 bisagras en vez de 2"), usá `set_hardware_quantity`.
- Si te pasa precios de herrajes, usá `set_hardware_price` (es global, se persiste para todas las sesiones).
- Si te dice color/días de pago/destino o servicios adicionales (rectificación de medidas, colocación, pintura, barnizado/lustrado), usá las tools correspondientes.
- Después de mutar algo, mostrá el resumen actualizado del item afectado.
- Hablás español rioplatense, conciso. Mostrás números formateados (UYU 12.345,67).
- Códigos de herrajes en MAYÚSCULAS_CON_GUION_BAJO (ej: BISAGRA_FRENO, GUIA_TELESC_400). Si dudás, llamá `list_hardware_catalog`.
- No inventes precios de herrajes — si faltan, decile al usuario qué herrajes necesitan precio (la lista la sabés con `get_state`).
- Cuando el usuario te corrige una cantidad, asumí que sabe lo que hace y aplicalo sin pedir confirmación.

Preguntas operativas obligatorias:
- Despues de cotizar o corregir un mueble, si el usuario no lo indico explicitamente en ese pedido, cerra siempre preguntando:
  1. Necesita rectificacion de medidas?
  2. Va pintado, barnizado o lustrado?
  3. Lleva envio? Si lleva, a donde es?
  4. Lleva colocacion?
- Si el usuario responde, aplica `set_additional_services` y/o `set_destination` segun corresponda.

Mensaje para cliente:
- Cuando la cotizacion ya tenga precio, agrega un bloque breve titulado "Mensaje sugerido para cliente".
- Ese mensaje debe servir para WhatsApp o Instagram: formal pero coloquial, resumido, y sin sonar artificial.
- Inclui el precio final como "UYU ...+IVA", que se realizaria a medida, el material/terminacion principal y una explicacion simple de como se haria el trabajo.
- Hace valer el precio con una frase corta: "buscando que quede firme y prolijo". Evita textos largos tipo brochure.
- Usa cierres naturales como "Mencionanos cualquier ajuste y lo revisamos."
- No expongas costos internos, porcentajes, margenes ni formulas.

Memoria (hechos que sobreviven entre sesiones):
- Si el usuario te pide explícitamente que recuerdes algo ("anotá que…", "acordate de…", "recordá…"), llamá `remember_fact` directo.
- Si vos notás una preferencia recurrente que valdría la pena guardar, NO la guardes solo: preguntale al usuario "¿querés que recuerde esto?" y solo llamá `remember_fact` después de que confirme.
- Si el usuario te pide olvidar algo, usá `forget_fact` con el id (los ves en la sección de hechos guardados de abajo).
- Aplicá los hechos guardados como defaults razonables, sin nombrarlos cada vez. Si el usuario contradice un hecho en una cotización puntual, respetá la última instrucción y no toques la memoria global.
"""


def _build_instructions(session: QuotationSession | None = None) -> str:
    """Compose the agent system prompt with three optional appendices:
    base rules, the current quotation snapshot, and persisted memory facts.

    The state snapshot matters because uploads (and direct UI mutations) don't
    travel through the Responses API thread — without injecting it, the agent
    has no way to know "there is a pliego loaded" the next time the user types.
    """
    parts = [INSTRUCTIONS_BASE]
    if session is not None and session.items:
        parts.append("Estado actual de la cotización:\n" + _format_state(session))
    facts_block = agent_memory.format_facts_for_prompt()
    if facts_block:
        parts.append(facts_block)
    return "\n\n".join(parts) + "\n"


def build_agent(session: QuotationSession | None = None) -> Agent:
    return Agent(
        name="Cotizador",
        instructions=_build_instructions(session),
        model=AGENT_MODEL,
        tools=[
            get_state,
            ingest_pliego,
            quote_moldura_price,
            add_custom_item,
            set_color,
            set_payment_days,
            set_destination,
            set_additional_services,
            set_hardware_quantity,
            set_hardware_price,
            list_hardware_catalog,
            set_piece_quantity,
            recalculate,
            remember_fact,
            forget_fact,
            list_facts,
        ],
    )


async def run_turn_stream(session_id: str, message: str):
    """Streaming variant of ``run_turn``. Async-yields ``(type, payload)`` tuples
    so the caller can push them as SSE / NDJSON.

    Event types:
    - ``token`` ``{delta}`` — assistant text increment.
    - ``tool_call`` ``{tool}`` — agent is about to invoke a tool.
    - ``tool_result`` ``{output}`` — tool returned (preview).
    - ``done`` ``{reply, last_response_id}`` — turn finished.
    - ``error`` ``{message}`` — fatal, the agent didn't complete.
    """
    from openai.types.responses import ResponseTextDeltaEvent

    from carpinteria.quotation_session import update_response_id

    s = get_session(session_id)
    if s is None:
        yield "error", {"message": f"session not found: {session_id}"}
        return

    # Auto-title from the first user message; mirror run_turn().
    if not s.title and not s.messages:
        snippet = message.strip().splitlines()[0][:60]
        if snippet:
            s.title = snippet
            save_session(s)

    append_message(session_id, "user", message)

    direct_quote = _try_direct_moldura_quote(message)
    if direct_quote is not None:
        direct_reply, moldura_quote = direct_quote
        fresh = get_session(session_id) or s
        fresh.moldura_quotes.append(moldura_quote)
        save_session(fresh)
        append_message(session_id, "assistant", direct_reply)
        yield "token", {"delta": direct_reply}
        yield "done", {"reply": direct_reply, "last_response_id": fresh.last_response_id}
        return

    agent = build_agent(s)
    kwargs: dict[str, Any] = {"context": session_id, "max_turns": 25}
    if s.last_response_id:
        kwargs["previous_response_id"] = s.last_response_id

    try:
        streamed = Runner.run_streamed(agent, message, **kwargs)

        async for event in streamed.stream_events():
            ev_type = getattr(event, "type", "")
            if ev_type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                delta = event.data.delta
                if delta:
                    yield "token", {"delta": delta}
            elif ev_type == "run_item_stream_event":
                item = event.item
                item_type = getattr(item, "type", "")
                if item_type == "tool_call_item":
                    raw = getattr(item, "raw_item", None)
                    yield "tool_call", {"tool": getattr(raw, "name", "")}
                elif item_type == "tool_call_output_item":
                    output = getattr(item, "output", "")
                    preview = output[:300] if isinstance(output, str) else str(output)[:300]
                    yield "tool_result", {"output": preview}
    except Exception as exc:
        msg = friendly_openai_error(exc)
        append_message(session_id, "assistant", msg)
        yield "error", {"message": msg}
        return

    new_resp_id = getattr(streamed, "last_response_id", None)
    if new_resp_id:
        update_response_id(session_id, new_resp_id)

    final = streamed.final_output or ""
    if final:
        append_message(session_id, "assistant", final)

    yield "done", {"reply": final, "last_response_id": new_resp_id}


async def run_turn(session_id: str, message: str) -> dict[str, Any]:
    """Run one chat turn against the given session. Returns the assistant text +
    the new last_response_id so the caller can persist it on the session."""
    from carpinteria.quotation_session import update_response_id

    s = get_session(session_id)
    if s is None:
        return {"error": f"session not found: {session_id}"}

    # Auto-title from the first user message when none was set. Keeps the
    # sidebar readable instead of showing the raw session id.
    if not s.title and not s.messages:
        snippet = message.strip().splitlines()[0][:60]
        if snippet:
            s.title = snippet
            save_session(s)

    # Persist the user turn before running so a crash mid-agent still leaves
    # a record of what was asked.
    append_message(session_id, "user", message)

    direct_quote = _try_direct_moldura_quote(message)
    if direct_quote is not None:
        direct_reply, moldura_quote = direct_quote
        fresh = get_session(session_id) or s
        fresh.moldura_quotes.append(moldura_quote)
        save_session(fresh)
        append_message(session_id, "assistant", direct_reply)
        return {
            "reply": direct_reply,
            "last_response_id": fresh.last_response_id,
        }

    # Pass the current session into the prompt builder so the agent always
    # starts the turn knowing what's loaded (items, herrajes, totals, etc.),
    # even when the previous interaction was a UI upload that bypassed chat.
    agent = build_agent(s)
    kwargs: dict[str, Any] = {"context": session_id, "max_turns": 25}
    if s.last_response_id:
        kwargs["previous_response_id"] = s.last_response_id

    try:
        result = await Runner.run(agent, message, **kwargs)
    except Exception as exc:
        msg = friendly_openai_error(exc)
        append_message(session_id, "assistant", msg)
        return {"error": msg}

    # The SDK exposes the response id on `result.last_response_id` (recent
    # versions) or on the trace. Fall back to walking result attributes.
    new_resp_id = getattr(result, "last_response_id", None)
    if new_resp_id:
        update_response_id(session_id, new_resp_id)

    reply = result.final_output or ""
    if reply:
        append_message(session_id, "assistant", reply)

    return {
        "reply": reply,
        "last_response_id": new_resp_id,
    }
