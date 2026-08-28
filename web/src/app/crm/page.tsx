"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ContactRound, FileText, Search, ShoppingBag, UsersRound } from "lucide-react";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Segment = "molduras" | "muebles_placa" | "muebles_madera" | "muebles_otros" | "otros";

interface CrmProduct {
  key: string;
  name: string;
  quantity: number;
  material: string;
  segment: Segment;
  purchased: boolean;
}

interface CrmOrder {
  session_id: string;
  title: string;
  summary: string;
  status: "cotizado" | "comprado";
  date: string | null;
  total: number;
  products: CrmProduct[];
}

interface CrmCustomer {
  id: string;
  name: string;
  phone: string;
  segments: Segment[];
  quotes_count: number;
  purchases_count: number;
  total_purchased: number;
  last_activity: string | null;
  orders: CrmOrder[];
}

const SEGMENTS: Array<{ id: "all" | Segment; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "molduras", label: "Molduras y varillas" },
  { id: "muebles_placa", label: "Muebles en placa" },
  { id: "muebles_madera", label: "Muebles en madera" },
  { id: "muebles_otros", label: "Otros muebles" },
  { id: "otros", label: "Otros productos" },
];

const SEGMENT_LABELS: Record<Segment, string> = {
  molduras: "Molduras y varillas",
  muebles_placa: "Muebles en placa",
  muebles_madera: "Muebles en madera",
  muebles_otros: "Otros muebles",
  otros: "Otros productos",
};
const EMPTY_CUSTOMERS: CrmCustomer[] = [];

function money(value: number) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin fecha" : date.toLocaleDateString("es-UY");
}

export default function CrmPage() {
  const { brandId, brand } = useBrandEnvironment();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<"all" | Segment>("all");
  const crmQuery = useQuery({
    queryKey: ["crm", brandId],
    queryFn: async (): Promise<CrmCustomer[]> => {
      const response = await fetch(`/api/crm?brandId=${encodeURIComponent(brandId)}`);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "No se pudo cargar el CRM");
      return body.customers ?? [];
    },
  });
  const customers = crmQuery.data ?? EMPTY_CUSTOMERS;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return customers.filter((customer) => {
      if (segment !== "all" && !customer.segments.includes(segment)) return false;
      if (!normalized) return true;
      const haystack = [customer.name, customer.phone, ...customer.orders.flatMap((order) => [order.summary, ...order.products.map((product) => `${product.name} ${product.material}`)])].join(" ").toLocaleLowerCase("es");
      return haystack.includes(normalized);
    });
  }, [customers, query, segment]);

  const totalPurchases = customers.reduce((sum, customer) => sum + customer.purchases_count, 0);
  const totalPurchased = customers.reduce((sum, customer) => sum + customer.total_purchased, 0);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{brand.name}</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">CRM de clientes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Contactos, cotizaciones, compras y públicos detectados a partir del historial comercial.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={UsersRound} label="Clientes" value={String(customers.length)} />
        <Metric icon={ShoppingBag} label="Compras confirmadas" value={String(totalPurchases)} />
        <Metric icon={BadgeCheck} label="Valor comprado" value={money(totalPurchased)} />
      </section>

      <section className="rounded-xl border bg-card p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, teléfono, producto o material…" className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filtrar por público">
            {SEGMENTS.map((option) => (
              <button key={option.id} type="button" onClick={() => setSegment(option.id)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${segment === option.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {crmQuery.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{crmQuery.error.message}</div> : null}
      {crmQuery.isLoading ? <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">Cargando clientes…</div> : null}
      {!crmQuery.isLoading && !filtered.length ? <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">No hay clientes que coincidan con la búsqueda.</div> : null}

      <section className="space-y-3">
        {filtered.map((customer) => <CustomerCard key={customer.id} customer={customer} />)}
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof UsersRound; label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-5"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="h-5 w-5 text-primary" /></div><div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div></div>;
}

function CustomerCard({ customer }: { customer: CrmCustomer }) {
  return (
    <details className="group rounded-xl border bg-card" open={false}>
      <summary className="flex cursor-pointer list-none flex-col gap-4 p-5 marker:hidden md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ContactRound className="h-5 w-5" /></div>
          <div className="min-w-0"><div className="truncate font-semibold">{customer.name}</div><div className="text-sm text-muted-foreground">{customer.phone || "Sin teléfono"}</div></div>
        </div>
        <div className="flex flex-wrap gap-1.5">{customer.segments.map((item) => <Badge key={item} variant="secondary">{SEGMENT_LABELS[item]}</Badge>)}</div>
        <div className="grid grid-cols-3 gap-5 text-right text-sm">
          <div><div className="font-semibold tabular-nums">{customer.quotes_count}</div><div className="text-xs text-muted-foreground">cotizaciones</div></div>
          <div><div className="font-semibold tabular-nums">{customer.purchases_count}</div><div className="text-xs text-muted-foreground">compras</div></div>
          <div><div className="font-semibold tabular-nums">{money(customer.total_purchased)}</div><div className="text-xs text-muted-foreground">comprado</div></div>
        </div>
      </summary>
      <div className="border-t px-5 pb-5 pt-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historial · última actividad {dateLabel(customer.last_activity)}</div>
        <div className="space-y-3">
          {customer.orders.map((order) => (
            <article key={order.session_id} className="rounded-lg border bg-muted/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><Link href={`/chat?sessionId=${encodeURIComponent(order.session_id)}`} className="font-semibold text-primary hover:underline"><FileText className="mr-1 inline h-4 w-4" />{order.title}</Link><div className="text-xs text-muted-foreground">{dateLabel(order.date)}</div></div>
                <Badge variant={order.status === "comprado" ? "default" : "outline"}>{order.status === "comprado" ? `Comprado · ${money(order.total)}` : "Sólo cotizado"}</Badge>
              </div>
              {order.summary ? <p className="mt-2 text-sm">{order.summary}</p> : null}
              <ul className="mt-3 grid gap-2 md:grid-cols-2">
                {order.products.map((product) => <li key={product.key} className="rounded-md bg-background px-3 py-2 text-sm"><div className="font-medium">{product.quantity} × {product.name}</div><div className="text-xs text-muted-foreground">{product.material || "Material sin especificar"} · {SEGMENT_LABELS[product.segment]} · {product.purchased ? "comprado" : "cotizado"}</div></li>)}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}
