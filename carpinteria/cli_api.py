from __future__ import annotations

import json
import sys

from dotenv import load_dotenv

load_dotenv()


def _get_tc() -> tuple[float, str]:
    try:
        from carpinteria.exchange_rate import fetch_bcu_usd
        return fetch_bcu_usd()
    except Exception:
        return 40.0, "fallback"


def handle_prices() -> dict:
    from dataclasses import asdict
    from carpinteria.catalog import ProductCatalog

    catalog = ProductCatalog.from_activa()
    tc, fecha = _get_tc()
    placas = catalog.filter(tipo_producto="PLACA")
    cantos = catalog.filter(tipo_producto="CANTO")
    return {
        "placas": [asdict(p) for p in placas],
        "cantos": [asdict(p) for p in cantos],
        "exchange_rate": {"buy": tc, "sell": tc},
        "tc_source": f"BCU {fecha}",
    }


def handle_quote(data: dict) -> dict:
    from carpinteria.catalog import ProductCatalog
    from carpinteria.calculator import calculate_quotation
    from carpinteria.schemas import CutPiece
    from carpinteria.shipping import FixedShippingProvider

    pieces = [CutPiece(**p) for p in data["pieces"]]
    catalog = ProductCatalog.from_activa()
    tc, _ = _get_tc()

    destination = data.get("destination", "")
    shipping = FixedShippingProvider({"Rivera": 15000}) if destination else None

    payment_days = data.get("payment_days")
    if isinstance(payment_days, int) and payment_days <= 0:
        payment_days = None

    q = calculate_quotation(
        pieces=pieces,
        catalog=catalog,
        tc=tc,
        material=data["material"],
        thickness_mm=float(data["thickness_mm"]),
        color=data["color"],
        boards_needed=data.get("boards_needed") or None,
        edge_banding_name=data.get("edge_banding_name") or None,
        payment_days=payment_days,
        shipping_provider=shipping,
        destination=destination,
    )
    return q.model_dump()


def handle_analyze(data: dict) -> dict:
    from carpinteria.vision import analyze_cutting_plan

    results = analyze_cutting_plan(data["image_path"])
    return {"plans": [r.model_dump() for r in results]}


def handle_analyze_pliego(data: dict) -> dict:
    from carpinteria.pliego import analyze_pliego

    return analyze_pliego(data["file_paths"])


