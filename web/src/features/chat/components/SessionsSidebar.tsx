"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Folder, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { createSession, listSessionArchive, listSessions, patchSession, qk } from "../api";
import type { SessionRow } from "../schemas";
import { MemoryPanel } from "./MemoryPanel";

interface SessionsSidebarProps {
  activeId: string | null;
  onSelect: (id: string) => void;
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Setiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1] ?? `Mes ${month}`} ${year}`;
}

function formatMoney(value: number | null | undefined) {
  if (!value || value <= 0) return "";
  return `UYU ${value.toLocaleString("es-UY")}`;
}

function depositSummary(s: SessionRow) {
  if (!s.deposit_amount) return "";
  const deposit = formatMoney(s.deposit_amount);
  const total = formatMoney(s.total);
  const pct = s.total > 0 ? ` (${Math.round((s.deposit_amount / s.total) * 100)}%)` : "";
  return total ? `Seña ${deposit} / ${total}${pct}` : `Seña ${deposit}`;
}

function sessionLabel(s: SessionRow) {
  return s.factory_order && s.order_number ? `Orden ${s.order_number}` : s.title || s.folder;
}

function compactAge(value: string | null | undefined) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mes`;
  return `${Math.floor(days / 365)} a`;
}

function orderAge(s: SessionRow) {
  if (!s.order_number || !s.order_created_at) return "";
  return compactAge(s.order_created_at);
}

