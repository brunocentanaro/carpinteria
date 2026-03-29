"use client";

import { PliegoItem } from "@/lib/types";

function isCotizable(item: PliegoItem): boolean {
  return item.wood_only === true;
}

interface Props {
  items: PliegoItem[];
  selectedCodes: string[];
  onSelectionChange: (codes: string[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generalSpecs: Record<string, any>;
}

export default function PliegoItems({ items, selectedCodes, onSelectionChange, generalSpecs }: Props) {
  function toggle(code: string) {
    if (selectedCodes.includes(code)) {
      onSelectionChange(selectedCodes.filter((c) => c !== code));
    } else {
      onSelectionChange([...selectedCodes, code]);
    }
  }

  function selectAllCompatible() {
    const compatible = items.filter((it) => isCotizable(it)).map((it) => it.code);
    onSelectionChange(compatible);
  }

  const compatibleCount = items.filter((it) => isCotizable(it)).length;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
        <h4 className="font-semibold mb-2">Datos generales del pliego</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {generalSpecs.delivery_location && (
            <p><span className="font-medium">Lugar de entrega:</span> {String(generalSpecs.delivery_location)}</p>
          )}
          {generalSpecs.delivery_days && (
            <p><span className="font-medium">Plazo de entrega:</span> {String(generalSpecs.delivery_days)} dias</p>
          )}
          {generalSpecs.payment_terms && (
            <p><span className="font-medium">Plazo de pago:</span> {String(generalSpecs.payment_terms)}</p>
          )}
          {generalSpecs.offer_maintenance_days && (
            <p><span className="font-medium">Mantenimiento de oferta:</span> {String(generalSpecs.offer_maintenance_days)} dias</p>
          )}
          {generalSpecs.product_warranty && (
            <p><span className="font-medium">Garantia producto:</span> {String(generalSpecs.product_warranty)}</p>
          )}
          {generalSpecs.bid_guarantee && (
            <p><span className="font-medium">Garantia de oferta:</span> {String(generalSpecs.bid_guarantee)}</p>
          )}
          {generalSpecs.performance_guarantee && (
            <p><span className="font-medium">Garantia de cumplimiento:</span> {String(generalSpecs.performance_guarantee)}</p>
          )}
          {generalSpecs.samples_required && (
            <p><span className="font-medium">Muestras:</span> {String(generalSpecs.samples_required)}</p>
          )}
          {generalSpecs.materials && (
            <p><span className="font-medium">Materiales:</span> {String(generalSpecs.materials)}</p>
          )}
          {Array.isArray(generalSpecs.colors) && (generalSpecs.colors as string[]).length > 0 && (
            <p><span className="font-medium">Colores:</span> {(generalSpecs.colors as string[]).join(", ")}</p>
          )}
          {generalSpecs.edge_banding && (
            <p><span className="font-medium">Cantos:</span> {String(generalSpecs.edge_banding)}</p>
          )}
          {Array.isArray(generalSpecs.required_forms) && (generalSpecs.required_forms as string[]).length > 0 && (
            <p className="md:col-span-2"><span className="font-medium">Formularios requeridos:</span> {(generalSpecs.required_forms as string[]).join("; ")}</p>
          )}
          {generalSpecs.other_conditions && (
            <p className="md:col-span-2"><span className="font-medium">Otras condiciones:</span> {String(generalSpecs.other_conditions)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">
          {compatibleCount} de {items.length} items cotizables — {selectedCodes.length} seleccionados
        </span>
        <button
          onClick={selectAllCompatible}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
        >
          Seleccionar todos los cotizables
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <th className="py-2 pr-2 w-8"></th>
              <th className="py-2 pr-2 w-16">Codigo</th>
              <th className="py-2 pr-2">Mueble</th>
              <th className="py-2 pr-2 w-12 text-right">Cant</th>
              <th className="py-2 pr-2">Dimensiones</th>
              <th className="py-2 pr-2">Material</th>
              <th className="py-2 w-24">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const metal = !isCotizable(item);
              const selected = selectedCodes.includes(item.code);
              return (
                <tr
                  key={i}
                  className={`border-b border-gray-100 ${
                    metal ? "opacity-50" : selected ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-2 pr-2">
                    {metal ? (
                      <span className="text-gray-300">-</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggle(item.code)}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2 font-mono text-xs">{item.code}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-gray-500 max-w-sm">{item.description}</div>
                    {item.hardware.length > 0 && (
                      <div className="text-xs text-gray-400">
                        Herrajes: {item.hardware.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-medium">{item.quantity}</td>
                  <td className="py-2 pr-2 text-xs">
                    {item.dimensions?.width_mm > 0 && (
                      <span>{item.dimensions.width_mm}x{item.dimensions.height_mm}
                        {item.dimensions.depth_mm > 0 && `x${item.dimensions.depth_mm}`}mm
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs">{item.material} {item.thickness_mm > 0 && `${item.thickness_mm}mm`}</td>
                  <td className="py-2 text-xs">
                    {metal ? (
                      <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Requiere hierro</span>
                    ) : (
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded">Cotizable</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
