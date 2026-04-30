"""Parse a Barraca Paraná price-list PDF and upload to Google Sheets.

Usage:
    python scripts/upload_lista_precios.py <pdf_path> [--sheet-id ID]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
from gspread.utils import rowcol_to_a1

# Ensure repo root is importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from carpinteria.lista_precios_parser import parse_pdf, items_to_rows  # noqa: E402

DEFAULT_SHEET_ID = "1mcp2xyADcYN45lLq42j8_WEzjM3AKoKx8McSYyDT1h8"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


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
    ws.format(f"A1:{end.split(str(n_rows))[0]}1", {"textFormat": {"bold": True}})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path, help="Path to PDF lista de precios")
    parser.add_argument("--sheet-id", default=os.getenv("PRICES_SHEET_ID", DEFAULT_SHEET_ID))
    parser.add_argument(
        "--sa-file",
        default=os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google/google-service.json"),
    )
    parser.add_argument(
        "--no-activa",
        action="store_true",
        help="Skip writing/replacing the 'Activa' tab",
    )
    args = parser.parse_args()

    if not args.pdf.exists():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 2

    print(f"Parsing {args.pdf} ...")
    items = parse_pdf(args.pdf)
    if not items:
        print("No items parsed — aborting.", file=sys.stderr)
        return 3

    headers, rows = items_to_rows(items)
    lista = items[0].lista or "?"
    periodo = items[0].periodo or "?"
    snapshot_title = f"Lista {lista} - {periodo}"
    print(f"Parsed {len(items)} rows. Snapshot tab: {snapshot_title!r}")

    creds = Credentials.from_service_account_file(args.sa_file, scopes=SCOPES)
    client = gspread.authorize(creds)
    sh = client.open_by_key(args.sheet_id)
    print(f"Opened spreadsheet: {sh.title}")

    n_rows = len(rows) + 5
    n_cols = len(headers)

    snap = _ensure_worksheet(sh, snapshot_title, rows=n_rows, cols=n_cols)
    print(f"  → writing snapshot {snap.title!r} ({len(rows)} rows × {n_cols} cols)")
    _write_table(snap, headers, rows)

    if not args.no_activa:
        activa = _ensure_worksheet(sh, "Activa", rows=n_rows, cols=n_cols)
        print(f"  → writing 'Activa' ({len(rows)} rows × {n_cols} cols)")
        _write_table(activa, headers, rows)

    print("Done.")
    print(f"  https://docs.google.com/spreadsheets/d/{args.sheet_id}/edit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
