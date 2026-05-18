# AGENTS.md — Cotizador Carpintería

Guía para cualquier agente (Codex, Claude Code, etc.) que toque este repo.
Apunta a darle a un LLM el contexto que un humano nuevo tarda media hora en
levantar: arquitectura, convenciones del proyecto, y los gotchas que
aprendimos a los golpes. Cuando aprendamos algo nuevo, lo agregamos acá.

---

## TL;DR del producto

Cotizador de carpintería para una empresa familiar de Uruguay (La Casa del
Carpintero). Permite dos flujos:

1. **Chat-driven (`/chat`)**: subís un pliego (PDF/XLSX/imagen), un agente
   con vision API descompone los muebles en piezas y herrajes, y después
   editás la cotización conversando o con inputs estructurados.
2. **Cotizador clásico (`/`)**: formulario tradicional para cotizar un
   mueble (legacy, lo dejamos andando).

Catálogo de placas viene del sheet "Activa" (sincronizado). Precios de
herrajes son una lista curada con override manual (otra hoja). Salidas:
Excel + Word.

---

## Stack

- **Python 3.12+** (gestión via `uv`). Subprocess invocado por Next.
- **Next 16 (App Router) + React 19** en `web/`. Tailwind v4 + shadcn/ui
  (style `base-nova` con tokens custom — ver `web/src/app/globals.css`).
- **Mongo Atlas** como persistence. Colecciones: `quotation_sessions`,
  `memory`, `hardware_prices`.
- **OpenAI Agents SDK** (`openai-agents`) para el chat. Modelo por defecto
  `gpt-4.1-mini`. Conversación persistida via `last_response_id`.
- **Google Sheets API** para el catálogo Activa y precios de herrajes.

Frontend libraries que usamos en código nuevo (orden de preferencia):
- `@tanstack/react-query` para server state (NO `useEffect`+`fetch`).
- `react-hook-form` + `zod` + `@hookform/resolvers/zod` para forms.
- `@tanstack/react-table` para grids/tables.
- `zustand` para client state cross-component (poco usado todavía).
- `lucide-react` para iconos.
- `date-fns` (con `/locale/es`) para fechas.
- `react-markdown` + `remark-gfm` para markdown del chat.
- `@tailwindcss/typography` para clases `prose`.

Skills espejadas desde `bonoxs-automation-front/.claude/skills/`:
- `vercel-composition-patterns` — componer componentes React.
- `vercel-react-best-practices` — performance, async, bundle, client.
- `vercel-react-view-transitions` — transitions.
- `web-design-guidelines` — diseño web.

Leélas antes de tocar UI / composition.

---

## Convenciones que importan

1. **Cross-platform**. Código corre en Mac (autor), Linux (Railway) y
   Windows (teammate). Reglas:
   - Python: `pathlib.Path` / `os.path.join`, NUNCA `/` hardcoded.
     `tempfile.gettempdir()`, NUNCA `/tmp`.
   - Node: subprocess llama `uv run python -m carpinteria.cli_api`
     (NO `python3` — no existe en Windows).
   - Sin `chmod +x`, sin shell bash en npm scripts.

2. **Mongo siempre está**. NO envolver llamadas a Mongo en `try/except`
   para degradar silencioso. Si falla, que truene. Igual aplica a OpenAI
   y Google Sheets — son dependencias duras.

3. **Defaultear a librerías conocidas**. Si estás por escribir >50 líneas
   de plumbing para un concern genérico (tabla, form, fetcher, dialog,
   command palette, drag-drop, etc.), parar y buscar librería. La razón:
   los LLM mantienen mejor el código cuando reconocen patrones.

4. **NO migrar lo legacy por las dudas**. `app/page.tsx` (cotizador
   clásico) y `app/lista-precios` usan un stack más viejo. Tocá solo si
   el cambio en cuestión lo requiere.

5. **Sin comentarios decorativos**. Comentarios solo cuando explican un
   *por qué* no-obvio (constraint oculto, workaround, invariante).
   Identificadores claros > comentarios.

6. **Markdown del chat con `prose`**. NO escribir clases descendientes
   tipo `[&_p]:my-1 [&_ul]:list-disc` — usá el plugin typography que ya
   está instalado.

---

## Arquitectura

### Layout del repo

