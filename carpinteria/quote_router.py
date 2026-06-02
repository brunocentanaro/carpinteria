from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


WOOD_SPECIES = ("pino", "euca", "eucaliptus", "eucalipto", "roble", "cedro mara", "abeto")

BOARD_TERMS = (
    "placa",
    "melaminico",
    "melamina",
    "mdf",
    "fenolico",
    "compensado",
    "multiplaca",
)

WOOD_FORBIDDEN_TERMS = (
    "placa",
    "melaminico",
    "melamina",
    "mdf",
    "fenolico",
    "compensado",
    "multiplaca",
    "canto abs",
    "tapacanto",
)


@dataclass(frozen=True)
class QuoteRoute:
    quote_type: str
    subtype: str | None
    confidence: float
    allowed_sources: tuple[str, ...]
    forbidden_terms: tuple[str, ...]
    reason: str
    needs_clarification: bool = False


def norm_text(value: object) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text)


def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(norm_text(term) in text for term in terms)


def classify_quote_type(text: str, *, material: str | None = None) -> QuoteRoute:
    haystack = norm_text(f"{text} {material or ''}")
    mentions_wood = _has_any(haystack, WOOD_SPECIES)
    mentions_solid = _has_any(
        haystack,
        (
            "madera maciza",
            "madera",
            "tabla",
            "tablas",
            "encol",
            "cepill",
            "pata",
            "patas",
            "pulgada",
            "pulgadas",
        ),
    )
    mentions_board = _has_any(haystack, BOARD_TERMS)
    mentions_molding = _has_any(
        haystack,
        ("moldura", "zocalo", "contramarco", "tapajunta", "varilla", "barrote", "liston"),
    )

    if mentions_molding:
        return QuoteRoute(
            quote_type="molduras",
            subtype=None,
            confidence=0.9,
            allowed_sources=("Molduras", "Datos Maderas"),
            forbidden_terms=("placa", "mdf", "melaminico", "canto abs"),
            reason="El pedido menciona molduras, varillas, barrotes o perfiles.",
        )

    if (mentions_wood and mentions_solid) or "madera maciza" in haystack:
        return QuoteRoute(
            quote_type="madera_maciza",
            subtype="tablas_encoladas",
            confidence=0.96,
            allowed_sources=("Datos Maderas",),
            forbidden_terms=WOOD_FORBIDDEN_TERMS,
            reason="El pedido menciona madera maciza/especie y requiere cotizar por tablas encoladas.",
        )

    if mentions_board:
        return QuoteRoute(
            quote_type="placas",
            subtype=None,
            confidence=0.9,
            allowed_sources=("Datos", "Placas"),
            forbidden_terms=(),
            reason="El pedido menciona placa, MDF, melaminico, fenolico o compensado.",
        )

    return QuoteRoute(
        quote_type="indeterminado",
        subtype=None,
        confidence=0.35,
        allowed_sources=(),
        forbidden_terms=(),
        reason="No hay senales suficientes para elegir un cotizador.",
        needs_clarification=True,
    )


def validate_quote_lines(route: QuoteRoute, concepts: list[str]) -> tuple[bool, list[str]]:
    text = norm_text(" ".join(concepts))
    found = [term for term in route.forbidden_terms if norm_text(term) in text]
    return not found, found
