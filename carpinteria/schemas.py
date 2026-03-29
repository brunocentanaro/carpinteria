from __future__ import annotations

from pydantic import BaseModel, Field


class Board(BaseModel):
    material: str
    thickness_mm: float
    color: str
    width_mm: float
    height_mm: float
    price_usd: float


class EdgeBanding(BaseModel):
    type: str
    color: str
    price_usd_per_meter: float


class CutService(BaseModel):
    description: str
    price_per_cut: float


class ExchangeRate(BaseModel):
    buy: float = 40.0
    sell: float = 38.0


class PriceList(BaseModel):
    boards: list[Board] = Field(default_factory=list)
    edge_bandings: list[EdgeBanding] = Field(default_factory=list)
    cut_services: list[CutService] = Field(default_factory=list)
    exchange_rate: ExchangeRate = Field(default_factory=ExchangeRate)


class CutPiece(BaseModel):
    width_mm: float
    height_mm: float
    quantity: int = 1
    label: str = ""
    edge_sides: list[str] = Field(default_factory=list)


class QuotationLine(BaseModel):
    concept: str
    quantity: float
    unit: str
    unit_price: float
    subtotal: float


class Quotation(BaseModel):
    lines: list[QuotationLine] = Field(default_factory=list)
    subtotal: float = 0.0
    margin_percent: float = 0.0
    margin_amount: float = 0.0
    total: float = 0.0
    notes: str = ""


class HardwareItem(BaseModel):
    code: str
    name: str
    price_uyu: float
    source: str


class HardwareCatalog(BaseModel):
    items: list[HardwareItem] = Field(default_factory=list)


class ShippingQuote(BaseModel):
    description: str
    price: float


class ImageAnalysisResult(BaseModel):
    pieces: list[CutPiece] = Field(default_factory=list)
    board_material: str = ""
    board_thickness_mm: float = 0.0
    board_color: str = ""
    boards_needed: int = 0
    waste_description: str = ""
    notes: str = ""
