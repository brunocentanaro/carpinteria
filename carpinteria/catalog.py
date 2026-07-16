"""Product catalog for cotizar — wraps the canonical Producto rows from
the Activa price-list sheet with finder helpers used by the calculator.

This replaces the legacy `PriceList` / `Board` / `EdgeBanding` flow.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from carpinteria.lista_precios_parser import Producto


# Map legacy material strings ("melamínico", "MDF", "fibrofácil"...) to the
# canonical (familia, material) pair used in the new schema. Order matters —
# more specific terms first.
# NOTE: in the Activa catalog, melaminic boards are stored as familia="MDF",
# material="MELAMINICO" — NOT familia="MELAMINICO" (that value doesn't exist).
# Raw MDF is material="MDF". So we scope by `material`, not `familia`, for these:
# the old {"familia": "MELAMINICO"} matched zero rows and silently fell back to
# the whole board pool, which is how "melamínico gris" ended up as an MDF.
_MATERIAL_QUERY_MAP: list[tuple[str, dict]] = [
    ("melam",         {"material": "MELAMINICO"}),
    ("melaminic",     {"material": "MELAMINICO"}),
    ("melamina",      {"material": "MELAMINICO"}),
    ("multiplaca",    {"material": "MULTIPLACA"}),
    ("compensado",    {"familia": "COMPENSADO"}),
    ("fenolic",       {"material": "FENOLICO"}),
    ("fibrofacil",    {"familia": "FIBRO_FACIL"}),
    ("fibro facil",   {"familia": "FIBRO_FACIL"}),
    ("fibroplus",     {"familia": "FIBRA"}),
    ("chapadur",      {"material": "CHAPADUR"}),
    ("aglomerado",    {"material": "MULTIPLACA"}),  # closest in new catalog
    ("placa",         {"familia": "PLACA"}),
    ("mdf",           {"material": "MDF"}),  # raw MDF only; melaminic MDF is caught above by "melam"
    ("osb",           {"familia": "OSB"}),
    ("hdf",           {"familia": "HDF"}),
    ("lambriplac",    {"familia": "LAMBRIPLAC"}),
    ("slotwall",      {"familia": "SLOTWALL"}),
]

# Words that describe the board type/finish, not a color. Stripped before we
# decide a request carries a real color, so "MDF crudo" isn't treated as a
# color and pushed toward the priced melaminic tiers.
_NON_COLOR_TERMS = {
    "mdf", "fibrofacil", "fibra", "crudo", "cruda", "compensado", "fenolico",
    "multiplaca", "aglomerado", "placa", "melaminico", "melamina", "melaminizado",
    "hoja", "tablero",
}


def _normalize_material_query(q: str) -> dict:
    """Return filter dict {familia?, material?} guessed from the query string."""
    q_l = _norm_text(q)
    for needle, filt in _MATERIAL_QUERY_MAP:
        if needle in q_l:
            return filt
    return {}


def _norm_text(s: str) -> str:
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def _score_text(haystack: str, query_words: list[str]) -> int:
    h = haystack.lower()
    score = 0
    for w in query_words:
        if not w:
            continue
        if w in h:
            score += 1
    # Negatively bias variants we usually don't want unless explicitly asked.
    if "1/cara" in h or "1 cara" in h:
        score -= 2
    return score


def _query_words(q: str) -> list[str]:
    return [w for w in _norm_text(q).split() if len(w) > 2]


def _color_words(q: str) -> list[str]:
    """Real color/texture words in the request (material/finish terms removed)."""
    return [w for w in _query_words(q) if w not in _NON_COLOR_TERMS and w != "blanco"]


def _is_non_white_color(q: str) -> bool:
    qn = _norm_text(q)
    if not qn or "blanco" in qn:
        return False
    return bool(_color_words(q))


@dataclass
class PlacaMatch:
    producto: Producto
    requested_espesor_mm: float
    is_approx: bool
    requested_color: str = ""
    color_is_approx: bool = False

    @property
    def thickness_note(self) -> str:
        if not self.is_approx:
            return ""
        return f"(no hay {self.requested_espesor_mm:.0f}mm, se usó {self.producto.espesor_mm:.0f}mm más cercano)"

    @property
    def color_note(self) -> str:
        """Explain when the requested color/texture wasn't found as an exact board,
        so the quote never silently swaps the material the client asked for."""
        if not self.color_is_approx or not self.requested_color:
            return ""
        return (
            f"No hay una placa exacta en «{self.requested_color}»; "
            f"se cotizó sobre {self.producto.nombre}. Confirmá el color/textura."
        )


class ProductCatalog:
    """Wraps the canonical Producto list with type-aware finders."""

    def __init__(self, productos: Iterable[Producto]):
        self.productos: list[Producto] = list(productos)

    # ----- factories -----

    @classmethod
    def from_activa(cls, sheet_id: str | None = None) -> "ProductCatalog":
        from carpinteria.lista_precios_sheets import items_from_dicts, read_activa
        rows = read_activa(sheet_id)
        if not rows:
            raise RuntimeError("No pude leer el catalogo Activa de precios de placas.")
        return cls(items_from_dicts(rows))

    # ----- generic filtering -----

    def filter(
        self,
        tipo_producto: str | None = None,
        familia: str | None = None,
        material: str | None = None,
    ) -> list[Producto]:
        out = self.productos
        if tipo_producto:
            out = [p for p in out if p.tipo_producto == tipo_producto]
        if familia:
            out = [p for p in out if p.familia == familia]
        if material:
            out = [p for p in out if p.material == material]
        return out

    # ----- direct SKU lookup (used when a board is "pinned" on a quotation item) -----

    def find_by_sku(self, sku: str) -> Producto | None:
        for p in self.productos:
            if p.sku == sku:
                return p
        return None

    # ----- placa (board) lookup -----

    def find_placa(
        self,
        material_query: str,
        espesor_mm: float,
        color_query: str = "",
    ) -> PlacaMatch | None:
        placas = [p for p in self.productos if p.tipo_producto == "PLACA"]

        filt = _normalize_material_query(material_query)
        if filt:
            scoped = [p for p in placas if all(getattr(p, k) == v for k, v in filt.items())]
        else:
            scoped = placas
        if not scoped:
            scoped = placas

        # Material query may also be a wood (e.g. "EUCA", "ROBLE") — combine with
        # the color words so the scorer can pick e.g. "MDF MELAMINICO BLANCO".
        words = _query_words(f"{material_query} {color_query}")
        color_words = _color_words(color_query)
        non_white = _is_non_white_color(color_query)

        def _wrap(producto: Producto, *, is_approx: bool) -> PlacaMatch:
            # Flag a color mismatch: the client asked for a specific (non-white)
            # color/texture but the chosen board's name doesn't contain it.
            hn = _norm_text(f"{producto.descripcion_normalizada} {producto.nombre} {producto.material}")
            color_ok = any(w in hn for w in color_words) if color_words else True
            return PlacaMatch(
                producto,
                espesor_mm,
                is_approx=is_approx,
                requested_color=color_query.strip(),
                color_is_approx=bool(non_white and color_words and not color_ok),
            )

        # Exact thickness first.
        exact = [p for p in scoped if p.espesor_mm and abs(p.espesor_mm - espesor_mm) < 0.01]
        match = self._best_by_words(exact, words, non_white_color=non_white, color_words=color_words)
        if match:
            return _wrap(match, is_approx=False)

        # Closest thickness fallback.
        thicknesses = sorted({p.espesor_mm for p in scoped if p.espesor_mm})
        if thicknesses:
            closest = min(thicknesses, key=lambda t: abs(t - espesor_mm))
            if abs(closest - espesor_mm) > 0.01:
                approx = [p for p in scoped if p.espesor_mm == closest]
                match = self._best_by_words(approx, words, non_white_color=non_white, color_words=color_words)
                if match:
                    return _wrap(match, is_approx=True)

        return None

    # ----- canto lookup -----

    def find_canto(self, query: str) -> Producto | None:
        cantos = [p for p in self.productos if p.tipo_producto == "CANTO"]
        words = _query_words(query)
        if not words:
            return None
        return self._best_by_words(cantos, words)

    # ----- generic search -----

    def search(self, query: str, tipo_producto: str | None = None, limit: int = 10) -> list[Producto]:
        pool = self.filter(tipo_producto=tipo_producto) if tipo_producto else self.productos
        words = _query_words(query)
        if not words:
            return []
        scored = [
            (_score_text(f"{p.descripcion_normalizada} {p.material} {p.familia}", words), p)
            for p in pool
        ]
        scored = [(s, p) for s, p in scored if s > 0]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [p for _, p in scored[:limit]]

    # ----- internals -----

    def _best_by_words(
        self,
        candidates: list[Producto],
        words: list[str],
        *,
        non_white_color: bool = False,
        color_words: list[str] | None = None,
    ) -> Producto | None:
        if not candidates:
            return None
        if not words:
            return candidates[0]
        color_words = color_words or []
        scored = []
        for p in candidates:
            haystack = f"{p.descripcion_normalizada} {p.material} {p.familia}"
            score = _score_text(haystack, words)
            hn = _norm_text(haystack)
            if non_white_color:
                if "blanco" in hn:
                    score -= 5
                # A board whose name actually carries the requested color/texture
                # (roble halifax, negro, verde eucalipto…) must beat the generic
                # priced tiers — otherwise the +tier boost always swallowed it.
                matched = sum(1 for w in color_words if w and w in hn)
                if matched:
                    score += 4 * matched
                elif any(token in hn for token in ("basicos", "medio", "premium")):
                    score += 2
            scored.append((score, p))
        scored.sort(key=lambda x: (x[0], -((x[1].espesor_mm or 0) * 100 + (x[1].ancho_mm or 0))), reverse=True)
        best_score, best = scored[0]
        if best_score <= 0:
            return None
        return best
