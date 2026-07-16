from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ReturnDocument

from .db import collection


UNITS = {"unidad", "metro", "litro", "placa", "paquete", "kilogramo"}
LOCATIONS = (
    {"code": "FABRICA", "name": "Fábrica"},
    {"code": "CASA", "name": "La Casa del Carpintero"},
)
# COMPRA behaves like AJUSTE_POSITIVO (increments the destination) but tags the
# entry as coming from a purchase invoice (UCFE), for traceability.
MOVEMENT_TYPES = {"SALDO_INICIAL", "TRASLADO", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "COMPRA"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quantity(value: object) -> float:
    try:
        quantity = round(float(value), 6)
    except (TypeError, ValueError) as exc:
        raise ValueError("La cantidad debe ser numérica") from exc
    if quantity <= 0:
        raise ValueError("La cantidad debe ser mayor a cero")
    return quantity


def _clean(value: object) -> str:
    return str(value or "").strip()


def _ensure_storage() -> None:
    collection("inventory_products").create_index("sku", unique=True)
    collection("inventory_locations").create_index("code", unique=True)
    collection("inventory_balances").create_index([("product_id", 1), ("location_code", 1)], unique=True)
    collection("inventory_movements").create_index("id", unique=True)
    collection("inventory_movements").create_index("source_key", unique=True, sparse=True)
    collection("inventory_movements").create_index([("product_id", 1), ("created_at", -1)])
    collection("inventory_settings").create_index("product_id", unique=True)
    now = _now()
    for location in LOCATIONS:
        collection("inventory_locations").update_one(
            {"code": location["code"]},
            {"$setOnInsert": {**location, "active": True, "created_at": now}},
            upsert=True,
        )


def _product(product_id: str) -> dict:
    product = collection("inventory_products").find_one({"id": product_id}, {"_id": 0})
    if product is None:
        raise ValueError("El producto de inventario no existe")
    return product


def _location(code: object) -> str:
    location_code = _clean(code).upper()
    if not location_code:
        raise ValueError("Falta el depósito")
    if collection("inventory_locations").find_one({"code": location_code, "active": True}) is None:
        raise ValueError("El depósito no existe o está inactivo")
    return location_code


def upsert_product(data: dict, user: str) -> dict:
    _ensure_storage()
    product_id = _clean(data.get("id"))
    sku = _clean(data.get("sku")).upper()
    name = _clean(data.get("name"))
    unit = _clean(data.get("unit")).lower()
    if not sku or not name:
        raise ValueError("El producto necesita código y nombre")
    if unit not in UNITS:
        raise ValueError("Unidad de medida inválida")

    existing = collection("inventory_products").find_one({"sku": sku})
    if product_id and existing and existing.get("id") != product_id:
        raise ValueError("El código ya pertenece a otro producto")
    if not product_id:
        product_id = str(existing.get("id")) if existing else str(uuid4())
    now = _now()
    product = {
        "id": product_id,
        "sku": sku,
        "name": name,
        "unit": unit,
        "category": _clean(data.get("category")),
        "active": bool(data.get("active", True)),
        "updated_at": now,
        "updated_by": user,
    }
    collection("inventory_products").update_one(
        {"id": product_id},
        {"$set": product, "$setOnInsert": {"created_at": now, "created_by": user}},
        upsert=True,
    )
    return product


def _increment(product_id: str, location_code: str, quantity: float, user: str) -> None:
    collection("inventory_balances").update_one(
        {"product_id": product_id, "location_code": location_code},
        {
            "$inc": {"quantity": quantity},
            "$set": {"updated_at": _now(), "updated_by": user},
            "$setOnInsert": {"product_id": product_id, "location_code": location_code},
        },
        upsert=True,
    )


def _decrement(product_id: str, location_code: str, quantity: float, user: str) -> None:
    updated = collection("inventory_balances").find_one_and_update(
        {"product_id": product_id, "location_code": location_code, "quantity": {"$gte": quantity}},
        {"$inc": {"quantity": -quantity}, "$set": {"updated_at": _now(), "updated_by": user}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError("Stock insuficiente en el depósito de origen")


def register_movement(data: dict, user: str) -> dict:
    _ensure_storage()
    product_id = _clean(data.get("product_id"))
    product = _product(product_id)
    movement_type = _clean(data.get("type")).upper()
    if movement_type not in MOVEMENT_TYPES:
        raise ValueError("Tipo de movimiento de inventario inválido")
    quantity = _quantity(data.get("quantity"))
    source_key = _clean(data.get("source_key")) or None
    if source_key:
        existing = collection("inventory_movements").find_one({"source_key": source_key}, {"_id": 0})
        if existing is not None:
            return {"movement": existing, "already_registered": True}

    origin = None
    destination = None
    if movement_type in {"TRASLADO", "AJUSTE_NEGATIVO"}:
        origin = _location(data.get("origin_location"))
    if movement_type in {"SALDO_INICIAL", "TRASLADO", "AJUSTE_POSITIVO", "COMPRA"}:
        destination = _location(data.get("destination_location"))
    if origin and destination and origin == destination:
        raise ValueError("El depósito de origen y destino deben ser distintos")

    if movement_type in {"SALDO_INICIAL", "AJUSTE_POSITIVO", "COMPRA"}:
        _increment(product_id, destination, quantity, user)
    elif movement_type == "AJUSTE_NEGATIVO":
        _decrement(product_id, origin, quantity, user)
    else:
        _decrement(product_id, origin, quantity, user)
        try:
            _increment(product_id, destination, quantity, user)
        except Exception:
            _increment(product_id, origin, quantity, user)
            raise

    movement = {
        "id": str(uuid4()),
        "created_at": _now(),
        "product_id": product_id,
        "product_sku": product["sku"],
        "unit": product["unit"],
        "quantity": quantity,
        "type": movement_type,
        "origin_location": origin or "",
        "destination_location": destination or "",
        "source_key": source_key,
        "notes": _clean(data.get("notes")),
        "user": user,
    }
    try:
        collection("inventory_movements").insert_one(movement)
    except Exception:
        if movement_type in {"SALDO_INICIAL", "AJUSTE_POSITIVO", "COMPRA"}:
            _decrement(product_id, destination, quantity, user)
        elif movement_type == "AJUSTE_NEGATIVO":
            _increment(product_id, origin, quantity, user)
        else:
            _decrement(product_id, destination, quantity, user)
            _increment(product_id, origin, quantity, user)
        raise
    movement.pop("_id", None)
    return {"movement": movement, "already_registered": False}


def set_replenishment(data: dict, user: str) -> dict:
    _ensure_storage()
    product_id = _clean(data.get("product_id"))
    _product(product_id)
    location_code = _location(data.get("location_code"))

    def non_negative(name: str) -> float:
        value = float(data.get(name, 0) or 0)
        if value < 0:
            raise ValueError(f"{name} no puede ser negativo")
        return round(value, 6)

    settings = {
        "product_id": product_id,
        "location_code": location_code,
        "minimum_quantity": non_negative("minimum_quantity"),
        "target_quantity": non_negative("target_quantity"),
        "coverage_days": int(non_negative("coverage_days")),
        "lead_time_days": int(non_negative("lead_time_days")),
        "preferred_supplier": _clean(data.get("preferred_supplier")),
        "exclude_from_replenishment": bool(data.get("exclude_from_replenishment", False)),
        "updated_at": _now(),
        "updated_by": user,
    }
    collection("inventory_settings").update_one({"product_id": product_id}, {"$set": settings}, upsert=True)
    return settings


def list_inventory(product_id: str | None = None) -> dict:
    _ensure_storage()
    query = {"id": product_id} if product_id else {}
    products = list(collection("inventory_products").find(query, {"_id": 0}).sort("sku", 1))
    products_by_id = {product["id"]: product for product in products}
    settings_by_product = {
        item["product_id"]: item
        for item in collection("inventory_settings").find({}, {"_id": 0})
    }
    balance_query = {"product_id": product_id} if product_id else {}
    balances = []
    for balance in collection("inventory_balances").find(balance_query, {"_id": 0}).sort([("product_id", 1), ("location_code", 1)]):
        product = products_by_id.get(balance["product_id"])
        if product is None:
            continue
        balances.append({**balance, "product": product, "settings": settings_by_product.get(product["id"])})
    movement_query = {"product_id": product_id} if product_id else {}
    movements = list(collection("inventory_movements").find(movement_query, {"_id": 0}).sort("created_at", -1).limit(250))
    locations = list(collection("inventory_locations").find({"active": True}, {"_id": 0}).sort("code", 1))
    return {"products": products, "locations": locations, "balances": balances, "movements": movements}
