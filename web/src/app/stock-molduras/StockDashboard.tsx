"use client";

import { AlertTriangle, ArrowUpRight, Banknote, Boxes, PackageX, Search, TrendingUp } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";

export interface DashboardProduct {
  code: string;
  description: string;
  family: string;
  material: string;
  width_mm: number;
  height_mm: number;
  price_meter_iva: number;
  price_varilla_iva: number;
  jit_min_quantity: number;
}

export interface DashboardStockRow extends DashboardProduct {
  complete_quantity: number;
  total_units: number;
}

export interface DashboardMovement {
  id: string;
  created_at: string;
  code: string;
  type: string;
  complete_quantity: number;
  fraction_quantity: number;
}

export interface DashboardReservation {
  code: string;
  quantity: number;
}

interface Props {
  products: DashboardProduct[];
  stock: DashboardStockRow[];
  movements: DashboardMovement[];
  reservations: DashboardReservation[];
  mode?: "pirone" | "casa";
}

interface ProductMetric extends DashboardProduct {
  stock: number;
  available: number;
  inventoryValue: number;
  sold: number;
  estimatedRevenue: number;
  monthlyOutflow: number;
  inventoryDays: number | null;
  lastOutflow: Date | null;
  daysSinceOutflow: number | null;
  productionPriority: number;
}

const DAY_MS = 86_400_000;
const DEAD_DAYS = 180;
const SLOW_DAYS = 90;

function money(value: number) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 0 }).format(value);
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("es-UY", { maximumFractionDigits: digits }).format(value);
}