```
.
├── carpinteria/              # Backend Python
│   ├── cli_api.py            # Entry point: action-based dispatch (stdin/stdout JSON)
│   ├── db.py                 # Mongo client (env: MONGO_URL, MONGO_DB)
│   ├── memory.py             # Cross-session "facts" guardados por el chat
│   ├── quotation_session.py  # Modelo principal: sesión + items + mensajes
│   ├── agents/
│   │   └── cotizador_chat.py # Agente OpenAI Agents SDK + 13 tools
│   ├── calculator.py         # Cálculo de placa/canto/recargos
│   ├── catalog.py            # Wrapper del catálogo Activa
│   ├── pliego.py             # Vision API → descompone muebles
│   ├── hardware_catalog.py   # Lista curada de códigos de herrajes
│   ├── hardware_prices_sheet.py # CRUD precios en sheet
│   └── settings.py           # Defaults: margen, recargos, etc.
├── web/                      # Frontend Next
│   ├── src/app/              # Routes (App Router)
│   │   ├── chat/             # Chat-driven UI (entry: page.tsx → features/chat/Chat)
│   │   ├── lista-precios/    # Legacy
│   │   ├── api/              # API routes (todas delegan a callPython)
│   │   ├── layout.tsx        # Wrap con AppSidebar + Providers (React Query)
│   │   └── globals.css       # Design tokens (variables OKLCH)
│   ├── src/features/chat/
│   │   ├── Chat.tsx          # Root del flow chat
│   │   ├── api.ts            # Fetchers + zod schemas + qk (query keys)
│   │   ├── schemas.ts        # Tipos compartidos (zod)
│   │   └── components/       # ChatColumn, QuotationPanel, ItemCard, ...
│   ├── src/components/
│   │   ├── AppSidebar.tsx    # Sidebar global icon-only (56px, tipo bonoxs)
│   │   └── ui/               # shadcn (NO editar, regenerar con `shadcn add`)
│   └── src/lib/python.ts     # `callPython({action, ...})` → subprocess
├── .claude/skills/           # Skills para agentes (espejadas de bonoxs)
└── AGENTS.md                 # Esto
```

### Cómo se comunica Next con Python

`web/src/lib/python.ts` hace `spawn("uv", ["run", "python", "-m",
"carpinteria.cli_api"])` y le manda JSON por stdin, recibe JSON por
stdout. Cada call es un proceso nuevo (~1-2s de overhead — primer call
a Mongo es lazy).

Patrón de un handler en `cli_api.py`:

```python
def handle_FOO(data: dict) -> dict:
    # 1. Leer inputs de `data`.
    # 2. Tocar Mongo / sheets / etc.
    # 3. Devolver dict serializable.
    return {"session": s.model_dump(mode="json")}
```

Y wiring en `main()`:

```python
elif action == "foo":
    result = handle_foo(data)
```

Patrón de un endpoint Next:

```ts
const result = await callPython({ action: "foo", session_id: id, ... });
return NextResponse.json(result);
```

### Cómo funciona el agente de chat

1. Usuario manda mensaje → `POST /api/chat` → `cli_api.handle_chat` →
   `cotizador_chat.run_turn(session_id, message)`.
2. `run_turn`:
   - Carga la sesión de Mongo.
   - Persiste el mensaje del usuario en `session.messages`.
   - Construye el agente con `build_agent(session)` — **inyecta el
     snapshot del estado de la sesión en el system prompt** + facts de
     memoria global. Esto es crítico: si subiste un pliego por la UI sin
     hablar con el agente, el thread del Responses API arrancaba vacío;
     el snapshot le pone al día.
   - Llama `Runner.run(agent, message, previous_response_id=...)`.
   - Persiste `last_response_id` + el reply del assistant en la sesión.

Tools disponibles (13): `get_state`, `ingest_pliego`, `set_color`,
`set_payment_days`, `set_destination`, `set_hardware_quantity`,
`set_hardware_price`, `list_hardware_catalog`, `set_piece_quantity`,
`recalculate`, `remember_fact`, `forget_fact`, `list_facts`.

Memoria persistente (`carpinteria/memory.py`):
- Colección `memory` en Mongo, modelo `MemoryFact(id, text, tags, created_at)`.
- Se inyecta entera en el system prompt en cada turno (cuando hay <50,
  no hace falta RAG).
- Flujo: si el usuario dice explícito "anotá…", el agente llama
  `remember_fact` directo. Si vos detectás algo recurrente, preguntá
  primero y guardás solo después de confirmación. Está escrito en
  `INSTRUCTIONS_BASE`.

