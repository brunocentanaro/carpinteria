from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from tempfile import gettempdir
from uuid import uuid4

from pymongo import ReturnDocument

from .db import collection


MOVEMENT_DIRECTIONS = {"income", "expense", "transfer"}
PAYMENT_METHODS = {
    "efectivo",
    "cheque",
    "deposito",
    "transferencia",
    "visa",
    "master",
    "maestro",
    "mercadolibre",
    "otro",
}
INVOICE_STATUSES = {"pendiente", "parcial", "pagada", "no_aplica"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(value: object) -> str:
    return str(value or "").strip()


def _money(value: object) -> float:
    try:
        amount = round(float(value or 0), 2)
    except (TypeError, ValueError) as exc:
        raise ValueError("El importe debe ser numerico") from exc
    if amount < 0:
        raise ValueError("El importe no puede ser negativo")
    return amount


def _positive_money(value: object) -> float:
    amount = _money(value)
    if amount <= 0:
        raise ValueError("El importe debe ser mayor a cero")
    return amount


def _currency(value: object) -> str:
    currency = _clean(value).upper() or "UYU"
    if currency in {"$", "PESOS"}:
        return "UYU"
    if currency in {"DOLAR", "DOLARES", "U$S"}:
        return "USD"
    if currency not in {"UYU", "USD"}:
        raise ValueError("Moneda invalida")
    return currency


def _safe_currency(value: object) -> str:
    try:
        return _currency(value)
    except ValueError:
        return "UYU"


def _ensure_storage() -> None:
    collection("accounting_movements").create_index("id", unique=True)
    collection("accounting_movements").create_index([("brand_id", 1), ("year", 1), ("month", 1), ("workday_number", 1)])
    collection("accounting_movements").create_index("source_key", unique=True, sparse=True)
    collection("supplier_invoices").create_index("id", unique=True)
    collection("supplier_invoices").create_index("source_key", unique=True, sparse=True)
    collection("supplier_invoices").create_index([("brand_id", 1), ("supplier", 1), ("status", 1)])
    collection("supplier_payments").create_index("id", unique=True)
    collection("supplier_payments").create_index("supplier_invoice_id")


def sync_ucfe_supplier_invoices(user: str = "ucfe") -> dict:
    _ensure_storage()
    created = 0
    updated = 0
    for cfe in collection("ucfe_received_cfe").find({}, {"_id": 0, "xml": 0}):
        ucfe_id = _clean(cfe.get("ucfe_id"))
        if not ucfe_id:
            continue
        amount = _money(cfe.get("amount_payable") if cfe.get("amount_payable") is not None else cfe.get("total_amount"))
        if amount <= 0:
            continue
        series_number = _clean(cfe.get("series_number"))
        supplier = _clean(cfe.get("supplier_name")) or _clean(cfe.get("supplier_rut")) or "Proveedor UCFE"
        source_key = f"UCFE_CFE:{ucfe_id}"
        existing = collection("supplier_invoices").find_one({"source_key": source_key}, {"_id": 0})
        payload = {
            "supplier": supplier,
            "rut": _clean(cfe.get("supplier_rut")),
            "invoice_number": series_number or ucfe_id,
            "currency": _safe_currency(cfe.get("currency") or "UYU"),
            "amount": amount,
            "paid_amount": float(existing.get("paid_amount") or 0) if existing else 0,
            "purchase_date": _clean(cfe.get("document_date")),
            "status": existing.get("status") if existing and existing.get("paid_amount") else "pendiente",
            "ucfe_cfe_id": ucfe_id,
            "source_key": source_key,
            "notes": "Factura recibida desde UCFE",
        }
        upsert_supplier_invoice(payload, user, ensure_storage=False)
        if existing:
            updated += 1
        else:
            created += 1
    return {"created": created, "updated": updated}


def register_movement(data: dict, user: str) -> dict:
    _ensure_storage()
    direction = _clean(data.get("direction")).lower()
    if direction not in MOVEMENT_DIRECTIONS:
        raise ValueError("Direccion de movimiento invalida")
    payment_method = _clean(data.get("payment_method")).lower() or "efectivo"
    if payment_method not in PAYMENT_METHODS:
        raise ValueError("Medio de pago invalido")
    amount = _positive_money(data.get("amount"))
    year = int(data.get("year") or datetime.now().year)
    month = int(data.get("month") or datetime.now().month)
    if not 1 <= month <= 12:
        raise ValueError("Mes invalido")
    workday_number = int(data.get("workday_number") or 1)
    if workday_number <= 0:
        raise ValueError("Dia trabajado invalido")
    movement = {
        "id": str(uuid4()),
        "brand_id": "casa",
        "year": year,
        "month": month,
        "workday_number": workday_number,
        "date": _clean(data.get("date")),
        "direction": direction,
        "category": _clean(data.get("category")) or "general",
        "subcategory": _clean(data.get("subcategory")),
        "payment_method": payment_method,
        "amount": amount,
        "currency": _currency(data.get("currency")),
        "description": _clean(data.get("description")),
        "reference": _clean(data.get("reference")),
        "source": _clean(data.get("source")) or "manual",
        "source_key": _clean(data.get("source_key")) or None,
        "supplier_invoice_id": _clean(data.get("supplier_invoice_id")),
        "reconciled": bool(data.get("reconciled", False)),
        "created_at": _now(),
        "created_by": user,
        "updated_at": _now(),
        "updated_by": user,
    }
    if movement["source_key"]:
        existing = collection("accounting_movements").find_one({"source_key": movement["source_key"]}, {"_id": 0})
        if existing:
            return {"movement": existing, "already_registered": True}
    collection("accounting_movements").insert_one(movement)
    movement.pop("_id", None)
    return {"movement": movement, "already_registered": False}


def upsert_supplier_invoice(data: dict, user: str, *, ensure_storage: bool = True) -> dict:
    if ensure_storage:
        _ensure_storage()
    invoice_id = _clean(data.get("id"))
    supplier = _clean(data.get("supplier"))
    invoice_number = _clean(data.get("invoice_number"))
    if not supplier:
        raise ValueError("Falta proveedor")
    amount = _positive_money(data.get("amount"))
    paid_amount = _money(data.get("paid_amount"))
    if paid_amount > amount:
        raise ValueError("El pago no puede superar el monto de la factura")
    status = _clean(data.get("status")).lower()
    if not status:
        status = "pagada" if paid_amount >= amount else "parcial" if paid_amount > 0 else "pendiente"
    if status not in INVOICE_STATUSES:
        raise ValueError("Estado de factura invalido")
    now = _now()
    invoice = {
        "brand_id": "casa",
        "supplier": supplier,
        "rut": _clean(data.get("rut")),
        "invoice_number": invoice_number,
        "currency": _currency(data.get("currency")),
        "amount": amount,
        "paid_amount": paid_amount,
        "balance": round(max(0, amount - paid_amount), 2),
        "purchase_date": _clean(data.get("purchase_date")),
        "due_date": _clean(data.get("due_date")),
        "status": status,
        "ucfe_cfe_id": _clean(data.get("ucfe_cfe_id")),
        "source_key": _clean(data.get("source_key")) or None,
        "notes": _clean(data.get("notes")),
        "updated_at": now,
        "updated_by": user,
    }
    query = {"id": invoice_id} if invoice_id else None
    if query is None and invoice["source_key"]:
        query = {"source_key": invoice["source_key"]}
    if query is None and supplier and invoice_number:
        query = {"brand_id": "casa", "supplier": supplier, "invoice_number": invoice_number}
    existing = collection("supplier_invoices").find_one(query or {"id": "__none__"}, {"_id": 0})
    if existing:
        invoice_id = existing["id"]
    else:
        invoice_id = str(uuid4())
    invoice["id"] = invoice_id
    collection("supplier_invoices").update_one(
        {"id": invoice_id},
        {"$set": invoice, "$setOnInsert": {"created_at": now, "created_by": user}},
        upsert=True,
    )
    saved = collection("supplier_invoices").find_one({"id": invoice_id}, {"_id": 0}) or invoice
    return {"invoice": saved}


def register_supplier_payment(data: dict, user: str) -> dict:
    _ensure_storage()
    invoice_id = _clean(data.get("supplier_invoice_id"))
    invoice = collection("supplier_invoices").find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise ValueError("La factura no existe")
    amount = _positive_money(data.get("amount"))
    if amount > float(invoice.get("balance") or 0):
        raise ValueError("El pago supera el saldo pendiente")
    payment = {
        "id": str(uuid4()),
        "brand_id": "casa",
        "supplier_invoice_id": invoice_id,
        "supplier": invoice["supplier"],
        "payment_date": _clean(data.get("payment_date")),
        "amount": amount,
        "currency": _currency(data.get("currency") or invoice.get("currency")),
        "receipt_number": _clean(data.get("receipt_number")),
        "payment_method": _clean(data.get("payment_method")).lower() or "transferencia",
        "bank_reference": _clean(data.get("bank_reference")),
        "notes": _clean(data.get("notes")),
        "created_at": _now(),
        "created_by": user,
    }
    collection("supplier_payments").insert_one(payment)
    paid = round(float(invoice.get("paid_amount") or 0) + amount, 2)
    balance = round(max(0, float(invoice.get("amount") or 0) - paid), 2)
    status = "pagada" if balance == 0 else "parcial"
    updated = collection("supplier_invoices").find_one_and_update(
        {"id": invoice_id},
        {"$set": {"paid_amount": paid, "balance": balance, "status": status, "updated_at": _now(), "updated_by": user}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    payment.pop("_id", None)
    return {"payment": payment, "invoice": updated}


def register_daily_supplier_payment(data: dict, user: str) -> dict:
    result = register_supplier_payment(data, user)
    payment = result["payment"]
    invoice = result["invoice"] or {}
    invoice_number = _clean(invoice.get("invoice_number"))
    description = _clean(data.get("description"))
    if not description:
        description = f"Pago proveedor {invoice.get('supplier', '')}".strip()
        if invoice_number:
            description = f"{description} factura {invoice_number}"
    reference = _clean(data.get("reference")) or _clean(data.get("receipt_number")) or _clean(data.get("bank_reference")) or invoice_number
    movement_result = register_movement({
        "year": data.get("year"),
        "month": data.get("month"),
        "workday_number": data.get("workday_number"),
        "date": data.get("payment_date") or data.get("date"),
        "direction": "expense",
        "category": "proveedores",
        "subcategory": invoice.get("supplier", ""),
        "payment_method": data.get("payment_method"),
        "amount": payment.get("amount"),
        "currency": payment.get("currency"),
        "description": description,
        "reference": reference,
        "source": "supplier_payment",
        "source_key": f"SUPPLIER_PAYMENT:{payment['id']}",
        "supplier_invoice_id": payment.get("supplier_invoice_id"),
    }, user)
    collection("supplier_payments").update_one(
        {"id": payment["id"]},
        {"$set": {"accounting_movement_id": movement_result["movement"]["id"]}},
    )
    payment["accounting_movement_id"] = movement_result["movement"]["id"]
    return {**result, "movement": movement_result["movement"]}


def list_accounting(year: int | None = None, month: int | None = None) -> dict:
    _ensure_storage()
    now = datetime.now()
    year = int(year or now.year)
    month = int(month or now.month)
    movement_query = {"brand_id": "casa", "year": year}
    if month:
        movement_query["month"] = month
    movements = list(collection("accounting_movements").find(movement_query, {"_id": 0}).sort([("year", -1), ("month", -1), ("workday_number", -1), ("created_at", -1)]).limit(500))
    invoices = list(collection("supplier_invoices").find({"brand_id": "casa"}, {"_id": 0}).sort([("status", 1), ("supplier", 1), ("purchase_date", -1)]).limit(500))
    payments = list(collection("supplier_payments").find({"brand_id": "casa"}, {"_id": 0}).sort("created_at", -1).limit(250))
    return {
        "year": year,
        "month": month,
        "movements": movements,
        "supplier_invoices": invoices,
        "supplier_payments": payments,
        "monthly_results": monthly_results(year),
        "annual_result": annual_result(year),
    }


def export_daily_report(report_date: str, cashier: str) -> dict:
    _ensure_storage()
    try:
        selected_date = date.fromisoformat(_clean(report_date))
    except ValueError as exc:
        raise ValueError("Fecha de reporte invalida") from exc

    all_movements = list(collection("accounting_movements").find(
        {"brand_id": "casa", "date": {"$lte": selected_date.isoformat()}},
        {"_id": 0},
    ).sort([("date", 1), ("created_at", 1)]))
    day_movements = [movement for movement in all_movements if movement.get("date") == selected_date.isoformat()]

    def cash_effect(movement: dict) -> float:
        if movement.get("currency") != "UYU" or movement.get("payment_method") != "efectivo":
            return 0.0
        amount = float(movement.get("amount") or 0)
        return -amount if movement.get("direction") == "expense" else amount

    opening_balance = sum(cash_effect(movement) for movement in all_movements if movement.get("date", "") < selected_date.isoformat())
    opening_movements = [movement for movement in day_movements if movement.get("source") == "opening_balance"]
    opening_balance += sum(cash_effect(movement) for movement in opening_movements)
    report_movements = [movement for movement in day_movements if movement.get("source") != "opening_balance"]
    cash_income = sum(cash_effect(movement) for movement in report_movements if cash_effect(movement) > 0)
    cash_expenses = -sum(cash_effect(movement) for movement in report_movements if cash_effect(movement) < 0)
    closing_balance = opening_balance + cash_income - cash_expenses

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Reporte diario"
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A10"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_title_rows = "1:9"
    sheet.oddFooter.center.text = "Pagina &P de &N"
    sheet.oddFooter.right.text = "Firma cajero: ____________________"

    dark_green = "174C45"
    pale_green = "E8F3EF"
    light_gray = "F3F4F6"
    border_color = "D1D5DB"
    thin = Side(style="thin", color=border_color)

    sheet.merge_cells("A1:J1")
    sheet["A1"] = "LA CASA DEL CARPINTERO - REPORTE DIARIO DE CAJA"
    sheet["A1"].font = Font(size=16, bold=True, color="FFFFFF")
    sheet["A1"].fill = PatternFill("solid", fgColor=dark_green)
    sheet["A1"].alignment = Alignment(horizontal="center", vertical="center")
    sheet.row_dimensions[1].height = 30

    sheet["A3"] = "Fecha"
    sheet["B3"] = selected_date
    sheet["B3"].number_format = "dd/mm/yyyy"
    sheet["D3"] = "Cajero"
    sheet.merge_cells("E3:F3")
    sheet["E3"] = _clean(cashier) or "Sin identificar"
    sheet["H3"] = "Emitido"
    sheet.merge_cells("I3:J3")
    sheet["I3"] = _now().astimezone().replace(tzinfo=None)
    sheet["I3"].number_format = "dd/mm/yyyy hh:mm"
    for cell in ("A3", "D3", "H3"):
        sheet[cell].font = Font(bold=True, color=dark_green)

    summary = [
        ("Saldo inicial efectivo", opening_balance),
        ("Entradas efectivo", cash_income),
        ("Salidas efectivo", cash_expenses),
        ("Saldo final efectivo", closing_balance),
    ]
    for index, (label, amount) in enumerate(summary):
        start_col = 1 + index * 2
        label_cell = sheet.cell(row=5, column=start_col, value=label)
        value_cell = sheet.cell(row=6, column=start_col, value=amount)
        sheet.merge_cells(start_row=5, start_column=start_col, end_row=5, end_column=start_col + 1)
        sheet.merge_cells(start_row=6, start_column=start_col, end_row=6, end_column=start_col + 1)
        label_cell.fill = PatternFill("solid", fgColor=pale_green)
        label_cell.font = Font(size=10, bold=True, color=dark_green)
        label_cell.alignment = Alignment(horizontal="center")
        value_cell.font = Font(size=15, bold=True, color=dark_green)
        value_cell.alignment = Alignment(horizontal="center")
        value_cell.number_format = '[$$-es-UY] #,##0.00'
        for row in (5, 6):
            for column in range(start_col, start_col + 2):
                sheet.cell(row=row, column=column).border = Border(top=thin, bottom=thin, left=thin, right=thin)

    headers = ["Hora", "Tipo", "Categoria", "Subcategoria", "Medio", "Descripcion", "Referencia", "Moneda", "Entrada", "Salida"]
    sheet.append([])
    sheet.append(headers)
    header_row = sheet.max_row
    for cell in sheet[header_row]:
        cell.fill = PatternFill("solid", fgColor=dark_green)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    direction_labels = {"income": "Entrada", "expense": "Salida", "transfer": "Transferencia"}
    for movement in report_movements:
        created_at = movement.get("created_at")
        time_value = created_at.astimezone().replace(tzinfo=None) if isinstance(created_at, datetime) else None
        amount = float(movement.get("amount") or 0)
        is_expense = movement.get("direction") == "expense"
        sheet.append([
            time_value,
            direction_labels.get(movement.get("direction"), movement.get("direction", "")),
            movement.get("category", ""),
            movement.get("subcategory", ""),
            movement.get("payment_method", ""),
            movement.get("description", ""),
            movement.get("reference", ""),
            movement.get("currency", "UYU"),
            None if is_expense else amount,
            amount if is_expense else None,
        ])
        row = sheet.max_row
        sheet.cell(row=row, column=1).number_format = "hh:mm"
        sheet.cell(row=row, column=9).number_format = '#,##0.00'
        sheet.cell(row=row, column=10).number_format = '#,##0.00'
        fill = PatternFill("solid", fgColor="FFFFFF" if row % 2 else light_gray)
        for cell in sheet[row]:
            cell.fill = fill
            cell.border = Border(bottom=Side(style="hair", color=border_color))
            cell.alignment = Alignment(vertical="top", wrap_text=cell.column in {4, 6, 7})

    if not report_movements:
        sheet.merge_cells(start_row=header_row + 1, start_column=1, end_row=header_row + 2, end_column=10)
        empty_cell = sheet.cell(row=header_row + 1, column=1, value="Sin movimientos operativos registrados para esta fecha.")
        empty_cell.alignment = Alignment(horizontal="center", vertical="center")
        empty_cell.font = Font(italic=True, color="6B7280")

    totals_row = max(sheet.max_row + 2, header_row + 4)
    sheet.merge_cells(start_row=totals_row, start_column=1, end_row=totals_row, end_column=8)
    sheet.cell(row=totals_row, column=1, value="TOTALES DEL DIA").font = Font(bold=True, color=dark_green)
    income_rows = [float(m.get("amount") or 0) for m in report_movements if m.get("direction") != "expense" and m.get("currency") == "UYU"]
    expense_rows = [float(m.get("amount") or 0) for m in report_movements if m.get("direction") == "expense" and m.get("currency") == "UYU"]
    sheet.cell(row=totals_row, column=9, value=sum(income_rows)).number_format = '#,##0.00'
    sheet.cell(row=totals_row, column=10, value=sum(expense_rows)).number_format = '#,##0.00'
    for cell in sheet[totals_row]:
        cell.fill = PatternFill("solid", fgColor=pale_green)
        cell.font = Font(bold=True, color=dark_green)
        cell.border = Border(top=Side(style="medium", color=dark_green))

    signature_row = totals_row + 4
    sheet.merge_cells(start_row=signature_row, start_column=1, end_row=signature_row, end_column=4)
    sheet.merge_cells(start_row=signature_row, start_column=7, end_row=signature_row, end_column=10)
    sheet.cell(row=signature_row, column=1, value="Firma del cajero: __________________________________")
    sheet.cell(row=signature_row, column=7, value="Firma del responsable: ____________________________")
    sheet.cell(row=signature_row + 2, column=1, value="Aclaracion: ______________________________________")
    sheet.cell(row=signature_row + 2, column=7, value="Aclaracion: ______________________________________")

    widths = [10, 14, 18, 18, 16, 34, 22, 10, 15, 15]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[chr(64 + index)].width = width
    sheet.auto_filter.ref = f"A{header_row}:J{max(header_row, totals_row - 2)}"
    sheet.print_area = f"A1:J{signature_row + 3}"

    path = Path(gettempdir()) / f"reporte-caja-{selected_date.isoformat()}-{uuid4().hex[:8]}.xlsx"
    workbook.save(path)
    return {"excel_path": str(path), "filename": f"reporte-caja-{selected_date.isoformat()}.xlsx"}


def monthly_results(year: int) -> list[dict]:
    _ensure_storage()
    rows: list[dict] = []
    for month in range(1, 13):
        movements = list(collection("accounting_movements").find({"brand_id": "casa", "year": year, "month": month}, {"_id": 0}))
        income = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "income")
        expenses = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "expense")
        card_sales = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "income" and m.get("payment_method") in {"visa", "master", "maestro"})
        credit_sales = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "income" and m.get("category") == "factura_credito")
        cash_sales = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "income" and m.get("payment_method") == "efectivo")
        supplier_costs = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "expense" and m.get("category") in {"proveedores", "costo_venta"})
        payroll = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "expense" and m.get("category") == "sueldos")
        fixed_costs = sum(float(m.get("amount") or 0) for m in movements if m.get("direction") == "expense" and m.get("category") in {"impuestos", "servicios", "costos_fijos"})
        rows.append({
            "year": year,
            "month": month,
            "gross_sales": round(income, 2),
            "cash_sales": round(cash_sales, 2),
            "card_sales": round(card_sales, 2),
            "credit_sales": round(credit_sales, 2),
            "fixed_costs": round(fixed_costs, 2),
            "payroll": round(payroll, 2),
            "supplier_costs": round(supplier_costs, 2),
            "total_costs": round(expenses, 2),
            "operating_result": round(income - expenses, 2),
            "movement_count": len(movements),
        })
    return rows


def annual_result(year: int) -> dict:
    rows = monthly_results(year)
    keys = ["gross_sales", "cash_sales", "card_sales", "credit_sales", "fixed_costs", "payroll", "supplier_costs", "total_costs", "operating_result"]
    return {"year": year, **{key: round(sum(float(row[key]) for row in rows), 2) for key in keys}}
