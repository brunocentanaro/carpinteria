"""Persistent QuotationSession — the canonical state of a chat-driven cotización.

We deliberately keep this small: one document per session in Mongo. Each
chat turn loads it, the agent's tools mutate it via top-level helpers,
and the document is saved back. Conversation history itself lives in
OpenAI's Responses API — we only remember `last_response_id` here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from carpinteria.db import collection

COLLECTION = "quotation_sessions"
try:
    LOCAL_TZ = ZoneInfo("America/Montevideo")
except Exception:
    LOCAL_TZ = timezone.utc


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CutPiece(BaseModel):
    width_mm: float
    height_mm: float
    quantity: int = 1
    label: str = ""
    edge_sides: list[str] = Field(default_factory=list)


class HardwareUsage(BaseModel):
    code: str
    name: str
    category: str = ""
    unit: str = "unidad"
    quantity: int


class QuotationItem(BaseModel):
    """A single mueble being cotizado within the session."""
    code: str                                 # the pliego code, e.g. "A13"
    name: str
    quantity: int = 1                         # units of this mueble
    description: str = ""
    dimensions: dict[str, float] = Field(default_factory=dict)
    material: str = ""
    thickness_mm: float = 18.0
    color: str = ""
    edge_banding: str = ""
    pieces: list[CutPiece] = Field(default_factory=list)
    hardware: list[HardwareUsage] = Field(default_factory=list)
    # When set, the calculator looks up this exact catalog row instead of running
    # the heuristic material/color matcher. Used when the user manually picks a
    # board from the catalog dropdown after auto-match fails.
    placa_sku: str | None = None
    # Cached quote (recalculated on demand). Stored so the chat can show totals
    # without re-running the calculator on every read.
    last_quote: dict[str, Any] | None = None
    notes: str = ""

    @field_validator("code", "name", "description", "material", "color", "edge_banding", "notes", mode="before")
    @classmethod
    def none_to_empty_string(cls, value: Any) -> str:
        return "" if value is None else str(value)


class MolduraQuoteItem(BaseModel):
    code: str = ""
    family: str = ""
    description: str = ""
    width_mm: float
    height_mm: float
    material: str = ""
    quantity: float = 1
    unit: str = "varilla"
    unit_price: float = 0
    total: float = 0
    iva_included: bool = True
    estimated: bool = False
    source: str = ""
    note: str = ""
    breakdown: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GeneralSpecs(BaseModel):
    delivery_location: str = ""
    delivery_days: int | None = None
    payment_terms: str = ""
    materials: str = ""
    colors: list[str] = Field(default_factory=list)
    edge_banding: str = ""
    offer_maintenance_days: int | None = None
    samples_required: str = ""
    bid_guarantee: str = ""
    performance_guarantee: str = ""
    product_warranty: str = ""
    other_conditions: str = ""

    @field_validator(
        "delivery_location",
        "payment_terms",
        "materials",
        "edge_banding",
        "samples_required",
        "bid_guarantee",
        "performance_guarantee",
        "product_warranty",
        "other_conditions",
        mode="before",
    )
    @classmethod
    def none_to_empty_string(cls, value: Any) -> str:
        return "" if value is None else str(value)


class AdditionalServices(BaseModel):
    rectification: bool = False
    installation: bool = False
    painting: bool = False
    varnishing: bool = False
    polishing: bool = False
    lacquering: bool = False


class ToolTraceEntry(BaseModel):
    """One tool invocation within a turn, kept so the owner can audit *why* the
    agent produced a given quote (which tool ran, with what arguments, and what
    it returned)."""
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    output: str = ""


class Attachment(BaseModel):
    """A file the user uploaded (photo/plan/pliego), stored in object storage so
    the quote can be audited against what was actually submitted. `key` is the
    object key; the viewable URL is generated on demand (presigned)."""
    key: str
    filename: str = ""
    content_type: str = ""


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Per-turn agent trace, only populated on assistant messages. Lets the owner
    # see the tool calls + arguments + outputs behind a reply for debugging.
    trace: list[ToolTraceEntry] = Field(default_factory=list)
    # Uploaded files tied to this turn (usually on the user message).
    attachments: list[Attachment] = Field(default_factory=list)


class QuotationSession(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    title: str = ""
    user_id: str = "anonymous"
    brand_id: str = "casa"
    requested_by: str = "anonymous"
    request_area: str = "personal"
    client_name: str = ""
    client_phone: str = ""
    order_summary: str = ""
    payment_status: str = "unknown"  # unknown | none | deposit | paid
    payment_notes: str = ""
    client_details_confirmed: bool = False
    client_details_confirmed_at: datetime | None = None
    final_quote_amount: float | None = None
    final_quote_updated_at: datetime | None = None
    final_quote_updated_by: str = ""
    approved_quote_amounts: dict[str, float] = Field(default_factory=dict)
    approved_quote_tax_modes: dict[str, str] = Field(default_factory=dict)
    approved_quote_price_modes: dict[str, str] = Field(default_factory=dict)
    approved_quote_quantities: dict[str, float] = Field(default_factory=dict)
    approved_quote_notes: dict[str, str] = Field(default_factory=dict)
    approved_quotes_updated_at: datetime | None = None
    approved_quotes_updated_by: str = ""
    confirmed_quote_keys: list[str] = Field(default_factory=list)
    approval_status: str = "pending"  # pending | approved
    client_sent: bool = False
    client_accepted: str = "pending"  # pending | yes | no
    deposit_amount: float | None = None
    order_number: str = ""
    order_created_at: datetime | None = None
    ready_to_deliver: bool = False
    delivered: bool = False
    final_payment_amount: float | None = None
    sequence: int = 0
    year: int | None = None
    month: int | None = None
    folder: str = ""

    # External public-bid source (used by the Compras Estatales radar).
    source_type: str = ""
    external_id: str = ""
    source_url: str = ""
    source_organization: str = ""
    source_category: str = ""
    source_deadline: str = ""
    source_published: str = ""
    source_files: list[str] = Field(default_factory=list)
    processing_status: str = ""  # pending | processing | complete | failed
    processing_error: str = ""

    # OpenAI Responses-API thread chain. We don't persist message bodies.
    last_response_id: str | None = None

    # Cotización state
    items: list[QuotationItem] = Field(default_factory=list)
    moldura_quotes: list[MolduraQuoteItem] = Field(default_factory=list)
    color_default: str = ""
    payment_days: int | None = None
    destination: str = ""
    general_specs: GeneralSpecs = Field(default_factory=GeneralSpecs)
    additional_services: AdditionalServices = Field(default_factory=AdditionalServices)

    # Audit
    pliego_filenames: list[str] = Field(default_factory=list)

    # Chat history (mirrors the OpenAI thread so the UI can rehydrate after reload)
    messages: list[ChatMessage] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def _coll():
    return collection(COLLECTION)


def ensure_indexes() -> None:
    try:
        _coll().create_index("id", unique=True, background=True)
        _coll().create_index([("updated_at", -1)], background=True)
        _coll().create_index([("user_id", 1), ("year", -1), ("month", -1), ("sequence", -1)], background=True)
        _coll().create_index([("brand_id", 1), ("approval_status", 1), ("created_at", -1)], background=True)
    except Exception:
        pass


def current_year_month() -> tuple[int, int]:
    now = datetime.now(LOCAL_TZ)
    return now.year, now.month


def _folder(year: int, month: int) -> str:
    return f"{year}/{month:02d}"


def _month_from_datetime(value: Any) -> tuple[int, int]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        local = value.astimezone(LOCAL_TZ)
        return local.year, local.month
    return current_year_month()


def _next_sequence(*, user_id: str, year: int, month: int) -> int:
    rows = _coll().find(
        {"user_id": user_id},
        {"sequence": 1, "year": 1, "month": 1, "created_at": 1, "updated_at": 1},
    )
    max_sequence = 0
    same_month_count = 0
    for row in rows:
        row_year = row.get("year")
        row_month = row.get("month")
        if not row_year or not row_month:
            row_year, row_month = _month_from_datetime(row.get("created_at") or row.get("updated_at"))
        if int(row_year) != year or int(row_month) != month:
            continue
        same_month_count += 1
        try:
            max_sequence = max(max_sequence, int(row.get("sequence") or 0))
        except (TypeError, ValueError):
            continue
    return max(max_sequence, same_month_count) + 1


def _session_title(year: int, month: int, sequence: int) -> str:
    return f"Cotizacion {year}-{month:02d}-{sequence:03d}"


def _session_row(doc: dict) -> dict:
    created_at = doc.get("created_at") or doc.get("updated_at") or datetime.now(timezone.utc)
    inferred_year, inferred_month = _month_from_datetime(created_at)
    year = int(doc.get("year") or inferred_year)
    month = int(doc.get("month") or inferred_month)
    sequence = int(doc.get("sequence") or 0)
    title = str(doc.get("title") or "")
    if not title:
        title = _session_title(year, month, sequence) if sequence else f"Cotizacion {year}-{month:02d}"
    items = list(doc.get("items") or [])
    total = 0.0
    for item in items:
        quote = item.get("last_quote") or {}
        try:
            total += float(quote.get("total_with_hardware") or quote.get("total") or 0) * int(item.get("quantity") or 1)
        except (TypeError, ValueError):
            continue
    return {
        "id": doc.get("id"),
        "title": title,
        "created_at": created_at,
        "updated_at": doc.get("updated_at") or created_at,
        "user_id": doc.get("user_id") or "anonymous",
        "brand_id": doc.get("brand_id") or "casa",
        "requested_by": doc.get("requested_by") or doc.get("user_id") or "anonymous",
        "request_area": doc.get("request_area") or "personal",
        "client_name": doc.get("client_name") or "",
        "client_phone": doc.get("client_phone") or "",
        "order_summary": doc.get("order_summary") or "",
        "payment_status": doc.get("payment_status") or "unknown",
        "payment_notes": doc.get("payment_notes") or "",
        "client_details_confirmed": bool(doc.get("client_details_confirmed") or False),
        "client_details_confirmed_at": doc.get("client_details_confirmed_at"),
        "final_quote_amount": doc.get("final_quote_amount"),
        "final_quote_updated_at": doc.get("final_quote_updated_at"),
        "final_quote_updated_by": doc.get("final_quote_updated_by") or "",
        "approved_quote_amounts": dict(doc.get("approved_quote_amounts") or {}),
        "approved_quote_tax_modes": dict(doc.get("approved_quote_tax_modes") or {}),
        "approved_quote_price_modes": dict(doc.get("approved_quote_price_modes") or {}),
        "approved_quote_quantities": dict(doc.get("approved_quote_quantities") or {}),
        "approved_quote_notes": dict(doc.get("approved_quote_notes") or {}),
        "approved_quotes_updated_at": doc.get("approved_quotes_updated_at"),
        "approved_quotes_updated_by": doc.get("approved_quotes_updated_by") or "",
        "confirmed_quote_keys": list(doc.get("confirmed_quote_keys") or []),
        "factory_order": bool(doc.get("order_number")),
        "approval_status": doc.get("approval_status") or "pending",
        "client_sent": bool(doc.get("client_sent") or False),
        "client_accepted": doc.get("client_accepted") or "pending",
        "deposit_amount": doc.get("deposit_amount"),
        "order_number": doc.get("order_number") or "",
        "order_created_at": doc.get("order_created_at") or (doc.get("updated_at") if doc.get("order_number") else None),
        "ready_to_deliver": bool(doc.get("ready_to_deliver") or False),
        "delivered": bool(doc.get("delivered") or False),
        "final_payment_amount": doc.get("final_payment_amount"),
        "total": round(total, 2),
        "item_count": len(items),
        "product_count": len(items) + len(doc.get("moldura_quotes") or []),
        "product_keys": [f"item:{item.get('code')}" for item in items]
        + [f"moldura:{index}" for index, _quote in enumerate(doc.get("moldura_quotes") or [])],
        "general_specs": doc.get("general_specs") or {},
        "sequence": sequence,
        "year": year,
        "month": month,
        "folder": str(doc.get("folder") or _folder(year, month)),
        "source_type": doc.get("source_type") or "",
        "external_id": doc.get("external_id") or "",
        "source_url": doc.get("source_url") or "",
        "source_organization": doc.get("source_organization") or "",
        "source_category": doc.get("source_category") or "",
        "source_deadline": doc.get("source_deadline") or "",
        "source_published": doc.get("source_published") or "",
        "source_files": list(doc.get("source_files") or []),
        "processing_status": doc.get("processing_status") or "",
        "processing_error": doc.get("processing_error") or "",
    }


def create_session(
    *,
    user_id: str = "anonymous",
    title: str = "",
    brand_id: str = "casa",
    request_area: str = "personal",
    source: dict[str, Any] | None = None,
) -> QuotationSession:
    year, month = current_year_month()
    sequence = _next_sequence(user_id=user_id, year=year, month=month)
    clean_title = title.strip() or _session_title(year, month, sequence)
    source = source or {}
    s = QuotationSession(
        user_id=user_id,
        requested_by=user_id,
        brand_id=brand_id,
        request_area=request_area,
        approval_status="pending",
        title=clean_title,
        sequence=sequence,
        year=year,
        month=month,
        folder=_folder(year, month),
        source_type=str(source.get("type") or ""),
        external_id=str(source.get("external_id") or ""),
        source_url=str(source.get("url") or ""),
        source_organization=str(source.get("organization") or ""),
        source_category=str(source.get("category") or ""),
        source_deadline=str(source.get("deadline") or ""),
        source_published=str(source.get("published") or ""),
        source_files=list(source.get("files") or []),
        processing_status=str(source.get("processing_status") or ""),
    )
    _coll().insert_one(s.model_dump())
    return s


def get_session_by_external_id(
    source_type: str,
    external_id: str,
    *,
    user_id: str,
    brand_id: str,
) -> QuotationSession | None:
    doc = _coll().find_one({
        "source_type": source_type,
        "external_id": external_id,
        "user_id": user_id,
        "brand_id": brand_id,
    }, {"_id": 0})
    return QuotationSession.model_validate(doc) if doc else None


def get_session(session_id: str) -> QuotationSession | None:
    doc = _coll().find_one({"id": session_id}, {"_id": 0})
    if doc is None:
        return None
    return QuotationSession.model_validate(doc)


def save_session(session: QuotationSession) -> None:
    session.updated_at = datetime.now(timezone.utc)
    data = session.model_dump()
    # `messages` is owned exclusively by append_message ($push). If save_session
    # wrote it too (via replace_one/$set with the whole doc), a slow handler that
    # loaded the session early — e.g. a 30-90s image upload — would clobber every
    # chat message that got $push-ed while it was working. So we never touch
    # `messages` here; $set only the non-conversational state.
    data.pop("messages", None)
    _coll().update_one({"id": session.id}, {"$set": data}, upsert=True)


def update_response_id(session_id: str, response_id: str) -> None:
    _coll().update_one(
        {"id": session_id},
        {"$set": {
            "last_response_id": response_id,
            "updated_at": datetime.now(timezone.utc),
        }},
    )


def append_message(
    session_id: str,
    role: str,
    content: str,
    trace: list[dict[str, Any]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> None:
    """Append a chat message to the session. Atomic so concurrent turns don't clobber."""
    msg = ChatMessage(role=role, content=content, trace=trace or [], attachments=attachments or [])
    _coll().update_one(
        {"id": session_id},
        {
            "$push": {"messages": msg.model_dump()},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
    )


def list_sessions(
    user_id: str | None = None,
    brand_id: str | None = None,
    area: str | None = None,
    limit: int = 30,
    year: int | None = None,
    month: int | None = None,
) -> list[dict]:
    q: dict = {}
    if brand_id is not None:
        if brand_id == "casa":
            q["$or"] = [{"brand_id": "casa"}, {"brand_id": {"$exists": False}}]
        elif brand_id == "pirone":
            q["$or"] = [
                {"brand_id": "pirone"},
                {"brand_id": "casa"},
                {"brand_id": {"$exists": False}},
            ]
        else:
            q["brand_id"] = brand_id
    if user_id is not None and area != "administracion" and brand_id != "pirone":
        q["user_id"] = user_id
    rows = [_session_row(d) for d in _coll().find(q, {"_id": 0}).sort("created_at", -1)]
    if year is not None:
        rows = [r for r in rows if r["year"] == year]
    if month is not None:
        rows = [r for r in rows if r["month"] == month]
    return rows[:limit]


def _crm_segment(name: str, description: str, material: str, *, moldura: bool = False) -> str:
    text = f"{name} {description} {material}".lower()
    if moldura or any(word in text for word in ("moldura", "liston", "listón", "barrote", "varilla", "zocalo", "zócalo", "contravidrio")):
        return "molduras"
    if any(word in text for word in ("melamin", "mdf", "placa", "aglomerado", "compensado", "fenolico", "fenólico")):
        return "muebles_placa"
    if any(word in text for word in ("madera", "eucalipt", "pino", "lapacho", "cedro", "roble", "finger", "maciza")):
        return "muebles_madera"
    if any(word in text for word in ("mueble", "mesa", "silla", "placard", "armario", "escritorio", "estante", "mostrador")):
        return "muebles_otros"
    return "otros"


def list_crm_customers(brand_id: str | None = None) -> list[dict]:
    query: dict[str, Any] = {"$or": [{"client_name": {"$nin": [None, ""]}}, {"client_phone": {"$nin": [None, ""]}}]}
    if brand_id == "casa":
        query = {"$and": [query, {"$or": [{"brand_id": "casa"}, {"brand_id": {"$exists": False}}]}]}
    elif brand_id == "pirone":
        query = {"$and": [query, {"$or": [{"brand_id": "pirone"}, {"brand_id": "casa"}, {"brand_id": {"$exists": False}}]}]}
    elif brand_id:
        query["brand_id"] = brand_id

    customers: dict[str, dict[str, Any]] = {}
    cursor = _coll().find(query, {"_id": 0}).sort("updated_at", -1)
    for doc in cursor:
        name = str(doc.get("client_name") or "").strip()
        phone = str(doc.get("client_phone") or "").strip()
        normalized_phone = "".join(char for char in phone if char.isdigit())
        customer_key = f"phone:{normalized_phone}" if normalized_phone else f"name:{name.casefold()}"
        customer = customers.setdefault(customer_key, {
            "id": customer_key,
            "name": name or "Sin nombre",
            "phone": phone,
            "segments": set(),
            "quotes_count": 0,
            "purchases_count": 0,
            "total_purchased": 0.0,
            "last_activity": None,
            "orders": [],
        })
        if name and customer["name"] == "Sin nombre":
            customer["name"] = name
        if phone and not customer["phone"]:
            customer["phone"] = phone

        confirmed = set(str(key) for key in (doc.get("confirmed_quote_keys") or []))
        accepted = doc.get("client_accepted") == "yes"
        approved_amounts = doc.get("approved_quote_amounts") or {}
        tax_modes = doc.get("approved_quote_tax_modes") or {}
        price_modes = doc.get("approved_quote_price_modes") or {}
        quantities = doc.get("approved_quote_quantities") or {}
        products = []
        order_total = 0.0

        for item in doc.get("items") or []:
            key = f"item:{item.get('code', '')}"
            segment = _crm_segment(str(item.get("name") or ""), str(item.get("description") or ""), str(item.get("material") or ""))
            customer["segments"].add(segment)
            purchased = accepted and key in confirmed
            products.append({
                "key": key,
                "name": str(item.get("name") or item.get("code") or "Producto"),
                "quantity": float(item.get("quantity") or 1),
                "material": str(item.get("material") or ""),
                "segment": segment,
                "purchased": purchased,
            })
            if purchased:
                amount = float(approved_amounts.get(key) or 0)
                if price_modes.get(key) == "unit":
                    amount *= float(quantities.get(key) or item.get("quantity") or 1)
                if tax_modes.get(key, "plus") == "plus":
                    amount *= 1.22
                order_total += amount

        for index, quote in enumerate(doc.get("moldura_quotes") or []):
            key = f"moldura:{index}"
            segment = "molduras"
            customer["segments"].add(segment)
            purchased = accepted and key in confirmed
            products.append({
                "key": key,
                "name": str(quote.get("description") or quote.get("family") or quote.get("code") or "Moldura"),
                "quantity": float(quote.get("quantity") or 1),
                "material": str(quote.get("material") or ""),
                "segment": segment,
                "purchased": purchased,
            })
            if purchased:
                amount = float(approved_amounts.get(key) or 0)
                if price_modes.get(key) == "unit":
                    amount *= float(quantities.get(key) or quote.get("quantity") or 1)
                if tax_modes.get(key, "included") == "plus":
                    amount *= 1.22
                order_total += amount

        activity = doc.get("updated_at") or doc.get("created_at")
        customer["quotes_count"] += 1
        if accepted and any(product["purchased"] for product in products):
            customer["purchases_count"] += 1
        customer["total_purchased"] += order_total
        if customer["last_activity"] is None:
            customer["last_activity"] = activity
        customer["orders"].append({
            "session_id": str(doc.get("id") or ""),
            "title": str(doc.get("title") or "Cotizacion"),
            "summary": str(doc.get("order_summary") or ""),
            "status": "comprado" if accepted and any(product["purchased"] for product in products) else "cotizado",
            "date": activity,
            "total": round(order_total, 2),
            "products": products,
        })

    result = []
    for customer in customers.values():
        customer["segments"] = sorted(customer["segments"])
        customer["total_purchased"] = round(customer["total_purchased"], 2)
        result.append(customer)
    return sorted(result, key=lambda row: row["last_activity"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def list_session_archive(
    user_id: str | None = None,
    brand_id: str | None = None,
    area: str | None = None,
    year: int = 2026,
    limit: int = 1000,
) -> list[dict]:
    rows = list_sessions(user_id=user_id, brand_id=brand_id, area=area, limit=limit, year=year)
    groups: dict[tuple[int, int], list[dict]] = {}
    for row in rows:
        groups.setdefault((int(row["year"]), int(row["month"])), []).append(row)
    months = []
    for (group_year, group_month), sessions in sorted(groups.items(), reverse=True):
        months.append({
            "year": group_year,
            "month": group_month,
            "folder": _folder(group_year, group_month),
            "count": len(sessions),
            "sessions": sessions,
        })
    return months


def set_approval_status(session_id: str, status: str) -> QuotationSession | None:
    if status not in {"pending", "approved"}:
        raise ValueError("invalid approval status")
    _coll().update_one(
        {"id": session_id},
        {"$set": {"approval_status": status, "updated_at": datetime.now(timezone.utc)}},
    )
    return get_session(session_id)


def update_commercial_status(session_id: str, fields: dict[str, Any]) -> QuotationSession | None:
    allowed = {
        "approval_status",
        "client_name",
        "client_phone",
        "order_summary",
        "payment_status",
        "payment_notes",
        "client_details_confirmed",
        "final_quote_amount",
        "final_quote_updated_at",
        "final_quote_updated_by",
        "approved_quote_amounts",
        "approved_quote_tax_modes",
        "approved_quote_price_modes",
        "approved_quote_quantities",
        "approved_quote_notes",
        "approved_quotes_updated_at",
        "approved_quotes_updated_by",
        "confirmed_quote_keys",
        "client_sent",
        "client_accepted",
        "deposit_amount",
        "order_number",
        "ready_to_deliver",
        "delivered",
        "final_payment_amount",
    }
    current = _coll().find_one({"id": session_id}, {"_id": 0}) or {}
    approved_amounts = fields.get("approved_quote_amounts", current.get("approved_quote_amounts") or {})
    tax_modes = fields.get("approved_quote_tax_modes", current.get("approved_quote_tax_modes") or {})
    price_modes = fields.get("approved_quote_price_modes", current.get("approved_quote_price_modes") or {})
    quantities = fields.get("approved_quote_quantities", current.get("approved_quote_quantities") or {})
    item_keys = [f"item:{item.get('code')}" for item in (current.get("items") or [])]
    moldura_keys = [f"moldura:{index}" for index, _quote in enumerate(current.get("moldura_quotes") or [])]
    product_keys = item_keys + moldura_keys
    confirmed_keys = fields.get("confirmed_quote_keys", current.get("confirmed_quote_keys") or [])
    if not isinstance(confirmed_keys, list):
        raise ValueError("Los productos confirmados deben enviarse como lista")
    confirmed_keys = [str(key) for key in confirmed_keys]
    if any(key not in product_keys or float(approved_amounts.get(key) or 0) <= 0 for key in confirmed_keys):
        raise ValueError("Solo puede confirmar productos con precio definitivo avalado")
    confirmed_total = round(sum(
        float(approved_amounts.get(key) or 0)
        * (float(quantities.get(key) or 1) if price_modes.get(key, "total") == "unit" else 1)
        * (1.22 if tax_modes.get(key, "included" if key.startswith("moldura:") else "plus") == "plus" else 1)
        for key in confirmed_keys
    ), 2)
    candidate_approval = fields.get("approval_status", current.get("approval_status") or "pending")
    candidate_sent = bool(fields.get("client_sent", current.get("client_sent") or False))
    candidate_accepted = fields.get("client_accepted", current.get("client_accepted") or "pending")
    candidate_deposit = fields.get("deposit_amount", current.get("deposit_amount"))
    candidate_order = str(fields.get("order_number", current.get("order_number") or "") or "").strip()
    candidate_ready = bool(fields.get("ready_to_deliver", current.get("ready_to_deliver") or False))
    candidate_delivered = bool(fields.get("delivered", current.get("delivered") or False))
    candidate_final_payment = fields.get("final_payment_amount", current.get("final_payment_amount"))
    if "confirmed_quote_keys" in fields and confirmed_keys and not candidate_sent:
        raise ValueError("La cotizacion debe enviarse antes de registrar los productos aceptados")
    if candidate_approval == "approved":
        if not product_keys or any(float(approved_amounts.get(key) or 0) <= 0 for key in product_keys):
            raise ValueError("Debe avalar el precio definitivo de todos los productos antes de aprobar")
        if not current.get("client_details_confirmed"):
            raise ValueError("El empleado debe completar y confirmar primero los datos de la solicitud")
    if candidate_sent and candidate_approval != "approved":
        raise ValueError("La cotizacion debe estar aprobada antes de enviarla al cliente")
    if candidate_accepted != "pending" and not candidate_sent:
        raise ValueError("La cotizacion debe enviarse antes de registrar la respuesta del cliente")
    if candidate_accepted == "yes" and not confirmed_keys:
        raise ValueError("Indique primero que productos acepto el cliente")
    if candidate_deposit not in {None, ""} and float(candidate_deposit) > 0:
        if candidate_accepted != "yes":
            raise ValueError("El cliente debe aceptar al menos un producto antes de registrar la seña")
        required_deposit = round(confirmed_total * 0.50, 2)
        if round(float(candidate_deposit), 2) < required_deposit:
            raise ValueError("La seña debe ser al menos el 50% de los productos confirmados")
    if candidate_order and (candidate_accepted != "yes" or not candidate_deposit):
        raise ValueError("Debe registrar la seña antes de emitir la orden de fabrica")
    if candidate_ready and not candidate_order:
        raise ValueError("Debe existir una orden de fabrica antes de marcar el trabajo como listo")
    if candidate_delivered or candidate_final_payment not in {None, ""}:
        if not candidate_ready:
            raise ValueError("Fabrica debe confirmar que el pedido esta listo antes de entregarlo")
        if not candidate_delivered or candidate_final_payment in {None, ""} or float(candidate_final_payment) < 0:
            raise ValueError("La entrega y el cobro del saldo deben registrarse juntos")
        remaining = round(max(confirmed_total - float(candidate_deposit or 0), 0), 2)
        if round(float(candidate_final_payment), 2) != remaining:
            raise ValueError(f"El saldo restante a cobrar es UYU {remaining:.2f}")
    candidate_payment_status = fields.get("payment_status", current.get("payment_status") or "unknown")
    if candidate_payment_status == "paid" and (not candidate_delivered or candidate_final_payment in {None, ""}):
        raise ValueError("El pago total se registra junto con la entrega y el cobro del saldo")
    if candidate_payment_status == "deposit":
        if not confirmed_keys:
            raise ValueError("Primero indique que productos confirmo el cliente")
        deposit_amount = fields.get("deposit_amount", current.get("deposit_amount"))
        if deposit_amount is None or deposit_amount == "":
            raise ValueError("Ingrese el importe de la seña")
        required_deposit = round(confirmed_total * 0.50, 2)
        if round(float(deposit_amount), 2) < required_deposit:
            raise ValueError("La seña debe ser al menos el 50% de los productos confirmados")
    detail_fields = {"client_name", "client_phone", "order_summary"}
    locked_detail_fields = {"client_name", "client_phone", "order_summary", "payment_notes"}
    if current.get("client_details_confirmed") and locked_detail_fields.intersection(fields):
        raise ValueError("Los datos confirmados del papel de orden no se pueden modificar")
    update: dict[str, Any] = {}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key == "approval_status":
            if value not in {"pending", "approved"}:
                raise ValueError("invalid approval status")
            update[key] = value
        elif key in {"client_name", "client_phone", "order_summary", "payment_notes"}:
            update[key] = str(value or "").strip()
        elif key == "payment_status":
            status = str(value or "unknown").strip()
            if status not in {"unknown", "none", "deposit", "paid"}:
                raise ValueError("invalid payment status")
            if current.get("client_details_confirmed") and status == "unknown":
                raise ValueError("El estado de pago confirmado no puede volver a pendiente")
            update[key] = status
        elif key == "final_quote_amount":
            if value is None or value == "":
                update[key] = None
            else:
                amount = float(value)
                if amount <= 0:
                    raise ValueError("El presupuesto definitivo debe ser mayor a cero")
                update[key] = round(amount, 2)
        elif key == "final_quote_updated_at":
            update[key] = value
        elif key == "final_quote_updated_by":
            update[key] = str(value or "").strip()
        elif key == "approved_quote_amounts":
            if not isinstance(value, dict):
                raise ValueError("Los presupuestos aprobados deben enviarse por producto")
            amounts: dict[str, float] = {}
            for raw_key, raw_amount in value.items():
                item_key = str(raw_key or "").strip()
                amount = float(raw_amount)
                if not item_key or amount <= 0:
                    raise ValueError("Cada presupuesto definitivo debe ser mayor a cero")
                amounts[item_key] = round(amount, 2)
            update[key] = amounts
        elif key == "approved_quote_tax_modes":
            if not isinstance(value, dict):
                raise ValueError("El tratamiento de IVA debe enviarse por producto")
            modes: dict[str, str] = {}
            for raw_key, raw_mode in value.items():
                item_key = str(raw_key or "").strip()
                mode = str(raw_mode or "").strip()
                if not item_key or mode not in {"plus", "included"}:
                    raise ValueError("El tratamiento de IVA debe ser + IVA o IVA incluido")
                modes[item_key] = mode
            update[key] = modes
        elif key == "approved_quote_price_modes":
            if not isinstance(value, dict):
                raise ValueError("Las modalidades de precio deben enviarse por producto")
            modes = {str(raw_key): str(raw_mode) for raw_key, raw_mode in value.items()}
            if any(not item_key or mode not in {"unit", "total"} for item_key, mode in modes.items()):
                raise ValueError("La modalidad debe ser precio unitario o total")
            update[key] = modes
        elif key == "approved_quote_quantities":
            if not isinstance(value, dict):
                raise ValueError("Las cantidades deben enviarse por producto")
            quantities_by_key = {str(raw_key): float(raw_quantity) for raw_key, raw_quantity in value.items()}
            if any(not item_key or quantity <= 0 for item_key, quantity in quantities_by_key.items()):
                raise ValueError("Cada cantidad debe ser mayor a cero")
            update[key] = quantities_by_key
        elif key == "approved_quote_notes":
            if not isinstance(value, dict):
                raise ValueError("Las aclaraciones deben enviarse por producto")
            update[key] = {str(raw_key): str(raw_note or "").strip() for raw_key, raw_note in value.items()}
        elif key == "approved_quotes_updated_at":
            update[key] = value
        elif key == "approved_quotes_updated_by":
            update[key] = str(value or "").strip()
        elif key == "confirmed_quote_keys":
            update[key] = list(dict.fromkeys(confirmed_keys))
        elif key == "client_details_confirmed":
            confirmed = bool(value)
            if confirmed:
                candidate = {field: fields.get(field, current.get(field)) for field in detail_fields}
                if not all([
                    str(candidate.get("client_name") or "").strip(),
                    str(candidate.get("client_phone") or "").strip(),
                    str(candidate.get("order_summary") or "").strip(),
                ]):
                    raise ValueError("Complete todos los datos obligatorios antes de confirmarlos")
                update["client_details_confirmed_at"] = datetime.now(timezone.utc)
            else:
                update["client_details_confirmed_at"] = None
            update[key] = confirmed
        elif key == "client_accepted":
            if value not in {"pending", "yes", "no"}:
                raise ValueError("invalid client accepted status")
            update[key] = value
        elif key in {"client_sent", "ready_to_deliver", "delivered"}:
            update[key] = bool(value)
        elif key == "order_number":
            order_number = str(value or "").strip()
            update[key] = order_number
            if order_number and not current.get("order_number"):
                update["order_created_at"] = datetime.now(timezone.utc)
            elif not order_number:
                update["order_created_at"] = None
        elif key in {"deposit_amount", "final_payment_amount"}:
            if value is None or value == "":
                update[key] = None
            else:
                amount = float(value)
                if amount < 0:
                    raise ValueError("amount must be non-negative")
                update[key] = amount
    if not update:
        return get_session(session_id)
    update["updated_at"] = datetime.now(timezone.utc)
    _coll().update_one({"id": session_id}, {"$set": update})
    return get_session(session_id)


def find_item(session: QuotationSession, item_code: str) -> QuotationItem | None:
    code_l = item_code.strip().lower()
    for it in session.items:
        if it.code.lower() == code_l:
            return it
    return None
