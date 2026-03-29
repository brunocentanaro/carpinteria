"use client";

import { CutPiece } from "@/lib/types";

interface Props {
  pieces: CutPiece[];
  onChange: (pieces: CutPiece[]) => void;
}

const EMPTY_PIECE: CutPiece = {
  width_mm: 0,
  height_mm: 0,
  quantity: 1,
  label: "",
  edge_sides: [],
};

const SIDES = ["top", "bottom", "left", "right"];

export default function PieceEditor({ pieces, onChange }: Props) {
  function update(i: number, field: keyof CutPiece, value: unknown) {
    const updated = [...pieces];
    updated[i] = { ...updated[i], [field]: value };
    onChange(updated);
  }

  function toggleEdge(i: number, side: string) {
    const current = pieces[i].edge_sides;
    const next = current.includes(side)
      ? current.filter((s) => s !== side)
      : [...current, side];
    update(i, "edge_sides", next);
  }

  function addPiece() {
    onChange([...pieces, { ...EMPTY_PIECE }]);
  }

  function removePiece(i: number) {
    onChange(pieces.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Piezas</h3>
        <button
          onClick={addPiece}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
        >
          + Agregar pieza
        </button>
      </div>

      {pieces.map((p, i) => (
        <div key={i} className="border rounded p-3 space-y-2 bg-gray-50">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Ancho (mm)</label>
              <input
                type="number"
                value={p.width_mm || ""}
                onChange={(e) => update(i, "width_mm", Number(e.target.value))}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="600"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Alto (mm)</label>
              <input
                type="number"
                value={p.height_mm || ""}
                onChange={(e) => update(i, "height_mm", Number(e.target.value))}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="450"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-gray-500">Cant.</label>
              <input
                type="number"
                value={p.quantity || ""}
                onChange={(e) => update(i, "quantity", Number(e.target.value))}
                className="w-full border rounded px-2 py-1 text-sm"
                min={1}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Etiqueta</label>
              <input
                type="text"
                value={p.label}
                onChange={(e) => update(i, "label", e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="opcional"
              />
            </div>
            <button
              onClick={() => removePiece(i)}
              className="text-red-500 hover:text-red-700 text-sm px-2 py-1"
            >
              X
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500">Cantos:</span>
            {SIDES.map((side) => (
              <button
                key={side}
                onClick={() => toggleEdge(i, side)}
                className={`text-xs px-2 py-0.5 rounded border ${
                  p.edge_sides.includes(side)
                    ? "bg-blue-100 border-blue-400 text-blue-700"
                    : "bg-white border-gray-300 text-gray-500"
                }`}
              >
                {side}
              </button>
            ))}
          </div>
        </div>
      ))}

      {pieces.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">
          Sin piezas. Agregá una o subí un archivo.
        </p>
      )}
    </div>
  );
}
