"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  HardwarePriceSchema,
  type HardwarePriceValues,
  type QuotationItem,
  type Session,
} from "../schemas";
import { ItemCard } from "./ItemCard";
import {
  listBoards,
  patchSession,
  qk,
  setHardwarePrice,
  setItemPlaca,
} from "../api";

// ---------------------------------------------------------------------------
// Currency formatting (uy-style: "1.234,56")
// ---------------------------------------------------------------------------

function fmtUYU(n: number): string {
  return n.toLocaleString("es-UY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

export function QuotationPanel({ session }: { session: Session | null }) {
  if (!session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Cargando cotización…
      </div>
    );
  }
  const grand = session.items.reduce(
    (s, it) => s + (it.last_quote?.total_with_hardware ?? 0) * it.quantity,
    0,
  );
  return (
    <div className="p-5 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cotización</h2>
        <span className="font-mono text-[10px] text-muted-foreground break-all">
          {session.id}
        </span>
      </header>

      <GlobalsPanel session={session} />
      <PendingPanel session={session} />
      <ItemsList items={session.items} sessionId={session.id} />
      <Footer grand={grand} session={session} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Globals (editable color / payment / destination)
// ---------------------------------------------------------------------------

function GlobalsPanel({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof patchSession>[1]) =>
      patchSession(session.id, payload),
    onSuccess: (newSession) => {
      queryClient.setQueryData(qk.session(session.id), newSession);
    },
  });

  // Track local input state so we only PATCH on blur (avoids per-keystroke
  // round-trips to a 1-2s subprocess).
  const [color, setColor] = useState(session.color_default);
  const [payment, setPayment] = useState(
    session.payment_days != null ? String(session.payment_days) : "",
  );
  const [destination, setDestination] = useState(session.destination);

  useEffect(() => {
    setColor(session.color_default);
    setPayment(session.payment_days != null ? String(session.payment_days) : "");
    setDestination(session.destination);
  }, [
    session.id,
    session.color_default,
    session.payment_days,
    session.destination,
  ]);

  const colorOptions = session.general_specs?.colors ?? [];

  function commitColor() {
    if (color !== session.color_default) mutation.mutate({ color_default: color });
  }
  function commitPayment() {
    const n = payment.trim() === "" ? null : Number(payment);
    if (n !== session.payment_days) mutation.mutate({ payment_days: n });
  }
  function commitDestination() {
    if (destination !== session.destination)
      mutation.mutate({ destination });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-xs uppercase text-muted-foreground">
          Globales
        </CardTitle>
        {mutation.isPending && (
          <span className="text-xs text-muted-foreground">guardando…</span>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="color">Color por defecto</Label>
            <Input
              id="color"
              list={`colors-${session.id}`}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onBlur={commitColor}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
              placeholder="—"
            />
            <datalist id={`colors-${session.id}`}>
              {colorOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment">Días de pago</Label>
            <Input
              id="payment"
              type="number"
              min={0}
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              onBlur={commitPayment}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
              placeholder="—"
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="destination">Destino</Label>
            <Input
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onBlur={commitDestination}
              onKeyDown={(e) =>
                e.key === "Enter" && (e.target as HTMLInputElement).blur()
              }
              placeholder="—"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pending (missing data that blocks a clean quote)
// ---------------------------------------------------------------------------

function PendingPanel({ session }: { session: Session }) {
  const missingHw = Array.from(
    new Set(
      session.items.flatMap((it) => it.last_quote?.pending_hardware_codes ?? []),
    ),
  );
  const itemsNoBoard = session.items.filter((it) => {
    const total = it.last_quote?.total_with_hardware ?? 0;
    const notes = it.last_quote?.notes ?? "";
    return total === 0 && notes.includes("No se encontró placa");
  });
  const noColor =
    !session.color_default && session.items.some((it) => !it.color);

  if (missingHw.length === 0 && itemsNoBoard.length === 0 && !noColor) {
    return null;
  }

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs uppercase text-amber-800">
          ⚠ Pendientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {noColor && (
          <p className="text-sm text-amber-900">
            No hay color por defecto y algunos items no tienen color propio.
            Setealo arriba en &laquo;Globales&raquo;.
          </p>
        )}
        {missingHw.length > 0 && (
          <MissingHardwarePrices codes={missingHw} sessionId={session.id} />
        )}
        {itemsNoBoard.length > 0 && (
          <ItemsBoardPicker items={itemsNoBoard} sessionId={session.id} />
        )}
      </CardContent>
    </Card>
  );
}

function MissingHardwarePrices({
  codes,
  sessionId,
}: {
  codes: string[];
  sessionId: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-amber-900 mb-2">
        Precios de herrajes faltantes ({codes.length})
      </div>
      <div className="space-y-1.5">
        {codes.map((code) => (
          <HardwarePriceRow key={code} code={code} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}

function HardwarePriceRow({
  code,
  sessionId,
}: {
  code: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<HardwarePriceValues>({
    resolver: zodResolver(HardwarePriceSchema),
    defaultValues: { code, price: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: HardwarePriceValues) => {
      await setHardwarePrice({ code: values.code, price: Number(values.price) });
      // Trigger a session-wide recalc so the new price reflects in totals.
      // Empty PATCH body — handler always recalculates.
      return patchSession(sessionId, {});
    },
    onSuccess: (newSession) => {
      queryClient.setQueryData(qk.session(sessionId), newSession);
      form.reset({ code, price: "" });
    },
  });

  return (
    <form
      className="flex items-center gap-2 text-sm"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <span className="font-mono text-xs flex-1 truncate" title={code}>
        {code}
      </span>
      <span className="text-xs text-amber-800">UYU</span>
      <Input
        type="number"
        min={0}
        step="0.01"
        placeholder="0.00"
        className="h-8 w-24 tabular-nums bg-white"
        disabled={mutation.isPending}
        {...form.register("price")}
      />
      <Button
        type="submit"
        size="sm"
        className="h-8 bg-amber-600 hover:bg-amber-700"
        disabled={mutation.isPending || !form.watch("price")?.trim()}
      >
        {mutation.isPending ? "…" : "Guardar"}
      </Button>
    </form>
  );
}

function ItemsBoardPicker({
  items,
  sessionId,
}: {
  items: QuotationItem[];
  sessionId: string;
}) {
  const boards = useQuery({ queryKey: qk.boards, queryFn: listBoards });
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setItemPlaca,
    onSuccess: (newSession) =>
      queryClient.setQueryData(qk.session(sessionId), newSession),
  });

  return (
    <div>
      <div className="text-sm font-semibold text-amber-900 mb-1">
        Items sin placa que coincida ({items.length})
      </div>
      <p className="text-xs text-amber-800 mb-2">
        El catálogo Activa no matcheó automáticamente. Elegí la placa adecuada
        (queda fija para ese item).
      </p>
      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.code}
            className="bg-white border border-amber-200 rounded p-2 space-y-1.5"
          >
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className="font-mono">{it.code}</span>
              <span className="text-foreground/80 truncate">{it.name}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              IA propuso: {it.material} {it.thickness_mm}mm
            </div>
            <Select
              value={it.placa_sku ?? ""}
              onValueChange={(sku) =>
                mutation.mutate({
                  sessionId,
                  itemCode: it.code,
                  placaSku: sku || null,
                })
              }
              disabled={mutation.isPending || boards.isLoading}
            >
              <SelectTrigger className="bg-white">
                <SelectValue
                  placeholder={
                    boards.isLoading ? "Cargando placas…" : "— Elegí una placa —"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {boards.data?.map((b) => (
                  <SelectItem key={b.sku} value={b.sku}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items (expandable cards — edit pieces, hardware, fields inline)
// ---------------------------------------------------------------------------

function ItemsList({
  items,
  sessionId,
}: {
  items: QuotationItem[];
  sessionId: string;
}) {
  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Items ({items.length})
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <ItemCard key={it.code} item={it} sessionId={sessionId} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer({ grand, session }: { grand: number; session: Session }) {
  const allOk =
    session.items.length > 0 &&
    session.items.every((it) => {
      const total = it.last_quote?.total_with_hardware ?? 0;
      const pending = it.last_quote?.pending_hardware_codes?.length ?? 0;
      return total > 0 && pending === 0;
    });
  const [busy, setBusy] = useState<"excel" | "docx" | null>(null);

  async function downloadExport(kind: "excel" | "docx") {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await fetch(`/api/sessions/${session.id}/export/${kind}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cotizacion-${session.id.slice(0, 8)}.${kind === "excel" ? "xlsx" : "docx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Separator />
      <section className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase font-semibold text-muted-foreground">
            Total estimado
          </div>
          <div className="text-2xl font-bold tabular-nums">
            UYU {fmtUYU(grand)}
          </div>
          {!allOk && session.items.length > 0 && (
            <div className="text-xs text-amber-700 mt-1">
              Resolvé los pendientes para exportar limpio.
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant={allOk ? "default" : "outline"}
            onClick={() => downloadExport("excel")}
            disabled={busy !== null || session.items.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            {busy === "excel" ? "Generando…" : "Excel"}
          </Button>
          <Button
            variant={allOk ? "default" : "outline"}
            onClick={() => downloadExport("docx")}
            disabled={busy !== null || session.items.length === 0}
          >
            <FileText className="h-4 w-4 mr-1" />
            {busy === "docx" ? "Generando…" : "Word"}
          </Button>
        </div>
      </section>
    </>
  );
}
