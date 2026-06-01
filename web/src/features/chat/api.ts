import { z } from "zod";
import {
  BoardOptionSchema,
  MemoryFactSchema,
  SessionArchiveMonthSchema,
  SessionRowSchema,
  SessionSchema,
  type Session,
} from "./schemas";

// Tiny fetch wrapper. We keep it close to fetch — TanStack Query handles
// caching and retries; this just enforces JSON + surfaces errors.
async function api<T>(
  url: string,
  init: RequestInit | undefined,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Query keys (kept centralised so invalidations are easy to grep for)
// ---------------------------------------------------------------------------

export const qk = {
  sessions: (brandId?: string) => ["sessions", brandId ?? "current"] as const,
  sessionArchive: (year: number, brandId?: string) => ["sessions", "archive", year, brandId ?? "current"] as const,
  session: (id: string) => ["session", id] as const,
  memory: ["memory"] as const,
  boards: ["catalog", "boards"] as const,
  hardwareCatalog: ["catalog", "hardware"] as const,
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(brandId?: string) {
  const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
  return api(
    `/api/sessions${qs}`,
    undefined,
    z.object({ sessions: z.array(SessionRowSchema) }),
  ).then((d) => d.sessions);
}

export async function listSessionArchive(year = 2026, brandId?: string) {
  const params = new URLSearchParams({ archive: "1", year: String(year) });
  if (brandId) params.set("brandId", brandId);
  return api(
    `/api/sessions?${params.toString()}`,
    undefined,
    z.object({ months: z.array(SessionArchiveMonthSchema) }),
  ).then((d) => d.months);
}

export async function getSession(id: string) {
  return api(
    `/api/sessions/${id}`,
    undefined,
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function createSession(input: { title?: string; brandId?: string } = {}) {
  return api(
    "/api/sessions",
    { method: "POST", body: JSON.stringify(input) },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function patchSession(
  id: string,
  payload: Partial<{
    color_default: string;
    payment_days: number | null;
    destination: string;
    additional_services: {
      rectification?: boolean;
      installation?: boolean;
      painting?: boolean;
      varnishing?: boolean;
    };
    title: string;
    approval_status: "pending" | "approved";
    client_sent: boolean;
    client_accepted: "pending" | "yes" | "no";
    deposit_amount: number | null;
    order_number: string;
    ready_to_deliver: boolean;
    delivered: boolean;
    final_payment_amount: number | null;
  }>,
) {
  return api(
    `/api/sessions/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function deleteSession(id: string) {
  return api(
    `/api/sessions/${id}`,
    { method: "DELETE" },
    z.object({ deleted: z.boolean() }),
  );
}

export async function setItemPlaca(input: {
  sessionId: string;
  itemCode: string;
  placaSku: string | null;
}) {
  return api(
    `/api/sessions/${input.sessionId}/items/placa`,
    {
      method: "POST",
      body: JSON.stringify({ item_code: input.itemCode, placa_sku: input.placaSku }),
    },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

// SSE event shape emitted by the streaming /api/chat route.
export type ChatStreamEvent =
  | { type: "token"; delta: string }
  | { type: "tool_call"; tool: string }
  | { type: "tool_result"; output: string }
  | { type: "done"; reply: string; last_response_id: string | null }
  | { type: "error"; message: string };

/**
 * Async generator over the streamed agent turn. Each yielded item is a parsed
 * `ChatStreamEvent`. Throws if the HTTP response is not OK.
 */
export async function* streamChat(input: {
  sessionId: string;
  message: string;
}): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: input.sessionId, message: input.message }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Split on SSE record boundary (\n\n).
    let sep = buf.indexOf("\n\n");
    while (sep !== -1) {
      const record = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      // Each record is "data: <json>" (one line per record here).
      if (record.startsWith("data: ")) {
        const payload = record.slice(6).trim();
        if (payload) {
          try {
            yield JSON.parse(payload) as ChatStreamEvent;
          } catch {
            console.warn("Bad SSE chunk:", payload);
          }
        }
      }
      sep = buf.indexOf("\n\n");
    }
  }
}

export async function uploadPliego(input: {
  sessionId: string;
  files: File[];
}): Promise<Session | null> {
  const fd = new FormData();
  for (const f of input.files) fd.append("files", f);
  const res = await fetch(`/api/sessions/${input.sessionId}/upload-pliego`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data?.session ? SessionSchema.parse(data.session) : null;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function listMemory() {
  return api(
    "/api/memory",
    undefined,
    z.object({ facts: z.array(MemoryFactSchema) }),
  ).then((d) => d.facts);
}

export async function addMemoryFact(input: { text: string; tags?: string[] }) {
  return api(
    "/api/memory",
    {
      method: "POST",
      body: JSON.stringify({ text: input.text, tags: input.tags ?? [] }),
    },
    z.object({ fact: MemoryFactSchema }),
  ).then((d) => d.fact);
}

export async function deleteMemoryFact(id: string) {
  await fetch(`/api/memory/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listBoards() {
  return api(
    "/api/catalog/boards",
    undefined,
    z.object({ boards: z.array(BoardOptionSchema) }),
  ).then((d) => d.boards);
}

// ---------------------------------------------------------------------------
// Hardware prices
// ---------------------------------------------------------------------------

export async function setHardwarePrice(input: { code: string; price: number }) {
  await api(
    "/api/hardware-prices",
    {
      method: "POST",
      body: JSON.stringify({ code: input.code, price: input.price, updated_by: "panel" }),
    },
    z.unknown(),
  );
}

// ---------------------------------------------------------------------------
// Items (per-card editing)
// ---------------------------------------------------------------------------

export async function updateItem(input: {
  sessionId: string;
  itemCode: string;
  fields: Partial<{
    color: string;
    material: string;
    thickness_mm: number;
    quantity: number;
    name: string;
    edge_banding: string;
    notes: string;
  }>;
}) {
  return api(
    `/api/sessions/${input.sessionId}/items/${input.itemCode}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields: input.fields }),
    },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function deleteItem(input: { sessionId: string; itemCode: string }) {
  return api(
    `/api/sessions/${input.sessionId}/items/${input.itemCode}`,
    { method: "DELETE" },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function setPieceQuantity(input: {
  sessionId: string;
  itemCode: string;
  pieceLabel: string;
  quantity: number;
}) {
  return api(
    `/api/sessions/${input.sessionId}/items/${input.itemCode}/pieces`,
    {
      method: "PATCH",
      body: JSON.stringify({
        piece_label: input.pieceLabel,
        quantity: input.quantity,
      }),
    },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function upsertPiece(input: {
  sessionId: string;
  itemCode: string;
  piece: {
    label: string;
    width_mm: number;
    height_mm: number;
    quantity: number;
    edge_sides?: string[];
  };
}) {
  return api(
    `/api/sessions/${input.sessionId}/items/${input.itemCode}/pieces`,
    {
      method: "POST",
      body: JSON.stringify({ piece: input.piece }),
    },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function setItemHardwareQuantity(input: {
  sessionId: string;
  itemCode: string;
  hardwareCode: string;
  quantity: number;
}) {
  return api(
    `/api/sessions/${input.sessionId}/items/${input.itemCode}/hardware`,
    {
      method: "PATCH",
      body: JSON.stringify({
        hardware_code: input.hardwareCode,
        quantity: input.quantity,
      }),
    },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

const HardwareCatalogEntrySchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
});
export type HardwareCatalogEntry = z.infer<typeof HardwareCatalogEntrySchema>;

export async function listHardwareCatalog() {
  return api(
    "/api/catalog/hardware",
    undefined,
    z.object({ hardware: z.array(HardwareCatalogEntrySchema) }),
  ).then((d) => d.hardware);
}

// Augment qk in place for the catalog hardware key.
declare module "./api" {}

