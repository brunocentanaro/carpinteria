"""Persistent agent memory — facts the user wants the cotizador to remember
across sessions (defaults, customer notes, technical rules).

Single global collection for now (no per-user scoping). One document per fact.
The full list is injected into the agent's system prompt at the start of each
turn, so listings stay short — under ~50 facts is fine.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from carpinteria.db import collection

COLLECTION = "memory"


class MemoryFact(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    text: str
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def _coll():
    return collection(COLLECTION)


def ensure_indexes() -> None:
    try:
        _coll().create_index("id", unique=True, background=True)
        _coll().create_index([("created_at", -1)], background=True)
    except Exception:
        pass


def add_fact(text: str, tags: list[str] | None = None) -> MemoryFact:
    fact = MemoryFact(text=text.strip(), tags=[t.strip() for t in (tags or []) if t.strip()])
    _coll().insert_one(fact.model_dump())
    return fact


def list_facts() -> list[MemoryFact]:
    docs = list(_coll().find({}, {"_id": 0}).sort("created_at", 1))
    return [MemoryFact.model_validate(d) for d in docs]


def delete_fact(fact_id: str) -> bool:
    res = _coll().delete_one({"id": fact_id})
    return res.deleted_count > 0


def format_facts_for_prompt() -> str:
    """Render the full fact list as a markdown block to embed in the system prompt.

    Returns an empty string when there are no facts so callers can drop the
    section entirely.
    """
    facts = list_facts()
    if not facts:
        return ""
    lines = ["Cosas que el usuario te pidió recordar (aplicalas si vienen al caso):"]
    for f in facts:
        tag_str = f" [{', '.join(f.tags)}]" if f.tags else ""
        lines.append(f"- {f.text}{tag_str}")
    return "\n".join(lines)
