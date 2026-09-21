import { z } from "zod";

export const requestValuesSchema = z.object({
  recipient_id: z.string().min(1, "Elegí un destinatario"),
  category: z.string().min(1, "Elegí una categoría"),
  product: z.string().trim().min(1, "Indicá el producto").max(200),
  quantity: z.number().positive("La cantidad debe ser mayor a cero").max(1000000),
  unit: z.enum(["unidades", "metros", "m²", "m³", "kg", "litros", "cajas", "paquetes"]),
  needed_date: z.union([z.literal(""), z.iso.date()]),
  notes: z.string().trim().max(3000),
});
export type RequestValues = z.infer<typeof requestValuesSchema>;
export const STATUS = { pending: "Pendiente", in_progress: "En preparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" };
export const BRANDS: Record<string, string> = { casa: "La Casa del Carpintero", pirone: "Juan Pirone" };
const messageSchema = z.object({ id: z.string(), author: z.string(), brand_id: z.string(), text: z.string(), kind: z.string(), created_at: z.string() });
const requestSchema = requestValuesSchema.extend({
  id: z.string(), from_brand: z.string(), to_brand: z.string(), sender: z.string(),
  status: z.enum(["pending", "in_progress", "ready", "delivered", "cancelled"]),
  created_at: z.string(), updated_at: z.string(), messages: z.array(messageSchema).default([]),
});
export type ProductRequest = z.infer<typeof requestSchema>;
const inboxSchema = z.object({ requests: z.array(requestSchema), has_more: z.boolean(), recipients: z.array(z.object({ id: z.string(), name: z.string() })), categories: z.array(z.string()), viewer: z.string(), can_view_team: z.boolean() });
export type Inbox = z.infer<typeof inboxSchema>;

async function api(brand: string, suffix = "", method = "GET", body?: unknown) {
  const response = await fetch(`/api/internal-requests?brandId=${encodeURIComponent(brand)}${suffix}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "No se pudo acceder al chat interno");
  return data;
}
export async function getInbox(brand: string, limit: number) { return inboxSchema.parse(await api(brand, `&limit=${limit}`)); }
export async function getRequest(brand: string, id: string) { return requestSchema.parse((await api(brand, `&id=${encodeURIComponent(id)}`)).request); }
export async function createRequest(brand: string, values: RequestValues) { return requestSchema.parse((await api(brand, "", "POST", values)).request); }
export async function reply(brand: string, id: string, text: string) { return requestSchema.parse((await api(brand, "", "PATCH", { id, text })).request); }
export async function changeStatus(brand: string, id: string, status: ProductRequest["status"]) { return requestSchema.parse((await api(brand, "", "PATCH", { id, status })).request); }
