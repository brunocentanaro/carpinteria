"""Parse Barraca Paraná price-list PDFs into our canonical product schema.

The canonical model (`Producto`) is intentionally NOT a copy of Paraná's PDF
layout — it normalizes everything we need for matching and quoting:

- One stable internal `sku` (hash of attributes) so prices survive across lists.
- Prices canonicalized to USD (`precio_usd_simp`, `precio_usd_cimp`) using a
  reference TC, plus the original price/currency for audit.
- Dimensions always in mm.
- A single `tipo_producto` enum + `familia` for fast filtering.
- Free-form `tags` for the inevitable "tratado MCA / thermowood / 1 cara".
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Layout / parsing constants (poppler XML coordinates)
# ---------------------------------------------------------------------------

COL_CODIGO = (40, 130)
COL_DESCRIPCION = (240, 670)
COL_UNIDAD = (670, 710)
COL_MONEDA = (710, 750)
COL_SIMP = (750, 800)
COL_CIMP = (800, 850)

ROW_TOP_TOLERANCE = 4

UNIT_TOKENS = {
    "uni": "UNI", "UNI": "UNI", "UNID": "UNI",
    "m": "M", "M": "M",
    "ml": "ML", "ML": "ML",
    "m2": "M2", "M2": "M2", "m²": "M2", "M²": "M2",
    "p²": "P2", "P²": "P2", "P2": "P2", "p2": "P2",
    "hoja": "HOJA", "HOJA": "HOJA",
    "ciento": "CIENTO",
    "rollo": "ROLLO",
}

CURRENCY_TOKENS = {"U$S": "USD", "$": "UYU"}


# ---------------------------------------------------------------------------
# Canonical product taxonomy
# ---------------------------------------------------------------------------

# tipo_producto enum (single high-level bucket per row)
TIPO_PLACA = "PLACA"
TIPO_CANTO = "CANTO"
TIPO_MADERA = "MADERA"            # tablas / vigas / studs / alfajías
TIPO_MOLDURA = "MOLDURA"
TIPO_PISO = "PISO"
TIPO_DECK = "DECK"
TIPO_REVESTIMIENTO = "REVESTIMIENTO"
TIPO_LAMINA = "LAMINA"
TIPO_PUERTA = "PUERTA"
TIPO_PINTURA = "PINTURA"
TIPO_ADHESIVO = "ADHESIVO"
TIPO_INSUMO = "INSUMO"            # lijas, film, mantas, limpiadores, etc.
TIPO_HERRAJE = "HERRAJE"
TIPO_OTRO = "OTRO"


def _classify_tipo(categoria: str, subcategoria: str, subsub: str) -> tuple[str, str]:
    """Return (tipo_producto, familia) from the source PDF section path.

    `familia` is a coarser-than-subcategoria label that's useful for the
    cotizador (e.g. MELAMINICO, MDF, OSB, ABS, THERMOWOOD).
    """
    cat = categoria.upper()
    sub = subcategoria.upper()
    ss = subsub.upper()

    if cat == "MADERAS":
        return TIPO_MADERA, sub or "GENERICO"
    if cat == "MOLDURAS":
        return TIPO_MOLDURA, sub or "GENERICO"
    if cat == "TABLEROS":
        if "MELAMINICO" in sub or "MELAMINA" in sub:
            return TIPO_PLACA, "MELAMINICO"
        if "MDF" in sub:
            return TIPO_PLACA, "MDF"
        if "OSB" in sub:
            return TIPO_PLACA, "OSB"
        if "MULTIPLACA" in sub:
            return TIPO_PLACA, "MULTIPLACA"
        if "PLACA" in sub:
            return TIPO_PLACA, "PLACA"
        if "FIBRO FACIL" in sub or "FIBROFACIL" in sub:
            return TIPO_PLACA, "FIBRO_FACIL"
        if "FENOLICO" in sub:
            return TIPO_PLACA, "FENOLICO"
        if "LAMBRIPLAC" in sub:
            return TIPO_PLACA, "LAMBRIPLAC"
        if "SLOTWALL" in sub:
            return TIPO_PLACA, "SLOTWALL"
        if "PANEL" in sub:
            return TIPO_PLACA, "PANEL"
        return TIPO_PLACA, sub or "GENERICO"
    if cat == "CANTOS":
        if "ABS" in sub:
            return TIPO_CANTO, "ABS"
        if "CHAPAFAZIL" in sub:
            return TIPO_CANTO, "CHAPAFAZIL"
        if "MADERA" in sub:
            return TIPO_CANTO, "MADERA"
        if "MELAMINA" in sub:
            return TIPO_CANTO, "MELAMINA"
        return TIPO_CANTO, sub or "GENERICO"
    if cat == "FIBRAS":
        return TIPO_PLACA, "FIBRA"
    if cat == "COMPENSADOS":
        return TIPO_PLACA, "COMPENSADO"
    if cat == "LAMINADO PLASTICO":
        return TIPO_PLACA, "LAMINADO_PLASTICO"
    if cat == "PUERTAS":
        return TIPO_PUERTA, sub or "GENERICO"
    if cat == "LAMBRICES":
        return TIPO_REVESTIMIENTO, "LAMBRIZ"
    if cat == "REVESTIMIENTOS":
        return TIPO_REVESTIMIENTO, sub or "GENERICO"
    if cat == "LAMINAS":
        return TIPO_LAMINA, "GENERICO"
    if cat == "PISOS":
        return TIPO_PISO, sub or "GENERICO"
    if cat == "DECK":
        return TIPO_DECK, sub or "GENERICO"
    if cat == "FLOTANTE MELAMINICO":
        return TIPO_PISO, "FLOTANTE_MELAMINICO"
    if cat == "FLOTANTES VINILICOS":
        return TIPO_PISO, "FLOTANTE_VINILICO"
    if cat == "PINTURAS":
        return TIPO_PINTURA, "GENERICO"
    if cat == "ADHESIVOS":
        return TIPO_ADHESIVO, "GENERICO"
    if cat in ("LIJAS", "FILM", "MANTA", "LIMPIADOR DE PISOS", "PLASTIFICADO DE PISOS"):
        return TIPO_INSUMO, cat.replace(" ", "_")
    return TIPO_OTRO, sub or cat or "GENERICO"


# Material extraction (ordered: more-specific first)
_MATERIAL_KEYWORDS: list[tuple[str, str]] = [
    ("MULTIPLACA", "MULTIPLACA"),
    ("CHAPADUR", "CHAPADUR"),
    ("MELAMINICO", "MELAMINICO"),
    ("MELAMINA", "MELAMINICO"),
    ("FENOLICO", "FENOLICO"),
    ("LAPACHO", "LAPACHO"),
    ("EUCALIPTUS", "EUCA"),
    ("EUCALIPTOS", "EUCA"),
    ("EUCA", "EUCA"),
    ("PINO FINLANDES", "PINO_FINLANDES"),
    ("PINO ELLIOTIS", "PINO_ELLIOTIS"),
    ("PINO ELLIOT", "PINO_ELLIOTIS"),
    ("PINO CCA", "PINO_CCA"),
    ("PINO MCA", "PINO_MCA"),
    ("PINO AMARILLO", "PINO_AMARILLO"),
    ("PINO CLEAR", "PINO"),
    ("PINO", "PINO"),
    ("ROBLE", "ROBLE"),
    ("CEDRO", "CEDRO"),
    ("CAOBA", "CAOBA"),
    ("OKUME", "OKUME"),
    ("MARUPA", "MARUPA"),
    ("FRESNO", "FRESNO"),
    ("HAYA", "HAYA"),
    ("YESQUERO", "YESQUERO"),
    ("ALAMO", "ALAMO"),
    ("NOGAL", "NOGAL"),
    ("ABEDUL", "ABEDUL"),
    ("ABETO", "ABETO"),
    ("TATAJUBA", "TATAJUBA"),
    ("AMBAY", "AMBAY"),
    ("POPLAR", "POPLAR"),
    ("GRAPIA", "GRAPIA"),
    ("TALI", "TALI"),
    ("CUCHI", "CUCHI"),
    ("JATOBA", "JATOBA"),
    ("JEQUETIBA", "JEQUETIBA"),
    ("WENGUE", "WENGUE"),
    ("CEREJEIRA", "CEREJEIRA"),
    ("VIROLA", "VIROLA"),
    ("GUATAMBU", "GUATAMBU"),
    ("MDF", "MDF"),
    ("OSB", "OSB"),
    ("WPC", "WPC"),
    ("HDF", "HDF"),
    ("ABS", "ABS"),
    ("QUEBRACHO", "QUEBRACHO"),
    ("LPD", "LPD"),
]


def _detect_material(haystack: str) -> str:
    h = haystack.upper()
    for needle, code in _MATERIAL_KEYWORDS:
        if needle in h:
            return code
    return ""


# Tag extraction (order doesn't matter, all matches accumulated)
_TAG_RULES: list[tuple[str, str]] = [
    (r"\bTHERMOWOOD\b", "THERMOWOOD"),
    (r"\bTRATADO\s+MCA\b|\bMCA\b", "TRATADO_MCA"),
    (r"\bTRATADO\s+CCA\b|\bCCA\b", "TRATADO_CCA"),
    (r"\bEXTERIOR\b", "EXTERIOR"),
    (r"\bINTERIOR\b", "INTERIOR"),
    (r"\bFINGER(\s+JOIN[T]?)?\b", "FINGER"),
    (r"\bESTRUCTURAL\b", "ESTRUCTURAL"),
    (r"\b1\s*CARA\b|\b1/CARA\b", "UNA_CARA"),
    (r"\b2\s*CARAS\b", "DOS_CARAS"),
    (r"\bPREPINTAD[OA]\b", "PREPINTADO"),
    (r"\bRUSTICO\b", "RUSTICO"),
    (r"\bCEPILLAD[OA]\b", "CEPILLADO"),
    (r"\bSALDOS?\b|\bSALDO\b", "SALDO"),
    (r"\bPROXIMAMENTE\b", "PROXIMAMENTE"),
    (r"\bSTAND\.?\s*RESIST\.?\s*HUMEDAD\b|\bRH\b", "RESISTENTE_HUMEDAD"),
    (r"\bC/SOPORTE\b", "CON_SOPORTE"),
    (r"\bCON\s+COLA\b", "CON_COLA"),
    (r"\bSIN\s+COLA\b", "SIN_COLA"),
]


def _detect_tags(*sources: str) -> list[str]:
    haystack = " ".join(s.upper() for s in sources)
    tags: list[str] = []
    for pattern, tag in _TAG_RULES:
        if re.search(pattern, haystack) and tag not in tags:
            tags.append(tag)
    return tags


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class Producto:
    sku: str                     # internal stable id
    codigo_proveedor: str        # original PDF code
    proveedor: str               # e.g. BARRACA_PARANA
    tipo_producto: str           # PLACA / CANTO / MADERA / ...
    familia: str                 # MELAMINICO / MDF / ABS / THERMOWOOD ...
    material: str                # PINO / EUCA / MDF / ROBLE / ...
    nombre: str                  # short descriptive name
    descripcion: str             # original full text
    descripcion_normalizada: str
    search_key: str
    espesor_mm: float | None
    ancho_mm: float | None
    largo_mm: float | None
    unidad: str                  # how it's sold (UNI/M/M2/HOJA/P2/ML/CIENTO/ROLLO)
    precio_usd_simp: float
    precio_usd_cimp: float
    moneda_origen: str           # USD or UYU
    precio_origen_simp: float    # in moneda_origen
    precio_origen_cimp: float
    tc_aplicado: float           # TC used to canonicalize to USD; 1.0 if origen=USD
    tags: list[str] = field(default_factory=list)
    # Source / lineage (kept for audit but separate from match attributes)
    categoria_origen: str = ""
    subcategoria_origen: str = ""
    subsubcategoria_origen: str = ""
    lista: str = ""
    periodo: str = ""


@dataclass
class _Span:
    page: int
    top: float
    left: float
    width: float
    text: str
    font_id: str
    font_size: float
    bold: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_float(value: str) -> float:
    s = value.strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _normalize_desc(desc: str) -> str:
    s = _strip_accents(desc).lower()
    return re.sub(r"\s+", " ", s).strip()


def _search_key(*parts: str) -> str:
    s = _strip_accents(" ".join(parts)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _short_name(descripcion: str, max_len: int = 80) -> str:
    cleaned = re.sub(r"\s+", " ", descripcion).strip()
    return cleaned if len(cleaned) <= max_len else cleaned[: max_len - 1] + "…"


def _sku_for(
    tipo: str, familia: str, material: str,
    esp: float | None, ancho: float | None, largo: float | None,
    descripcion_normalizada: str,
    codigo_proveedor: str = "",
) -> str:
    """Stable internal SKU. Codigo_proveedor is included so that two different
    supplier codes with identical descriptions still produce distinct SKUs —
    which happens in Paraná's PDF (e.g. TJ735 vs TC815 both = "TAPACANTO PINO
    0.08x0.15x3.05" with different prices)."""
    key = "|".join([
        tipo, familia, material,
        f"{esp or 0:.2f}", f"{ancho or 0:.1f}", f"{largo or 0:.1f}",
        descripcion_normalizada,
        codigo_proveedor.strip().upper(),
    ])
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return f"{tipo}-{digest}"


