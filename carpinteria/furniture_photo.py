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


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item or "").strip()]


def analyze_furniture_photo(file_paths: list[str], context: str = "") -> dict[str, Any]:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Interpreta fotos, croquis o planos de muebles para cotizar. "
                "Pueden ser planos DIBUJADOS A MANO en papel, a lápiz o lapicera: leé con atención "
                "las cotas manuscritas, las flechas de dimensión y los números junto a cada lado, "
                "aunque el trazo sea tenue o irregular. Extrae SOLO lo que se vea o diga el texto adjunto. "
                "Convierte medidas en cm/m a mm. Si una cota es ambigua o no se entiende la unidad, "
                "NO la adivines: marca needs_clarification=true y detallá la duda en missing_inputs. "
                "Si no esta claro si el mueble es madera maciza o placas/melaminico, NO asumas: "
                "marca needs_clarification=true y agrega la duda a missing_inputs. "
                "Si faltan medidas necesarias para cotizar, tambien pedilas. "
                "Anotá SIEMPRE en 'notes' las medidas y el material/color que interpretaste (ej: "
                "'leí 1200x600x400mm, melamínico gris 18mm') para que el usuario pueda confirmarlas. "
                "Capturá el color/textura si aparece escrito (gris, roble, negro, etc.). "
                "Devolve SOLO JSON con estas claves: name, description, quantity, dimensions, "
                "material, thickness_mm, color, edge_banding, needs_clarification, missing_inputs, notes. "
                "dimensions debe tener width_mm, height_mm y depth_mm, usando null si falta. "
                f"Contexto escrito por el usuario: {context or 'sin contexto'}"
            ),
        }
    ]
    for path in file_paths:
        content.append({
            "type": "image_url",
            "image_url": {"url": _image_data_url(path), "detail": "high"},
        })

    client = _get_client()
    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Sos un cotizador de carpinteria. Mirás imagenes de muebles y pedidos, "
                        "extraés especificaciones, y sos conservador cuando faltan datos."
                    ),
                },
                {"role": "user", "content": content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except Exception as exc:
        raise RuntimeError(friendly_openai_error(exc)) from exc

    raw = json.loads(response.choices[0].message.content or "{}")
    dims = raw.get("dimensions") if isinstance(raw.get("dimensions"), dict) else {}
    missing = _clean_list(raw.get("missing_inputs"))
    dimensions = {
        "width_mm": _as_float(dims.get("width_mm")),
        "height_mm": _as_float(dims.get("height_mm")),
        "depth_mm": _as_float(dims.get("depth_mm")),
    }
    for label, key in (
        ("ancho", "width_mm"),
        ("alto", "height_mm"),
        ("profundidad", "depth_mm"),
    ):
        if dimensions[key] is None and label not in missing:
            missing.append(label)

    material = str(raw.get("material") or "").strip()
    if not material and "material (madera maciza o placa/melaminico)" not in missing:
        missing.append("material (madera maciza o placa/melaminico)")

    return {
        "name": str(raw.get("name") or "mueble a medida").strip(),
        "description": str(raw.get("description") or "").strip(),
        "quantity": int(_as_float(raw.get("quantity")) or 1),
        "dimensions": dimensions,
        "material": material,
        "thickness_mm": _as_float(raw.get("thickness_mm")),
        "color": str(raw.get("color") or "").strip(),
        "edge_banding": str(raw.get("edge_banding") or "").strip(),
        "needs_clarification": bool(raw.get("needs_clarification")) or bool(missing),
        "missing_inputs": missing,
        "notes": str(raw.get("notes") or "").strip(),
    }
