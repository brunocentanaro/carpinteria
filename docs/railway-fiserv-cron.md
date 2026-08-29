# Cron Fiserv en Railway

Sincroniza el Merchant Center de Fiserv (transacciones, liquidaciones y agenda de
pagos) a Mongo todas las noches, como un servicio Railway aparte que parte del
mismo repositorio e imagen Docker que `web`. Config-as-code en
`railway.fiserv-cron.toml`.

| Servicio | Comando de inicio | Cron |
| --- | --- | --- |
| `fiserv-cron` | `uv run --directory /app python -m carpinteria.fiserv_cron` | `0 2 * * *` |

`0 2 * * *` es 02:00 UTC = 23:00 en Uruguay: corre después del cierre de la
tienda, con el lote del día ya liquidado. Railway evalúa los crones en UTC.

## Variables

El servicio necesita, referenciadas del servicio `carpinteria` (web):

- `MONGO_URL` (y opcional `MONGO_DB`).
- `FISERV_USER`, `FISERV_PASS`, `FISERV_TOTP_SECRET` — credenciales del usuario
  de solo lectura del portal (`bcentanaro@hotmail.com`, roles Conciliador +
  Operador). El secreto TOTP es el que enrola Google Authenticator; con él
  `pyotp` genera el código de 6 dígitos sin intervención humana. **Nunca**
  commitear estos valores.
- `FISERV_SYNC_LOOKBACK_DAYS` (opcional, default `10`): días hacia atrás que
  solapa cada corrida. El solapamiento cubre liquidaciones que Fiserv publica
  tarde; las claves únicas por transacción (`fiserv_id`) y por liquidación
  (`settlement_number:product_code`) hacen que repetir ejecuciones no duplique.

## Anclar en `/app`

Igual que el cron de UCFE: el `WORKDIR` final de la imagen es `/app/web`, donde
`carpinteria` no es importable. El `startCommand` usa `uv run --directory /app` y
el Dockerfile setea `ENV PYTHONPATH=/app`. Ver el recuadro en
`docs/railway-ucfe-cron.md`.

## Crear el servicio

1. En el mismo proyecto Railway, crear un servicio desde el mismo repositorio.
2. Mantener el Dockerfile compartido; en Settings apuntar "Config file path" a
   `railway.fiserv-cron.toml`.
3. Referenciar las variables del servicio `web` (más las `FISERV_*`).
4. Lanzar una ejecución manual y verificar el JSON en logs (debe traer
   `transactions_seen`, `settlements_seen`, `calendar_days` y
   `last_transaction_date`) antes de confiar en el cron.

## Sincronización bajo demanda

Además del cron nocturno, la app llama a `carpinteria.fiserv.sync_range` /
`sync_day` cuando el cajero abre "Entregar caja", para tener los cupones del día
en el momento exacto del cierre. El cron nocturno garantiza que el día quede
completo aunque nadie entregue caja.

## Notas de la API (interna, no oficial de Fiserv)

- Login en dos pasos: `POST /api/Users/requestOtp` → `totpToken`, luego
  `POST /api/Users/authenticate` con el código TOTP → JWT (~2 h).
- El JWT queda atado al fingerprint de headers (User-Agent + `sec-ch-ua` +
  Accept-Language); `carpinteria/fiserv.py` los mantiene fijos. Radware Bot
  Manager desafía los GET y las descargas de archivos, pero los POST de la API
  pasan con las cookies `__uzm*` de la primera respuesta en la sesión.
- Endpoints usados: `/api/Transaction/Transactions` (transacciones del día),
  `/settlement/Settlement/SettlementListDaily` (liquidaciones con conceptos) y
  `/settlement/Settlement/getSettlementCalendar` (agenda de pagos por fecha real
  de acreditación, con anticipo incluido). El backend de liquidaciones devuelve
  un 502 transitorio de vez en cuando; el cliente reintenta.
