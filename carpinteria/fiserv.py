"""Fiserv Merchant Center integration for La Casa del Carpintero.

Reads the Merchant Center portal (https://merchantcenter.fiservapp.com) over its
JSON API — no browser, no e-mail, no downloaded files. Verified 2026-08-29 with a
dedicated read-only portal user.

Auth is a two-step TOTP flow: `requestOtp` returns a `totpToken`, then
`authenticate` (with the 6-digit Google Authenticator code, generated here from
`FISERV_TOTP_SECRET` via pyotp) returns a JWT good for ~2h. The JWT embeds a
fingerprint of the User-Agent + `sec-ch-ua` + Accept-Language headers, so every
later call must send the *same* headers or the portal answers 401. Radware Bot
Manager guards the site: it challenges GETs and file downloads, but the POST API
calls used here pass as long as the `__uzm*` cookies from the first response ride
along in the session.

Faithful capture only: we store what Fiserv reports and never synthesise days or
movements. The accounting layer decides how each transaction/settlement maps to
caja, banco, financiera or cuentas por cobrar.

Env: FISERV_USER, FISERV_PASS, FISERV_TOTP_SECRET (never commit; set them as
Railway variables on the `carpinteria` service, referenced by the cron service).
"""
from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pyotp
import requests

from .db import collection

BASE_URL = os.getenv("FISERV_BASE_URL", "https://merchantcenter.fiservapp.com")

# Must stay consistent across the whole session: the JWT is bound to this exact
# fingerprint (User-Agent + sec-ch-ua + Accept-Language).
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)
_BASE_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-UY",
    "Content-Type": "application/json",
    "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/dashboard",
}

# Pesos uruguayos. The portal also knows 840 (USD); La Casa settles in UYU.
CURRENCY_UYU = "858"

# Concept names as they arrive in each settlement's `concepts` array, mapped to
# stable snake_case keys for the accounting export.
_CONCEPT_KEYS = {
    "VENTAS C/DESCUENTO CONTADO": "gross_sales",
    "TOTAL IMPORTE ACEPTADO": "accepted_total",
    "ARANCEL": "tariff",
    "IVA CRED. FISC.COMERCIOS": "tariff_vat",
    "CREDITO FISCAL LEY 19.210": "tax_credit_19210",
    "RETENCION FISCAL LEY 17.453": "withholding_17453",
    "TOTAL DEDUCCIONES": "total_deductions",
    "TOTAL LIQUIDACION": "settlement_total",
    "CARGO TERMINAL FISERV": "fiserv_charge",
    "TOTAL PAGOS DE COMERCIOS": "merchant_payments",
    "SUBTOTAL NETO DE PAGOS": "net_payment",
    "COSTO FINANCIERO ANTICIPO": "advance_cost",
    "IVA ANTICIPO": "advance_vat",
}

_MERCHANT = "19931450"
_TERMINAL = "55609547"


class FiservError(RuntimeError):
    pass


def _concept_key(name: str) -> str:
    cleaned = " ".join(str(name).split()).upper()
    return _CONCEPT_KEYS.get(cleaned, cleaned.lower().replace(" ", "_").replace(".", ""))


def _post(session: requests.Session, path: str, payload: dict, *, retries: int = 3) -> Any:
    """POST with a short retry: the settlement backend answers a transient 502
    every so often even for a valid request."""
    url = f"{BASE_URL}{path}"
    last: Exception | None = None
    for attempt in range(retries):
        response = session.post(url, json=payload, timeout=90)
        if response.status_code == 502:
            last = FiservError(f"502 from {path}")
            time.sleep(1.5 * (attempt + 1))
            continue
        if response.status_code >= 400:
            raise FiservError(f"{response.status_code} from {path}: {response.text[:300]}")
        return response.json()
    raise last or FiservError(f"exhausted retries for {path}")


