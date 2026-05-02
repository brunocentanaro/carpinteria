"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";

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
}

export function ItemCard({ item, sessionId }: ItemCardProps) {
  const [open, setOpen] = useState(false);

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
