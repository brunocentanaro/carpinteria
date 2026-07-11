"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, CirclePlus, FileDown, PackageSearch, RefreshCw, Settings2, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Unit = "unidad" | "metro" | "litro" | "placa" | "paquete" | "kilogramo";
type Tab = "overview" | "products" | "opening" | "ucfe";

interface Product { id: string; sku: string; name: string; unit: Unit; category: string; active: boolean }
interface Location { code: string; name: string }
interface Balance { product_id: string; location_code: string; quantity: number; product: Product }
interface Movement { id: string; created_at: string; product_sku: string; quantity: number; unit: Unit; type: string; origin_location: string; destination_location: string; notes: string }
interface InventoryData { products: Product[]; locations: Location[]; balances: Balance[]; movements: Movement[] }
interface ReceivedItem { source_key: string; document_date: string; supplier_name: string; supplier_rut: string; name: string; description: string; quantity: number | null; source_unit: string; amount: number | null; mapping_status: "PENDING" | "CONFIRMED" | "IGNORED"; target_unit?: Unit; conversion_factor?: number }
interface ReceivedData { cfes: unknown[]; items: ReceivedItem[] }

const productSchema = z.object({
  sku: z.string().trim().min(1, "Ingresá un código"),
  name: z.string().trim().min(1, "Ingresá un nombre"),
  unit: z.enum(["unidad", "metro", "litro", "placa", "paquete", "kilogramo"]),
  category: z.string().trim(),
});
const movementSchema = z.object({
  product_id: z.string().min(1, "Elegí un producto"),
  location_code: z.string().min(1, "Elegí un depósito"),
  quantity: z.number().positive("La cantidad debe ser mayor a cero"),
  notes: z.string().trim(),
});

type ProductValues = z.infer<typeof productSchema>;
type MovementValues = z.infer<typeof movementSchema>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación");
  return body as T;
}

