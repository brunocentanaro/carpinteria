from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ReturnDocument

from .db import collection
from .molduras_prices import load_prices


MOVEMENT_TYPES = {
    "PRODUCCION",
    "VENTA",
    "ENVIO_CASA",
    "AJUSTE_POSITIVO",
    "AJUSTE_NEGATIVO",
    "DESCARTE",
    "TRASLADO",
}
POSITIVE_TYPES = {"PRODUCCION", "AJUSTE_POSITIVO"}
NEGATIVE_TYPES = {"VENTA", "ENVIO_CASA", "AJUSTE_NEGATIVO", "DESCARTE"}
DEFAULT_LOCATIONS = (
    ("P1", "A1"), ("P1", "A2"), ("P1", "A3"),
    ("P1", "B1"), ("P1", "B2"), ("P1", "B3"),
)


def _material(code: str) -> str:
    upper = code.upper()
    if "IMP" in upper and "IMPC" not in upper:
        return "Eucalipto"
    if "PN" in upper or "NAC" in upper or "IMPC" in upper:
        return "Pino"
    return "Sin especificar"


def _catalog() -> dict[str, dict]:
    return {
        item.code: {
            "code": item.code,
            "description": item.description,
            "family": item.family,
            "material": _material(item.code),
            "width_mm": item.width_mm,
            "height_mm": item.height_mm,
            "price_meter_iva": item.price_meter_iva,
            "price_varilla_iva": item.price_varilla_iva,
        }
        for item in load_prices()
    }


def _ensure_storage() -> None:
    stock = collection("molduras_stock")
    stock.create_index([("code", 1), ("wall", 1), ("block", 1)], unique=True)
    collection("molduras_stock_movements").create_index([("code", 1), ("created_at", -1)])
    collection("molduras_stock_settings").create_index("code", unique=True)
    collection("molduras_stock_reservations").create_index([("code", 1), ("status", 1), ("created_at", -1)])
    locations = collection("molduras_stock_locations")
    locations.create_index([("wall", 1), ("block", 1)], unique=True)
    now = datetime.now(timezone.utc)
    for wall, block in DEFAULT_LOCATIONS:
        locations.update_one(
            {"wall": wall, "block": block},
            {"$setOnInsert": {"wall": wall, "block": block, "active": True, "created_at": now}},
            upsert=True,
        )
    for row in stock.find({"quantity": {"$exists": True}, "wall": {"$exists": False}}):
        stock.update_one(
            {"_id": row["_id"]},
            {"$set": {
                "wall": "P1", "block": "A1",
                "complete_quantity": max(0, int(row.get("quantity", 0))),
                "fraction_quantity": 0,
            }, "$unset": {"quantity": ""}},
        )


def _locations() -> list[dict]:
    return [
        {"wall": row["wall"], "block": row["block"], "label": f'{row["wall"]}-{row["block"]}'}
        for row in collection("molduras_stock_locations").find({"active": True}, {"_id": 0}).sort([("wall", 1), ("block", 1)])
    ]


def _validate_location(location: dict | None, field: str) -> tuple[str, str]:
    wall = str((location or {}).get("wall", "")).strip().upper()
    block = str((location or {}).get("block", "")).strip().upper()
    if not wall or not block:
        raise ValueError(f"Falta la ubicación {field}")
    if collection("molduras_stock_locations").find_one({"wall": wall, "block": block, "active": True}) is None:
        raise ValueError(f"La ubicación {wall}-{block} no existe")
    return wall, block


def list_stock(code: str | None = None) -> dict:
    _ensure_storage()
    products = _catalog()
    settings = {
        row["code"]: int(row.get("jit_min_quantity", 0))
        for row in collection("molduras_stock_settings").find({}, {"_id": 0})
    }
    for product_code, product in products.items():
        product["jit_min_quantity"] = settings.get(product_code, 0)
    stock_query = {"code": code} if code else {}
    rows = []
    for saved in collection("molduras_stock").find(stock_query, {"_id": 0}).sort([("code", 1), ("wall", 1), ("block", 1)]):
        product = products.get(saved.get("code"))
        if not product:
            continue
        complete = int(saved.get("complete_quantity", 0))
        fraction = int(saved.get("fraction_quantity", 0))
        if complete == 0 and fraction == 0:
            continue
        rows.append({
            **product,
            "wall": saved["wall"],
            "block": saved["block"],
            "location": f'{saved["wall"]}-{saved["block"]}',
            "complete_quantity": complete,
            "fraction_quantity": fraction,
            "total_units": complete + fraction,
            "notes": saved.get("notes", ""),
            "updated_at": saved.get("updated_at"),
        })
    movement_query = {"code": code} if code else {}
    movements = list(collection("molduras_stock_movements").find(movement_query, {"_id": 0}).sort("created_at", -1).limit(250))
    reservation_query = {"status": "ACTIVE"}
    if code:
        reservation_query["code"] = code
    reservations = list(collection("molduras_stock_reservations").find(reservation_query, {"_id": 0}).sort("created_at", -1))
    return {
        "products": list(products.values()),
        "locations": _locations(),
        "stock": rows,
        "movements": movements,
        "reservations": reservations,
    }


