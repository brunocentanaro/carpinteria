"use client";

import { useState, useRef } from "react";
import { AnalysisPlan, CutPiece, PliegoResult } from "@/lib/types";

type UploadMode = "image" | "pliego";

interface Props {
  onImageAnalyzed: (plans: AnalysisPlan[]) => void;
  onPiecesLoaded: (pieces: CutPiece[], material: string, thickness: number, color: string, boardsNeeded: number) => void;
  onPliegoAnalyzed: (result: PliegoResult) => void;
}

export default function FileUpload({ onImageAnalyzed, onPiecesLoaded, onPliegoAnalyzed }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<UploadMode>("pliego");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    setLoading(true);
    setError("");

    try {
      const form = new FormData();
      for (const file of Array.from(files)) {
        form.append("files", file);
      }
      form.append("mode", mode);

      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (mode === "pliego") {
        onPliegoAnalyzed(data as PliegoResult);
      } else {
        const plans: AnalysisPlan[] = data.plans || [];
        onImageAnalyzed(plans);
        if (plans.length > 0) {
          const plan = plans[0];
          onPiecesLoaded(plan.pieces, plan.board_material, plan.board_thickness_mm, plan.board_color, plan.boards_needed);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al analizar");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("pliego")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium ${
            mode === "pliego" ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-gray-100 text-gray-600"
          }`}
        >
          Pliego / Especificacion
        </button>
        <button
          onClick={() => setMode("image")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium ${
            mode === "image" ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-gray-100 text-gray-600"
          }`}
        >
          Plano de corte
        </button>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <input
          ref={fileRef}
          type="file"
          accept={mode === "pliego" ? ".pdf,.xlsx,.xls,.txt,.csv" : "image/*,.pdf"}
          multiple={mode === "pliego"}
          onChange={onSelect}
          className="hidden"
        />
        {loading ? (
          <div className="space-y-2">
            <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-500">Analizando{mode === "pliego" ? " pliego" : " imagen"}...</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-600">
              {mode === "pliego"
                ? "Arrastra PDFs del pliego (podes subir varios)"
                : "Arrastra una imagen de plano de corte"}
            </p>
            <p className="text-xs text-gray-400 mt-1">o hace click para seleccionar</p>
          </div>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
