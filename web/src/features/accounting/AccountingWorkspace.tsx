"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, ChevronDown, CirclePlus, Download, FileText, Landmark, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canEditAccounting } from "@/lib/auth";

type Tab = "daily" | "monthly" | "payables" | "annual";
type Direction = "income" | "expense" | "transfer";

interface AuthSession { user: string; area: string; allAccess?: boolean }
interface Movement {
  id: string;
  year: number;
  month: number;
  workday_number: number;
  date: string;
  direction: Direction;
  category: string;
  subcategory: string;
  payment_method: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  supplier_invoice_id?: string;
  reconciled: boolean;
}
interface SupplierInvoice {
  id: string;
  supplier: string;
  rut: string;
  invoice_number: string;
  currency: string;
  amount: number;
  paid_amount: number;
  balance: number;
  purchase_date: string;
  due_date: string;
  status: "pendiente" | "parcial" | "pagada" | "no_aplica";
  notes: string;
}
interface SupplierPayment {
  id: string;
  supplier_invoice_id: string;
  supplier: string;
  payment_date: string;
  amount: number;
  currency: string;
  receipt_number: string;
  payment_method: string;
}
interface MonthlyResult {
  year: number;
  month: number;
  gross_sales: number;
  cash_sales: number;
  card_sales: number;
  credit_sales: number;
  fixed_costs: number;
  payroll: number;
  supplier_costs: number;
  total_costs: number;
  operating_result: number;
  movement_count: number;
}
interface AccountingData {
  year: number;
  month: number;
  movements: Movement[];
  supplier_invoices: SupplierInvoice[];
  supplier_payments: SupplierPayment[];
  monthly_results: MonthlyResult[];
  annual_result: Omit<MonthlyResult, "month" | "movement_count">;
}

const tabs: Array<{ id: Tab; label: string; icon: typeof CalendarDays }> = [
  { id: "daily", label: "Planilla diaria", icon: CalendarDays },
  { id: "monthly", label: "Estado mensual", icon: BarChart3 },
  { id: "payables", label: "Facturas a pagar", icon: FileText },
  { id: "annual", label: "Contabilidad anual", icon: Landmark },
];
const categories = [
  "facturas",
  "factura_credito",
  "aportes",
  "depositos",
  "tarjetas",
  "impuestos",
  "servicios",
  "costos_fijos",
  "sueldos",
  "proveedores",
  "costo_venta",
  "retiros",
  "devoluciones",
  "otros",
];
const paymentMethods = ["efectivo", "cheque", "deposito", "transferencia", "visa", "master", "maestro", "mercadolibre", "otro"];