# Dimension parsing — `(?<![\d.,])` and `(?![\d.,])` keep digits anchored so
# regex backtracking can't carve "19 x 11" out of "19 x 117 x 4.5".
_DIM_TRIPLE_RE = re.compile(
    r"(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,])\s*(?:mm)?\s*x\s*"
    r"(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,])\s*(?:mm|cm)?\s*x\s*"
    r"(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,])\s*(mm|cm|m)?",
    re.IGNORECASE,
)
_THICKNESS_MM_RE = re.compile(r"(?<![\d.,])(\d+(?:[.,]\d+)?)\s*mm\b", re.IGNORECASE)
_SHEET_DIM_RE = re.compile(
    r"(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,])\s*x\s*"
    r"(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,])(?!\s*x)",
)


def _parse_dimensions(descripcion: str) -> tuple[float | None, float | None, float | None]:
    """Return (espesor_mm, ancho_mm, largo_mm). Always in mm."""
    text = descripcion.strip()
    espesor: float | None = None
    ancho: float | None = None
    largo_mm: float | None = None

    m = _DIM_TRIPLE_RE.search(text)
    if m:
        a = float(m.group(1).replace(",", "."))
        b = float(m.group(2).replace(",", "."))
        c = float(m.group(3).replace(",", "."))
        unit = (m.group(4) or "").lower()
        if a > 20 and b > 20:
            espesor = a
            ancho = b
            if unit == "m":
                largo_mm = c * 1000.0
            elif unit == "cm":
                largo_mm = c * 10.0
            elif c < 20:
                largo_mm = c * 1000.0  # bare small number after big mm pair → meters
            else:
                largo_mm = c
            return espesor, ancho, largo_mm
        if a < 10 and b < 10 and c < 10:
            return None, None, None  # ambiguous (likely all meters/pulgadas)

    t_match = _THICKNESS_MM_RE.search(text)
    if t_match:
        espesor = float(t_match.group(1).replace(",", "."))
    s_match = _SHEET_DIM_RE.search(text)
    if s_match:
        a = float(s_match.group(1).replace(",", "."))
        b = float(s_match.group(2).replace(",", "."))
        if 0.5 < a < 4 and 0.5 < b < 4:
            largo_mm = a * 1000.0
            ancho = b * 1000.0
        elif a > 10 and b > 10:
            ancho = a
            largo_mm = b
    return espesor, ancho, largo_mm


