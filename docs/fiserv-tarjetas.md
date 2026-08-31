# Fiserv, tarjetas y caja — módulo de La Casa del Carpintero

Este documento captura el diseño, las decisiones y el roadmap de la integración
de Fiserv con la contabilidad y la caja diaria. La arquitectura del portal (auth,
endpoints) está en `docs/railway-fiserv-cron.md`; el módulo contable general en
`docs/contabilidad-casa.md`. Acá va lo que un agente nuevo (Codex/Claude) necesita
para seguir sin re-descubrirlo.

Alcance: **solo La Casa** (`brand_id = "casa"`), un comercio (19931450), una
terminal (55609547), todo UYU, acredita en BROU. Pirone/fábrica no tiene POS.

## Qué está construido (y en producción)

**Backend Fiserv — `carpinteria/fiserv.py`**
- Lee el Merchant Center por su API JSON (login TOTP con `pyotp`, sin navegador,
  sin mail, sin archivos). Detalle de la API en `docs/railway-fiserv-cron.md`.
- `sync_range(start, end)` / `sync_day(day)`: upsert idempotente a Mongo. Devuelve
  `last_transaction_date` para respetar "solo hasta el último día cargado".
- `panel(year, month)`: agregación para el panel admin "Tarjetas".
- `export_tax_report(year, month)`: Excel mensual para el contador.
- Cron nocturno: `carpinteria/fiserv_cron.py` (23:00 UY), servicio `fiserv-cron`.

**Colecciones Mongo**
- `fiserv_transactions` — un doc por cupón. Clave única `fiserv_id`. Campos:
  `sale_date`, `auth_datetime`, `transaction_type` (`C` compra / `A` anulación /
  `D` devolución), `state` (`2` = Completa), `batch` (lote), `ticket` (cupón),
  `bill_number` (**nº de factura que el cajero tipea en el POS** — 437/437 lo
  traen), `product_name`, `card_last4`, `total_amount`, `tax_refund` (`x#19210`).
- `fiserv_settlements` — un doc por liquidación. Clave `source_key`
  (`<settlement_number>:<product_code>`). `net_amount`, `gross_amount`,
  `payment_date` (fecha real de acreditación), `presentation_date`, y `concepts`
  con el desglose fiscal: `tariff` (arancel), `tariff_vat` (IVA arancel),
  `tax_credit_19210` (reducción IVA Ley 19.210), `withholding_17453` (retención
  Ley 17.453), `advance_cost`/`advance_vat` (anticipo), `fiserv_charge`
  (contracargo), `net_payment`.
- `fiserv_payment_calendar` — agenda de pagos por `payment_date`.
- `accounting_till_handovers` — entrega de caja del cajero (ver abajo). Único por
  `(brand_id, date)`.

**Caja diaria — `carpinteria/accounting.py` + UI en
`web/src/features/accounting/AccountingWorkspace.tsx`**
- **"Entregar caja"** (tab Planilla diaria, cualquier usuario de casa): acto del
  cajero, distinto del cierre contable admin. Pide **efectivo contado**
  obligatorio, registra el arqueo (diferencia contado − teórico; +sobrante /
  −faltante) **sin corregirlo nunca**, trae los cupones del día en vivo, y congela
  el día para el cajero (rehacer exige `override`). El cajero ya no tipea las
  tarjetas.
- **Conciliación caja↔POS por LOTE** (no por fecha): `conciliate_cards(date)`
  agrupa los cupones de Fiserv por medio (VISA DEBITO→visa_debito, VISA
  CREDITO→visa_credito, Debit Mastercard + **Mastercard prepago**→master_debito,
  Mastercard Crédito→master_credito, Maestro→maestro) y compara contra lo
  declarado. Un **faltante** (POS > caja) agrega un blocker `card_faltante` al
  cierre contable admin; el **sobrante** solo avisa; al cajero nunca lo bloquea.
- **Integridad de cupones** (Q31): marca cupón sin factura, factura repetida o
  fuera de rango. Ver el CAVEAT de series más abajo.
- **Acreditaciones propuestas** (Q9): cada liquidación propone un movimiento
  financiera→banco BROU; el admin lo confirma con un click
  (`confirm_card_settlement`, idempotente vía `source_key`
  `fiserv-settlement:<n>`). Tras un mes sin ajustes se puede pasar a automático.
- **Panel admin "Tarjetas"** (tab, solo administración): próximos cobros por fecha
  real de acreditación (anticipo incluido) + total 7 días; costo del mes partido
  en tres bloques — **costo Fiserv** (arancel + IVA + anticipo) / **créditos
  fiscales recuperables** (19.210 + 17.453, NO son costo, se deducen en DGI) /
  **contracargos**, con el anticipo aislado; detalle por producto; cupones
  buscables por últimos 4 o factura; "Sincronizar ahora"; "Exportar contador".

## Decisiones tomadas (para no re-litigarlas)

- Fuente única = API del portal. El flujo de mail/adjuntos se descartó.
- El costo de Fiserv se muestra separado de los créditos fiscales (mezclarlos hace
  ver a Fiserv el doble de caro). Reemplaza el "descuento estimado 2,5%" plano de
  la planilla vieja.