def login(
    *,
    user: str | None = None,
    password: str | None = None,
    totp_secret: str | None = None,
) -> requests.Session:
    """Authenticate and return a session with the bearer token and the Radware
    cookies already set. Credentials default to the environment."""
    user = user or os.environ["FISERV_USER"]
    password = password or os.environ["FISERV_PASS"]
    totp_secret = totp_secret or os.environ["FISERV_TOTP_SECRET"]

    session = requests.Session()
    session.headers.update(_BASE_HEADERS)

    otp = _post(
        session,
        "/api/Users/requestOtp",
        {
            "username": user,
            "password": password,
            "deviceName": "",
            "phoneNumber": "",
            "typeAuthentication": "TOTP",
        },
    )
    totp_token = (otp.get("data") or {}).get("totpToken")
    if not totp_token:
        raise FiservError(f"requestOtp did not return a totpToken: {otp.get('message')!r}")

    code = pyotp.TOTP(totp_secret).now()
    auth = _post(
        session,
        "/api/Users/authenticate",
        {
            "username": user,
            "password": password,
            "otp": code,
            "deviceName": user,
            "totpToken": totp_token,
        },
    )
    token = (auth.get("data") or {}).get("token")
    if not token:
        raise FiservError(f"authenticate failed: {auth.get('message')!r}")
    session.headers["Authorization"] = f"Bearer {token}"
    return session


def _iso_day_start(day: date) -> str:
    return f"{day.isoformat()}T00:00:00.000Z"


def _iso_day_end(day: date) -> str:
    return f"{day.isoformat()}T23:59:59.000Z"


def _iso_uy_midnight(day: date) -> str:
    # Uruguay is UTC-3; settlement/calendar ranges are expressed as local
    # midnight, i.e. 03:00Z.
    return f"{day.isoformat()}T03:00:00.000Z"


def fetch_transactions(session: requests.Session, day: date, *, page: int = 500) -> list[dict]:
    """All transactions authorised on `day` (compras, anulaciones, devoluciones,
    cierres de lote), paginated."""
    out: list[dict] = []
    skip = 0
    while True:
        rows = _post(
            session,
            "/api/Transaction/Transactions",
            {
                "From": _iso_day_start(day),
                "To": _iso_day_end(day),
                "Terminals": [],
                "TransactionState": [],
                "TerminalGroup": "",
                "InitQuestion": "",
                "OperationType": "",
                "AuthTerminal": "",
                "Amount": "",
                "AmountToCustomer": "",
                "MerchantCodes": [],
                "AuthorizationCode": "",
                "Issuer": "",
                "Department": "",
                "Location": "",
                "PayerTaxIds": [],
                "Branch": "",
                "Acquirer": "",
                "TransactionId": "",
                "CardNumber": "",
                "MuId": "",
                "TicketNumber": "",
                "BatchNumber": "",
                "PaymentMode": "",
                "Currency": "",
                "ResponseCode": "",
                "Skip": skip,
                "Take": page,
            },
        )
        if not isinstance(rows, list):
            raise FiservError("unexpected transactions payload")
        out.extend(rows)
        if len(rows) < page:
            break
        skip += page
    return out


def fetch_settlements(session: requests.Session, start: date, end: date, *, page: int = 500) -> list[dict]:
    """Daily settlements paid within [start, end], with per-concept detail."""
    out: list[dict] = []
    skip = 0
    while True:
        data = _post(
            session,
            "/settlement/Settlement/SettlementListDaily",
            {
                "CalculateTotals": True,
                "SettlementNumber": "",
                "From": _iso_uy_midnight(start),
                "To": _iso_uy_midnight(end + timedelta(days=1)),
                "Type": "",
                "Amount": "",
                "TypeSell": "all",
                "DateRangeType": "",
                "Currency": "",
                "MerchantDocuments": [],
                "MerchantNumbers": [],
                "ProductDesc": "",
                "Skip": skip,
                "Take": page,
                "AddDetail": True,
            },
        )
        rows = (data or {}).get("dailySettlements") or []
        out.extend(rows)
        if len(rows) < page:
            break
        skip += page
    return out


