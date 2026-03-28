from __future__ import annotations

import os

from agents import ModelSettings

VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1")
AGENT_MODEL = os.getenv("OPENAI_AGENT_MODEL", "gpt-4.1-mini")
MACHINERY_PERCENT = float(os.getenv("MACHINERY_PERCENT", "20"))
WASTE_PERCENT = float(os.getenv("WASTE_PERCENT", "20"))
LABOR_PERCENT = float(os.getenv("LABOR_PERCENT", "40"))
CUTS_PERCENT = float(os.getenv("CUTS_PERCENT", "20"))
CUTS_BASE_MAX = int(os.getenv("CUTS_BASE_MAX", "50"))
PROFIT_PERCENT = float(os.getenv("PROFIT_PERCENT", "60"))

PARTIAL_BOARD_FULL_THRESHOLD = float(os.getenv("PARTIAL_BOARD_FULL_THRESHOLD", "85"))
PARTIAL_BOARD_TIERS: list[tuple[float, float]] = [
    (70, 10),
    (50, 20),
    (30, 30),
    (0, 40),
]

AGENT_MODEL_SETTINGS = ModelSettings(
    temperature=0.3,
)
