"use client";

import { useState } from "react";
import PieceEditor from "@/components/PieceEditor";
import QuoteResult from "@/components/QuoteResult";
import FileUpload from "@/components/FileUpload";
import PliegoItems from "@/components/PliegoItems";
import { CutPiece, Quotation, AnalysisPlan, PliegoResult, PliegoItem } from "@/lib/types";

interface ItemQuote {
  item: PliegoItem;
  quotation: Quotation;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hardware_lines: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decomposition: any;
  total_with_hw: number;
  missing_inputs?: string[];
  warnings?: string[];
  hasError: boolean;
}

type Tab = "file" | "manual";

export default function Home() {
  const [tab, setTab] = useState<Tab>("file");
  const [pieces, setPieces] = useState<CutPiece[]>([]);
  const [material, setMaterial] = useState("melamínico");
  const [thickness, setThickness] = useState(18);
  const [color, setColor] = useState("blanco");
  const [boardsNeeded, setBoardsNeeded] = useState(0);
  const [edgeBanding, setEdgeBanding] = useState("");
  const [paymentDays, setPaymentDays] = useState(45);
  const [destination, setDestination] = useState("");
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<AnalysisPlan[]>([]);
  const [pliegoResult, setPliegoResult] = useState<PliegoResult | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [itemQuotes, setItemQuotes] = useState<ItemQuote[]>([]);
  const [quotingProgress, setQuotingProgress] = useState("");

  async function handleQuote() {
    if (pieces.length === 0) {
      setError("Agrega al menos una pieza");
      return;
    }
    setLoading(true);
    setError("");
    setQuotation(null);

    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pieces,
          material,
          thickness_mm: thickness,
          color,
          boards_needed: boardsNeeded || undefined,
          edge_banding_name: edgeBanding || undefined,
          payment_days: paymentDays || undefined,
          destination: destination || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setQuotation(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function handleQuoteSelected() {
    if (!pliegoResult || selectedCodes.length === 0) return;
    setLoading(true);
    setError("");
    setItemQuotes([]);

    const selected = pliegoResult.items.filter((it) => selectedCodes.includes(it.code));
    const results: ItemQuote[] = [];

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      setQuotingProgress(`Cotizando ${item.code} - ${item.name} (${i + 1}/${selected.length})...`);

      try {
        const res = await fetch("/api/quote-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item,
            color,
            payment_days: paymentDays || undefined,
            destination: destination || undefined,
          }),
        });
        const data = await res.json();
        if (!data.error) {
          results.push({
            item,
            quotation: data,
            hardware_lines: data.hardware_lines || [],
            decomposition: data.decomposition || {},
            total_with_hw: data.total,
            warnings: data.warnings,
            hasError: false,
          });
        } else {
          results.push({
            item,
            quotation: { lines: [], subtotal: 0, margin_percent: 0, margin_amount: 0, total: 0, notes: data.error },
            hardware_lines: [],
            decomposition: {},
            total_with_hw: 0,
            missing_inputs: data.missing_inputs,
            hasError: true,
          });
        }
      } catch {
        results.push({
          item,
          quotation: { lines: [], subtotal: 0, margin_percent: 0, margin_amount: 0, total: 0, notes: "Error de conexion" },
          hardware_lines: [],
          decomposition: {},
          total_with_hw: 0,
          hasError: true,
        });
      }
    }

    setItemQuotes(results);
    setQuotingProgress("");
    setLoading(false);
  }

  function handleImageAnalyzed(newPlans: AnalysisPlan[]) {
    setPlans(newPlans);
  }

  function handlePiecesLoaded(newPieces: CutPiece[], mat: string, thick: number, col: string, boards: number) {
    setPieces(newPieces);
    if (mat) setMaterial(mat);
    if (thick) setThickness(thick);
    if (col) setColor(col);
    if (boards) setBoardsNeeded(boards);
  }

  function handlePliegoAnalyzed(result: PliegoResult) {
    setPliegoResult(result);
    if (result.general_specs.delivery_location) setDestination(result.general_specs.delivery_location);
    if (result.general_specs.delivery_days) setPaymentDays(result.general_specs.delivery_days);
  }

  const grandTotal = itemQuotes.reduce((s, q) => s + q.total_with_hw * q.item.quantity, 0);

  async function handleExportExcel() {
    const quotes = itemQuotes.map((iq) => ({
      ...iq.quotation,
      item_code: iq.item.code,
      item_name: iq.item.name,
      item_quantity: iq.item.quantity,
      decomposition: iq.decomposition,
      hardware_lines: iq.hardware_lines,
      total: iq.total_with_hw,
      has_error: iq.hasError,
      missing_inputs: iq.missing_inputs,
    }));
    try {
      const res = await fetch("/api/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotes }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al exportar");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cotizacion.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al exportar");
    }
  }

  async function handleExportDocx() {
    const quotes = itemQuotes.filter((iq) => !iq.hasError).map((iq) => ({
      ...iq.quotation,
      item_code: iq.item.code,
      item_name: iq.item.name,
      item_quantity: iq.item.quantity,
      item_description: iq.item.description,
      item_dimensions: iq.item.dimensions,
      item_material: iq.item.material,
      item_edge_banding: iq.item.edge_banding,
      item_hardware: iq.item.hardware,
      decomposition: iq.decomposition,
      hardware_lines: iq.hardware_lines,
      total: iq.total_with_hw,
    }));
    try {
      const res = await fetch("/api/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotes,
          general_specs: pliegoResult?.general_specs || {},
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al exportar Word");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cotizacion_licitacion.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al exportar Word");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <h1 className="text-xl font-bold">Cotizador de Carpinteria</h1>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex gap-1 bg-gray-200 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("file")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "file" ? "bg-white shadow text-gray-900" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Subir archivo
          </button>
          <button
            onClick={() => setTab("manual")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "manual" ? "bg-white shadow text-gray-900" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Manual
          </button>
        </div>

        {tab === "file" && (
          <div className="bg-white rounded-lg border p-4 space-y-4">
            <FileUpload
              onImageAnalyzed={handleImageAnalyzed}
              onPiecesLoaded={handlePiecesLoaded}
              onPliegoAnalyzed={handlePliegoAnalyzed}
            />
            {plans.length > 0 && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
                {plans.length} plan(es) detectado(s). Piezas cargadas abajo.
              </div>
            )}
          </div>
        )}

        {pliegoResult && (
          <>
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold mb-3">Items del pliego ({pliegoResult.items.length})</h3>
              <PliegoItems
                items={pliegoResult.items}
                selectedCodes={selectedCodes}
                onSelectionChange={setSelectedCodes}
                generalSpecs={pliegoResult.general_specs}
              />
            </div>

            {selectedCodes.length > 0 && (
              <div className="bg-white rounded-lg border p-4 space-y-4">
                <h3 className="font-semibold text-sm">Parametros de cotizacion</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Color</label>
                    <input
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                      placeholder="blanco"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Dias de pago</label>
                    <input
                      type="number"
                      value={paymentDays}
                      onChange={(e) => setPaymentDays(Number(e.target.value))}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Destino flete</label>
                    <input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>

                <button
                  onClick={handleQuoteSelected}
                  disabled={loading}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? quotingProgress || "Cotizando..." : `Cotizar ${selectedCodes.length} items seleccionados`}
                </button>
              </div>
            )}
          </>
        )}

        {itemQuotes.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Cotizaciones por item</h2>

            {itemQuotes.map((iq, i) => (
              <details key={i} className={`rounded-lg border ${iq.hasError ? "bg-red-50 border-red-200" : "bg-white"}`}>
                <summary className="p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded mr-2">{iq.item.code}</span>
                    <span className="font-medium">{iq.item.name}</span>
                    <span className="text-gray-500 ml-2">x{iq.item.quantity}</span>
                    {iq.hasError && <span className="ml-2 text-xs bg-red-200 text-red-700 px-2 py-0.5 rounded">Faltan datos</span>}
                  </div>
                  {!iq.hasError && (
                    <div className="text-right">
                      <div className="font-bold">
                        ${(iq.total_with_hw * iq.item.quantity).toLocaleString("es-UY", { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-gray-500">
                        ${iq.total_with_hw.toLocaleString("es-UY", { minimumFractionDigits: 2 })} c/u
                      </div>
                    </div>
                  )}
                </summary>
                <div className="p-4 border-t space-y-3">
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>{iq.item.description}</p>
                    {iq.item.dimensions?.width_mm > 0 && (
                      <p>Dimensiones: {iq.item.dimensions.width_mm}x{iq.item.dimensions.height_mm}
                        {iq.item.dimensions.depth_mm > 0 && `x${iq.item.dimensions.depth_mm}`}mm
                      </p>
                    )}
                    {iq.item.material && <p>Material: {iq.item.material} {iq.item.thickness_mm > 0 && `${iq.item.thickness_mm}mm`}</p>}
                    {iq.item.hardware?.length > 0 && <p>Herrajes requeridos: {iq.item.hardware.join(", ")}</p>}
                    {iq.item.edge_banding && <p>Canto: {iq.item.edge_banding}</p>}
                  </div>

                  {iq.hasError && (
                    <div className="bg-red-100 border border-red-300 rounded p-3 space-y-2">
                      <p className="text-sm font-medium text-red-800">{iq.quotation.notes}</p>
                      {iq.missing_inputs && iq.missing_inputs.length > 0 && (
                        <ul className="text-sm text-red-700 space-y-1">
                          {iq.missing_inputs.map((m, j) => (
                            <li key={j}>{m.startsWith("  ") ? m : `- ${m}`}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {iq.warnings && iq.warnings.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
                      {iq.warnings.map((w, j) => <p key={j}>{w}</p>)}
                    </div>
                  )}

                  {!iq.hasError && (
                    <>
                      {iq.decomposition?.pieces && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Piezas de placa</h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
                            {iq.decomposition.pieces.map((p: { label: string; width_mm: number; height_mm: number; quantity: number; edge_sides: string[] }, j: number) => (
                              <div key={j} className="bg-gray-50 rounded px-2 py-1">
                                {p.label}: {p.width_mm}x{p.height_mm}mm x{p.quantity}
                                {p.edge_sides?.length > 0 && <span className="text-blue-500 ml-1">[canto: {p.edge_sides.join(",")}]</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {iq.hardware_lines.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Herrajes</h4>
                          <div className="text-xs space-y-0.5">
                            {iq.hardware_lines.map((h: { concept: string; quantity: number; unit_price: number; subtotal: number }, j: number) => (
                              <div key={j} className="flex justify-between">
                                <span>{h.concept} x{h.quantity}</span>
                                <span>${h.subtotal.toLocaleString("es-UY", { minimumFractionDigits: 2 })}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <QuoteResult quotation={iq.quotation} />
                    </>
                  )}
                </div>
              </details>
            ))}

            <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg">TOTAL PLIEGO ({itemQuotes.length} items)</span>
                <span className="font-bold text-2xl">
                  ${grandTotal.toLocaleString("es-UY", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleExportExcel}
                  className="flex-1 bg-green-700 text-white py-2 rounded-lg font-semibold hover:bg-green-800 transition-colors"
                >
                  Descargar Excel
                </button>
                <button
                  onClick={handleExportDocx}
                  className="flex-1 bg-blue-700 text-white py-2 rounded-lg font-semibold hover:bg-blue-800 transition-colors"
                >
                  Descargar Word (licitacion)
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "manual" && (
          <>
            <div className="bg-white rounded-lg border p-4">
              <PieceEditor pieces={pieces} onChange={setPieces} />
            </div>

            <div className="bg-white rounded-lg border p-4 space-y-4">
              <h3 className="font-semibold text-sm">Parametros</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Material</label>
                  <input value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Espesor (mm)</label>
                  <input type="number" value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Color</label>
                  <input value={color} onChange={(e) => setColor(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="blanco, gris humo..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Placas (0=auto)</label>
                  <input type="number" value={boardsNeeded} onChange={(e) => setBoardsNeeded(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" min={0} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Canto</label>
                  <input value={edgeBanding} onChange={(e) => setEdgeBanding(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="auto por color" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Dias de pago (0=normal)</label>
                  <input type="number" value={paymentDays} onChange={(e) => setPaymentDays(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm" min={0} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Destino flete</label>
                  <input value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="Rivera, Salto..." />
                </div>
              </div>
            </div>

            <button
              onClick={handleQuote}
              disabled={loading || pieces.length === 0}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Calculando..." : "Cotizar"}
            </button>

            {quotation && (
              <div className="bg-white rounded-lg border p-4">
                <QuoteResult quotation={quotation} />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