### Data model

`QuotationSession` (Mongo `quotation_sessions`):
- `id`, `created_at`, `updated_at`, `title`, `user_id`.
- `last_response_id` — thread chain del Responses API.
- `messages: list[ChatMessage]` — historial. Se hidrata al cargar.
- `items: list[QuotationItem]` — los muebles cotizados.
- `color_default`, `payment_days`, `destination`, `general_specs`.
- `pliego_filenames` — audit.

`QuotationItem`:
- `code`, `name`, `quantity`, `material`, `thickness_mm`, `color`.
- `placa_sku` — si el usuario fijó manualmente una placa del catálogo
  Activa, el calculator usa ese SKU directo en vez de heurístico.
- `pieces: list[CutPiece]` (width/height/qty/label/edge_sides).
- `hardware: list[HardwareUsage]` (code/qty/...).
- `last_quote: dict | None` — resultado del calculator cacheado.

`MemoryFact` (Mongo `memory`): `id`, `text`, `tags`, `created_at`.

---

## Cómo correr / testear

### Dev

```bash
# Backend solo (test directo de un handler):
echo '{"action":"session_list"}' | uv run python -m carpinteria.cli_api

# Frontend + backend integrados:
cd web && npm run dev   # http://localhost:3000
```

`.env` en la raíz (NO en `web/`): variables consumidas por el subprocess.
Mínimo:
- `MONGO_URL` y `MONGO_DB` (Mongo Atlas).
- `OPENAI_API_KEY` (modelos de OpenAI hardcodeados en `settings.py`).
- `GOOGLE_SHEETS_SPREADSHEET_ID` (catálogo Activa).
- Credenciales Google: `GOOGLE_SERVICE_ACCOUNT_FILE` (path local) o
  `GOOGLE_SERVICE_ACCOUNT_JSON` (contenido inline para producción).
  La lógica vive en `carpinteria/google_creds.py:load_credentials`.

El TC USD/UYU se obtiene en vivo del BCU (`exchange_rate.fetch_bcu_usd`),
no hay variable para hardcodearlo.

### Producción (Railway)

- Mongo Atlas con `0.0.0.0/0` whitelisted (Railway no tiene IPs fijas).
- Variables en el dashboard de Railway (no en este repo).
- Single service: Dockerfile arranca Next con `next start` en `$PORT`.
  El subprocess Python se invoca on-demand igual que en dev.

### Type-check / lint

```bash
cd web && npx tsc --noEmit -p .       # Pre-existen errores en app/page.tsx (legacy).
cd web && npm run lint                 # ESLint.
```

No hay tests de Python automatizados — se prueba a mano via el endpoint
o por la UI.

---

## Gotchas conocidos

- **Atlas SSL TLSV1_ALERT_INTERNAL_ERROR**: significa "tu IP no está
  whitelisted". Atlas tira ese mensaje confuso en vez de "IP not allowed".
  Fix: whitelistear en Network Access.
- **Subprocess lento la primera vez**: Mongo connect tarda 1-2s en cold.
  En producción se nota menos (proceso warm).
- **Errores TS en `app/page.tsx`**: pre-existentes, legacy. No bloquean.
- **`MONGO_URL` no presente**: el cliente trunea con KeyError. Es lo
  correcto (ver convención 2). Cargá `.env` con dotenv o setealo
  explícito antes de correr.

---

## Pendientes / ideas

Si Codex / el agente próximo va a tocar algo, esto es lo siguiente que
tiene sentido:

- Items editables soporta hoy: color/material/grosor/cantidad/qty de
  piezas/qty de herrajes/eliminar item. Falta: agregar pieza nueva,
  reordenar piezas, override de canto por item.
- Wizard "revisar uno por uno" — modo focus que va por cada item con
  inputs en grande, para validar pliegos largos.
- Mejor flow de mapping cuando una placa no matchea: hoy hay dropdown
  con todo Activa; podría aprender "aglomerado → MDF STD 18mm" y
  proponerlo solo la próxima vez.
- Tools de chat para cambios masivos (`apply_color_to_all`, `set_margin`).
- Stitch tiene un mockup útil para la Lista de Precios — podría guiar
  la migración de esa página al nuevo stack cuando llegue el momento.

---

## Última actualización
2026-05-04
