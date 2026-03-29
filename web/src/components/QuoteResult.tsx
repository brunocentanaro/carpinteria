"use client";

import { Quotation } from "@/lib/types";

interface Props {
  quotation: Quotation;
}

function lineCategory(concept: string): string {
  const c = concept.toLowerCase();
  if (c.includes("flete")) return "flete";
  if (c.includes("recargo financiero")) return "financiero";
  if (c.includes("cortes")) return "cortes";
  if (c.includes("mano de obra")) return "mano_obra";
  if (c.includes("maquinaria")) return "maquinaria";
  if (c.includes("merma")) return "merma";
  return "insumo";
}

const CATEGORY_ORDER = ["insumo", "cortes", "mano_obra", "maquinaria", "merma", "financiero", "flete"];

const CATEGORY_LABELS: Record<string, string> = {
  insumo: "Insumos",
  cortes: "Cortes",
  mano_obra: "Mano de obra",
  maquinaria: "Maquinaria",
  merma: "Merma",
  financiero: "Recargo financiero",
  flete: "Envio",
};

const CATEGORY_COLORS: Record<string, string> = {
  insumo: "bg-white",
  cortes: "bg-sky-50",
  mano_obra: "bg-amber-50",
  maquinaria: "bg-orange-50",
  merma: "bg-red-50",
  financiero: "bg-purple-50",
  flete: "bg-violet-50",
};

function fmt(n: number) {
  return "$" + n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuoteResult({ quotation }: Props) {
  if (quotation.notes && quotation.lines.length === 0) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 text-sm whitespace-pre-wrap">
        {quotation.notes}
      </div>
    );
  }

  const grouped: Record<string, typeof quotation.lines> = {};
  for (const line of quotation.lines) {
    const cat = lineCategory(line.concept);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(line);
  }

  const materialTotal = (grouped["insumo"] || []).reduce((s, l) => s + l.subtotal, 0);

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Cotizacion</h3>

      {CATEGORY_ORDER.map((cat) => {
        const lines = grouped[cat];
        if (!lines || lines.length === 0) return null;
        return (
          <div key={cat} className={`rounded-lg border p-3 ${CATEGORY_COLORS[cat]}`}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">{CATEGORY_LABELS[cat]}</h4>
            <table className="w-full text-sm">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4 text-xs">{line.concept}</td>
                    <td className="py-1 px-2 text-right w-16 text-gray-500">{line.quantity.toFixed(1)}</td>
                    <td className="py-1 px-2 w-16 text-gray-500">{line.unit}</td>
                    <td className="py-1 px-2 text-right w-24 text-gray-600">{fmt(line.unit_price)}</td>
                    <td className="py-1 pl-2 text-right w-24 font-medium">{fmt(line.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="border-t-2 border-gray-300 pt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Costo materiales</span>
          <span>{fmt(materialTotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Subtotal (con costos operativos)</span>
          <span>{fmt(quotation.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>Ganancia ({quotation.margin_percent}%)</span>
          <span>{fmt(quotation.margin_amount)}</span>
        </div>
        <div className="flex justify-between font-bold text-xl border-t-2 border-gray-800 pt-2">
          <span>TOTAL</span>
          <span>{fmt(quotation.total)}</span>
        </div>
      </div>

      {quotation.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-yellow-800 text-xs">
          {quotation.notes}
        </div>
      )}

      <details className="border rounded-lg">
        <summary className="p-3 cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          Como se armo esta cotizacion
        </summary>
        <div className="p-3 border-t text-xs text-gray-600 space-y-2">
          <p><span className="font-medium">1. Costo de materiales:</span> Se toma el costo USD de cada placa y canto de la hoja de costos de Barraca Parana (precio mayorista, sin impuestos). Se convierte a UYU usando el tipo de cambio de compra del mismo sheet.</p>
          <p><span className="font-medium">2. Placas parciales:</span> Si se usa menos del 85% de una placa, se cobra proporcional al area usada con un recargo: 70-84% +10%, 50-69% +20%, 30-49% +30%, menos de 30% +40%. Si se usa 85% o mas, se cobra la placa entera.</p>
          <p><span className="font-medium">3. Costos operativos (sobre el costo de materiales):</span></p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li>Maquinaria: 20%</li>
            <li>Merma/desperdicio: 20%</li>
            <li>Mano de obra: 40%</li>
            <li>Cortes: 20% base, proporcional a la cantidad de cortes (cada 50 cortes = 20%)</li>
          </ul>
          <p><span className="font-medium">4. Ganancia:</span> 60% sobre el subtotal (materiales + costos operativos).</p>
          <p><span className="font-medium">5. Recargo financiero (si aplica):</span> Se suma un 5% base por ser cliente estatal, mas un recargo segun el plazo de pago: hasta 30 dias +7%, hasta 45 dias +10%, hasta 60 dias +12.5%, hasta 90 dias +15%. Se aplica sobre el total con ganancia.</p>
          <p><span className="font-medium">6. Flete (si aplica):</span> Costo fijo por destino, se suma al final.</p>
          <p><span className="font-medium">7. Herrajes:</span> Precio estimado en USD convertido a UYU con el TC. Se suman al total.</p>
          <p className="font-medium text-amber-700 pt-1">Los precios NO incluyen IVA.</p>
        </div>
      </details>
    </div>
  );
}
