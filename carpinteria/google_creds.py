"""Centralised Google service-account credential loading.

Production hosts (Railway, Docker) don't ship the JSON file, so we accept the
credentials inline via `GOOGLE_SERVICE_ACCOUNT_JSON` and fall back to the file
path `GOOGLE_SERVICE_ACCOUNT_FILE` for local dev.

Pasting a service-account JSON into an env-var panel is fragile: the value gets
truncated, the surrounding quotes get stripped, or the `private_key` newlines
get mangled. To survive all of that, `GOOGLE_SERVICE_ACCOUNT_JSON` accepts
either raw JSON or a base64-encoded JSON blob (recommended for Railway/Docker,
since base64 has no characters that env-var UIs mangle).
"""
from __future__ import annotations

import base64
import binascii
import json
import os

from google.oauth2.service_account import Credentials

DEFAULT_SA_FILE = "secrets/google/google-service.json"


def _parse_inline_credentials(inline: str) -> dict:
    """Turn the `GOOGLE_SERVICE_ACCOUNT_JSON` value into a credentials dict.

    Accepts raw JSON or base64-encoded JSON, and repairs the two things env-var
    panels routinely break: wrapping quotes and `private_key` newlines.
    """
    raw = inline.strip()
    # Some panels wrap the whole value in quotes; drop a single matching pair.
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        raw = raw[1:-1].strip()

    # If it isn't obviously JSON, try base64 (the recommended Railway format).
    if not raw.startswith("{"):
        try:
            decoded = base64.b64decode(raw, validate=True).decode("utf-8")
            if decoded.strip().startswith("{"):
                raw = decoded.strip()
        except (binascii.Error, UnicodeDecodeError, ValueError):
            pass

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "GOOGLE_SERVICE_ACCOUNT_JSON no es JSON valido "
            f"({exc}). Suele pasar cuando el valor quedo cortado o los saltos "
            "de linea del private_key se rompieron al pegarlo. Recomendacion: "
            "guardar el JSON codificado en base64."
        ) from exc

    # When the JSON survives but the private_key arrived with literal "\n"
    # sequences instead of real newlines, the PEM won't parse. Normalise it.
    key = info.get("private_key")
    if isinstance(key, str) and "\\n" in key:
        info["private_key"] = key.replace("\\n", "\n")
    return info


def load_credentials(scopes: list[str]) -> Credentials:
    """Build a Google Credentials object using whichever source is configured.

    Order of resolution:
    1. `GOOGLE_SERVICE_ACCOUNT_JSON` env var with the JSON content (raw or
       base64-encoded) as a string.
    2. `GOOGLE_SERVICE_ACCOUNT_FILE` env var with a path (default: secrets/google/google-service.json).

    Raises whatever the underlying loader raises if both are missing/invalid —
    we don't catch silently because no Sheets means broken pricing.
    """
    inline = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if inline:
        info = _parse_inline_credentials(inline)
        return Credentials.from_service_account_info(info, scopes=scopes)
    sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", DEFAULT_SA_FILE)
    return Credentials.from_service_account_file(sa_file, scopes=scopes)
