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

from pydantic import BaseModel, Field

from carpinteria.db import collection

COLLECTION = "quotation_sessions"


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


class GeneralSpecs(BaseModel):
    delivery_location: str = ""
    delivery_days: int | None = None
    payment_terms: str = ""
    materials: str = ""
    colors: list[str] = Field(default_factory=list)
    edge_banding: str = ""


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

    # OpenAI Responses-API thread chain. We don't persist message bodies.
    last_response_id: str | None = None

    # Cotización state
    items: list[QuotationItem] = Field(default_factory=list)
    color_default: str = ""
    payment_days: int | None = None
    destination: str = ""
    general_specs: GeneralSpecs = Field(default_factory=GeneralSpecs)

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
    except Exception:
        pass


def create_session(*, user_id: str = "anonymous", title: str = "") -> QuotationSession:
    s = QuotationSession(user_id=user_id, title=title)
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


def list_sessions(user_id: str | None = None, limit: int = 30) -> list[dict]:
    q: dict = {}
    if user_id is not None:
        q["user_id"] = user_id
    return list(_coll().find(q, {"_id": 0}).sort("updated_at", -1).limit(limit))


def find_item(session: QuotationSession, item_code: str) -> QuotationItem | None:
    code_l = item_code.strip().lower()
    for it in session.items:
        if it.code.lower() == code_l:
            return it
    return None
