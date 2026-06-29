"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ClipboardCheck, Factory, History, House, Lock, PackageCheck, Search, SlidersHorizontal, ShoppingCart, TriangleAlert } from "lucide-react";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type View = "stock" | "availability" | "production" | "sale" | "house-shipment" | "adjustment" | "transfer" | "history";
type MovementType = "PRODUCCION" | "VENTA" | "ENVIO_CASA" | "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO" | "DESCARTE" | "TRASLADO";

interface Product { code: string; description: string; family: string; material: string; width_mm: number; height_mm: number; jit_min_quantity: number }
interface Location { wall: string; block: string; label: string }
interface StockRow extends Product { wall: string; block: string; location: string; complete_quantity: number; fraction_quantity: number; total_units: number; notes?: string }
interface Movement { id: string; created_at: string; code: string; type: MovementType; origin_wall: string; origin_block: string; destination_wall: string; destination_block: string; complete_quantity: number; fraction_quantity: number; user: string; notes: string }
interface Reservation { id: string; code: string; quantity: number; customer: string; reference: string; notes: string; status: string; created_at: string; created_by: string }
interface StockData { products: Product[]; locations: Location[]; stock: StockRow[]; movements: Movement[]; reservations: Reservation[] }

const EMPTY_DATA: StockData = { products: [], locations: [], stock: [], movements: [], reservations: [] };
const VIEW_BUTTONS: Array<{ id: View; label: string; icon: typeof Factory }> = [
  { id: "stock", label: "Stock actual", icon: PackageCheck },
  { id: "availability", label: "Consultar disponibilidad", icon: ClipboardCheck },
  { id: "production", label: "Sumar producción", icon: Factory },
  { id: "sale", label: "Registrar venta", icon: ShoppingCart },
  { id: "house-shipment", label: "Enviar a La Casa", icon: House },
  { id: "adjustment", label: "Ajustar", icon: SlidersHorizontal },
  { id: "transfer", label: "Trasladar", icon: ArrowLeftRight },
  { id: "history", label: "Historial", icon: History },
];

function locationValue(location: Location) { return `${location.wall}|${location.block}`; }
function parseLocation(value: string) {
  const [wall, block] = value.split("|");
  return { wall, block };
}

