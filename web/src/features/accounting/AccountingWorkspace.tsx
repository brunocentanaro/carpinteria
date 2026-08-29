"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, BarChart3, BookOpen, CalendarDays, ChevronDown, CirclePlus, CreditCard, Download, FileText, Landmark, ListTree, RefreshCw, Scale, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canEditAccounting } from "@/lib/auth";

type Tab = "daily" | "journal" | "accounts" | "position" | "monthly" | "equity" | "cashflow" | "payables" | "tarjetas" | "annual";
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
  card_payment_type?: string;
  card_installments?: number;
  origin_account?: string;
  destination_account: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  supplier_invoice_id?: string;
  source?: string;
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
  accounting_classification?: string;
  functional_amount?: number;
  exchange_rate?: number;
  exchange_rate_date?: string;
  exchange_rate_source?: string;
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
  bank_reference?: string;
  notes?: string;
}
interface MonthlyResult {
  year: number;
  month: number;
  gross_sales: number;
  cash_sales: number;
  card_sales: number;
  bank_sales: number;
  credit_sales: number;
  fixed_costs: number;
  other_costs: number;
  payroll: number;
  supplier_costs: number;
  total_costs: number;
  operating_result: number;
  movement_count: number;
}
interface LedgerAccount {
  code: string;
  name: string;
  class: "activo" | "pasivo" | "patrimonio" | "ingreso" | "gasto";
  group: string;
  nature: "debit" | "credit";
  balance?: number;
}
interface JournalLine {
  account_code: string;
  account_name: string;
  account_class: string;
  debit: number;
  credit: number;
}
interface JournalEntry {
  id: string;
  date: string;
  description: string;
  reference: string;
  source: string;
  debit: number;
  credit: number;
  balanced: boolean;
  lines: JournalLine[];
}
type CardMedio = "visa_debito" | "visa_credito" | "master_debito" | "master_credito" | "maestro";
interface CardConciliationRow {
  medio: CardMedio;
  pos_total: number;
  caja_total: number;
  difference: number;
  flag: "" | "faltante" | "sobrante";
}
interface CouponIntegrityItem {
  fiserv_id: string;
  bill_number: string;
  ticket: string;
  batch: string;
  product_name: string;
  amount: number;
  issues: string[];
}
interface CardConciliation {
  date: string;
  has_coupons: boolean;
  pending_sync: boolean;
  caja_source: "handover" | "movements";
  coupon_count: number;
  per_medio: CardConciliationRow[];
  unmapped_pos_total: number;
  has_faltante: boolean;
  has_sobrante: boolean;
  coupon_integrity: {
    coupons: CouponIntegrityItem[];
    flagged: CouponIntegrityItem[];
    registered_bill_range: { min: number; max: number } | null;
  };
}
interface ProposedCardSettlement {
  settlement_number: string;
  payment_date: string;
  product_desc: string;
  net_amount: number;
  already_registered: boolean;
}
interface TillHandoverCardTotals {
  visa_debito: number;
  visa_credito: number;
  master_debito: number;
  master_credito: number;
  maestro: number;
}
interface TillHandover {
  id: string;
  date: string;
  counted_cash: number;
  theoretical_cash: number;
  difference: number;
  card_totals: TillHandoverCardTotals;
  pos_batches: string[];
  ticket_close_total: number | null;
  cashier: string;
  overridden: boolean;
  override_count: number;
  created_at: string;
  created_by: string;
}
interface AccountingData {
  year: number;
  month: number;
  movements: Movement[];
  account_balances: {
    cash: number;
    bank: number;
    card_receivables: number;
    accounts_receivable: number;
  };
  supplier_invoices: SupplierInvoice[];
  supplier_payments: SupplierPayment[];
  monthly_results: MonthlyResult[];
  annual_result: Omit<MonthlyResult, "month" | "movement_count">;
  chart_of_accounts: LedgerAccount[];
  journal_entries: JournalEntry[];
  ledger_balances: LedgerAccount[];
  statement_of_financial_position: { assets: number; liabilities: number; equity: number; liabilities_and_equity: number; balanced: boolean };
  changes_in_equity: { opening_equity: number; contributions: number; withdrawals: number; result: number; closing_equity: number };
  cash_flow: { operating: number; investing: number; financing: number; opening_cash: number; net_change: number; closing_cash: number };
  result_summary: { revenue: number; expenses: number; result: number };
  pending_currency_conversion: number;
  pending_classification: number;
  pending_sale_cost_dates: Array<{ date: string; sales_amount_uyu: number }>;
  sale_cost_records: Array<{ id: string; date: string; treatment: "inventory" | "not_applicable"; amount: number; description: string }>;
  daily_control: {
    last_closed_date: string;
    next_open_date: string;
    blockers: Array<{ type: string; id: string; label: string }>;
    can_close: boolean;
    remaining_activity_days: number;
  };
  cutoff_date: string;
  card_conciliation: CardConciliation;
  proposed_card_settlements: ProposedCardSettlement[];
  till_handovers: TillHandover[];
}

