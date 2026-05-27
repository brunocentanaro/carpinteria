"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Ruler, Trash2, X } from "lucide-react";

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
            <DesignPreview item={item} />
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

function inferVisualModel(item: QuotationItem) {
  const text = normalizeText(`${item.name} ${item.description} ${item.notes}`);
  const labels = item.pieces.map((p) => ({ ...p, normalizedLabel: normalizeText(p.label) }));
  const doorCount =
    countFromText(text, ["puertas?"]) ||
    labels.filter((p) => p.normalizedLabel.includes("puerta")).reduce((sum, p) => sum + p.quantity, 0);
  const drawerFrontCount = labels
    .filter((p) => p.normalizedLabel.includes("caj") && p.normalizedLabel.includes("frente"))
    .reduce((sum, p) => sum + p.quantity, 0);
  const drawerBoxCount = labels
    .filter((p) => {
      const label = p.normalizedLabel;
      return label.includes("caj") && !label.includes("lateral") && !label.includes("fondo") && !label.includes("base") && !label.includes("costado");
    })
    .reduce((sum, p) => sum + p.quantity, 0);
  const drawerCount = countFromText(text, ["cajones?", "cajon"]) || drawerFrontCount || drawerBoxCount;
  const shelfCount =
    countFromText(text, ["estantes?"]) ||
    labels.filter((p) => p.normalizedLabel.includes("estante")).reduce((sum, p) => sum + p.quantity, 0);
  const drawerPosition: "top" | "bottom" = /cajones?.{0,24}abajo|abajo.{0,24}cajones?/.test(text) ? "bottom" : "top";
  return { doorCount, drawerCount, shelfCount, drawerPosition };
}

function DesignPreview({ item }: { item: QuotationItem }) {
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
        </div>
      </div>

      <div className="overflow-x-auto p-3">
        <div className="grid min-w-[860px] grid-cols-[520px_320px] gap-4">
          <div className="grid grid-cols-3 gap-2">
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">Frente</div>
            <FrontView itemCode={item.code} dims={dims} shelves={displayShelfCount} doorCount={displayDoorCount} drawerCount={displayDrawerCount} drawerPosition={visualModel.drawerPosition} />
          </div>
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">Costado</div>
            <SideView dims={dims} shelves={displayShelfCount} />
          </div>
          <div className="border rounded bg-slate-50 p-2">
            <div className="text-[11px] font-semibold text-center mb-1">Planta</div>
            <TopView dims={dims} />
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
    </section>
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
}: {
  itemCode: string;
  dims: ReturnType<typeof inferOverallDimensions>;
  shelves: number;
  doorCount: number;
  drawerCount: number;
  drawerPosition: "top" | "bottom";
}) {
  const bodyX = 38;
  const bodyY = 20;
  const bodyW = 152;
  const bodyH = 118;
  const hasDoorsAndDrawers = drawerCount > 0 && doorCount > 0;
  const drawerAreaH = hasDoorsAndDrawers ? 34 : bodyH;
  const drawersOnBottom = hasDoorsAndDrawers && drawerPosition === "bottom";
  const drawerY = drawersOnBottom ? bodyY + bodyH - drawerAreaH : bodyY;
  const lowerY = hasDoorsAndDrawers && !drawersOnBottom ? bodyY + drawerAreaH : bodyY;
  const lowerBottom = drawersOnBottom ? drawerY : bodyY + bodyH;
  const lowerH = lowerBottom - lowerY;
  const drawerCols = Math.max(1, drawerCount);
  const doorCols = Math.max(1, doorCount);

  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista frontal esquemática">
      <defs>
        <pattern id={`grain-front-${itemCode}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 8 C4 2, 8 14, 12 6" fill="none" stroke="#d4a373" strokeWidth="0.8" opacity="0.55" />
        </pattern>
      </defs>
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={`url(#grain-front-${itemCode})`} opacity="0.5" />
      {drawerCount > 0 && (
        <>
          {Array.from({ length: drawerCols }).map((_, i) => {
            const x = bodyX + (bodyW / drawerCols) * i;
            const w = bodyW / drawerCols;
            return (
              <g key={`drawer-${i}`}>
                <rect x={x + 3} y={drawerY + 5} width={w - 6} height={drawerAreaH - 10} fill="#fed7aa" stroke="#92400e" strokeWidth="1" />
                <circle cx={x + w / 2} cy={drawerY + drawerAreaH / 2} r="1.7" fill="#92400e" />
              </g>
            );
          })}
          {hasDoorsAndDrawers && drawersOnBottom && (
            <line x1={bodyX} y1={drawerY} x2={bodyX + bodyW} y2={drawerY} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />
          )}
          {hasDoorsAndDrawers && !drawersOnBottom && (
            <line x1={bodyX} y1={drawerY + drawerAreaH} x2={bodyX + bodyW} y2={drawerY + drawerAreaH} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />
          )}
        </>
      )}
      {doorCount > 0 && (
        <>
          {Array.from({ length: doorCols - 1 }).map((_, i) => {
            const x = bodyX + (bodyW / doorCols) * (i + 1);
            return <line key={`door-sep-${i}`} x1={x} y1={lowerY} x2={x} y2={bodyY + bodyH} stroke="#92400e" strokeWidth="1.2" opacity="0.85" />;
          })}
          {Array.from({ length: Math.min(shelves, 3) }).map((_, i) => {
            const y = lowerY + lowerH * ((i + 1) / (Math.min(shelves, 3) + 1));
            return <line key={`shelf-${i}`} x1={bodyX + 4} y1={y} x2={bodyX + bodyW - 4} y2={y} stroke="#92400e" strokeWidth="1" opacity="0.7" />;
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
      <DimensionLine x1={bodyX} y1={160} x2={bodyX + bodyW} y2={160} label={mm(dims.width)} />
      <DimensionLine x1={22} y1={bodyY} x2={22} y2={bodyY + bodyH} label={mm(dims.height)} vertical />
    </svg>
  );
}

function SideView({
  dims,
  shelves,
}: {
  dims: ReturnType<typeof inferOverallDimensions>;
  shelves: number;
}) {
  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista lateral esquemática">
      <rect x="62" y="20" width="96" height="118" rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <path d="M158 20 L180 36 L180 154 L158 138 Z" fill="#fed7aa" stroke="#92400e" strokeWidth="1.4" />
      <path d="M62 20 L84 36 L180 36 M62 138 L84 154 L180 154" fill="none" stroke="#92400e" strokeWidth="1" opacity="0.7" />
      {Array.from({ length: Math.min(shelves, 3) }).map((_, i) => {
        const y = 52 + i * 28;
        return <line key={i} x1="66" y1={y} x2="155" y2={y} stroke="#92400e" strokeWidth="1" opacity="0.6" />;
      })}
      <DimensionLine x1={62} y1={160} x2={180} y2={160} label={mm(dims.depth)} />
      <DimensionLine x1={46} y1={20} x2={46} y2={138} label={mm(dims.height)} vertical />
    </svg>
  );
}

function TopView({ dims }: { dims: ReturnType<typeof inferOverallDimensions> }) {
  return (
    <svg viewBox="0 0 220 190" className="w-full h-auto" role="img" aria-label="Vista superior esquemática">
      <rect x="38" y="44" width="152" height="84" rx="2" fill="#fff7ed" stroke="#92400e" strokeWidth="2" />
      <rect x="48" y="54" width="132" height="64" fill="#fed7aa" stroke="#92400e" strokeWidth="1" opacity="0.55" />
      <line x1="114" y1="44" x2="114" y2="128" stroke="#92400e" strokeWidth="1" opacity="0.65" />
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
