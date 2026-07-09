#!/usr/bin/env python
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from ucfe_ventas_articulo import UcfeClient, UcfeError, parse_token, response_json


LIST_PATH = "api/CfeRecibido/GetCfeRecibidoInicial"
PDF_PATH = "PDF/GetPdfCFERecibido"
XML_PATH = "api/CfeRecibido/GetXMLorAdenda"


def normalize_ui_date(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", value):
        return value
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        year, month, day = value.split("-")
        return f"{day}/{month}/{year}"
    raise argparse.ArgumentTypeError("Usá fecha DD/MM/YYYY o YYYY-MM-DD.")


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", value).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:120] or "cfe"


def strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if strip_ns(child.tag) == name:
            return child.text.strip() if child.text else ""
    return None


def find_all_by_local_name(root: ET.Element, name: str) -> list[ET.Element]:
    return [element for element in root.iter() if strip_ns(element.tag) == name]


def cfe_type_name(tipo: Any, cobranza: Any = None) -> str:
    if cobranza is True:
        return "e-Factura cobranza"
    return {
        101: "e-Ticket",
        102: "Nota de credito e-Ticket",
        103: "Nota de debito e-Ticket",
        111: "e-Factura",
        112: "Nota de credito e-Factura",
        113: "Nota de debito e-Factura",
        121: "e-Factura exportacion",
        122: "Nota de credito exportacion",
        123: "Nota de debito exportacion",
        181: "e-Remito",
        182: "e-Resguardo",
    }.get(int(tipo) if str(tipo).isdigit() else tipo, str(tipo))


def invoice_label(row: dict[str, Any]) -> str:
    fecha = str(row.get("FechaComprobante") or "")[:10].replace("-", "")
    tipo = cfe_type_name(row.get("TipoCfe"), row.get("Cobranza"))
    serie_numero = str(row.get("SerieNumero") or f"{row.get('Serie', '')}-{row.get('Numero', '')}")
    proveedor = safe_filename(str(row.get("NombreFantasiaRucEmisor") or row.get("RucEmisor") or "proveedor"))
    return safe_filename(f"{fecha}_{tipo}_{serie_numero}_{proveedor}_{row.get('Id')}")


def parse_cfe_items(xml_text: str) -> list[dict[str, str | None]]:
    root = ET.fromstring(xml_text)
    items = []
    for item in find_all_by_local_name(root, "Item"):
        items.append(
            {
                "NroLinDet": child_text(item, "NroLinDet"),
                "NomItem": child_text(item, "NomItem"),
                "DscItem": child_text(item, "DscItem"),
                "Cantidad": child_text(item, "Cantidad"),
                "UniMed": child_text(item, "UniMed"),
                "PrecioUnitario": child_text(item, "PrecioUnitario"),
                "MontoItem": child_text(item, "MontoItem"),
                "IndFact": child_text(item, "IndFact"),
            }
        )
    return items


class UcfeRecibidosClient(UcfeClient):
    def get_recibidos_page_token(self) -> str:
        cached = getattr(self, "_recibidos_page_token", None)
        if cached:
            return cached
        response = self.session.get(self.url("Pages/CFERecibidos"), headers=self.ajax_headers(), timeout=60)
        response.raise_for_status()
        token = parse_token(response.text)
        if not token:
            raise UcfeError("No encontré __RequestVerificationToken en Pages/CFERecibidos.")
        self._recibidos_page_token = token
        return token

    def list_recibidos(
        self,
        fecha_alta_desde: str,
        fecha_alta_hasta: str,
        id_empresa: str,
        rows: int,
        page: int,
        tipo_cfe: str = "null",
        rut: str = "",
    ) -> dict[str, Any]:
        params = {
            "_search": "false",
            "nd": str(int(time.time() * 1000)),
            "rows": str(rows),
            "page": str(page),
            "sidx": "Id",
            "sord": "desc",
            "tam": str(rows),
            "Filtro": "5",
            "TipoCfe": tipo_cfe,
            "Serie": "",
            "NumeroDesde": "",
            "NumeroHasta": "",
            "IdEmpresa": id_empresa,
            "FechaComprobanteHasta": "",
            "FechaComprobanteDesde": "",
            "FechaAltaHasta": fecha_alta_hasta,
            "FechaAltaDesde": fecha_alta_desde,
            "Rut": rut,
            "Anulado": "null",
            "Estado": "null",
            "Etiqueta": "",
            "ImporteDesde": "",
            "ImporteHasta": "",
            "Orden": "",
            "CuentaTerceros": "null",
            "moneda": "",
            "pendienteDePago": "",
            "proveedorDeuda": "",
            "tieneRecibo": "",
            "vencidos": "",
        }
        response = self.session.get(self.url(LIST_PATH), params=params, headers=self.ajax_headers(), timeout=60)
        response.raise_for_status()
        data = response_json(response)
        if not isinstance(data, dict) or "rows" not in data:
            raise UcfeError(f"Respuesta inesperada listando recibidos: {data!r}")
        return data

    def download_pdf(self, row: dict[str, Any], output_dir: Path, request_token: str | None = None) -> Path:
        token = request_token or self.get_recibidos_page_token()
        response = self.session.get(
            self.url(PDF_PATH),
            params={
                "id": row["Id"],
                "formato": "EstandarRep",
                "adenda": "false",
                "codigo": "false",
                "__RequestVerificationToken": token,
            },
            headers=self.ajax_headers(accept="application/pdf,*/*"),
            timeout=120,
        )
        response.raise_for_status()
        if not response.content.startswith(b"%PDF"):
            raise UcfeError(
                f"UCFE no devolvió PDF para id={row['Id']}. "
                f"Content-Type={response.headers.get('content-type')}, primeros bytes={response.content[:120]!r}"
            )
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"{invoice_label(row)}.pdf"
        path.write_bytes(response.content)
        return path

    def download_xml(self, row: dict[str, Any], output_dir: Path) -> Path:
        response = self.session.get(
            self.url(XML_PATH),
            params={"id": row["Id"], "tipo": "1"},
            headers=self.ajax_headers(),
            timeout=60,
        )
        response.raise_for_status()
        xml_text = response_json(response)
        if not isinstance(xml_text, str) or "<" not in xml_text:
            raise UcfeError(f"UCFE no devolvió XML para id={row['Id']}: {xml_text!r}")
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"{invoice_label(row)}.xml"
        path.write_text(xml_text, encoding="utf-8")
        return path


def summarize_rows(rows: list[dict[str, Any]]) -> None:
    print(f"Recibidos: {len(rows)}")
    for row in rows:
        fecha = str(row.get("FechaComprobante") or "")[:10]
        tipo = cfe_type_name(row.get("TipoCfe"), row.get("Cobranza"))
        monto = row.get("MontoTotalAPagar")
        if monto is None:
            monto = row.get("MontoTotal")
        moneda = row.get("TipoMoneda") or ""
        pendiente = row.get("MontoPendiente")
        print(
            f"{row.get('Id')} | {fecha} | {tipo} | {row.get('SerieNumero')} | "
            f"{row.get('NombreFantasiaRucEmisor')} | {moneda} {monto} | pendiente={pendiente}"
        )


def write_summary_csv(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "Id",
        "FechaComprobante",
        "Tipo",
        "TipoCfe",
        "SerieNumero",
        "NombreFantasiaRucEmisor",
        "RucEmisor",
        "TipoMoneda",
        "MontoTotal",
        "MontoTotalAPagar",
        "MontoPendiente",
        "DescripcionMontoPendiente",
        "Cobranza",
        "FormaPago",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    **{field: row.get(field) for field in fields},
                    "Tipo": cfe_type_name(row.get("TipoCfe"), row.get("Cobranza")),
                }
            )


