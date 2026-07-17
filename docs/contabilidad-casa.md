# Modulo de contabilidad de La Casa del Carpintero

Rama de trabajo: `feature/contabilidad-casa`.

Este documento traduce el flujo actual de los Excel mensuales a un modulo dentro de la app. Los archivos usados como referencia inicial son:

- `Julio 2026 (1).xlsx`: caja diaria, resumen mensual, tarjetas, conciliacion bancaria y ventas/facturas a credito.
- `Facturas a pagar.xlsx`: cuentas a pagar por proveedor, facturas recibidas, pagos parciales y saldos.
- `Planilla Anual 2024.xlsx`: consolidacion mensual/semestral y estado de resultados armado a partir de los cierres de cada mes.

Los Excel no se versionan en el repo. Sirven como especificacion del proceso actual.

## Objetivo

Crear una seccion de contabilidad para La Casa del Carpintero que permita registrar, revisar y conciliar:

- Ventas diarias por efectivo, deposito bancario, tarjetas y facturas a credito.
- Entradas de caja: fondo inicial, aportes, cheques, depositos y cobranzas.
- Salidas de caja: gastos fijos, impuestos, proveedores, sueldos, costos de venta, retiros y pagos varios.
- Pagos por banco para conciliacion posterior.
- Facturas a credito pendientes de cobro.
- Facturas de proveedores pendientes de pago.
- Pagos parciales o totales a proveedores.
- Saldos actuales a cobrar y a pagar.
- Estado de resultados mensual, semestral y anual.

El flujo debe mantener el concepto operativo de "dia trabajado", no dia calendario: se trabaja de lunes a sabado, salvo feriados laborables o cierres excepcionales.

## Flujo actual en `Julio 2026 (1).xlsx`

### Resumen mensual

La solapa `Resumen` suma las hojas diarias numeradas (`1`, `2`, `3`, etc.). El mes no se carga por calendario puro; cada numero representa un dia trabajado.

Indicadores principales:

- Fondo.
- Facturas.
- Facturas a credito.
- Fondo en efectivo.
- Fondo en cheques.
- Aportes.
- Notas de credito.
- Devoluciones.
- Faltantes.
- Entradas por Visa y Master.
- Totales por seccion de movimientos.
- Costos, pagos, retiros y ganancia/perdida estimada.

Tambien compara datos contra Memory:

- Segun Memory.
- Segun Excel.
- Faltante/sobrante.

### Hojas diarias

Cada hoja diaria (`1`, `2`, `3`, etc.) tiene:

- Cabecera de caja:
  - Fondo.
  - Facturas.
  - Rango de facturas.
  - Facturas a credito.
  - Fondo en efectivo.
  - Fondo en cheques.
  - Aportes.
  - Entradas Visa/Master.
  - Total.
- Movimientos por categoria y medio:
  - Aporte.
  - Cheque.
  - Efectivo.
  - Total.
- Categorias de salida:
  - Impuestos: BPS, DGI, IMM, BSE.
  - Servicios: OSE, UTE, Antel.
  - Costos fijos: alquiler, contador, suscripciones y otros.
  - Sueldos y comisiones.
  - Costos de venta y proveedores.
  - Depositos.
  - Retiros de caja.
  - Retiros para seguros, contador, BPS/DGI y otros.

El sistema deberia permitir cargar esos movimientos sin depender de celdas fijas, pero conservando las mismas categorias para que el resumen mensual sea familiar.

### Tarjetas

La solapa `Tarjetas` consolida:

- Master:
  - Credito.
  - Debito.
- Visa:
  - Credito.
  - Debito.
- Maestro.
- Total tarjetas.
- Descuento estimado por comisiones.

### Conciliacion bancaria

La solapa `Conciliacion Cajabco` registra depositos y movimientos bancarios a conciliar.

Columnas observadas:

- Origen.
- Fecha.
- Referencia.
- Figura en Bco?
- Nro de doc/operacion.
- Importe.

El modulo debe permitir marcar cada movimiento como:

- Pendiente de banco.
- Encontrado en banco.
- Conciliado.
- Diferencia detectada.

### Facturas a credito / cuentas a cobrar

La solapa de ventas a credito registra cuentas pendientes de cobro.

Campos observados:

- Ente / cliente.
- Licitacion.
- Numero.
- Orden de compra.
- Fecha de adjudicacion o emision de orden.
- Plazo o fecha de entrega.
- Facturas.
- Metodo de pago.
- Fecha de pago.
- Monto.
- Pagos.
- Comentario.

Esto deberia transformarse en cuentas a cobrar con seguimiento por estado.

## Flujo actual en `Facturas a pagar.xlsx`

La hoja `Facturas a Pagar` tiene dos zonas:

### Resumen por proveedor

Arriba hay una lista de proveedores con formulas `SUMIFS` que agrupan:

- Facturas completas pendientes.
- Saldos pendientes.
- Moneda.
- Total a pagar.
- Datos de descuento.
- Condiciones por pago en fecha.

### Detalle de facturas

Desde la fila 81 aparece el detalle normalizado.

