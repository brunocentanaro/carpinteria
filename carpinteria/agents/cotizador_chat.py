"""Chat agent for the cotizador.

Agent SDK tools mutate a `QuotationSession` (Mongo doc) by id. The
`session_id` is injected through `RunContextWrapper.context` so the
model never has to pass it.

History is owned by OpenAI's Responses API: we just remember the
`last_response_id` per session and pass it on the next turn.
"""
from __future__ import annotations

import os
from typing import Any

from agents import Agent, RunContextWrapper, Runner, function_tool

from carpinteria.calculator import calculate_quotation
from carpinteria.catalog import ProductCatalog
from carpinteria.exchange_rate import fetch_bcu_usd
from carpinteria.hardware_catalog import CURATED_HARDWARE, get_by_code
from carpinteria.hardware_prices_sheet import read_all as read_hw_prices, upsert_price as upsert_hw_price
from carpinteria import memory as agent_memory
from carpinteria.pliego import analyze_pliego, decompose_furniture
from carpinteria.quotation_session import (
    CutPiece,
    HardwareUsage,
    QuotationItem,
    QuotationSession,
    append_message,
    find_item,
    get_session,
    save_session,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tc() -> float:
    try:
        return fetch_bcu_usd()[0]
    except Exception:
        return 40.0


def _hw_prices_map() -> dict[str, float]:
    rows = read_hw_prices()
    return {code: float(d.get("precio_uyu") or 0) for code, d in rows.items()}


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
    if not item.pieces:
        item.last_quote = None
        return {"error": "El item no tiene piezas todavía"}
    if catalog is None:
        catalog = ProductCatalog.from_activa()
    if tc is None:
        tc = _tc()

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

    q = calculate_quotation(
        pieces=pieces,
        catalog=catalog,
        tc=tc,
        material=material,
        thickness_mm=float(item.thickness_mm or 18),
        color=color,
        edge_banding_name=eb_name,
        payment_days=session.payment_days,
        destination=session.destination,
        placa_sku=item.placa_sku,
    )
    base = q.model_dump()

    if hw_prices is None:
        hw_prices = _hw_prices_map()
    hw_lines = []
    pending = []
    for hu in item.hardware:
        spec = get_by_code(hu.code)
        if spec is None:
            continue
        unit_price = float(hw_prices.get(hu.code, 0.0))
        line = {
            "code": hu.code,
            "concept": f"Herraje: {spec.name}",
            "category": spec.category,
            "quantity": hu.quantity,
            "unit": hu.unit or spec.unit,
            "unit_price": round(unit_price, 2),
            "subtotal": round(hu.quantity * unit_price, 2),
        }
        hw_lines.append(line)
        if unit_price <= 0:
            pending.append(hu.code)

    base["hardware_lines"] = hw_lines
    base["pending_hardware_codes"] = pending
    hw_total = sum(l["subtotal"] for l in hw_lines)
    base["total_with_hardware"] = round(base.get("total", 0) + hw_total, 2)
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


def _format_state(session: QuotationSession) -> str:
    if not session.items:
        return "Sesión vacía. Subí un pliego o agregá items para empezar."
    body = [
        f"**Sesión** id `{session.id}`",
        f"Color por defecto: `{session.color_default or '—'}` | "
        f"Pago: {session.payment_days or '—'}d | "
        f"Destino: `{session.destination or '—'}`",
        "",
    ]
    grand = 0.0
    for item in session.items:
        body.append(_format_item_summary(item))
        body.append("")
        if item.last_quote:
            grand += float(item.last_quote.get("total_with_hardware", 0)) * item.quantity
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
    for raw in items_payload:
        if not raw.get("wood_only", True):
            # Skip non-carpentry items per the prompt's classification
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
            edge_banding=raw.get("edge_banding", ""),
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
        edge_banding=gs.get("edge_banding", ""),
    )
    if gs.get("delivery_location") and not s.destination:
        s.destination = gs["delivery_location"]
    if gs.get("delivery_days") and not s.payment_days:
        s.payment_days = int(gs["delivery_days"])
    s.pliego_filenames = list({*s.pliego_filenames, *file_paths})

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
    return f"Ingerido pliego con {len(s.items)} muebles. {_format_state(s)}"


@function_tool
def ingest_pliego(ctx: RunContextWrapper[str], file_paths: list[str]) -> str:
    """Lee uno o más archivos de pliego (PDF / XLSX), extrae los muebles y descompone cada uno.
    Pisa los items existentes en la sesión.
    """
    return _ingest_pliego_into_session(str(ctx.context), file_paths)


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
- Si te pide cambiar cantidades de herrajes ("3 bisagras en vez de 2"), usá `set_hardware_quantity`.
- Si te pasa precios de herrajes, usá `set_hardware_price` (es global, se persiste para todas las sesiones).
- Si te dice color/días de pago/destino, usá las tools correspondientes.
- Después de mutar algo, mostrá el resumen actualizado del item afectado.
- Hablás español rioplatense, conciso. Mostrás números formateados (UYU 12.345,67).
- Códigos de herrajes en MAYÚSCULAS_CON_GUION_BAJO (ej: BISAGRA_FRENO, GUIA_TELESC_400). Si dudás, llamá `list_hardware_catalog`.
- No inventes precios de herrajes — si faltan, decile al usuario qué herrajes necesitan precio (la lista la sabés con `get_state`).
- Cuando el usuario te corrige una cantidad, asumí que sabe lo que hace y aplicalo sin pedir confirmación.

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
        model=os.getenv("OPENAI_AGENT_MODEL", "gpt-4.1-mini"),
        tools=[
            get_state,
            ingest_pliego,
            set_color,
            set_payment_days,
            set_destination,
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


async def run_turn(session_id: str, message: str) -> dict[str, Any]:
    """Run one chat turn against the given session. Returns the assistant text +
    the new last_response_id so the caller can persist it on the session."""
    from carpinteria.quotation_session import update_response_id

    s = get_session(session_id)
    if s is None:
        return {"error": f"session not found: {session_id}"}

    # Persist the user turn before running so a crash mid-agent still leaves
    # a record of what was asked.
    append_message(session_id, "user", message)

    # Pass the current session into the prompt builder so the agent always
    # starts the turn knowing what's loaded (items, herrajes, totals, etc.),
    # even when the previous interaction was a UI upload that bypassed chat.
    agent = build_agent(s)
    kwargs: dict[str, Any] = {"context": session_id, "max_turns": 25}
    if s.last_response_id:
        kwargs["previous_response_id"] = s.last_response_id

    result = await Runner.run(agent, message, **kwargs)

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
