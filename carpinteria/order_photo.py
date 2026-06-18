from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from typing import Any

from openai import OpenAI

from carpinteria.openai_errors import friendly_openai_error
from carpinteria.settings import VISION_MODEL

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _image_data_url(path: str) -> str:
    p = Path(path)
    mime = mimetypes.guess_type(p.name)[0] or "image/jpeg"
    data = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def analyze_order_photo(file_paths: list[str]) -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Extrae datos de fotos de una orden/papel de carpinteria. "
                "Devolve SOLO JSON con estas claves: order_number, client_name, "
                "client_phone, order_summary, payment_status, deposit_amount, "
                "final_payment_amount, payment_notes. payment_status debe ser "
                "unknown, none, deposit o paid. Usa null para montos desconocidos. "
                "No inventes datos ilegibles."
            ),
        }
    ]
    for path in file_paths:
        content.append({
            "type": "image_url",
            "image_url": {"url": _image_data_url(path)},
        })

    client = _get_client()
    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Sos un extractor OCR cuidadoso para papeles internos de una carpinteria.",
                },
                {"role": "user", "content": content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except Exception as exc:
        raise RuntimeError(friendly_openai_error(exc)) from exc

    raw = json.loads(response.choices[0].message.content or "{}")
    status = str(raw.get("payment_status") or "unknown").strip().lower()
    if status not in {"unknown", "none", "deposit", "paid"}:
        status = "unknown"
    return {
        "order_number": str(raw.get("order_number") or "").strip(),
        "client_name": str(raw.get("client_name") or "").strip(),
        "client_phone": str(raw.get("client_phone") or "").strip(),
        "order_summary": str(raw.get("order_summary") or "").strip(),
        "payment_status": status,
        "deposit_amount": raw.get("deposit_amount"),
        "final_payment_amount": raw.get("final_payment_amount"),
        "payment_notes": str(raw.get("payment_notes") or "").strip(),
    }
