from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BCU_URL = "https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones"
USD_CODE = "2225"
FALLBACK_USD_UYU = 40.0
USD_UYU_COVERAGE = 2.0
CACHE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "bcu_usd.json"
BCU_SOAP_ACTION = "Cotizaaction/AWSBCUCOTIZACIONES.Execute"


def _read_cached_usd() -> tuple[float, str] | None:
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        tc = float(data["tc"])
        source = str(data.get("fecha") or "cache")
        if tc > 0:
            return tc, source
    except Exception:
        return None
    return None


def _write_cached_usd(tc: float, fecha: str) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(
            json.dumps({"tc": tc, "fecha": fecha}, ensure_ascii=True),
            encoding="utf-8",
        )
    except Exception:
        pass


def _with_coverage(tc: float, source: str) -> tuple[float, str]:
    return round(tc + USD_UYU_COVERAGE, 4), f"{source} + cobertura UYU {USD_UYU_COVERAGE:g}"


def _fallback_usd(reason: Exception | None = None) -> tuple[float, str]:
    cached = _read_cached_usd()
    if cached:
        tc, fecha = cached
        return _with_coverage(tc, f"cache {fecha}")

    env_tc = os.getenv("USD_UYU_FALLBACK") or os.getenv("FALLBACK_USD_UYU")
    try:
        if env_tc:
            tc = float(env_tc.replace(",", "."))
            if tc > 0:
                return _with_coverage(tc, "fallback env")
    except ValueError:
        pass

    suffix = f" ({type(reason).__name__})" if reason else ""
    return _with_coverage(FALLBACK_USD_UYU, f"fallback{suffix}")


def fetch_bcu_usd(strict: bool = False) -> tuple[float, str]:
    today = date.today()
    fecha_hasta = today.strftime("%Y-%m-%d")
    fecha_desde = (today - timedelta(days=7)).strftime("%Y-%m-%d")

    soap = f'''<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
   <soapenv:Header/>
   <soapenv:Body>
      <cot:wsbcucotizaciones.Execute>
         <cot:Entrada>
            <cot:Moneda>
               <cot:item>{USD_CODE}</cot:item>
            </cot:Moneda>
            <cot:FechaDesde>{fecha_desde}</cot:FechaDesde>
            <cot:FechaHasta>{fecha_hasta}</cot:FechaHasta>
            <cot:Grupo>0</cot:Grupo>
         </cot:Entrada>
      </cot:wsbcucotizaciones.Execute>
   </soapenv:Body>
</soapenv:Envelope>'''

    try:
        r = requests.post(
            BCU_URL,
            data=soap.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
            timeout=(4, 8),
            verify=False,
        )
        r.raise_for_status()
    except Exception as exc:
        if strict:
            raise
        return _fallback_usd(exc)

    matches = list(re.finditer(
        r"<Fecha>(.*?)</Fecha>.*?<TCC>(.*?)</TCC>",
        r.text, re.DOTALL,
    ))

    if not matches:
        if not strict:
            return _fallback_usd()
        raise RuntimeError("No se pudo obtener TC del BCU")

    last = matches[-1]
    fecha = last.group(1)
    tc = float(last.group(2))
    _write_cached_usd(tc, fecha)
    return _with_coverage(tc, fecha)


def fetch_bcu_accounting_usd(transaction_date: date | str) -> dict:
    """Return the official BCU USD-billete buying rate immediately preceding a transaction.

    Accounting never uses the commercial coverage or a fallback value. Querying a
    calendar window and selecting the latest published observation strictly before
    the transaction date also handles weekends and BCU non-publishing days.
    """
    if isinstance(transaction_date, str):
        transaction_date = date.fromisoformat(transaction_date)
    end_date = transaction_date - timedelta(days=1)
    start_date = end_date - timedelta(days=14)
    soap = f'''<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>
    <cot:Moneda><cot:item>{USD_CODE}</cot:item></cot:Moneda>
    <cot:FechaDesde>{start_date.isoformat()}</cot:FechaDesde>
    <cot:FechaHasta>{end_date.isoformat()}</cot:FechaHasta>
    <cot:Grupo>0</cot:Grupo>
  </cot:Entrada></cot:wsbcucotizaciones.Execute></soapenv:Body>
</soapenv:Envelope>'''
    response = requests.post(
        BCU_URL,
        data=soap.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": BCU_SOAP_ACTION},
        timeout=(5, 15),
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)

    def child_text(element: ET.Element, local_name: str) -> str:
        for child in element.iter():
            if child.tag.rsplit("}", 1)[-1] == local_name:
                return (child.text or "").strip()
        return ""

    observations = []
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "datoscotizaciones.dato":
            continue
        observed_date = date.fromisoformat(child_text(element, "Fecha")[:10])
        rate = float(child_text(element, "TCC"))
        if observed_date < transaction_date and rate > 0:
            observations.append((observed_date, rate))
    if not observations:
        raise RuntimeError(f"BCU no devolvio una cotizacion USD anterior a {transaction_date.isoformat()}")
    observed_date, rate = max(observations, key=lambda item: item[0])
    return {
        "currency": "USD",
        "functional_currency": "UYU",
        "presentation_currency": "UYU",
        "rate": round(rate, 6),
        "rate_date": observed_date.isoformat(),
        "transaction_date": transaction_date.isoformat(),
        "source": "BCU DLS. USA BILLETE TCC",
        "bcu_currency_code": USD_CODE,
    }
