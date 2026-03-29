from __future__ import annotations

import os
import re
from pathlib import Path

import gspread
from gspread.exceptions import APIError
from google.oauth2.service_account import Credentials

from carpinteria.schemas import Board, CutService, EdgeBanding, ExchangeRate, PriceList

SHEETS_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

BOARDS_SHEET = "Costos Barraca Paraná terminado"
CANTOS_SHEET = "Costos Barraca Paraná 2"

HEADER_ROW = 1

COL_CODIGO = 0
COL_NOMBRE = 1
COL_DESCRIPCION = 2
COL_FAMILIA = 3
COL_SUBFAMILIA = 4
COL_COSTO_USD = 5
COL_COSTO_UYU = 6
COL_MAYOR_SIMP = 7
COL_PUB_SIMP = 8
COL_MAYOR_CIMP = 9
COL_PUB_CIMP = 10


def _open_spreadsheet(spreadsheet_id: str, service_account_file: str) -> gspread.Spreadsheet:
    import json as _json
    sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if sa_json:
        info = _json.loads(sa_json)
        credentials = Credentials.from_service_account_info(info, scopes=SHEETS_SCOPES)
    else:
        service_account_path = Path(service_account_file)
        if not service_account_path.exists():
            raise FileNotFoundError(f"Service account file not found: {service_account_file}")
        credentials = Credentials.from_service_account_file(
            str(service_account_path),
            scopes=SHEETS_SCOPES,
        )
    client = gspread.authorize(credentials)
    try:
        return client.open_by_key(spreadsheet_id)
    except APIError as exc:
        message = str(exc)
        if "Google Sheets API has not been used" in message or "it is disabled" in message:
            raise RuntimeError(
                "Google Sheets API is disabled for the service account project. "
                "Enable 'Google Sheets API' in Google Cloud and retry."
            ) from exc
        raise RuntimeError(f"Google Sheets API error: {message}") from exc


def _safe_float(value: str) -> float:
    if not value:
        return 0.0
    cleaned = value.replace(",", ".").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _parse_dimensions_from_name(name: str) -> tuple[float, float, float]:
    thickness = 0.0
    width_mm = 0.0
    height_mm = 0.0

    t_match = re.search(r"(\d+(?:[.,]\d+)?)\s*mm", name, re.IGNORECASE)
    if t_match:
        thickness = float(t_match.group(1).replace(",", "."))

    dim_match = re.search(r"(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)", name)
    if dim_match:
        d1 = float(dim_match.group(1).replace(",", "."))
        d2 = float(dim_match.group(2).replace(",", "."))
        if d1 <= 10 and d2 <= 10:
            height_mm = d1 * 1000
            width_mm = d2 * 1000
        else:
            height_mm = d1
            width_mm = d2

    return thickness, width_mm, height_mm


def _classify_material(nombre: str, subfamilia: str) -> str:
    n = nombre.upper()
    s = subfamilia.upper()
    if "MELAM" in n or "MELAM" in s:
        return "melamínico"
    if "MDF" in s or "FIBRO" in n:
        return "MDF"
    if "AGLOMERADO" in n or "AG." in n:
        return "aglomerado"
    if "FENOLICO" in n:
        return "fenólico"
    if "CHAPADUR" in n:
        return "chapadur"
    return "tablero"


def _read_boards(worksheet: gspread.Worksheet) -> list[Board]:
    rows = worksheet.get_all_values()
    boards = []

    target_familias = {"TABLEROS"}
    target_subfamilias = {"MDF", "MELAMINICOS", "MELAMINAS ALTO BRILLO / SUPER", "AGLOMERADOS"}

    for row in rows[HEADER_ROW + 1 :]:
        nombre = row[COL_NOMBRE].strip() if len(row) > COL_NOMBRE else ""
        if not nombre:
            continue

        familia = row[COL_FAMILIA].strip().upper() if len(row) > COL_FAMILIA else ""
        subfamilia = row[COL_SUBFAMILIA].strip() if len(row) > COL_SUBFAMILIA else ""

        if familia not in target_familias:
            continue
        if subfamilia.upper() not in target_subfamilias:
            continue

        precio_usd_str = row[COL_COSTO_USD] if len(row) > COL_COSTO_USD else ""
        precio_usd = _safe_float(precio_usd_str)
        if precio_usd <= 0:
            continue

        thickness, width_mm, height_mm = _parse_dimensions_from_name(nombre)

        material = _classify_material(nombre, subfamilia)

        boards.append(Board(
            material=material,
            thickness_mm=thickness,
            color=nombre,
            width_mm=width_mm,
            height_mm=height_mm,
            price_usd=round(precio_usd, 2),
        ))

    return boards


def _read_exchange_rate(worksheet: gspread.Worksheet) -> ExchangeRate:
    rows = worksheet.get_all_values()
    buy = 40.0
    sell = 38.0
    for row in rows[:3]:
        for j, cell in enumerate(row):
            cell_l = cell.lower().strip()
            if "cambio" in cell_l or cell_l == "tc":
                val = _safe_float(row[j + 1]) if j + 1 < len(row) else 0.0
                if val > 0:
                    if "venta" in cell_l:
                        sell = val
                    else:
                        buy = val
    return ExchangeRate(buy=buy, sell=sell)


def _parse_canto_dimensions(nombre: str) -> tuple[float, float]:
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*[xX×/]\s*(\d+(?:[.,]\d+)?)", nombre)
    if match:
        width = float(match.group(1).replace(",", "."))
        thickness = float(match.group(2).replace(",", "."))
        return width, thickness
    return 0.0, 0.0


def _read_edge_bandings(worksheet: gspread.Worksheet) -> list[EdgeBanding]:
    rows = worksheet.get_all_values()
    bandings = []

    for row in rows[HEADER_ROW + 1 :]:
        familia = row[COL_FAMILIA].strip().upper() if len(row) > COL_FAMILIA else ""
        if familia != "CANTOS":
            continue

        nombre = row[COL_NOMBRE].strip() if len(row) > COL_NOMBRE else ""
        if not nombre:
            continue

        precio_usd = _safe_float(row[COL_COSTO_USD] if len(row) > COL_COSTO_USD else "")
        if precio_usd <= 0:
            continue

        width_mm, thickness_mm = _parse_canto_dimensions(nombre)

        subfamilia = row[COL_SUBFAMILIA].strip() if len(row) > COL_SUBFAMILIA else ""

        bandings.append(EdgeBanding(
            type=subfamilia or "CANTO",
            color=nombre,
            price_usd_per_meter=round(precio_usd, 2),
        ))

    return bandings


def read_price_list(
    spreadsheet_id: str | None = None,
    service_account_file: str | None = None,
) -> PriceList:
    spreadsheet_id = spreadsheet_id or os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "")
    service_account_file = service_account_file or os.getenv(
        "GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google/google-service.json"
    )
    if not spreadsheet_id:
        raise ValueError("GOOGLE_SHEETS_SPREADSHEET_ID not set")

    spreadsheet = _open_spreadsheet(spreadsheet_id, service_account_file)

    boards_ws = spreadsheet.worksheet(BOARDS_SHEET)
    boards = _read_boards(boards_ws)
    exchange_rate = _read_exchange_rate(boards_ws)
    edge_bandings = _read_edge_bandings(spreadsheet.worksheet(CANTOS_SHEET))

    return PriceList(
        boards=boards,
        edge_bandings=edge_bandings,
        exchange_rate=exchange_rate,
    )