const tabs: Array<{ id: Tab; label: string; icon: typeof CalendarDays; section: "operation" | "accounting" }> = [
  { id: "daily", label: "Planilla diaria", icon: CalendarDays, section: "operation" },
  { id: "journal", label: "Libro diario", icon: BookOpen, section: "accounting" },
  { id: "accounts", label: "Plan de cuentas", icon: ListTree, section: "accounting" },
  { id: "position", label: "Situacion patrimonial", icon: Scale, section: "accounting" },
  { id: "monthly", label: "Estado de resultados", icon: BarChart3, section: "accounting" },
  { id: "equity", label: "Cambios en patrimonio", icon: TrendingUp, section: "accounting" },
  { id: "cashflow", label: "Flujo de efectivo", icon: ArrowLeftRight, section: "accounting" },
  { id: "payables", label: "Facturas a pagar", icon: FileText, section: "accounting" },
  { id: "tarjetas", label: "Tarjetas", icon: CreditCard, section: "accounting" },
  { id: "annual", label: "Contabilidad anual", icon: Landmark, section: "accounting" },
];
const supplierClassificationLabels: Record<string, string> = {
  inventory: "Mercaderías e inventarios",
  cost_of_sales: "Costo de ventas",
  marketing: "Marketing y publicidad",
  services: "Servicios y gastos operativos",
  taxes: "Impuestos y tasas",
  property_plant_equipment: "Propiedad, planta y equipo",
  other_asset: "Otros activos",
  other_expense: "Otros gastos",
  bank_fees: "Costos de mantenimiento de cuenta y comisiones bancarias",
};
const categoriesByDirection: Record<Direction, string[]> = {
  income: ["facturas", "factura_credito", "aportes", "depositos", "tarjetas", "devoluciones", "otros"],
  expense: ["otros", "proveedores", "costo_venta", "impuestos", "servicios", "costos_fijos", "sueldos", "retiros", "devoluciones"],
  transfer: ["depositos", "acreditacion_tarjeta", "retiros", "otros"],
};
const paymentMethods = ["efectivo", "cheque", "deposito", "transferencia", "tarjeta", "visa", "master", "maestro", "mercadolibre", "otro"];
const cardPaymentMethods = new Set(["tarjeta", "visa", "master", "maestro", "mercadolibre"]);
const salePaymentMethods = ["efectivo", "transferencia", "deposito", "tarjeta", "visa", "master", "maestro", "mercadolibre"];
const cardPaymentPlans = [
  { value: "debito", label: "Debito" },
  { value: "credito_1", label: "Credito - 1 cuota" },
  { value: "credito_2", label: "Credito - 2 cuotas" },
  { value: "credito_3", label: "Credito - 3 cuotas" },
];
const paymentMethodLabels: Record<string, string> = {
  efectivo: "Efectivo",
  cheque: "Cheque",
  credito: "Credito / cuenta por cobrar",
  deposito: "Deposito bancario",
  transferencia: "Transferencia bancaria",
  tarjeta: "Tarjeta",
  visa: "Visa",
  master: "Master",
  maestro: "Maestro",
  mercadolibre: "Mercado Libre",
  otro: "Otro",
};
const cardMedioLabels: Record<CardMedio, string> = {
  visa_debito: "Visa débito",
  visa_credito: "Visa crédito",
  master_debito: "Master débito (incluye prepago)",
  master_credito: "Master crédito",
  maestro: "Maestro",
};
const couponIssueLabels: Record<string, string> = {
  empty: "sin factura",
  duplicated: "factura repetida",
  out_of_range: "factura fuera de rango",
};
function movementPaymentLabel(movement: Movement) {
  const method = paymentMethodLabels[movement.payment_method] || movement.payment_method;
  if (!movement.card_payment_type) return method;
  if (movement.card_payment_type === "debito") return `${method} · Debito`;
  const installments = movement.card_installments || 1;
  return `${method} · Credito ${installments} ${installments === 1 ? "cuota" : "cuotas"}`;
}

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
  const invalidate = () => client.refetchQueries({ queryKey: ["accounting"], type: "active" });
  const mutation = useMutation({
    mutationFn: post,
    onSuccess: async () => { toast.success("Contabilidad actualizada"); await invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo guardar"),
  });
  const isAdmin = auth.data?.area === "administracion" || !!auth.data?.allAccess;
  const canManageAccounting = canEditAccounting(auth.data);
  const canOperate = !!auth.data;
  const data = dataQuery.data;

  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">La Casa del Carpintero</div>
        <h1 className="mt-1 text-2xl font-semibold">Contabilidad</h1>
        <p className="mt-1 text-sm text-muted-foreground">{canManageAccounting ? "Operacion integrada y estados financieros bajo NIIF para PYMES." : "Registro diario de ventas, cobros, pagos, retiros y aportes."}</p>
        {auth.data ? <Badge className="mt-2" variant={canManageAccounting ? "default" : "secondary"}>{canManageAccounting ? "Administración contable" : "Operación diaria"}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ano"><Input type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || currentYear())} className="w-24" /></Field>
        <Field label="Mes"><select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="h-9 rounded-md border bg-background px-3 text-sm">{Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
        <Button variant="outline" onClick={() => void dataQuery.refetch()} disabled={dataQuery.isFetching}><RefreshCw /> Actualizar</Button>
      </div>
    </header>

    <div className="space-y-3">
      <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operación diaria</div><nav className="flex gap-1 overflow-x-auto border-b" aria-label="Operación diaria">
        {tabs.filter((item) => item.section === "operation").map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant="ghost" onClick={() => setTab(id)} className={`mb-[-1px] shrink-0 rounded-b-none border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Icon /> {label}</Button>)}
      </nav></div>
      {isAdmin ? <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Administración y estados contables</div><nav className="flex gap-1 overflow-x-auto border-b" aria-label="Administración contable">
        {tabs.filter((item) => item.section === "accounting").map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant="ghost" onClick={() => setTab(id)} className={`mb-[-1px] shrink-0 rounded-b-none border-b-2 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Icon /> {label}</Button>)}
      </nav></div> : null}
    </div>

    {dataQuery.isLoading ? <div className="border bg-card p-10 text-center text-sm text-muted-foreground">Cargando contabilidad...</div> : null}
    {dataQuery.error ? <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{dataQuery.error.message}</div> : null}
    {data ? <>
      {tab === "daily" ? <DailySheet data={data} year={year} month={month} saving={mutation.isPending} canEdit={canOperate} canCorrect={canManageAccounting} onSave={(movement) => mutation.mutate({ operation: "movement", movement })} onSupplierPayment={(payment) => mutation.mutate({ operation: "daily_supplier_payment", payment })} onCorrect={(movementId, direction) => mutation.mutate({ operation: "correct_movement", movement_id: movementId, direction })} onCorrectAmount={(movementId, amount) => mutation.mutate({ operation: "correct_movement_amount", movement_id: movementId, amount })} onCorrectDate={(movementId, date) => mutation.mutate({ operation: "correct_movement_date", movement_id: movementId, date })} onDelete={(movementId) => mutation.mutate({ operation: "delete_movement", movement_id: movementId })} onReplace={(movementId, replacements) => mutation.mutate({ operation: "replace_movement", movement_id: movementId, replacements })} onTillHandover={(handover) => mutation.mutate({ operation: "till_handover", handover })} /> : null}
      {tab === "journal" ? <JournalPanel data={data} saving={mutation.isPending} onSaleCost={(saleCost) => mutation.mutate({ operation: "sale_cost", sale_cost: saleCost })} onCloseDay={(date) => mutation.mutate({ operation: "close_day", date })} /> : null}
      {tab === "accounts" ? <AccountsPanel data={data} saving={mutation.isPending} canEdit={canManageAccounting} onProvision={(provision) => mutation.mutate({ operation: "labor_provision", provision })} /> : null}
      {tab === "position" ? <FinancialPositionPanel data={data} /> : null}
      {tab === "monthly" ? <MonthlyResultPanel data={data} month={month} /> : null}
      {tab === "equity" ? <EquityPanel data={data} /> : null}
      {tab === "cashflow" ? <CashFlowPanel data={data} /> : null}
      {tab === "payables" ? <PayablesPanel data={data} saving={mutation.isPending} canEdit={canManageAccounting} onInvoice={(invoice) => mutation.mutate({ operation: "supplier_invoice", invoice })} onSyncUcfe={() => mutation.mutate({ operation: "supplier_sync" })} onClassify={(invoiceId, classification) => mutation.mutate({ operation: "classify_supplier_invoice", invoice_id: invoiceId, classification })} /> : null}
      {tab === "annual" && isAdmin ? <AnnualPanel data={data} /> : null}
    </> : null}
    {tab === "tarjetas" && isAdmin ? <TarjetasPanel year={year} month={month} canConfirm={canManageAccounting} /> : null}
  </main>;
}

function DailySheet({ data, year, month, saving, canEdit, canCorrect, onSave, onSupplierPayment, onCorrect, onCorrectAmount, onCorrectDate, onDelete, onReplace, onTillHandover }: { data: AccountingData; year: number; month: number; saving: boolean; canEdit: boolean; canCorrect: boolean; onSave: (movement: Record<string, unknown>) => void; onSupplierPayment: (payment: Record<string, unknown>) => void; onCorrect: (movementId: string, direction: Direction) => void; onCorrectAmount: (movementId: string, amount: number) => void; onCorrectDate: (movementId: string, date: string) => void; onDelete: (movementId: string) => void; onReplace: (movementId: string, replacements: Record<string, unknown>[]) => void; onTillHandover: (handover: Record<string, unknown>) => void }) {
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState({
    workday_number: "1",
    date: today(),
    direction: "income",
    category: "facturas",
    subcategory: "",
    payment_method: "efectivo",
    card_plan: "",
    amount: "",
    currency: "UYU",
    description: "",
    reference: "",
    invoice_number: "",
    issue_date: today(),
    due_date: "",
    supplier_invoice_id: "",
    invoice_currency_amount: "",
  });
  const openInvoices = data.supplier_invoices.filter((item) => item.status !== "pagada" && item.status !== "no_aplica");
  const selectedInvoice = openInvoices.find((item) => item.id === draft.supplier_invoice_id);
  const isSupplierPayment = draft.direction === "expense" && draft.category === "proveedores";
  const isSalesInvoice = draft.direction === "income" && ["facturas", "factura_credito"].includes(draft.category);
  const isCardSettlement = draft.direction === "transfer" && draft.category === "acreditacion_tarjeta";
  const isCreditSalesInvoice = isSalesInvoice && draft.category === "factura_credito";
  const isCardSale = isSalesInvoice && cardPaymentMethods.has(draft.payment_method);
  const invoiceComplete = !isSalesInvoice || !!(draft.invoice_number.trim() && draft.issue_date && draft.due_date && draft.due_date >= draft.issue_date && (!isCardSale || draft.card_plan));
  const totals = useMemo(() => {
    const uyuMovements = data.movements.filter((m) => m.currency === "UYU");
    const income = uyuMovements.filter((m) => m.direction === "income").reduce((sum, m) => sum + m.amount, 0);
    const expenses = uyuMovements.filter((m) => m.direction === "expense").reduce((sum, m) => sum + m.amount, 0);
    return { income, expenses };
  }, [data.movements]);
  function save() {
    if (isCardSale && !draft.card_plan) {
      toast.error("Selecciona debito o credito en 1, 2 o 3 cuotas");
      return;
    }
    if (isSalesInvoice && !invoiceComplete) {
      toast.error("Completa numero, fecha de emision y vencimiento de la factura");
      return;
    }
    if (isCardSettlement && Number(draft.amount) > data.account_balances.card_receivables) {
      toast.error("La acreditacion no puede superar el saldo pendiente en financieras");
      return;
    }
    if (isSupplierPayment) {
      if (!draft.subcategory.trim()) {
        toast.error("Indica el proveedor que recibe el pago");
        return;
      }
      const amount = Number(draft.amount);
      const crossCurrency = !!selectedInvoice && draft.currency !== selectedInvoice.currency;
      const invoiceCurrencyAmount = selectedInvoice ? (crossCurrency ? Number(draft.invoice_currency_amount) : amount) : undefined;
      if (selectedInvoice && !(Number(invoiceCurrencyAmount) > 0)) {
        toast.error(`Ingresa cuanto saldo se cancela en ${selectedInvoice.currency}`);
        return;
      }
      if (selectedInvoice && Number(invoiceCurrencyAmount) > selectedInvoice.balance + 0.01) {
        toast.error("El pago no puede superar el saldo pendiente de la factura");
        return;
      }
      onSupplierPayment({
        supplier_invoice_id: selectedInvoice?.id || "",
        supplier: draft.subcategory.trim(),
        payment_date: draft.date,
        amount,
        currency: draft.currency,
        ...(selectedInvoice ? { invoice_currency_amount: invoiceCurrencyAmount } : {}),
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
      setDraft((prev) => ({ ...prev, amount: "", description: "", reference: "", invoice_number: "", due_date: "", card_plan: "", supplier_invoice_id: "", invoice_currency_amount: "" }));
      return;
    }
    onSave({ ...draft, year, month, amount: Number(draft.amount) });
    setDraft((prev) => ({ ...prev, amount: "", description: "", reference: "", invoice_number: "", due_date: "", card_plan: "", supplier_invoice_id: "" }));
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
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Entradas UYU del mes" value={money(totals.income)} /><Metric label="Salidas UYU del mes" value={money(totals.expenses)} /><Metric label="Saldo en caja" value={money(data.account_balances.cash)} /><Metric label="Saldo bancario registrado" value={money(data.account_balances.bank)} /><Metric label="Pendiente de financieras" value={money(data.account_balances.card_receivables)} /><Metric label="Cuentas por cobrar" value={money(data.account_balances.accounts_receivable)} /></section>
    <TillHandoverPanel data={data} saving={saving} canEdit={canEdit} onTillHandover={onTillHandover} />
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
      {canEdit ? <><div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset className="rounded-md border p-4"><legend className="px-1 text-sm font-semibold">Datos del movimiento</legend><div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dia trabajado"><Input type="number" min="1" value={draft.workday_number} onChange={(e) => setDraft({ ...draft, workday_number: e.target.value })} /></Field>
        <Field label="Fecha"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value, issue_date: e.target.value })} /></Field>
        <Field label="Tipo"><select value={draft.direction} onChange={(e) => { const direction = e.target.value as Direction; const category = categoriesByDirection[direction][0]; setDraft({ ...draft, direction, category, payment_method: direction === "income" && category === "factura_credito" ? "credito" : "efectivo", card_plan: "", supplier_invoice_id: "" }); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="income">Entrada</option><option value="expense">Salida</option><option value="transfer">Transferencia</option></select></Field>
        <Field label="Categoria"><select value={draft.category} onChange={(e) => { const category = e.target.value; setDraft({ ...draft, category, payment_method: category === "factura_credito" ? "credito" : category === "acreditacion_tarjeta" ? "tarjeta" : draft.payment_method === "credito" ? "efectivo" : draft.payment_method, card_plan: "", currency: category === "acreditacion_tarjeta" ? "UYU" : draft.currency, supplier_invoice_id: "" }); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{categoriesByDirection[draft.direction as Direction].map((category) => <option key={category} value={category}>{category === "acreditacion_tarjeta" ? "Acreditacion de tarjeta" : category}</option>)}</select></Field>
        </div></fieldset>
        <fieldset className="rounded-md border p-4"><legend className="px-1 text-sm font-semibold">Importe y medio</legend><div className="grid gap-3 sm:grid-cols-2">
        {!isSalesInvoice && !isCardSettlement ? <Field label="Medio"><select value={draft.payment_method} onChange={(e) => setDraft({ ...draft, payment_method: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select></Field> : null}
        <Field label="Importe"><Input type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
        <Field label="Moneda"><select disabled={isCardSettlement} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value, invoice_currency_amount: "" })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="UYU">UYU</option><option value="USD">USD</option></select></Field>
        <Field label="Subcategoria"><Input value={draft.subcategory} onChange={(e) => setDraft({ ...draft, subcategory: e.target.value })} /></Field>
        </div></fieldset>
        {isSalesInvoice ? <fieldset className="rounded-md border border-primary/30 bg-primary/5 p-4 lg:col-span-2"><legend className="px-1 text-sm font-semibold text-primary">Factura de venta</legend><div className="grid gap-3 md:grid-cols-4">
          <Field label="Numero de factura *"><Input required value={draft.invoice_number} onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })} /></Field>
          <Field label="Fecha de emision *"><Input required type="date" value={draft.issue_date} onChange={(e) => setDraft({ ...draft, issue_date: e.target.value })} /></Field>
          <Field label="Fecha de vencimiento *"><Input required type="date" min={draft.issue_date} value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></Field>
          <Field label="Medio de cobro *"><select required disabled={isCreditSalesInvoice} value={draft.payment_method} onChange={(e) => { const payment_method = e.target.value; setDraft({ ...draft, payment_method, card_plan: cardPaymentMethods.has(payment_method) ? draft.card_plan : "" }); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{(isCreditSalesInvoice ? ["credito"] : salePaymentMethods).map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select></Field>
          {isCardSale ? <Field label="Modalidad de tarjeta *"><select required value={draft.card_plan} onChange={(e) => setDraft({ ...draft, card_plan: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">Seleccionar modalidad</option>{cardPaymentPlans.map((plan) => <option key={plan.value} value={plan.value}>{plan.label}</option>)}</select></Field> : null}
        </div></fieldset> : null}
        {isCardSettlement ? <fieldset className="rounded-md border border-primary/30 bg-primary/5 p-4 lg:col-span-2"><legend className="px-1 text-sm font-semibold text-primary">Acreditacion de tarjeta en banco</legend><div className="grid gap-3 md:grid-cols-2"><Field label="Tarjeta / financiera *"><select required value={draft.payment_method} onChange={(e) => setDraft({ ...draft, payment_method: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{["tarjeta", "visa", "master", "maestro", "mercadolibre"].map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}</select></Field><div className="rounded-md border border-primary/20 bg-background/70 px-3 py-2 text-sm"><span className="font-medium">Financiera → Banco</span><p className="text-muted-foreground">Resta el importe pendiente de la financiera y lo suma al banco, sin registrar una venta nueva.</p></div></div></fieldset> : null}
        {isSupplierPayment ? <fieldset className="rounded-md border border-primary/30 bg-primary/5 p-4 lg:col-span-2"><legend className="px-1 text-sm font-semibold text-primary">Asociacion con factura de compra</legend><Field label="Factura UCFE (opcional)"><select value={draft.supplier_invoice_id} onChange={(e) => {
          const invoice = openInvoices.find((item) => item.id === e.target.value);
          setDraft({ ...draft, supplier_invoice_id: e.target.value, currency: invoice?.currency || draft.currency, amount: invoice ? String(invoice.balance) : draft.amount, invoice_currency_amount: "", subcategory: invoice?.supplier || draft.subcategory });
        }} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">Registrar sin asociar factura</option>{openInvoices.map((item) => <option key={item.id} value={item.id}>{item.supplier} - factura {item.invoice_number || "sin numero"} - saldo {money(item.balance, item.currency)}</option>)}</select></Field><p className="mt-2 text-xs text-muted-foreground">Puedes registrar el pago aunque el comprobante todavia no figure en UCFE.</p>{selectedInvoice && draft.currency !== selectedInvoice.currency ? <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label={`Importe cancelado en ${selectedInvoice.currency} *`}><Input type="number" min="0.01" step="0.01" value={draft.invoice_currency_amount} onChange={(e) => setDraft({ ...draft, invoice_currency_amount: e.target.value })} /></Field><div className="rounded-md border bg-background/70 px-3 py-2 text-sm"><span className="font-medium">Tipo de cambio efectivo</span><p className="text-muted-foreground">{Number(draft.amount) > 0 && Number(draft.invoice_currency_amount) > 0 ? `${money(Number(draft.amount), draft.currency)} ÷ ${money(Number(draft.invoice_currency_amount), selectedInvoice.currency)} = ${(Number(draft.amount) / Number(draft.invoice_currency_amount)).toFixed(4)}` : "Se calcula con los dos importes reales ingresados."}</p></div></div> : null}</fieldset> : null}
        <fieldset className="rounded-md border p-4 lg:col-span-2"><legend className="px-1 text-sm font-semibold">Detalle y comprobante</legend><div className="grid gap-3 md:grid-cols-2">
          <Field label="Descripcion"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label={isSupplierPayment ? "Recibo / referencia" : "Referencia adicional"}><Input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} /></Field>
        </div></fieldset>
      </div>
      {isSupplierPayment && selectedInvoice ? <div className="mt-3 text-sm text-muted-foreground">Factura {selectedInvoice.invoice_number || "sin numero"} de {selectedInvoice.supplier}. Saldo pendiente: <span className="font-medium text-foreground">{money(selectedInvoice.balance, selectedInvoice.currency)}</span>.</div> : null}
      <Button type="button" className="mt-4" disabled={saving || !(Number(draft.amount) > 0) || !invoiceComplete || (isSupplierPayment && (!draft.subcategory.trim() || (!!selectedInvoice && draft.currency !== selectedInvoice.currency && !(Number(draft.invoice_currency_amount) > 0)))) || (isCardSettlement && Number(draft.amount) > data.account_balances.card_receivables)} onClick={save}><CirclePlus /> {isSupplierPayment ? "Registrar pago a proveedor" : isCardSettlement ? "Registrar acreditacion" : "Registrar movimiento"}</Button></> : <div className="mt-4 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Tu usuario no tiene permisos para cargar movimientos.</div>}
    </section>
    <MovementTable movements={data.movements} canCorrect={canCorrect} saving={saving} onCorrect={onCorrect} onCorrectAmount={onCorrectAmount} onCorrectDate={onCorrectDate} onDelete={onDelete} />
    {canCorrect ? <MovementDateCorrections movements={data.movements} saving={saving} onCorrectDate={onCorrectDate} /> : null}
    {canCorrect ? <MovementAmountCorrections movements={data.movements} saving={saving} onCorrectAmount={onCorrectAmount} /> : null}
    {canCorrect ? <MovementDeletionPanel movements={data.movements} saving={saving} onDelete={onDelete} /> : null}
    {canCorrect ? <SalesBreakdownPanel movements={data.movements} saving={saving} onReplace={onReplace} /> : null}
  </div>;
}

function TillHandoverPanel({ data, saving, canEdit, onTillHandover }: { data: AccountingData; saving: boolean; canEdit: boolean; onTillHandover: (handover: Record<string, unknown>) => void }) {
  const day = data.daily_control.next_open_date || today();
  const existing = data.till_handovers.find((item) => item.date === day);
  const conciliation = data.card_conciliation;
  const flagged = conciliation?.coupon_integrity?.flagged ?? [];
  const [draft, setDraft] = useState({ counted_cash: "", visa_debito: "", visa_credito: "", master_debito: "", master_credito: "", maestro: "", pos_batches: "", ticket_close_total: "" });
  const [redo, setRedo] = useState(false);
  const cardFields: Array<{ key: CardMedio; label: string }> = [
    { key: "visa_debito", label: "Visa débito" },
    { key: "visa_credito", label: "Visa crédito" },
    { key: "master_debito", label: "Master débito (incluye prepago)" },
    { key: "master_credito", label: "Master crédito" },
    { key: "maestro", label: "Maestro" },
  ];
  const blocked = !!existing && !redo;
  function submit() {
    const counted = Number(draft.counted_cash);
    if (!draft.counted_cash.trim() || !(counted >= 0)) { toast.error("Ingresa el efectivo contado (no puede ser negativo)"); return; }
    const cardTotals: Record<CardMedio, number> = { visa_debito: 0, visa_credito: 0, master_debito: 0, master_credito: 0, maestro: 0 };
    for (const field of cardFields) cardTotals[field.key] = Number(draft[field.key]) || 0;
    const posBatches = draft.pos_batches.split(",").map((value) => value.trim()).filter(Boolean);
    const handover: Record<string, unknown> = { date: day, counted_cash: counted, card_totals: cardTotals, pos_batches: posBatches };
    if (Number(draft.ticket_close_total) > 0) handover.ticket_close_total = Number(draft.ticket_close_total);
    if (existing) handover.override = true;
    onTillHandover(handover);
    setDraft({ counted_cash: "", visa_debito: "", visa_credito: "", master_debito: "", master_credito: "", maestro: "", pos_batches: "", ticket_close_total: "" });
    setRedo(false);
  }
  return <section className="border bg-card p-4">
    <div className="flex flex-col gap-1"><div className="text-xs font-semibold uppercase tracking-wider text-primary">Cierre de caja</div><h2 className="font-semibold">Entregar caja</h2><p className="text-xs text-muted-foreground">Día a entregar: <span className="font-medium text-foreground">{day}</span>. El efectivo contado es obligatorio; los totales de tarjeta y el ticket de cierre son opcionales.</p></div>
    {existing ? <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"><div className="font-medium">Ya se registró una entrega para {day}{existing.overridden ? ` (rehecha ${existing.override_count} ${existing.override_count === 1 ? "vez" : "veces"})` : ""}.</div><div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2"><span>Efectivo contado: <span className="font-medium text-foreground tabular-nums">{money(existing.counted_cash)}</span></span><span>Ticket de cierre: <span className="font-medium text-foreground tabular-nums">{existing.ticket_close_total != null ? money(existing.ticket_close_total) : "—"}</span></span>{cardFields.map((field) => <span key={field.key}>{field.label}: <span className="font-medium text-foreground tabular-nums">{money(existing.card_totals[field.key])}</span></span>)}<span>Lotes POS: <span className="font-medium text-foreground">{existing.pos_batches.length ? existing.pos_batches.join(", ") : "—"}</span></span></div></div> : null}
    {canEdit ? <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Efectivo contado *"><Input type="number" min="0" step="0.01" value={draft.counted_cash} onChange={(event) => setDraft({ ...draft, counted_cash: event.target.value })} /></Field>
        {cardFields.map((field) => <Field key={field.key} label={field.label}><Input type="number" min="0" step="0.01" value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} /></Field>)}
        <Field label="Lote(s) del POS"><Input value={draft.pos_batches} onChange={(event) => setDraft({ ...draft, pos_batches: event.target.value })} placeholder="123, 124" /></Field>
        <Field label="Total del ticket de cierre"><Input type="number" min="0" step="0.01" value={draft.ticket_close_total} onChange={(event) => setDraft({ ...draft, ticket_close_total: event.target.value })} /></Field>
      </div>
      {existing ? <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={redo} onChange={(event) => setRedo(event.target.checked)} className="h-4 w-4 rounded border" /><span>Rehacer entrega (reemplaza la registrada para {day})</span></label> : null}
      <Button type="button" className="mt-4" disabled={saving || blocked || !(Number(draft.counted_cash) >= 0) || !draft.counted_cash.trim()} onClick={submit}><CirclePlus /> {existing ? "Rehacer entrega de caja" : "Entregar caja"}</Button>
    </> : <div className="mt-4 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Tu usuario no tiene permisos para entregar la caja.</div>}
    {existing ? <div className="mt-5"><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Arqueo del día</div><div className="mt-2 grid gap-3 sm:grid-cols-3">
      <Metric label="Efectivo contado" value={money(existing.counted_cash)} />
      <Metric label="Efectivo teórico" value={money(existing.theoretical_cash)} />
      <div className={`border p-4 ${existing.difference > 0 ? "border-emerald-300 bg-emerald-50" : existing.difference < 0 ? "border-red-300 bg-red-50" : ""}`}><div className="text-sm text-muted-foreground">Diferencia registrada</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${existing.difference > 0 ? "text-emerald-700" : existing.difference < 0 ? "text-red-600" : ""}`}>{money(existing.difference)}</div><div className="mt-1 text-xs text-muted-foreground">{existing.difference > 0 ? "Sobrante" : existing.difference < 0 ? "Faltante" : "Sin diferencia"} · registrado como hecho, no requiere corrección.</div></div>
    </div></div> : null}
    <div className="mt-5"><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conciliación de lote POS vs. caja</div>
      {!conciliation || conciliation.pending_sync || !conciliation.has_coupons ? <div className="mt-2 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Datos de Fiserv pendientes de sincronizar para este día.</div> : <>
        <div className="mt-2 overflow-x-auto border"><table className="w-full min-w-[520px] text-sm"><thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Medio</th><th className="px-3 py-2 text-right">POS</th><th className="px-3 py-2 text-right">Caja</th><th className="px-3 py-2 text-right">Diferencia</th><th className="px-3 py-2">Estado</th></tr></thead><tbody className="divide-y">{conciliation.per_medio.map((row) => <tr key={row.medio}><td className="px-3 py-2">{cardMedioLabels[row.medio]}</td><td className="px-3 py-2 text-right tabular-nums">{money(row.pos_total)}</td><td className="px-3 py-2 text-right tabular-nums">{money(row.caja_total)}</td><td className={`px-3 py-2 text-right tabular-nums ${row.difference < 0 ? "text-red-600" : row.difference > 0 ? "text-emerald-700" : ""}`}>{money(row.difference)}</td><td className="px-3 py-2"><Badge variant={row.flag === "faltante" ? "destructive" : row.flag === "sobrante" ? "secondary" : "outline"}>{row.flag === "faltante" ? "Faltante" : row.flag === "sobrante" ? "Sobrante" : "OK"}</Badge></td></tr>)}</tbody></table></div>
        {conciliation.unmapped_pos_total ? <p className="mt-2 text-xs text-muted-foreground">Cupones del POS sin medio identificado: <span className="font-medium text-foreground tabular-nums">{money(conciliation.unmapped_pos_total)}</span>.</p> : null}
        {flagged.length ? <div className="mt-3"><div className="text-xs font-medium text-amber-900">Cupones observados</div><ul className="mt-1 space-y-1 text-sm">{flagged.map((coupon) => <li key={coupon.fiserv_id} className="text-amber-900">• Factura {coupon.bill_number || "—"} · lote/cupón {coupon.batch || "—"}/{coupon.ticket || "—"} · {coupon.product_name || "—"} · {money(coupon.amount)} · {coupon.issues.map((issue) => couponIssueLabels[issue] || issue).join(", ")}</li>)}</ul></div> : null}
      </>}
    </div>
  </section>;
}

function JournalPanel({ data, saving, onSaleCost, onCloseDay }: { data: AccountingData; saving: boolean; onSaleCost: (saleCost: Record<string, unknown>) => void; onCloseDay: (date: string) => void }) {
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Asientos del mes" value={data.journal_entries.length} /><Metric label="Debe del mes" value={money(data.journal_entries.reduce((sum, entry) => sum + entry.debit, 0))} /><Metric label="Haber del mes" value={money(data.journal_entries.reduce((sum, entry) => sum + entry.credit, 0))} /></section>
    <DailyControlPanel control={data.daily_control} saving={saving} onClose={onCloseDay} />
    <SaleCostPanel pending={data.pending_sale_cost_dates} records={data.sale_cost_records} saving={saving} onSave={onSaleCost} />
    {data.pending_classification ? <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">Hay {data.pending_classification} facturas pendientes de clasificación. No se incluyen en el libro diario ni en los estados hasta que Administración confirme su tratamiento.</div> : null}
    {data.pending_currency_conversion ? <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">Hay {data.pending_currency_conversion} partidas en moneda extranjera pendientes de convertir a UYU para los estados financieros.</div> : null}
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Libro diario</h2><p className="mt-1 text-xs text-muted-foreground">Asientos generados automaticamente desde movimientos, facturas UCFE y ajustes contables.</p></div>
      {data.journal_entries.length === 0 ? <Empty text="No hay asientos para el periodo seleccionado." /> : <div className="divide-y">{data.journal_entries.map((entry) => <article key={entry.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><span className="font-medium">{entry.description}</span><Badge variant={entry.balanced ? "outline" : "destructive"}>{entry.balanced ? "Balanceado" : "Desbalanceado"}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{entry.date} · {entry.reference || "Sin referencia"} · {entry.source.replaceAll("_", " ")}</div></div><div className="text-sm font-semibold tabular-nums">{money(entry.debit)}</div></div>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Cuenta</th><th className="px-3 py-2 text-right">Debe</th><th className="px-3 py-2 text-right">Haber</th></tr></thead><tbody className="divide-y">{entry.lines.map((line, index) => <tr key={`${entry.id}-${line.account_code}-${index}`}><td className="px-3 py-2"><span className="font-mono text-xs text-muted-foreground">{line.account_code}</span> · {line.account_name}</td><td className="px-3 py-2 text-right tabular-nums">{line.debit ? money(line.debit) : "-"}</td><td className="px-3 py-2 text-right tabular-nums">{line.credit ? money(line.credit) : "-"}</td></tr>)}</tbody></table></div>
      </article>)}</div>}
    </section>
  </div>;
}

function DailyControlPanel({ control, saving, onClose }: { control: AccountingData["daily_control"]; saving: boolean; onClose: (date: string) => void }) {
  return <section className="border bg-card p-4">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Secuencia contable</div><h2 className="mt-1 font-semibold">Cierre diario cronológico</h2><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Los comprobantes se registran en su fecha original. No se habilita un día posterior hasta resolver y cerrar el día contable más antiguo; un día cerrado no admite cargas ni reclasificaciones retroactivas.</p></div><div className="shrink-0 text-sm"><div className="text-muted-foreground">Último cierre</div><div className="font-semibold">{control.last_closed_date || "Sin cierres todavía"}</div></div></div>
    {control.next_open_date ? <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-start"><div className="rounded-md border bg-muted/30 p-3"><div className="text-xs text-muted-foreground">Próximo día a cerrar</div><div className="mt-1 text-xl font-semibold">{control.next_open_date}</div><div className="mt-1 text-xs text-muted-foreground">{control.remaining_activity_days} días con actividad pendientes</div></div><div>{control.blockers.length ? <><div className="text-sm font-medium text-amber-900">Pendientes que bloquean el cierre</div><ul className="mt-2 space-y-1 text-sm text-amber-900">{control.blockers.slice(0, 8).map((blocker) => <li key={`${blocker.type}-${blocker.id}`}>• {blocker.label}</li>)}</ul>{control.blockers.length > 8 ? <div className="mt-2 text-xs text-muted-foreground">Y {control.blockers.length - 8} pendientes más.</div> : null}</> : <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">El día está completo y puede cerrarse.</div>}</div><Button disabled={saving || !control.can_close} onClick={() => onClose(control.next_open_date)}>Cerrar día contable</Button></div> : <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">No quedan días con actividad pendientes de cierre.</div>}
  </section>;
}

function SaleCostPanel({ pending, records, saving, onSave }: { pending: AccountingData["pending_sale_cost_dates"]; records: AccountingData["sale_cost_records"]; saving: boolean; onSave: (saleCost: Record<string, unknown>) => void }) {
  const [selectedDate, setSelectedDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const effectiveDate = pending.some((item) => item.date === selectedDate) ? selectedDate : pending[0]?.date || "";
  const selected = pending.find((item) => item.date === effectiveDate);
  return <section className="border bg-card p-4">
    <div className="flex flex-col gap-1"><h2 className="font-semibold">Costo de ventas contra mercaderías</h2><p className="text-xs text-muted-foreground">Administración confirma el costo real vendido por fecha. El sistema no aplica porcentajes ni márgenes estimados.</p></div>
    {pending.length ? <><div className="mt-4 grid gap-3 md:grid-cols-3"><Field label="Fecha pendiente"><select value={effectiveDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{pending.map((item) => <option key={item.date} value={item.date}>{item.date} · ventas {money(item.sales_amount_uyu)}</option>)}</select></Field><Field label="Costo real vendido en UYU"><Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Respaldo / detalle"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Valuación de inventario, reporte, etc." /></Field></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={saving || !effectiveDate || !(Number(amount) > 0)} onClick={() => { onSave({ date: effectiveDate, treatment: "inventory", amount: Number(amount), description }); setAmount(""); setDescription(""); }}><CirclePlus /> Generar asiento de costo</Button><Button variant="outline" disabled={saving || !effectiveDate} onClick={() => onSave({ date: effectiveDate, treatment: "not_applicable", amount: 0, description: description || "Venta sin efecto en inventarios confirmada por Administración" })}>Confirmar sin efecto en inventarios</Button></div>{selected ? <p className="mt-3 text-xs text-muted-foreground">Ventas registradas ese día: {money(selected.sales_amount_uyu)}. El importe del costo debe provenir del inventario o documentación de respaldo.</p> : null}</> : <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Todas las fechas con ventas tienen definido su tratamiento de costo.</div>}
    {records.length ? <div className="mt-4 text-xs text-muted-foreground">Últimos criterios: {records.slice(0, 5).map((record) => `${record.date}: ${record.treatment === "inventory" ? money(record.amount) : "sin inventario"}`).join(" · ")}</div> : null}
  </section>;
}

function AccountsPanel({ data, saving, canEdit, onProvision }: { data: AccountingData; saving: boolean; canEdit: boolean; onProvision: (provision: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState({ provision_type: "aguinaldo", date: today(), amount: "", description: "" });
  const classes: LedgerAccount["class"][] = ["activo", "pasivo", "patrimonio", "ingreso", "gasto"];
  return <div className="space-y-5">
    {canEdit ? <section className="border bg-card p-4"><h2 className="font-semibold">Registrar provision laboral</h2><p className="mt-1 text-xs text-muted-foreground">El importe debe surgir de la liquidacion laboral. El sistema genera el gasto y el pasivo correspondiente.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Provision"><select value={draft.provision_type} onChange={(event) => setDraft({ ...draft, provision_type: event.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="aguinaldo">Aguinaldo</option><option value="licencia">Licencia</option><option value="salario_vacacional">Salario vacacional</option></select></Field><Field label="Fecha"><Input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field><Field label="Importe UYU"><Input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></Field><Field label="Detalle"><Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field></div><Button className="mt-4" disabled={saving || !draft.date || !(Number(draft.amount) > 0)} onClick={() => { onProvision({ ...draft, amount: Number(draft.amount) }); setDraft((current) => ({ ...current, amount: "", description: "" })); }}><CirclePlus /> Registrar provision</Button></section> : null}
    <section className="border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Plan de cuentas</h2><p className="mt-1 text-xs text-muted-foreground">Codificacion: 1 Activo · 2 Pasivo · 3 Patrimonio · 4 Ingresos · 5 Gastos y perdidas.</p></div><div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">{classes.map((accountClass) => <div key={accountClass} className="bg-card p-4"><h3 className="text-sm font-semibold capitalize">{accountClass}</h3><div className="mt-3 space-y-2">{data.chart_of_accounts.filter((account) => account.class === accountClass).map((account) => <div key={account.code} className="flex items-start justify-between gap-3 text-sm"><div><span className="font-mono text-xs text-muted-foreground">{account.code}</span><div>{account.name}</div><div className="text-xs text-muted-foreground">{account.group}</div></div><Badge variant="outline">{account.nature === "debit" ? "Debe" : "Haber"}</Badge></div>)}</div></div>)}</div></section>
  </div>;
}

function FinancialPositionPanel({ data }: { data: AccountingData }) {
  const position = data.statement_of_financial_position;
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Activo" value={money(position.assets)} /><Metric label="Pasivo" value={money(position.liabilities)} /><Metric label="Patrimonio" value={money(position.equity)} /><Metric label="Pasivo + Patrimonio" value={money(position.liabilities_and_equity)} tone={position.balanced ? "good" : "bad"} /></section>
    {data.pending_classification ? <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">Estado provisional: hay {data.pending_classification} facturas sin clasificación contable y, por seguridad, todavía no forman parte de estas cifras.</div> : null}
    <div className={`border px-4 py-3 text-sm ${position.balanced ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>{position.balanced ? "La ecuacion contable esta balanceada: Activo = Pasivo + Patrimonio." : "Existe una diferencia contable que debe revisarse antes de emitir estados."}</div>
    <section className="grid gap-5 lg:grid-cols-2"><StatementBlock title="Activo" accounts={data.ledger_balances.filter((account) => account.class === "activo")} total={position.assets} /><div className="space-y-5"><StatementBlock title="Pasivo" accounts={data.ledger_balances.filter((account) => account.class === "pasivo")} total={position.liabilities} /><StatementBlock title="Patrimonio" accounts={data.ledger_balances.filter((account) => account.class === "patrimonio")} extraLines={[{ label: "Resultado del ejercicio", value: data.result_summary.result }]} total={position.equity} /></div></section>
  </div>;
}

function EquityPanel({ data }: { data: AccountingData }) {
  const equity = data.changes_in_equity;
  return <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-3"><Metric label="Patrimonio inicial" value={money(equity.opening_equity)} /><Metric label="Resultado del ejercicio" value={money(equity.result)} tone={equity.result >= 0 ? "good" : "bad"} /><Metric label="Patrimonio final" value={money(equity.closing_equity)} /></section><section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Estado de cambios en el patrimonio</h2><p className="mt-1 text-xs text-muted-foreground">Desde el 1 de enero hasta {data.cutoff_date}.</p></div><table className="w-full text-sm"><tbody className="divide-y"><StatementTableRow label="Patrimonio al inicio" value={equity.opening_equity} /><StatementTableRow label="Aportes de propietarios" value={equity.contributions} /><StatementTableRow label="Retiros y distribuciones" value={-equity.withdrawals} /><StatementTableRow label="Resultado del ejercicio" value={equity.result} /><StatementTableRow label="Patrimonio al cierre" value={equity.closing_equity} strong /></tbody></table></section></div>;
}

function CashFlowPanel({ data }: { data: AccountingData }) {
  const flow = data.cash_flow;
  return <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-3"><Metric label="Efectivo inicial" value={money(flow.opening_cash)} /><Metric label="Variacion neta" value={money(flow.net_change)} tone={flow.net_change >= 0 ? "good" : "bad"} /><Metric label="Efectivo final" value={money(flow.closing_cash)} /></section><section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Estado de flujo de efectivo</h2><p className="mt-1 text-xs text-muted-foreground">Metodo directo, clasificado por actividades, desde el 1 de enero hasta {data.cutoff_date}.</p></div><table className="w-full text-sm"><tbody className="divide-y"><StatementTableRow label="Flujos de actividades operativas" value={flow.operating} /><StatementTableRow label="Flujos de actividades de inversion" value={flow.investing} /><StatementTableRow label="Flujos de actividades de financiacion" value={flow.financing} /><StatementTableRow label="Variacion neta de efectivo" value={flow.net_change} strong /><StatementTableRow label="Efectivo y equivalentes al cierre" value={flow.closing_cash} strong /></tbody></table></section></div>;
}

function StatementBlock({ title, accounts, total, extraLines = [] }: { title: string; accounts: LedgerAccount[]; total: number; extraLines?: Array<{ label: string; value: number }> }) {
  const groups = Array.from(new Set(accounts.map((account) => account.group)));
  return <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">{title}</h2></div><div>{groups.map((group) => <div key={group} className="border-b last:border-b-0"><div className="bg-muted/50 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">{group}</div>{accounts.filter((account) => account.group === group).map((account) => <StatementRow key={account.code} label={`${account.code} · ${account.name}`} value={account.balance || 0} />)}</div>)}{extraLines.map((line) => <StatementRow key={line.label} label={line.label} value={line.value} />)}<StatementRow label={`Total ${title.toLowerCase()}`} value={total} strong /></div></section>;
}

function StatementRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${strong ? "bg-muted/40 font-semibold" : ""}`}><span>{label}</span><span className={`tabular-nums ${value < 0 ? "text-red-600" : ""}`}>{money(value)}</span></div>;
}

function StatementTableRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <tr className={strong ? "bg-muted/40 font-semibold" : ""}><td className="px-4 py-3">{label}</td><td className={`px-4 py-3 text-right tabular-nums ${value < 0 ? "text-red-600" : ""}`}>{money(value)}</td></tr>;
}

function MonthlyResultPanel({ data, month }: { data: AccountingData; month: number }) {
  const row = data.monthly_results.find((item) => item.month === month);
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Ventas brutas" value={money(row?.gross_sales)} /><Metric label="Costos" value={money(row?.total_costs)} /><Metric label="Resultado" value={money(row?.operating_result)} tone={(row?.operating_result || 0) >= 0 ? "good" : "bad"} /><Metric label="Movimientos" value={row?.movement_count || 0} /></section>
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Estado de resultados mensual</h2></div><table className="w-full text-sm"><tbody className="divide-y"><ResultLine label="Ventas efectivo / caja" value={row?.cash_sales} /><ResultLine label="Ventas depositadas en banco" value={row?.bank_sales} /><ResultLine label="Ventas pendientes de financieras" value={row?.card_sales} /><ResultLine label="Ventas a credito" value={row?.credit_sales} /><ResultLine label="Costos fijos" value={row?.fixed_costs} negative /><ResultLine label="Sueldos" value={row?.payroll} negative /><ResultLine label="Proveedores / costo de venta" value={row?.supplier_costs} negative /><ResultLine label="Otros costos" value={row?.other_costs} negative /><ResultLine label="Resultado operativo" value={row?.operating_result} strong /></tbody></table></section>
  </div>;
}

function PayablesPanel({ data, saving, canEdit, onInvoice, onSyncUcfe, onClassify }: { data: AccountingData; saving: boolean; canEdit: boolean; onInvoice: (invoice: Record<string, unknown>) => void; onSyncUcfe: () => void; onClassify: (invoiceId: string, classification: string) => void }) {
  const [invoice, setInvoice] = useState({ supplier: "", rut: "", invoice_number: "", currency: "UYU", amount: "", purchase_date: today(), due_date: "", notes: "" });
  const open = data.supplier_invoices.filter((item) => item.status !== "pagada" && item.status !== "no_aplica");
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Facturas pendientes" value={open.length} /><Metric label="Saldo UYU" value={money(open.filter((i) => i.currency === "UYU").reduce((sum, i) => sum + i.balance, 0))} /><Metric label="Saldo USD" value={money(open.filter((i) => i.currency === "USD").reduce((sum, i) => sum + i.balance, 0), "USD")} /><div className="border bg-card p-4"><div className="text-sm text-muted-foreground">{canEdit ? "UCFE recibidos" : "Permisos"}</div>{canEdit ? <Button className="mt-2 w-full" variant="outline" disabled={saving} onClick={onSyncUcfe}><RefreshCw /> Sincronizar</Button> : <div className="mt-2 text-sm font-medium">Solo lectura</div>}</div></section>
    {data.pending_classification ? <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><span className="font-semibold">{data.pending_classification} facturas requieren criterio contable.</span> Abrí el detalle del proveedor y elegí la clasificación de cada factura. Mientras estén pendientes no generan asientos ni alteran los estados.</div> : null}
    {canEdit ? <section className="border bg-card p-4">
      <h2 className="font-semibold">Nueva factura de compra</h2>
      <p className="mt-1 text-xs text-muted-foreground">El numero, la fecha de emision y el vencimiento son obligatorios.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Proveedor *"><Input required value={invoice.supplier} onChange={(e) => setInvoice({ ...invoice, supplier: e.target.value })} /></Field><Field label="RUT"><Input value={invoice.rut} onChange={(e) => setInvoice({ ...invoice, rut: e.target.value })} /></Field><Field label="Numero de factura *"><Input required value={invoice.invoice_number} onChange={(e) => setInvoice({ ...invoice, invoice_number: e.target.value })} /></Field><Field label="Monto *"><Input required type="number" min="0" step="0.01" value={invoice.amount} onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })} /></Field><Field label="Moneda"><select value={invoice.currency} onChange={(e) => setInvoice({ ...invoice, currency: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="UYU">UYU</option><option value="USD">USD</option></select></Field><Field label="Fecha de emision *"><Input required type="date" value={invoice.purchase_date} onChange={(e) => setInvoice({ ...invoice, purchase_date: e.target.value })} /></Field><Field label="Fecha de vencimiento *"><Input required type="date" min={invoice.purchase_date} value={invoice.due_date} onChange={(e) => setInvoice({ ...invoice, due_date: e.target.value })} /></Field><Field label="Notas"><Input value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} /></Field></div>
      <Button className="mt-4" disabled={saving || !invoice.supplier.trim() || !invoice.invoice_number.trim() || !invoice.purchase_date || !invoice.due_date || invoice.due_date < invoice.purchase_date || !(Number(invoice.amount) > 0)} onClick={() => onInvoice({ ...invoice, amount: Number(invoice.amount), paid_amount: 0 })}>Guardar factura</Button>
    </section> : null}
    <PayablesTable invoices={data.supplier_invoices} payments={data.supplier_payments} canEdit={canEdit} saving={saving} onClassify={onClassify} />
  </div>;
}

function AnnualPanel({ data }: { data: AccountingData }) {
  const annual = data.annual_result;
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-4"><Metric label="Ventas anuales" value={money(annual.gross_sales)} /><Metric label="Costos anuales" value={money(annual.total_costs)} /><Metric label="Resultado anual" value={money(annual.operating_result)} tone={annual.operating_result >= 0 ? "good" : "bad"} /><Metric label="Facturas a pagar" value={data.supplier_invoices.length} /></section>
    <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Contabilidad anual por mes</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Mes</th><th className="px-4 py-3 text-right">Ventas</th><th className="px-4 py-3 text-right">Banco</th><th className="px-4 py-3 text-right">Tarjetas</th><th className="px-4 py-3 text-right">Credito</th><th className="px-4 py-3 text-right">Costos fijos</th><th className="px-4 py-3 text-right">Sueldos</th><th className="px-4 py-3 text-right">Proveedores</th><th className="px-4 py-3 text-right">Resultado</th></tr></thead><tbody className="divide-y">{data.monthly_results.map((row) => <tr key={row.month}><td className="px-4 py-3 font-medium">{monthName(row.month)}</td><td className="px-4 py-3 text-right">{money(row.gross_sales)}</td><td className="px-4 py-3 text-right">{money(row.bank_sales)}</td><td className="px-4 py-3 text-right">{money(row.card_sales)}</td><td className="px-4 py-3 text-right">{money(row.credit_sales)}</td><td className="px-4 py-3 text-right">{money(row.fixed_costs)}</td><td className="px-4 py-3 text-right">{money(row.payroll)}</td><td className="px-4 py-3 text-right">{money(row.supplier_costs)}</td><td className={`px-4 py-3 text-right font-semibold ${row.operating_result < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(row.operating_result)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function MovementAmountCorrections({ movements, saving, onCorrectAmount }: { movements: Movement[]; saving: boolean; onCorrectAmount: (movementId: string, amount: number) => void }) {
  const sales = movements.filter((movement) => movement.direction === "income" && movement.category === "facturas");
  return <section className="border bg-card p-4"><h2 className="mb-3 font-semibold">Corrección auditada de importes</h2><div className="space-y-2">{sales.map((movement) => <div key={movement.id} className="flex flex-wrap items-center gap-3 border-t pt-2"><span className="min-w-72 flex-1 text-sm">{movement.description || movement.invoice_number}</span><input aria-label={`Importe corregido de ${movement.description || movement.invoice_number}`} type="number" min="0.01" step="0.01" defaultValue={movement.amount} className="h-9 w-32 rounded-md border bg-background px-3 text-right text-sm" /><Button type="button" variant="outline" size="sm" disabled={saving} onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector("input"); const amount = Number(input?.value); if (Number.isFinite(amount) && amount > 0) onCorrectAmount(movement.id, amount); }}>Guardar corrección</Button></div>)}</div></section>;
}

function MovementDeletionPanel({ movements, saving, onDelete }: { movements: Movement[]; saving: boolean; onDelete: (movementId: string) => void }) {
  const candidates = movements.filter((movement) => movement.category === "otros" || (movement.category === "proveedores" && !movement.supplier_invoice_id && (movement.description || movement.reference) === "."));
  return <section className="border bg-card p-4"><h2 className="mb-3 font-semibold">Anulación auditada de duplicados</h2><div className="space-y-2">{candidates.map((movement) => <div key={movement.id} className="flex flex-wrap items-center gap-3 border-t pt-2"><span className="min-w-72 flex-1 text-sm">{movement.date} · {movement.description || movement.reference || "Sin detalle"} · {money(movement.amount, movement.currency)}</span><Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => onDelete(movement.id)}>Eliminar duplicado</Button></div>)}</div></section>;
}

function SalesBreakdownPanel({ movements, saving, onReplace }: { movements: Movement[]; saving: boolean; onReplace: (movementId: string, replacements: Record<string, unknown>[]) => void }) {
  const candidates = movements.filter((movement) => movement.direction === "income" && movement.category === "facturas" && movement.source !== "sales_breakdown" && !String(movement.description || "").startsWith("Ventas "));
  return <section className="border bg-card p-4"><h2 className="mb-3 font-semibold">Desglose auditado de ventas por medio de cobro</h2><div className="space-y-4">{candidates.map((movement) => <form key={movement.id} className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const amount = (name: string) => Number(values.get(name) || 0); const depositInvoice = String(values.get("deposit_invoice") || "").trim(); onReplace(movement.id, [
    { amount: amount("maestro"), payment_method: "maestro", card_plan: "debito", invoice_number: `${movement.invoice_number}-maestro`, description: "Ventas Maestro débito" },
    { amount: amount("visa_debit"), payment_method: "visa", card_plan: "debito", invoice_number: `${movement.invoice_number}-visa-debito`, description: "Ventas Visa débito" },
    { amount: amount("master_prepaid"), payment_method: "master", card_plan: "debito", invoice_number: `${movement.invoice_number}-master-prepaga`, description: "Ventas Mastercard prepaga" },
    { amount: amount("master_debit"), payment_method: "master", card_plan: "debito", invoice_number: `${movement.invoice_number}-master-debito`, description: "Ventas Mastercard débito" },
    { amount: amount("deposit"), payment_method: "deposito", invoice_number: depositInvoice, description: `Depósito factura ${depositInvoice}` },
    { amount: amount("cash"), payment_method: "efectivo", invoice_number: `${movement.invoice_number}-efectivo`, description: "Ventas en efectivo" },
  ]); }}><div className="sm:col-span-2 lg:col-span-4 text-sm font-medium">{movement.date} · {movement.invoice_number} · Total {money(movement.amount, movement.currency)}</div><Field label="Maestro"><input name="maestro" aria-label={`Maestro de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Visa débito"><input name="visa_debit" aria-label={`Visa débito de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Mastercard prepaga"><input name="master_prepaid" aria-label={`Mastercard prepaga de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Mastercard débito"><input name="master_debit" aria-label={`Mastercard débito de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Factura depósito"><input name="deposit_invoice" aria-label={`Factura depósito de ${movement.invoice_number}`} required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Depósito"><input name="deposit" aria-label={`Depósito de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><Field label="Efectivo"><input name="cash" aria-label={`Efectivo de ${movement.invoice_number}`} type="number" min="0.01" step="0.01" required className="h-9 w-full rounded-md border bg-background px-3" /></Field><div className="flex items-end"><Button type="submit" disabled={saving}>Aplicar desglose</Button></div></form>)}</div></section>;
}

function MovementTable({ movements, canCorrect, saving, onCorrect, onCorrectAmount, onCorrectDate, onDelete }: { movements: Movement[]; canCorrect: boolean; saving: boolean; onCorrect: (movementId: string, direction: Direction) => void; onCorrectAmount: (movementId: string, amount: number) => void; onCorrectDate: (movementId: string, date: string) => void; onDelete: (movementId: string) => void }) {
  return <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Movimientos cargados</h2></div>{movements.length === 0 ? <Empty text="Todavia no hay movimientos en este mes." /> : <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-sm"><thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Dia</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Factura</th><th className="px-4 py-3">Emision</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Medio</th><th className="px-4 py-3">Detalle</th><th className="px-4 py-3 text-right">Importe</th>{canCorrect ? <th className="px-4 py-3 text-right">Corrección</th> : null}</tr></thead><tbody className="divide-y">{movements.map((m) => <tr key={m.id}><td className="px-4 py-3">{m.workday_number}</td><td className="px-4 py-3"><Badge variant={m.direction === "income" ? "default" : m.direction === "expense" ? "secondary" : "outline"}>{m.direction === "income" ? "Entrada" : m.direction === "expense" ? "Salida" : "Transferencia"}</Badge></td><td className="px-4 py-3">{m.category === "acreditacion_tarjeta" ? "Acreditacion de tarjeta" : m.category}</td><td className="px-4 py-3 font-medium">{m.invoice_number || "-"}</td><td className="px-4 py-3">{m.issue_date || "-"}</td><td className="px-4 py-3">{m.due_date || "-"}</td><td className="px-4 py-3">{movementPaymentLabel(m)}</td><td className="px-4 py-3">{m.description || m.reference || "-"}</td><td className="px-4 py-3 text-right font-medium">{money(m.amount, m.currency)}</td>{canCorrect ? <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">{m.direction === "income" && m.category === "otros" ? <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => onCorrect(m.id, "expense")}>Marcar como salida</Button> : null}<Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { const value = window.prompt("Nueva fecha contable (AAAA-MM-DD)", m.date); if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) onCorrectDate(m.id, value); }}>Editar fecha</Button><Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { const value = window.prompt("Nuevo importe en UYU", String(m.amount)); if (value === null) return; const amount = Number(value.replace(",", ".")); if (Number.isFinite(amount) && amount > 0) onCorrectAmount(m.id, amount); }}>Editar importe</Button></div></td> : null}</tr>)}</tbody></table></div>}</section>;
}

function MovementDateCorrections({ movements, saving, onCorrectDate }: { movements: Movement[]; saving: boolean; onCorrectDate: (movementId: string, date: string) => void }) {
  return <section className="border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">Corrección auditada de fechas</h2><p className="mt-1 text-xs text-muted-foreground">Modifica la fecha contable sin duplicar ni alterar el importe del movimiento.</p></div><div className="divide-y">{movements.map((movement) => <form key={movement.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const correctedDate = String(form.get("date") || ""); if (correctedDate) onCorrectDate(movement.id, correctedDate); }}><div className="text-sm"><div className="font-medium">{movement.description || movement.reference || movement.invoice_number || movement.category}</div><div className="text-xs text-muted-foreground">{movement.invoice_number || "Sin factura"} · {money(movement.amount, movement.currency)} · fecha actual {movement.date}</div></div><Field label="Nueva fecha"><Input name="date" aria-label={`Fecha corregida de ${movement.description || movement.invoice_number || movement.id}`} type="date" defaultValue={movement.date} required /></Field><Button type="submit" variant="outline" disabled={saving}>Guardar fecha</Button></form>)}</div></section>;
}

function PayablesTable({ invoices, payments, canEdit, saving, onClassify }: { invoices: SupplierInvoice[]; payments: SupplierPayment[]; canEdit: boolean; saving: boolean; onClassify: (invoiceId: string, classification: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const trackedInvoices = invoices.filter((invoice) => invoice.status !== "no_aplica");
  const providers = Array.from(trackedInvoices.reduce((map, invoice) => {
    const key = invoice.supplier || "Proveedor sin nombre";
    const current = map.get(key) || { supplier: key, invoices: [] as SupplierInvoice[], uyu: 0, usd: 0 };
    current.invoices.push(invoice);
    if (invoice.currency === "USD") current.usd += invoice.balance;
    else current.uyu += invoice.balance;
    map.set(key, current);
    return map;
  }, new Map<string, { supplier: string; invoices: SupplierInvoice[]; uyu: number; usd: number }>()).values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
  return <section className="overflow-hidden border bg-card">
    <div className="border-b px-4 py-3"><h2 className="font-semibold">Facturas y cancelaciones por proveedor</h2></div>
    {providers.length === 0 ? <Empty text="No hay facturas registradas de proveedores." /> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm">
      <thead className="bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3 text-right">Facturas</th><th className="px-4 py-3 text-right">Saldo UYU</th><th className="px-4 py-3 text-right">Saldo USD</th><th className="px-4 py-3 text-right">Detalle</th></tr></thead>
      <tbody className="divide-y">{providers.map((provider) => <tr key={provider.supplier} className="align-top">
        <td className="px-4 py-3 font-medium">{provider.supplier}{expanded === provider.supplier ? <div className="mt-3 overflow-hidden border"><table className="w-full text-xs">
          <thead className="bg-muted/50 text-left uppercase text-muted-foreground"><tr><th className="px-3 py-2">Factura</th><th className="px-3 py-2">Emision</th><th className="px-3 py-2">Vencimiento</th><th className="px-3 py-2 text-right">Monto</th><th className="px-3 py-2 text-right">Pagado</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Clasificación contable</th><th className="px-3 py-2">Cancelaciones</th></tr></thead>
          <tbody className="divide-y">{provider.invoices.map((invoice) => {
            const invoicePayments = payments.filter((payment) => payment.supplier_invoice_id === invoice.id);
            return <tr key={invoice.id}><td className="px-3 py-2">{invoice.invoice_number || "-"}</td><td className="px-3 py-2">{invoice.purchase_date || "-"}</td><td className="px-3 py-2">{invoice.due_date || "-"}</td><td className="px-3 py-2 text-right">{money(invoice.amount, invoice.currency)}{invoice.currency === "USD" ? <div className="mt-1 whitespace-nowrap text-[10px] text-muted-foreground">{invoice.functional_amount ? `${money(invoice.functional_amount)} · TC ${invoice.exchange_rate} (${invoice.exchange_rate_date})` : "Conversión BCU pendiente"}</div> : null}</td><td className="px-3 py-2 text-right">{money(invoice.paid_amount, invoice.currency)}</td><td className="px-3 py-2 text-right font-semibold">{money(invoice.balance, invoice.currency)}</td><td className="px-3 py-2"><Badge variant={invoice.status === "parcial" ? "secondary" : "outline"}>{invoice.status}</Badge></td><td className="min-w-64 px-3 py-2">{canEdit ? <select value={invoice.accounting_classification || ""} disabled={saving} onChange={(event) => { if (event.target.value) onClassify(invoice.id, event.target.value); }} className={`h-8 w-full rounded-md border bg-background px-2 text-xs ${invoice.accounting_classification ? "" : "border-amber-400"}`}><option value="">Pendiente - no incluir</option>{Object.entries(supplierClassificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <Badge variant="outline">{supplierClassificationLabels[invoice.accounting_classification || ""] || "Pendiente"}</Badge>}</td><td className="min-w-64 px-3 py-2">{invoicePayments.length === 0 ? <span className="text-muted-foreground">Sin pagos registrados</span> : <div className="space-y-1">{invoicePayments.map((payment) => <div key={payment.id}><span className="font-medium">{payment.payment_date} · {money(payment.amount, payment.currency)}</span><span className="text-muted-foreground"> · {paymentMethodLabels[payment.payment_method] || payment.payment_method}{payment.receipt_number || payment.bank_reference ? ` · ${payment.receipt_number || payment.bank_reference}` : ""}</span></div>)}</div>}</td></tr>;
          })}</tbody>
        </table></div> : null}</td>
        <td className="px-4 py-3 text-right tabular-nums">{provider.invoices.length}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(provider.uyu)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(provider.usd, "USD")}</td><td className="px-4 py-3 text-right"><Button type="button" variant="outline" size="sm" onClick={() => setExpanded(expanded === provider.supplier ? null : provider.supplier)}><ChevronDown className={`transition-transform ${expanded === provider.supplier ? "rotate-180" : ""}`} /> Ver facturas</Button></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
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

interface FiservUpcoming { payment_date: string; net_amount: number; gross_amount: number; total_count: number }
interface FiservProduct { product: string; gross: number; net: number; cost: number; count: number }
interface FiservTx { fiserv_id: string; sale_date: string; auth_datetime?: string; transaction_type: string; state: string; product_name?: string; card_last4?: string; bill_number?: string; batch?: string; ticket?: string; total_amount: number; tax_refund?: string }
interface FiservPanelData {
  year: number;
  month: number;
  month_summary: {
    gross: number; net: number; cost_fiserv: number; advance_cost: number; tax_credits: number;
    tax_credit_19210: number; withholding_17453: number; tariff: number; tariff_vat: number;
    chargebacks: number; settlement_count: number;
  };
  by_product: FiservProduct[];
  upcoming: FiservUpcoming[];
  next_7_days_net: number;
  recent_transactions: FiservTx[];
  chargebacks: { settlement_number: string; payment_date: string; amount: number }[];
  alerts: { type: string; label: string }[];
  last_sync_at: string | null;
}

const txTypeLabel: Record<string, string> = { C: "Compra", A: "Anulación", D: "Devolución", T: "Venta c/adelanto" };

function TarjetasPanel({ year, month, canConfirm }: { year: number; month: number; canConfirm: boolean }) {
  const client = useQueryClient();
  const [cardFilter, setCardFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const query = useQuery({
    queryKey: ["fiserv-panel", year, month],
    queryFn: () => api<FiservPanelData>(`/api/contabilidad/tarjetas?year=${year}&month=${month}`),
  });
  const accountingQuery = useQuery({
    queryKey: ["accounting", year, month, "monthly"],
    queryFn: () => api<AccountingData>(`/api/contabilidad?year=${year}&month=${month}&view=monthly`),
  });
  const confirm = useMutation({
    mutationFn: (settlementNumber: string) => post({ operation: "confirm_card_settlement", settlement_number: settlementNumber }),
    onSuccess: async () => { toast.success("Acreditación confirmada"); await client.refetchQueries({ queryKey: ["accounting"], type: "active" }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo confirmar la acreditación"),
  });
  async function downloadContadorExport() {
    setExporting(true);
    try {
      const response = await fetch(`/api/contabilidad/tarjetas/export?year=${year}&month=${month}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo exportar para el contador");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tarjetas-contador-${year}-${String(month).padStart(2, "0")}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo exportar para el contador");
    } finally {
      setExporting(false);
    }
  }
  const sync = useMutation({
    mutationFn: () => api<Record<string, unknown>>("/api/contabilidad/tarjetas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lookback_days: 3 }) }),
    onSuccess: async (result) => {
      const created = Number(result?.transactions_new ?? 0) + Number(result?.settlements_new ?? 0);
      toast.success(created ? `Sincronizado: ${created} registros nuevos` : "Sincronizado (sin novedades)");
      await client.refetchQueries({ queryKey: ["fiserv-panel"], type: "active" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo sincronizar con Fiserv"),
  });

  if (query.isLoading) return <div className="border bg-card p-10 text-center text-sm text-muted-foreground">Cargando datos de Fiserv…</div>;
  if (query.error) return <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "No se pudo cargar"}</div>;
  const data = query.data;
  if (!data) return null;
  const s = data.month_summary;
  const upcoming = data.upcoming.filter((u) => u.net_amount > 0);
  const filteredTx = cardFilter.trim() ? data.recent_transactions.filter((t) => (t.card_last4 || "").includes(cardFilter.trim()) || (t.bill_number || "").includes(cardFilter.trim())) : data.recent_transactions;

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-lg font-semibold">Tarjetas · Fiserv</h2>
        <p className="text-xs text-muted-foreground">Fuente: Merchant Center. {data.last_sync_at ? `Última sincronización ${new Date(data.last_sync_at).toLocaleString("es-UY")}.` : "Sin sincronizaciones aún."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => downloadContadorExport()} disabled={exporting}><Download /> {exporting ? "Generando..." : "Exportar contador"}</Button>
        <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={sync.isPending ? "animate-spin" : ""} /> Sincronizar ahora</Button>
      </div>
    </div>

    {data.alerts.length ? <div className="space-y-1 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">{data.alerts.map((a, i) => <div key={i}>• {a.label}</div>)}</div> : null}

    <section className="overflow-hidden border bg-card">
      <div className="border-b px-4 py-3"><h3 className="font-semibold">Acreditaciones a confirmar</h3><p className="mt-1 text-xs text-muted-foreground">Liquidaciones de Fiserv detectadas que aún no se registraron como acreditación en banco.</p></div>
      {(() => {
        const proposals = (accountingQuery.data?.proposed_card_settlements ?? []).filter((item) => !item.already_registered);
        if (!proposals.length) return <Empty text="No hay acreditaciones pendientes de confirmar." />;
        return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Fecha de pago</th><th className="px-4 py-2">Producto</th><th className="px-4 py-2 text-right">Neto</th>{canConfirm ? <th className="px-4 py-2 text-right">Acción</th> : null}</tr></thead><tbody className="divide-y">{proposals.map((proposal) => <tr key={proposal.settlement_number}><td className="px-4 py-2">{proposal.payment_date}</td><td className="px-4 py-2">{proposal.product_desc}</td><td className="px-4 py-2 text-right tabular-nums">{money(proposal.net_amount)}</td>{canConfirm ? <td className="px-4 py-2 text-right"><Button type="button" variant="outline" size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate(proposal.settlement_number)}>Confirmar</Button></td> : null}</tr>)}</tbody></table></div>;
      })()}
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Próximos 7 días (neto a cobrar)" value={money(data.next_7_days_net)} tone="good" />
      <Metric label="Bruto del mes" value={money(s.gross)} />
      <Metric label="Neto acreditado del mes" value={money(s.net)} />
      <Metric label="Costo Fiserv del mes" value={money(s.cost_fiserv)} tone="bad" />
    </section>

    <section className="grid gap-4 lg:grid-cols-3">
      <div className="border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">Lo que descuenta Fiserv</div>
        <p className="mt-1 text-xs text-muted-foreground">Costo real del servicio, separado de lo que se recupera.</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt>Arancel</dt><dd className="tabular-nums">{money(s.tariff)}</dd></div>
          <div className="flex justify-between"><dt>IVA arancel</dt><dd className="tabular-nums">{money(s.tariff_vat)}</dd></div>
          <div className="flex justify-between"><dt>Costo del anticipo</dt><dd className="tabular-nums">{money(s.advance_cost)}</dd></div>
          <div className="flex justify-between border-t pt-1.5 font-semibold"><dt>Costo Fiserv</dt><dd className="tabular-nums text-red-600">{money(s.cost_fiserv)}</dd></div>
        </dl>
      </div>
      <div className="border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Créditos fiscales (recuperables)</div>
        <p className="mt-1 text-xs text-muted-foreground">No son costo: se deducen ante DGI.</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt>Reducción IVA Ley 19.210</dt><dd className="tabular-nums">{money(s.tax_credit_19210)}</dd></div>
          <div className="flex justify-between"><dt>Retención Ley 17.453</dt><dd className="tabular-nums">{money(s.withholding_17453)}</dd></div>
          <div className="flex justify-between border-t pt-1.5 font-semibold"><dt>Total recuperable</dt><dd className="tabular-nums text-emerald-700">{money(s.tax_credits)}</dd></div>
        </dl>
      </div>
      <div className="border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contracargos y otros</div>
        <p className="mt-1 text-xs text-muted-foreground">Cargos del comercio en las liquidaciones.</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt>Contracargos del mes</dt><dd className="tabular-nums text-red-600">{money(s.chargebacks)}</dd></div>
          <div className="flex justify-between"><dt>Liquidaciones</dt><dd className="tabular-nums">{s.settlement_count}</dd></div>
        </dl>
        {data.chargebacks.length ? <div className="mt-2 space-y-1 text-xs text-muted-foreground">{data.chargebacks.map((c) => <div key={c.settlement_number}>Liq. {c.settlement_number} · {c.payment_date} · {money(c.amount)}</div>)}</div> : null}
      </div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="overflow-hidden border bg-card">
        <div className="border-b px-4 py-3"><h3 className="font-semibold">Próximos cobros</h3><p className="mt-1 text-xs text-muted-foreground">Por fecha real de acreditación (anticipo incluido).</p></div>
        {upcoming.length === 0 ? <Empty text="Sin cobros pendientes." /> : <div className="overflow-x-auto"><table className="w-full min-w-[360px] text-sm"><thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Fecha</th><th className="px-4 py-2 text-right">Cupones</th><th className="px-4 py-2 text-right">Neto</th></tr></thead><tbody className="divide-y">{upcoming.map((u) => <tr key={u.payment_date}><td className="px-4 py-2">{u.payment_date}</td><td className="px-4 py-2 text-right tabular-nums">{u.total_count}</td><td className="px-4 py-2 text-right tabular-nums">{money(u.net_amount)}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="overflow-hidden border bg-card">
        <div className="border-b px-4 py-3"><h3 className="font-semibold">Detalle por producto</h3><p className="mt-1 text-xs text-muted-foreground">Liquidado en el mes.</p></div>
        {data.by_product.length === 0 ? <Empty text="Sin datos del mes." /> : <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Producto</th><th className="px-4 py-2 text-right">Bruto</th><th className="px-4 py-2 text-right">Costo</th><th className="px-4 py-2 text-right">Neto</th></tr></thead><tbody className="divide-y">{data.by_product.map((p) => <tr key={p.product}><td className="px-4 py-2">{p.product}</td><td className="px-4 py-2 text-right tabular-nums">{money(p.gross)}</td><td className="px-4 py-2 text-right tabular-nums text-red-600">{money(p.cost)}</td><td className="px-4 py-2 text-right tabular-nums">{money(p.net)}</td></tr>)}</tbody></table></div>}
      </div>
    </section>

    <section className="overflow-hidden border bg-card">
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="font-semibold">Cupones recientes</h3><p className="mt-1 text-xs text-muted-foreground">Buscá por últimos 4 dígitos o número de factura.</p></div>
        <Input value={cardFilter} onChange={(e) => setCardFilter(e.target.value)} placeholder="1234 o factura" className="w-full sm:w-48" />
      </div>
      {filteredTx.length === 0 ? <Empty text="Sin cupones para mostrar." /> : <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[640px] text-sm"><thead className="sticky top-0 bg-muted/70 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Producto</th><th className="px-4 py-2">Tarjeta</th><th className="px-4 py-2">Factura</th><th className="px-4 py-2">Lote/Cupón</th><th className="px-4 py-2 text-right">Monto</th></tr></thead><tbody className="divide-y">{filteredTx.map((t) => <tr key={t.fiserv_id}><td className="px-4 py-2 whitespace-nowrap">{t.auth_datetime ? new Date(t.auth_datetime).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : t.sale_date}</td><td className="px-4 py-2">{txTypeLabel[t.transaction_type] || t.transaction_type}</td><td className="px-4 py-2">{t.product_name || "—"}</td><td className="px-4 py-2 tabular-nums">{t.card_last4 ? `···· ${t.card_last4}` : "—"}</td><td className="px-4 py-2 tabular-nums">{t.bill_number || "—"}</td><td className="px-4 py-2 tabular-nums text-muted-foreground">{t.batch || "—"}/{t.ticket || "—"}</td><td className="px-4 py-2 text-right tabular-nums">{money(t.total_amount)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