function daysBetween(date: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

export function StockDashboard({ products, stock, movements, reservations, mode = "pirone" }: Props) {
  const [casaQuery, setCasaQuery] = useState("");
  const now = new Date();
  const stockByCode = new Map<string, number>();
  const completeByCode = new Map<string, number>();
  for (const row of stock) stockByCode.set(row.code, (stockByCode.get(row.code) || 0) + row.total_units);
  for (const row of stock) completeByCode.set(row.code, (completeByCode.get(row.code) || 0) + row.complete_quantity);
  const reservedByCode = new Map<string, number>();
  for (const row of reservations) reservedByCode.set(row.code, (reservedByCode.get(row.code) || 0) + row.quantity);

  const sales = movements.filter((movement) => movement.type === "VENTA");
  const outflows = movements.filter((movement) => movement.type === "VENTA" || movement.type === "ENVIO_CASA");
  const validSaleDates = sales.map((sale) => new Date(sale.created_at)).filter((date) => !Number.isNaN(date.getTime()));
  const firstSale = validSaleDates.length ? new Date(Math.min(...validSaleDates.map((date) => date.getTime()))) : now;
  const salesObservedMonths = Math.max(1, (now.getTime() - firstSale.getTime()) / (30.44 * DAY_MS));
  const soldByCode = new Map<string, number>();
  for (const sale of sales) {
    const quantity = sale.complete_quantity + sale.fraction_quantity;
    soldByCode.set(sale.code, (soldByCode.get(sale.code) || 0) + quantity);
  }
  const validOutflowDates = outflows.map((movement) => new Date(movement.created_at)).filter((date) => !Number.isNaN(date.getTime()));
  const firstOutflow = validOutflowDates.length ? new Date(Math.min(...validOutflowDates.map((date) => date.getTime()))) : now;
  const outflowObservedMonths = Math.max(1, (now.getTime() - firstOutflow.getTime()) / (30.44 * DAY_MS));
  const outflowByCode = new Map<string, number>();
  const lastOutflowByCode = new Map<string, Date>();
  for (const movement of outflows) {
    const quantity = movement.complete_quantity + movement.fraction_quantity;
    outflowByCode.set(movement.code, (outflowByCode.get(movement.code) || 0) + quantity);
    const date = new Date(movement.created_at);
    if (!Number.isNaN(date.getTime()) && (!lastOutflowByCode.get(movement.code) || date > lastOutflowByCode.get(movement.code)!)) lastOutflowByCode.set(movement.code, date);
  }

  const metrics: ProductMetric[] = products.map((product) => {
    const physicalStock = stockByCode.get(product.code) || 0;
    const available = Math.max(0, physicalStock - (reservedByCode.get(product.code) || 0));
    const sold = soldByCode.get(product.code) || 0;
    const monthlyOutflow = (outflowByCode.get(product.code) || 0) / outflowObservedMonths;
    const lastOutflow = lastOutflowByCode.get(product.code) || null;
    const inventoryDays = monthlyOutflow > 0 ? (available / monthlyOutflow) * 30.44 : null;
    const target = Math.max(product.jit_min_quantity, Math.ceil(monthlyOutflow));
    return {
      ...product,
      stock: physicalStock,
      available,
      inventoryValue: physicalStock * product.price_varilla_iva,
      sold,
      estimatedRevenue: sold * product.price_varilla_iva,
      monthlyOutflow,
      inventoryDays,
      lastOutflow,
      daysSinceOutflow: lastOutflow ? daysBetween(lastOutflow, now) : null,
      productionPriority: Math.max(0, target - available),
    };
  });

  const stocked = metrics.filter((item) => item.stock > 0);
  const totalUnits = stocked.reduce((sum, item) => sum + item.stock, 0);
  const totalValue = stocked.reduce((sum, item) => sum + item.inventoryValue, 0);
  const totalSold = metrics.reduce((sum, item) => sum + item.sold, 0);
  const lowStock = metrics.filter((item) => item.jit_min_quantity > 0 && item.available <= item.jit_min_quantity);
  const deadStock = stocked.filter((item) => item.daysSinceOutflow === null || item.daysSinceOutflow >= DEAD_DAYS);
  const slowStock = stocked.filter((item) => item.daysSinceOutflow !== null && item.daysSinceOutflow >= SLOW_DAYS && item.daysSinceOutflow < DEAD_DAYS);
  const deadValue = deadStock.reduce((sum, item) => sum + item.inventoryValue, 0);
  const slowValue = slowStock.reduce((sum, item) => sum + item.inventoryValue, 0);

  const categories = Array.from(metrics.reduce((map, item) => {
    const current = map.get(item.family) || { family: item.family, units: 0, value: 0, prices: [] as number[] };
    current.units += item.stock;
    current.value += item.inventoryValue;
    if (item.price_varilla_iva > 0) current.prices.push(item.price_varilla_iva);
    map.set(item.family, current);
    return map;
  }, new Map<string, { family: string; units: number; value: number; prices: number[] }>()).values()).sort((a, b) => b.value - a.value);

  const topValue = [...stocked].sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 8);
  const topQuantity = [...stocked].sort((a, b) => b.stock - a.stock).slice(0, 8);
  const topSold = [...metrics].filter((item) => item.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 8);
  const topRevenue = [...metrics].filter((item) => item.estimatedRevenue > 0).sort((a, b) => b.estimatedRevenue - a.estimatedRevenue).slice(0, 8);
  const overstock = stocked.filter((item) => item.monthlyOutflow === 0 || (item.inventoryDays || 0) > 180).sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 10);
  const fastLow = metrics.filter((item) => item.monthlyOutflow > 0 && (item.available <= item.jit_min_quantity || (item.inventoryDays !== null && item.inventoryDays < 30))).sort((a, b) => b.monthlyOutflow - a.monthlyOutflow).slice(0, 10);
  const manufacture = metrics.filter((item) => item.productionPriority > 0).sort((a, b) => b.productionPriority - a.productionPriority).slice(0, 12);
  const missingPrice = metrics.filter((item) => item.price_varilla_iva <= 0);
  const monthlySalesAverage = totalSold / salesObservedMonths;

  if (mode === "casa") {
    const completeStock = products.map((product) => ({ ...product, complete: completeByCode.get(product.code) || 0 })).filter((item) => item.complete > 0).sort((a, b) => b.complete - a.complete);
    const normalizedQuery = casaQuery.trim().toLowerCase();
    const filteredCompleteStock = normalizedQuery ? completeStock.filter((item) => `${item.code} ${item.description} ${item.family} ${item.material}`.toLowerCase().includes(normalizedQuery)) : completeStock;
    const completeTotal = completeStock.reduce((sum, item) => sum + item.complete, 0);
    return <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <Kpi icon={Boxes} label="Varillas enteras en fábrica" value={number(completeTotal)} detail="Stock físico actual en Juan Pirone" />
        <Kpi icon={TrendingUp} label="Artículos con stock" value={number(completeStock.length)} detail="Códigos con al menos una varilla entera" />
      </section>
      <DashboardSection title="Top por cantidad" subtitle="Artículos con más varillas enteras disponibles en fábrica">
        <BarRanking rows={completeStock.slice(0, 12).map((item) => ({ label: `${item.code} · ${item.description}`, value: item.complete, display: `${number(item.complete)} varillas`, secondary: `${item.family} · ${item.material}` }))} />
      </DashboardSection>
      <DashboardSection title="Stock entero actual" subtitle="Cantidad total de varillas enteras por artículo, sumando todas las ubicaciones de fábrica">
        <div className="relative mb-4 max-w-xl"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={casaQuery} onChange={(event) => setCasaQuery(event.target.value)} placeholder="Buscar por código, descripción, familia o material…" className="pl-9" /></div>
        <SimpleTable headers={["Código", "Descripción", "Familia", "Material", "Varillas enteras"]} rows={filteredCompleteStock.map((item) => [item.code, item.description, item.family, item.material, number(item.complete)])} empty="No hay artículos que coincidan con la búsqueda." />
      </DashboardSection>
    </div>;
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      <strong>Alcance de los datos:</strong> ventas y facturación usan los {sales.length} movimientos de venta disponibles ({number(salesObservedMonths, 1)} meses observados). Rotación, cobertura y prioridad de fabricación también consideran los {outflows.length - sales.length} envíos a La Casa del Carpintero como salidas de fábrica. La facturación se estima con el precio de lista actual; no hay costo histórico para calcular margen real.
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={Banknote} label="Valor de inventario" value={money(totalValue)} detail="Precio público actual" />
      <Kpi icon={Boxes} label="Varillas contabilizadas" value={number(totalUnits)} detail={`${number(stocked.length)} productos con stock`} />
      <Kpi icon={TrendingUp} label="Venta mensual promedio" value={`${number(monthlySalesAverage, 1)} varillas`} detail={`${number(totalSold)} vendidas en el período`} />
      <Kpi icon={PackageX} label="Valor lento + muerto" value={money(slowValue + deadValue)} detail={`${number(slowStock.length + deadStock.length)} productos`} tone="warning" />
    </section>

    <DashboardSection title="Inventario por categoría" subtitle="Valor y cantidad física por familia">
      <div className="grid gap-3 lg:grid-cols-2">
        <BarRanking rows={categories.slice(0, 10).map((item) => ({ label: item.family, value: item.value, display: money(item.value), secondary: `${number(item.units)} varillas` }))} />
        <SimpleTable headers={["Familia", "Unidades", "Valor", "Precio prom."]} rows={categories.map((item) => [item.family, number(item.units), money(item.value), money(item.prices.reduce((sum, price) => sum + price, 0) / Math.max(item.prices.length, 1))])} />
      </div>
    </DashboardSection>

    <div className="grid gap-6 xl:grid-cols-2">
      <DashboardSection title="Top por valor de inventario" subtitle="Capital concentrado por producto"><ProductRanking items={topValue} value={(item) => money(item.inventoryValue)} /></DashboardSection>
      <DashboardSection title="Top por cantidad física" subtitle="Productos con más varillas"><ProductRanking items={topQuantity} value={(item) => `${number(item.stock)} varillas`} /></DashboardSection>
      <DashboardSection title="Productos más vendidos" subtitle="Según movimientos tipo VENTA"><ProductRanking items={topSold} value={(item) => `${number(item.sold)} vendidas`} /></DashboardSection>
      <DashboardSection title="Productos que más facturan" subtitle="Estimado a precio de lista actual"><ProductRanking items={topRevenue} value={(item) => money(item.estimatedRevenue)} /></DashboardSection>
    </div>

    <DashboardSection title="Rotación y cobertura" subtitle="Salida promedio mensual (ventas + envíos a La Casa) y días de inventario por producto">
      <SimpleTable headers={["Producto", "Stock", "Salida mensual", "Días inventario", "Última salida"]} rows={[...metrics].sort((a, b) => b.monthlyOutflow - a.monthlyOutflow).slice(0, 20).map((item) => [productLabel(item), number(item.available), number(item.monthlyOutflow, 1), item.inventoryDays === null ? "Sin salidas" : `${number(item.inventoryDays)} días`, item.lastOutflow ? item.lastOutflow.toLocaleDateString("es-UY") : "Sin movimiento"])} />
    </DashboardSection>

    <div className="grid gap-6 xl:grid-cols-2">
      <DashboardSection title="Mucho stock y poca salida" subtitle="Sin salidas o más de 180 días de cobertura"><ProductRanking items={overstock} value={(item) => `${money(item.inventoryValue)} · ${item.inventoryDays === null ? "sin salidas" : `${number(item.inventoryDays)} días`}`} /></DashboardSection>
      <DashboardSection title="Poco stock y mucha salida" subtitle="Menos de 30 días de cobertura o bajo JIT"><ProductRanking items={fastLow} value={(item) => `${number(item.available)} disp. · ${number(item.monthlyOutflow, 1)}/mes`} empty="No hay productos críticos con salidas." /></DashboardSection>
    </div>

    <DashboardSection title="Alertas de stock bajo" subtitle="Disponible igual o menor al mínimo Just in Time">
      <AlertTable items={lowStock} />
    </DashboardSection>

    <DashboardSection title="Prioridad de fabricación" subtitle="Objetivo: cubrir el mayor entre mínimo JIT y un mes de salidas promedio">
      <SimpleTable headers={["Prioridad", "Producto", "Disponible", "Fabricar", "Materia prima estimada"]} rows={manufacture.map((item, index) => [String(index + 1), productLabel(item), number(item.available), `${number(item.productionPriority)} varillas`, `${number(item.productionPriority * 3.3, 1)} m lineales · ${number(item.productionPriority * 3.3 * (item.width_mm / 1000) * (item.height_mm / 1000), 4)} m³`])} empty="No hay fabricación sugerida con los parámetros actuales." />
    </DashboardSection>

    <div className="grid gap-6 xl:grid-cols-2">
      <DashboardSection title="Stock muerto" subtitle={`Sin salidas o sin salida hace ${DEAD_DAYS} días`}><ProductRanking items={deadStock.sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 12)} value={(item) => money(item.inventoryValue)} /></DashboardSection>
      <DashboardSection title="Stock lento / liquidación" subtitle={`Última salida entre ${SLOW_DAYS} y ${DEAD_DAYS} días`}><ProductRanking items={slowStock.sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 12)} value={(item) => money(item.inventoryValue)} empty="No hay productos en el rango de stock lento." /></DashboardSection>
    </div>

    <DashboardSection title="Precios y escenarios" subtitle="Lista pública vigente e impacto sobre el inventario">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Valor a precio público" value={money(totalValue)} />
        <MiniMetric label="Impacto de aumento 5%" value={`+ ${money(totalValue * 0.05)}`} detail={`Nuevo valor: ${money(totalValue * 1.05)}`} />
        <MiniMetric label="Productos sin precio" value={number(missingPrice.length)} />
        <MiniMetric label="Precio comercio / 25 unidades" value="Sin regla cargada" detail="Requiere definir descuentos" />
      </div>
      <div className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Margen por producto, margen %, diferencia entre listas vieja/nueva y productos con precio desactualizado requieren guardar costo unitario y versiones fechadas de la lista. El dashboard no inventa esos valores.</div>
    </DashboardSection>
  </div>;
}

