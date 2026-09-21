import { z } from "zod";

export const taskValuesSchema = z.object({
  employee_id: z.string().min(1, "Elegí un empleado"),
  title: z.string().trim().min(1, "Escribí la tarea").max(200, "Máximo 200 caracteres"),
  date: z.iso.date("Elegí una fecha válida"),
  start_time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida"),
  end_time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida"),
  notes: z.string().trim().max(3000, "Máximo 3000 caracteres"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
}).refine((value) => !value.end_time || (value.start_time && value.end_time > value.start_time), {
  message: "La hora de fin debe ser posterior a la de inicio", path: ["end_time"],
});

export type TaskValues = z.infer<typeof taskValuesSchema>;
const taskSchema = taskValuesSchema.safeExtend({ id: z.string(), brand_id: z.string() });
export type CalendarTask = z.infer<typeof taskSchema>;
export const calendarSchema = z.object({
  employees: z.array(z.object({ id: z.string(), name: z.string() })),
  tasks: z.array(taskSchema),
});
export type Employee = z.infer<typeof calendarSchema>["employees"][number];

async function request(brandId: string, query: string, init?: RequestInit) {
  const response = await fetch(`/api/calendar?brandId=${encodeURIComponent(brandId)}${query}`, {
    ...init, headers: { "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "No se pudo acceder al calendario");
  return data;
}

export async function getCalendar(brandId: string, month: string) {
  return calendarSchema.parse(await request(brandId, `&month=${encodeURIComponent(month)}`));
}

export async function saveTask(brandId: string, values: Partial<TaskValues>, id?: string) {
  const data = await request(brandId, "", { method: id ? "PATCH" : "POST", body: JSON.stringify({ ...values, ...(id ? { id } : {}) }) });
  return taskSchema.parse(data.task);
}

