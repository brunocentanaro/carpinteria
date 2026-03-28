from __future__ import annotations

import base64
import json
import os

from openai import OpenAI

from carpinteria.prompts import IMAGE_ANALYSIS
from carpinteria.schemas import CutPiece, ImageAnalysisResult

VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1")
_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def analyze_cutting_plan(image_path: str) -> list[ImageAnalysisResult]:
    b64 = _encode_image(image_path)

    content = [
        {"type": "text", "text": IMAGE_ANALYSIS},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]

    client = _get_client()
    response = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

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