def handle_quote_item(data: dict) -> dict:
    from carpinteria.catalog import ProductCatalog
    from carpinteria.calculator import calculate_quotation
    from carpinteria.hardware_catalog import get_by_code
    from carpinteria.pliego import decompose_furniture
    from carpinteria.schemas import CutPiece
    from carpinteria.shipping import FixedShippingProvider

    item = data["item"]
    missing: list[str] = []

    material = item.get("material", "")
    mat_lower = material.lower()
    if "melam" in mat_lower or "mdf" in mat_lower or "fibro" in mat_lower:
        material = "melamínico"
    if not material:
        missing.append("Material de la placa (ej: melamínico, MDF)")

    thickness = item.get("thickness_mm", 0)
    if not thickness:
        missing.append("Espesor de placa en mm (ej: 18)")

    color = data.get("color", "")
    if not color:
        missing.append("Color de la placa (ej: blanco, gris humo)")

    dims = item.get("dimensions") or {}
    has_dims = dims.get("width_mm") or dims.get("height_mm")
    has_desc = bool(item.get("description"))
    if not has_dims and not has_desc:
        missing.append("Dimensiones del mueble (ancho, alto, profundidad en mm) o descripcion con medidas")

    if missing:
        return {
            "error": f"Faltan datos para cotizar {item.get('code', '?')} ({item.get('name', '?')}):",
            "missing_inputs": missing,
        }

    catalog = ProductCatalog.from_activa()
    tc, tc_fecha = _get_tc()

    placa_match = catalog.find_placa(material, float(thickness), color)
    if placa_match is None:
        available = sorted({
            f"{p.material or p.familia} {(p.espesor_mm or 0):.0f}mm — {p.nombre}"
            for p in catalog.filter(tipo_producto="PLACA")
        })
        return {
            "error": f"No se encontro placa para {item.get('code', '?')}: {material} {thickness}mm color '{color}'",
            "missing_inputs": [
                f"Placa {material} {thickness}mm en color '{color}' no existe en la lista de precios.",
                "Opciones disponibles:",
                *[f"  - {a}" for a in available[:8]],
            ],
        }

    try:
        decomposition = decompose_furniture(item)
    except Exception as e:
        return {
            "error": f"No se pudo descomponer el mueble {item.get('code', '?')}: {e}",
            "missing_inputs": ["Revisa que la descripcion del mueble tenga suficiente detalle (dimensiones, puertas, cajones, etc.)"],
        }

    pieces = [CutPiece(**p) for p in decomposition.get("pieces", [])]
    if not pieces:
        return {
            "error": f"No se pudieron extraer piezas para {item.get('code', '?')}",
            "missing_inputs": ["La IA no pudo descomponer este mueble en piezas. Intenta con una descripcion mas detallada."],
        }

    eb_name = item.get("edge_banding") or None
    canto = catalog.find_canto(eb_name or color)
    warnings: list[str] = []
    if not canto:
        warnings.append(f"No se encontro canto para '{eb_name or color}'. Se cotiza sin canto.")

    destination = data.get("destination", "")
    shipping = FixedShippingProvider({"Rivera": 15000}) if destination else None

    payment_days = data.get("payment_days")
    if isinstance(payment_days, int) and payment_days <= 0:
        payment_days = None

    q = calculate_quotation(
        pieces=pieces,
        catalog=catalog,
        tc=tc,
        material=material,
        thickness_mm=float(thickness),
        color=color,
        edge_banding_name=eb_name,
        payment_days=payment_days,
        shipping_provider=shipping,
        destination=destination,
    )

    # Hardware: agent already chose curated codes; we just attach the
    # user-provided price (if any). Codes without a price stay at 0 and the
    # front shows them as pending input.
    hardware_prices: dict = data.get("hardware_prices") or {}
    hw_lines = []
    pending_hardware: list[dict] = []
    for hw in decomposition.get("hardware", []):
        code = (hw.get("code") or "").strip()
        if not code:
            continue
        spec = get_by_code(code)
        if spec is None:
            warnings.append(f"Herraje fuera de catálogo: {code}")
            continue
        try:
            qty = int(hw.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            continue
        unit_price = float(hardware_prices.get(code, 0) or 0)
        line = {
            "code": spec.code,
            "concept": f"Herraje: {spec.name}",
            "category": spec.category,
            "quantity": qty,
            "unit": spec.unit,
            "unit_price": round(unit_price, 2),
            "subtotal": round(qty * unit_price, 2),
        }
        hw_lines.append(line)
        if unit_price <= 0:
            pending_hardware.append({
                "code": spec.code,
                "name": spec.name,
                "category": spec.category,
                "unit": spec.unit,
                "quantity": qty,
            })

    result = q.model_dump()
    result["_tc"] = tc
    result["_tc_source"] = f"BCU {tc_fecha}"
    result["item_code"] = item.get("code", "")
    result["item_name"] = item.get("name", "")
    result["item_quantity"] = int(item.get("quantity", 1))
    result["decomposition"] = decomposition
    result["hardware_lines"] = hw_lines
    result["pending_hardware"] = pending_hardware
    if warnings:
        result["warnings"] = warnings

    hw_total = sum(h["subtotal"] for h in hw_lines)
    if hw_total > 0:
        result["total"] = round(result["total"] + hw_total, 2)

    return result


def handle_export_excel(data: dict) -> dict:
    import tempfile
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter as cl

    quotes = data.get("quotes", [])
    if not quotes:
        return {"error": "No hay cotizaciones para exportar"}

    wb = openpyxl.Workbook()
    hf = Font(bold=True, size=11)
    hfw = Font(bold=True, color="FFFFFF", size=11)
    hfill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    pfill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
    efill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
    bdr = Border(left=Side(style="thin"), right=Side(style="thin"), top=Side(style="thin"), bottom=Side(style="thin"))
    money = '#,##0.00'
    pct_fmt = '0%'

    def hdr(ws, r, cols):
        for i, t in enumerate(cols, 1):
            c = ws.cell(row=r, column=i, value=t)
            c.font = hfw
            c.fill = hfill
            c.border = bdr

    ws_r = wb.active
    ws_r.title = "Resumen"
    hdr(ws_r, 1, ["Codigo", "Mueble", "Cant", "Precio Unit.", "Total (Cant x Unit)", "Estado"])

    total_refs = []
    for i, q in enumerate(quotes):
        r = i + 2
        code = q.get("item_code", "")
        has_error = q.get("has_error", False)

        ws_r.cell(row=r, column=1, value=code).border = bdr
        ws_r.cell(row=r, column=2, value=q.get("item_name", "")).border = bdr
        ws_r.cell(row=r, column=3, value=q.get("item_quantity", 1)).border = bdr

        if has_error:
            ws_r.cell(row=r, column=4, value=0).border = bdr
            ws_r.cell(row=r, column=5, value=0).border = bdr
            missing = q.get("missing_inputs") or [q.get("notes", "Error")]
            ws_r.cell(row=r, column=6, value="FALTA: " + "; ".join(str(m) for m in missing)).border = bdr
            for c in range(1, 7):
                ws_r.cell(row=r, column=c).fill = efill
        else:
            sheet_name = code[:31]
            ws_r.cell(row=r, column=4).border = bdr
            ws_r.cell(row=r, column=4, value=f"='{sheet_name}'!B3")
            ws_r.cell(row=r, column=4).number_format = money
            ws_r.cell(row=r, column=5, value=f"=C{r}*D{r}").border = bdr
            ws_r.cell(row=r, column=5).number_format = money
            ws_r.cell(row=r, column=6, value="OK").border = bdr
            total_refs.append(f"E{r}")

    tr = len(quotes) + 2
    ws_r.cell(row=tr, column=4, value="TOTAL").font = Font(bold=True, size=13)
    if total_refs:
        ws_r.cell(row=tr, column=5, value=f"={'+'.join(total_refs)}")
    ws_r.cell(row=tr, column=5).font = Font(bold=True, size=13)
    ws_r.cell(row=tr, column=5).number_format = money

    ws_r.column_dimensions["A"].width = 10
    ws_r.column_dimensions["B"].width = 40
    ws_r.column_dimensions["C"].width = 8
    ws_r.column_dimensions["D"].width = 18
    ws_r.column_dimensions["E"].width = 18
    ws_r.column_dimensions["F"].width = 50

    for q in quotes:
        code = q.get("item_code", "?")
        ws = wb.create_sheet(title=code[:31])

        if q.get("has_error"):
            ws.cell(row=1, column=1, value=f"{code} - {q.get('item_name', '')}").font = Font(bold=True, size=14)
            ws.cell(row=2, column=1, value="NO SE PUDO COTIZAR").font = Font(bold=True, size=12, color="FF0000")
            rr = 4
            for m in q.get("missing_inputs") or [q.get("notes", "Error")]:
                ws.cell(row=rr, column=1, value=f"  - {m}")
                rr += 1
            ws.column_dimensions["A"].width = 80
            continue

        # A1: titulo, B1: label parametros
        ws.cell(row=1, column=1, value=f"{code} - {q.get('item_name', '')}").font = Font(bold=True, size=14)

        # Row 2: parametros editables
        ws.cell(row=2, column=1, value="TOTAL UNITARIO →").font = Font(bold=True, size=13)
        # B3 will hold the final total formula, set later
        ws.cell(row=2, column=2).font = Font(bold=True, size=13)
        ws.cell(row=2, column=2).number_format = money

        # Row 4: Parametros
        ws.cell(row=4, column=1, value="PARAMETROS (editalos para recalcular)").font = Font(bold=True, size=11)
        ws.cell(row=4, column=1).fill = pfill
        param_labels = [
            ("A5", "TC (tipo cambio)"), ("A6", "% Cortes base"), ("A7", "Cortes base max"),
            ("A8", "% Mano de obra"), ("A9", "% Maquinaria"), ("A10", "% Merma"),
            ("A11", "% Ganancia"), ("A12", "% Recargo financiero"),
            ("A13", "Flete UYU"),
        ]
        decomp = q.get("decomposition", {})
        pieces = decomp.get("pieces", [])
        n_cuts = sum(p.get("quantity", 1) * 2 for p in pieces)

        from carpinteria.settings import (
            CUTS_PERCENT, CUTS_BASE_MAX, LABOR_PERCENT,
            MACHINERY_PERCENT, WASTE_PERCENT, PROFIT_PERCENT,
        )

        param_vals = {
            "B5": q.get("_tc", 40),
            "B6": CUTS_PERCENT / 100,
            "B7": CUTS_BASE_MAX,
            "B8": LABOR_PERCENT / 100,
            "B9": MACHINERY_PERCENT / 100,
            "B10": WASTE_PERCENT / 100,
            "B11": PROFIT_PERCENT / 100,
            "B12": 0.15,
            "B13": 15000,
        }

        for cell_ref, label in param_labels:
            ws[cell_ref] = label
            ws[cell_ref].font = hf
        for cell_ref, val in param_vals.items():
            ws[cell_ref] = val
            ws[cell_ref].border = bdr
            if "%" in (dict(param_labels).get("A" + cell_ref[1:], "")):
                ws[cell_ref].number_format = pct_fmt
            elif cell_ref in ("B13",):
                ws[cell_ref].number_format = money

        # Row 15: Piezas de placa
        r = 15
        ws.cell(row=r, column=1, value="PIEZAS DE PLACA").font = Font(bold=True, size=11)
        ws.cell(row=r, column=1).fill = pfill
        r += 1
        hdr(ws, r, ["Pieza", "Ancho mm", "Alto mm", "Cant", "Cantos", "Area m2", "Canto metros"])
        r += 1
        piece_start = r
        for p in pieces:
            w = p.get("width_mm", 0)
            h = p.get("height_mm", 0)
            qty = p.get("quantity", 1)
            edges = p.get("edge_sides", [])
            edge_top_bot = sum(1 for s in edges if s in ("top", "bottom"))
            edge_left_right = sum(1 for s in edges if s in ("left", "right"))

            ws.cell(row=r, column=1, value=p.get("label", "")).border = bdr
            ws.cell(row=r, column=2, value=w).border = bdr
            ws.cell(row=r, column=3, value=h).border = bdr
            ws.cell(row=r, column=4, value=qty).border = bdr
            ws.cell(row=r, column=5, value=", ".join(edges) if edges else "sin canto").border = bdr
            ws.cell(row=r, column=6, value=f"=B{r}*C{r}*D{r}/1000000").border = bdr
            ws.cell(row=r, column=6).number_format = '0.0000'
            ws.cell(row=r, column=7, value=f"=(B{r}*{edge_top_bot}+C{r}*{edge_left_right})*D{r}/1000").border = bdr
            ws.cell(row=r, column=7).number_format = '0.00'
            r += 1
        piece_end = r - 1

        ws.cell(row=r, column=5, value="TOTAL").font = hf
        ws.cell(row=r, column=6, value=f"=SUM(F{piece_start}:F{piece_end})")
        ws.cell(row=r, column=6).font = hf
        ws.cell(row=r, column=6).number_format = '0.0000'
        area_total_cell = f"F{r}"
        ws.cell(row=r, column=7, value=f"=SUM(G{piece_start}:G{piece_end})")
        ws.cell(row=r, column=7).font = hf
        ws.cell(row=r, column=7).number_format = '0.00'
        canto_total_cell = f"G{r}"
        r += 2

        # Insumos: placas
        ws.cell(row=r, column=1, value="INSUMOS").font = Font(bold=True, size=11)
        ws.cell(row=r, column=1).fill = pfill
        r += 1
        hdr(ws, r, ["Insumo", "Cantidad", "Unidad", "Precio USD", "Precio UYU (=USD*TC)", "Subtotal UYU"])
        r += 1
        insumo_start = r

        for line in q.get("lines", []):
            concept = line.get("concept", "").lower()
            if "placa" in concept or "canto" in concept:
                ws.cell(row=r, column=1, value=line["concept"]).border = bdr
                ws.cell(row=r, column=2, value=line["quantity"]).border = bdr
                ws.cell(row=r, column=3, value=line["unit"]).border = bdr
                usd_price = line["unit_price"] / param_vals["B5"] if param_vals["B5"] else 0
                ws.cell(row=r, column=4, value=round(usd_price, 4)).border = bdr
                ws.cell(row=r, column=4).number_format = '0.0000'
                ws.cell(row=r, column=5, value=f"=D{r}*B5").border = bdr
                ws.cell(row=r, column=5).number_format = money
                ws.cell(row=r, column=6, value=f"=B{r}*E{r}").border = bdr
                ws.cell(row=r, column=6).number_format = money
                r += 1

        for hw in q.get("hardware_lines", []):
            ws.cell(row=r, column=1, value=hw["concept"]).border = bdr
            ws.cell(row=r, column=2, value=hw["quantity"]).border = bdr
            ws.cell(row=r, column=3, value="unidad").border = bdr
            ws.cell(row=r, column=4, value="").border = bdr
            ws.cell(row=r, column=5, value=hw["unit_price"]).border = bdr
            ws.cell(row=r, column=5).number_format = money
            ws.cell(row=r, column=6, value=f"=B{r}*E{r}").border = bdr
            ws.cell(row=r, column=6).number_format = money
            r += 1
        insumo_end = r - 1

        ws.cell(row=r, column=5, value="TOTAL INSUMOS").font = hf
        ws.cell(row=r, column=6, value=f"=SUM(F{insumo_start}:F{insumo_end})")
        ws.cell(row=r, column=6).font = hf
        ws.cell(row=r, column=6).number_format = money
        insumos_total_cell = f"F{r}"
        r += 2

        # Material subtotal (solo placas+cantos, sin herrajes) para recargos
        placa_canto_rows = []
        for rr2 in range(insumo_start, insumo_end + 1):
            val = ws.cell(row=rr2, column=1).value or ""
            if "placa" in val.lower() or "canto" in val.lower():
                placa_canto_rows.append(f"F{rr2}")
        mat_formula = "+".join(placa_canto_rows) if placa_canto_rows else "0"

        ws.cell(row=r, column=1, value="RECARGOS OPERATIVOS (sobre costo placas+cantos)").font = Font(bold=True, size=11)
        ws.cell(row=r, column=1).fill = pfill
        r += 1
        hdr(ws, r, ["Concepto", "", "", "Porcentaje", "", "Monto UYU"])
        r += 1

        ws.cell(row=r, column=1, value=f"Cortes ({n_cuts} cortes)").border = bdr
        ws.cell(row=r, column=4, value=f"=B6*{n_cuts}/B7").border = bdr
        ws.cell(row=r, column=4).number_format = '0.0%'
        ws.cell(row=r, column=6, value=f"=({mat_formula})*D{r}").border = bdr
        ws.cell(row=r, column=6).number_format = money
        cortes_row = r
        r += 1

        ws.cell(row=r, column=1, value="Mano de obra").border = bdr
        ws.cell(row=r, column=4, value="=B8").border = bdr
        ws.cell(row=r, column=4).number_format = pct_fmt
        ws.cell(row=r, column=6, value=f"=({mat_formula})*D{r}").border = bdr
        ws.cell(row=r, column=6).number_format = money
        mo_row = r
        r += 1

        ws.cell(row=r, column=1, value="Maquinaria").border = bdr
        ws.cell(row=r, column=4, value="=B9").border = bdr
        ws.cell(row=r, column=4).number_format = pct_fmt
        ws.cell(row=r, column=6, value=f"=({mat_formula})*D{r}").border = bdr
        ws.cell(row=r, column=6).number_format = money
        maq_row = r
        r += 1

        ws.cell(row=r, column=1, value="Merma").border = bdr
        ws.cell(row=r, column=4, value="=B10").border = bdr
        ws.cell(row=r, column=4).number_format = pct_fmt
        ws.cell(row=r, column=6, value=f"=({mat_formula})*D{r}").border = bdr
        ws.cell(row=r, column=6).number_format = money
        merma_row = r
        r += 2

        # Subtotal
        ws.cell(row=r, column=5, value="SUBTOTAL").font = hf
        ws.cell(row=r, column=6, value=f"={insumos_total_cell}+F{cortes_row}+F{mo_row}+F{maq_row}+F{merma_row}")
        ws.cell(row=r, column=6).font = hf
        ws.cell(row=r, column=6).number_format = money
        subtotal_cell = f"F{r}"
        r += 1

        ws.cell(row=r, column=5, value="GANANCIA").font = hf
        ws.cell(row=r, column=6, value=f"={subtotal_cell}*B11")
        ws.cell(row=r, column=6).number_format = money
        ganancia_cell = f"F{r}"
        r += 1

        ws.cell(row=r, column=5, value="TOTAL BASE")
        ws.cell(row=r, column=6, value=f"={subtotal_cell}+{ganancia_cell}")
        ws.cell(row=r, column=6).number_format = money
        total_base_cell = f"F{r}"
        r += 1

        ws.cell(row=r, column=5, value="REC. FINANCIERO")
        ws.cell(row=r, column=6, value=f"={total_base_cell}*B12")
        ws.cell(row=r, column=6).number_format = money
        fin_cell = f"F{r}"
        r += 1

        ws.cell(row=r, column=5, value="FLETE")
        ws.cell(row=r, column=6, value="=B13")
        ws.cell(row=r, column=6).number_format = money
        flete_cell = f"F{r}"
        r += 1

        ws.cell(row=r, column=5, value="TOTAL UNITARIO").font = Font(bold=True, size=14)
        ws.cell(row=r, column=6, value=f"={total_base_cell}+{fin_cell}+{flete_cell}")
        ws.cell(row=r, column=6).font = Font(bold=True, size=14)
        ws.cell(row=r, column=6).number_format = money
        total_cell = f"F{r}"

        ws["B2"] = f"={total_cell}"
        ws["B2"].number_format = money
        ws["B3"] = f"={total_cell}"
        ws["B3"].number_format = money

        ws.column_dimensions["A"].width = 55
        ws.column_dimensions["B"].width = 15
        ws.column_dimensions["C"].width = 12
        ws.column_dimensions["D"].width = 15
        ws.column_dimensions["E"].width = 20
        ws.column_dimensions["F"].width = 18
        ws.column_dimensions["G"].width = 15

    fd, path = tempfile.mkstemp(suffix=".xlsx", prefix="cotizacion_")
    wb.save(path)
    return {"excel_path": path}


def handle_export_docx(data: dict) -> dict:
    import subprocess
    import tempfile

    fd_in, json_path = tempfile.mkstemp(suffix=".json", prefix="docx_input_")
    fd_out, docx_path = tempfile.mkstemp(suffix=".docx", prefix="cotizacion_")

    with open(json_path, "w") as f:
        json.dump(data, f, ensure_ascii=False)

    script = os.path.join(os.path.dirname(__file__), "generate_docx.js")
    result = subprocess.run(
        ["node", script, json_path, docx_path],
        capture_output=True, text=True, timeout=30,
    )

    os.unlink(json_path)

    if result.returncode != 0:
        return {"error": f"Error generando Word: {result.stderr}"}

    return {"docx_path": docx_path}


def handle_lista_precios_preview(data: dict) -> dict:
    from dataclasses import asdict
    from carpinteria.lista_precios_parser import parse_pdf
    from carpinteria.lista_precios_sheets import read_activa
    from carpinteria.lista_precios_diff import compute_diff

    pdf_path = data["pdf_path"]
    sheet_id = data.get("sheet_id")
    tc, tc_source = _get_tc()

    items = parse_pdf(pdf_path, tc=tc)
    current_rows = read_activa(sheet_id)
    diff = compute_diff(items, current_rows)

    return {
        "lista": items[0].lista if items else "",
        "periodo": items[0].periodo if items else "",
        "current_lista": diff["current_lista"],
        "current_periodo": diff["current_periodo"],
        "tc": tc,
        "tc_source": f"BCU {tc_source}",
        "summary": diff["summary"],
        "nuevos": diff["nuevos"],
        "removidos": diff["removidos"],
        "cambios": diff["cambios"],
        "items": [asdict(it) for it in items],
    }


def handle_lista_precios_confirm(data: dict) -> dict:
    from carpinteria.lista_precios_sheets import items_from_dicts, write_items

    items = items_from_dicts(data.get("items") or [])
    if not items:
        return {"error": "no items in payload"}
    return write_items(items, sheet_id=data.get("sheet_id"))


def handle_hardware_prices_get(data: dict) -> dict:
    from carpinteria.hardware_prices_sheet import read_all
    rows = read_all(sheet_id=data.get("sheet_id"))
    return {"rows": list(rows.values())}


def handle_hardware_prices_set(data: dict) -> dict:
    from carpinteria.hardware_prices_sheet import upsert_price
    code = (data.get("code") or "").strip()
    if not code:
        return {"error": "missing code"}
    try:
        price = float(data.get("price") or 0)
    except (TypeError, ValueError):
        return {"error": "invalid price"}
    if price < 0:
        return {"error": "price must be >= 0"}
    try:
        row = upsert_price(
            code,
            price,
            updated_by=str(data.get("updated_by") or ""),
            sheet_id=data.get("sheet_id"),
        )
    except ValueError as e:
        return {"error": str(e)}
    return {"row": row}


def main() -> None:
    raw = sys.stdin.read()
    data = json.loads(raw)
    action = data.get("action", "")

    try:
        if action == "prices":
            result = handle_prices()
        elif action == "quote":
            result = handle_quote(data)
        elif action == "analyze":
            result = handle_analyze(data)
        elif action == "analyze_pliego":
            result = handle_analyze_pliego(data)
        elif action == "quote_item":
            result = handle_quote_item(data)
        elif action == "export_excel":
            result = handle_export_excel(data)
        elif action == "export_docx":
            result = handle_export_docx(data)
        elif action == "lista_precios_preview":
            result = handle_lista_precios_preview(data)
        elif action == "lista_precios_confirm":
            result = handle_lista_precios_confirm(data)
        elif action == "hardware_prices_get":
            result = handle_hardware_prices_get(data)
        elif action == "hardware_prices_set":
            result = handle_hardware_prices_set(data)
        else:
            result = {"error": f"Unknown action: {action}"}
    except Exception as e:
        result = {"error": str(e)}

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
