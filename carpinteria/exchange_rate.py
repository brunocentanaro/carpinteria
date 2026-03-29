from __future__ import annotations

import re
from datetime import date, timedelta

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BCU_URL = "https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones"
USD_CODE = "2225"


def fetch_bcu_usd() -> tuple[float, str]:
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

    r = requests.post(
        BCU_URL,
        data=soap.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
        timeout=10,
        verify=False,
    )

    matches = list(re.finditer(
        r"<Fecha>(.*?)</Fecha>.*?<TCC>(.*?)</TCC>",
        r.text, re.DOTALL,
    ))

    if not matches:
        raise RuntimeError("No se pudo obtener TC del BCU")

    last = matches[-1]
    fecha = last.group(1)
    tc = float(last.group(2))
    return tc, fecha
