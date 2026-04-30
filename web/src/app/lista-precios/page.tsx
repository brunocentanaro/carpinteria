"use client";

import { useMemo, useState } from "react";

type Producto = {
  sku: string;
  codigo_proveedor: string;
  proveedor: string;
  tipo_producto: string;
  familia: string;
  material: string;
  nombre: string;
  descripcion: string;
  descripcion_normalizada: string;
  search_key: string;
  espesor_mm: number | null;
  ancho_mm: number | null;
  largo_mm: number | null;
  unidad: string;
  precio_usd_simp: number;
  precio_usd_cimp: number;
  moneda_origen: string;
  precio_origen_simp: number;
  precio_origen_cimp: number;
  tc_aplicado: number;
  tags: string[];
  categoria_origen: string;
  subcategoria_origen: string;
  subsubcategoria_origen: string;
  lista: string;
  periodo: string;
};

type Cambio = Producto & {
  precio_usd_simp_old: number;
  precio_usd_cimp_old: number;
  moneda_origen_old: string;
  precio_origen_simp_old: number;
  delta_usd_simp: number;
  delta_usd_simp_pct: number | null;
  delta_usd_cimp: number;
  delta_usd_cimp_pct: number | null;
};

type Removido = {
  sku: string;
  codigo_proveedor: string;
  nombre: string;
  descripcion: string;
  tipo_producto: string;
  familia: string;
  material: string;
  unidad: string;
  moneda_origen: string;
  precio_usd_simp: number;
  precio_usd_cimp: number;
};

type Preview = {
  lista: string;
  periodo: string;
  current_lista: string;
  current_periodo: string;
  summary: {
    total_nueva: number;
    total_actual: number;
    nuevos: number;
    removidos: number;
    cambios: number;
    sin_cambios: number;
  };
  nuevos: Producto[];
  removidos: Removido[];
  cambios: Cambio[];
  items: Producto[];
  error?: string;
};

type Tab = "cambios" | "nuevos" | "removidos";