# ---------------------------------------------------------------------------
# PDF → spans → rows
# ---------------------------------------------------------------------------

def _extract_xml(pdf_path: Path) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_prefix = Path(tmpdir) / "out"
        subprocess.run(
            ["pdftohtml", "-xml", "-i", str(pdf_path), str(out_prefix)],
            check=True, capture_output=True,
        )
        return Path(f"{out_prefix}.xml").read_text(encoding="utf-8")


def _parse_xml(xml_text: str) -> list[_Span]:
    root = ET.fromstring(xml_text)
    fontspecs: dict[str, tuple[float, str]] = {}
    spans: list[_Span] = []
    for page_el in root.findall("page"):
        page_num = int(page_el.get("number", "0"))
        for fs in page_el.findall("fontspec"):
            fontspecs[fs.get("id", "")] = (
                float(fs.get("size", "0")),
                fs.get("family", ""),
            )
        for t in page_el.findall("text"):
            font_id = t.get("font", "")
            size, family = fontspecs.get(font_id, (0.0, ""))
            inner_text = "".join(t.itertext()).strip()
            if not inner_text:
                continue
            has_b = t.find("b") is not None
            bold = has_b or "Bold" in family or family.endswith("+Arial")
            spans.append(_Span(
                page=page_num,
                top=float(t.get("top", "0")),
                left=float(t.get("left", "0")),
                width=float(t.get("width", "0")),
                text=inner_text,
                font_id=font_id,
                font_size=size,
                bold=bold,
            ))
    return spans


