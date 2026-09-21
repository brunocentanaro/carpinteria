"""Employee identity and team visibility from an authenticated server session."""
import unicodedata


def normalize_user(value: str) -> str:
    return " ".join("".join(char for char in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(char)).split())


def employee_id_for(user: str, brand_id: str) -> str:
    from carpinteria.employee_calendar import EMPLOYEES
    normalized = normalize_user(user)
    return next((item["id"] for item in EMPLOYEES.get(brand_id, []) if normalized in {item["id"], normalize_user(item["name"])}), "")


def can_view_team(user: str, brand_id: str, area: str, all_access: bool) -> bool:
    return bool(all_access or area == "administracion" or
                (brand_id == "casa" and normalize_user(user) == "daniel") or
                (brand_id == "pirone" and normalize_user(user) == "richard"))


def calendar_access(user: str, brand_id: str, area: str, all_access: bool) -> dict:
    team = can_view_team(user, brand_id, area, all_access)
    employee = employee_id_for(user, brand_id)
    if not team and not employee:
        raise PermissionError("Tu usuario no está vinculado a un empleado del calendario. Consultá a administración.")
    return {"can_view_team": team, "viewer_employee_id": employee}
