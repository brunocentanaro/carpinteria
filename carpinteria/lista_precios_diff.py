"""Diff a parsed price list against the current 'Activa' snapshot.

Diff is keyed by `sku` (stable internal hash). Prices are compared in
canonical USD so changes in source currency or TC don't pollute the diff.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from carpinteria.lista_precios_parser import Producto


def _to_float(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _delta_pct(old: float, new: float) -> float | None:
    if old <= 0:
        return None
    return round((new - old) / old * 100.0, 2)


def compute_diff(new_items: list[Producto], current_rows: list[dict]) -> dict:
    new_by_sku: dict[str, Producto] = {it.sku: it for it in new_items if it.sku}
    old_by_sku: dict[str, dict] = {
        (row.get("sku") or "").strip(): row
        for row in current_rows
        if (row.get("sku") or "").strip()
    }

    nuevos: list[dict] = []
    cambios: list[dict] = []
    sin_cambios: int = 0

    for sku, it in new_by_sku.items():
        old = old_by_sku.get(sku)
        item_dict = asdict(it)
        if old is None:
            nuevos.append(item_dict)
            continue

        old_simp_usd = _to_float(old.get("precio_usd_simp"))
        old_cimp_usd = _to_float(old.get("precio_usd_cimp"))
        old_moneda = (old.get("moneda_origen") or "").strip()

        same_simp = abs(old_simp_usd - it.precio_usd_simp) < 0.005
        same_cimp = abs(old_cimp_usd - it.precio_usd_cimp) < 0.005
        same_moneda = old_moneda == it.moneda_origen

        if same_simp and same_cimp and same_moneda:
            sin_cambios += 1
            continue

        cambios.append({
            **item_dict,
            "precio_usd_simp_old": old_simp_usd,
            "precio_usd_cimp_old": old_cimp_usd,
            "moneda_origen_old": old_moneda,
            "precio_origen_simp_old": _to_float(old.get("precio_origen_simp")),
            "delta_usd_simp": round(it.precio_usd_simp - old_simp_usd, 4),
            "delta_usd_simp_pct": _delta_pct(old_simp_usd, it.precio_usd_simp),
            "delta_usd_cimp": round(it.precio_usd_cimp - old_cimp_usd, 4),
            "delta_usd_cimp_pct": _delta_pct(old_cimp_usd, it.precio_usd_cimp),
        })

    removidos: list[dict] = []
    for sku, row in old_by_sku.items():
        if sku not in new_by_sku:
            removidos.append({
                "sku": sku,
                "codigo_proveedor": row.get("codigo_proveedor", ""),
                "nombre": row.get("nombre", "") or row.get("descripcion", ""),
                "descripcion": row.get("descripcion", ""),
                "tipo_producto": row.get("tipo_producto", ""),
                "familia": row.get("familia", ""),
                "material": row.get("material", ""),
                "unidad": row.get("unidad", ""),
                "moneda_origen": row.get("moneda_origen", ""),
                "precio_usd_simp": _to_float(row.get("precio_usd_simp")),
                "precio_usd_cimp": _to_float(row.get("precio_usd_cimp")),
            })

    current_meta = {}
    if current_rows:
        first = current_rows[0]
        current_meta = {
            "lista": first.get("lista", ""),
            "periodo": first.get("periodo", ""),
        }

    summary = {
        "total_nueva": len(new_by_sku),
        "total_actual": len(old_by_sku),
        "nuevos": len(nuevos),
        "removidos": len(removidos),
        "cambios": len(cambios),
        "sin_cambios": sin_cambios,
    }

    return {
        "summary": summary,
        "nuevos": nuevos,
        "removidos": removidos,
        "cambios": cambios,
        "current_lista": current_meta.get("lista", ""),
        "current_periodo": current_meta.get("periodo", ""),
    }
