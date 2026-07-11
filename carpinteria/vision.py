from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path

from openai import OpenAI

from carpinteria.prompts import IMAGE_ANALYSIS
from carpinteria.openai_errors import friendly_openai_error
from carpinteria.schemas import CutPiece, ImageAnalysisResult
from carpinteria.settings import VISION_MODEL
_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _image_data_url(path: str) -> str:
    # Use the real mime type; a JPEG photo of a plan mislabeled as PNG can be
    # rejected or mishandled by the vision model.
    p = Path(path)
    mime = mimetypes.guess_type(p.name)[0] or "image/jpeg"
    data = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def analyze_cutting_plan(image_path: str) -> list[ImageAnalysisResult]:
    content = [
        {"type": "text", "text": IMAGE_ANALYSIS},
        # detail=high keeps the full resolution so pencil dimension marks and
        # thin lines survive; auto downsampling loses them on hand-drawn plans.
        {"type": "image_url", "image_url": {"url": _image_data_url(image_path), "detail": "high"}},
    ]

    client = _get_client()
    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": content}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
    except Exception as exc:
        raise RuntimeError(friendly_openai_error(exc)) from exc

    raw = json.loads(response.choices[0].message.content or "{}")
    plans = raw.get("plans", [raw] if "pieces" in raw else [])

    results = []
    for plan in plans:
        pieces = []
        for p in plan.get("pieces", []):
            pieces.append(CutPiece(
                width_mm=float(p.get("width_mm", 0)),
                height_mm=float(p.get("height_mm", 0)),
                quantity=int(p.get("quantity", 1)),
                label=str(p.get("label", "")),
                edge_sides=list(p.get("edge_sides", [])),
            ))

        results.append(ImageAnalysisResult(
            pieces=pieces,
            board_material=str(plan.get("board_material", "")),
            board_thickness_mm=float(plan.get("board_thickness_mm", 0)),
            board_color=str(plan.get("board_color", "")),
            boards_needed=int(plan.get("boards_needed", 0)),
            waste_description=str(plan.get("waste_description", "")),
        ))

    return results
