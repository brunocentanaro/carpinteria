from __future__ import annotations

import html
import os
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .db import collection


DEFAULT_BASE_URL = "https://prod9187.ucfe.com.uy/Gestion/"
LIST_PATH = "api/CfeRecibido/GetCfeRecibidoInicial"
XML_PATH = "api/CfeRecibido/GetXMLorAdenda"


class UcfeError(RuntimeError):
    pass


def _parse_token(html_text: str) -> str | None:
    soup = BeautifulSoup(html_text, "html.parser")
    input_tag = soup.find("input", attrs={"name": "__RequestVerificationToken"})
    if input_tag and input_tag.get("value"):
        return str(input_tag["value"])
    match = re.search(r"__RequestVerificationToken['\"]?\s*[:=]\s*['\"]([^'\"]+)", html_text)
    return html.unescape(match.group(1)) if match else None


def _json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError as exc:
        raise UcfeError(f"UCFE no devolvió JSON válido ({response.status_code})") from exc


def _js_escape(value: str) -> str:
    safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@*_+-./"
    return "".join(char if char in safe else f"%{ord(char):02X}" for char in value)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local_name(child.tag) == name:
            return child.text.strip() if child.text else ""
    return None


def parse_cfe_items(xml_text: str) -> list[dict[str, str | None]]:
    root = ET.fromstring(xml_text)
    items: list[dict[str, str | None]] = []
    for item in root.iter():
        if _local_name(item.tag) != "Item":
            continue
        items.append({
            "line_number": _child_text(item, "NroLinDet"),
            "name": _child_text(item, "NomItem"),
            "description": _child_text(item, "DscItem"),
            "quantity": _child_text(item, "Cantidad"),
            "source_unit": _child_text(item, "UniMed"),
            "unit_price": _child_text(item, "PrecioUnitario"),
            "amount": _child_text(item, "MontoItem"),
            "tax_indicator": _child_text(item, "IndFact"),
        })
    return items


def _number(value: object) -> float | None:
    try:
        return round(float(str(value or "").replace(",", ".")), 6)
    except ValueError:
        return None