def set_jit_minimum(code: str, quantity: int, user: str) -> dict:
    _ensure_storage()
    if code not in _catalog():
        raise ValueError("El código de producto no existe en el listado de precios")
    value = max(0, int(quantity))
    now = datetime.now(timezone.utc)
    collection("molduras_stock_settings").update_one(
        {"code": code},
        {"$set": {"code": code, "jit_min_quantity": value, "updated_at": now, "updated_by": user}},
        upsert=True,
    )
    return {"code": code, "jit_min_quantity": value}


def create_reservation(data: dict, user: str) -> dict:
    _ensure_storage()
    code = str(data.get("code", "")).strip()
    if code not in _catalog():
        raise ValueError("El código de producto no existe en el listado de precios")
    quantity = max(0, int(data.get("quantity", 0) or 0))
    if quantity == 0:
        raise ValueError("La cantidad a reservar debe ser mayor a cero")
    reservation = {
        "id": str(uuid4()),
        "code": code,
        "quantity": quantity,
        "customer": str(data.get("customer", "")).strip(),
        "reference": str(data.get("reference", "")).strip(),
        "notes": str(data.get("notes", "")).strip(),
        "status": "ACTIVE",
        "created_at": datetime.now(timezone.utc),
        "created_by": user,
    }
    collection("molduras_stock_reservations").insert_one(reservation)
    reservation.pop("_id", None)
    return {"reservation": reservation}


def release_reservation(reservation_id: str, user: str) -> dict:
    _ensure_storage()
    updated = collection("molduras_stock_reservations").find_one_and_update(
        {"id": reservation_id, "status": "ACTIVE"},
        {"$set": {"status": "RELEASED", "released_at": datetime.now(timezone.utc), "released_by": user}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError("La reserva ya no está activa o no existe")
    return {"released": reservation_id}


def _increment(code: str, location: tuple[str, str], complete: int, fraction: int, user: str, notes: str) -> None:
    wall, block = location
    collection("molduras_stock").update_one(
        {"code": code, "wall": wall, "block": block},
        {
            "$inc": {"complete_quantity": complete, "fraction_quantity": fraction},
            "$set": {"updated_at": datetime.now(timezone.utc), "updated_by": user, "notes": notes},
            "$setOnInsert": {"code": code, "wall": wall, "block": block},
        },
        upsert=True,
    )


def _decrement(code: str, location: tuple[str, str], complete: int, fraction: int, user: str, notes: str) -> None:
    wall, block = location
    updated = collection("molduras_stock").find_one_and_update(
        {
            "code": code, "wall": wall, "block": block,
            "complete_quantity": {"$gte": complete},
            "fraction_quantity": {"$gte": fraction},
        },
        {
            "$inc": {"complete_quantity": -complete, "fraction_quantity": -fraction},
            "$set": {"updated_at": datetime.now(timezone.utc), "updated_by": user, "notes": notes},
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError(f"Stock insuficiente en {wall}-{block}")


def register_movement(data: dict, user: str) -> dict:
    _ensure_storage()
    code = str(data.get("code", "")).strip()
    if code not in _catalog():
        raise ValueError("El código de producto no existe en el listado de precios")
    movement_type = str(data.get("type", "")).strip().upper()
    if movement_type not in MOVEMENT_TYPES:
        raise ValueError("Tipo de movimiento inválido")
    complete = max(0, int(data.get("complete_quantity", 0) or 0))
    fraction = max(0, int(data.get("fraction_quantity", 0) or 0))
    if complete + fraction == 0:
        raise ValueError("Ingresá al menos una varilla completa o fraccionada")
    notes = str(data.get("notes", "")).strip()
    origin = None
    destination = None
    if movement_type in NEGATIVE_TYPES or movement_type == "TRASLADO":
        origin = _validate_location(data.get("origin"), "de origen")
    if movement_type in POSITIVE_TYPES or movement_type == "TRASLADO":
        destination = _validate_location(data.get("destination"), "de destino")
    if movement_type == "TRASLADO" and origin == destination:
        raise ValueError("El origen y el destino del traslado deben ser distintos")

    if movement_type in POSITIVE_TYPES:
        _increment(code, destination, complete, fraction, user, notes)
    elif movement_type in NEGATIVE_TYPES:
        _decrement(code, origin, complete, fraction, user, notes)
    else:
        _decrement(code, origin, complete, fraction, user, notes)
        try:
            _increment(code, destination, complete, fraction, user, notes)
        except Exception:
            _increment(code, origin, complete, fraction, user, "Reversión automática de traslado")
            raise

    now = datetime.now(timezone.utc)
    movement = {
        "id": str(uuid4()),
        "created_at": now,
        "code": code,
        "type": movement_type,
        "origin_wall": origin[0] if origin else "",
        "origin_block": origin[1] if origin else "",
        "destination_wall": destination[0] if destination else "",
        "destination_block": destination[1] if destination else "",
        "complete_quantity": complete,
        "fraction_quantity": fraction,
        "user": user,
        "notes": notes,
    }
    collection("molduras_stock_movements").insert_one(movement)
    movement.pop("_id", None)
    return {"movement": movement}