def write_items_csv(items_by_invoice: list[tuple[dict[str, Any], list[dict[str, str | None]]]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "Id",
        "FechaComprobante",
        "Tipo",
        "SerieNumero",
        "Proveedor",
        "RucEmisor",
        "Linea",
        "Concepto",
        "Descripcion",
        "Cantidad",
        "Unidad",
        "PrecioUnitario",
        "MontoItem",
        "IndFact",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for row, items in items_by_invoice:
            for item in items:
                writer.writerow(
                    {
                        "Id": row.get("Id"),
                        "FechaComprobante": row.get("FechaComprobante"),
                        "Tipo": cfe_type_name(row.get("TipoCfe"), row.get("Cobranza")),
                        "SerieNumero": row.get("SerieNumero"),
                        "Proveedor": row.get("NombreFantasiaRucEmisor"),
                        "RucEmisor": row.get("RucEmisor"),
                        "Linea": item.get("NroLinDet"),
                        "Concepto": item.get("NomItem"),
                        "Descripcion": item.get("DscItem"),
                        "Cantidad": item.get("Cantidad"),
                        "Unidad": item.get("UniMed"),
                        "PrecioUnitario": item.get("PrecioUnitario"),
                        "MontoItem": item.get("MontoItem"),
                        "IndFact": item.get("IndFact"),
                    }
                )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lista y descarga CFE recibidos desde UCFE.")
    parser.add_argument("--base-url", default=os.getenv("UCFE_BASE_URL", "https://prod9187.ucfe.com.uy/Gestion/"))
    parser.add_argument("--fecha-alta-desde", required=True, type=normalize_ui_date)
    parser.add_argument("--fecha-alta-hasta", required=True, type=normalize_ui_date)
    parser.add_argument("--id-empresa", default=os.getenv("UCFE_ID_EMPRESA", "478"))
    parser.add_argument("--rows", type=int, default=100)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--tipo-cfe", default="null")
    parser.add_argument("--rut", default="")
    parser.add_argument("--output-dir", type=Path, default=Path("reports") / "ucfe" / "recibidos")
    parser.add_argument("--download-pdf", action="store_true")
    parser.add_argument("--download-xml", action="store_true")
    parser.add_argument("--items-csv", action="store_true")
    parser.add_argument("--json", action="store_true", help="Imprime el JSON crudo de UCFE.")
    parser.add_argument("--cookie-header", default=os.getenv("UCFE_COOKIE_HEADER"))
    parser.add_argument("--request-token", default=os.getenv("UCFE_REQUEST_TOKEN"))
    parser.add_argument("--pdf-token", default=os.getenv("UCFE_PDF_TOKEN"))
    parser.add_argument("--username", default=os.getenv("UCFE_USERNAME"))
    parser.add_argument("--password", default=os.getenv("UCFE_PASSWORD"))
    parser.add_argument("--verbose", action="store_true")
    return parser


def main() -> int:
    load_dotenv()
    args = build_parser().parse_args()

    client = UcfeRecibidosClient(args.base_url, verbose=args.verbose)
    if args.cookie_header:
        client.load_browser_session(args.cookie_header, args.request_token)
    else:
        username = args.username or input("Usuario UCFE: ").strip()
        import getpass

        password = args.password or getpass.getpass("Contraseña UCFE: ")
        client.login(username, password)

    data = client.list_recibidos(
        fecha_alta_desde=args.fecha_alta_desde,
        fecha_alta_hasta=args.fecha_alta_hasta,
        id_empresa=args.id_empresa,
        rows=args.rows,
        page=args.page,
        tipo_cfe=args.tipo_cfe,
        rut=args.rut,
    )
    rows = list(data.get("rows") or [])

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        summarize_rows(rows)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    summary_path = args.output_dir / f"recibidos_{args.fecha_alta_desde.replace('/', '')}_{args.fecha_alta_hasta.replace('/', '')}_{stamp}.csv"
    write_summary_csv(rows, summary_path)
    print(f"Resumen CSV: {summary_path}")

    items_by_invoice: list[tuple[dict[str, Any], list[dict[str, str | None]]]] = []
    if args.download_pdf:
        pdf_dir = args.output_dir / "pdf"
        for row in rows:
            path = client.download_pdf(row, pdf_dir, request_token=args.pdf_token)
            print(f"PDF: {path}")

    if args.download_xml or args.items_csv:
        xml_dir = args.output_dir / "xml"
        for row in rows:
            path = client.download_xml(row, xml_dir)
            print(f"XML: {path}")
            if args.items_csv:
                items_by_invoice.append((row, parse_cfe_items(path.read_text(encoding="utf-8"))))

    if args.items_csv:
        items_path = args.output_dir / f"recibidos_items_{args.fecha_alta_desde.replace('/', '')}_{args.fecha_alta_hasta.replace('/', '')}_{stamp}.csv"
        write_items_csv(items_by_invoice, items_path)
        print(f"Items CSV: {items_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UcfeError as exc:
        raise SystemExit(f"Error UCFE: {exc}") from exc
