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
MACHINERY_PERCENT = float(os.getenv("MACHINERY_PERCENT", "7"))
WASTE_PERCENT = float(os.getenv("WASTE_PERCENT", "17.5"))
LABOR_PERCENT = float(os.getenv("LABOR_PERCENT", "40"))
CUTS_PER_LABOR_HOUR = float(os.getenv("CUTS_PER_LABOR_HOUR", "8"))
LABOR_DAY_HOURS = float(os.getenv("LABOR_DAY_HOURS", "8"))
LABOR_DAY_PRICE_UYU = float(os.getenv("LABOR_DAY_PRICE_UYU", "2500"))
CUTS_PERCENT = float(os.getenv("CUTS_PERCENT", "20"))
CUTS_BASE_MAX = int(os.getenv("CUTS_BASE_MAX", "50"))
PROFIT_PERCENT = float(os.getenv("PROFIT_PERCENT", "60"))

PARTIAL_BOARD_FULL_THRESHOLD = float(os.getenv("PARTIAL_BOARD_FULL_THRESHOLD", "95"))
PARTIAL_BOARD_AREA_CONTINGENCY_PERCENT = float(os.getenv("PARTIAL_BOARD_AREA_CONTINGENCY_PERCENT", "7.5"))
PARTIAL_BOARD_TIERS: list[tuple[float, float]] = [
    (70, 10),
    (50, 20),
    (30, 30),
    (0, 40),
]

STATE_SURCHARGE_PERCENT = float(os.getenv("STATE_SURCHARGE_PERCENT", "0"))
PAYMENT_DELAY_TIERS: list[tuple[int, float]] = [
    (0, 0),
    (30, 5),
    (45, 8),
    (60, 10),
    (90, 13),
]
PAYMENT_DELAY_MAX_DAYS = 90
DEFAULT_BID_PAYMENT_DAYS = int(os.getenv("DEFAULT_BID_PAYMENT_DAYS", "60"))
DEFAULT_BID_DESTINATION = os.getenv("DEFAULT_BID_DESTINATION", "Montevideo")
MONTEVIDEO_FLETE_UYU = float(os.getenv("MONTEVIDEO_FLETE_UYU", "900"))
SHIPPING_UNLOAD_EMPLOYEES = float(os.getenv("SHIPPING_UNLOAD_EMPLOYEES", "2"))
SHIPPING_UNLOAD_HOURS = float(os.getenv("SHIPPING_UNLOAD_HOURS", "3"))
SHIPPING_UNLOAD_DAY_PRICE_UYU = float(os.getenv("SHIPPING_UNLOAD_DAY_PRICE_UYU", "2500"))

AGENT_MODEL_SETTINGS = ModelSettings(
    temperature=0.3,
)
