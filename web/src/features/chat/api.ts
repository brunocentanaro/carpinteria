import { z } from "zod";
import {
  BoardOptionSchema,
  MemoryFactSchema,
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
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  memory: ["memory"] as const,
  boards: ["catalog", "boards"] as const,
  hardwareCatalog: ["catalog", "hardware"] as const,
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions() {
  return api(
    "/api/sessions",
    undefined,
    z.object({ sessions: z.array(SessionRowSchema) }),
  ).then((d) => d.sessions);
}

export async function getSession(id: string) {
  return api(
    `/api/sessions/${id}`,
    undefined,
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
}

export async function createSession(input: { title?: string } = {}) {
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
  }>,
) {
  return api(
    `/api/sessions/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    z.object({ session: SessionSchema }),
  ).then((d) => d.session);
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

export async function sendChat(input: { sessionId: string; message: string }) {
  return api(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({ session_id: input.sessionId, message: input.message }),
    },
    z.object({
      reply: z.string().default(""),
      last_response_id: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  );
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

