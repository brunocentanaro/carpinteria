"""Object storage for uploaded images (pliegos, muebles, órdenes) so a quote
can be audited later against the exact photo/plan the employee submitted.

Backed by an S3-compatible bucket. Configured today for Backblaze B2, but the
same code works unchanged against Cloudflare R2 or AWS S3 — only the env vars
change. Storage is *best-effort*: if it isn't configured (or the upload fails),
we log and return None instead of breaking the quoting flow. The image is a
nice-to-have audit artifact, not a prerequisite for producing a quote.

Credentials are hardcoded below (per owner's request: no Railway env vars, so
the non-technical deploy stays a single git push). An env var of the same name
still overrides the constant if ever needed — but none are required.

SECURITY: the applicationKey lives in the repo and its git history. It is scoped
to a single private bucket (least privilege), so exposure is contained. If this
repo is ever made public or shared, ROTATE the key in Backblaze and update it here.
"""
from __future__ import annotations

import mimetypes
import os
import sys
import uuid
from typing import Any

# --- Backblaze B2 (S3-compatible), region us-east-005 -----------------------
_B2_KEY_ID = "005a0cc763edb940000000001"
_B2_APP_KEY = "K005gL+b3I+kg1XFOH97LCjk9fdPOBk"
_B2_BUCKET = "casa-carpintero"
_B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"

_client: Any | None = None
_client_ready = False


def _log(msg: str) -> None:
    # Stream handlers write NDJSON to stdout; keep our logs on stderr so we
    # never corrupt that protocol.
    print(f"[image_store] {msg}", file=sys.stderr, flush=True)


def _config() -> dict[str, str] | None:
    key_id = os.getenv("IMAGE_STORE_KEY_ID") or _B2_KEY_ID
    app_key = os.getenv("IMAGE_STORE_APP_KEY") or _B2_APP_KEY
    bucket = os.getenv("IMAGE_STORE_BUCKET") or _B2_BUCKET
    endpoint = os.getenv("IMAGE_STORE_ENDPOINT") or _B2_ENDPOINT
    if not (key_id and app_key and bucket and endpoint):
        return None
    return {"key_id": key_id, "app_key": app_key, "bucket": bucket, "endpoint": endpoint}


def is_configured() -> bool:
    return _config() is not None


def _get_client():
    global _client, _client_ready
    if _client_ready:
        return _client
    _client_ready = True
    cfg = _config()
    if cfg is None:
        _client = None
        return None
    try:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=cfg["endpoint"],
            aws_access_key_id=cfg["key_id"],
            aws_secret_access_key=cfg["app_key"],
            config=Config(signature_version="s3v4", retries={"max_attempts": 2}),
        )
    except Exception as exc:  # pragma: no cover - depends on env
        _log(f"could not init client: {exc}")
        _client = None
    return _client


def store_file(path: str, *, session_id: str = "") -> dict[str, Any] | None:
    """Upload a local file to the bucket. Returns an attachment dict
    {key, filename, content_type} or None if storage is off / the upload failed."""
    cfg = _config()
    client = _get_client()
    if cfg is None or client is None:
        return None
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        _log(f"could not read {path}: {exc}")
        return None
    filename = os.path.basename(path)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    ext = os.path.splitext(filename)[1].lower()
    prefix = f"sessions/{session_id}/" if session_id else "sessions/misc/"
    key = f"{prefix}{uuid.uuid4().hex}{ext}"
    try:
        client.put_object(
            Bucket=cfg["bucket"],
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except Exception as exc:  # pragma: no cover - depends on env
        _log(f"upload failed for {filename}: {exc}")
        return None
    return {"key": key, "filename": filename, "content_type": content_type}


def presigned_url(key: str, *, expires: int = 3600) -> str | None:
    """A temporary GET URL for viewing a stored image. Buckets are private, so
    this is how the audit UI displays the photo without making the bucket public."""
    cfg = _config()
    client = _get_client()
    if cfg is None or client is None or not key:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": cfg["bucket"], "Key": key},
            ExpiresIn=expires,
        )
    except Exception as exc:  # pragma: no cover - depends on env
        _log(f"presign failed for {key}: {exc}")
        return None
