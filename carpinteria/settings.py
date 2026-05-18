from __future__ import annotations

import os

from agents import ModelSettings

# Modelos OpenAI hardcodeados a propósito: bump deliberado de modelo en código,
# no via env var de Railway. Cambiarlos acá implica una decisión revisable.
# gpt-5.4-mini es current-gen, multimodal (vision), y barato (~$0.75/$4.50 por
# millón de tokens). Da buena calidad para descomponer pliegos y para el chat
# de cotización sin disparar el costo. Bumpear acá cuando salga gpt-5.5-mini o
# similar y el costo lo justifique.
VISION_MODEL = "gpt-5.4-mini"
AGENT_MODEL = "gpt-5.4-mini"
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

STATE_SURCHARGE_PERCENT = float(os.getenv("STATE_SURCHARGE_PERCENT", "5"))
PAYMENT_DELAY_TIERS: list[tuple[int, float]] = [
    (30, 7),
    (45, 10),
    (60, 12.5),
    (90, 15),
]
PAYMENT_DELAY_MAX_DAYS = 90

AGENT_MODEL_SETTINGS = ModelSettings(
    temperature=0.3,
)