def _normal(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    return "".join(char for char in text if not unicodedata.combining(char))


class UcfeReceivedClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        self.base_url = base_url if base_url.endswith("/") else f"{base_url}/"
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0", "Accept-Language": "es-UY,es;q=0.9"})
        self.request_token: str | None = None

    def url(self, path: str) -> str:
        return urljoin(self.base_url, path)

    def login_from_environment(self) -> None:
        username = os.environ.get("UCFE_USERNAME", "").strip()
        password = os.environ.get("UCFE_PASSWORD", "")
        if not username or not password:
            raise UcfeError("Faltan UCFE_USERNAME y UCFE_PASSWORD para sincronizar UCFE")
        login_page = self.session.get(self.base_url, timeout=30)
        login_page.raise_for_status()
        token = _parse_token(login_page.text)
        if not token:
            raise UcfeError("No encontré el token de login de UCFE")
        parsed = urlparse(self.base_url)
        response = self.session.post(
            self.base_url,
            data={"__RequestVerificationToken": token, "username": username, "password": _js_escape(password)},
            headers={"Origin": f"{parsed.scheme}://{parsed.netloc}", "Referer": self.base_url},
            timeout=30,
        )
        response.raise_for_status()
        home = self.session.get(self.url("Home/Index"), timeout=30)
        home.raise_for_status()
        if "formularioLogin" in home.text:
            raise UcfeError("UCFE rechazó las credenciales de sincronización")
        self.request_token = _parse_token(home.text) or token

    def _headers(self) -> dict[str, str]:
        if not self.request_token:
            raise UcfeError("La sesión UCFE no fue autenticada")
        return {
            "__requestverificationtoken": self.request_token,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": self.url("Home/Index"),
            "Accept": "application/json, text/javascript, */*; q=0.01",
        }

    def list_page(self, *, start: str, end: str, company_id: str, rows: int, page: int) -> dict[str, Any]:
        params = {
            "_search": "false", "nd": str(int(time.time() * 1000)), "rows": str(rows), "page": str(page),
            "sidx": "Id", "sord": "desc", "tam": str(rows), "Filtro": "5", "TipoCfe": "null",
            "Serie": "", "NumeroDesde": "", "NumeroHasta": "", "IdEmpresa": company_id,
            "FechaComprobanteHasta": "", "FechaComprobanteDesde": "", "FechaAltaHasta": end,
            "FechaAltaDesde": start, "Rut": "", "Anulado": "null", "Estado": "null", "Etiqueta": "",
            "ImporteDesde": "", "ImporteHasta": "", "Orden": "", "CuentaTerceros": "null", "moneda": "",
            "pendienteDePago": "", "proveedorDeuda": "", "tieneRecibo": "", "vencidos": "",
        }
        response = self.session.get(self.url(LIST_PATH), params=params, headers=self._headers(), timeout=60)
        response.raise_for_status()
        data = _json(response)
        if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
            raise UcfeError("Respuesta inesperada listando comprobantes recibidos")
        return data

    def download_xml(self, cfe_id: object) -> str:
        response = self.session.get(self.url(XML_PATH), params={"id": cfe_id, "tipo": "1"}, headers=self._headers(), timeout=60)
        response.raise_for_status()
        xml_text = _json(response)
        if not isinstance(xml_text, str) or "<" not in xml_text:
            raise UcfeError(f"UCFE no devolvió XML para comprobante {cfe_id}")
        return xml_text


def _ensure_storage() -> None:
    collection("ucfe_received_cfe").create_index("ucfe_id", unique=True)
    collection("ucfe_received_cfe").create_index("uuid", unique=True, sparse=True)
    collection("ucfe_received_cfe").create_index([("document_date", -1), ("ucfe_id", -1)])
    collection("ucfe_received_items").create_index("source_key", unique=True)
    collection("ucfe_received_items").create_index([("mapping_status", 1), ("document_date", -1)])
    collection("ucfe_item_mappings").create_index([("supplier_rut", 1), ("normalized_name", 1)], unique=True)


def sync_received(*, start: str, end: str, company_id: str, user: str) -> dict:
    _ensure_storage()
    client = UcfeReceivedClient(os.getenv("UCFE_BASE_URL", DEFAULT_BASE_URL))
    client.login_from_environment()
    rows_per_page = 100
    rows: list[dict[str, Any]] = []
    page = 1
    while True:
        page_data = client.list_page(start=start, end=end, company_id=company_id, rows=rows_per_page, page=page)
        current = list(page_data["rows"])
        rows.extend(current)
        total_pages = int(page_data.get("total") or page)
        if not current or page >= total_pages:
            break
        page += 1

    cfe_created = 0
    items_created = 0
    xml_errors: list[dict[str, str]] = []
    now = datetime.now(timezone.utc)
    for row in rows:
        cfe_id = str(row.get("Id") or "").strip()
        if not cfe_id:
            continue
        cfe = {
            "ucfe_id": cfe_id,
            "company_id": company_id,
            "document_date": row.get("FechaComprobante"),
            "document_type": row.get("TipoCfe"),
            "series_number": row.get("SerieNumero"),
            "supplier_name": row.get("NombreFantasiaRucEmisor"),
            "supplier_rut": str(row.get("RucEmisor") or ""),
            "currency": row.get("TipoMoneda"),
            "total_amount": _number(row.get("MontoTotal")),
            "amount_payable": _number(row.get("MontoTotalAPagar")),
            "raw": row,
            "last_synced_at": now,
            "last_synced_by": user,
        }
        uuid = str(row.get("Uuid") or "").strip()
        if uuid:
            cfe["uuid"] = uuid
        result = collection("ucfe_received_cfe").update_one(
            {"ucfe_id": cfe_id}, {"$set": cfe, "$setOnInsert": {"created_at": now}}, upsert=True,
        )
        cfe_created += int(result.upserted_id is not None)
        try:
            xml_text = client.download_xml(cfe_id)
            collection("ucfe_received_cfe").update_one({"ucfe_id": cfe_id}, {"$set": {"xml": xml_text, "xml_synced_at": now}})
            items = parse_cfe_items(xml_text)
        except UcfeError as exc:
            xml_errors.append({"ucfe_id": cfe_id, "error": str(exc)})
            continue
        for index, item in enumerate(items, start=1):
            line_number = str(item.get("line_number") or index)
            source_key = f"UCFE_RECEIVED:{cfe_id}:{line_number}"
            item_doc = {
                "source_key": source_key,
                "ucfe_id": cfe_id,
                "line_number": line_number,
                "document_date": row.get("FechaComprobante"),
                "supplier_name": row.get("NombreFantasiaRucEmisor"),
                "supplier_rut": str(row.get("RucEmisor") or ""),
                "name": item.get("name") or "",
                "description": item.get("description") or "",
                "quantity": _number(item.get("quantity")),
                "source_unit": item.get("source_unit") or "",
                "unit_price": _number(item.get("unit_price")),
                "amount": _number(item.get("amount")),
                "tax_indicator": item.get("tax_indicator") or "",
                "normalized_name": _normal(item.get("name")),
                "last_synced_at": now,
            }
            mapping = collection("ucfe_item_mappings").find_one(
                {"supplier_rut": item_doc["supplier_rut"], "normalized_name": item_doc["normalized_name"]},
                {"_id": 0},
            )
            initial_mapping = {"mapping_status": "PENDING"}
            if mapping:
                initial_mapping = {
                    "mapping_status": "CONFIRMED",
                    "inventory_product_id": mapping["inventory_product_id"],
                    "target_unit": mapping["target_unit"],
                    "conversion_factor": mapping["conversion_factor"],
                    "mapping_confirmed_at": mapping["updated_at"],
                    "mapping_confirmed_by": mapping["updated_by"],
                }
            item_result = collection("ucfe_received_items").update_one(
                {"source_key": source_key},
                {"$set": item_doc, "$setOnInsert": {**initial_mapping, "created_at": now}},
                upsert=True,
            )
            items_created += int(item_result.upserted_id is not None)
    return {
        "received": len(rows), "cfe_created": cfe_created, "items_created": items_created,
        "xml_errors": xml_errors, "synced_at": now,
    }


def list_received(*, status: str | None = None, limit: int = 100) -> dict:
    _ensure_storage()
    item_query = {"mapping_status": status.upper()} if status else {}
    items = list(collection("ucfe_received_items").find(item_query, {"_id": 0}).sort("document_date", -1).limit(max(1, min(limit, 500))))
    cfes = list(collection("ucfe_received_cfe").find({}, {"_id": 0, "xml": 0}).sort("document_date", -1).limit(max(1, min(limit, 500))))
    return {"cfes": cfes, "items": items}


def confirm_item_mapping(*, source_key: str, inventory_product_id: str, conversion_factor: object, user: str) -> dict:
    _ensure_storage()
    item = collection("ucfe_received_items").find_one({"source_key": source_key}, {"_id": 0})
    if item is None:
        raise ValueError("La línea UCFE no existe")
    product = collection("inventory_products").find_one({"id": inventory_product_id}, {"_id": 0})
    if product is None:
        raise ValueError("El producto de inventario no existe")
    factor = _number(conversion_factor)
    if factor is None or factor <= 0:
        raise ValueError("El factor de conversión debe ser mayor a cero")
    now = datetime.now(timezone.utc)
    mapping = {
        "supplier_rut": item["supplier_rut"],
        "normalized_name": item["normalized_name"],
        "inventory_product_id": inventory_product_id,
        "target_unit": product["unit"],
        "conversion_factor": factor,
        "source_unit": item.get("source_unit", ""),
        "updated_at": now,
        "updated_by": user,
    }
    collection("ucfe_item_mappings").update_one(
        {"supplier_rut": mapping["supplier_rut"], "normalized_name": mapping["normalized_name"]},
        {"$set": mapping, "$setOnInsert": {"created_at": now, "created_by": user}},
        upsert=True,
    )
    update = {
        "mapping_status": "CONFIRMED",
        "inventory_product_id": inventory_product_id,
        "target_unit": product["unit"],
        "conversion_factor": factor,
        "mapping_confirmed_at": now,
        "mapping_confirmed_by": user,
    }
    result = collection("ucfe_received_items").update_many(
        {"supplier_rut": mapping["supplier_rut"], "normalized_name": mapping["normalized_name"], "mapping_status": "PENDING"},
        {"$set": update},
    )
    collection("ucfe_received_items").update_one({"source_key": source_key}, {"$set": update})
    return {"mapping": mapping, "mapped_items": result.modified_count}


def ignore_item(*, source_key: str, user: str, note: str = "") -> dict:
    _ensure_storage()
    result = collection("ucfe_received_items").find_one_and_update(
        {"source_key": source_key},
        {"$set": {"mapping_status": "IGNORED", "ignored_at": datetime.now(timezone.utc), "ignored_by": user, "ignore_note": note}},
        return_document=True,
    )
    if result is None:
        raise ValueError("La línea UCFE no existe")
    result.pop("_id", None)
    return {"item": result}