export function SessionsSidebar({ activeId, onSelect }: SessionsSidebarProps) {
  const queryClient = useQueryClient();
  const { brandId } = useBrandEnvironment();
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [orderDrafts, setOrderDrafts] = useState<Record<string, string>>({});
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const auth = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return (await res.json()).session as { area: string; user: string } | null;
    },
  });
  const isAdmin = auth.data?.area === "administracion";

  const sessions = useQuery({
    queryKey: qk.sessions(brandId),
    queryFn: () => listSessions(brandId),
  });
  const archive = useQuery({
    queryKey: qk.sessionArchive(2026, brandId),
    queryFn: () => listSessionArchive(2026, brandId),
  });
  const archiveMonths = (archive.data ?? []).filter(
    (m) => m.year !== currentYear || m.month !== currentMonth,
  );

  const createMutation = useMutation({
    mutationFn: () => createSession({ brandId }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: qk.sessions(brandId) });
      queryClient.invalidateQueries({ queryKey: qk.sessionArchive(2026, brandId) });
      onSelect(s.id);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Parameters<typeof patchSession>[1] }) =>
      patchSession(id, fields),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: qk.sessions(brandId) });
      queryClient.invalidateQueries({ queryKey: qk.sessionArchive(2026, brandId) });
      queryClient.setQueryData(qk.session(s.id), s);
    },
  });

  function currentStep(s: SessionRow) {
    if (s.delivered && s.final_payment_amount) return "Cobrada";
    if (s.delivered) return "Cobro final";
    if (s.ready_to_deliver) return "Entrega";
    if (s.client_accepted === "yes" && s.deposit_amount && !s.order_number) return "Nro. de orden";
    if (s.client_accepted === "yes" && s.deposit_amount) return "Produccion";
    if (s.client_accepted === "yes") return "Seña";
    if (s.client_accepted === "no") return "No aceptada";
    if (s.client_sent) return "Respuesta cliente";
    if (s.approval_status === "approved") return "Envio al cliente";
    return "Aprobacion interna";
  }

  function progressDots(s: SessionRow) {
    const steps = [
      true,
      s.approval_status === "approved",
      s.client_sent,
      s.client_accepted === "yes",
      s.client_accepted === "yes" && !!s.deposit_amount,
      s.client_accepted === "yes" && !!s.deposit_amount && !!s.order_number,
      s.ready_to_deliver,
      s.delivered,
      s.delivered && !!s.final_payment_amount,
    ];
    return (
      <div className="flex items-center gap-1" title={currentStep(s)}>
        {steps.map((done, index) => (
          <span
            key={index}
            className={`h-1.5 w-1.5 rounded-full ${
              done ? "bg-primary" : "bg-muted-foreground/25"
            }`}
          />
        ))}
      </div>
    );
  }

  function amountDraft(id: string, field: "deposit_amount" | "final_payment_amount", fallback: number | null) {
    const key = `${id}:${field}`;
    return amountDrafts[key] ?? (fallback ? String(fallback) : "");
  }

  function setAmountDraft(id: string, field: "deposit_amount" | "final_payment_amount", value: string) {
    const key = `${id}:${field}`;
    setAmountDrafts((prev) => ({ ...prev, [key]: value }));
  }

  function saveAmount(id: string, field: "deposit_amount" | "final_payment_amount", value: string) {
    const parsed = value.trim() ? Number(value) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    statusMutation.mutate({ id, fields: { [field]: parsed } });
  }

  function orderDraft(s: SessionRow) {
    return orderDrafts[s.id] ?? s.order_number ?? "";
  }

  function saveOrderNumber(s: SessionRow) {
    const value = orderDraft(s).trim();
    if (!value) return;
    statusMutation.mutate({ id: s.id, fields: { order_number: value } });
  }

  function adminControls(s: SessionRow) {
    const deposit = amountDraft(s.id, "deposit_amount", s.deposit_amount);
    const finalPayment = amountDraft(s.id, "final_payment_amount", s.final_payment_amount);
    const baseButton = "rounded border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted";
    const primaryButton = "rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground";
    const dangerButton = "rounded border border-red-200 px-2 py-1 text-[10px] text-red-700 hover:bg-red-50";

    let control: React.ReactNode = null;
    if (s.approval_status !== "approved") {
      control = (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({ id: s.id, fields: { approval_status: "approved" } });
            }}
            className={primaryButton}
          >
            Aprobar
          </button>
        </div>
      );
    } else if (!s.client_sent) {
      control = (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({ id: s.id, fields: { client_sent: true } });
            }}
            className={primaryButton}
          >
            Marcar enviada
          </button>
        </div>
      );
    } else if (s.client_accepted === "pending") {
      control = (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({
                id: s.id,
                fields: {
                  client_accepted: "no",
                  deposit_amount: null,
                  ready_to_deliver: false,
                  delivered: false,
                  final_payment_amount: null,
                  order_number: "",
                },
              });
            }}
            className={dangerButton}
          >
            No
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({ id: s.id, fields: { client_accepted: "yes" } });
            }}
            className={primaryButton}
          >
            Si
          </button>
        </div>
      );
    } else if (s.client_accepted === "no") {
      control = (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            statusMutation.mutate({ id: s.id, fields: { client_accepted: "pending" } });
          }}
          className={baseButton}
        >
          Reabrir
        </button>
      );
    } else if (!s.deposit_amount) {
      control = (
        <div className="flex items-center gap-1">
          <input
            value={deposit}
            onChange={(e) => setAmountDraft(s.id, "deposit_amount", e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
            inputMode="decimal"
            placeholder="Seña"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              saveAmount(s.id, "deposit_amount", deposit);
            }}
            className={primaryButton}
          >
            OK
          </button>
        </div>
      );
    } else if (!s.order_number) {
      const value = orderDraft(s);
      control = (
        <div className="flex items-center gap-1">
          <input
            value={value}
            onChange={(e) => setOrderDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
            placeholder="Nro. de orden"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              saveOrderNumber(s);
            }}
            className={primaryButton}
          >
            OK
          </button>
        </div>
      );
    } else if (!s.ready_to_deliver) {
      control = (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            statusMutation.mutate({ id: s.id, fields: { ready_to_deliver: true } });
          }}
          className={primaryButton}
        >
          Listo para entregar
        </button>
      );
    } else if (!s.delivered) {
      control = (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            statusMutation.mutate({ id: s.id, fields: { delivered: true } });
          }}
          className={primaryButton}
        >
          Marcar entregada
        </button>
      );
    } else if (!s.final_payment_amount) {
      control = (
        <div className="flex items-center gap-1">
          <input
            value={finalPayment}
            onChange={(e) => setAmountDraft(s.id, "final_payment_amount", e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
            inputMode="decimal"
            placeholder={s.total > 0 ? String(s.total) : "Cobro final"}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              saveAmount(s.id, "final_payment_amount", finalPayment);
            }}
            className={primaryButton}
          >
            OK
          </button>
        </div>
      );
    }

    return (
      <div className="mt-2 rounded border bg-background/60 p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            Paso actual: {currentStep(s)}
          </span>
          {progressDots(s)}
        </div>
        {depositSummary(s) && (
          <div className="mb-1.5 truncate text-[10px] text-muted-foreground">
            {depositSummary(s)}
          </div>
        )}
        {s.order_number && (
          <div className="mb-1.5 truncate text-[10px] text-muted-foreground">
            Orden {s.order_number}{orderAge(s) ? ` · ${orderAge(s)}` : ""}
          </div>
        )}
        {control}
      </div>
    );
  }

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-3 border-b">
        <Button
          className="w-full"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          {brandId === "pirone" ? "Nueva orden" : isAdmin ? "Nueva cotizacion" : "Solicitar cotizacion"}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
          {monthLabel(currentYear, currentMonth)}
        </div>
        <ul className="space-y-1">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <div
                className={`w-full px-2 py-1.5 rounded text-sm transition-colors ${
                  activeId === s.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                <button onClick={() => onSelect(s.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{sessionLabel(s)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {s.factory_order ? `Pedido: ${s.title || s.requested_by}` : isAdmin ? `Solicita: ${s.requested_by}` : s.total > 0 ? `Importe: ${formatMoney(s.total)}` : "Importe pendiente"}
                  </div>
                  {orderAge(s) && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {orderAge(s)}
                    </div>
                  )}
                  {!isAdmin && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {depositSummary(s) || currentStep(s)}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(s.updated_at), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </div>
                </button>
                {isAdmin && adminControls(s)}
              </div>
            </li>
          ))}
        </ul>
        {sessions.data?.length === 0 && (
          <div className="rounded border border-dashed px-2 py-3 text-xs text-muted-foreground">
            Sin cotizaciones este mes.
          </div>
        )}

        <div className="mt-5 text-xs uppercase font-semibold text-muted-foreground mb-2">
          Archivo 2026
        </div>
        <div className="space-y-2">
          {archiveMonths.map((m) => (
            <details key={m.folder} className="rounded border bg-background/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-sm">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{monthLabel(m.year, m.month)}</span>
                <span className="text-[10px] text-muted-foreground">{m.count}</span>
              </summary>
              <ul className="border-t p-1 space-y-1">
                {m.sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => onSelect(s.id)}
                      className={`w-full rounded px-2 py-1 text-left text-xs transition-colors ${
                        activeId === s.id
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="truncate">{sessionLabel(s)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.folder}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {archiveMonths.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Todavia no hay meses archivados.
            </div>
          )}
        </div>
      </div>
      <div className="border-t p-3 max-h-[40%] overflow-y-auto">
        <MemoryPanel />
      </div>
    </aside>
  );
}