def fetch_payment_calendar(session: requests.Session, start: date, end: date) -> list[dict]:
    """Agenda de pagos: net amount by *real* payment date (advance included)."""
    data = _post(
        session,
        "/settlement/Settlement/getSettlementCalendar",
        {
            "From": _iso_uy_midnight(start),
            "To": _iso_uy_midnight(end + timedelta(days=1)),
            "Currency": CURRENCY_UYU,
            "PayerEntity": "",
            "PayingEntityBranch": "",
            "MerchantDocuments": [],
            "MerchantNumbers": [],
            "ProductCode": "",
        },
    )
    return (data or {}).get("rows") or []


def ensure_indexes() -> None:
    collection("fiserv_transactions").create_index("fiserv_id", unique=True)
    collection("fiserv_transactions").create_index([("sale_date", -1), ("batch", 1), ("ticket", 1)])
    collection("fiserv_transactions").create_index([("acquirer", 1), ("sale_date", -1)])
    collection("fiserv_settlements").create_index("source_key", unique=True)
    collection("fiserv_settlements").create_index([("payment_date", -1)])
    collection("fiserv_settlements").create_index([("settlement_number", 1)])
    collection("fiserv_payment_calendar").create_index([("acquirer", 1), ("payment_date", 1)], unique=True)


def _parse_dt(value: str) -> datetime | None:
    # Transactions and settlements report dd/mm/yyyy; the payment calendar
    # reports ISO (e.g. "2026-08-27T00:00:00"). Accept both.
    text = (value or "").strip()
    if not text:
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _signed(row: dict, amount_key: str, sign_key: str) -> float:
    amount = _num(row.get(amount_key))
    return -amount if str(row.get(sign_key)).strip() == "-" else amount


def _normalize_transaction(row: dict) -> dict:
    authored = _parse_dt(row.get("authDateTime", ""))
    return {
        "fiserv_id": str(row["id"]),
        "acquirer": "fiserv",
        "commerce_code": str(row.get("merchant") or _MERCHANT),
        "terminal": str(row.get("terminal") or _TERMINAL),
        "auth_datetime": authored,
        "sale_date": authored.date().isoformat() if authored else None,
        "transaction_type": row.get("transactionType"),
        "state": row.get("state"),
        "response_code": row.get("responseCode"),
        "authorization_code": row.get("authorizationCode"),
        "batch": row.get("batch"),
        "ticket": row.get("ticket"),
        "bill_number": row.get("billNumber"),
        "quotas": row.get("quotas"),
        "deferred_months": row.get("deferredMonths"),
        "currency": row.get("currency"),
        "total_amount": _num(row.get("totalAmountForReport")),
        "amount_to_customer": _num(row.get("amountToCustomer")),
        "taxable_amount": _num(row.get("taxableAmountForReport")),
        "tax_amount": _num(row.get("taxAmountForReport")),
        "tip_amount": _num(row.get("tipAmountForReport")),
        "tax_refund": row.get("taxRefund"),
        "card_number": row.get("cardNumber"),
        "card_last4": (str(row.get("cardNumber"))[-4:] if row.get("cardNumber") else None),
        "product_name": row.get("emvApplicationName"),
        "issuer": row.get("issuer"),
        "input_mode": row.get("inputMode"),
        "is_closed": bool(row.get("isClosed")),
    }


def _normalize_settlement(row: dict) -> dict:
    concepts = {_concept_key(c.get("name", "")): _num(c.get("amount")) for c in row.get("concepts") or []}
    number = str(row.get("settlmentNumber") or "").strip()
    product = str(row.get("productCode") or "").strip()
    payment = _parse_dt(row.get("paymentDate", ""))
    presentation = _parse_dt(row.get("presentationDate", ""))
    return {
        "source_key": f"{number}:{product}",
        "acquirer": "fiserv",
        "commerce_code": str(row.get("merchantNumber") or _MERCHANT),
        "settlement_number": number,
        "product_code": product,
        "product_desc": row.get("productDesc"),
        "sale_type": row.get("saleType"),
        "payment_date": payment.date().isoformat() if payment else None,
        "presentation_date": presentation.date().isoformat() if presentation else None,
        "payer_entity_code": row.get("payerEntityCode"),
        "payer_entity_desc": row.get("payerEntityDesc"),
        "bank_account": row.get("bankAccount"),
        "currency": row.get("currencyCode"),
        "gross_amount": _signed(row, "grossAmount", "signGrossAmount"),
        "discount_amount": _signed(row, "discountAmount", "signDiscountAmount"),
        "net_amount": _signed(row, "netAmount", "signNetAmount"),
        "tariff": _num(row.get("discountAmountArg")),
        "tariff_vat": _num(row.get("settlementTaxRI")),
        "concepts": concepts,
    }


