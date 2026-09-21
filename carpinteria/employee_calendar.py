"""Shared employee task calendars, partitioned by company."""
from __future__ import annotations

import calendar
import re
import uuid
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from carpinteria.db import collection

EMPLOYEES = {
    "casa": [
        {"id": "daniel", "name": "Daniel"},
        {"id": "marcelo", "name": "Marcelo"},
        {"id": "cristopher", "name": "Cristopher"},
    ],
    "pirone": [
        {"id": "richard", "name": "Richard"},
        {"id": "leo", "name": "Leo"},
        {"id": "freddy", "name": "Freddy"},
        {"id": "jose", "name": "José"},
        {"id": "alvan", "name": "Alvan"},
    ],
}


class TaskValues(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    employee_id: str
    title: str = Field(min_length=1, max_length=200)
    date: str
    start_time: str = ""
    end_time: str = ""
    notes: str = Field(default="", max_length=3000)
    status: Literal["pending", "in_progress", "completed", "cancelled"] = "pending"

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("La fecha debe tener formato AAAA-MM-DD")
        date.fromisoformat(value)
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        if value and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("La hora debe tener formato HH:MM")
        return value

    @model_validator(mode="after")
    def ordered_times(self):
        if self.end_time and (not self.start_time or self.end_time <= self.start_time):
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
        return self


def _employees(brand_id: str) -> list[dict]:
    if brand_id not in EMPLOYEES:
        raise ValueError("Empresa no válida")
    return EMPLOYEES[brand_id]


def _check_employee(brand_id: str, employee_id: str) -> None:
    if employee_id not in {employee["id"] for employee in _employees(brand_id)}:
        raise ValueError("El empleado no pertenece a esta empresa")


def list_calendar(brand_id: str, month: str, employee_id: str = "") -> dict:
    employees = _employees(brand_id)
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("El mes debe tener formato AAAA-MM")
    first = date.fromisoformat(f"{month}-01")
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    query = {"brand_id": brand_id, "date": {"$gte": first.isoformat(), "$lte": last.isoformat()}}
    if employee_id:
        _check_employee(brand_id, employee_id)
        query["employee_id"] = employee_id
    tasks = list(collection("employee_tasks").find(query, {"_id": 0}).sort([("date", 1), ("start_time", 1), ("created_at", 1)]))
    return {"employees": employees, "tasks": tasks}


def save_task(brand_id: str, actor: str, values: dict, task_id: str = "") -> dict | None:
    _employees(brand_id)
    coll = collection("employee_tasks")
    current = None
    if task_id:
        current = coll.find_one({"id": task_id, "brand_id": brand_id}, {"_id": 0})
        if current is None:
            return None
    previous = {key: current[key] for key in TaskValues.model_fields if key in current} if current else {}
    task = TaskValues.model_validate({**previous, **values})
    _check_employee(brand_id, task.employee_id)
    now = datetime.now(timezone.utc)
    update = {**task.model_dump(), "updated_at": now, "updated_by": actor}
    if current:
        coll.update_one({"id": task_id, "brand_id": brand_id}, {"$set": update})
        return {**current, **update}
    coll.create_index([("brand_id", 1), ("date", 1), ("employee_id", 1)])
    doc = {**update, "id": uuid.uuid4().hex, "brand_id": brand_id, "created_at": now, "created_by": actor}
    coll.insert_one(dict(doc))
    return doc


def handle_calendar(data: dict) -> dict:
    try:
        from carpinteria.team_access import calendar_access
        brand_id = str(data.get("brand_id") or "")
        access = calendar_access(str(data.get("actor") or ""), brand_id, str(data.get("actor_area") or ""), bool(data.get("all_access")))
        own_employee = access["viewer_employee_id"] if not access["can_view_team"] else ""
        if data["action"] == "employee_calendar_list":
            requested = str(data.get("employee_id") or "")
            if own_employee and requested and requested != own_employee:
                raise PermissionError("Solo podés consultar tu propio calendario")
            result = list_calendar(brand_id, str(data.get("month") or ""), own_employee or requested)
            if own_employee:
                result["employees"] = [employee for employee in result["employees"] if employee["id"] == own_employee]
            return {**result, **access}
        values = data.get("values")
        if not isinstance(values, dict):
            raise ValueError("Faltan los datos de la tarea")
        if own_employee:
            if values.get("employee_id", own_employee) != own_employee:
                raise PermissionError("Solo podés modificar tus propias tareas")
            if data.get("task_id") and collection("employee_tasks").find_one({"id": str(data["task_id"]), "brand_id": brand_id, "employee_id": own_employee}) is None:
                return {"error": "Tarea no encontrada", "status": 404}
            values = {**values, "employee_id": own_employee}
        task = save_task(brand_id, str(data.get("actor") or ""), values, str(data.get("task_id") or ""))
        return {"task": task} if task else {"error": "Tarea no encontrada", "status": 404}
    except PermissionError as error:
        return {"error": str(error), "status": 403}
    except ValueError as error:
        return {"error": str(error), "status": 400}
