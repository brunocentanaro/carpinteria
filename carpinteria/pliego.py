from __future__ import annotations

import json
import os
import subprocess

from openai import OpenAI

from carpinteria.prompts import FURNITURE_DECOMPOSE, PLIEGO_ANALYSIS

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _extract_pdf_text(path: str) -> str:
    result = subprocess.run(
        ["pdftotext", path, "-"],
        capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed: {result.stderr.decode(errors='replace')}")
    return result.stdout.decode("utf-8", errors="replace")


def _extract_xlsx_text(path: str) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(path)
    lines = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        lines.append(f"=== {sheet_name} ===")
        for row in ws.iter_rows(values_only=True):
            vals = [str(c) if c is not None else "" for c in row]
            if any(v.strip() for v in vals):
                lines.append("\t".join(vals))
    return "\n".join(lines)


def analyze_pliego(file_paths: list[str]) -> dict:
    all_text = []
    for path in file_paths:
        low = path.lower()
        if low.endswith(".pdf"):
            all_text.append(_extract_pdf_text(path))
        elif low.endswith(".xlsx") or low.endswith(".xls"):
            all_text.append(_extract_xlsx_text(path))
        else:
            with open(path, encoding="utf-8", errors="replace") as f:
                all_text.append(f.read())

    combined = "\n\n---\n\n".join(all_text)
    if len(combined) > 100_000:
        combined = combined[:100_000]

    client = _get_client()
    model = os.getenv("OPENAI_AGENT_MODEL", "gpt-4.1-mini")

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": PLIEGO_ANALYSIS},
            {"role": "user", "content": combined},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    return json.loads(response.choices[0].message.content or "{}")


def decompose_furniture(item: dict) -> dict:
    client = _get_client()
    model = os.getenv("OPENAI_AGENT_MODEL", "gpt-4.1-mini")

    desc = (
        f"Mueble: {item.get('name', '')}\n"
        f"Código: {item.get('code', '')}\n"
        f"Descripción: {item.get('description', '')}\n"
        f"Dimensiones: {item.get('dimensions', {})}\n"
        f"Material: {item.get('material', '')} {item.get('thickness_mm', 18)}mm\n"
        f"Herrajes mencionados: {item.get('hardware', [])}\n"
        f"Canto: {item.get('edge_banding', '')}"
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": FURNITURE_DECOMPOSE},
            {"role": "user", "content": desc},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    return json.loads(response.choices[0].message.content or "{}")