Columnas observadas:

- Factura.
- Empresa.
- Moneda.
- Monto de Factura.
- Saldo a Pagar.
- Fecha de Compra.
- Pago Realizado?
- Fecha de pagos.
- Nro de Recibos.
- Monto de Recibos.

Estados observados:

- `No Paga`: factura pendiente completa.
- `Saldo`: factura con pago parcial.
- `Paga`: factura cancelada.
- `N/A`: fila informativa o proveedor sin factura activa.

## Modelo propuesto

### Colecciones Mongo

`accounting_periods`

- `id`
- `brand_id`: inicialmente `casa`.
- `year`
- `month`
- `status`: `open`, `closed`.
- `working_days`: dias habilitados del periodo.
- `created_at`, `updated_at`.

`accounting_days`

- `id`
- `period_id`
- `workday_number`: 1, 2, 3...
- `date`: fecha calendario opcional.
- `is_working_day`
- `opening_cash`
- `opening_checks`
- `invoice_range`
- `notes`
- `status`: `draft`, `reviewed`, `closed`.

`accounting_movements`

- `id`
- `period_id`
- `day_id`
- `direction`: `income`, `expense`, `transfer`
- `category`: impuestos, servicios, proveedor, sueldo, retiro, deposito, tarjeta, aporte, devolucion, etc.
- `subcategory`
- `payment_method`: efectivo, cheque, deposito, transferencia, tarjeta_visa, tarjeta_master, maestro, otro.
- `amount`
- `currency`: `UYU` o `USD`.
- `description`
- `reference`
- `source`: manual, ucfe, banco, venta, import_excel.
- `source_id`
- `reconciled`
- `created_at`, `updated_at`, `created_by`.

`bank_reconciliation_items`

- `id`
- `period_id`
- `date`
- `origin`
- `reference`
- `bank_document`
- `amount`
- `appears_in_bank`
- `matched_movement_id`
- `status`: pendiente, encontrado, conciliado, diferencia.
- `notes`

`accounts_receivable`

- `id`
- `customer`
- `public_entity`
- `tender`
- `purchase_order`
- `invoice_number`
- `issue_date`
- `due_date`
- `payment_method`
- `amount`
- `paid_amount`
- `balance`
- `status`: pendiente, parcial, cobrada, incobrable.
- `notes`

`supplier_invoices`

- `id`
- `supplier`
- `rut`
- `invoice_number`
- `currency`
- `amount`
- `balance`
- `purchase_date`
- `status`: pendiente, parcial, pagada, no_aplica.
- `ucfe_cfe_id`
- `source_key`
- `notes`
- `created_at`, `updated_at`.

`supplier_payments`

- `id`
- `supplier_invoice_id`
- `supplier`
- `payment_date`
- `amount`
- `currency`
- `receipt_number`
- `bank_reconciliation_item_id`
- `accounting_movement_id`
- `notes`

## Integracion con UCFE

La automatizacion actual de UCFE ya guarda CFE recibidos en:

- `ucfe_received_cfe`
- `ucfe_received_items`

Para contabilidad, la regla deberia ser:

1. Cuando entra una factura recibida de proveedor, crear o actualizar `supplier_invoices`.
2. La idempotencia debe usar `source_key` o una combinacion estable de proveedor, tipo CFE, serie, numero y fecha.
3. Si la factura ya existe, actualizar solo datos seguros: monto, XML/source, estado UCFE, fecha.
4. No cancelar saldos automaticamente por la factura; solo se cancela contra pagos registrados.
5. Si un pago bancario o recibo se registra y matchea una factura, crear `supplier_payments` y actualizar saldo.

## Pantallas propuestas

### `/contabilidad`

Dashboard mensual con:

- Ventas del mes.
- Ventas a credito.
- Cobros por efectivo, banco y tarjetas.
- Gastos pagados.
- Saldos a cobrar.
- Saldos a pagar.
- Faltante/sobrante contra Memory.
- Caja disponible.
- Pagos pendientes de conciliacion.

### `/contabilidad/caja`

Carga diaria por dia trabajado:

- Selector de periodo y dia trabajado.
- Bloque de ingresos.
- Bloque de salidas.
- Totales por medio de pago.
- Cierre del dia.
- Alerta si falta caja o si hay diferencia.

### `/contabilidad/banco`

Conciliacion:

- Movimientos esperados por deposito/transferencia.
- Marcar si figura en banco.
- Nro de operacion.
- Match manual con movimiento de caja o pago de proveedor.

### `/contabilidad/cobrar`

Cuentas a cobrar:

- Facturas a credito.
- SIIF / licitaciones.
- Monto, pago, saldo, vencimiento.
- Estados y comentarios.

### `/contabilidad/pagar`

Cuentas a pagar:

- Facturas de proveedores.
- Saldos por proveedor.
- Estado pendiente/parcial/pagado.
- Pagos y recibos.
- Vinculo con UCFE.

## Importacion desde Excel

La primera version puede incluir importadores manuales para migrar datos:

