"""Centralised Google service-account credential loading.

Production hosts (Railway, Docker) don't ship the JSON file, so we accept the
credentials inline via `GOOGLE_SERVICE_ACCOUNT_JSON` and fall back to the file
path `GOOGLE_SERVICE_ACCOUNT_FILE` for local dev.
"""
from __future__ import annotations

import json
import os

from google.oauth2.service_account import Credentials

DEFAULT_SA_FILE = "secrets/google/google-service.json"


def load_credentials(scopes: list[str]) -> Credentials:
    """Build a Google Credentials object using whichever source is configured.

    Order of resolution:
    1. `GOOGLE_SERVICE_ACCOUNT_JSON` env var with the JSON content as a string.
    2. `GOOGLE_SERVICE_ACCOUNT_FILE` env var with a path (default: secrets/google/google-service.json).

    Raises whatever the underlying loader raises if both are missing/invalid —
    we don't catch silently because no Sheets means broken pricing.
    """
    inline = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if inline:
        info = json.loads(inline)
        return Credentials.from_service_account_info(info, scopes=scopes)
    sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", DEFAULT_SA_FILE)
    return Credentials.from_service_account_file(sa_file, scopes=scopes)
