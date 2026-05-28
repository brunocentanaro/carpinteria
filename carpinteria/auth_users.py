from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

from carpinteria.db import collection

COLLECTION = "auth_users"
AREAS = {"personal", "administracion"}
BRANDS = {"casa", "pirone"}
RESET_EMAIL_TO = "lacasadelcarpinterosa@gmail.com"
DEFAULT_USERS = [
    {
        "username": "richard",
        "password": "MundoCarpinteroSA.",
        "brand_id": "casa",
        "area": "personal",
        "must_change_password": True,
    },
]


def _coll():
    return collection(COLLECTION)


def ensure_indexes() -> None:
    try:
        _coll().create_index([("brand_id", 1), ("username", 1)], unique=True, background=True)
        _coll().create_index([("brand_id", 1), ("area", 1), ("active", 1)], background=True)
    except Exception:
        pass


def ensure_default_users() -> None:
    ensure_indexes()
    for user in DEFAULT_USERS:
        username = str(user["username"]).strip().lower()
        exists = _coll().find_one({
            "brand_id": user["brand_id"],
            "username": username,
        })
        if exists:
            continue
        salt, password_hash = _hash_password(str(user["password"]))
        now = datetime.now(timezone.utc)
        doc = {
            "id": secrets.token_hex(12),
            "username": username,
            "brand_id": user["brand_id"],
            "area": user["area"],
            "salt": salt,
            "password_hash": password_hash,
            "active": True,
            "all_access": username == "juan pirone",
            "failed_attempts": 0,
            "locked": False,
            "must_change_password": bool(user.get("must_change_password", True)),
            "created_at": now,
            "updated_at": now,
        }
        try:
            _coll().insert_one(doc)
        except Exception:
            pass


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
    ).hex()
    return salt, digest


def _verify_password(password: str, salt: str, password_hash: str) -> bool:
    _, candidate = _hash_password(password, salt)
    return hmac.compare_digest(candidate, password_hash)


def _row(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc.get("id") or doc.get("_id") or ""),
        "username": str(doc.get("username") or ""),
        "brandId": str(doc.get("brand_id") or ""),
        "area": str(doc.get("area") or ""),
        "active": bool(doc.get("active", True)),
        "failed_attempts": int(doc.get("failed_attempts") or 0),
        "locked": bool(doc.get("locked", False)),
        "all_access": bool(doc.get("all_access", False) or str(doc.get("username") or "").lower() == "juan pirone"),
        "must_change_password": bool(doc.get("must_change_password", False)),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def list_users(brand_id: str | None = None) -> list[dict[str, Any]]:
    ensure_default_users()
    q: dict[str, Any] = {}
    if brand_id:
        q["brand_id"] = brand_id
    return [_row(d) for d in _coll().find(q).sort([("brand_id", 1), ("area", 1), ("username", 1)])]


def create_user(
    *,
    username: str,
    password: str,
    brand_id: str,
    area: str,
    must_change_password: bool = True,
) -> dict[str, Any]:
    ensure_indexes()
    username = username.strip().lower()
    if not username:
        raise ValueError("username is required")
    if len(password) < 4:
        raise ValueError("password must have at least 4 characters")
    if brand_id not in BRANDS:
        raise ValueError("invalid brand")
    if area not in AREAS:
        raise ValueError("invalid area")
    salt, password_hash = _hash_password(password)
    now = datetime.now(timezone.utc)
    doc = {
        "id": secrets.token_hex(12),
        "username": username,
        "brand_id": brand_id,
        "area": area,
        "salt": salt,
        "password_hash": password_hash,
        "active": True,
        "all_access": username == "juan pirone",
        "failed_attempts": 0,
        "locked": False,
        "must_change_password": bool(must_change_password),
        "created_at": now,
        "updated_at": now,
    }
    try:
        _coll().insert_one(doc)
    except Exception as e:
        if "duplicate" in str(e).lower():
            raise ValueError("user already exists for this environment") from e
        raise
    return _row(doc)


