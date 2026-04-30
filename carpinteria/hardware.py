from __future__ import annotations

import os
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from carpinteria.schemas import HardwareCatalog, HardwareItem

PLANILLA_SHEET = "Paneles 1-4+detras caja "

_SHEETS_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


def _open_spreadsheet(spreadsheet_id: str, service_account_file: str) -> gspread.Spreadsheet:
    sa_path = Path(service_account_file)
    if not sa_path.exists():
        raise FileNotFoundError(f"Service account file not found: {service_account_file}")
    credentials = Credentials.from_service_account_file(str(sa_path), scopes=_SHEETS_SCOPES)
    client = gspread.authorize(credentials)
    return client.open_by_key(spreadsheet_id)


def _safe_float(value: str) -> float:
    if not value:
        return 0.0
    cleaned = value.replace(",", ".").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

PLANILLA_COL_CODIGO = 0
PLANILLA_COL_NOMBRE = 2
PLANILLA_COL_SUBFAMILIA = 5
PLANILLA_COL_PRECIO = 8

RELEVANT_SUBFAMILIAS = {
    "BISAGRAS", "RUEDA", "TIRADOR", "MANIJA", "CARRO",
    "CORREDERA", "VAIVEN", "PASADOR",
}

BARRACA_PARANA_ITEMS: list[dict] = [
    {"code": "BP-GUIA-300", "name": "Guía telescópica c/freno 300mm", "price_usd": 12.56},
    {"code": "BP-GUIA-350", "name": "Guía telescópica c/freno 350mm", "price_usd": 14.02},
    {"code": "BP-GUIA-450", "name": "Guía telescópica c/freno 450mm", "price_usd": 17.77},
    {"code": "BP-GUIA-500", "name": "Guía telescópica c/freno 500mm", "price_usd": 20.0},
    {"code": "BP-CERR-CAJ", "name": "Cerradura para cajonera 3 cajones", "price_usd": 3.95},
    {"code": "BP-CERR-TAMBOR", "name": "Cerradura tambor", "price_usd": 5.0},
]
BARRACA_PARANA_MARKUP = float(os.getenv("BARRACA_PARANA_MARKUP", "30"))


def read_hardware_catalog(
    planilla_id: str | None = None,
    service_account_file: str | None = None,
) -> HardwareCatalog:
    planilla_id = planilla_id or os.getenv("HARDWARE_SPREADSHEET_ID", "1MAfnl1TPwKD-9C56P-_BBl6JKcicHVplEXxZlpUHcP8")
    service_account_file = service_account_file or os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google/google-service.json")

    items: list[HardwareItem] = []

    try:
        ss = _open_spreadsheet(planilla_id, service_account_file)
        ws = ss.worksheet(PLANILLA_SHEET)
        rows = ws.get_all_values()

        for row in rows[1:]:
            subfam = row[PLANILLA_COL_SUBFAMILIA].strip() if len(row) > PLANILLA_COL_SUBFAMILIA else ""
            if subfam not in RELEVANT_SUBFAMILIAS:
                continue
            codigo = row[PLANILLA_COL_CODIGO].strip() if len(row) > PLANILLA_COL_CODIGO else ""
            nombre = row[PLANILLA_COL_NOMBRE].strip() if len(row) > PLANILLA_COL_NOMBRE else ""
            precio = _safe_float(row[PLANILLA_COL_PRECIO] if len(row) > PLANILLA_COL_PRECIO else "")
            if not nombre or precio <= 0:
                continue
            items.append(HardwareItem(
                code=codigo,
                name=nombre,
                price_uyu=round(precio, 2),
                source="planilla",
            ))
    except Exception:
        pass

    tc = float(os.getenv("TC_COMPRA", "40"))
    try:
        from carpinteria.exchange_rate import fetch_bcu_usd
        tc, _ = fetch_bcu_usd()
    except Exception:
        pass

    markup = 1 + BARRACA_PARANA_MARKUP / 100
    for bp in BARRACA_PARANA_ITEMS:
        items.append(HardwareItem(
            code=bp["code"],
            name=bp["name"],
            price_uyu=round(bp["price_usd"] * tc * markup, 2),
            source="barraca_parana",
        ))

    return HardwareCatalog(items=items)


def find_hardware(catalog: HardwareCatalog, name: str) -> HardwareItem | None:
    name_l = name.lower()
    for item in catalog.items:
        if item.name.lower() == name_l:
            return item
    for item in catalog.items:
        if name_l in item.name.lower() or item.name.lower() in name_l:
            return item
    words = [w for w in name_l.split() if len(w) > 2]
    scored = []
    for item in catalog.items:
        il = item.name.lower()
        s = sum(1 for w in words if w in il)
        if s > 0:
            scored.append((s, item))
    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    return None