def _group_rows(spans: list[_Span]) -> list[list[_Span]]:
    rows: list[list[_Span]] = []
    by_page: dict[int, list[_Span]] = {}
    for s in spans:
        by_page.setdefault(s.page, []).append(s)
    for page in sorted(by_page):
        page_spans = sorted(by_page[page], key=lambda s: (s.top, s.left))
        current: list[_Span] = []
        current_top: float | None = None
        for sp in page_spans:
            if current_top is None or abs(sp.top - current_top) <= ROW_TOP_TOLERANCE:
                current.append(sp)
                current_top = sp.top if current_top is None else current_top
            else:
                rows.append(current)
                current = [sp]
                current_top = sp.top
        if current:
            rows.append(current)
    return rows


def _in_band(left: float, band: tuple[float, float]) -> bool:
    return band[0] <= left < band[1]


def _is_data_row(row: list[_Span]) -> bool:
    has_codigo = any(_in_band(s.left, COL_CODIGO) for s in row)
    has_simp = any(_in_band(s.left, COL_SIMP) and re.fullmatch(r"[\d.,]+", s.text) for s in row)
    has_cimp = any(_in_band(s.left, COL_CIMP) and re.fullmatch(r"[\d.,]+", s.text) for s in row)
    return has_codigo and has_simp and has_cimp