async function loadInventory() { return api<InventoryData>("/api/inventario?resource=inventory"); }
async function loadReceived() { return api<ReceivedData>("/api/inventario?resource=ucfe&limit=200"); }
function post(body: Record<string, unknown>) {
  return api<Record<string, unknown>>("/api/inventario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const tabs: Array<{ id: Tab; label: string; icon: typeof Warehouse }> = [
  { id: "overview", label: "Existencias", icon: Warehouse },
  { id: "products", label: "Productos", icon: Settings2 },
  { id: "opening", label: "Carga inicial", icon: ArchiveRestore },
  { id: "ucfe", label: "Recibidos UCFE", icon: FileDown },
];

function formatQuantity(value: number | null | undefined) {
  return new Intl.NumberFormat("es-UY", { maximumFractionDigits: 3 }).format(value || 0);
}

function todayInput() { return new Date().toISOString().slice(0, 10); }
function weekAgoInput() { const day = new Date(); day.setDate(day.getDate() - 6); return day.toISOString().slice(0, 10); }
function uiDate(value: string) { const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`; }

export function InventoryWorkspace() {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [productDraft, setProductDraft] = useState("");
  const [sourceItem, setSourceItem] = useState<ReceivedItem | null>(null);
  const inventoryQuery = useQuery({ queryKey: ["inventory"], queryFn: loadInventory });
  const receivedQuery = useQuery({ queryKey: ["ucfe-received"], queryFn: loadReceived, enabled: tab === "ucfe" });
  const invalidate = () => Promise.all([
    client.invalidateQueries({ queryKey: ["inventory"] }),
    client.invalidateQueries({ queryKey: ["ucfe-received"] }),
  ]);

  const productMutation = useMutation({
    mutationFn: (product: ProductValues) => post({ operation: "product", product }),
    onSuccess: async () => { toast.success("Producto guardado"); setProductDraft(""); await invalidate(); },
  });
  const movementMutation = useMutation({
    mutationFn: (movement: Record<string, unknown>) => post({ operation: "movement", movement }),
    onSuccess: async () => { toast.success("Saldo inicial registrado"); await invalidate(); },
  });
  const mappingMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => post({ operation: "mapping", ...body }),
    onSuccess: async () => { toast.success("Ítem UCFE actualizado"); setSourceItem(null); await invalidate(); },
  });
  const syncMutation = useMutation({
    mutationFn: (range: { start: string; end: string }) => post({ operation: "sync", start: uiDate(range.start), end: uiDate(range.end) }),
    onSuccess: async (result) => { toast.success(`Sincronización terminada: ${String(result.items_created || 0)} ítems nuevos`); await invalidate(); },
  });

  const data = inventoryQuery.data;
  const pending = (receivedQuery.data?.items || []).filter((item) => item.mapping_status === "PENDING");

  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">Administración</div>
        <h1 className="mt-1 text-2xl font-semibold">Inventario operativo</h1>
        <p className="mt-1 text-sm text-muted-foreground">Fábrica y La Casa se controlan como depósitos separados.</p>
      </div>
      <Button variant="outline" onClick={() => void inventoryQuery.refetch()} disabled={inventoryQuery.isFetching}>
        <RefreshCw /> Actualizar
      </Button>
    </header>

    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Vistas de inventario">
      {tabs.map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant="ghost" onClick={() => setTab(id)} className={`mb-[-1px] shrink-0 rounded-b-none border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
        <Icon /> {label}{id === "ucfe" && pending.length > 0 ? <Badge variant="secondary">{pending.length}</Badge> : null}
      </Button>)}
    </nav>

    {inventoryQuery.isLoading ? <Loading /> : inventoryQuery.error ? <ErrorText error={inventoryQuery.error} /> : data ? <>
      {tab === "overview" ? <InventoryOverview data={data} /> : null}
      {tab === "products" ? <ProductsPanel draftName={productDraft} products={data.products} onSubmit={(values) => productMutation.mutate(values)} saving={productMutation.isPending} /> : null}
      {tab === "opening" ? <OpeningBalancePanel data={data} onSubmit={(values) => movementMutation.mutate(values)} saving={movementMutation.isPending} /> : null}
      {tab === "ucfe" ? <UcfePanel data={receivedQuery.data} loading={receivedQuery.isLoading} error={receivedQuery.error} products={data.products} sourceItem={sourceItem} onSelect={setSourceItem} onCreateProduct={(item) => { setProductDraft(item.name); setTab("products"); }} onMap={(body) => mappingMutation.mutate(body)} mapping={mappingMutation.isPending} onSync={(range) => syncMutation.mutate(range)} syncing={syncMutation.isPending} /> : null}
    </> : null}
  </main>;
}

