"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, MessageCircle, Package, Send } from "lucide-react";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BRANDS, STATUS, changeStatus, createRequest, getInbox, reply, requestValuesSchema, type ProductRequest, type RequestValues } from "@/features/internal-chat/api";

const units = ["unidades", "metros", "m²", "m³", "kg", "litros", "cajas", "paquetes"] as const;
const empty = (employee = ""): RequestValues => ({ recipient_id: employee, category: "", product: "", quantity: 1, unit: "unidades", needed_date: "", notes: "" });

export default function InternalChatPage() {
  const { brandId, brand } = useBrandEnvironment();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [form, setForm] = useState<RequestValues>(empty());
  const inbox = useQuery({ queryKey: ["internal-requests", brandId], queryFn: () => getInbox(brandId, 100) });
  const requests = inbox.data?.requests ?? [];
  const active = requests.find((item) => item.id === selected) ?? requests[0];
  const refresh = () => client.invalidateQueries({ queryKey: ["internal-requests", brandId] });
  const create = useMutation({ mutationFn: () => createRequest(brandId, form), onSuccess: (item) => { setSelected(item.id); setForm(empty()); refresh(); } });
  const send = useMutation({ mutationFn: () => reply(brandId, active!.id, draft.trim()), onSuccess: () => { setDraft(""); refresh(); } });
  const status = useMutation({ mutationFn: (value: ProductRequest["status"]) => changeStatus(brandId, active!.id, value), onSuccess: refresh });
  const set = <K extends keyof RequestValues>(key: K, value: RequestValues[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => { const parsed = requestValuesSchema.safeParse(form); if (!parsed.success) { alert(parsed.error.issues[0]?.message || "Revisá los datos"); return; } create.mutate(); };

  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-primary">{brand.name}</p><h1 className="mt-1 text-3xl font-semibold">Chat interno de productos</h1><p className="mt-2 text-sm text-muted-foreground">Pedidos entre La Casa del Carpintero y Juan Pirone, separados del chat de cotizaciones.</p></header>
    <div className="grid gap-5 lg:grid-cols-[23rem_minmax(0,1fr)]">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Nuevo pedido</h2><Package className="size-5 text-primary" /></div>
        <label className="grid gap-1 text-sm">Para<select className="h-10 rounded-lg border bg-background px-2" value={form.recipient_id} onChange={(e) => set("recipient_id", e.target.value)}><option value="">Elegir empleado</option>{(inbox.data?.recipients ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Categoría<select className="h-10 rounded-lg border bg-background px-2" value={form.category} onChange={(e) => set("category", e.target.value)}><option value="">Elegir categoría</option>{(inbox.data?.categories ?? []).map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Producto<Input value={form.product} maxLength={200} placeholder="Ej: contramarcos 10x45" onChange={(e) => set("product", e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-sm">Cantidad<Input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => set("quantity", Number(e.target.value))} /></label><label className="grid gap-1 text-sm">Unidad<select className="h-10 rounded-lg border bg-background px-2" value={form.unit} onChange={(e) => set("unit", e.target.value as RequestValues["unit"])}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
        <label className="grid gap-1 text-sm">Necesario para (opcional)<Input type="date" value={form.needed_date} onChange={(e) => set("needed_date", e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Detalle<Textarea rows={3} maxLength={3000} value={form.notes} placeholder="Medidas, pedido o indicaciones" onChange={(e) => set("notes", e.target.value)} /></label>
        {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}<Button className="w-full" disabled={create.isPending} onClick={submit}><Send />{create.isPending ? "Enviando…" : "Enviar pedido"}</Button>
      </section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <div className="space-y-2 rounded-xl border bg-card p-3"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Bandeja</h2><span className="text-xs text-muted-foreground">{requests.length}</span></div>{inbox.isPending && <p className="p-3 text-sm text-muted-foreground">Cargando…</p>}{!inbox.isPending && !requests.length && <p className="p-3 text-sm text-muted-foreground">Todavía no hay pedidos.</p>}{requests.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item.id)} className={`w-full rounded-lg border p-3 text-left ${active?.id === item.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.product}</span><span className="text-[10px]">{STATUS[item.status]}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.quantity} {item.unit} · {BRANDS[item.from_brand]} <ArrowRight className="inline size-3" /> {BRANDS[item.to_brand]}</p></button>)}</div>
        <div className="flex min-h-[32rem] min-w-0 flex-col rounded-xl border bg-card p-4">{active ? <><div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><h2 className="text-lg font-semibold">{active.product}</h2><p className="text-sm text-muted-foreground">{active.quantity} {active.unit} · {BRANDS[active.from_brand]} → {BRANDS[active.to_brand]}</p></div><select className="h-9 rounded-lg border bg-background px-2 text-sm" value={active.status} disabled={status.isPending} onChange={(e) => status.mutate(e.target.value as ProductRequest["status"])}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="flex-1 space-y-3 overflow-y-auto py-4">{active.messages.map((message) => <div key={message.id} className={`max-w-[85%] rounded-lg p-3 text-sm ${message.brand_id === brandId ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><p className="whitespace-pre-wrap">{message.text}</p><p className="mt-1 text-[10px] opacity-70">{message.author} · {new Date(message.created_at).toLocaleString("es-UY")}</p></div>)}</div><div className="flex gap-2"><Input aria-label="Mensaje del pedido" value={draft} maxLength={3000} placeholder="Responder sobre este pedido…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && draft.trim()) { e.preventDefault(); send.mutate(); } }} /><Button aria-label="Enviar mensaje" size="icon" disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}><MessageCircle /></Button></div></> : <div className="m-auto text-center text-muted-foreground"><Clock3 className="mx-auto mb-2 size-8" /><p>Seleccioná un pedido para ver la conversación.</p></div>}</div>
      </section>
    </div>
  </main>;
}