def _row_field(row: list[_Span], band: tuple[float, float]) -> str:
    parts = [s.text for s in sorted(row, key=lambda x: x.left) if _in_band(s.left, band)]
    return " ".join(p.strip() for p in parts if p.strip())


SKIP_HEADER_TEXTS = {
    "CODIGO", "IMAGEN ILUSTRATIVA", "DESCRIPCION", "UNI VTA", "MONEDA",
    "PR.VTA", "S/IMP", "C/IMP",
}


def _is_noise_header(row: list[_Span]) -> bool:
    text = " ".join(s.text for s in row).strip()
    if not text:
        return True
    if "LISTA CLIENTES" in text:
        return True
    if any(t in text for t in (
        "para Madera:", "Descuento por fardo", "Consulte disponibilidad",
        "Egger Haus", "Democracia", "B.Berges", "B Berges",
        "CDL /", "YesoCentro", "Pta Este", "Los precios son actuales",
    )):
        return True
    if all(s.text.strip() in SKIP_HEADER_TEXTS for s in row):
        return True
    if re.fullmatch(r"\d{1,3}", text):
        return True
    if re.fullmatch(r"[\d\s/]{4,}", text) and len(text) < 25:
        return True
    return False


KNOWN_TOP_LEVEL = {
    "DECK",
    "FLOTANTE MELAMINICO",
    "FLOTANTES VINILICOS",
    "MANTA",
    "LIMPIADOR DE PISOS",
    "PLASTIFICADO DE PISOS",
    "PINTURAS",
    "FILM",
}


def _classify_header_level(row: list[_Span], header_text: str) -> int | None:
    if header_text.upper().strip() in KNOWN_TOP_LEVEL:
        return 1
    desc_spans = [s for s in row if _in_band(s.left, COL_DESCRIPCION)]
    if not desc_spans:
        return None
    if any(_in_band(s.left, COL_CODIGO) or _in_band(s.left, COL_SIMP) or _in_band(s.left, COL_CIMP) for s in row):
        return None
    s = max(desc_spans, key=lambda x: x.font_size)
    if s.font_size >= 11.5:
        return 1
    if s.font_size >= 10.0:
        return 2
    if s.bold:
        return 3
    if 8.5 <= s.font_size < 10.0 and len(header_text) <= 60 and not re.search(r"\d{2,}", header_text):
        return 3
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

PROVEEDOR_BARRACA_PARANA = "BARRACA_PARANA"