def _upsert(coll_name: str, key_field: str, doc: dict, now: datetime) -> bool:
    result = collection(coll_name).update_one(
        {key_field: doc[key_field]},
        {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return result.upserted_id is not None


def sync_range(start: date, end: date, *, session: requests.Session | None = None, user: str = "manual") -> dict:
    """Sync transactions (per working day), settlements and the payment calendar
    over [start, end]. Idempotent; safe to overlap runs.

    Returns counts plus the last date on which Fiserv reported any transaction —
    so callers can honour "only up to the last loaded day" without guessing.
    """
    ensure_indexes()
    own_session = session is None
    session = session or login()
    now = datetime.now(timezone.utc)
    try:
        tx_seen = tx_new = 0
        last_tx_date: str | None = None
        day = start
        while day <= end:
            for row in fetch_transactions(session, day):
                doc = _normalize_transaction(row)
                tx_seen += 1
                tx_new += int(_upsert("fiserv_transactions", "fiserv_id", doc, now))
                if doc["sale_date"] and (last_tx_date is None or doc["sale_date"] > last_tx_date):
                    last_tx_date = doc["sale_date"]
            day += timedelta(days=1)

        set_seen = set_new = 0
        for row in fetch_settlements(session, start, end):
            doc = _normalize_settlement(row)
            set_seen += 1
            set_new += int(_upsert("fiserv_settlements", "source_key", doc, now))

        cal_rows = 0
        for row in fetch_payment_calendar(session, start, end):
            payment = _parse_dt(row.get("paymentDate", ""))
            totals = row.get("settlementTotals") or []
            uyu = next((t for t in totals if str(t.get("currency")) == CURRENCY_UYU), (totals[0] if totals else {}))
            doc = {
                "acquirer": "fiserv",
                "payment_date": payment.date().isoformat() if payment else None,
                "gross_amount": _num(uyu.get("grossAmount")),
                "net_amount": _num(uyu.get("netAmount")),
                "total_count": int(_num(uyu.get("totalCount"))),
                "currency": CURRENCY_UYU,
            }
            if not doc["payment_date"]:
                continue
            collection("fiserv_payment_calendar").update_one(
                {"acquirer": "fiserv", "payment_date": doc["payment_date"]},
                {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )
            cal_rows += 1

        return {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "transactions_seen": tx_seen,
            "transactions_new": tx_new,
            "settlements_seen": set_seen,
            "settlements_new": set_new,
            "calendar_days": cal_rows,
            "last_transaction_date": last_tx_date,
            "synced_by": user,
        }
    finally:
        if own_session:
            session.close()


def sync_day(day: date, *, user: str = "manual") -> dict:
    return sync_range(day, day, user=user)


# ── Panel de administración "Tarjetas" ───────────────────────────────────────

# Costo real de Fiserv (lo que efectivamente "come"): arancel + su IVA + el costo
# financiero del anticipo + su IVA. Separado de los créditos fiscales, que se
# recuperan ante DGI y NO son costo.
_COST_CONCEPTS = ("tariff", "tariff_vat", "advance_cost", "advance_vat")
_TAX_CREDIT_CONCEPTS = ("tax_credit_19210", "withholding_17453")
_ADVANCE_CONCEPTS = ("advance_cost", "advance_vat")


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    start = date(year, month, 1)
    end = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def panel(year: int, month: int, *, today: date | None = None) -> dict:
    """Aggregate the fiserv_* collections for the admin "Tarjetas" panel. Pure
    read from Mongo — never hits Fiserv."""
    today = today or datetime.now(timezone.utc).date()
    start, end = _month_bounds(year, month)

    settlements = list(
        collection("fiserv_settlements").find(
            {"acquirer": "fiserv", "payment_date": {"$gte": start, "$lte": end}}, {"_id": 0}
        )
    )

    def concept_sum(keys: tuple[str, ...]) -> float:
        return round(sum(_num((s.get("concepts") or {}).get(k)) for s in settlements for k in keys), 2)

    gross = round(sum(_num(s.get("gross_amount")) for s in settlements), 2)
    net = round(sum(_num(s.get("net_amount")) for s in settlements), 2)
    chargebacks = round(sum(_num((s.get("concepts") or {}).get("merchant_payments")) for s in settlements), 2)

    by_product: dict[str, dict] = {}
    for s in settlements:
        key = s.get("product_desc") or s.get("product_code") or "—"
        agg = by_product.setdefault(key, {"product": key, "gross": 0.0, "net": 0.0, "cost": 0.0, "count": 0})
        agg["gross"] += _num(s.get("gross_amount"))
        agg["net"] += _num(s.get("net_amount"))
        agg["cost"] += sum(_num((s.get("concepts") or {}).get(k)) for k in _COST_CONCEPTS)
        agg["count"] += 1
    products = [
        {**v, "gross": round(v["gross"], 2), "net": round(v["net"], 2), "cost": round(v["cost"], 2)}
        for v in sorted(by_product.values(), key=lambda x: -x["gross"])
    ]

    upcoming = list(
        collection("fiserv_payment_calendar").find(
            {"acquirer": "fiserv", "payment_date": {"$gte": today.isoformat()}}, {"_id": 0}
        ).sort("payment_date", 1)
    )
    horizon = (today + timedelta(days=7)).isoformat()
    next_7 = round(sum(_num(r.get("net_amount")) for r in upcoming if r.get("payment_date") <= horizon), 2)

    recent = list(
        collection("fiserv_transactions").find(
            {"acquirer": "fiserv", "sale_date": {"$gte": start, "$lte": end}},
            {"_id": 0, "card_number": 0},
        ).sort([("sale_date", -1), ("auth_datetime", -1)]).limit(200)
    )

    chargeback_rows = [
        {
            "settlement_number": s.get("settlement_number"),
            "payment_date": s.get("payment_date"),
            "amount": round(_num((s.get("concepts") or {}).get("merchant_payments")), 2),
        }
        for s in settlements
        if _num((s.get("concepts") or {}).get("merchant_payments"))
    ]

    last_sync = collection("fiserv_transactions").find_one(
        {"acquirer": "fiserv"}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)]
    )
    alerts = []
    for cb in chargeback_rows:
        alerts.append({"type": "chargeback", "label": f"Contracargo ${cb['amount']:,.2f} en liquidación {cb['settlement_number']} ({cb['payment_date']})"})
    if last_sync and last_sync.get("updated_at"):
        stale_days = (datetime.now(timezone.utc) - last_sync["updated_at"]).days
        if stale_days >= 2:
            alerts.append({"type": "stale_sync", "label": f"Última sincronización con Fiserv hace {stale_days} días"})

    return {
        "year": year,
        "month": month,
        "month_summary": {
            "gross": gross,
            "net": net,
            "cost_fiserv": concept_sum(_COST_CONCEPTS),
            "advance_cost": concept_sum(_ADVANCE_CONCEPTS),
            "tax_credits": concept_sum(_TAX_CREDIT_CONCEPTS),
            "tax_credit_19210": concept_sum(("tax_credit_19210",)),
            "withholding_17453": concept_sum(("withholding_17453",)),
            "tariff": concept_sum(("tariff",)),
            "tariff_vat": concept_sum(("tariff_vat",)),
            "chargebacks": chargebacks,
            "settlement_count": len(settlements),
        },
        "by_product": products,
        "upcoming": upcoming,
        "next_7_days_net": next_7,
        "recent_transactions": recent,
        "chargebacks": chargeback_rows,
        "alerts": alerts,
        "last_sync_at": last_sync.get("updated_at") if last_sync else None,
    }
