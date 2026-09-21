"""Product requests and human conversations between La Casa and the factory."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from carpinteria.db import collection
from carpinteria.employee_calendar import EMPLOYEES, TaskValues
from carpinteria.team_access import can_view_team, employee_id_for, normalize_user

CATEGORIES = {
    "casa": ["Molduras", "Placas", "Madera", "Otros productos"],
    "pirone": ["Herrajes", "Herramientas", "Maquinaria", "Adhesivos", "Otros productos"],
}
STATUSES = {"pending", "in_progress", "ready", "delivered", "cancelled"}


class ProductRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recipient_id: str
    category: str
    product: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    unit: Literal["unidades", "metros", "m²", "m³", "kg", "litros", "cajas", "paquetes"]
    needed_date: str = ""
    notes: str = Field(default="", max_length=3000)

    @field_validator("needed_date")
    @classmethod
    def valid_date(cls, value: str):
        return TaskValues.valid_date(value) if value else ""


def _coll():
    return collection("internal_product_requests")


def _other(brand: str) -> str:
    if brand not in EMPLOYEES:
        raise ValueError("Empresa no válida")
    return "pirone" if brand == "casa" else "casa"


def _scope(brand: str, actor: str, area: str, all_access: bool) -> dict:
    _other(brand)
    if can_view_team(actor, brand, area, all_access):
        return {"$or": [{"from_brand": brand}, {"to_brand": brand}]}
    employee = employee_id_for(actor, brand)
    clauses = [{"from_brand": brand, "sender_key": normalize_user(actor)}]
    if employee:
        clauses.append({"to_brand": brand, "recipient_id": employee})
    return {"$or": clauses}


def _message(actor: str, brand: str, text: str, kind: str = "message", at: datetime | None = None) -> dict:
    return {"id": uuid.uuid4().hex, "author": actor, "brand_id": brand, "text": text, "kind": kind, "created_at": at or datetime.now(timezone.utc)}


def handle_internal_requests(data: dict) -> dict:
    try:
        brand = str(data.get("brand_id") or "")
        actor = str(data.get("actor") or "")
        if not actor:
            raise PermissionError("No autenticado")
        other = _other(brand)
        area, all_access = str(data.get("actor_area") or ""), bool(data.get("all_access"))
        scope = _scope(brand, actor, area, all_access)
        action = data["action"]
        if action == "internal_requests_list":
            limit = min(1000, max(1, int(data.get("limit") or 50)))
            rows = list(_coll().find(scope, {"_id": 0, "messages": 0}).sort("updated_at", -1).limit(limit + 1))
            return {"requests": rows[:limit], "has_more": len(rows) > limit, "recipients": EMPLOYEES[other],
                    "categories": CATEGORIES[brand], "viewer": actor, "can_view_team": can_view_team(actor, brand, area, all_access)}
        if action == "internal_request_create":
            request = ProductRequest.model_validate(data.get("values") or {})
            if request.recipient_id not in {person["id"] for person in EMPLOYEES[other]}:
                raise ValueError("Elegí un destinatario del otro negocio")
            if request.category not in CATEGORIES[brand]:
                raise ValueError("Categoría de producto no válida")
            now = datetime.now(timezone.utc)
            text = f"Solicita {request.quantity:g} {request.unit} de {request.product}."
            if request.notes:
                text += f"\n{request.notes}"
            doc = {**request.model_dump(), "id": uuid.uuid4().hex, "from_brand": brand, "to_brand": other,
                   "sender": actor, "sender_key": normalize_user(actor), "status": "pending", "created_at": now,
                   "updated_at": now, "messages": [_message(actor, brand, text, at=now)], "message_count": 1}
            _coll().create_index([("from_brand", 1), ("sender_key", 1), ("updated_at", -1)])
            _coll().create_index([("to_brand", 1), ("recipient_id", 1), ("updated_at", -1)])
            _coll().insert_one(dict(doc))
            return {"request": doc}
        request_id = str(data.get("request_id") or "")
        if not request_id:
            raise ValueError("Falta identificar el pedido")
        query = {"$and": [{"id": request_id}, scope]}
        if action == "internal_request_get":
            doc = _coll().find_one(query, {"_id": 0})
            return {"request": doc} if doc else {"error": "Pedido no encontrado", "status": 404}
        doc = _coll().find_one(query, {"_id": 0, "messages": 0})
        if doc is None:
            return {"error": "Pedido no encontrado", "status": 404}
        now = datetime.now(timezone.utc)
        updates = {"updated_at": now}
        if action == "internal_request_message":
            text = str(data.get("text") or "").strip()
            if not text or len(text) > 3000:
                raise ValueError("Escribí un mensaje de hasta 3000 caracteres")
            message = _message(actor, brand, text, at=now)
        elif action == "internal_request_status":
            status = str(data.get("status") or "")
            if status not in STATUSES:
                raise ValueError("Estado no válido")
            updates["status"] = status
            labels = {"pending": "Pendiente", "in_progress": "En preparación", "ready": "Listo", "delivered": "Entregado", "cancelled": "Cancelado"}
            message = _message(actor, brand, f"Cambió el estado a: {labels[status]}", "status", at=now)
        else:
            raise ValueError("Acción no válida")
        # Messages and status changes are appended atomically so simultaneous replies survive.
        query["message_count"] = {"$lt": 1000}
        result = _coll().update_one(query, {"$set": updates, "$push": {"messages": message}, "$inc": {"message_count": 1}})
        if not result.matched_count:
            raise ValueError("El pedido alcanzó el límite de mensajes. Creá otro pedido para continuar.")
        return {"request": _coll().find_one({"$and": [{"id": request_id}, scope]}, {"_id": 0})}
    except PermissionError as error:
        return {"error": str(error), "status": 403}
    except ValueError as error:
        return {"error": str(error), "status": 400}
