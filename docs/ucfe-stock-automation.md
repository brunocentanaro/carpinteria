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
- `carpinteria/inventory.py`
  - Inventario general separado del stock histórico de molduras.
  - Depósitos iniciales `FABRICA` y `CASA`.
  - Productos con unidad base, saldos iniciales, traslados, ajustes y
    configuración de reposición.
- `carpinteria/ucfe.py`
  - Sincroniza comprobantes recibidos e ítems XML a Mongo de forma idempotente.
  - Mantiene ítems en `PENDING` hasta que un administrador los confirme o
    descarte. Confirmar un mapping reutiliza la equivalencia para futuras
    facturas del mismo proveedor e ítem normalizado.

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

### Decisiones confirmadas

- Fábrica y La Casa del Carpintero tendrán stock separado. Un traslado entre
  ambas debe descontar el origen y acreditar el destino en una única operación
  trazable.
- Las compras y ventas de UCFE solo impactan stock luego de un mapping
  confirmado por un administrador. Los comprobantes y líneas no inventariables
  también se guardan para auditoría, pero se marcan `IGNORED`.
- La sincronización será manual desde la aplicación y automática una vez por
  día.
- Las notas de crédito, anulaciones y correcciones deben revertir el
  movimiento original, sin borrar trazabilidad.
- Por ahora UCFE es la única fuente automática de ventas.
- El administrador podrá asociar una línea UCFE a un producto existente o
  crear un producto desde la bandeja de pendientes.
- Cada producto configura su propia política de reposición: ubicación,
  stock mínimo, stock objetivo, días de cobertura, plazo de entrega, proveedor
  preferido y exclusión opcional del cálculo automático.

### Unidades de medida

Las facturas reales ya contienen litros (`ltr`), unidades (`Und.`) y líneas
sin unidad (`N/A`) para herrajes. Además, el catálogo actual de molduras se
vende por metro o varilla. El inventario nuevo debe soportar al menos:

- `unidad` para herrajes y productos contables por pieza.
- `metro` para molduras y madera lineal.
- `litro` para consumibles que se decida inventariar.
- `placa`, `paquete` y `kilogramo` como unidades disponibles para futuros
  proveedores.

Cada producto tendrá una única unidad base y admitirá cantidades decimales.
El mapping UCFE guardará la unidad de origen y un factor de conversión. Si la
factura dice `N/A`, la equivalencia deberá ser confirmada por el administrador;
no se aplicará un movimiento automático por inferencia.

### Alcance del inventario

`molduras_stock.py` representa stock físico de molduras por estante y usa
cantidades enteras de varillas/fracciones. No es suficiente como base directa
para compras UCFE de varias categorías y unidades. La automatización se hará
en un inventario general nuevo, con depósitos `FABRICA` y `CASA`; el módulo de
molduras podrá migrarse o integrarse posteriormente sin romper la operación
actual.

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

Implementado en backend:

1. Inventario general con `inventory_products`, `inventory_locations`,
   `inventory_balances`, `inventory_movements` e `inventory_settings`.
2. Actions CLI `inventory_list`, `inventory_product_upsert`,
   `inventory_movement` e `inventory_replenishment`.
3. Ingesta UCFE mediante `ucfe_received_sync`, persistiendo
   `ucfe_received_cfe` y `ucfe_received_items`.
4. Bandeja de datos mediante `ucfe_received_list` y mapping mediante
   `ucfe_item_mapping` (`confirm` o `ignore`).

Pendiente para la siguiente entrega:

1. Pantalla administrativa para productos, saldos iniciales y la bandeja UCFE.
2. Endpoint protegido que exponga estas actions a administradores.
3. Aplicar movimientos `COMPRA_UCFE` y `VENTA_UCFE` solo después de que el
   administrador confirme el flujo de revisión.
4. Sincronización diaria programada, ranking y sugerencias de reposición.

Esto evita que una factura mal interpretada cambie stock real sin revision.
