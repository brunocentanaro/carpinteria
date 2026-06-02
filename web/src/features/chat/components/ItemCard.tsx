"use client";

import type { DragEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Maximize2, Plus, Ruler, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteItem,
  listHardwareCatalog,
  qk,
  setItemHardwareQuantity,
  setPieceQuantity,
  upsertPiece,
  updateItem,
} from "../api";
import type { QuotationItem } from "../schemas";

function fmtUYU(n: number): string {
  return n.toLocaleString("es-UY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface ItemCardProps {
  item: QuotationItem;
  sessionId: string;
  defaultOpen?: boolean;
}

export function ItemCard({ item, sessionId, defaultOpen = false }: ItemCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const total = item.last_quote?.total_with_hardware ?? 0;
  const pending = item.last_quote?.pending_hardware_codes ?? [];
  const noQuote = total === 0;
  const status = noQuote ? "❌" : pending.length > 0 ? "⚠" : "✓";
  const statusVariant: "default" | "destructive" | "secondary" = noQuote
    ? "destructive"
    : pending.length > 0
      ? "secondary"
      : "default";

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors rounded-t"
        aria-expanded={open}
      >
        <div className="mt-0.5">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <Badge variant={statusVariant} className="mt-0.5 text-base px-2">
          {status}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-semibold">{item.code}</span>
            <span className="text-muted-foreground text-xs">
              ×{item.quantity}
            </span>
            <span className="text-foreground/90 truncate">{item.name}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {item.material} {item.thickness_mm}mm
            {item.color ? ` · ${item.color}` : ""} · {item.pieces.length}{" "}
            piezas · {item.hardware.length} herrajes
          </div>
          {pending.length > 0 && (
            <div className="text-amber-700 text-xs mt-0.5">
              Faltan precios: {pending.join(", ")}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="font-semibold tabular-nums">
            UYU {fmtUYU(total)}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            × {item.quantity} = UYU {fmtUYU(total * item.quantity)}
          </div>
        </div>
      </button>
      {open && (
        <>
          <Separator />
          <CardContent className="p-4 space-y-5">
            <ItemFields item={item} sessionId={sessionId} />
            <DesignPreview item={item} sessionId={sessionId} />
            <PiecesTable item={item} sessionId={sessionId} />
            <HardwareTable item={item} sessionId={sessionId} />
            <BreakdownTable item={item} />
            <DeleteItemRow item={item} sessionId={sessionId} />
          </CardContent>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Design preview
// ---------------------------------------------------------------------------

function mm(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return "-";
  return `${Math.round(n)}mm`;
}

function inferOverallDimensions(item: QuotationItem) {
  const width =
    item.dimensions?.width_mm ??
    Math.max(0, ...item.pieces.map((p) => p.width_mm || 0));
  const height =
    item.dimensions?.height_mm ??
    Math.max(0, ...item.pieces.map((p) => p.height_mm || 0));
  const depth = item.dimensions?.depth_mm;
  return { width, height, depth };
}

function labelKind(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("puerta")) return "Puertas";
  if (l.includes("lateral")) return "Laterales";
  if (l.includes("estante")) return "Estantes";
  if (l.includes("caj")) return "Cajones";
  if (l.includes("base") || l.includes("tapa")) return "Cuerpo";
  if (l.includes("trasera") || l.includes("fondo")) return "Fondos";
  return "Otras piezas";
}

function countByLabel(
  pieces: QuotationItem["pieces"],
  predicate: (label: string) => boolean,
) {
  return pieces
    .filter((p) => predicate(p.label.toLowerCase()))
    .reduce((sum, p) => sum + p.quantity, 0);
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function countFromText(text: string, nouns: string[]) {
  for (const noun of nouns) {
    const numeric = text.match(new RegExp(`(\\d+)\\s+${noun}\\b`));
    if (numeric) return Number(numeric[1]);
    for (const [word, value] of Object.entries(NUMBER_WORDS)) {
      if (new RegExp(`\\b${word}\\s+${noun}\\b`).test(text)) return value;
    }
  }
  return 0;
}

function mentioned(text: string, words: string[]) {
  return words.some((word) => new RegExp(`\\b${word}\\b`).test(text));
}

function inferVisualModel(item: QuotationItem) {
  const text = normalizeText(`${item.name} ${item.description} ${item.notes}`);
  const labels = item.pieces.map((p) => ({ ...p, normalizedLabel: normalizeText(p.label) }));
  const hasDoorMention = mentioned(text, ["puerta", "puertas"]) || labels.some((p) => p.normalizedLabel.includes("puerta"));
  const hasDoorPlural = mentioned(text, ["puertas"]);
  const hasDrawerMention = mentioned(text, ["cajon", "cajones", "cajonera"]) || labels.some((p) => p.normalizedLabel.includes("caj"));
  const hasDrawerPlural = mentioned(text, ["cajones"]);
  const hasShelfMention = mentioned(text, ["estante", "estantes", "repisa", "repisas"]) || labels.some((p) => p.normalizedLabel.includes("estante"));
  const hasShelfPlural = mentioned(text, ["estantes", "repisas"]);
  const hasLowerDoors = /puertas?.{0,24}inferior|inferior.{0,24}puertas?/.test(text) || labels.some((p) => /puerta.*inferior|inferior.*puerta/.test(p.normalizedLabel));
  const hasHorizontalDivider = /divisor horizontal|division horizontal|estante divisor/.test(text) || labels.some((p) => /divisor horizontal|division horizontal|estante divisor/.test(p.normalizedLabel));
  const headboardShelf =
    /respaldo/.test(text) &&
    /cama/.test(text) &&
    (/estante/.test(text) || labels.some((p) => p.normalizedLabel.includes("estante"))) &&
    (/sin (tapa|costado|lateral).{0,24}costados?|costados?.{0,40}abiert|entras? al estante/.test(text) || /pared frontal.*trasera|frontal.*trasera/.test(text));
  const hasHanger =
    mentioned(text, ["perchero", "percheros", "barral", "barrales", "colgado", "colgar"]) ||
    labels.some((p) => /perchero|barral|colgado|colgar/.test(p.normalizedLabel));
  const isDrawerCabinet = mentioned(text, ["cajonera", "cajoneras"]) || /cajonera/.test(text);
  const hasWheels =
    mentioned(text, ["rueda", "ruedas", "rodachin", "rodachina", "rodachines", "movil"]) ||
    labels.some((p) => /rueda|rodach|movil/.test(p.normalizedLabel));
  const hasLock =
    mentioned(text, ["cerradura", "cerraduras", "llave", "traba"]) ||
    /traba total|cierre central|cerradura/.test(text) ||
    labels.some((p) => /cerradura|llave|traba/.test(p.normalizedLabel));
  const doorCount =
    countFromText(text, ["puertas?"]) ||
    labels.filter((p) => p.normalizedLabel.includes("puerta")).reduce((sum, p) => sum + p.quantity, 0) ||
    (hasDoorPlural ? 2 : hasDoorMention ? 1 : 0);
  const drawerFrontCount = labels
    .filter((p) => p.normalizedLabel.includes("caj") && p.normalizedLabel.includes("frente"))
    .reduce((sum, p) => sum + p.quantity, 0);
  const drawerBoxCount = labels
    .filter((p) => {
      const label = p.normalizedLabel;
      return label.includes("caj") && !label.includes("lateral") && !label.includes("fondo") && !label.includes("base") && !label.includes("costado");
    })
    .reduce((sum, p) => sum + p.quantity, 0);
  const drawerCount = countFromText(text, ["cajones?", "cajon"]) || (hasDrawerPlural ? Math.max(2, drawerFrontCount, drawerBoxCount) : 0) || drawerFrontCount || drawerBoxCount || (hasDrawerMention ? 1 : 0);
  const shelfCount =
    countFromText(text, ["estantes?"]) ||
    labels.filter((p) => p.normalizedLabel.includes("estante")).reduce((sum, p) => sum + p.quantity, 0) ||
    (hasShelfPlural ? 2 : hasShelfMention ? 1 : 0);
  const drawerPosition: "top" | "bottom" = /cajones?.{0,24}abajo|abajo.{0,24}cajones?/.test(text) ? "bottom" : "top";
  const drawerLayout: "columns" | "stacked" =
    isDrawerCabinet || (drawerCount > 1 && doorCount === 0 && shelfCount === 0 && !hasHanger)
      ? "stacked"
      : "columns";
  const upperOpenCubbies =
    (doorCount > 0 &&
      /abajo/.test(text) &&
      /arriba/.test(text) &&
      (/sin puert?a/.test(text) || /sin purta/.test(text) || /abierto|abierta/.test(text) || /estantes?/.test(text))) ||
    (hasLowerDoors && hasHorizontalDivider);
  return { doorCount, drawerCount, shelfCount, drawerPosition, drawerLayout, hasHanger, hasWheels, hasLock, upperOpenCubbies, headboardShelf };
}

function DesignPreview({ item, sessionId }: { item: QuotationItem; sessionId: string }) {
  const dims = inferOverallDimensions(item);
  const totalPieces = item.pieces.reduce((sum, p) => sum + p.quantity, 0);
  const groups = item.pieces.reduce<Record<string, typeof item.pieces>>(
    (acc, piece) => {
      const kind = labelKind(piece.label);
      acc[kind] = acc[kind] ?? [];
      acc[kind].push(piece);
      return acc;
    },
    {},
  );
  const hasAnyDrawing = item.pieces.length > 0 || dims.width || dims.height;

  if (!hasAnyDrawing) return null;

  const visualModel = inferVisualModel(item);
  const doors = item.pieces.filter((p) => p.label.toLowerCase().includes("puerta"));
  const shelves = item.pieces.filter((p) => p.label.toLowerCase().includes("estante"));
  const doorCount = doors.reduce((s, p) => s + p.quantity, 0);
  const drawerFrontCount = countByLabel(
    item.pieces,
    (label) => label.includes("caj") && label.includes("frente"),
  );
  const drawerCount = drawerFrontCount || countByLabel(
    item.pieces,
    (label) => label.includes("cajon") || label.includes("cajón"),
  );
  const shelfCount = shelves.reduce((s, p) => s + p.quantity, 0);
  const displayDoorCount = visualModel.doorCount || doorCount;
  const displayDrawerCount = visualModel.drawerCount || drawerCount;
  const displayShelfCount = visualModel.shelfCount || shelfCount;

  return (
    <section className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-xs uppercase font-semibold text-muted-foreground">
              Plano y diseño interpretado
            </div>
            <div className="text-[11px] text-muted-foreground">
              {mm(dims.width)} ancho · {mm(dims.height)} alto
              {dims.depth ? ` · ${mm(dims.depth)} profundidad` : ""} · {totalPieces} piezas
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {displayDoorCount > 0 && <Badge variant="secondary">{displayDoorCount} puertas</Badge>}
          {displayDrawerCount > 0 && <Badge variant="secondary">{displayDrawerCount} cajones</Badge>}
          {displayShelfCount > 0 && <Badge variant="secondary">{displayShelfCount} estantes</Badge>}
          {visualModel.hasHanger && <Badge variant="secondary">perchero</Badge>}
          {visualModel.hasWheels && <Badge variant="secondary">ruedas</Badge>}
          {visualModel.hasLock && <Badge variant="secondary">cerradura</Badge>}
        </div>
      </div>

      <div className="overflow-x-auto p-3">
        <div className={displayDoorCount > 0 ? "grid min-w-[1120px] grid-cols-[760px_320px] gap-4" : "grid min-w-[860px] grid-cols-[520px_320px] gap-4"}>
          <div className={displayDoorCount > 0 ? "grid grid-cols-4 gap-2" : "grid grid-cols-3 gap-2"}>
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">
              {displayDoorCount > 0 ? "Frente cerrado" : "Frente"}
            </div>
            <FrontView itemCode={item.code} dims={dims} shelves={displayShelfCount} doorCount={displayDoorCount} drawerCount={displayDrawerCount} drawerPosition={visualModel.drawerPosition} drawerLayout={visualModel.drawerLayout} hasHanger={visualModel.hasHanger} hasWheels={visualModel.hasWheels} hasLock={visualModel.hasLock} upperOpenCubbies={visualModel.upperOpenCubbies} headboardShelf={visualModel.headboardShelf} mode="closed" />
          </div>
          {displayDoorCount > 0 && (
            <div className="border rounded bg-slate-50 p-2">
              <div className="text-[11px] font-semibold text-center mb-1">Frente abierto</div>
              <FrontView itemCode={`${item.code}-open`} dims={dims} shelves={displayShelfCount} doorCount={displayDoorCount} drawerCount={displayDrawerCount} drawerPosition={visualModel.drawerPosition} drawerLayout={visualModel.drawerLayout} hasHanger={visualModel.hasHanger} hasWheels={visualModel.hasWheels} hasLock={visualModel.hasLock} upperOpenCubbies={visualModel.upperOpenCubbies} headboardShelf={visualModel.headboardShelf} mode="open" />
            </div>
          )}
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">Costado</div>
            <SideView dims={dims} shelves={displayShelfCount} hasHanger={visualModel.hasHanger} hasWheels={visualModel.hasWheels} upperOpenCubbies={visualModel.upperOpenCubbies} headboardShelf={visualModel.headboardShelf} />
          </div>
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">Planta</div>
            <TopView dims={dims} columns={visualModel.upperOpenCubbies ? displayDoorCount : 2} headboardShelf={visualModel.headboardShelf} />
          </div>
          </div>

          <div className="grid grid-cols-2 gap-3 content-start">
          {Object.entries(groups).map(([kind, pieces]) => (
            <div key={kind} className="rounded border bg-muted/20 p-2">
              <div className="text-xs font-semibold mb-1">{kind}</div>
              <div className="space-y-1">
                {pieces.map((p, i) => (
                  <div key={`${p.label}-${i}`} className="text-xs flex justify-between gap-2">
                    <span className="truncate" title={p.label || "pieza"}>
                      {p.quantity}x {p.label || "pieza"}
                    </span>
                    <span className="font-mono text-muted-foreground whitespace-nowrap">
                      {Math.round(p.width_mm)} x {Math.round(p.height_mm)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
      <div className="border-t px-3 py-2 flex justify-end">
        <PlanEditorDialog
          item={item}
          sessionId={sessionId}
          dims={dims}
          visualModel={visualModel}
        />
      </div>
    </section>
  );
}

type PlanElementKind = "door" | "drawer" | "shelf" | "division" | "hanger";

type PlanElement = {
  id: string;
  kind: PlanElementKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sourceLabel?: string;
};

const EDITOR_BOX = { x: 60, y: 40, w: 880, h: 600 };

const PLAN_COMPONENTS: Array<{ kind: PlanElementKind; label: string }> = [
  { kind: "door", label: "Puerta" },
  { kind: "drawer", label: "Cajon" },
  { kind: "shelf", label: "Estante" },
  { kind: "division", label: "Division" },
  { kind: "hanger", label: "Perchero" },
];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function makePlanId(kind: PlanElementKind) {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultPlanElement(kind: PlanElementKind, x: number, y: number): PlanElement {
  if (kind === "door") return { id: makePlanId(kind), kind, label: "puerta frente", x: x - 120, y: y - 180, w: 240, h: 360 };
  if (kind === "drawer") return { id: makePlanId(kind), kind, label: "frente cajon", x: x - 130, y: y - 45, w: 260, h: 90 };
  if (kind === "shelf") return { id: makePlanId(kind), kind, label: "estante", x: x - 180, y: y - 8, w: 360, h: 16 };
  if (kind === "division") return { id: makePlanId(kind), kind, label: "division vertical", x: x - 8, y: EDITOR_BOX.y + 12, w: 16, h: EDITOR_BOX.h - 24 };
  return { id: makePlanId(kind), kind, label: "perchero", x: x - 160, y: y - 10, w: 320, h: 20 };
}

function elementFromPiece(piece: QuotationItem["pieces"][number], index: number, dims: ReturnType<typeof inferOverallDimensions>): PlanElement | null {
  const label = normalizeText(piece.label);
  const width = dims.width || 1;
  const height = dims.height || 1;
  const pieceW = clamp((piece.width_mm / width) * EDITOR_BOX.w, 80, EDITOR_BOX.w);
  const pieceH = clamp((piece.height_mm / height) * EDITOR_BOX.h, 35, EDITOR_BOX.h);
  const offset = (index % 4) * 28;

  if (label.includes("puerta")) return { id: `piece-door-${index}`, kind: "door", label: piece.label, sourceLabel: piece.label, x: EDITOR_BOX.x + 24 + offset, y: EDITOR_BOX.y + 24, w: Math.min(pieceW, EDITOR_BOX.w - 48), h: Math.min(pieceH, EDITOR_BOX.h - 48) };
  if (label.includes("caj") && label.includes("frente")) return { id: `piece-drawer-${index}`, kind: "drawer", label: piece.label, sourceLabel: piece.label, x: EDITOR_BOX.x + 80 + offset, y: EDITOR_BOX.y + EDITOR_BOX.h - Math.min(pieceH, 120) - 32, w: Math.min(pieceW, EDITOR_BOX.w - 160), h: Math.min(pieceH, 120) };
  if (label.includes("estante")) return { id: `piece-shelf-${index}`, kind: "shelf", label: piece.label, sourceLabel: piece.label, x: EDITOR_BOX.x + 80, y: EDITOR_BOX.y + 150 + offset, w: Math.min(pieceW, EDITOR_BOX.w - 160), h: 16 };
  if (label.includes("division")) return { id: `piece-division-${index}`, kind: "division", label: piece.label, sourceLabel: piece.label, x: EDITOR_BOX.x + EDITOR_BOX.w / 2 - 8 + offset, y: EDITOR_BOX.y + 16, w: 16, h: EDITOR_BOX.h - 32 };
  return null;
}

function seedPlanElements(item: QuotationItem, dims: ReturnType<typeof inferOverallDimensions>, visualModel: ReturnType<typeof inferVisualModel>) {
  const elements: PlanElement[] = [];
  const drawerCount = Math.max(0, visualModel.drawerCount);

  if (visualModel.drawerLayout === "stacked" && drawerCount > 0) {
    const gap = 18;
    const drawerH = (EDITOR_BOX.h - gap * (drawerCount + 1)) / drawerCount;
    for (let i = 0; i < drawerCount; i += 1) {
      elements.push({
        id: `seed-drawer-${i}`,
        kind: "drawer",
        label: `frente cajon ${i + 1}`,
        x: EDITOR_BOX.x + 32,
        y: EDITOR_BOX.y + gap + i * (drawerH + gap),
        w: EDITOR_BOX.w - 64,
        h: drawerH,
      });
    }
    return elements;
  }

  const fromPieces = item.pieces
    .map((piece, index) => elementFromPiece(piece, index, dims))
    .filter((element): element is PlanElement => Boolean(element));
  if (fromPieces.length > 0) return fromPieces;

  const doorCount = Math.max(0, visualModel.doorCount);
  if (doorCount > 0) {
    const doorW = EDITOR_BOX.w / doorCount;
    for (let i = 0; i < doorCount; i += 1) elements.push({ id: `seed-door-${i}`, kind: "door", label: `puerta frente ${i + 1}`, x: EDITOR_BOX.x + i * doorW, y: EDITOR_BOX.y, w: doorW, h: EDITOR_BOX.h });
  }
  if (drawerCount > 0) {
    const drawerH = Math.min(115, Math.max(70, EDITOR_BOX.h / (drawerCount + 4)));
    for (let i = 0; i < drawerCount; i += 1) elements.push({ id: `seed-drawer-${i}`, kind: "drawer", label: `frente cajon ${i + 1}`, x: EDITOR_BOX.x + 120, y: EDITOR_BOX.y + EDITOR_BOX.h - (drawerCount - i) * drawerH - 18, w: EDITOR_BOX.w - 240, h: drawerH - 8 });
  }
  if (visualModel.hasHanger) elements.push({ id: "seed-hanger", kind: "hanger", label: "perchero", x: EDITOR_BOX.x + 100, y: EDITOR_BOX.y + 170, w: EDITOR_BOX.w * 0.45, h: 20 });
  const shelfCount = Math.max(0, visualModel.shelfCount);
  if (shelfCount > 0) {
    const startY = visualModel.hasHanger ? 110 : 140;
    for (let i = 0; i < Math.min(shelfCount, 6); i += 1) elements.push({ id: `seed-shelf-${i}`, kind: "shelf", label: `estante ${i + 1}`, x: visualModel.hasHanger ? EDITOR_BOX.x + EDITOR_BOX.w * 0.58 : EDITOR_BOX.x + 90, y: EDITOR_BOX.y + startY + i * 82, w: visualModel.hasHanger ? EDITOR_BOX.w * 0.34 : EDITOR_BOX.w - 180, h: 16 });
  }
  if ((visualModel.hasHanger && shelfCount > 0) || doorCount > 1) elements.push({ id: "seed-division", kind: "division", label: "division vertical", x: EDITOR_BOX.x + EDITOR_BOX.w / 2 - 8, y: EDITOR_BOX.y + 12, w: 16, h: EDITOR_BOX.h - 24 });
  return elements;
}

function svgElementToPiece(element: PlanElement, dims: ReturnType<typeof inferOverallDimensions>, index: number) {
  const width = dims.width || 0;
  const height = dims.height || 0;
  const depth = dims.depth || 0;
  const elementWidthMm = Math.max(1, Math.round((element.w / EDITOR_BOX.w) * width));
  const elementHeightMm = Math.max(1, Math.round((element.h / EDITOR_BOX.h) * height));
  if (element.kind === "door") return { label: element.sourceLabel || element.label || `puerta frente ${index + 1}`, width_mm: elementWidthMm, height_mm: elementHeightMm, quantity: 1, edge_sides: ["top", "bottom", "left", "right"] };
  if (element.kind === "drawer") return { label: element.sourceLabel || element.label || `frente cajon ${index + 1}`, width_mm: elementWidthMm, height_mm: elementHeightMm, quantity: 1, edge_sides: ["top", "bottom", "left", "right"] };
  if (element.kind === "shelf") return { label: element.sourceLabel || element.label || `estante ${index + 1}`, width_mm: elementWidthMm, height_mm: Math.max(1, Math.round(depth)), quantity: 1, edge_sides: ["top"] };
  if (element.kind === "division") return { label: element.sourceLabel || element.label || `division vertical ${index + 1}`, width_mm: Math.max(1, Math.round((element.h / EDITOR_BOX.h) * height)), height_mm: Math.max(1, Math.round(depth)), quantity: 1, edge_sides: ["left"] };
  return null;
}

function relevantPlanComponents(visualModel: ReturnType<typeof inferVisualModel>) {
  const components = PLAN_COMPONENTS.filter((component) => {
    if (component.kind === "hanger") return visualModel.hasHanger;
    if (component.kind === "door") return visualModel.doorCount > 0 || visualModel.drawerCount === 0;
    if (component.kind === "drawer") return visualModel.drawerCount > 0 || visualModel.drawerLayout === "stacked";
    if (component.kind === "shelf") return visualModel.shelfCount > 0 || visualModel.doorCount > 0;
    if (component.kind === "division") return visualModel.doorCount > 1 || visualModel.shelfCount > 0 || visualModel.drawerLayout === "stacked";
    return true;
  });
  return components.length > 0 ? components : PLAN_COMPONENTS.filter((component) => component.kind !== "hanger");
}

function PlanEditorDialog({
  item,
  sessionId,
  dims,
  visualModel,
}: {
  item: QuotationItem;
  sessionId: string;
  dims: ReturnType<typeof inferOverallDimensions>;
  visualModel: ReturnType<typeof inferVisualModel>;
}) {
  const queryClient = useQueryClient();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; offsetX: number; offsetY: number; startW: number; startH: number; startX: number; startY: number } | null>(null);
  const initialElements = useMemo(() => seedPlanElements(item, dims, visualModel), [item, dims, visualModel]);
  const [elements, setElements] = useState<PlanElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(initialElements[0]?.id ?? null);
  const [componentSearch, setComponentSearch] = useState("");
  const [activePlanView, setActivePlanView] = useState<"front" | "side" | "top">("front");
  const [editorWidth, setEditorWidth] = useState(92);
  const [editorHeight, setEditorHeight] = useState(92);
  const [canvasZoom, setCanvasZoom] = useState(100);
  const selected = elements.find((element) => element.id === selectedId) ?? null;

  const upsertMutation = useMutation({ mutationFn: upsertPiece, onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s) });
  const deleteMutation = useMutation({ mutationFn: setPieceQuantity, onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s) });
  const updateMutation = useMutation({ mutationFn: updateItem, onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s) });

  useEffect(() => {
    setElements(initialElements);
    setSelectedId(initialElements[0]?.id ?? null);
  }, [initialElements]);

  function pointFromEvent(event: DragEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    return point.matrixTransform(matrix.inverse());
  }

  function keepInside(element: PlanElement): PlanElement {
    const w = clamp(element.w, 12, EDITOR_BOX.w);
    const h = clamp(element.h, 12, EDITOR_BOX.h);
    return { ...element, w, h, x: clamp(element.x, EDITOR_BOX.x, EDITOR_BOX.x + EDITOR_BOX.w - w), y: clamp(element.y, EDITOR_BOX.y, EDITOR_BOX.y + EDITOR_BOX.h - h) };
  }

  function addElement(kind: PlanElementKind, x = EDITOR_BOX.x + EDITOR_BOX.w / 2, y = EDITOR_BOX.y + EDITOR_BOX.h / 2) {
    const element = keepInside(defaultPlanElement(kind, x, y));
    setElements((current) => [...current, element]);
    setSelectedId(element.id);
  }

  function startDrag(event: PointerEvent<SVGElement>, element: PlanElement, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event as unknown as PointerEvent<SVGSVGElement>);
    if (!point) return;
    dragRef.current = { id: element.id, mode, offsetX: point.x - element.x, offsetY: point.y - element.y, startW: element.w, startH: element.h, startX: point.x, startY: point.y };
    setSelectedId(element.id);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const dragging = dragRef.current;
    if (!dragging) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setElements((current) => current.map((element) => {
      if (element.id !== dragging.id) return element;
      if (dragging.mode === "move") return keepInside({ ...element, x: point.x - dragging.offsetX, y: point.y - dragging.offsetY });
      return keepInside({ ...element, w: dragging.startW + point.x - dragging.startX, h: dragging.startH + point.y - dragging.startY });
    }));
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.sourceLabel) deleteMutation.mutate({ sessionId, itemCode: item.code, pieceLabel: selected.sourceLabel, quantity: 0 });
    setElements((current) => current.filter((element) => element.id !== selected.id));
    setSelectedId(null);
  }

  async function applyPlan() {
    const pieces: Parameters<typeof upsertPiece>[0]["piece"][] = [];
    elements.forEach((element, index) => {
      const piece = svgElementToPiece(element, dims, index);
      if (piece) pieces.push(piece);
    });
    for (const piece of pieces) await upsertMutation.mutateAsync({ sessionId, itemCode: item.code, piece });
    const hasHanger = elements.some((element) => element.kind === "hanger");
    const note = item.notes || "";
    const nextNote = hasHanger
      ? note.includes("[plano: perchero]") ? note : `${note} [plano: perchero]`.trim()
      : note.replace(/\s*\[plano: perchero\]\s*/gi, " ").trim();
    if (nextNote !== note) await updateMutation.mutateAsync({ sessionId, itemCode: item.code, fields: { notes: nextNote } });
  }

  const busy = upsertMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const paletteComponents = relevantPlanComponents(visualModel);
  const extraComponents = PLAN_COMPONENTS.filter(
    (component) =>
      !paletteComponents.some((palette) => palette.kind === component.kind) &&
      normalizeText(component.label).includes(normalizeText(componentSearch)),
  );

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Maximize2 className="h-4 w-4" />
            Abrir plano
          </Button>
        }
      />
      <DialogContent
        className="flex max-w-[99vw] max-h-[98vh] flex-col overflow-hidden p-4"
        style={{ width: `${editorWidth}vw`, height: `${editorHeight}vh` }}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>Plano editable - {item.code}</DialogTitle>
            <div className="grid w-[420px] grid-cols-3 gap-3">
              <PlanRange label="Ancho" value={editorWidth} min={70} max={99} onChange={setEditorWidth} />
              <PlanRange label="Alto" value={editorHeight} min={65} max={98} onChange={setEditorHeight} />
              <PlanRange label="Zoom" value={canvasZoom} min={70} max={180} onChange={setCanvasZoom} suffix="%" />
            </div>
          </div>
          <DialogDescription className="sr-only">Editor visual de piezas del mueble.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[120px_minmax(0,1fr)] gap-3">
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            <div className="text-xs uppercase font-semibold text-muted-foreground">Componentes</div>
            {paletteComponents.map((component) => (
              <button key={component.kind} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("application/x-plan-kind", component.kind)} onClick={() => addElement(component.kind)} className="w-full rounded-md border bg-card p-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <PlanComponentIcon kind={component.kind} />
                <span className="mt-1 block text-center text-xs font-medium">{component.label}</span>
              </button>
            ))}
            <div className="pt-2">
              <Input
                value={componentSearch}
                onChange={(event) => setComponentSearch(event.target.value)}
                placeholder="Buscar otro"
                className="h-8 text-xs"
              />
            </div>
            {componentSearch.trim() && (
              <div className="space-y-2">
                {extraComponents.map((component) => (
                  <button key={component.kind} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("application/x-plan-kind", component.kind)} onClick={() => addElement(component.kind)} className="w-full rounded-md border border-dashed bg-card p-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <PlanComponentIcon kind={component.kind} />
                    <span className="mt-1 block text-center text-xs font-medium">{component.label}</span>
                  </button>
                ))}
                {extraComponents.length === 0 && (
                  <div className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
                    Sin resultados
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="min-w-0 rounded-md border bg-slate-50 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {activePlanView === "front" ? "Frente editable" : activePlanView === "side" ? "Costado" : "Planta"}
                </div>
                <div className="text-xs text-muted-foreground">{mm(dims.width)} ancho - {mm(dims.height)} alto{dims.depth ? ` - ${mm(dims.depth)} profundidad` : ""}</div>
              </div>
              <div className="flex rounded-md border bg-background p-1">
                {[
                  ["front", "Frente"],
                  ["side", "Costado"],
                  ["top", "Arriba"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    variant={activePlanView === value ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setActivePlanView(value as "front" | "side" | "top")}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {activePlanView === "front" && selected && (
                <div className="grid max-w-[520px] flex-1 grid-cols-[minmax(130px,1fr)_repeat(4,76px)] gap-2">
                  <Input value={selected.label} onChange={(event) => setElements((current) => current.map((element) => element.id === selected.id ? { ...element, label: event.target.value } : element))} className="h-8" />
                  <PlanNumberInput label="X" value={selected.x - EDITOR_BOX.x} onChange={(value) => setElements((current) => current.map((element) => element.id === selected.id ? keepInside({ ...element, x: EDITOR_BOX.x + value }) : element))} compact />
                  <PlanNumberInput label="Y" value={selected.y - EDITOR_BOX.y} onChange={(value) => setElements((current) => current.map((element) => element.id === selected.id ? keepInside({ ...element, y: EDITOR_BOX.y + value }) : element))} compact />
                  <PlanNumberInput label="Ancho" value={selected.w} onChange={(value) => setElements((current) => current.map((element) => element.id === selected.id ? keepInside({ ...element, w: value }) : element))} compact />
                  <PlanNumberInput label="Alto" value={selected.h} onChange={(value) => setElements((current) => current.map((element) => element.id === selected.id ? keepInside({ ...element, h: value }) : element))} compact />
                </div>
              )}
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={deleteSelected} disabled={activePlanView !== "front" || !selected || busy}><Trash2 className="h-4 w-4" />Borrar</Button>
                <Button type="button" size="sm" onClick={applyPlan} disabled={busy}>Aplicar al despiece</Button>
              </div>
            </div>
            {activePlanView === "front" ? (
              <div className="overflow-auto rounded bg-white" style={{ height: `calc(${editorHeight}vh - 150px)` }}>
                <svg ref={svgRef} viewBox="0 0 1000 700" className="aspect-[10/7] rounded bg-white" style={{ width: `${canvasZoom}%`, minWidth: "100%" }} role="img" aria-label="Editor visual del frente del mueble" onPointerMove={handlePointerMove} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }} onClick={() => setSelectedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                const kind = event.dataTransfer.getData("application/x-plan-kind") as PlanElementKind;
                if (!PLAN_COMPONENTS.some((component) => component.kind === kind)) return;
                const point = pointFromEvent(event);
                if (point) addElement(kind, point.x, point.y);
              }}>
                <defs><pattern id={`editor-grain-${item.code}`} width="28" height="18" patternUnits="userSpaceOnUse"><path d="M0 11 C8 2, 18 20, 28 8" fill="none" stroke="#d4a373" strokeWidth="1.4" opacity="0.34" /></pattern></defs>
                <rect x={EDITOR_BOX.x} y={EDITOR_BOX.y} width={EDITOR_BOX.w} height={EDITOR_BOX.h} rx="6" fill="#fff7ed" stroke="#92400e" strokeWidth="5" />
                <rect x={EDITOR_BOX.x + 8} y={EDITOR_BOX.y + 8} width={EDITOR_BOX.w - 16} height={EDITOR_BOX.h - 16} fill={`url(#editor-grain-${item.code})`} opacity="0.55" />
                {elements.map((element) => <PlanEditorElement key={element.id} element={element} selected={element.id === selectedId} hasLock={visualModel.hasLock} onPointerDown={(event) => startDrag(event, element, "move")} onResizePointerDown={(event) => startDrag(event, element, "resize")} onSelect={() => setSelectedId(element.id)} />)}
                {visualModel.hasWheels && (
                  <g>
                    {[EDITOR_BOX.x + 120, EDITOR_BOX.x + EDITOR_BOX.w - 120].map((cx) => (
                      <g key={cx}>
                        <line x1={cx} y1={EDITOR_BOX.y + EDITOR_BOX.h} x2={cx} y2={EDITOR_BOX.y + EDITOR_BOX.h + 36} stroke="#475569" strokeWidth="8" />
                        <circle cx={cx} cy={EDITOR_BOX.y + EDITOR_BOX.h + 54} r="20" fill="#334155" />
                        <circle cx={cx} cy={EDITOR_BOX.y + EDITOR_BOX.h + 54} r="8" fill="#94a3b8" />
                      </g>
                    ))}
                  </g>
                )}
                <DimensionLine x1={EDITOR_BOX.x} y1={EDITOR_BOX.y + EDITOR_BOX.h + 38} x2={EDITOR_BOX.x + EDITOR_BOX.w} y2={EDITOR_BOX.y + EDITOR_BOX.h + 38} label={mm(dims.width)} />
                <DimensionLine x1={EDITOR_BOX.x - 36} y1={EDITOR_BOX.y} x2={EDITOR_BOX.x - 36} y2={EDITOR_BOX.y + EDITOR_BOX.h} label={mm(dims.height)} vertical />
                </svg>
              </div>
            ) : (
              <div className="grid place-items-center overflow-auto rounded bg-white p-6" style={{ height: `calc(${editorHeight}vh - 150px)` }}>
                <div style={{ width: `${canvasZoom}%`, minWidth: "100%", maxWidth: `${Math.max(820, canvasZoom * 8)}px` }}>
                  {activePlanView === "side" ? (
                    <SideView dims={dims} shelves={visualModel.shelfCount} hasHanger={visualModel.hasHanger} hasWheels={visualModel.hasWheels} upperOpenCubbies={visualModel.upperOpenCubbies} headboardShelf={visualModel.headboardShelf} />
                  ) : (
                    <TopView dims={dims} columns={visualModel.upperOpenCubbies ? visualModel.doorCount : 2} headboardShelf={visualModel.headboardShelf} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanNumberInput({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <Label className={compact ? "grid grid-cols-[1fr_52px] items-center gap-1 text-[10px]" : "space-y-1 text-xs"}>
      <span className={compact ? "truncate text-muted-foreground" : ""}>{label}</span>
      <Input type="number" value={Math.round(value)} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="h-8 tabular-nums" />
    </Label>
  );
}

function PlanRange({
  label,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <Label className="space-y-1 text-[10px] text-muted-foreground">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono">{value}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full accent-emerald-700"
      />
    </Label>
  );
}

function PlanComponentIcon({ kind }: { kind: PlanElementKind }) {
  return (
    <svg viewBox="0 0 120 76" className="h-12 w-full rounded bg-slate-50" aria-hidden="true">
      <rect x="8" y="8" width="104" height="60" rx="4" fill="#fff7ed" stroke="#92400e" strokeWidth="3" />
      {kind === "door" && (<><line x1="60" y1="8" x2="60" y2="68" stroke="#92400e" strokeWidth="2" /><circle cx="54" cy="39" r="2.5" fill="#92400e" /><circle cx="66" cy="39" r="2.5" fill="#92400e" /></>)}
      {kind === "drawer" && (<><rect x="24" y="26" width="72" height="28" fill="#fed7aa" stroke="#92400e" strokeWidth="2" /><circle cx="60" cy="40" r="3" fill="#92400e" /></>)}
      {kind === "shelf" && <rect x="18" y="36" width="84" height="6" rx="2" fill="#92400e" />}
      {kind === "division" && <rect x="56" y="14" width="8" height="48" rx="2" fill="#92400e" />}
      {kind === "hanger" && (<><line x1="24" y1="28" x2="96" y2="28" stroke="#334155" strokeWidth="5" strokeLinecap="round" /><path d="M38 29 q8 13 16 0 M66 29 q8 13 16 0" fill="none" stroke="#64748b" strokeWidth="2" /></>)}
    </svg>
  );
}

function PlanEditorElement({
  element,
  selected,
  hasLock,
  onPointerDown,
  onResizePointerDown,
  onSelect,
}: {
  element: PlanElement;
  selected: boolean;
  hasLock: boolean;
  onPointerDown: (event: PointerEvent<SVGElement>) => void;
  onResizePointerDown: (event: PointerEvent<SVGElement>) => void;
  onSelect: () => void;
}) {
  const stroke = selected ? "#059669" : "#92400e";
  const common = {
    onPointerDown,
    onClick: (event: MouseEvent<SVGElement>) => {
      event.stopPropagation();
      onSelect();
    },
    cursor: "move",
  };
  return (
    <g>
      {element.kind === "door" && (<g {...common}><rect x={element.x} y={element.y} width={element.w} height={element.h} fill="#fff7ed" stroke={stroke} strokeWidth="4" opacity="0.88" /><circle cx={element.x + element.w - 26} cy={element.y + element.h / 2} r="6" fill="#92400e" /></g>)}
      {element.kind === "drawer" && (
        <g {...common}>
          <rect x={element.x} y={element.y} width={element.w} height={element.h} fill="#fed7aa" stroke={stroke} strokeWidth="4" rx="3" />
          <line x1={element.x + 48} y1={element.y + element.h * 0.3} x2={element.x + element.w - 48} y2={element.y + element.h * 0.3} stroke="#f3c28c" strokeWidth="3" opacity="0.75" />
          <circle cx={element.x + element.w / 2} cy={element.y + element.h / 2} r="6" fill="#92400e" />
          {hasLock && (
            <g>
              <circle cx={element.x + element.w - 56} cy={element.y + element.h / 2} r="14" fill="#f8fafc" stroke="#334155" strokeWidth="4" />
              <rect x={element.x + element.w - 60} y={element.y + element.h / 2 + 10} width="8" height="18" rx="3" fill="#334155" />
            </g>
          )}
        </g>
      )}
      {element.kind === "shelf" && <rect {...common} x={element.x} y={element.y} width={element.w} height={element.h} fill="#92400e" opacity="0.82" rx="3" />}
      {element.kind === "division" && <rect {...common} x={element.x} y={element.y} width={element.w} height={element.h} fill="#92400e" opacity="0.82" rx="3" />}
      {element.kind === "hanger" && (<g {...common}><line x1={element.x} y1={element.y + element.h / 2} x2={element.x + element.w} y2={element.y + element.h / 2} stroke="#334155" strokeWidth="9" strokeLinecap="round" /><path d={`M${element.x + element.w * 0.25} ${element.y + element.h / 2} q22 25 44 0 M${element.x + element.w * 0.58} ${element.y + element.h / 2} q22 25 44 0`} fill="none" stroke="#64748b" strokeWidth="3" /></g>)}
      {selected && (<><rect x={element.x - 5} y={element.y - 5} width={element.w + 10} height={element.h + 10} fill="none" stroke="#059669" strokeWidth="3" strokeDasharray="10 8" pointerEvents="none" /><rect x={element.x + element.w - 10} y={element.y + element.h - 10} width="22" height="22" rx="4" fill="#059669" stroke="white" strokeWidth="3" cursor="nwse-resize" onPointerDown={onResizePointerDown} onClick={(event) => event.stopPropagation()} /></>)}
      <text x={element.x + 12} y={element.y + 26} fontSize="18" fontWeight="700" fill="#0f172a" pointerEvents="none" opacity="0.72">{element.kind === "hanger" ? "" : element.label}</text>
    </g>
  );
}

function DimensionLine({
  x1,
  y1,
  x2,
  y2,
  label,
  vertical = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  vertical?: boolean;
}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth="1" />
      {vertical ? (
        <>
          <path d={`M${x1 - 4} ${y1} L${x1 + 4} ${y1} M${x2 - 4} ${y2} L${x2 + 4} ${y2}`} stroke="#475569" strokeWidth="1" />
          <text x={midX - 10} y={midY} textAnchor="middle" fontSize="10" fill="#334155" transform={`rotate(-90 ${midX - 10} ${midY})`}>
            {label}
          </text>
        </>
      ) : (
        <>
          <path d={`M${x1} ${y1 - 4} L${x1} ${y1 + 4} M${x2} ${y2 - 4} L${x2} ${y2 + 4}`} stroke="#475569" strokeWidth="1" />
          <text x={midX} y={midY + 14} textAnchor="middle" fontSize="10" fill="#334155">
            {label}
          </text>
        </>
      )}
    </>
  );
}

function FrontView({
  itemCode,
  dims,
  shelves,
  doorCount,
  drawerCount,
  drawerPosition,
  drawerLayout,
  hasHanger,
  hasWheels,
  hasLock,
  upperOpenCubbies,
  headboardShelf,
  mode = "closed",
}: {
  itemCode: string;
  dims: ReturnType<typeof inferOverallDimensions>;
  shelves: number;
  doorCount: number;
  drawerCount: number;
  drawerPosition: "top" | "bottom";
  drawerLayout: "columns" | "stacked";
  hasHanger: boolean;
  hasWheels: boolean;
  hasLock: boolean;
  upperOpenCubbies: boolean;
  headboardShelf: boolean;
  mode?: "closed" | "open";
}) {
  const bodyX = 38;
  const bodyY = 20;
  const bodyW = 152;
  const bodyH = 118;
  const hasDoorsAndDrawers = drawerCount > 0 && doorCount > 0;
  const hasOpenInteriorAndDrawers = drawerCount > 0 && (shelves > 0 || hasHanger) && doorCount === 0;
  const hasSeparatedDrawers = hasDoorsAndDrawers || hasOpenInteriorAndDrawers;
  const drawerAreaH = hasSeparatedDrawers ? Math.min(62, Math.max(34, drawerCount * 22)) : bodyH;
  const drawersOnBottom = hasSeparatedDrawers && (drawerPosition === "bottom" || hasOpenInteriorAndDrawers);
  const drawerY = drawersOnBottom ? bodyY + bodyH - drawerAreaH : bodyY;
  const lowerY = hasSeparatedDrawers && !drawersOnBottom ? bodyY + drawerAreaH : bodyY;
  const lowerBottom = drawersOnBottom ? drawerY : bodyY + bodyH;
  const lowerH = lowerBottom - lowerY;
  const drawerCols = Math.max(1, drawerCount);
  const doorCols = Math.max(1, doorCount);
  const hasInterior = shelves > 0 || hasHanger;
  const showInterior = mode === "open" || doorCount === 0;
  const showDoorLeaves = mode === "closed" && doorCount > 0;
  const splitY = bodyY + bodyH / 2;
  const closetW = hasInterior && shelves > 0 ? bodyW * 0.62 : bodyW;
  const shelfX = bodyX + closetW;
  const stackedDrawers = drawerLayout === "stacked";

  if (headboardShelf) {
    const lipY = bodyY - 6;
    return (
      <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista frontal de respaldo con estante">
        <defs>
          <pattern id={`grain-front-${itemCode}`} width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 8 C4 2, 8 14, 12 6" fill="none" stroke="#d4a373" strokeWidth="0.8" opacity="0.55" />
          </pattern>
        </defs>
        <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
        <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={`url(#grain-front-${itemCode})`} opacity="0.5" />
        <rect x={bodyX} y={lipY} width={bodyW} height="7" fill="#fed7aa" stroke="#92400e" strokeWidth="1.2" />
        <line x1={bodyX + 4} y1={splitY} x2={bodyX + bodyW - 4} y2={splitY} stroke="#92400e" strokeWidth="1.4" opacity="0.85" />
        <DimensionLine x1={bodyX} y1={bodyY + bodyH + 18} x2={bodyX + bodyW} y2={bodyY + bodyH + 18} label={mm(dims.width)} />
        <DimensionLine x1={bodyX - 18} y1={bodyY} x2={bodyX - 18} y2={bodyY + bodyH} label={mm(dims.height)} vertical />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista frontal esquemática">
      <defs>
        <pattern id={`grain-front-${itemCode}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 8 C4 2, 8 14, 12 6" fill="none" stroke="#d4a373" strokeWidth="0.8" opacity="0.55" />
        </pattern>
      </defs>
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={`url(#grain-front-${itemCode})`} opacity="0.5" />
      {upperOpenCubbies && doorCount > 0 && (
        <>
          <line x1={bodyX} y1={splitY} x2={bodyX + bodyW} y2={splitY} stroke="#92400e" strokeWidth="1.4" opacity="0.9" />
          {Array.from({ length: doorCols - 1 }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * (i + 1);
            return <line key={`upper-bay-${i}`} x1={x} y1={bodyY} x2={x} y2={bodyY + bodyH} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />;
          })}
        </>
      )}
      {showInterior && doorCount > 1 && !upperOpenCubbies && (
        <>
          {Array.from({ length: doorCols - 1 }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * (i + 1);
            return <line key={`bay-${i}`} x1={x} y1={lowerY} x2={x} y2={lowerBottom} stroke="#92400e" strokeWidth="1" opacity="0.45" strokeDasharray="4 3" />;
          })}
        </>
      )}
      {showInterior && hasInterior && shelves > 0 && !upperOpenCubbies && (
        <line x1={shelfX} y1={lowerY} x2={shelfX} y2={lowerBottom} stroke="#92400e" strokeWidth="1.2" opacity="0.75" />
      )}
      {showInterior && hasHanger && (
        <g>
          <line x1={bodyX + 12} y1={lowerY + 28} x2={bodyX + closetW - 12} y2={lowerY + 28} stroke="#334155" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${bodyX + 26} ${lowerY + 28} q10 8 20 0 M${bodyX + 58} ${lowerY + 28} q10 8 20 0`} fill="none" stroke="#64748b" strokeWidth="1" opacity="0.8" />
        </g>
      )}
      {showInterior && shelves > 0 && !upperOpenCubbies && (
        <>
          {Array.from({ length: Math.min(shelves, 4) }).map((_, i) => {
            const y = lowerY + lowerH * ((i + 1) / (Math.min(shelves, 4) + 1));
            const x1 = hasInterior && hasHanger ? shelfX + 4 : bodyX + 4;
            return <line key={`shelf-${i}`} x1={x1} y1={y} x2={bodyX + bodyW - 4} y2={y} stroke="#92400e" strokeWidth="1" opacity="0.7" />;
          })}
        </>
      )}
      {drawerCount > 0 && (
        <>
          {stackedDrawers
            ? Array.from({ length: drawerCount }).map((_, i) => {
                const gap = 5;
                const rowH = (bodyH - gap * (drawerCount + 1)) / drawerCount;
                const y = bodyY + gap + i * (rowH + gap);
                return (
                  <g key={`drawer-row-${i}`}>
                    <rect x={bodyX + 5} y={y} width={bodyW - 10} height={rowH} fill="#fed7aa" stroke="#92400e" strokeWidth="1.2" />
                    <line x1={bodyX + 18} y1={y + rowH * 0.28} x2={bodyX + bodyW - 18} y2={y + rowH * 0.28} stroke="#f3c28c" strokeWidth="0.8" opacity="0.75" />
                    <circle cx={bodyX + bodyW / 2} cy={y + rowH / 2} r="1.8" fill="#92400e" />
                    {hasLock && (
                      <g>
                        <circle cx={bodyX + bodyW - 18} cy={y + rowH / 2} r="3.2" fill="#f8fafc" stroke="#334155" strokeWidth="1" />
                        <rect x={bodyX + bodyW - 19} y={y + rowH / 2 + 2.4} width="2" height="4" rx="0.7" fill="#334155" />
                      </g>
                    )}
                  </g>
                );
              })
            : Array.from({ length: drawerCols }).map((_, i) => {
                const x = bodyX + (bodyW / drawerCols) * i;
                const w = bodyW / drawerCols;
                return (
                  <g key={`drawer-${i}`}>
                    <rect x={x + 3} y={drawerY + 5} width={w - 6} height={drawerAreaH - 10} fill="#fed7aa" stroke="#92400e" strokeWidth="1" />
                    <circle cx={x + w / 2} cy={drawerY + drawerAreaH / 2} r="1.7" fill="#92400e" />
                    {hasLock && (
                      <g>
                        <circle cx={x + w - 12} cy={drawerY + drawerAreaH / 2} r="2.8" fill="#f8fafc" stroke="#334155" strokeWidth="0.9" />
                        <rect x={x + w - 13} y={drawerY + drawerAreaH / 2 + 2} width="2" height="3.5" rx="0.6" fill="#334155" />
                      </g>
                    )}
                  </g>
                );
              })}
          {!stackedDrawers && hasSeparatedDrawers && drawersOnBottom && (
            <line x1={bodyX} y1={drawerY} x2={bodyX + bodyW} y2={drawerY} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />
          )}
          {!stackedDrawers && hasSeparatedDrawers && !drawersOnBottom && (
            <line x1={bodyX} y1={drawerY + drawerAreaH} x2={bodyX + bodyW} y2={drawerY + drawerAreaH} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />
          )}
        </>
      )}
      {showDoorLeaves && !upperOpenCubbies && (
        <>
          {Array.from({ length: doorCols - 1 }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * (i + 1);
            return <line key={`door-sep-${i}`} x1={x} y1={lowerY} x2={x} y2={lowerBottom} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />;
          })}
          {Array.from({ length: doorCols }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * i;
            const knobX = x + (bodyW / doorCols) - 9;
            return <circle key={`door-knob-${i}`} cx={knobX} cy={lowerY + lowerH / 2} r="1.7" fill="#92400e" />;
          })}
        </>
      )}
      {doorCount === 0 && drawerCount === 0 && (
        <line x1={bodyX + bodyW / 2} y1={bodyY} x2={bodyX + bodyW / 2} y2={bodyY + bodyH} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />
      )}
      {upperOpenCubbies && doorCount > 0 && (
        <>
          {Array.from({ length: doorCols }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * i;
            const w = bodyW / doorCols;
            const knobX = x + w - 9;
            return (
              <g key={`lower-door-${i}`}>
                <rect x={x + 1} y={splitY} width={w - 2} height={bodyY + bodyH - splitY} fill="#fff7ed" stroke="#92400e" strokeWidth="1" opacity="0.75" />
                <circle cx={knobX} cy={splitY + (bodyY + bodyH - splitY) / 2} r="1.7" fill="#92400e" />
              </g>
            );
          })}
        </>
      )}
      {hasWheels && (
        <g>
          {[bodyX + 16, bodyX + bodyW - 16].map((cx) => (
            <g key={cx}>
              <line x1={cx} y1={bodyY + bodyH} x2={cx} y2={bodyY + bodyH + 8} stroke="#475569" strokeWidth="1.5" />
              <circle cx={cx} cy={bodyY + bodyH + 13} r="5" fill="#334155" />
              <circle cx={cx} cy={bodyY + bodyH + 13} r="2" fill="#94a3b8" />
            </g>
          ))}
        </g>
      )}
      <DimensionLine x1={bodyX} y1={160} x2={bodyX + bodyW} y2={160} label={mm(dims.width)} />
      <DimensionLine x1={22} y1={bodyY} x2={22} y2={bodyY + bodyH} label={mm(dims.height)} vertical />
    </svg>
  );
}

function SideView({
  dims,
  shelves,
  hasHanger,
  hasWheels,
  upperOpenCubbies,
  headboardShelf,
}: {
  dims: ReturnType<typeof inferOverallDimensions>;
  shelves: number;
  hasHanger: boolean;
  hasWheels: boolean;
  upperOpenCubbies: boolean;
  headboardShelf: boolean;
}) {
  const shelfLines = upperOpenCubbies ? 1 : Math.min(shelves, 3);
  if (headboardShelf) {
    return (
      <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista lateral de respaldo con estante abierto">
        <path d="M72 30 L88 44 L88 148 L72 134 Z" fill="#fed7aa" stroke="#92400e" strokeWidth="1.4" />
        <path d="M148 20 L166 34 L166 138 L148 124 Z" fill="#fed7aa" stroke="#92400e" strokeWidth="1.4" />
        <line x1="88" y1="91" x2="148" y2="77" stroke="#92400e" strokeWidth="2" />
        <line x1="72" y1="82" x2="88" y2="91" stroke="#92400e" strokeWidth="1.2" opacity="0.75" />
        <line x1="148" y1="77" x2="166" y2="86" stroke="#92400e" strokeWidth="1.2" opacity="0.75" />
        <line x1="88" y1="44" x2="148" y2="30" stroke="#92400e" strokeWidth="1" opacity="0.55" />
        <line x1="88" y1="148" x2="148" y2="124" stroke="#92400e" strokeWidth="1" opacity="0.55" />
        <DimensionLine x1={72} y1={160} x2={166} y2={160} label={mm(dims.depth)} />
        <DimensionLine x1={54} y1={30} x2={54} y2={134} label={mm(dims.height)} vertical />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista lateral esquemática">
      <rect x="62" y="20" width="96" height="118" rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <path d="M158 20 L180 36 L180 154 L158 138 Z" fill="#fed7aa" stroke="#92400e" strokeWidth="1.4" />
      <path d="M62 20 L84 36 L180 36 M62 138 L84 154 L180 154" fill="none" stroke="#92400e" strokeWidth="1" opacity="0.7" />
      {Array.from({ length: shelfLines }).map((_, i) => {
        const y = upperOpenCubbies ? 79 : 52 + i * 28;
        return <line key={i} x1="66" y1={y} x2="155" y2={y} stroke="#92400e" strokeWidth="1" opacity="0.6" />;
      })}
      {hasHanger && <line x1="72" y1="48" x2="150" y2="48" stroke="#334155" strokeWidth="2" strokeLinecap="round" />}
      {hasWheels && (
        <g>
          {[
            [74, 148],
            [146, 148],
            [94, 160],
            [166, 160],
          ].map(([cx, cy], index) => (
            <g key={`${cx}-${cy}`} opacity={index > 1 ? 0.72 : 1}>
              <line x1={cx} y1={index > 1 ? 154 : 138} x2={cx} y2={cy - 5} stroke="#475569" strokeWidth="1.5" />
              <circle cx={cx} cy={cy} r="5" fill="#334155" />
              <circle cx={cx} cy={cy} r="2" fill="#94a3b8" />
            </g>
          ))}
        </g>
      )}
      <DimensionLine x1={62} y1={160} x2={180} y2={160} label={mm(dims.depth)} />
      <DimensionLine x1={46} y1={20} x2={46} y2={138} label={mm(dims.height)} vertical />
    </svg>
  );
}

function TopView({ dims, columns, headboardShelf }: { dims: ReturnType<typeof inferOverallDimensions>; columns: number; headboardShelf: boolean }) {
  const safeColumns = Math.max(1, columns);
  if (headboardShelf) {
    return (
      <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista superior de respaldo con laterales abiertos">
        <rect x="38" y="48" width="152" height="84" rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
        <rect x="42" y="52" width="148" height="12" fill="#fed7aa" stroke="#92400e" strokeWidth="1.1" />
        <rect x="42" y="116" width="148" height="12" fill="#fed7aa" stroke="#92400e" strokeWidth="1.1" />
        <rect x="46" y="70" width="136" height="40" fill="#fed7aa" stroke="#92400e" strokeWidth="1" opacity="0.45" />
        <line x1="38" y1="48" x2="38" y2="132" stroke="#f8fafc" strokeWidth="5" opacity="0.9" />
        <line x1="190" y1="48" x2="190" y2="132" stroke="#f8fafc" strokeWidth="5" opacity="0.9" />
        <DimensionLine x1={38} y1={154} x2={190} y2={154} label={mm(dims.width)} />
        <DimensionLine x1={22} y1={48} x2={22} y2={132} label={mm(dims.depth)} vertical />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista superior esquemática">
      <rect x="38" y="44" width="152" height="84" rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <rect x="48" y="54" width="132" height="64" fill="#fed7aa" stroke="#92400e" strokeWidth="1" opacity="0.55" />
      {Array.from({ length: safeColumns - 1 }).map((_, i) => {
        const x = 38 + 152 * ((i + 1) / safeColumns);
        return <line key={i} x1={x} y1="44" x2={x} y2="128" stroke="#92400e" strokeWidth="1" opacity="0.65" />;
      })}
      <DimensionLine x1={38} y1={150} x2={190} y2={150} label={mm(dims.width)} />
      <DimensionLine x1={22} y1={44} x2={22} y2={128} label={mm(dims.depth)} vertical />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Field editor (color / material / thickness / quantity)
// ---------------------------------------------------------------------------

function ItemFields({
  item,
  sessionId,
}: {
  item: QuotationItem;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateItem,
    onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s),
  });

  const [color, setColor] = useState(item.color);
  const [material, setMaterial] = useState(item.material);
  const [thickness, setThickness] = useState(String(item.thickness_mm));
  const [quantity, setQuantity] = useState(String(item.quantity));

  // Resync on incoming data (e.g. after server-side recalc).
  useEffect(() => {
    setColor(item.color);
    setMaterial(item.material);
    setThickness(String(item.thickness_mm));
    setQuantity(String(item.quantity));
  }, [item.color, item.material, item.thickness_mm, item.quantity]);

  function commit(field: string, raw: unknown) {
    mutation.mutate({
      sessionId,
      itemCode: item.code,
      fields: { [field]: raw } as Parameters<typeof updateItem>[0]["fields"],
    });
  }

  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Configuración
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`qty-${item.code}`}>Cantidad</Label>
          <Input
            id={`qty-${item.code}`}
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => {
              const n = parseInt(quantity, 10);
              if (Number.isFinite(n) && n !== item.quantity)
                commit("quantity", n);
            }}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`color-${item.code}`}>Color</Label>
          <Input
            id={`color-${item.code}`}
            value={color}
            onChange={(e) => setColor(e.target.value)}
            onBlur={() => color !== item.color && commit("color", color)}
            placeholder="usa el default"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`mat-${item.code}`}>Material</Label>
          <Input
            id={`mat-${item.code}`}
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            onBlur={() =>
              material !== item.material && commit("material", material)
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`thick-${item.code}`}>Grosor (mm)</Label>
          <Input
            id={`thick-${item.code}`}
            type="number"
            min={0}
            step="0.5"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            onBlur={() => {
              const n = Number(thickness);
              if (Number.isFinite(n) && n !== item.thickness_mm)
                commit("thickness_mm", n);
            }}
            className="tabular-nums"
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pieces table
// ---------------------------------------------------------------------------

function PiecesTable({
  item,
  sessionId,
}: {
  item: QuotationItem;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setPieceQuantity,
    onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s),
  });

  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Piezas ({item.pieces.length} líneas /{" "}
        {item.pieces.reduce((s, p) => s + p.quantity, 0)} totales)
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead className="text-right">Ancho</TableHead>
            <TableHead className="text-right">Alto</TableHead>
            <TableHead className="w-24 text-right">Cant.</TableHead>
            <TableHead>Cantos</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {item.pieces.map((p, i) => (
            <PieceRow
              key={`${p.label}-${i}`}
              piece={p}
              onUpdate={(qty) =>
                mutation.mutate({
                  sessionId,
                  itemCode: item.code,
                  pieceLabel: p.label,
                  quantity: qty,
                })
              }
              isPending={mutation.isPending}
            />
          ))}
          {item.pieces.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-xs text-muted-foreground"
              >
                Sin piezas
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function PieceRow({
  piece,
  onUpdate,
  isPending,
}: {
  piece: QuotationItem["pieces"][number];
  onUpdate: (qty: number) => void;
  isPending: boolean;
}) {
  const [qty, setQty] = useState(String(piece.quantity));
  useEffect(() => setQty(String(piece.quantity)), [piece.quantity]);

  return (
    <TableRow>
      <TableCell className="font-medium">{piece.label}</TableCell>
      <TableCell className="text-right tabular-nums">
        {piece.width_mm}mm
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {piece.height_mm}mm
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            const n = parseInt(qty, 10);
            if (Number.isFinite(n) && n !== piece.quantity) onUpdate(n);
          }}
          className="h-8 text-right tabular-nums"
          disabled={isPending}
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {(piece.edge_sides ?? []).join(", ") || "—"}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onUpdate(0)}
          disabled={isPending}
          title="Eliminar pieza"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Hardware table
// ---------------------------------------------------------------------------

function HardwareTable({
  item,
  sessionId,
}: {
  item: QuotationItem;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setItemHardwareQuantity,
    onSuccess: (s) => queryClient.setQueryData(qk.session(sessionId), s),
  });
  const catalog = useQuery({
    queryKey: qk.hardwareCatalog,
    queryFn: listHardwareCatalog,
  });
  const [adding, setAdding] = useState<string>("");

  const hwLines = (item.last_quote?.hardware_lines ?? []) as Array<{
    code: string;
    unit_price?: number;
    subtotal?: number;
    quantity?: number;
  }>;
  const priceByCode = new Map(
    hwLines.map((l) => [l.code, l.unit_price ?? 0]),
  );

  const presentCodes = new Set(item.hardware.map((h) => h.code));
  const availableToAdd =
    catalog.data?.filter((c) => !presentCodes.has(c.code)) ?? [];

  function handleAdd() {
    if (!adding) return;
    mutation.mutate({
      sessionId,
      itemCode: item.code,
      hardwareCode: adding,
      quantity: 1,
    });
    setAdding("");
  }

  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Herrajes ({item.hardware.length})
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead className="w-24 text-right">Cant.</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">Subtotal</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {item.hardware.map((h) => (
            <HardwareRow
              key={h.code}
              row={h}
              unitPrice={priceByCode.get(h.code) ?? 0}
              onUpdate={(qty) =>
                mutation.mutate({
                  sessionId,
                  itemCode: item.code,
                  hardwareCode: h.code,
                  quantity: qty,
                })
              }
              isPending={mutation.isPending}
            />
          ))}
          {item.hardware.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-xs text-muted-foreground"
              >
                Sin herrajes
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 mt-2">
        <Select value={adding} onValueChange={(v) => setAdding(v ?? "")}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Agregar herraje…" />
          </SelectTrigger>
          <SelectContent>
            {availableToAdd.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="font-mono text-xs mr-2">{c.code}</span>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          onClick={handleAdd}
          disabled={!adding || mutation.isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          Agregar
        </Button>
      </div>
    </section>
  );
}

function HardwareRow({
  row,
  unitPrice,
  onUpdate,
  isPending,
}: {
  row: QuotationItem["hardware"][number];
  unitPrice: number;
  onUpdate: (qty: number) => void;
  isPending: boolean;
}) {
  const [qty, setQty] = useState(String(row.quantity));
  useEffect(() => setQty(String(row.quantity)), [row.quantity]);

  const subtotal = unitPrice * row.quantity;
  const noPrice = unitPrice <= 0;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.code}</TableCell>
      <TableCell className="text-sm">{row.name}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            const n = parseInt(qty, 10);
            if (Number.isFinite(n) && n !== row.quantity) onUpdate(n);
          }}
          className="h-8 text-right tabular-nums"
          disabled={isPending}
        />
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${noPrice ? "text-amber-700" : ""}`}
      >
        {noPrice ? "—" : `UYU ${fmtUYU(unitPrice)}`}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {noPrice ? "—" : `UYU ${fmtUYU(subtotal)}`}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onUpdate(0)}
          disabled={isPending}
          title="Sacar herraje"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Breakdown of computed lines
// ---------------------------------------------------------------------------

interface QuoteLine {
  concept: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  subtotal?: number;
}

function BreakdownTable({ item }: { item: QuotationItem }) {
  const lines = (item.last_quote?.lines ?? []) as QuoteLine[];
  if (lines.length === 0 && !item.last_quote?.notes) return null;
  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Cálculo
      </div>
      {item.last_quote?.notes && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2 whitespace-pre-wrap">
          {item.last_quote.notes}
        </div>
      )}
      {lines.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs text-muted-foreground">
                  {l.concept}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  UYU {fmtUYU(l.subtotal ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delete item (with confirmation dialog)
// ---------------------------------------------------------------------------

function DeleteItemRow({
  item,
  sessionId,
}: {
  item: QuotationItem;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: (s) => {
      queryClient.setQueryData(qk.session(sessionId), s);
      setOpen(false);
    },
  });
  return (
    <div className="pt-2 border-t">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 className="h-4 w-4 mr-1" />
              Eliminar item
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar {item.code}</DialogTitle>
            <DialogDescription>
              Vas a sacar &laquo;{item.name}&raquo; de la cotización. No se
              puede deshacer (subiendo el pliego de nuevo lo recreás).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate({ sessionId, itemCode: item.code })}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Eliminando…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