function currentYear() { return new Date().getFullYear(); }
function currentMonth() { return new Date().getMonth() + 1; }
function today() { return new Date().toISOString().slice(0, 10); }
function money(value: number | null | undefined, currency = "UYU") {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}
function monthName(month: number) {
  return new Intl.DateTimeFormat("es-UY", { month: "short" }).format(new Date(2026, month - 1, 1));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operacion");
  return body as T;
}
function post(body: Record<string, unknown>) {
  return api<Record<string, unknown>>("/api/contabilidad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function AccountingWorkspace() {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("daily");
  const [year, setYear] = useState(currentYear());
  const [month, setMonth] = useState(currentMonth());
  const auth = useQuery({
    queryKey: ["auth-me-accounting"],
    queryFn: async () => (await api<{ session: AuthSession }>("/api/auth/me")).session,
  });
  const dataQuery = useQuery({
    queryKey: ["accounting", year, month, tab === "annual" ? "annual" : "monthly"],
    queryFn: () => api<AccountingData>(`/api/contabilidad?year=${year}&month=${month}&view=${tab === "annual" ? "annual" : "monthly"}`),
  });
  const invalidate = () => client.invalidateQueries({ queryKey: ["accounting"] });
  const mutation = useMutation({
    mutationFn: post,
    onSuccess: async () => { toast.success("Contabilidad actualizada"); await invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo guardar"),
  });
  const isAdmin = auth.data?.area === "administracion" || !!auth.data?.allAccess;
  const canEdit = canEditAccounting(auth.data);
  const data = dataQuery.data;

  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">La Casa del Carpintero</div>
        <h1 className="mt-1 text-2xl font-semibold">Contabilidad</h1>
        <p className="mt-1 text-sm text-muted-foreground">Caja diaria, facturas a pagar y resultados del negocio.</p>
        {auth.data ? <Badge className="mt-2" variant={canEdit ? "default" : "secondary"}>{canEdit ? "Edición habilitada para Juan" : "Solo lectura"}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ano"><Input type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || currentYear())} className="w-24" /></Field>
        <Field label="Mes"><select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="h-9 rounded-md border bg-background px-3 text-sm">{Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
        <Button variant="outline" onClick={() => void dataQuery.refetch()} disabled={dataQuery.isFetching}><RefreshCw /> Actualizar</Button>
      </div>
    </header>

    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Vistas de contabilidad">
      {tabs.filter((item) => item.id !== "annual" || isAdmin).map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant="ghost" onClick={() => setTab(id)} className={`mb-[-1px] shrink-0 rounded-b-none border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
        <Icon /> {label}
      </Button>)}
    </nav>

    {dataQuery.isLoading ? <div className="border bg-card p-10 text-center text-sm text-muted-foreground">Cargando contabilidad...</div> : null}
    {dataQuery.error ? <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{dataQuery.error.message}</div> : null}
    {data ? <>
      {tab === "daily" ? <DailySheet data={data} year={year} month={month} saving={mutation.isPending} canEdit={canEdit} onSave={(movement) => mutation.mutate({ operation: "movement", movement })} onSupplierPayment={(payment) => mutation.mutate({ operation: "daily_supplier_payment", payment })} /> : null}
      {tab === "monthly" ? <MonthlyResultPanel data={data} month={month} /> : null}
      {tab === "payables" ? <PayablesPanel data={data} saving={mutation.isPending} canEdit={canEdit} onInvoice={(invoice) => mutation.mutate({ operation: "supplier_invoice", invoice })} onSyncUcfe={() => mutation.mutate({ operation: "supplier_sync" })} /> : null}
      {tab === "annual" && isAdmin ? <AnnualPanel data={data} /> : null}
    </> : null}
  </main>;
}

function DailySheet({ data, year, month, saving, canEdit, onSave, onSupplierPayment }: { data: AccountingData; year: number; month: number; saving: boolean; canEdit: boolean; onSave: (movement: Record<string, unknown>) => void; onSupplierPayment: (payment: Record<string, unknown>) => void }) {
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState({
    workday_number: "1",
    date: today(),
    direction: "income",
    category: "facturas",
    subcategory: "",
    payment_method: "efectivo",
    amount: "",
    currency: "UYU",
    description: "",
    reference: "",
    supplier_invoice_id: "",
  });
  const openInvoices = data.supplier_invoices.filter((item) => item.status !== "pagada" && item.status !== "no_aplica");
  const selectedInvoice = openInvoices.find((item) => item.id === draft.supplier_invoice_id);
  const isSupplierPayment = draft.direction === "expense" && draft.category === "proveedores";
  const totals = useMemo(() => {
    const income = data.movements.filter((m) => m.direction === "income").reduce((sum, m) => sum + m.amount, 0);
    const expenses = data.movements.filter((m) => m.direction === "expense").reduce((sum, m) => sum + m.amount, 0);
    const cash = data.movements.filter((m) => m.payment_method === "efectivo").reduce((sum, m) => sum + (m.direction === "expense" ? -m.amount : m.amount), 0);
    return { income, expenses, cash };
  }, [data.movements]);
  function save() {
    if (isSupplierPayment) {
      if (!selectedInvoice) {
        toast.error("Selecciona la factura del proveedor que se esta cancelando");
        return;
      }
      const amount = Number(draft.amount);
      if (amount > selectedInvoice.balance) {
        toast.error("El pago no puede superar el saldo pendiente de la factura");
        return;
      }
      onSupplierPayment({
        supplier_invoice_id: selectedInvoice.id,
        payment_date: draft.date,
        amount,
        currency: selectedInvoice.currency,
        receipt_number: draft.reference,
        payment_method: draft.payment_method,
        bank_reference: draft.reference,
        notes: draft.description,
        description: draft.description,
        reference: draft.reference,
        year,
        month,
        workday_number: Number(draft.workday_number),
      });
      setDraft((prev) => ({ ...prev, amount: "", description: "", reference: "", supplier_invoice_id: "" }));
      return;
    }
    onSave({ ...draft, year, month, amount: Number(draft.amount) });
    setDraft((prev) => ({ ...prev, amount: "", description: "", reference: "", supplier_invoice_id: "" }));
  }
  async function downloadDailyReport() {
    setExporting(true);
    try {
      const response = await fetch(`/api/contabilidad/reporte-diario?date=${encodeURIComponent(draft.date)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo generar el reporte diario");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reporte-caja-${draft.date}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el reporte diario");
    } finally {
      setExporting(false);
    }
  }
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Entradas del mes" value={money(totals.income)} /><Metric label="Salidas del mes" value={money(totals.expenses)} /><Metric label="Caja neta efectivo" value={money(totals.cash)} /></section>
    <section className="border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold">Movimiento diario</h2><p className="text-xs text-muted-foreground">El reporte se genera para la fecha seleccionada e incluye espacio para firmas.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          {!canEdit ? <Field label="Fecha del reporte"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field> : null}
          <Button type="button" variant="outline" disabled={exporting || !draft.date} onClick={downloadDailyReport}>
            <Download /> {exporting ? "Generando..." : "Descargar reporte Excel"}
          </Button>
        </div>
      </div>
      {canEdit ? <><div className="mt-4 grid gap-3 md:grid-cols-4">
        <Field label="Dia trabajado"><Input type="number" min="1" value={draft.workday_number} onChange={(e) => setDraft({ ...draft, workday_number: e.target.value })} /></Field>
        <Field label="Fecha"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
        <Field label="Tipo"><select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value, supplier_invoice_id: "" })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="income">Entrada</option><option value="expense">Salida</option><option value="transfer">Transferencia</option></select></Field>
        <Field label="Categoria"><select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, supplier_invoice_id: "" })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
        <Field label="Medio"><select value={draft.payment_method} onChange={(e) => setDraft({ ...draft, payment_method: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
        <Field label="Importe"><Input type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
        <Field label="Moneda"><select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="UYU">UYU</option><option value="USD">USD</option></select></Field>
        <Field label="Subcategoria"><Input value={draft.subcategory} onChange={(e) => setDraft({ ...draft, subcategory: e.target.value })} /></Field>
        {isSupplierPayment ? <Field label="Factura proveedor"><select value={draft.supplier_invoice_id} onChange={(e) => {
          const invoice = openInvoices.find((item) => item.id === e.target.value);
          setDraft({ ...draft, supplier_invoice_id: e.target.value, currency: invoice?.currency || draft.currency, amount: invoice ? String(invoice.balance) : draft.amount, subcategory: invoice?.supplier || draft.subcategory });
        }} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">Seleccionar factura</option>{openInvoices.map((item) => <option key={item.id} value={item.id}>{item.supplier} - {item.invoice_number || "sin numero"} - saldo {money(item.balance, item.currency)}</option>)}</select></Field> : null}
        <Field label="Descripcion"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        <Field label={isSupplierPayment ? "Recibo / referencia" : "Referencia"}><Input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} /></Field>
      </div>
      {isSupplierPayment && selectedInvoice ? <div className="mt-3 text-sm text-muted-foreground">Factura {selectedInvoice.invoice_number || "sin numero"} de {selectedInvoice.supplier}. Saldo pendiente: <span className="font-medium text-foreground">{money(selectedInvoice.balance, selectedInvoice.currency)}</span>.</div> : null}
      <Button className="mt-4" disabled={saving || !(Number(draft.amount) > 0) || (isSupplierPayment && !draft.supplier_invoice_id)} onClick={save}><CirclePlus /> {isSupplierPayment ? "Registrar pago a proveedor" : "Registrar movimiento"}</Button></> : <div className="mt-4 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Esta sección es de solo lectura. Solo Juan Pirone puede cargar o modificar movimientos contables.</div>}
    </section>
    <MovementTable movements={data.movements} />
  </div>;
}

function MonthlyResultPanel({ data, month }: { data: AccountingData; month: number }) {
  const row = data.monthly_results.find((item) => item.month === month);
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Ventas brutas" value={money(row?.gross_sales)} /><Metric label="Costos" value={money(row?.total_costs)} /><Metric label="Resultado" value={money(row?.operating_result)} tone={(row?.operating_result || 0) >= 0 ? "good" : "bad"} /><Metric label="Movimientos" value={row?.movement_count || 0} /></section>
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Estado de resultados mensual</h2></div><table className="w-full text-sm"><tbody className="divide-y"><ResultLine label="Ventas efectivo" value={row?.cash_sales} /><ResultLine label="Ventas tarjetas" value={row?.card_sales} /><ResultLine label="Ventas a credito" value={row?.credit_sales} /><ResultLine label="Costos fijos" value={row?.fixed_costs} negative /><ResultLine label="Sueldos" value={row?.payroll} negative /><ResultLine label="Proveedores / costo de venta" value={row?.supplier_costs} negative /><ResultLine label="Resultado operativo" value={row?.operating_result} strong /></tbody></table></section>
  </div>;
}

function PayablesPanel({ data, saving, canEdit, onInvoice, onSyncUcfe }: { data: AccountingData; saving: boolean; canEdit: boolean; onInvoice: (invoice: Record<string, unknown>) => void; onSyncUcfe: () => void }) {
  const [invoice, setInvoice] = useState({ supplier: "", rut: "", invoice_number: "", currency: "UYU", amount: "", purchase_date: today(), due_date: "", notes: "" });
  const open = data.supplier_invoices.filter((item) => item.status !== "pagada" && item.status !== "no_aplica");
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Facturas pendientes" value={open.length} /><Metric label="Saldo UYU" value={money(open.filter((i) => i.currency === "UYU").reduce((sum, i) => sum + i.balance, 0))} /><Metric label="Saldo USD" value={money(open.filter((i) => i.currency === "USD").reduce((sum, i) => sum + i.balance, 0), "USD")} /><div className="border bg-card p-4"><div className="text-sm text-muted-foreground">{canEdit ? "UCFE recibidos" : "Permisos"}</div>{canEdit ? <Button className="mt-2 w-full" variant="outline" disabled={saving} onClick={onSyncUcfe}><RefreshCw /> Sincronizar</Button> : <div className="mt-2 text-sm font-medium">Solo lectura</div>}</div></section>
    {canEdit ? <section className="border bg-card p-4">
      <h2 className="font-semibold">Nueva factura a pagar</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Proveedor"><Input value={invoice.supplier} onChange={(e) => setInvoice({ ...invoice, supplier: e.target.value })} /></Field><Field label="RUT"><Input value={invoice.rut} onChange={(e) => setInvoice({ ...invoice, rut: e.target.value })} /></Field><Field label="Factura"><Input value={invoice.invoice_number} onChange={(e) => setInvoice({ ...invoice, invoice_number: e.target.value })} /></Field><Field label="Monto"><Input type="number" min="0" step="0.01" value={invoice.amount} onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })} /></Field><Field label="Moneda"><select value={invoice.currency} onChange={(e) => setInvoice({ ...invoice, currency: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="UYU">UYU</option><option value="USD">USD</option></select></Field><Field label="Fecha compra"><Input type="date" value={invoice.purchase_date} onChange={(e) => setInvoice({ ...invoice, purchase_date: e.target.value })} /></Field><Field label="Vencimiento"><Input type="date" value={invoice.due_date} onChange={(e) => setInvoice({ ...invoice, due_date: e.target.value })} /></Field><Field label="Notas"><Input value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} /></Field></div>
      <Button className="mt-4" disabled={saving || !invoice.supplier || !(Number(invoice.amount) > 0)} onClick={() => onInvoice({ ...invoice, amount: Number(invoice.amount), paid_amount: 0 })}>Guardar factura</Button>
    </section> : null}
    <PayablesTable invoices={data.supplier_invoices} />
  </div>;
}

function AnnualPanel({ data }: { data: AccountingData }) {
  const annual = data.annual_result;
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Ventas anuales" value={money(annual.gross_sales)} /><Metric label="Costos anuales" value={money(annual.total_costs)} /><Metric label="Resultado anual" value={money(annual.operating_result)} tone={annual.operating_result >= 0 ? "good" : "bad"} /><Metric label="Facturas a pagar" value={data.supplier_invoices.length} /></section>
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Contabilidad anual por mes</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Mes</th><th className="px-4 py-3 text-right">Ventas</th><th className="px-4 py-3 text-right">Tarjetas</th><th className="px-4 py-3 text-right">Credito</th><th className="px-4 py-3 text-right">Costos fijos</th><th className="px-4 py-3 text-right">Sueldos</th><th className="px-4 py-3 text-right">Proveedores</th><th className="px-4 py-3 text-right">Resultado</th></tr></thead><tbody className="divide-y">{data.monthly_results.map((row) => <tr key={row.month}><td className="px-4 py-3 font-medium">{monthName(row.month)}</td><td className="px-4 py-3 text-right">{money(row.gross_sales)}</td><td className="px-4 py-3 text-right">{money(row.card_sales)}</td><td className="px-4 py-3 text-right">{money(row.credit_sales)}</td><td className="px-4 py-3 text-right">{money(row.fixed_costs)}</td><td className="px-4 py-3 text-right">{money(row.payroll)}</td><td className="px-4 py-3 text-right">{money(row.supplier_costs)}</td><td className={`px-4 py-3 text-right font-semibold ${row.operating_result < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(row.operating_result)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function MovementTable({ movements }: { movements: Movement[] }) {
  return <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Movimientos cargados</h2></div>{movements.length === 0 ? <Empty text="Todavia no hay movimientos en este mes." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Dia</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Medio</th><th className="px-4 py-3">Detalle</th><th className="px-4 py-3 text-right">Importe</th></tr></thead><tbody className="divide-y">{movements.map((m) => <tr key={m.id}><td className="px-4 py-3">{m.workday_number}</td><td className="px-4 py-3"><Badge variant={m.direction === "income" ? "default" : m.direction === "expense" ? "secondary" : "outline"}>{m.direction === "income" ? "Entrada" : m.direction === "expense" ? "Salida" : "Transferencia"}</Badge></td><td className="px-4 py-3">{m.category}</td><td className="px-4 py-3">{m.payment_method}</td><td className="px-4 py-3">{m.description || m.reference || "-"}</td><td className="px-4 py-3 text-right font-medium">{money(m.amount, m.currency)}</td></tr>)}</tbody></table></div>}</section>;
}

function PayablesTable({ invoices }: { invoices: SupplierInvoice[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const openInvoices = invoices.filter((invoice) => invoice.status !== "pagada" && invoice.status !== "no_aplica");
  const providers = Array.from(openInvoices.reduce((map, invoice) => {
    const key = invoice.supplier || "Proveedor sin nombre";
    const current = map.get(key) || { supplier: key, invoices: [] as SupplierInvoice[], uyu: 0, usd: 0 };
    current.invoices.push(invoice);
    if (invoice.currency === "USD") current.usd += invoice.balance;
    else current.uyu += invoice.balance;
    map.set(key, current);
    return map;
  }, new Map<string, { supplier: string; invoices: SupplierInvoice[]; uyu: number; usd: number }>()).values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
  return <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Saldos por proveedor</h2></div>{providers.length === 0 ? <Empty text="No hay saldos pendientes con proveedores." /> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3 text-right">Facturas</th><th className="px-4 py-3 text-right">Saldo UYU</th><th className="px-4 py-3 text-right">Saldo USD</th><th className="px-4 py-3 text-right">Detalle</th></tr></thead><tbody className="divide-y">{providers.map((provider) => <tr key={provider.supplier} className="align-top"><td className="px-4 py-3 font-medium">{provider.supplier}{expanded === provider.supplier ? <div className="mt-3 overflow-hidden border"><table className="w-full text-xs"><thead className="bg-muted/50 text-left uppercase text-muted-foreground"><tr><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Compra</th><th className="px-3 py-2 text-right">Monto</th><th className="px-3 py-2 text-right">Pagado</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2">Estado</th></tr></thead><tbody className="divide-y">{provider.invoices.map((invoice) => <tr key={invoice.id}><td className="px-3 py-2">{invoice.invoice_number || "-"}</td><td className="px-3 py-2">{invoice.purchase_date || "-"}</td><td className="px-3 py-2 text-right">{money(invoice.amount, invoice.currency)}</td><td className="px-3 py-2 text-right">{money(invoice.paid_amount, invoice.currency)}</td><td className="px-3 py-2 text-right font-semibold">{money(invoice.balance, invoice.currency)}</td><td className="px-3 py-2"><Badge variant={invoice.status === "parcial" ? "secondary" : "outline"}>{invoice.status}</Badge></td></tr>)}</tbody></table></div> : null}</td><td className="px-4 py-3 text-right tabular-nums">{provider.invoices.length}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(provider.uyu)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(provider.usd, "USD")}</td><td className="px-4 py-3 text-right"><Button type="button" variant="outline" size="sm" onClick={() => setExpanded(expanded === provider.supplier ? null : provider.supplier)}><ChevronDown className={`transition-transform ${expanded === provider.supplier ? "rotate-180" : ""}`} /> Ver facturas</Button></td></tr>)}</tbody></table></div>}</section>;
}

function ResultLine({ label, value, negative, strong }: { label: string; value?: number; negative?: boolean; strong?: boolean }) {
  const display = negative ? -(value || 0) : value || 0;
  return <tr className={strong ? "bg-muted/40 font-semibold" : ""}><td className="px-4 py-3">{label}</td><td className={`px-4 py-3 text-right tabular-nums ${display < 0 ? "text-red-600" : ""}`}>{money(display)}</td></tr>;
}
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" }) {
  return <div className="border bg-card p-4"><div className="text-sm text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-600" : ""}`}>{value}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Label className="space-y-1 text-xs"><span>{label}</span>{children}</Label>;
}
function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>;
}