function productLabel(item: DashboardProduct) { return `${item.code} · ${item.description}`; }

function Kpi({ icon: Icon, label, value, detail, tone }: { icon: typeof Boxes; label: string; value: string; detail: string; tone?: "warning" }) {
  return <div className={`rounded-xl border bg-card p-5 ${tone === "warning" ? "border-amber-300" : ""}`}><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className={`h-5 w-5 ${tone === "warning" ? "text-amber-600" : "text-primary"}`} /></div><div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>;
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border bg-muted/20 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div>{detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}</div>;
}

function DashboardSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="rounded-xl border bg-card p-5 md:p-6"><div className="mb-5"><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div>{children}</section>;
}

function BarRanking({ rows }: { rows: Array<{ label: string; value: number; display: string; secondary: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return <div className="space-y-3">{rows.map((row) => <div key={row.label}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate font-medium">{row.label}</span><span className="whitespace-nowrap tabular-nums">{row.display}</span></div><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, row.value / max * 100)}%` }} /></div><div className="mt-1 text-xs text-muted-foreground">{row.secondary}</div></div>)}</div>;
}

function ProductRanking({ items, value, empty = "No hay datos para este período." }: { items: ProductMetric[]; value: (item: ProductMetric) => string; empty?: string }) {
  if (!items.length) return <div className="py-8 text-center text-sm text-muted-foreground">{empty}</div>;
  return <ol className="divide-y">{items.map((item, index) => <li key={item.code} className="flex items-center gap-3 py-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span><div className="min-w-0 flex-1"><div className="truncate font-medium">{item.code} · {item.description}</div><div className="text-xs text-muted-foreground">{item.family} · {item.material}</div></div><div className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">{value(item)}</div></li>)}</ol>;
}

function SimpleTable({ headers, rows, empty = "No hay datos disponibles." }: { headers: string[]; rows: string[][]; empty?: string }) {
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">{empty}</div>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr>{headers.map((header) => <th key={header} className="px-3 py-2.5">{header}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className={`px-3 py-2.5 ${cellIndex > 0 ? "tabular-nums" : "font-medium"}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function AlertTable({ items }: { items: ProductMetric[] }) {
  if (!items.length) return <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"><ArrowUpRight className="h-4 w-4" />No hay productos por debajo del mínimo JIT.</div>;
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <div key={item.code} className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><div className="font-semibold">{item.code} · {item.description}</div><div className="mt-1 text-sm">Disponible: <strong>{number(item.available)}</strong> · JIT: <strong>{number(item.jit_min_quantity)}</strong></div><div className="text-xs text-amber-800">Fabricación sugerida: {number(item.productionPriority)} varillas</div></div></div>)}</div>;
}