function fmtUsd(n: number) {
  return `U$S ${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null) {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function ListaPreciosPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ url?: string; rows?: number; snapshot_tab?: string; error?: string } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("cambios");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"delta_pct" | "codigo" | "tipo">("delta_pct");

  async function handleUpload() {
    if (!file) {
      setError("Seleccioná un PDF");
      return;
    }
    setLoading(true);
    setError("");
    setPreview(null);
    setConfirmResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/lista-precios/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setPreview(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    setError("");
    setConfirmResult(null);
    try {
      const res = await fetch("/api/lista-precios/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: preview.items }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setConfirmResult(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setConfirming(false);
    }
  }

  const filteredCambios = useMemo(() => {
    if (!preview) return [] as Cambio[];
    const f = filter.trim().toLowerCase();
    let out = preview.cambios;
    if (f) {
      out = out.filter(
        (r) =>
          r.codigo_proveedor.toLowerCase().includes(f) ||
          r.descripcion.toLowerCase().includes(f) ||
          r.tipo_producto.toLowerCase().includes(f) ||
          r.familia.toLowerCase().includes(f) ||
          r.material.toLowerCase().includes(f),
      );
    }
    return [...out].sort((a, b) => {
      if (sortKey === "delta_pct") {
        return Math.abs(b.delta_usd_simp_pct ?? 0) - Math.abs(a.delta_usd_simp_pct ?? 0);
      }
      if (sortKey === "codigo") return a.codigo_proveedor.localeCompare(b.codigo_proveedor);
      return a.tipo_producto.localeCompare(b.tipo_producto);
    });
  }, [preview, filter, sortKey]);

  const filteredNuevos = useMemo(() => {
    if (!preview) return [] as Producto[];
    const f = filter.trim().toLowerCase();
    if (!f) return preview.nuevos;
    return preview.nuevos.filter(
      (r) =>
        r.codigo_proveedor.toLowerCase().includes(f) ||
        r.descripcion.toLowerCase().includes(f) ||
        r.tipo_producto.toLowerCase().includes(f) ||
        r.familia.toLowerCase().includes(f),
    );
  }, [preview, filter]);

  const filteredRemovidos = useMemo(() => {
    if (!preview) return [] as Removido[];
    const f = filter.trim().toLowerCase();
    if (!f) return preview.removidos;
    return preview.removidos.filter(
      (r) =>
        r.codigo_proveedor.toLowerCase().includes(f) ||
        r.descripcion.toLowerCase().includes(f) ||
        r.tipo_producto.toLowerCase().includes(f),
    );
  }, [preview, filter]);

  return (
    <main className="max-w-7xl mx-auto p-6 flex-1">
      <h1 className="text-2xl font-semibold mb-2">Lista de precios — Barraca Paraná</h1>
      <p className="text-sm text-gray-600 mb-6">
        Subí el PDF mensual de Barraca Paraná. Te mostramos qué cambió antes de reemplazar la lista activa.
      </p>

      <div className="border rounded-lg p-4 bg-gray-50 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setConfirmResult(null);
              setError("");
            }}
            className="text-sm"
          />
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Analizar PDF"}
          </button>
          {file && <span className="text-xs text-gray-600">{file.name}</span>}
        </div>
        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      </div>

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <SummaryCard label="Lista nueva" value={`Nº ${preview.lista || "?"}`} sub={preview.periodo} />
            <SummaryCard
              label="Lista activa actual"
              value={preview.current_lista ? `Nº ${preview.current_lista}` : "—"}
              sub={preview.current_periodo || "(sin lista anterior)"}
            />
            <SummaryCard
              label="Cambios de precio"
              value={preview.summary.cambios.toString()}
              sub={`${preview.summary.sin_cambios} sin cambios`}
              tone="amber"
            />
            <SummaryCard
              label="Productos nuevos"
              value={preview.summary.nuevos.toString()}
              sub={`Total: ${preview.summary.total_nueva}`}
              tone="green"
            />
            <SummaryCard
              label="Productos quitados"
              value={preview.summary.removidos.toString()}
              sub={`Antes: ${preview.summary.total_actual}`}
              tone="red"
            />
          </div>

          <div className="border rounded-lg p-4 bg-blue-50 mb-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm">
              Si todo se ve bien, confirmá para sobreescribir la pestaña <code>Activa</code> y crear el snapshot histórico{" "}
              <code>Lista {preview.lista} - {preview.periodo}</code>.
            </div>
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="px-4 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              {confirming ? "Subiendo..." : "Confirmar y subir"}
            </button>
          </div>

          {confirmResult && !confirmResult.error && (
            <div className="border rounded-lg p-4 bg-green-50 mb-6 text-sm">
              ✅ Subido: {confirmResult.rows} filas en <code>Activa</code> y snapshot{" "}
              <code>{confirmResult.snapshot_tab}</code>.{" "}
              {confirmResult.url && (
                <a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={confirmResult.url}>
                  Abrir Sheet
                </a>
              )}
            </div>
          )}

          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <TabBtn active={tab === "cambios"} onClick={() => setTab("cambios")}>
              Cambios ({preview.summary.cambios})
            </TabBtn>
            <TabBtn active={tab === "nuevos"} onClick={() => setTab("nuevos")}>
              Nuevos ({preview.summary.nuevos})
            </TabBtn>
            <TabBtn active={tab === "removidos"} onClick={() => setTab("removidos")}>
              Quitados ({preview.summary.removidos})
            </TabBtn>
            <input
              placeholder="Filtrar (código, descripción, tipo, material)..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="ml-auto border rounded px-3 py-1.5 text-sm w-72"
            />
            {tab === "cambios" && (
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                className="border rounded px-2 py-1.5 text-sm"
              >
                <option value="delta_pct">Ordenar: mayor cambio %</option>
                <option value="codigo">Ordenar: código</option>
                <option value="tipo">Ordenar: tipo de producto</option>
              </select>
            )}
          </div>

          {tab === "cambios" && <ChangesTable rows={filteredCambios} />}
          {tab === "nuevos" && <NuevosTable rows={filteredNuevos} />}
          {tab === "removidos" && <RemovidosTable rows={filteredRemovidos} />}
        </>
      )}
    </main>
  );
}

function SummaryCard({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "green" | "red" | "amber" }) {
  const toneCls =
    tone === "green" ? "bg-green-50 border-green-200"
      : tone === "red" ? "bg-red-50 border-red-200"
        : tone === "amber" ? "bg-amber-50 border-amber-200"
          : "bg-white border-gray-200";
  return (
    <div className={`border rounded-lg p-3 ${toneCls}`}>
      <div className="text-xs text-gray-600 uppercase">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm ${active ? "bg-gray-900 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
    >
      {children}
    </button>
  );
}

function TipoBadge({ tipo, familia }: { tipo: string; familia: string }) {
  const colorByTipo: Record<string, string> = {
    PLACA: "bg-blue-100 text-blue-800",
    CANTO: "bg-purple-100 text-purple-800",
    MADERA: "bg-amber-100 text-amber-800",
    MOLDURA: "bg-orange-100 text-orange-800",
    PISO: "bg-teal-100 text-teal-800",
    DECK: "bg-emerald-100 text-emerald-800",
    REVESTIMIENTO: "bg-cyan-100 text-cyan-800",
    PUERTA: "bg-rose-100 text-rose-800",
    LAMINA: "bg-indigo-100 text-indigo-800",
    PINTURA: "bg-pink-100 text-pink-800",
    ADHESIVO: "bg-yellow-100 text-yellow-800",
    INSUMO: "bg-gray-100 text-gray-800",
    OTRO: "bg-gray-100 text-gray-700",
  };
  const cls = colorByTipo[tipo] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {tipo}
      {familia && <span className="opacity-70">· {familia}</span>}
    </span>
  );
}

function ChangesTable({ rows }: { rows: Cambio[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-gray-500 py-8 text-center">Sin cambios.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left">
            <Th>Tipo</Th>
            <Th>Código</Th>
            <Th>Nombre</Th>
            <Th className="text-right">USD antes</Th>
            <Th className="text-right">USD ahora</Th>
            <Th className="text-right">Δ %</Th>
            <Th>Unidad</Th>
            <Th>Origen</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const up = (r.delta_usd_simp_pct ?? 0) > 0;
            const down = (r.delta_usd_simp_pct ?? 0) < 0;
            return (
              <tr key={r.sku} className="border-t hover:bg-gray-50">
                <Td><TipoBadge tipo={r.tipo_producto} familia={r.familia} /></Td>
                <Td className="font-mono text-xs">{r.codigo_proveedor}</Td>
                <Td>{r.nombre}</Td>
                <Td className="text-right tabular-nums text-gray-500 line-through">{fmtUsd(r.precio_usd_simp_old)}</Td>
                <Td className="text-right tabular-nums font-medium">{fmtUsd(r.precio_usd_simp)}</Td>
                <Td className={`text-right tabular-nums ${up ? "text-red-700" : down ? "text-green-700" : ""}`}>
                  {up ? "▲" : down ? "▼" : ""} {fmtPct(r.delta_usd_simp_pct)}
                </Td>
                <Td className="text-xs">{r.unidad}</Td>
                <Td className="text-xs text-gray-500">
                  {r.moneda_origen === "UYU"
                    ? `$ ${r.precio_origen_simp.toFixed(2)} → ÷${r.tc_aplicado}`
                    : "USD nativo"}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NuevosTable({ rows }: { rows: Producto[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-gray-500 py-8 text-center">Sin productos nuevos.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left">
            <Th>Tipo</Th>
            <Th>Código</Th>
            <Th>Nombre</Th>
            <Th>Material</Th>
            <Th className="text-right">USD S/IMP</Th>
            <Th className="text-right">USD C/IMP</Th>
            <Th>Unidad</Th>
            <Th>Tags</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sku} className="border-t hover:bg-gray-50">
              <Td><TipoBadge tipo={r.tipo_producto} familia={r.familia} /></Td>
              <Td className="font-mono text-xs">{r.codigo_proveedor}</Td>
              <Td>{r.nombre}</Td>
              <Td className="text-xs">{r.material}</Td>
              <Td className="text-right tabular-nums">{fmtUsd(r.precio_usd_simp)}</Td>
              <Td className="text-right tabular-nums">{fmtUsd(r.precio_usd_cimp)}</Td>
              <Td className="text-xs">{r.unidad}</Td>
              <Td className="text-xs text-gray-500">{(r.tags || []).join(", ")}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RemovidosTable({ rows }: { rows: Removido[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-gray-500 py-8 text-center">Ningún producto fue quitado.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left">
            <Th>Tipo</Th>
            <Th>Código</Th>
            <Th>Nombre</Th>
            <Th>Material</Th>
            <Th className="text-right">Último USD S/IMP</Th>
            <Th>Unidad</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sku} className="border-t hover:bg-gray-50">
              <Td><TipoBadge tipo={r.tipo_producto} familia={r.familia} /></Td>
              <Td className="font-mono text-xs">{r.codigo_proveedor}</Td>
              <Td>{r.nombre}</Td>
              <Td className="text-xs">{r.material}</Td>
              <Td className="text-right tabular-nums">{fmtUsd(r.precio_usd_simp)}</Td>
              <Td className="text-xs">{r.unidad}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs font-semibold text-gray-600 ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
