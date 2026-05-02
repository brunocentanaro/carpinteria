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


# ---------------------------------------------------------------------------
# Chat / sessions
# ---------------------------------------------------------------------------

def handle_session_create(data: dict) -> dict:
    from carpinteria.quotation_session import create_session, ensure_indexes
    ensure_indexes()
    s = create_session(
        user_id=str(data.get("user_id") or "anonymous"),
        title=str(data.get("title") or ""),
    )
    return {"session": s.model_dump(mode="json")}


def handle_session_get(data: dict) -> dict:
    from carpinteria.quotation_session import get_session
    s = get_session(str(data.get("session_id") or ""))
    if s is None:
        return {"error": "session not found"}
    return {"session": s.model_dump(mode="json")}


def handle_session_list(data: dict) -> dict:
    from carpinteria.quotation_session import list_sessions
    rows = list_sessions(
        user_id=data.get("user_id") if data.get("user_id") else None,
        limit=int(data.get("limit") or 30),
    )
    return {"sessions": rows}


def handle_session_ingest_pliego(data: dict) -> dict:
    """Direct ingest: upload + decompose without going through the chat agent."""
    from carpinteria.agents.cotizador_chat import _ingest_pliego_into_session
    from carpinteria.quotation_session import append_message, get_session

    sid = str(data.get("session_id") or "")
    file_paths = list(data.get("file_paths") or [])
    if not sid or not file_paths:
        return {"error": "missing session_id or file_paths"}

    summary = _ingest_pliego_into_session(sid, file_paths)
    # Direct (non-chat) ingest: surface the summary in the conversation so the
    # UI shows it after reload. The chat path handles its own persistence.
    append_message(sid, "assistant", summary)
    s = get_session(sid)
    return {"summary": summary, "session": s.model_dump(mode="json") if s else None}


def _recalc_all_items(session) -> None:
    """Reuse one catalog/TC/hw_prices fetch across every item recalculation.

    Direct-mutation handlers below all need this same boilerplate, so it lives
    here instead of being duplicated.
    """
    from carpinteria.agents.cotizador_chat import _recalculate_item, _hw_prices_map, _tc
    from carpinteria.catalog import ProductCatalog
    catalog = ProductCatalog.from_activa()
    tc = _tc()
    hw_prices = _hw_prices_map()
    for it in session.items:
        try:
            _recalculate_item(it, session, catalog=catalog, tc=tc, hw_prices=hw_prices)
        except Exception:
            pass