export default function StockMoldurasPage() {
  const { brandId, brand } = useBrandEnvironment();
  const [data, setData] = useState<StockData>(EMPTY_DATA);
  const [view, setView] = useState<View>("stock");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [historyCode, setHistoryCode] = useState("");
  const [canAdjust, setCanAdjust] = useState(false);

  const load = useCallback(async () => {
    if (brandId !== "pirone") return;
    setLoading(true);
    try {
      const res = await fetch("/api/stock-molduras");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo cargar el stock");
      setData(body as StockData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el stock");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((body) => setCanAdjust(Boolean(body?.session?.allAccess)))
      .catch(() => setCanAdjust(false));
  }, []);

  async function register(movement: Record<string, unknown>) {
    setMessage("");
    const res = await fetch("/api/stock-molduras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(movement),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "No se pudo registrar el movimiento");
    setMessage("Movimiento registrado correctamente.");
    await load();
    setView("stock");
  }

  async function operate(operation: string, payload: Record<string, unknown>) {
    setMessage("");
    const res = await fetch("/api/stock-molduras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "No se pudo completar la operación");
    await load();
    return body;
  }

  function openHistory(code: string) {
    setHistoryCode(code);
    setView("history");
  }

  if (brandId !== "pirone") return <main className="p-8 text-muted-foreground">Esta ventana es exclusiva de Carpintería Juan Pirone.</main>;

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{brand.name}</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Stock físico de molduras</h1>
        <p className="mt-1 text-sm text-muted-foreground">Varillas completas de 3,30 m y fraccionadas, organizadas por pared y bloque.</p>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1">
        {VIEW_BUTTONS.map(({ id, label, icon: Icon }) => {
          const locked = id === "adjustment" && !canAdjust;
          return <Button key={id} type="button" variant={view === id ? "default" : "outline"} onClick={() => setView(id)} disabled={locked} title={locked ? "Solo Juan Pirone puede ajustar stock" : undefined} className="shrink-0 gap-2">
            {locked ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}{label}
          </Button>
        })}
      </nav>

      {message && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{message}</div>}
      {loading ? <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">Cargando stock…</div> : (
        <>
          {view === "stock" && <StockCurrent data={data} onHistory={openHistory} />}
          {view === "availability" && <AvailabilityCheck data={data} onOperate={operate} />}
          {view === "production" && <MovementForm mode="production" products={data.products} locations={data.locations} onSubmit={register} />}
          {view === "sale" && <MovementForm mode="sale" products={data.products} locations={data.locations} stock={data.stock} onSubmit={register} />}
          {view === "house-shipment" && <MovementForm mode="house-shipment" products={data.products} locations={data.locations} stock={data.stock} onSubmit={register} />}
          {view === "adjustment" && canAdjust && <MovementForm mode="adjustment" products={data.products} locations={data.locations} stock={data.stock} onSubmit={register} />}
          {view === "transfer" && <MovementForm mode="transfer" products={data.products} locations={data.locations} stock={data.stock} onSubmit={register} />}
          {view === "history" && <MovementHistory products={data.products} movements={data.movements} code={historyCode} onCode={setHistoryCode} />}
        </>
      )}
    </main>
  );
}

function StockCurrent({ data, onHistory }: { data: StockData; onHistory: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [material, setMaterial] = useState("");
  const [wall, setWall] = useState("");
  const [block, setBlock] = useState("");
  const families = Array.from(new Set(data.products.map((row) => row.family))).sort();
  const materials = Array.from(new Set(data.products.map((row) => row.material))).sort();
  const walls = Array.from(new Set(data.locations.map((row) => row.wall))).sort();
  const blocks = Array.from(new Set(data.locations.filter((row) => !wall || row.wall === wall).map((row) => row.block))).sort();
  const rows = data.stock.filter((row) => {
    const text = `${row.code} ${row.description}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (!family || row.family === family) && (!material || row.material === material) && (!wall || row.wall === wall) && (!block || row.block === block);
  });
  const complete = data.stock.reduce((sum, row) => sum + row.complete_quantity, 0);
  const fraction = data.stock.reduce((sum, row) => sum + row.fraction_quantity, 0);
  const availableByCode = new Map<string, number>();
  for (const row of data.stock) availableByCode.set(row.code, (availableByCode.get(row.code) || 0) + row.total_units);
  for (const reservation of data.reservations) availableByCode.set(reservation.code, (availableByCode.get(reservation.code) || 0) - reservation.quantity);
  const productByCode = new Map(data.products.map((product) => [product.code, product]));
  const lowStockCodes = data.products.filter((product) => product.jit_min_quantity > 0 && Math.max(0, availableByCode.get(product.code) || 0) <= product.jit_min_quantity);

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric label="Varillas completas" value={complete} />
      <Metric label="Varillas fraccionadas" value={fraction} />
      <Metric label="Ubicaciones ocupadas" value={data.stock.length} />
    </section>
    {lowStockCodes.length > 0 && <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Producción rápida JIT: {lowStockCodes.length} artículo{lowStockCodes.length === 1 ? "" : "s"}</div><div className="text-sm">El stock disponible llegó al mínimo configurado. Consultá disponibilidad para ver cuánto fabricar.</div></div></div>}
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="grid gap-2 border-b p-4 md:grid-cols-6">
        <div className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Código o descripción…" className="pl-9" /></div>
        <Filter value={family} onChange={setFamily} label="Todas las familias" values={families} />
        <Filter value={material} onChange={setMaterial} label="Todos los materiales" values={materials} />
        <Filter value={wall} onChange={(value) => { setWall(value); setBlock(""); }} label="Todas las paredes" values={walls} />
        <Filter value={block} onChange={setBlock} label="Todos los bloques" values={blocks} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/80 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">Descripción</th><th className="px-4 py-3">Familia</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Ubicación</th><th className="px-4 py-3 text-right">Completas</th><th className="px-4 py-3 text-right">Fraccionadas</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Mínimo JIT</th></tr></thead>
          <tbody className="divide-y">{rows.map((row) => { const product = productByCode.get(row.code); const low = Boolean(product && product.jit_min_quantity > 0 && Math.max(0, availableByCode.get(row.code) || 0) <= product.jit_min_quantity); return <tr key={`${row.code}-${row.location}`} className={`cursor-pointer hover:bg-muted/40 ${low ? "bg-amber-50" : ""}`} onClick={() => onHistory(row.code)} title="Ver historial"><td className="px-4 py-3 font-mono text-xs font-semibold">{row.code}</td><td className="px-4 py-3 font-medium">{row.description}</td><td className="px-4 py-3">{row.family}</td><td className="px-4 py-3">{row.material}</td><td className="px-4 py-3"><span className="rounded bg-primary/10 px-2 py-1 font-semibold text-primary">{row.location}</span></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{row.complete_quantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{row.fraction_quantity}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{row.total_units}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{product?.jit_min_quantity || "—"}{low && <TriangleAlert className="ml-2 inline h-4 w-4 text-amber-600" />}</td></tr>; })}</tbody>
        </table>
        {rows.length === 0 && <div className="p-12 text-center text-muted-foreground">No hay stock que coincida con los filtros.</div>}
      </div>
    </section>
  </div>;
}

function AvailabilityCheck({ data, onOperate }: { data: StockData; onOperate: (operation: string, payload: Record<string, unknown>) => Promise<unknown> }) {
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState("0");
  const [includeFractions, setIncludeFractions] = useState(false);
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [jitMinimum, setJitMinimum] = useState("0");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const product = data.products.find((item) => item.code === code);
  const productStock = data.stock.filter((item) => item.code === code);
  const complete = productStock.reduce((sum, item) => sum + item.complete_quantity, 0);
  const fractions = productStock.reduce((sum, item) => sum + item.fraction_quantity, 0);
  const reservations = data.reservations.filter((item) => item.code === code);
  const reserved = reservations.reduce((sum, item) => sum + item.quantity, 0);
  const physicalUseful = complete + (includeFractions ? fractions : 0);
  const available = Math.max(0, physicalUseful - reserved);
  const orderQuantity = Math.max(0, Number(requested) || 0);
  const missing = Math.max(0, orderQuantity - available);
  const afterOrder = Math.max(0, available - orderQuantity);
  const jit = Math.max(0, Number(jitMinimum) || 0);
  const jitProduction = Math.max(0, orderQuantity + jit - available);

  useEffect(() => {
    setJitMinimum(String(product?.jit_min_quantity || 0));
    setFeedback("");
  }, [product?.code, product?.jit_min_quantity]);

  async function reserve() {
    setSaving(true); setFeedback("");
    try {
      await onOperate("reserve", { code, quantity: orderQuantity, customer, reference });
      setFeedback("Pedido reservado. Ya se descuenta de futuras consultas de disponibilidad.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "No se pudo reservar"); } finally { setSaving(false); }
  }

  async function saveJit() {
    setSaving(true); setFeedback("");
    try {
      await onOperate("set_jit", { code, quantity: jit });
      setFeedback(`Mínimo JIT guardado en ${jit} varillas.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "No se pudo guardar"); } finally { setSaving(false); }
  }

  async function release(reservationId: string) {
    setSaving(true); setFeedback("");
    try {
      await onOperate("release_reservation", { reservation_id: reservationId });
      setFeedback("Reserva liberada.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "No se pudo liberar"); } finally { setSaving(false); }
  }

  return <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
    <section className="rounded-xl border bg-card p-5 md:p-7">
      <h2 className="text-xl font-semibold">Consulta de disponibilidad</h2>
      <p className="mb-6 text-sm text-muted-foreground">Ingresá el artículo y la cantidad pedida para calcular el faltante automáticamente.</p>
      <div className="space-y-4">
        <ProductSelector products={data.products} code={code} onChange={setCode} />
        <Field label="Cantidad pedida (varillas)"><Input type="number" min="0" step="1" value={requested} onChange={(event) => setRequested(event.target.value)} /></Field>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={includeFractions} onChange={(event) => setIncludeFractions(event.target.checked)} className="mt-1" /><span><strong>Usar fraccionadas si sirven para este pedido</strong><span className="block text-muted-foreground">Las suma como unidades útiles solamente en esta consulta.</span></span></label>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Cliente (opcional)"><Input value={customer} onChange={(event) => setCustomer(event.target.value)} /></Field><Field label="Referencia del pedido (opcional)"><Input value={reference} onChange={(event) => setReference(event.target.value)} /></Field></div>
        <Button type="button" onClick={reserve} disabled={!code || orderQuantity <= 0 || saving} variant="outline" className="w-full">Reservar este pedido</Button>
      </div>
    </section>

    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-5 md:p-7">
        <h2 className="text-lg font-semibold">Resultado automático</h2>
        {!product ? <div className="py-10 text-center text-sm text-muted-foreground">Seleccioná un producto para consultar.</div> : <div className="mt-4 space-y-3">
          <ResultRow label="Stock completo físico" value={complete} />
          <ResultRow label="Stock fraccionado" value={fractions} muted={!includeFractions} />
          <ResultRow label="Reservado para otros pedidos" value={reserved} negative />
          <div className="border-t pt-3"><ResultRow label="Stock real disponible" value={available} strong /></div>
          <ResultRow label="Pedido" value={orderQuantity} />
          <ResultRow label="Faltante" value={missing} strong warning={missing > 0} />
          <div className={`mt-4 rounded-lg p-4 ${missing > 0 ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-950"}`}><div className="text-sm font-medium">Acción</div><div className="text-xl font-semibold">{missing > 0 ? `Fabricar ${missing} varillas` : "Pedido cubierto con stock"}</div></div>
        </div>}
      </section>

      {product && <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 text-amber-600" /><div className="flex-1"><h3 className="font-semibold">Mínimo Just in Time</h3><p className="text-sm text-muted-foreground">Cuando el disponible llegue a este nivel, el artículo se resaltará para producción rápida.</p></div></div>
        <div className="mt-4 flex gap-2"><Input type="number" min="0" step="1" value={jitMinimum} onChange={(event) => setJitMinimum(event.target.value)} /><Button type="button" onClick={saveJit} disabled={saving}>Guardar mínimo</Button></div>
        <div className="mt-3 text-sm">Luego de cubrir el pedido quedarían <strong>{afterOrder}</strong>. Para cubrir pedido + mínimo JIT, producción sugerida: <strong>{jitProduction}</strong>.</div>
      </section>}

      {product && reservations.length > 0 && <section className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Reservas activas de {code}</h3><div className="mt-3 divide-y">{reservations.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><strong>{item.quantity} varillas</strong><div className="text-muted-foreground">{item.customer || "Sin cliente"}{item.reference ? ` · ${item.reference}` : ""}</div></div><Button type="button" variant="outline" size="sm" onClick={() => release(item.id)} disabled={saving}>Liberar</Button></div>)}</div></section>}
      {feedback && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{feedback}</div>}
    </div>
  </div>;
}

function ResultRow({ label, value, strong, muted, negative, warning }: { label: string; value: number; strong?: boolean; muted?: boolean; negative?: boolean; warning?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 ${muted ? "text-muted-foreground line-through" : ""} ${strong ? "text-lg font-semibold" : "text-sm"} ${warning ? "text-amber-700" : ""}`}><span>{label}</span><span className="tabular-nums">{negative && value > 0 ? "−" : ""}{value}</span></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div></div>;
}

function Filter({ value, onChange, label, values }: { value: string; onChange: (value: string) => void; label: string; values: string[] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">{label}</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
}

function MovementForm({ mode, products, locations, stock = [], onSubmit }: { mode: "production" | "sale" | "house-shipment" | "adjustment" | "transfer"; products: Product[]; locations: Location[]; stock?: StockRow[]; onSubmit: (movement: Record<string, unknown>) => Promise<void> }) {
  const defaultType: MovementType = mode === "production" ? "PRODUCCION" : mode === "sale" ? "VENTA" : mode === "house-shipment" ? "ENVIO_CASA" : mode === "transfer" ? "TRASLADO" : "AJUSTE_POSITIVO";
  const [code, setCode] = useState("");
  const [type, setType] = useState<MovementType>(defaultType);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [complete, setComplete] = useState("0");
  const [fraction, setFraction] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const needsOrigin = type === "VENTA" || type === "ENVIO_CASA" || type === "AJUSTE_NEGATIVO" || type === "DESCARTE" || type === "TRASLADO";
  const needsDestination = type === "PRODUCCION" || type === "AJUSTE_POSITIVO" || type === "TRASLADO";
  const available = stock.find((row) => row.code === code && `${row.wall}|${row.block}` === origin);
  const selectedProduct = products.find((product) => product.code === code);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    try {
      await onSubmit({ code, type, complete_quantity: Number(complete), fraction_quantity: Number(fraction), notes, origin: needsOrigin ? parseLocation(origin) : undefined, destination: needsDestination ? parseLocation(destination) : undefined });
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo registrar"); } finally { setSaving(false); }
  }

  const titles = { production: ["Sumar producción", "Agrega molduras terminadas a una ubicación."], sale: ["Registrar venta / salida", "Descuenta las varillas entregadas del bloque de origen."], "house-shipment": ["Enviar stock a La Casa del Carpintero", "Descuenta el stock físico de Pirone y lo registra como envío interno, sin generar una venta."], adjustment: ["Ajustar stock", "Corrige diferencias de conteo o registra descartes."], transfer: ["Trasladar molduras", "Mueve stock entre bloques sin cambiar el total general."] };
  return <form onSubmit={submit} className="mx-auto max-w-2xl rounded-xl border bg-card p-5 md:p-7">
    <h2 className="text-xl font-semibold">{titles[mode][0]}</h2><p className="mb-6 text-sm text-muted-foreground">{titles[mode][1]}</p>
    <div className="space-y-4">
      {mode === "house-shipment" && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"><strong>Destino:</strong> La Casa del Carpintero. Este movimiento solo descuenta el stock de Pirone; no se registra como venta.</div>}
      {mode === "adjustment" && <Field label="Tipo de ajuste"><select value={type} onChange={(e) => setType(e.target.value as MovementType)} className="h-10 w-full rounded-md border bg-background px-3"><option value="AJUSTE_POSITIVO">Ajuste positivo (suma)</option><option value="AJUSTE_NEGATIVO">Ajuste negativo (resta)</option><option value="DESCARTE">Descarte (resta)</option></select></Field>}
      <ProductSelector products={products} code={code} onChange={setCode} />
      {selectedProduct && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"><div className="font-semibold">{selectedProduct.code} · {selectedProduct.description}</div><div className="mt-1 text-muted-foreground">{selectedProduct.width_mm} × {selectedProduct.height_mm} mm · {selectedProduct.family} · {selectedProduct.material}</div></div>}
      {needsOrigin && <Field label="Ubicación de origen"><LocationSelect value={origin} onChange={setOrigin} locations={locations} required /></Field>}
      {available && <div className="rounded-lg bg-muted px-4 py-3 text-sm">Disponible en {available.location}: <strong>{available.complete_quantity} completas</strong> y <strong>{available.fraction_quantity} fraccionadas</strong>.</div>}
      {needsDestination && <Field label="Ubicación de destino"><LocationSelect value={destination} onChange={setDestination} locations={locations} required /></Field>}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Varillas completas (3,30 m)"><Input type="number" min="0" step="1" value={complete} onChange={(e) => setComplete(e.target.value)} required /></Field><Field label="Varillas fraccionadas"><Input type="number" min="0" step="1" value={fraction} onChange={(e) => setFraction(e.target.value)} required /></Field></div>
      <Field label={mode === "adjustment" ? "Motivo" : "Observación (opcional)"}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} required={mode === "adjustment"} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
      <Button type="submit" disabled={saving} className="w-full">{saving ? "Registrando…" : titles[mode][0]}</Button>
    </div>
  </form>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>; }
function LocationSelect({ value, onChange, locations, required }: { value: string; onChange: (value: string) => void; locations: Location[]; required?: boolean }) { return <select value={value} onChange={(e) => onChange(e.target.value)} required={required} className="h-10 w-full rounded-md border bg-background px-3"><option value="">Seleccionar pared y bloque</option>{locations.map((location) => <option key={location.label} value={locationValue(location)}>{location.label}</option>)}</select>; }

function ProductSelector({ products, code, onChange }: { products: Product[]; code: string; onChange: (code: string) => void }) {
  const selected = products.find((product) => product.code === code);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  function productType(product: Product) {
    const family = product.family.toLowerCase().replace(/s$/, "");
    return family.charAt(0).toUpperCase() + family.slice(1);
  }

  function materialCode(product: Product) {
    const upper = product.code.toUpperCase();
    if (upper.includes("PN")) return "PN";
    if (upper.includes("NAC")) return "NAC";
    if (upper.includes("IMP")) return "IMP";
    return product.material;
  }

  function productDescription(product: Product) {
    return `${productType(product)} ${product.width_mm} × ${product.height_mm} mm · ${materialCode(product)}`;
  }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => {
        if (!needle) return true;
        const searchable = `${product.code} ${product.description} ${product.family} ${product.material} ${product.width_mm}x${product.height_mm} ${product.width_mm}${product.height_mm}mm ${product.width_mm} ${product.height_mm}`.toLowerCase();
        return searchable.includes(needle);
      })
      .sort((a, b) => a.code.localeCompare(b.code))
      .slice(0, 40);
  }, [products, query]);

  function choose(product: Product) {
    onChange(product.code);
    setQuery(`${product.code} — ${productDescription(product)}`);
    setOpen(false);
  }

  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">Producto</legend>
    <p className="text-xs text-muted-foreground">Buscá por código, tipo, material o medida.</p>
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
      <Input
        value={query || (selected ? `${selected.code} — ${productDescription(selected)}` : "")}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); }}
        placeholder="Ej.: 96179PN, barrote, pino o 3 × 3"
        className="h-11 pl-9"
        autoComplete="off"
        required
      />
      {open && <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
        {results.map((product) => <button key={product.code} type="button" onMouseDown={(event) => { event.preventDefault(); choose(product); }} className="flex w-full items-center justify-between gap-4 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted">
          <span className="font-mono text-xs font-semibold">{product.code}</span>
          <span className="flex-1 text-sm">{productDescription(product)}</span>
        </button>)}
        {results.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No encontramos una moldura con esos datos.</div>}
      </div>}
    </div>
  </fieldset>;
}

function MovementHistory({ products, movements, code, onCode }: { products: Product[]; movements: Movement[]; code: string; onCode: (code: string) => void }) {
  const rows = code ? movements.filter((row) => row.code === code) : movements;
  const location = (row: Movement) => row.type === "TRASLADO" ? `${row.origin_wall}-${row.origin_block} → ${row.destination_wall}-${row.destination_block}` : row.origin_wall ? `${row.origin_wall}-${row.origin_block}` : `${row.destination_wall}-${row.destination_block}`;
  return <section className="overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Historial de movimientos</h2><p className="text-sm text-muted-foreground">Trazabilidad de producción, ventas, ajustes, descartes y traslados.</p></div><select value={code} onChange={(e) => onCode(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Todos los productos</option>{products.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.description}</option>)}</select></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/80 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">Movimiento</th><th className="px-4 py-3">Ubicación</th><th className="px-4 py-3 text-right">Completas</th><th className="px-4 py-3 text-right">Fraccionadas</th><th className="px-4 py-3">Responsable</th><th className="px-4 py-3">Observación</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap px-4 py-3">{new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(row.created_at))}</td><td className="px-4 py-3 font-mono text-xs font-semibold">{row.code}</td><td className="px-4 py-3"><span className="rounded bg-muted px-2 py-1 text-xs font-semibold">{row.type.replaceAll("_", " ")}</span></td><td className="whitespace-nowrap px-4 py-3">{location(row)}</td><td className="px-4 py-3 text-right font-semibold">{row.complete_quantity}</td><td className="px-4 py-3 text-right font-semibold">{row.fraction_quantity}</td><td className="px-4 py-3">{row.user}</td><td className="max-w-xs truncate px-4 py-3" title={row.notes}>{row.notes || "—"}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="p-12 text-center text-muted-foreground">Todavía no hay movimientos registrados.</div>}</div>
  </section>;
}
