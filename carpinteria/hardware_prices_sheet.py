"""Read/write hardware prices in the same Google spreadsheet as the price list.

The catalog (codes/names/categories) lives in Python (`hardware_catalog.py`).
The user-typed prices live in a tab `Herrajes_Precios` so they're shared
across users and machines.

Schema of the tab:
    code | name | category | unit | precio_uyu | last_updated_at | last_updated_by
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Iterable

import gspread
from google.oauth2.service_account import Credentials
from gspread.utils import rowcol_to_a1

from carpinteria.hardware_catalog import CURATED_HARDWARE, get_by_code

DEFAULT_SHEET_ID = "1mcp2xyADcYN45lLq42j8_WEzjM3AKoKx8McSYyDT1h8"
TAB = "Herrajes_Precios"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]
HEADERS = ["code", "name", "category", "unit", "precio_uyu", "last_updated_at", "last_updated_by"]


def _open(sheet_id: str | None = None) -> gspread.Spreadsheet:
    sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google/google-service.json")
    creds = Credentials.from_service_account_file(sa_file, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(sheet_id or os.getenv("PRICES_SHEET_ID", DEFAULT_SHEET_ID))


def _ensure_tab(sh: gspread.Spreadsheet) -> gspread.Worksheet:
    try:
        ws = sh.worksheet(TAB)
        existing = ws.row_values(1)
        if existing != HEADERS:
            end = rowcol_to_a1(1, len(HEADERS))
            ws.update(range_name=f"A1:{end}", values=[HEADERS], value_input_option="RAW")
        return ws
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=TAB, rows=200, cols=len(HEADERS))
        end = rowcol_to_a1(1, len(HEADERS))
        ws.update(range_name=f"A1:{end}", values=[HEADERS], value_input_option="RAW")
        ws.format(f"A1:{end}", {"textFormat": {"bold": True}})
        return ws


def read_all(sheet_id: str | None = None) -> dict[str, dict]:
    """Return {code: {price, name, category, unit, last_updated_at, last_updated_by}}.

    Includes every code in the curated catalog, even if no price has been
    typed yet (price=0 in that case) — so the front always has a complete
    list to render.
    """
    sh = _open(sheet_id)
    ws = _ensure_tab(sh)
    values = ws.get_all_values()
    rows = values[1:] if values else []
    by_code: dict[str, dict] = {}
    for row in rows:
        if not row or not row[0].strip():
            continue
        cells = [c for c in row] + [""] * (len(HEADERS) - len(row))
        code = cells[0].strip()
        try:
            price = float(cells[4]) if cells[4] else 0.0
        except ValueError:
            price = 0.0
        by_code[code] = {
            "code": code,
            "name": cells[1],
            "category": cells[2],
            "unit": cells[3],
            "precio_uyu": price,
            "last_updated_at": cells[5],
            "last_updated_by": cells[6],
        }
    # Fill in any catalog codes not yet present in the sheet.
    for spec in CURATED_HARDWARE:
        by_code.setdefault(spec.code, {
            "code": spec.code,
            "name": spec.name,
            "category": spec.category,
            "unit": spec.unit,
            "precio_uyu": 0.0,
            "last_updated_at": "",
            "last_updated_by": "",
        })
    return by_code


def upsert_price(code: str, price: float, *, updated_by: str = "", sheet_id: str | None = None) -> dict:
    """Insert or update the price row for `code`. Returns the resulting row dict."""
    spec = get_by_code(code)
    if spec is None:
        raise ValueError(f"Hardware code not in catalog: {code}")

    sh = _open(sheet_id)
    ws = _ensure_tab(sh)
    values = ws.get_all_values()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new_row = [spec.code, spec.name, spec.category, spec.unit, round(price, 2), now, updated_by or ""]

    found_row_idx: int | None = None
    for idx, row in enumerate(values[1:], start=2):
        if row and row[0].strip() == spec.code:
            found_row_idx = idx
            break

    if found_row_idx is None:
        ws.append_row(new_row, value_input_option="RAW")
    else:
        end = rowcol_to_a1(found_row_idx, len(HEADERS))
        ws.update(range_name=f"A{found_row_idx}:{end}", values=[new_row], value_input_option="RAW")

    return {
        "code": spec.code,
        "name": spec.name,
        "category": spec.category,
        "unit": spec.unit,
        "precio_uyu": round(price, 2),
        "last_updated_at": now,
        "last_updated_by": updated_by or "",
    }