def set_user_active(user_id: str, active: bool) -> dict[str, Any] | None:
    ensure_indexes()
    _coll().update_one(
        {"id": user_id},
        {"$set": {
            "active": bool(active),
            "locked": False if active else True,
            "failed_attempts": 0 if active else 5,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    doc = _coll().find_one({"id": user_id})
    return _row(doc) if doc else None


def update_password(user_id: str, password: str) -> dict[str, Any] | None:
    ensure_indexes()
    if len(password) < 4:
        raise ValueError("password must have at least 4 characters")
    salt, password_hash = _hash_password(password)
    _coll().update_one(
        {"id": user_id},
        {"$set": {
            "salt": salt,
            "password_hash": password_hash,
            "failed_attempts": 0,
            "locked": False,
            "active": True,
            "must_change_password": False,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    doc = _coll().find_one({"id": user_id})
    return _row(doc) if doc else None


def authenticate(*, username: str, password: str, brand_id: str, area: str) -> dict[str, Any] | None:
    ensure_default_users()
    username = username.strip().lower()
    query = {
        "username": username,
        "brand_id": brand_id,
        "area": area,
        "active": True,
    }
    doc = _coll().find_one(query)
    if doc is None and area == "administracion":
        doc = _coll().find_one({
            "username": username,
            "area": area,
            "active": True,
            "all_access": True,
        })
    if doc:
        if bool(doc.get("locked", False)) or int(doc.get("failed_attempts") or 0) >= 5:
            return None
        if _verify_password(password, str(doc.get("salt") or ""), str(doc.get("password_hash") or "")):
            _coll().update_one(
                {"id": doc["id"]},
                {"$set": {
                    "failed_attempts": 0,
                    "locked": False,
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
            doc = _coll().find_one({"id": doc["id"]}) or doc
            return _row(doc)
        failed_attempts = int(doc.get("failed_attempts") or 0) + 1
        _coll().update_one(
            {"id": doc["id"]},
            {"$set": {
                "failed_attempts": failed_attempts,
                "locked": failed_attempts >= 5,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return None

    # Bootstrap fallback: keeps the app accessible before the first Mongo user
    # exists. Configure these in .env and then create real users from the UI.
    prefix = "CASA_AUTH" if brand_id == "casa" else "PIRONE_AUTH"
    env_user = os.getenv(f"{prefix}_USER", "casa" if brand_id == "casa" else "pirone")
    env_pass = os.getenv(f"{prefix}_PASSWORD", "casa2026" if brand_id == "casa" else "pirone2026")
    if username == env_user and password == env_pass:
        return {
            "id": "bootstrap",
            "username": username,
            "brandId": brand_id,
            "area": area,
            "active": True,
            "failed_attempts": 0,
            "locked": False,
            "all_access": username == "juan pirone",
            "must_change_password": False,
            "bootstrap": True,
        }
    return None


def _send_reset_email(*, username: str, brand_id: str, area: str, code: str) -> bool:
    host = os.getenv("SMTP_HOST", "")
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    sender = os.getenv("SMTP_FROM", user or RESET_EMAIL_TO)
    to_email = os.getenv("RESET_EMAIL_TO", RESET_EMAIL_TO)
    if not host or not user or not password:
        return False

    msg = EmailMessage()
    msg["Subject"] = "Codigo de reseteo - Cotizador Carpinteria"
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(
        "\n".join([
            "Solicitud de reseteo de contrasena.",
            "",
            f"Usuario: {username}",
            f"Empresa: {brand_id}",
            f"Area: {area}",
            f"Codigo: {code}",
            "",
            "El codigo vence en 15 minutos.",
        ])
    )

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)
    return True


def request_password_reset(*, username: str, brand_id: str, area: str) -> dict[str, Any]:
    ensure_indexes()
    username = username.strip().lower()
    doc = _coll().find_one({
        "username": username,
        "brand_id": brand_id,
        "area": area,
        "active": True,
    })
    if doc is None:
        return {"sent": True, "email_to": os.getenv("RESET_EMAIL_TO", RESET_EMAIL_TO), "smtp_configured": True}

    code = f"{secrets.randbelow(1_000_000):06d}"
    salt, code_hash = _hash_password(code)
    _coll().update_one(
        {"id": doc["id"]},
        {"$set": {
            "reset_salt": salt,
            "reset_code_hash": code_hash,
            "reset_expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    email_sent = _send_reset_email(
        username=username,
        brand_id=brand_id,
        area=area,
        code=code,
    )
    return {
        "sent": email_sent,
        "email_to": os.getenv("RESET_EMAIL_TO", RESET_EMAIL_TO),
        "smtp_configured": email_sent,
    }


def reset_password_with_code(
    *,
    username: str,
    brand_id: str,
    area: str,
    code: str,
    password: str,
) -> dict[str, Any] | None:
    ensure_indexes()
    username = username.strip().lower()
    doc = _coll().find_one({
        "username": username,
        "brand_id": brand_id,
        "area": area,
        "active": True,
    })
    if doc is None:
        return None
    expires_at = doc.get("reset_expires_at")
    if not expires_at or expires_at < datetime.now(timezone.utc):
        return None
    if not _verify_password(code, str(doc.get("reset_salt") or ""), str(doc.get("reset_code_hash") or "")):
        return None
    user = update_password(str(doc["id"]), password)
    _coll().update_one(
        {"id": doc["id"]},
        {"$unset": {"reset_salt": "", "reset_code_hash": "", "reset_expires_at": ""}},
    )
    return user
