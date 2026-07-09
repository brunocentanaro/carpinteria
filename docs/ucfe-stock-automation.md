# UCFE stock automation

Objetivo: usar UCFE como fuente de movimientos reales para mejorar stock de La
Casa y fábrica, con control manual cuando el sistema no pueda mapear un item con
confianza.

## Estado actual en esta rama

- `scripts/ucfe_recibidos.py`
  - Login directo con usuario/clave o sesión copiada del navegador.
  - Lista CFE recibidos con `api/CfeRecibido/GetCfeRecibidoInicial`.
  - Descarga PDF con `PDF/GetPdfCFERecibido`.
  - Descarga XML con `api/CfeRecibido/GetXMLorAdenda?id=...&tipo=1`.
  - Exporta CSV resumen y CSV de items desde XML.
- `scripts/ucfe_ventas_articulo.py`
  - Genera reporte de ventas por artículo.
  - Espera `Estado=3`.
  - Descarga PDF o Excel según `formato`.

Los scripts no guardan credenciales. Leen `UCFE_USERNAME` / `UCFE_PASSWORD` o
preguntan por prompt local.

## Comandos utiles

Listar recibidos y extraer items:

```bash
uv run python scripts/ucfe_recibidos.py \
  --fecha-alta-desde 07/08/2026 \
  --fecha-alta-hasta 07/08/2026 \
  --id-empresa 478 \
  --rows 100 \
  --download-xml \
  --items-csv
```

Descargar PDFs tambien:

```bash
uv run python scripts/ucfe_recibidos.py \
  --fecha-alta-desde 07/08/2026 \
  --fecha-alta-hasta 07/08/2026 \
  --id-empresa 478 \
  --rows 100 \
  --download-pdf \
  --download-xml \
  --items-csv
```

Generar ventas por articulo:

```bash
uv run python scripts/ucfe_ventas_articulo.py \
  --fecha-desde 2026/06/01 \
  --fecha-hasta 2026/06/30 \
  --sucursal 516 \
  --terminal 521
```

## Modelo propuesto

1. Ingesta UCFE idempotente.
   - `ucfe_received_cfe`: CFE recibidos crudos, por `Id` y `Uuid`.
   - `ucfe_received_items`: items normalizados desde XML.
   - `ucfe_sales_items`: ventas por articulo normalizadas desde reporte.
   - Guardar hash de XML/reporte para no duplicar movimientos.

2. Mapeo controlado a catalogo interno.
   - `stock_item_mappings`: proveedor + RUC + texto item + codigo interno.
   - Estado `PENDING`, `CONFIRMED`, `IGNORED`.
   - Si no hay mapping, no toca stock: queda en bandeja de revision.

3. Movimientos de stock.
   - Compras/recibidos mapeados: `COMPRA_UCFE` o `AJUSTE_POSITIVO`.
   - Ventas por articulo mapeadas: `VENTA_UCFE`.
   - Envio fabrica -> Casa: usar el flujo existente `ENVIO_CASA`, pero agregar
     stock destino Casa si se quiere stock separado por local.

4. Analytics.
   - Ranking mas comprados: sumar `ucfe_received_items` por item normalizado.
   - Ranking mas vendidos: sumar `ucfe_sales_items`.
   - Reposicion: demanda media sin outliers + stock actual + lead time.

## Outliers para pronostico

No usar promedio simple para proponer stock futuro. Reglas iniciales:

- Calcular demanda semanal/mensual por producto.
- Usar mediana y rango intercuartil.
- Marcar como outlier si `cantidad > Q3 + 1.5 * IQR`.
- Para forecast, winsorizar al limite superior o excluir si fue venta unica.
- Mostrar outliers en UI para que el usuario confirme si fue evento normal.

## Primer corte recomendable

1. Convertir los scripts UCFE en modulo backend reutilizable.
2. Agregar action CLI `ucfe_recibidos_sync` que guarde recibidos + items en Mongo.
3. Agregar pantalla/bandeja "Items UCFE sin mapear".
4. Permitir confirmar mapping item UCFE -> codigo de stock.
5. Recién ahi aplicar movimientos automaticos.

Esto evita que una factura mal interpretada cambie stock real sin revision.
