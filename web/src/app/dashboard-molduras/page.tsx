"use client";

import { useCallback, useEffect, useState } from "react";

import {
  StockDashboard,
  type DashboardMovement,
  type DashboardProduct,
  type DashboardReservation,
  type DashboardStockRow,
} from "@/app/stock-molduras/StockDashboard";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";

interface DashboardData {
  products: DashboardProduct[];
  stock: DashboardStockRow[];
  movements: DashboardMovement[];
  reservations: DashboardReservation[];
}

const EMPTY_DATA: DashboardData = { products: [], stock: [], movements: [], reservations: [] };

export default function MoldurasDashboardPage() {
  const { brandId, brand } = useBrandEnvironment();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stock-molduras");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el dashboard");
      setData(body as DashboardData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header>
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">{brand.name}</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dashboard de molduras</h1>
      <p className="mt-1 text-sm text-muted-foreground">{brandId === "casa" ? "Consulta de cantidades enteras disponibles en fábrica." : "Inventario, ventas, rotación, fabricación y precios de Carpintería Juan Pirone."}</p>
    </header>
    {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    {loading ? <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">Cargando dashboard…</div> : <StockDashboard products={data.products} stock={data.stock} movements={data.movements} reservations={data.reservations} mode={brandId === "casa" ? "casa" : "pirone"} />}
  </main>;
}
