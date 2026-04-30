"use client";

interface HardwareSummary {
  code: string;
  name: string;
  category: string;
  unit: string;
  totalQuantity: number;
  perItem: { itemCode: string; quantity: number }[];
}

interface Props {
  rows: HardwareSummary[];
  prices: Record<string, number>;
  onPriceChange: (code: string, price: number) => void;
  onRecalculate: () => void;
  recalculating?: boolean;
  dirty: boolean;
}

export default function HardwarePricesPanel({
  rows,
  prices,
  onPriceChange,
  onRecalculate,
  recalculating,
  dirty,
}: Props) {
  if (rows.length === 0) return null;

  const totalEstimated = rows.reduce(
    (sum, r) => sum + (Number(prices[r.code]) || 0) * r.totalQuantity,
    0,
  );
  const missing = rows.filter((r) => !(Number(prices[r.code]) > 0)).length;

  return (
    <section className="bg-white border border-amber-300 rounded-lg p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Precios de herrajes</h2>
          <p className="text-xs text-gray-600">
            Tipeá el precio unitario en UYU para cada herraje. Se guarda local en este navegador y se reusa en próximas cotizaciones.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-600">Total estimado herrajes</div>
          <div className="text-lg font-semibold tabular-nums">
            {totalEstimated.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UYU
          </div>
          {missing > 0 && (
            <div className="text-xs text-amber-700">
              Faltan precios: {missing} de {rows.length}
            </div>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-600">Herraje</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-600">Categoría</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 text-right">Cant total</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-600">Por mueble</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 text-right">Precio unit (UYU)</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const price = Number(prices[r.code]) || 0;
              const subtotal = price * r.totalQuantity;
              return (
                <tr key={r.code} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[10px] font-mono text-gray-500">{r.code}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{r.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totalQuantity}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {r.perItem.map((pi) => `${pi.itemCode}×${pi.quantity}`).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={price > 0 ? price : ""}
                      onChange={(e) => onPriceChange(r.code, Number(e.target.value) || 0)}
                      placeholder="—"
                      className={`w-28 border rounded px-2 py-1 text-sm text-right tabular-nums ${
                        price > 0 ? "" : "border-amber-400 bg-amber-50"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {subtotal > 0
                      ? subtotal.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t">
        {dirty && (
          <span className="text-xs text-amber-700">
            Hay cambios sin aplicar a las cotizaciones.
          </span>
        )}
        <button
          onClick={onRecalculate}
          disabled={!!recalculating}
          className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          {recalculating ? "Recalculando..." : "Recalcular cotizaciones con estos precios"}
        </button>
      </div>
    </section>
  );
}
