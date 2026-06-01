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


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class QuotationSession(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    title: str = ""
    user_id: str = "anonymous"
    brand_id: str = "casa"
    requested_by: str = "anonymous"
    request_area: str = "personal"
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
        "sequence": sequence,
        "year": year,
        "month": month,
        "folder": str(doc.get("folder") or _folder(year, month)),
    }


def create_session(
    *,
    user_id: str = "anonymous",
    title: str = "",
    brand_id: str = "casa",
    request_area: str = "personal",
) -> QuotationSession:
    year, month = current_year_month()
    sequence = _next_sequence(user_id=user_id, year=year, month=month)
    clean_title = title.strip() or _session_title(year, month, sequence)
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
    )
    _coll().insert_one(s.model_dump())
    return s


def get_session(session_id: str) -> QuotationSession | None:
    doc = _coll().find_one({"id": session_id}, {"_id": 0})
    if doc is None:
        return None
    return QuotationSession.model_validate(doc)


def save_session(session: QuotationSession) -> None:
    session.updated_at = datetime.now(timezone.utc)
    _coll().replace_one({"id": session.id}, session.model_dump(), upsert=True)


def update_response_id(session_id: str, response_id: str) -> None:
    _coll().update_one(
        {"id": session_id},
        {"$set": {
            "last_response_id": response_id,
            "updated_at": datetime.now(timezone.utc),
        }},
    )


def append_message(session_id: str, role: str, content: str) -> None:
    """Append a chat message to the session. Atomic so concurrent turns don't clobber."""
    msg = ChatMessage(role=role, content=content)
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
                {"order_number": {"$exists": True, "$nin": ["", None]}},
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


def list_session_archive(
    user_id: str | None = None,
    brand_id: str | None = None,
    area: str | None = None,
    year: int = 2026,
) -> list[dict]:
    rows = list_sessions(user_id=user_id, brand_id=brand_id, area=area, limit=500, year=year)
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
        "client_sent",
        "client_accepted",
        "deposit_amount",
        "order_number",
        "ready_to_deliver",
        "delivered",
        "final_payment_amount",
    }
    current = _coll().find_one({"id": session_id}, {"_id": 0}) or {}
    update: dict[str, Any] = {}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key == "approval_status":
            if value not in {"pending", "approved"}:
                raise ValueError("invalid approval status")
            update[key] = value
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