def handle_session_update(data: dict) -> dict:
    """Patch session-level fields and recalculate every item.

    Accepts any subset of: color_default, payment_days, destination.
    Empty strings/None clear the field.
    """
    from carpinteria.quotation_session import get_session, save_session
    sid = str(data.get("session_id") or "")
    if not sid:
        return {"error": "missing session_id"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}

    if "color_default" in data:
        s.color_default = str(data.get("color_default") or "")
    if "payment_days" in data:
        v = data.get("payment_days")
        s.payment_days = int(v) if v not in (None, "", 0) else None
    if "destination" in data:
        s.destination = str(data.get("destination") or "")

    _recalc_all_items(s)
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_set_item_placa(data: dict) -> dict:
    """Pin (or unpin) a specific catalog placa SKU on a quotation item."""
    from carpinteria.quotation_session import find_item, get_session, save_session
    sid = str(data.get("session_id") or "")
    code = str(data.get("item_code") or "")
    sku = data.get("placa_sku")  # None to clear
    if not sid or not code:
        return {"error": "missing session_id or item_code"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    it = find_item(s, code)
    if it is None:
        return {"error": f"item {code} not found"}
    it.placa_sku = (str(sku) if sku else None)

    from carpinteria.agents.cotizador_chat import _recalculate_item
    _recalculate_item(it, s)
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_item_update(data: dict) -> dict:
    """Patch one or more fields on a single quotation item, then recalc.

    Whitelist of editable fields: color, material, thickness_mm, quantity, name,
    edge_banding. Other fields (pieces, hardware, last_quote) have dedicated
    handlers because they need stricter typing.
    """
    from carpinteria.agents.cotizador_chat import _recalculate_item
    from carpinteria.quotation_session import find_item, get_session, save_session

    sid = str(data.get("session_id") or "")
    code = str(data.get("item_code") or "")
    if not sid or not code:
        return {"error": "missing session_id or item_code"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    it = find_item(s, code)
    if it is None:
        return {"error": f"item {code} not found"}

    fields = data.get("fields") or {}
    if "color" in fields:
        it.color = str(fields["color"] or "")
    if "material" in fields:
        it.material = str(fields["material"] or "")
    if "thickness_mm" in fields:
        v = fields["thickness_mm"]
        try:
            it.thickness_mm = float(v) if v not in (None, "") else 18.0
        except (TypeError, ValueError):
            return {"error": "thickness_mm must be a number"}
    if "quantity" in fields:
        v = fields["quantity"]
        try:
            it.quantity = max(1, int(v))
        except (TypeError, ValueError):
            return {"error": "quantity must be an integer"}
    if "name" in fields:
        it.name = str(fields["name"] or "")
    if "edge_banding" in fields:
        it.edge_banding = str(fields["edge_banding"] or "")
    if "notes" in fields:
        it.notes = str(fields["notes"] or "")

    _recalculate_item(it, s)
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_item_delete(data: dict) -> dict:
    from carpinteria.quotation_session import get_session, save_session

    sid = str(data.get("session_id") or "")
    code = str(data.get("item_code") or "")
    if not sid or not code:
        return {"error": "missing session_id or item_code"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    before = len(s.items)
    s.items = [it for it in s.items if it.code.lower() != code.lower()]
    if len(s.items) == before:
        return {"error": f"item {code} not found"}
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_piece_set_quantity(data: dict) -> dict:
    """Update one piece's quantity inside an item (matched by label)."""
    from carpinteria.agents.cotizador_chat import _recalculate_item
    from carpinteria.quotation_session import find_item, get_session, save_session

    sid = str(data.get("session_id") or "")
    code = str(data.get("item_code") or "")
    label = str(data.get("piece_label") or "")
    qty_raw = data.get("quantity")
    if not sid or not code or not label or qty_raw is None:
        return {"error": "missing session_id, item_code, piece_label or quantity"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    it = find_item(s, code)
    if it is None:
        return {"error": f"item {code} not found"}
    label_l = label.strip().lower()
    target = next((p for p in it.pieces if p.label.lower() == label_l), None)
    if target is None:
        return {"error": f"piece '{label}' not found"}
    try:
        qty = max(0, int(qty_raw))
    except (TypeError, ValueError):
        return {"error": "quantity must be an integer"}
    if qty == 0:
        it.pieces = [p for p in it.pieces if p is not target]
    else:
        target.quantity = qty
    _recalculate_item(it, s)
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_hardware_set_quantity(data: dict) -> dict:
    """Update one hardware row's quantity inside an item. qty=0 removes it."""
    from carpinteria.agents.cotizador_chat import _recalculate_item
    from carpinteria.hardware_catalog import get_by_code
    from carpinteria.quotation_session import (
        HardwareUsage,
        find_item,
        get_session,
        save_session,
    )

    sid = str(data.get("session_id") or "")
    code = str(data.get("item_code") or "")
    hw_code = str(data.get("hardware_code") or "")
    qty_raw = data.get("quantity")
    if not sid or not code or not hw_code or qty_raw is None:
        return {"error": "missing session_id, item_code, hardware_code or quantity"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    it = find_item(s, code)
    if it is None:
        return {"error": f"item {code} not found"}
    spec = get_by_code(hw_code)
    if spec is None:
        return {"error": f"hardware {hw_code} is not in the curated catalog"}
    try:
        qty = max(0, int(qty_raw))
    except (TypeError, ValueError):
        return {"error": "quantity must be an integer"}

    existing = next((h for h in it.hardware if h.code == spec.code), None)
    if qty == 0:
        it.hardware = [h for h in it.hardware if h.code != spec.code]
    elif existing is None:
        it.hardware.append(
            HardwareUsage(
                code=spec.code,
                name=spec.name,
                category=spec.category,
                unit=spec.unit,
                quantity=qty,
            )
        )
    else:
        existing.quantity = qty
    _recalculate_item(it, s)
    save_session(s)
    return {"session": s.model_dump(mode="json")}


def handle_hardware_catalog_list(_data: dict) -> dict:
    """Return the curated hardware catalog (codes + display names)."""
    from carpinteria.hardware_catalog import CURATED_HARDWARE
    rows = [
        {"code": h.code, "name": h.name, "category": h.category, "unit": h.unit}
        for h in CURATED_HARDWARE
    ]
    rows.sort(key=lambda r: (r["category"], r["name"]))
    return {"hardware": rows}


def _session_to_quotes_payload(session) -> list[dict]:
    """Translate a QuotationSession's items into the legacy `quotes` shape that
    `handle_export_excel` / `handle_export_docx` were originally built for.

    Keeps the export handlers untouched — they pre-date the session model and
    expect items to already be denormalised.
    """
    quotes: list[dict] = []
    for it in session.items:
        last = it.last_quote or {}
        total = float(last.get("total", 0) or 0)
        pending = list(last.get("pending_hardware_codes") or [])
        has_error = total == 0
        # When there's a pending hardware price but the quote otherwise computed,
        # we still want the item rendered (don't mark has_error). The exporters
        # handle missing_inputs vs notes vs has_error independently.
        missing = []
        notes = str(last.get("notes") or "")
        if has_error and notes:
            missing = [notes]

        quotes.append({
            "item_code": it.code,
            "item_name": it.name,
            "item_quantity": it.quantity,
            "has_error": has_error,
            "missing_inputs": missing,
            "notes": notes,
            "pending_hardware_codes": pending,
            "decomposition": {
                "pieces": [p.model_dump() for p in it.pieces],
            },
            "lines": list(last.get("lines") or []),
            "hardware_lines": list(last.get("hardware_lines") or []),
            "material": it.material,
            "color": it.color or session.color_default,
            "thickness_mm": it.thickness_mm,
            "edge_banding": it.edge_banding,
            "subtotal": float(last.get("subtotal", 0) or 0),
            "margin_percent": float(last.get("margin_percent", 0) or 0),
            "margin_amount": float(last.get("margin_amount", 0) or 0),
            "total": total,
            "total_with_hardware": float(last.get("total_with_hardware", 0) or 0),
            "_tc": float(last.get("tc", 40) or 40),
        })
    return quotes


def handle_export_excel_session(data: dict) -> dict:
    from carpinteria.quotation_session import get_session
    sid = str(data.get("session_id") or "")
    if not sid:
        return {"error": "missing session_id"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    return handle_export_excel({"quotes": _session_to_quotes_payload(s)})


def handle_export_docx_session(data: dict) -> dict:
    from carpinteria.quotation_session import get_session
    sid = str(data.get("session_id") or "")
    if not sid:
        return {"error": "missing session_id"}
    s = get_session(sid)
    if s is None:
        return {"error": "session not found"}
    return handle_export_docx({"quotes": _session_to_quotes_payload(s)})


def handle_catalog_list_boards(_data: dict) -> dict:
    """Return all PLACA rows from the Activa catalog with a stable id (sku)
    and a human-readable label, ready to feed a frontend dropdown."""
    from carpinteria.catalog import ProductCatalog
    cat = ProductCatalog.from_activa()
    rows: list[dict] = []
    for p in cat.filter(tipo_producto="PLACA"):
        thickness = f"{p.espesor_mm:.0f}mm" if p.espesor_mm else "?mm"
        size = ""
        if p.ancho_mm and p.largo_mm:
            size = f" {p.largo_mm/1000:.2f}×{p.ancho_mm/1000:.2f}m"
        label = f"{p.material or p.familia} {thickness}{size} — {p.nombre}"
        rows.append({
            "sku": p.sku,
            "label": label,
            "familia": p.familia,
            "material": p.material,
            "espesor_mm": p.espesor_mm,
            "precio_usd": p.precio_usd_simp,
        })
    rows.sort(key=lambda r: (r["familia"] or "", r["espesor_mm"] or 0, r["label"]))
    return {"boards": rows}


def handle_chat(data: dict) -> dict:
    import asyncio
    from carpinteria.agents.cotizador_chat import run_turn

    sid = str(data.get("session_id") or "")
    message = str(data.get("message") or "")
    if not sid or not message:
        return {"error": "missing session_id or message"}

    return asyncio.run(run_turn(sid, message))


# ---------------------------------------------------------------------------
# Memory (cross-session facts)
# ---------------------------------------------------------------------------

def handle_memory_list(_data: dict) -> dict:
    from carpinteria import memory as agent_memory
    agent_memory.ensure_indexes()
    facts = [f.model_dump(mode="json") for f in agent_memory.list_facts()]
    return {"facts": facts}


def handle_memory_add(data: dict) -> dict:
    from carpinteria import memory as agent_memory
    text = str(data.get("text") or "").strip()
    if not text:
        return {"error": "missing text"}
    tags_raw = data.get("tags") or []
    tags = [str(t) for t in tags_raw] if isinstance(tags_raw, list) else []
    fact = agent_memory.add_fact(text, tags)
    return {"fact": fact.model_dump(mode="json")}


def handle_memory_delete(data: dict) -> dict:
    from carpinteria import memory as agent_memory
    fid = str(data.get("id") or "")
    if not fid:
        return {"error": "missing id"}
    deleted = agent_memory.delete_fact(fid)
    return {"deleted": deleted}


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
        elif action == "session_create":
            result = handle_session_create(data)
        elif action == "session_get":
            result = handle_session_get(data)
        elif action == "session_list":
            result = handle_session_list(data)
        elif action == "session_ingest_pliego":
            result = handle_session_ingest_pliego(data)
        elif action == "chat":
            result = handle_chat(data)
        elif action == "memory_list":
            result = handle_memory_list(data)
        elif action == "memory_add":
            result = handle_memory_add(data)
        elif action == "memory_delete":
            result = handle_memory_delete(data)
        elif action == "session_update":
            result = handle_session_update(data)
        elif action == "set_item_placa":
            result = handle_set_item_placa(data)
        elif action == "catalog_list_boards":
            result = handle_catalog_list_boards(data)
        elif action == "item_update":
            result = handle_item_update(data)
        elif action == "item_delete":
            result = handle_item_delete(data)
        elif action == "piece_set_quantity":
            result = handle_piece_set_quantity(data)
        elif action == "hardware_set_quantity":
            result = handle_hardware_set_quantity(data)
        elif action == "hardware_catalog_list":
            result = handle_hardware_catalog_list(data)
        elif action == "export_excel_session":
            result = handle_export_excel_session(data)
        elif action == "export_docx_session":
            result = handle_export_docx_session(data)
        else:
            result = {"error": f"Unknown action: {action}"}
    except Exception as e:
        result = {"error": str(e)}

    json.dump(result, sys.stdout, ensure_ascii=False, default=str)


if __name__ == "__main__":
    main()
