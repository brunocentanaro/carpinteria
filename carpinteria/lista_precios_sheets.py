"""Read/write helpers for the canonical price-list spreadsheet."""
from __future__ import annotations

import os
from typing import Iterable

import gspread
from google.oauth2.service_account import Credentials
from gspread.utils import rowcol_to_a1

from carpinteria.lista_precios_parser import Producto, SHEET_COLUMNS, items_to_rows

DEFAULT_SHEET_ID = "1mcp2xyADcYN45lLq42j8_WEzjM3AKoKx8McSYyDT1h8"
ACTIVA_TAB = "Activa"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _open(sheet_id: str | None = None) -> gspread.Spreadsheet:
    sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google/google-service.json")
    creds = Credentials.from_service_account_file(sa_file, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(sheet_id or os.getenv("PRICES_SHEET_ID", DEFAULT_SHEET_ID))


def _ensure_worksheet(sh: gspread.Spreadsheet, title: str, rows: int, cols: int) -> gspread.Worksheet:
    try:
        ws = sh.worksheet(title)
        ws.clear()
        if ws.row_count < rows:
            ws.add_rows(rows - ws.row_count)
        if ws.col_count < cols:
            ws.add_cols(cols - ws.col_count)
        return ws
    except gspread.WorksheetNotFound:
        return sh.add_worksheet(title=title, rows=rows, cols=cols)


def _write_table(ws: gspread.Worksheet, headers: list[str], rows: list[list]) -> None:
    n_rows = len(rows) + 1
    n_cols = len(headers)
    end = rowcol_to_a1(n_rows, n_cols)
    ws.update(values=[headers, *rows], range_name=f"A1:{end}", value_input_option="RAW")
    header_end = rowcol_to_a1(1, n_cols)
    ws.format(f"A1:{header_end}", {"textFormat": {"bold": True}})


def read_activa(sheet_id: str | None = None) -> list[dict]:
    sh = _open(sheet_id)
    try:
        ws = sh.worksheet(ACTIVA_TAB)
    except gspread.WorksheetNotFound:
        return []
    values = ws.get_all_values()
    if not values:
        return []
    headers = values[0]
    out: list[dict] = []
    for row in values[1:]:
        if not any(cell.strip() for cell in row):
            continue
        out.append({h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)})
    return out


def write_items(items: Iterable[Producto], sheet_id: str | None = None) -> dict:
    items = list(items)
    if not items:
        raise ValueError("write_items: no items to write")

    headers, rows = items_to_rows(items)
    lista = items[0].lista or "?"
    periodo = items[0].periodo or "?"
    snapshot_title = f"Lista {lista} - {periodo}"

    sh = _open(sheet_id)
    n_rows = len(rows) + 5
    n_cols = len(headers)

    snap = _ensure_worksheet(sh, snapshot_title, rows=n_rows, cols=n_cols)
    _write_table(snap, headers, rows)

    activa = _ensure_worksheet(sh, ACTIVA_TAB, rows=n_rows, cols=n_cols)
    _write_table(activa, headers, rows)

    return {
        "ok": True,
        "rows": len(rows),
        "snapshot_tab": snapshot_title,
        "activa_tab": ACTIVA_TAB,
        "lista": lista,
        "periodo": periodo,
        "spreadsheet_id": sh.id,
        "url": f"https://docs.google.com/spreadsheets/d/{sh.id}/edit",
    }


def items_from_dicts(rows: list[dict]) -> list[Producto]:
    out: list[Producto] = []
    for r in rows:
        out.append(Producto(
            sku=str(r.get("sku", "")),
            codigo_proveedor=str(r.get("codigo_proveedor", "")),
            proveedor=str(r.get("proveedor", "")),
            tipo_producto=str(r.get("tipo_producto", "")),
            familia=str(r.get("familia", "")),
            material=str(r.get("material", "")),
            nombre=str(r.get("nombre", "")),
            descripcion=str(r.get("descripcion", "")),
            descripcion_normalizada=str(r.get("descripcion_normalizada", "")),
            search_key=str(r.get("search_key", "")),
            espesor_mm=_to_optional_float(r.get("espesor_mm")),
            ancho_mm=_to_optional_float(r.get("ancho_mm")),
            largo_mm=_to_optional_float(r.get("largo_mm")),
            unidad=str(r.get("unidad", "")),
            precio_usd_simp=float(r.get("precio_usd_simp") or 0),
            precio_usd_cimp=float(r.get("precio_usd_cimp") or 0),
            moneda_origen=str(r.get("moneda_origen", "USD")),
            precio_origen_simp=float(r.get("precio_origen_simp") or 0),
            precio_origen_cimp=float(r.get("precio_origen_cimp") or 0),
            tc_aplicado=float(r.get("tc_aplicado") or 1.0),
            tags=_tags_from(r.get("tags")),
            categoria_origen=str(r.get("categoria_origen", "")),
            subcategoria_origen=str(r.get("subcategoria_origen", "")),
            subsubcategoria_origen=str(r.get("subsubcategoria_origen", "")),
            lista=str(r.get("lista", "")),
            periodo=str(r.get("periodo", "")),
        ))
    return out


def _to_optional_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _tags_from(v) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, list):
        return [str(t) for t in v]
    return [t.strip() for t in str(v).split(",") if t.strip()]
