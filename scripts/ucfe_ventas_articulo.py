#!/usr/bin/env python
from __future__ import annotations

import argparse
import base64
import getpass
import html
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv


DEFAULT_BASE_URL = "https://prod9187.ucfe.com.uy/Gestion/"
EXPORT_PATH = "api/ExportacionExcel/ExportarReporteVentasPorArticulo/"
STATUS_PATH = "api/ExportacionExcel/ConsultarExportacionCfe/"


class UcfeError(RuntimeError):
    pass


def js_escape(value: str) -> str:
    """Equivalent enough to browser escape() for the password submit handler."""
    safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@*_+-./"
    out: list[str] = []
    for char in value:
        if char in safe:
            out.append(char)
            continue
        codepoint = ord(char)
        if codepoint < 256:
            out.append(f"%{codepoint:02X}")
        else:
            out.append(f"%u{codepoint:04X}")
    return "".join(out)


def parse_cookie_header(cookie_header: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for part in cookie_header.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            cookies[name] = value.strip()
    return cookies


def parse_token(html_text: str) -> str | None:
    soup = BeautifulSoup(html_text, "html.parser")
    token_input = soup.find("input", attrs={"name": "__RequestVerificationToken"})
    if token_input and token_input.get("value"):
        return str(token_input["value"])

    match = re.search(r"__RequestVerificationToken['\"]?\s*[:=]\s*['\"]([^'\"]+)", html_text)
    if match:
        return html.unescape(match.group(1))
    return None


def response_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        if not text:
            return None
        raise UcfeError(
            f"La respuesta no es JSON. Status={response.status_code}, "
            f"Content-Type={response.headers.get('content-type')}, primeros bytes={text[:500]!r}"
        ) from None


def looks_like_login_page(html_text: str) -> bool:
    return "id=\"formularioLogin\"" in html_text or "name=\"username\"" in html_text


def find_first_key(data: Any, names: set[str]) -> Any:
    if isinstance(data, dict):
        for key, value in data.items():
            if key.lower() in names and value not in (None, ""):
                return value
        for value in data.values():
            found = find_first_key(value, names)
            if found not in (None, ""):
                return found
    elif isinstance(data, list):
        for value in data:
            found = find_first_key(value, names)
            if found not in (None, ""):
                return found
    return None


def find_export_id(data: Any) -> str:
    names = {
        "idexportacion",
        "idexportacioncfe",
        "id",
        "exportacionid",
        "exportid",
    }
    value = find_first_key(data, names)
    if value in (None, ""):
        raise UcfeError(f"No pude encontrar idExportacion en la respuesta: {json.dumps(data, ensure_ascii=False)[:1000]}")
    return str(value)


def is_ready(data: Any) -> bool:
    if data is None:
        return False
    if isinstance(data, dict) and data.get("_direct_download"):
        return True
    ready_names = {
        "finalizado",
        "finalizada",
        "terminado",
        "terminada",
        "completo",
        "completado",
        "ready",
        "success",
    }
    ready_value = find_first_key(data, ready_names)
    if isinstance(ready_value, bool):
        return ready_value
    if isinstance(ready_value, str):
        return ready_value.strip().lower() in {"true", "1", "si", "sí", "ok", "completed", "complete"}

    status_value = find_first_key(data, {"estado", "status", "state"})
    if isinstance(status_value, str):
        normalized = status_value.strip().lower()
        return normalized in {"finalizado", "finalizada", "terminado", "terminada", "completo", "completado", "ready", "ok"}
    if isinstance(status_value, int):
        return status_value in {3, 100}

    return bool(find_download_candidate(data) or find_base64_file(data))


def find_download_candidate(data: Any) -> str | None:
    names = {
        "url",
        "urlarchivo",
        "urldescarga",
        "downloadurl",
        "archivo",
        "file",
        "filename",
        "nombrearchivo",
        "path",
        "link",
    }
    value = find_first_key(data, names)
    if value in (None, ""):
        return None
    return str(value)


def find_base64_file(data: Any) -> str | None:
    names = {
        "base64",
        "archivo64",
        "filebase64",
        "contenido",
        "content",
        "bytes",
    }
    value = find_first_key(data, names)
    if not isinstance(value, str):
        return None
    compact = value.strip()
    if compact.startswith("data:"):
        _, _, compact = compact.partition(",")
    if len(compact) < 100:
        return None
    return compact


def content_filename(response: requests.Response) -> str | None:
    disposition = response.headers.get("content-disposition", "")
    match = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.I)
    if match:
        return requests.utils.unquote(match.group(1).strip().strip('"'))
    match = re.search(r"filename=\"?([^\";]+)", disposition, re.I)
    if match:
        return match.group(1).strip()
    return None