def parse_pdf(
    pdf_path: str | Path,
    lista: str = "",
    periodo: str = "",
    proveedor: str = PROVEEDOR_BARRACA_PARANA,
    tc: float = 40.0,
) -> list[Producto]:
    """Parse the PDF and yield canonical `Producto` rows.

    Args:
        tc: exchange rate UYU→USD used to canonicalize UYU-priced rows. The
            original price/currency is always preserved in `precio_origen_*`
            and `moneda_origen`.
    """
    pdf_path = Path(pdf_path)
    xml_text = _extract_xml(pdf_path)

    if not lista or not periodo:
        m = re.search(r"LISTA CLIENTES\s*N[º°]?\s*(\d+)\s*-\s*([A-Za-zñÑ]+\s+\d{4})", xml_text)
        if m:
            lista = lista or m.group(1)
            periodo = periodo or m.group(2)

    spans = _parse_xml(xml_text)
    rows = _group_rows(spans)

    products: list[Producto] = []
    stack: list[str] = ["", "", ""]

    for row in rows:
        if _is_noise_header(row):
            continue
        if _is_data_row(row):
            codigo = _row_field(row, COL_CODIGO)
            desc = _row_field(row, COL_DESCRIPCION)
            unidad_raw = _row_field(row, COL_UNIDAD)
            moneda_raw = _row_field(row, COL_MONEDA)
            simp_raw = _row_field(row, COL_SIMP)
            cimp_raw = _row_field(row, COL_CIMP)

            if not (codigo and desc and unidad_raw and moneda_raw):
                continue

            unidad = UNIT_TOKENS.get(unidad_raw, unidad_raw.upper())
            moneda = CURRENCY_TOKENS.get(moneda_raw, moneda_raw)
            origen_simp = _to_float(simp_raw)
            origen_cimp = _to_float(cimp_raw)
            tc_used = 1.0 if moneda == "USD" else (tc or 1.0)
            usd_simp = round(origen_simp / tc_used, 4) if moneda == "UYU" else origen_simp
            usd_cimp = round(origen_cimp / tc_used, 4) if moneda == "UYU" else origen_cimp

            categoria, subcategoria, subsub = stack[0], stack[1], stack[2]
            tipo, familia = _classify_tipo(categoria, subcategoria, subsub)
            material = _detect_material(f"{categoria} {subcategoria} {subsub} {desc}")
            tags = _detect_tags(categoria, subcategoria, subsub, desc)
            esp, ancho, largo = _parse_dimensions(desc)
            descripcion_normalizada = _normalize_desc(desc)
            search_key = _search_key(codigo, desc, material, familia)

            sku = _sku_for(tipo, familia, material, esp, ancho, largo, descripcion_normalizada, codigo)

            products.append(Producto(
                sku=sku,
                codigo_proveedor=codigo,
                proveedor=proveedor,
                tipo_producto=tipo,
                familia=familia,
                material=material,
                nombre=_short_name(desc),
                descripcion=desc,
                descripcion_normalizada=descripcion_normalizada,
                search_key=search_key,
                espesor_mm=esp,
                ancho_mm=ancho,
                largo_mm=largo,
                unidad=unidad,
                precio_usd_simp=usd_simp,
                precio_usd_cimp=usd_cimp,
                moneda_origen=moneda,
                precio_origen_simp=origen_simp,
                precio_origen_cimp=origen_cimp,
                tc_aplicado=tc_used,
                tags=tags,
                categoria_origen=categoria,
                subcategoria_origen=subcategoria,
                subsubcategoria_origen=subsub,
                lista=lista,
                periodo=periodo,
            ))
        else:
            text = _row_field(row, COL_DESCRIPCION).strip()
            if not text:
                continue
            level = _classify_header_level(row, text)
            if level is None:
                continue
            if level == 1:
                stack = [text, "", ""]
            elif level == 2:
                stack = [stack[0], text, ""]
            else:
                stack = [stack[0], stack[1], text]

    return products


# Column order for sheet/CSV output (the canonical schema)
SHEET_COLUMNS: list[str] = [
    "sku",
    "codigo_proveedor",
    "proveedor",
    "tipo_producto",
    "familia",
    "material",
    "nombre",
    "descripcion",
    "espesor_mm",
    "ancho_mm",
    "largo_mm",
    "unidad",
    "precio_usd_simp",
    "precio_usd_cimp",
    "moneda_origen",
    "precio_origen_simp",
    "precio_origen_cimp",
    "tc_aplicado",
    "tags",
    "categoria_origen",
    "subcategoria_origen",
    "subsubcategoria_origen",
    "descripcion_normalizada",
    "search_key",
    "lista",
    "periodo",
]


def items_to_rows(items: list[Producto]) -> tuple[list[str], list[list]]:
    rows = []
    for it in items:
        d = asdict(it)
        row = []
        for h in SHEET_COLUMNS:
            v = d[h]
            if v is None:
                row.append("")
            elif isinstance(v, list):
                row.append(",".join(v))
            else:
                row.append(v)
        rows.append(row)
    return list(SHEET_COLUMNS), rows


# Backwards-compat alias for the old name used elsewhere in the codebase.
PriceItem = Producto