- Cadencia: sync bajo demanda al abrir "Entregar caja" + cron nocturno 23:00.
- Depósitos/transferencias y Mercado Libre → directo a banco con su medio (no
  pasan por caja). Master prepago se dobla en "Master débito" para el cajero (el
  panel admin lo muestra separado porque Fiserv lo trae así).
- Devolución/anulación por POS → nota de crédito contra financiera, nunca caja.
- Retiros para BPS/DGI/sueldos de otras empresas (Dirolan, Alina, Apacible, Nilmo,
  doméstica) → retiros de socio con la empresa destino como subcategoría.
- Ventas: por ahora un movimiento por día con el rango de facturas (como la
  planilla). Importar CFE emitidos es la v2 (relación 2 abajo).

## Cómo se relaciona Fiserv con "las facturas" (roadmap, NO implementado)

Hay tres relaciones distintas; conviene no mezclarlas.

1. **Cupón Fiserv ↔ factura de venta (nº que tipea el cajero).** El link ya existe
   al 100% (`bill_number` en cada cupón). Habilita conciliar facturación vs cobros
   con tarjeta y detectar cupón sin factura / factura cobrada dos veces. Es el
   *"Según Memory vs Según Excel"* de la solapa Resumen, automatizado.
2. **Cupón Fiserv ↔ CFE emitido (UCFE ventas).** La versión "de verdad" de la 1:
   matchear contra las facturas electrónicas realmente emitidas en vez del número
   tipeado. Existe `scripts/ucfe_ventas_articulo.py` pero los CFE de venta NO están
   sincronizados a Mongo todavía. Es el proyecto grande: la caja se llena sola y
   "Según Memory" se puebla solo. Clave del cruce: `bill_number` ↔ serie/número CFE.
3. **Liquidación Fiserv ↔ factura que Fiserv le emite al comercio (arancel).**
   Fiserv factura al comercio por su servicio; son CFE **recibidos** → ya tienen
   camino por el sync de UCFE recibidos → `supplier_invoices` → cuenta 5510
   "Comisiones de tarjetas", y el **IVA del arancel es crédito fiscal**. La API de
   liquidaciones NO trae el nº de esa factura; para cerrar el círculo hay que leer
   la sección "Documentación Fiscal" del portal o matchear por monto/fecha contra
   los CFE recibidos del RUT de Fiserv.

Preguntas abiertas que definen la 1 vs la 2: ¿cuál es la fuente de verdad de las
facturas de venta — "Memory" (¿qué es, se lee por API/export?), los CFE emitidos
en UCFE, o el rango que el cajero anota a mano? Recomendación: hacer la 1 primero
(corrige el CAVEAT de series y da conciliación factura-por-factura), la 2 después.

## CAVEAT conocido — series de factura múltiples

`_coupon_integrity` en `accounting.py` marca `out_of_range` usando un único rango
min–max de los nº de factura registrados del día. En los datos reales conviven
**varias series en paralelo** (26xxx, 76xxx, 86xxx en un mismo día), así que ese
flag da falsos positivos/negativos. La solución correcta es cruzar contra la lista
real de facturas emitidas por serie (relación 2). Hasta entonces, tratar
`out_of_range` como aproximación, no como verdad. Hay un comentario en el código.

## Estado operativo (Railway)

- Servicios: `carpinteria` (web), `ucfe-cron`, `fiserv-cron`. Todos comparten
  imagen Docker. Variables Fiserv (`FISERV_USER/PASS/TOTP_SECRET`) viven en el
  servicio `carpinteria` y se referencian desde `fiserv-cron`.
- **Anclaje `/app`**: el `WORKDIR` final de la imagen es `/app/web`, donde
  `carpinteria` no es importable (uv trata el proyecto como virtual). Todo
  entrypoint de cron va anclado: `uv run --directory /app python -m carpinteria.X`
  + `ENV PYTHONPATH=/app` en el Dockerfile. Saltarse esto = el crash diario de las
  06:00 que emitía Railway (era `ucfe-cron`, ya arreglado).
- Config: hoy con Config-as-Code (per-servicio `railway.*.toml` + "Config file
  path" en el dashboard). Railway lo marcó **deprecated, corte 2026-12-01**, y
  empuja a Infrastructure-as-Code (`.railway/railway.ts` + su TS SDK, un archivo
  para todo el proyecto). Migración pendiente y opcional antes de esa fecha.
- **Backfill histórico**: se cargó ~1 mes (fin jul–ago 2026). Pendiente completar
  hacia atrás (apuntar a 2026-03-01; el portal guarda ~6 meses) con
  `fiserv.sync_range(date(2026,3,1), hoy)`. Es idempotente.

## Seguridad

Credenciales de Fiserv solo en variables de entorno (Railway), nunca en el repo.
Rotar las contraseñas del portal periódicamente y actualizar `FISERV_PASS`. El
JWT del portal dura ~2h y va atado al fingerprint de headers (ver
`docs/railway-fiserv-cron.md`).