def extension_from_response(response: requests.Response, fallback: str = ".bin") -> str:
    filename = content_filename(response)
    if filename:
        suffix = Path(filename).suffix
        if suffix:
            return suffix
    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type == "application/pdf":
        return ".pdf"
    if content_type in {
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        return ".xlsx"
    return mimetypes.guess_extension(content_type) or fallback


class UcfeClient:
    def __init__(self, base_url: str, verbose: bool = False) -> None:
        if not base_url.endswith("/"):
            base_url += "/"
        self.base_url = base_url
        self.verbose = verbose
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "es-UY,es;q=0.9,en;q=0.8",
            }
        )
        self.request_token: str | None = None

    def url(self, path: str) -> str:
        return urljoin(self.base_url, path)

    def log(self, message: str) -> None:
        if self.verbose:
            print(message, file=sys.stderr)

    def load_browser_session(self, cookie_header: str, request_token: str | None) -> None:
        self.session.cookies.update(parse_cookie_header(cookie_header))
        self.request_token = request_token
        if not self.request_token:
            self.refresh_request_token()

    def login(self, username: str, password: str) -> None:
        login_response = self.session.get(self.base_url, timeout=30)
        login_response.raise_for_status()
        token = parse_token(login_response.text)
        if not token:
            raise UcfeError("No encontré __RequestVerificationToken en la pantalla de login.")

        payload = {
            "__RequestVerificationToken": token,
            "username": username,
            "password": js_escape(password),
        }
        headers = {
            "Origin": self.origin,
            "Referer": self.base_url,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        response = self.session.post(self.base_url, data=payload, headers=headers, timeout=30, allow_redirects=True)
        response.raise_for_status()

        home = self.session.get(self.url("Home/Index"), timeout=30)
        home.raise_for_status()
        if looks_like_login_page(home.text):
            raise UcfeError("El login no quedó autenticado. Revisá usuario/contraseña o si la cuenta requiere elegir empresa.")

        self.request_token = parse_token(home.text) or token

    @property
    def origin(self) -> str:
        parsed = urlparse(self.base_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    def refresh_request_token(self) -> None:
        response = self.session.get(self.url("Home/Index"), timeout=30)
        response.raise_for_status()
        if looks_like_login_page(response.text):
            raise UcfeError("La sesión no está autenticada o expiró.")
        self.request_token = parse_token(response.text)
        if not self.request_token:
            raise UcfeError("No encontré __RequestVerificationToken en Home/Index.")

    def ajax_headers(self, accept: str = "application/json, text/javascript, */*; q=0.01") -> dict[str, str]:
        if not self.request_token:
            self.refresh_request_token()
        return {
            "__requestverificationtoken": self.request_token or "",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": self.url("Home/Index"),
            "Accept": accept,
        }

    def export_ventas_articulo(
        self,
        fecha_desde: str,
        fecha_hasta: str,
        formato: str,
        sucursal: str,
        terminal: str,
        codigo: str = "",
        nombre: str = "",
        tipo_doc: str = "",
        nro_doc: str = "",
    ) -> Any:
        params = {
            "fechaDesde": fecha_desde,
            "fechaHasta": fecha_hasta,
            "formato": formato,
            "sucursal": sucursal,
            "terminal": terminal,
            "codigo": codigo,
            "nombre": nombre,
            "tipoDoc": tipo_doc,
            "nroDoc": nro_doc,
        }
        response = self.session.get(self.url(EXPORT_PATH), params=params, headers=self.ajax_headers(), timeout=60)
        response.raise_for_status()
        return response_json(response)

    def consult_export(self, export_id: str) -> Any:
        response = self.session.get(
            self.url(STATUS_PATH),
            params={"idExportacion": export_id},
            headers=self.ajax_headers(accept="*/*"),
            timeout=60,
        )
        response.raise_for_status()

        content_type = response.headers.get("content-type", "")
        if (
            "application/pdf" in content_type
            or "spreadsheet" in content_type
            or "application/vnd.ms-excel" in content_type
            or response.headers.get("content-disposition")
        ):
            return {
                "_direct_download": True,
                "_content_type": content_type,
                "_content_disposition": response.headers.get("content-disposition", ""),
                "_body": response.content,
            }
        if "application/json" in content_type or response.text.lstrip().startswith(("{", "[")):
            return response_json(response)
        return {
            "_raw_content_type": content_type,
            "_raw_text": response.text[:1000],
        }

    def download(self, candidate: str, output_dir: Path, filename_prefix: str) -> Path:
        if candidate.startswith("http://") or candidate.startswith("https://"):
            url = candidate
        elif candidate.startswith("/"):
            url = f"{self.origin}{candidate}"
        else:
            url = self.url(candidate)

        response = self.session.get(url, headers=self.ajax_headers(accept="*/*"), timeout=120)
        response.raise_for_status()
        filename = content_filename(response)
        if not filename:
            filename = filename_prefix + extension_from_response(response)
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / filename
        path.write_bytes(response.content)
        return path

    def download_export_result(self, export_id: str, output_dir: Path, filename_prefix: str, formato: str) -> Path:
        if str(formato).strip() == "1":
            candidate = f"ExportCSV/GetExcelCfeProductos/?&idExportacion={quote(export_id)}"
        else:
            candidate = f"PDF/GetPdfProductos/?&idExportacion={quote(export_id)}"
        return self.download(candidate, output_dir, filename_prefix)


def save_direct_download(data: Any, output_dir: Path, filename_prefix: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    content_type = str(data.get("_content_type") or "")
    disposition = str(data.get("_content_disposition") or "")
    fake_response = requests.Response()
    fake_response.headers["content-type"] = content_type
    if disposition:
        fake_response.headers["content-disposition"] = disposition
    filename = content_filename(fake_response) or filename_prefix + extension_from_response(fake_response)
    path = output_dir / filename
    path.write_bytes(data["_body"])
    return path


def save_base64_file(data: Any, output_dir: Path, filename_prefix: str) -> Path | None:
    payload = find_base64_file(data)
    if not payload:
        return None
    output_dir.mkdir(parents=True, exist_ok=True)
    raw = base64.b64decode(payload, validate=False)
    extension = ".pdf" if raw.startswith(b"%PDF") else ".xlsx" if raw.startswith(b"PK\x03\x04") else ".bin"
    path = output_dir / f"{filename_prefix}{extension}"
    path.write_bytes(raw)
    return path


def normalize_date(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value.replace("-", "/")
    if re.fullmatch(r"\d{4}/\d{2}/\d{2}", value):
        return value
    raise argparse.ArgumentTypeError("Usá fecha YYYY/MM/DD o YYYY-MM-DD.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Genera el reporte UCFE de ventas por artículo.")
    parser.add_argument("--base-url", default=os.getenv("UCFE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--fecha-desde", required=True, type=normalize_date)
    parser.add_argument("--fecha-hasta", required=True, type=normalize_date)
    parser.add_argument("--sucursal", default=os.getenv("UCFE_SUCURSAL", "516"))
    parser.add_argument("--terminal", default=os.getenv("UCFE_TERMINAL", "521"))
    parser.add_argument("--formato", default=os.getenv("UCFE_FORMATO", "0 "))
    parser.add_argument("--codigo", default="")
    parser.add_argument("--nombre", default="")
    parser.add_argument("--tipo-doc", default="")
    parser.add_argument("--nro-doc", default="")
    parser.add_argument("--output-dir", type=Path, default=Path("reports") / "ucfe")
    parser.add_argument("--username", default=os.getenv("UCFE_USERNAME"))
    parser.add_argument("--password", default=os.getenv("UCFE_PASSWORD"))
    parser.add_argument("--cookie-header", default=os.getenv("UCFE_COOKIE_HEADER"))
    parser.add_argument("--request-token", default=os.getenv("UCFE_REQUEST_TOKEN"))
    parser.add_argument("--poll-seconds", type=float, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=180)
    parser.add_argument("--verbose", action="store_true")
    return parser


def main() -> int:
    load_dotenv()
    args = build_parser().parse_args()

    client = UcfeClient(args.base_url, verbose=args.verbose)

    if args.cookie_header:
        client.load_browser_session(args.cookie_header, args.request_token)
    else:
        username = args.username or input("Usuario UCFE: ").strip()
        password = args.password or getpass.getpass("Contraseña UCFE: ")
        client.login(username, password)

    print("Sesión autenticada.")

    export_response = client.export_ventas_articulo(
        fecha_desde=args.fecha_desde,
        fecha_hasta=args.fecha_hasta,
        formato=args.formato,
        sucursal=args.sucursal,
        terminal=args.terminal,
        codigo=args.codigo,
        nombre=args.nombre,
        tipo_doc=args.tipo_doc,
        nro_doc=args.nro_doc,
    )
    print("Respuesta de exportación:")
    print(json.dumps(export_response, ensure_ascii=False, indent=2))

    export_id = find_export_id(export_response)
    print(f"idExportacion={export_id}")

    deadline = time.monotonic() + args.timeout_seconds
    last_status: Any = None
    while time.monotonic() < deadline:
        last_status = client.consult_export(export_id)
        print("Estado de exportación:")
        printable_status = dict(last_status) if isinstance(last_status, dict) else last_status
        if isinstance(printable_status, dict) and "_body" in printable_status:
            printable_status = {**printable_status, "_body": f"<{len(printable_status['_body'])} bytes>"}
        print(json.dumps(printable_status, ensure_ascii=False, indent=2))

        if is_ready(last_status):
            break
        time.sleep(args.poll_seconds)
    else:
        raise UcfeError(f"Timeout esperando la exportación {export_id}. Último estado: {last_status!r}")

    safe_from = args.fecha_desde.replace("/", "")
    safe_to = args.fecha_hasta.replace("/", "")
    filename_prefix = f"ventas_articulo_{safe_from}_{safe_to}"
    if isinstance(last_status, dict) and last_status.get("_direct_download"):
        output_path = save_direct_download(last_status, args.output_dir, filename_prefix)
        print(f"Archivo descargado: {output_path}")
        return 0

    base64_path = save_base64_file(last_status, args.output_dir, filename_prefix)
    if base64_path:
        print(f"Archivo descargado: {base64_path}")
        return 0

    candidate = find_download_candidate(last_status)
    if not candidate:
        output_path = client.download_export_result(export_id, args.output_dir, filename_prefix, args.formato)
        print(f"Archivo descargado: {output_path}")
        return 0

    output_path = client.download(candidate, args.output_dir, filename_prefix)
    print(f"Archivo descargado: {output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except requests.HTTPError as exc:
        response = exc.response
        detail = ""
        if response is not None:
            detail = f"\nStatus={response.status_code}\nURL={response.url}\nRespuesta={response.text[:1000]}"
        raise SystemExit(f"Error HTTP: {exc}{detail}") from exc
    except UcfeError as exc:
        raise SystemExit(f"Error UCFE: {exc}") from exc
