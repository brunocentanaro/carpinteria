# Cron UCFE en Railway

Usar dos servicios Railway que parten del mismo repositorio e imagen Docker:

| Servicio | Comando de inicio | Cron |
| --- | --- | --- |
| `web` | dejar el `CMD` del Dockerfile | no aplica |
| `ucfe-cron` | `uv run --directory /app python -m carpinteria.ucfe_cron` | `15 9 * * *` |

> **Anclar en `/app`.** El `WORKDIR` final de la imagen es `/app/web` (lo
> necesita `next start`), pero el paquete `carpinteria` solo es importable desde
> `/app` (uv trata el proyecto como virtual, así que `uv sync` no lo instala).
> Un `startCommand` con el `uv run python -m carpinteria.…` pelado corre desde
> `/app/web` y falla con `ModuleNotFoundError: No module named 'carpinteria'` —
> ese fue el crash diario que emitía el mail de las 06:00. El `--directory /app`
> lo resuelve, y el Dockerfile además setea `ENV PYTHONPATH=/app` (defensa en
> profundidad). La config-as-code de Railway **no** puede setear variables de
> entorno, por eso `PYTHONPATH` va en el Dockerfile, no en el `.toml`.

`15 9 * * *` es 09:15 UTC, equivalente a 06:15 en Uruguay. Railway evalúa los
crones en UTC. El servicio `ucfe-cron` no necesita dominio público y debe usar
las mismas variables `MONGO_URL`, `MONGO_DB`, `UCFE_USERNAME`,
`UCFE_PASSWORD`, `UCFE_ID_EMPRESA` y `UCFE_SYNC_LOOKBACK_DAYS` que el servicio
web.

El proceso sincroniza por defecto los últimos siete días. La ventana se solapa
para cubrir comprobantes cargados tarde; los índices únicos por comprobante y
línea hacen que repetir ejecuciones no duplique datos. El proceso cierra Mongo
y termina al finalizar, requisito para que Railway pueda ejecutar el próximo
cron. UCFE limita el listado a 500 comprobantes por consulta y no pagina de
forma confiable; si el rango excede ese máximo, el cron falla de forma visible.
Reducir `UCFE_SYNC_LOOKBACK_DAYS` a `3` o `1` en ese caso.

Para crear el servicio:

1. En el mismo proyecto Railway, crear un servicio desde el mismo repositorio.
2. Mantener el Dockerfile compartido y configurar el comando de inicio indicado.
3. Copiar o referenciar las variables del servicio `web`.
4. En Settings, configurar Cron Schedule con `15 9 * * *`.
5. Lanzar una ejecución manual desde Railway y **verificar el JSON en logs**
   antes de habilitar el cron. Si aparece `ModuleNotFoundError: No module named
   'carpinteria'`, el `startCommand` no está anclado en `/app` (ver recuadro
   arriba). El cron de Fiserv usa el mismo patrón: ver
   `docs/railway-fiserv-cron.md`.
