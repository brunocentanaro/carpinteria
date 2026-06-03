# Datos de precios (fuente de verdad cross-platform)

Estos CSV son la **fuente de verdad** de los listados de precios que NO vienen de
Google Sheets. Existen porque los listados maestros viven en Excel locales (el
Windows del dueño; el modelo de molduras pesa ~98 MB y tiene fórmulas/links
externos que no sobreviven a Railway ni a una subida directa a Google Sheets).
La app solo necesita los **números finales**, así que los aplanamos a CSV chicos
que funcionan igual en Windows, Mac y Linux/Railway.

## Archivos

- `molduras_catalog.csv` — catálogo de molduras/listones/barrotes.
  Columnas: `code, family, description, width_mm, height_mm, price_meter_iva, price_varilla_iva`.
  Lo lee `carpinteria/molduras_prices.py`.
- `wood_datos.csv` — maderas de la solapa "Datos" (sirve para muebles y molduras).
  Columnas: `id, species, features, thickness_in, length_m, width_in, price_uyu, supplier`.
  Lo leen `carpinteria/wood_calculator.py` y `molduras_prices.load_wood_tables`.

## Prioridad de lectura

Los lectores usan, en orden:
1. El Excel maestro local, si existe (la máquina del dueño en Windows / `MOLDURAS_PRICE_FILE`).
2. **Estos CSV** (Mac del dev y Railway).
3. Un fallback hardcodeado mínimo (solo madera).

Así el flujo local de quien edita el Excel no cambia, y producción funciona igual.

## Cómo actualizar precios

1. Editar el Excel maestro como siempre.
2. Regenerar los CSV:
   ```
   uv run python scripts/flatten_price_sheets.py
   ```
   (o pasar rutas con `--molduras` / `--wood`).
3. Commitear los CSV regenerados.

> A futuro estos datos podrían migrarse a Google Sheets (como el catálogo Activa)
> para edición en vivo sin regenerar/commitear.
