import { z } from "zod";

// ---------------------------------------------------------------------------
// Wire format used by the Python subprocess. We validate at the boundary so
// the UI types are always trustworthy.
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  ts: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const QuotationItemSchema = z.object({
  code: z.string(),
  name: z.string().default(""),
  quantity: z.number(),
  description: z.string().default(""),
  dimensions: z
    .object({
      width_mm: z.number().optional(),
      height_mm: z.number().optional(),
      depth_mm: z.number().optional(),
    })
    .catchall(z.number())
    .default({}),
  material: z.string().default(""),
  thickness_mm: z.number(),
  color: z.string().default(""),
  edge_banding: z.string().default(""),
  placa_sku: z.string().nullable().default(null),
  pieces: z
    .array(
      z.object({
        width_mm: z.number(),
        height_mm: z.number(),
        quantity: z.number(),
        label: z.string().default(""),
        edge_sides: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  hardware: z
    .array(
      z.object({
        code: z.string(),
        name: z.string().default(""),
        category: z.string().default(""),
        unit: z.string().default("unidad"),
        quantity: z.number(),
      }),
    )
    .default([]),
  last_quote: z
    .object({
      total: z.number().optional(),
      total_with_hardware: z.number().optional(),
      pending_hardware_codes: z.array(z.string()).optional(),
      notes: z.string().optional(),
      lines: z.array(z.unknown()).optional(),
      hardware_lines: z.array(z.unknown()).optional(),
    })
    .nullable()
    .default(null),
  notes: z.string().default(""),
});
export type QuotationItem = z.infer<typeof QuotationItemSchema>;

export const MolduraQuoteSchema = z.object({
  code: z.string().default(""),
  family: z.string().default(""),
  description: z.string().default(""),
  width_mm: z.number(),
  height_mm: z.number(),
  material: z.string().default(""),
  quantity: z.number().default(1),
  unit: z.string().default("varilla"),
  unit_price: z.number().default(0),
  total: z.number().default(0),
  iva_included: z.boolean().default(true),
  estimated: z.boolean().default(false),
  source: z.string().default(""),
  note: z.string().default(""),
  breakdown: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().optional(),
});
export type MolduraQuote = z.infer<typeof MolduraQuoteSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  user_id: z.string().default("anonymous"),
  brand_id: z.string().default("casa"),
  requested_by: z.string().default("anonymous"),
  request_area: z.string().default("personal"),
  factory_order: z.boolean().default(false),
  approval_status: z.enum(["pending", "approved"]).default("pending"),
  client_sent: z.boolean().default(false),
  client_accepted: z.enum(["pending", "yes", "no"]).default("pending"),
  deposit_amount: z.number().nullable().default(null),
  order_number: z.string().default(""),
  order_created_at: z.string().nullable().default(null),
  ready_to_deliver: z.boolean().default(false),
  delivered: z.boolean().default(false),
  final_payment_amount: z.number().nullable().default(null),
  sequence: z.number().default(0),
  year: z.number().nullable().default(null),
  month: z.number().nullable().default(null),
  folder: z.string().default(""),
  total: z.number().default(0),
  last_response_id: z.string().nullable().default(null),
  items: z.array(QuotationItemSchema).default([]),
  moldura_quotes: z.array(MolduraQuoteSchema).default([]),
  color_default: z.string().default(""),
  payment_days: z.number().nullable().default(null),
  destination: z.string().default(""),
  additional_services: z
    .object({
      rectification: z.boolean().default(false),
      installation: z.boolean().default(false),
      painting: z.boolean().default(false),
      varnishing: z.boolean().default(false),
      polishing: z.boolean().default(false),
    })
    .default({
      rectification: false,
      installation: false,
      painting: false,
      varnishing: false,
      polishing: false,
    }),
  general_specs: z
    .object({
      colors: z.array(z.string()).default([]),
      delivery_location: z.string().default(""),
      delivery_days: z.number().nullable().default(null),
      payment_terms: z.string().default(""),
      materials: z.string().default(""),
      edge_banding: z.string().default(""),
      offer_maintenance_days: z.number().nullable().default(null),
      samples_required: z.string().default(""),
      bid_guarantee: z.string().default(""),
      performance_guarantee: z.string().default(""),
      product_warranty: z.string().default(""),
      other_conditions: z.string().default(""),
    })
    .partial()
    .optional(),
  pliego_filenames: z.array(z.string()).default([]),
  messages: z.array(ChatMessageSchema).default([]),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionRowSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  created_at: z.string().optional(),
  updated_at: z.string(),
  sequence: z.number().default(0),
  brand_id: z.string().default("casa"),
  requested_by: z.string().default("anonymous"),
  request_area: z.string().default("personal"),
  factory_order: z.boolean().default(false),
  approval_status: z.enum(["pending", "approved"]).default("pending"),
  client_sent: z.boolean().default(false),
  client_accepted: z.enum(["pending", "yes", "no"]).default("pending"),
  deposit_amount: z.number().nullable().default(null),
  order_number: z.string().default(""),
  order_created_at: z.string().nullable().default(null),
  ready_to_deliver: z.boolean().default(false),
  delivered: z.boolean().default(false),
  final_payment_amount: z.number().nullable().default(null),
  total: z.number().default(0),
  year: z.number(),
  month: z.number(),
  folder: z.string().default(""),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const SessionArchiveMonthSchema = z.object({
  year: z.number(),
  month: z.number(),
  folder: z.string(),
  count: z.number(),
  sessions: z.array(SessionRowSchema),
});
export type SessionArchiveMonth = z.infer<typeof SessionArchiveMonthSchema>;

export const MemoryFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  tags: z.array(z.string()).default([]),
  created_at: z.string().optional(),
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const BoardOptionSchema = z.object({
  sku: z.string(),
  label: z.string(),
  familia: z.string().nullable(),
  material: z.string().nullable(),
  espesor_mm: z.number().nullable(),
  precio_usd: z.number().nullable(),
});
export type BoardOption = z.infer<typeof BoardOptionSchema>;

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------

export const GlobalsFormSchema = z.object({
  color_default: z.string(),
  payment_days: z.string(), // input type=number, parsed at submit
  destination: z.string(),
});
export type GlobalsFormValues = z.infer<typeof GlobalsFormSchema>;

export const HardwarePriceSchema = z.object({
  code: z.string().min(1),
  price: z
    .string()
    .min(1)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
      message: "Precio inválido",
    }),
});
export type HardwarePriceValues = z.infer<typeof HardwarePriceSchema>;

export const MemoryFactDraftSchema = z.object({
  text: z.string().min(1, "Escribí algo para recordar"),
});
export type MemoryFactDraft = z.infer<typeof MemoryFactDraftSchema>;