function InventoryOverview({ data }: { data: InventoryData }) {
  const quantities = data.balances.reduce((sum, row) => sum + row.quantity, 0);
  const byLocation = new Map<string, number>();
  for (const row of data.balances) byLocation.set(row.location_code, (byLocation.get(row.location_code) || 0) + row.quantity);
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric label="Productos" value={data.products.length} />
      <Metric label="Saldos cargados" value={formatQuantity(quantities)} />
      <Metric label="Movimientos recientes" value={data.movements.length} />
    </section>
    <section className="grid gap-3 md:grid-cols-2">
      {data.locations.map((location) => <div key={location.code} className="border-l-4 border-primary bg-muted/30 p-4"><div className="text-sm font-medium">{location.name}</div><div className="mt-1 text-2xl font-semibold">{formatQuantity(byLocation.get(location.code))}</div><div className="text-xs text-muted-foreground">unidades de medida combinadas, consultar detalle por producto</div></div>)}
    </section>
    <section className="overflow-hidden border bg-card">
      <div className="border-b px-4 py-3"><h2 className="font-semibold">Saldos por producto y depósito</h2></div>
      {data.balances.length === 0 ? <Empty text="Todavía no hay saldo inicial cargado." /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">Depósito</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3">Unidad</th></tr></thead><tbody className="divide-y">{data.balances.map((row) => <tr key={`${row.product_id}-${row.location_code}`}><td className="px-4 py-3 font-medium">{row.product.name}</td><td className="px-4 py-3 font-mono text-xs">{row.product.sku}</td><td className="px-4 py-3">{row.location_code}</td><td className="px-4 py-3 text-right tabular-nums">{formatQuantity(row.quantity)}</td><td className="px-4 py-3">{row.product.unit}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function ProductsPanel({ draftName, products, onSubmit, saving }: { draftName: string; products: Product[]; onSubmit: (values: ProductValues) => void; saving: boolean }) {
  const form = useForm<ProductValues>({ resolver: zodResolver(productSchema), defaultValues: { sku: "", name: "", unit: "unidad", category: "" } });
  useEffect(() => { if (draftName) form.setValue("name", draftName); }, [draftName, form]);
  return <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
    <form className="border bg-card p-5" onSubmit={form.handleSubmit(onSubmit)}>
      <h2 className="font-semibold">Nuevo producto</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Definí una única unidad base para cada artículo.</p>
      <div className="space-y-4"><FormField label="Código" error={form.formState.errors.sku?.message}><Input {...form.register("sku")} placeholder="HER-SOP-24" /></FormField><FormField label="Nombre" error={form.formState.errors.name?.message}><Input {...form.register("name")} /></FormField><FormField label="Categoría"><Input {...form.register("category")} placeholder="Herrajes" /></FormField><FormField label="Unidad base"><select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" {...form.register("unit")}>{["unidad", "metro", "litro", "placa", "paquete", "kilogramo"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></FormField><Button type="submit" disabled={saving} className="w-full"><CirclePlus /> {saving ? "Guardando..." : "Crear producto"}</Button></div>
    </form>
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Catálogo de inventario</h2></div>{products.length === 0 ? <Empty text="Creá el primer producto o partí desde un ítem UCFE pendiente." /> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Categoría</th><th className="px-4 py-3">Unidad</th></tr></thead><tbody className="divide-y">{products.map((product) => <tr key={product.id}><td className="px-4 py-3 font-mono text-xs">{product.sku}</td><td className="px-4 py-3 font-medium">{product.name}</td><td className="px-4 py-3 text-muted-foreground">{product.category || "-"}</td><td className="px-4 py-3">{product.unit}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}

function OpeningBalancePanel({ data, onSubmit, saving }: { data: InventoryData; onSubmit: (movement: Record<string, unknown>) => void; saving: boolean }) {
  const form = useForm<MovementValues>({ resolver: zodResolver(movementSchema), defaultValues: { product_id: "", location_code: "FABRICA", quantity: undefined, notes: "Carga inicial" } });
  return <form className="max-w-xl border bg-card p-5" onSubmit={form.handleSubmit((values) => onSubmit({ type: "SALDO_INICIAL", product_id: values.product_id, destination_location: values.location_code, quantity: values.quantity, notes: values.notes }))}>
    <h2 className="font-semibold">Carga de saldo inicial</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Usalo una vez por producto y depósito, después de contar físicamente.</p>
    <div className="space-y-4"><FormField label="Producto" error={form.formState.errors.product_id?.message}><select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" {...form.register("product_id")}><option value="">Seleccionar producto</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} ({product.unit})</option>)}</select></FormField><FormField label="Depósito" error={form.formState.errors.location_code?.message}><select className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm" {...form.register("location_code")}>{data.locations.map((location) => <option key={location.code} value={location.code}>{location.name}</option>)}</select></FormField><FormField label="Cantidad" error={form.formState.errors.quantity?.message}><Input type="number" step="0.001" min="0.001" {...form.register("quantity", { valueAsNumber: true })} /></FormField><FormField label="Observación"><Input {...form.register("notes")} /></FormField><Button type="submit" disabled={saving || data.products.length === 0} className="w-full"><ArchiveRestore /> {saving ? "Registrando..." : "Registrar saldo inicial"}</Button></div>
  </form>;
}

function UcfePanel({ data, loading, error, products, sourceItem, onSelect, onCreateProduct, onMap, mapping, onSync, syncing }: { data?: ReceivedData; loading: boolean; error: Error | null; products: Product[]; sourceItem: ReceivedItem | null; onSelect: (item: ReceivedItem | null) => void; onCreateProduct: (item: ReceivedItem) => void; onMap: (body: Record<string, unknown>) => void; mapping: boolean; onSync: (range: { start: string; end: string }) => void; syncing: boolean }) {
  const [start, setStart] = useState(weekAgoInput()); const [end, setEnd] = useState(todayInput());
  if (loading) return <Loading />;
  if (error) return <ErrorText error={error} />;
  const items = data?.items || []; const pending = items.filter((item) => item.mapping_status === "PENDING");
  return <div className="space-y-5"><section className="flex flex-wrap items-end gap-3 border bg-muted/30 p-4"><div><Label htmlFor="sync-start">Desde</Label><Input id="sync-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div><div><Label htmlFor="sync-end">Hasta</Label><Input id="sync-end" type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div><Button onClick={() => onSync({ start, end })} disabled={syncing || !start || !end}><RefreshCw /> {syncing ? "Sincronizando..." : "Sincronizar UCFE"}</Button><p className="text-sm text-muted-foreground">La importación no cambia stock; prepara los ítems para revisión.</p></section>
    {sourceItem ? <MappingPanel key={sourceItem.source_key} item={sourceItem} products={products} onClose={() => onSelect(null)} onCreateProduct={onCreateProduct} onMap={onMap} mapping={mapping} /> : null}
    <section className="overflow-hidden border bg-card"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="font-semibold">Ítems recibidos</h2><p className="text-sm text-muted-foreground">{pending.length} pendientes de decisión</p></div></div>{items.length === 0 ? <Empty text="Todavía no hay comprobantes recibidos. Elegí un rango y sincronizá UCFE." /> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Concepto</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.source_key}><td className="px-4 py-3 text-muted-foreground">{item.document_date?.slice(0, 10)}</td><td className="px-4 py-3">{item.supplier_name}</td><td className="px-4 py-3 font-medium">{item.name || item.description || "Sin detalle"}</td><td className="px-4 py-3 text-right tabular-nums">{formatQuantity(item.quantity)} {item.source_unit}</td><td className="px-4 py-3"><Status status={item.mapping_status} /></td><td className="px-4 py-3 text-right">{item.mapping_status === "PENDING" ? <Button size="sm" variant="outline" onClick={() => onSelect(item)}><PackageSearch /> Revisar</Button> : null}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}

function MappingPanel({ item, products, onClose, onCreateProduct, onMap, mapping }: { item: ReceivedItem; products: Product[]; onClose: () => void; onCreateProduct: (item: ReceivedItem) => void; onMap: (body: Record<string, unknown>) => void; mapping: boolean }) {
  const [productId, setProductId] = useState("");
  const [factor, setFactor] = useState("1");
  return <section className="border bg-card p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-semibold uppercase text-primary">Confirmar mapping</div><h2 className="mt-1 font-semibold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.supplier_name} · {formatQuantity(item.quantity)} {item.source_unit || "sin unidad declarada"}</p></div><Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><FormField label="Producto interno"><select value={productId} onChange={(event) => setProductId(event.target.value)} className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"><option value="">Seleccionar producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} ({product.unit})</option>)}</select></FormField><FormField label="Factor de conversión"><Input type="number" min="0.000001" step="0.001" value={factor} onChange={(event) => setFactor(event.target.value)} /></FormField></div><div className="mt-5 flex flex-wrap gap-2"><Button disabled={!productId || mapping} onClick={() => onMap({ mapping_operation: "confirm", source_key: item.source_key, inventory_product_id: productId, conversion_factor: Number(factor) })}>Confirmar equivalencia</Button><Button variant="outline" onClick={() => onCreateProduct(item)}><CirclePlus /> Crear producto</Button><Button variant="ghost" disabled={mapping} onClick={() => onMap({ mapping_operation: "ignore", source_key: item.source_key, note: "No inventariable" })}>No inventariable</Button></div></section>;
}

function Status({ status }: { status: ReceivedItem["mapping_status"] }) { return <Badge variant={status === "CONFIRMED" ? "default" : status === "IGNORED" ? "secondary" : "outline"}>{status === "CONFIRMED" ? "Confirmado" : status === "IGNORED" ? "No inventariable" : "Pendiente"}</Badge>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="border bg-card p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>; }
function Loading() { return <div className="border bg-card p-10 text-center text-sm text-muted-foreground">Cargando inventario...</div>; }
function ErrorText({ error }: { error: Error }) { return <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error.message}</div>; }
function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}{error ? <span className="text-xs text-destructive">{error}</span> : null}</label>; }