- Importar mes diario desde `Julio 2026 (1).xlsx`.
- Importar cuentas a pagar desde `Facturas a pagar.xlsx`.

Los importadores deben guardar `source: import_excel` y conservar el nombre de archivo, hoja y fila de origen para auditoria.

## Reglas importantes

- La contabilidad es de La Casa del Carpintero (`brand_id = casa`).
- Acceso inicial solo para area `administracion`.
- No modificar stock por movimientos contables.
- UCFE recibido puede crear cuenta a pagar, pero no debe marcarla pagada.
- Pagos bancarios pueden cancelar facturas si se vinculan explicitamente.
- Un pago puede ser parcial.
- Una factura puede tener multiples pagos.
- Los cierres mensuales deben quedar bloqueados contra ediciones accidentales.

## Flujo actual en `Planilla Anual 2024.xlsx`

Este archivo muestra como los cierres mensuales se transforman en una lectura anual del negocio.

### Planilla semestral

La solapa `Planilla 1er semestre` consolida mes a mes:

- Ventas:
  - Facturacion contado.
  - Facturacion tarjetas.
  - Facturacion a credito.
  - Facturacion total.
- Costos fijos:
  - BPS.
  - DGI.
  - IMM.
  - BSE.
  - Servicios y gastos fijos.
- Sueldos y comisiones.
- Proveedores.
- Envios.
- Costos variables.
- Devoluciones y boletas.

En la planilla actual, los primeros meses estan cargados con columnas simples, y luego algunos meses tienen pares `Seccion` / `Total`. El modulo nuevo deberia evitar esa dependencia de layout y calcular los totales desde movimientos categorizados.

### Resumen de estado de resultados

La solapa `Resumen 1er semestre` funciona como estado de resultados mensual:

- Ventas.
- Costos fijos.
- Sueldos.
- Proveedores.
- Envios.
- Costos variables.
- Devoluciones.
- Ventas netas.
- Costos totales.
- Resultado mensual.

Esto debe convertirse en una vista de resultados con columnas por mes y totales por periodo:

- Mes.
- Ventas brutas.
- Ventas contado.
- Ventas tarjetas.
- Ventas a credito.
- Devoluciones/notas de credito.
- Ventas netas.
- Costos fijos.
- Sueldos.
- Proveedores / costo de venta.
- Envios.
- Costos variables.
- Resultado operativo.
- Resultado de caja.

### Hojas mensuales historicas

Las hojas `Enero`, `Febrero`, `Marzo`, etc. tienen una estructura parecida a la planilla mensual:

- Fondo.
- Facturas.
- Facturas a credito.
- Notas de credito.
- Fondo en efectivo.
- Fondo en cheques.
- Aportes.
- Entradas Visa/Master.
- Total.
- Comparacion contra Memory en algunos meses.
- En algunos casos ventas en USD convertidas por tipo de cambio.

El modulo debe soportar moneda UYU y USD con tipo de cambio por fecha para facturacion o pagos en dolares.

## Cierre mensual y estado de resultados propuesto

Agregar un proceso de cierre:

1. Cargar o importar los dias trabajados del mes.
2. Revisar caja diaria y conciliacion bancaria.
3. Revisar cuentas a cobrar y cuentas a pagar.
4. Cerrar el mes.
5. Congelar totales del periodo para auditoria.
6. Alimentar automaticamente el estado de resultados.

Coleccion propuesta: `accounting_period_results`

- `period_id`
- `brand_id`
- `year`
- `month`
- `gross_sales`
- `cash_sales`
- `card_sales`
- `credit_sales`
- `returns`
- `credit_notes`
- `net_sales`
- `fixed_costs`
- `payroll`
- `supplier_costs`
- `shipping_costs`
- `variable_costs`
- `total_costs`
- `operating_result`
- `cash_result`
- `memory_sales`
- `excel_sales`
- `difference`
- `closed_at`
- `closed_by`

Pantalla propuesta: `/contabilidad/resultados`

- Tabla por mes similar a `Resumen 1er semestre`.
- Filtros por ano y semestre.
- Columnas de ventas, costos y resultado.
- Drill-down desde cada numero al detalle de movimientos que lo componen.
- Comparacion contra Memory cuando exista.
- Exportacion a Excel/PDF para contador o revision interna.

## MVP sugerido

1. Crear backend de cuentas a pagar conectado a UCFE recibido.
2. Crear pantalla `/contabilidad/pagar` con proveedores, facturas, saldos y registro de pagos.
3. Crear importador de `Facturas a pagar.xlsx` para cargar saldos iniciales.
4. Crear pantalla `/contabilidad/caja` para registrar dias trabajados e ingresos/salidas manuales.
5. Crear resumen mensual equivalente a `Resumen`.
6. Crear conciliacion bancaria.
7. Crear cuentas a cobrar.
8. Crear estado de resultados mensual/anual equivalente a `Resumen 1er semestre`.

Este orden permite aprovechar la automatizacion UCFE ya hecha y reducir trabajo manual de proveedores primero, que es la parte mas facil de conectar con datos reales.
