"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Check, FileSpreadsheet, FileText } from "lucide-react";

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
  type MolduraQuote,
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

function fmtDim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
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

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

export function QuotationPanel({ session }: { session: Session | null }) {
  if (!session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        La cotización aparece acá una vez que arranques la conversación.
        Subí un pliego o pedile algo al chat.
      </div>
    );
  }
  const itemsGrand = session.items.reduce(
    (s, it) => s + (it.last_quote?.total_with_hardware ?? 0) * it.quantity,
    0,
  );
  const moldurasGrand = (session.moldura_quotes ?? []).reduce(
    (s, quote) => s + quote.total,
    0,
  );
  const grand = itemsGrand + moldurasGrand;
  return (
    <div className="p-5 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cotización</h2>
        <span className="max-w-[220px] truncate font-mono text-[10px] text-muted-foreground">
          {session.id}
        </span>
      </header>

      <OrderProgress session={session} grand={grand} />
      {session.order_number && <FactoryOrderHeader session={session} grand={grand} />}
      <GlobalsPanel session={session} />
      <PendingPanel session={session} />
      <ItemsList items={session.items} sessionId={session.id} defaultOpen={!!session.order_number} />
      <MolduraQuotesPanel session={session} />
      <Footer grand={grand} session={session} />
    </div>
  );
}

function MolduraQuotesPanel({ session }: { session: Session }) {
  const quotes = session.moldura_quotes ?? [];
  if (quotes.length === 0) return null;

  const total = quotes.reduce((sum, q) => sum + q.total, 0);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="text-xs uppercase text-muted-foreground">
            Molduras cotizadas ({quotes.length})
          </CardTitle>
          <div className="mt-1 text-xl font-bold tabular-nums">UYU {fmtUYU(total)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {quotes.slice().reverse().map((quote, idx) => (
          <MolduraQuoteRow key={`${quote.created_at ?? ""}-${idx}`} quote={quote} />
        ))}
      </CardContent>
    </Card>
  );
}

function MolduraQuoteRow({ quote }: { quote: MolduraQuote }) {
  const unit = quote.unit === "metro" ? "m" : "varilla";
  const title = molduraProductTitle(quote);
  return (
    <div className="rounded border bg-background px-3 py-2 text-sm">
      <div className="flex items-start gap-3">
        <MolduraProfileSvg quote={quote} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {title}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {quote.description}
              </div>
            </div>
            <Badge variant={quote.estimated ? "secondary" : "outline"}>
              {quote.estimated ? "estimativo" : "listado"}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Cant.</span>{" "}
              <span className="font-medium">{quote.quantity} {unit}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Unit.</span>{" "}
              <span className="font-medium">UYU {fmtUYU(quote.unit_price)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total</span>{" "}
              <span className="font-medium">UYU {fmtUYU(quote.total)}</span>
            </div>
          </div>
          {quote.source && (
            <div className="mt-1 text-xs text-muted-foreground">
              Fuente: {quote.source}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function molduraProductTitle(quote: MolduraQuote) {
  const text = `${quote.code} ${quote.family} ${quote.description} ${quote.material}`.toLowerCase();
  const material = text.includes("impc")
    ? "PINO NACIONAL"
    : text.includes("imp") || text.includes("euca")
      ? "EUCALYPTUS"
      : text.includes("nac") || text.includes("pino")
        ? "PINO NACIONAL"
        : "";
  const model = `${quote.description}`.match(/n[°º]?\s*\.?\s*(\d+)/i)?.[1];
  if (text.includes("contravidrio")) {
    const no = model ? ` No. ${model}` : "";
    const mat = material ? ` ${material}` : "";
    return `CONTRAVIDRIO ${fmtDim(quote.width_mm)}x${fmtDim(quote.height_mm)}mm LA VARILLA 3.30mts${no}${mat}`;
  }
  if (text.includes("contramarco")) {
    const finger = text.includes("finger") ? ` Finger ${text.includes("n2") ? "N2" : "N1"}` : "";
    const length = finger ? "3.05mts" : "3.30mts";
    const mat = material ? ` ${material}` : "";
    return `CONTRAMARCO ${fmtDim(quote.width_mm)}x${fmtDim(quote.height_mm)}MM LA VARILLA ${length}${finger}${mat}`;
  }
  if (text.includes("media caña") || text.includes("media cana")) {
    const model = `${quote.description}`.match(/n[°º]?\s*\.?\s*([A-Za-z0-9-]+)/i)?.[1];
    const no = model ? ` No. ${model}` : "";
    const mat = material ? ` ${material}` : "";
    return `MEDIA CAÑA ${fmtDim(quote.width_mm)}x${fmtDim(quote.height_mm)}mm LA VARILLA 3.30mts${no}${mat}`;
  }
  if (text.includes("cuadro")) {
    const model = `${quote.description}`.match(/n[°º]?\s*\.?\s*([A-Za-z0-9-]+)/i)?.[1];
    const no = model ? ` No. ${model}` : "";
    const mat = material ? ` ${material}` : "";
    return `MOLDURA P/CUADRO${no} LA VARILLA 3.30mts${mat}`;
  }
  if (text.includes("montante")) {
    const mat = material ? ` ${material}` : "";
    return `MONTANTE ${fmtDim(quote.width_mm)}x${fmtDim(quote.height_mm)}MM LA VARILLA 3.30mts${mat}`;
  }
  return `${quote.family || "Moldura"} ${fmtDim(quote.width_mm)}x${fmtDim(quote.height_mm)} mm`;
}

function molduraProfileKind(quote: MolduraQuote) {
  const text = `${quote.family} ${quote.description}`.toLowerCase();
  if (text.includes("barrote")) return "barrote";
  if (text.includes("zocal")) return "zocalo";
  if (text.includes("contravidrio")) {
    const model = text.match(/n[°º]?\s*\.?\s*(\d+)/)?.[1];
    if (model && ["1", "2", "31", "113", "137", "180", "229", "299", "410", "411", "412"].includes(model)) {
      return `contravidrio-${model}`;
    }
    return "contravidrio";
  }
  if (text.includes("contramarco")) {
    const minor = Math.min(quote.width_mm, quote.height_mm);
    if (text.includes("finger") || minor === 7 || minor === 9) {
      return text.includes("n2") ? "contramarco-finger-n2" : "contramarco-finger-n1";
    }
    if (minor <= 6) return "contramarco-canal";
    return "contramarco-nariz";
  }
  if (text.includes("media cana")) {
    const model = text.match(/n[°º]?\s*\.?\s*([a-z0-9-]+)/)?.[1];
    if (model) {
      if (["17", "38", "39", "50", "101", "101-a", "101a", "z-4", "z-6", "7-6"].includes(model)) return "media-cana-alta";
      if (["28", "30", "32", "33", "34", "35", "36"].includes(model)) return "media-cana-larga";
      if (["113", "229", "48", "4"].includes(model)) return "media-cana-cuadrada";
    }
    if (Math.abs(quote.width_mm - quote.height_mm) < 1) return "media-cana-cuadrada";
    if (Math.max(quote.width_mm, quote.height_mm) / Math.max(Math.min(quote.width_mm, quote.height_mm), 1) > 2) return "media-cana-larga";
    return "media-cana";
  }
  if (text.includes("cuadro")) {
    const model = text.match(/n[°º]?\s*\.?\s*([a-z0-9-]+)/)?.[1];
    if (model && ["118", "131", "133", "203", "213-a", "213a", "224", "232", "234", "45", "53", "57", "60", "63", "95", "z-1"].includes(model)) {
      return `cuadro-${model.replace("-a", "a")}`;
    }
    return "cuadro";
  }
  if (text.includes("montante")) return "montante";
  if (text.includes("liston") || text.includes("tabla")) return "liston";
  return "moldura";
}

function MolduraProfileSvg({ quote }: { quote: MolduraQuote }) {
  const kind = molduraProfileKind(quote);
  const baseKind = kind.startsWith("contravidrio-") ? "contravidrio" : kind.startsWith("contramarco-") ? "contramarco" : kind;
  const widthLabel = `${fmtDim(quote.width_mm)} mm`;
  const heightLabel = `${fmtDim(quote.height_mm)} mm`;
  const listonW = baseKind === "liston" ? Math.max(22, Math.min(86, 86 * quote.width_mm / Math.max(quote.width_mm, quote.height_mm, 1))) : 58;
  const listonH = baseKind === "liston" ? Math.max(22, Math.min(66, 66 * quote.height_mm / Math.max(quote.width_mm, quote.height_mm, 1))) : 38;
  const listonX = 90 - listonW / 2;
  const listonY = 51 - listonH / 2;
  const label =
    kind === "barrote" ? `Ø ${fmtDim(Math.max(quote.width_mm, quote.height_mm))}` :
    `${fmtDim(quote.width_mm)} x ${fmtDim(quote.height_mm)}`;
  const hatch = (
    <pattern id={`hatch-${quote.code || quote.created_at || kind}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#9a4a14" strokeWidth="1" />
    </pattern>
  );
  const patternId = `url(#hatch-${quote.code || quote.created_at || kind})`;
  const common = { fill: patternId, stroke: "#9a4a14", strokeWidth: 2 };
  return (
    <svg className="h-24 w-28 shrink-0 rounded bg-slate-50" viewBox="0 0 150 116" role="img" aria-label={`Perfil ${kind}`}>
      <defs>{hatch}</defs>
      {kind === "barrote" && (
        <>
          <path d="M73 28 L126 38 L126 72 L73 82 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M73 28 C47 28 47 82 73 82 C99 82 99 28 73 28 Z" {...common} />
          <path d="M73 28 C94 34 94 76 73 82" fill="none" stroke="#9a4a14" strokeWidth="2" opacity="0.55" />
          <line x1="86" y1="33" x2="126" y2="40" stroke="#c98a54" strokeWidth="1.5" opacity="0.7" />
          <line x1="88" y1="76" x2="126" y2="69" stroke="#c98a54" strokeWidth="1.5" opacity="0.7" />
        </>
      )}
      {kind === "zocalo" && <path d="M76 16 C98 19 106 35 99 49 C96 56 108 64 106 82 L71 82 C67 67 74 59 77 49 L72 42 C77 34 70 26 76 16 Z" {...common} />}
      {kind === "contramarco-nariz" && (
        <>
          <path d="M50 58 L118 36 L126 46 L60 72 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M48 50 L116 28 L126 37 L58 63 Z" fill="#fff3e3" stroke="#9a4a14" strokeWidth="2" />
          <path d="M57 43 L98 31 L106 35 L65 48 Z" fill="none" stroke="#9a4a14" strokeWidth="2" />
          <path d="M67 53 L107 40" fill="none" stroke="#c98a54" strokeWidth="2" />
          <path d="M80 49 L113 38" fill="none" stroke="#c98a54" strokeWidth="1.5" />
          <path d="M48 50 C42 53 42 61 49 64 L58 63 C53 59 53 54 58 51 Z" {...common} />
        </>
      )}
      {kind === "contramarco-canal" && (
        <>
          <path d="M48 65 L122 38 L128 48 L58 78 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M50 55 L120 30 L127 40 L57 68 Z" fill="#fff3e3" stroke="#9a4a14" strokeWidth="2" />
          <path d="M70 53 L111 39" stroke="#9a4a14" strokeWidth="2" />
          <path d="M76 59 L116 46" stroke="#9a4a14" strokeWidth="2" />
          <path d="M47 54 C41 57 42 66 50 69 L58 68 C52 63 53 58 59 55 Z" {...common} />
        </>
      )}
      {(kind === "contramarco-finger-n1" || kind === "contramarco-finger-n2") && (
        <>
          <path d="M48 62 L122 38 L129 49 L60 78 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M48 53 L120 29 L128 39 L57 66 Z" fill="#fff3e3" stroke="#9a4a14" strokeWidth="2" />
          <path d={kind === "contramarco-finger-n2" ? "M62 51 L98 39 L111 45 L73 58 Z" : "M62 53 L104 40"} stroke="#9a4a14" strokeWidth="2" fill="none" />
          <path d="M48 53 C42 56 42 64 50 68 L57 66 C53 61 53 56 58 53 Z" {...common} />
        </>
      )}
      {kind === "contravidrio-113" && (
        <>
          <path d="M55 42 L120 26 L127 37 L64 61 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M55 42 L64 61 L48 64 C43 56 45 48 55 42 Z" {...common} />
          <line x1="72" y1="42" x2="108" y2="32" stroke="#c98a54" strokeWidth="1.5" />
        </>
      )}
      {kind === "contravidrio-137" && (
        <>
          <path d="M57 32 C63 22 78 20 88 30 L125 38 L125 68 L56 68 Z" fill="#ffe2b7" stroke="#9a4a14" strokeWidth="2" />
          <path d="M56 32 C81 28 81 70 56 68 Z" {...common} />
          <line x1="82" y1="34" x2="122" y2="41" stroke="#c98a54" strokeWidth="1.5" />
        </>
      )}
      {kind === "contravidrio-229" || kind === "contravidrio-299" ? (
        <path d="M54 68 L122 68 L122 46 C93 47 83 55 74 68 Z" {...common} />
      ) : null}
      {kind === "contravidrio-1" && <path d="M58 68 L122 68 L104 34 L76 34 Z" {...common} />}
      {kind === "contravidrio-2" && <path d="M56 68 L124 68 L106 30 L76 30 L76 44 L66 44 Z" {...common} />}
      {kind === "contravidrio-31" && <path d="M54 66 L124 66 L124 48 L68 48 L68 38 L54 38 Z" {...common} />}
      {kind === "contravidrio-180" && <path d="M56 70 L120 70 L120 48 C102 36 78 36 56 48 Z" {...common} />}
      {["contravidrio-410", "contravidrio-411", "contravidrio-412"].includes(kind) && <path d="M55 70 L124 70 L112 38 L70 38 Z" {...common} />}
      {kind === "contravidrio" && <path d="M64 66 L111 66 L100 28 L76 28 Z" {...common} />}
      {kind === "media-cana" && <path d="M62 74 L114 74 L114 46 A26 26 0 0 0 62 46 Z" {...common} />}
      {kind === "media-cana-cuadrada" && (
        <>
          <path d="M60 74 L120 74 L120 50 A30 30 0 0 0 60 50 Z" {...common} />
          <line x1="67" y1="68" x2="113" y2="68" stroke="#c98a54" strokeWidth="1.5" />
        </>
      )}
      {kind === "media-cana-larga" && (
        <>
          <path d="M54 74 L126 74 L113 52 A31 31 0 0 0 67 52 Z" {...common} />
          <line x1="66" y1="68" x2="116" y2="68" stroke="#c98a54" strokeWidth="1.5" />
        </>
      )}
      {kind === "media-cana-alta" && (
        <>
          <path d="M56 80 L120 80 L120 34 L111 34 A32 32 0 0 0 65 52 L56 52 Z" {...common} />
          <path d="M62 70 L114 70" stroke="#c98a54" strokeWidth="1.5" />
          <path d="M64 75 L116 75" stroke="#c98a54" strokeWidth="1.5" />
        </>
      )}
      {kind === "liston" && <rect x={listonX} y={listonY} width={listonW} height={listonH} rx="2" {...common} />}
      {kind === "montante" && (
        <>
          <rect x="34" y="38" width="96" height="34" rx="2" fill="#fff3e3" stroke="#9a4a14" strokeWidth="2" />
          {Array.from({ length: 3 }).map((_, i) => {
            const x = 50 + i * 26;
            return (
              <g key={x} transform={`rotate(-28 ${x + 12} 55)`}>
                <rect x={x} y="50" width="24" height="10" rx="5" fill={patternId} stroke="#9a4a14" strokeWidth="1.8" />
                <ellipse
                  cx={x + 5}
                  cy="55"
                  rx="5"
                  ry="5"
                  fill={patternId}
                  stroke="#9a4a14"
                  strokeWidth="1.8"
                />
                <ellipse
                  cx={x + 19}
                  cy="55"
                  rx="5"
                  ry="5"
                  fill={patternId}
                  stroke="#9a4a14"
                  strokeWidth="1.8"
                />
              </g>
            );
          })}
        </>
      )}
      {kind === "moldura" && <path d="M65 22 L108 22 C100 34 102 44 112 52 C98 58 98 68 107 80 L65 80 Z" {...common} />}
      {kind.startsWith("cuadro-") && (
        <path
          d={
            ["cuadro-203", "cuadro-224", "cuadro-232"].includes(kind)
              ? "M54 78 L82 24 C92 37 104 48 126 51 L126 64 L111 64 L111 75 L94 75 L94 84 L54 84 Z"
              : ["cuadro-45"].includes(kind)
                ? "M54 82 L54 36 L72 18 L116 18 L126 32 L104 42 L92 66 L126 66 L126 82 Z"
                : ["cuadro-57"].includes(kind)
                  ? "M54 78 L72 44 L92 30 L108 50 L126 44 L126 64 L108 70 L96 82 L54 82 Z"
                  : ["cuadro-z1"].includes(kind)
                    ? "M58 84 L58 24 L72 24 L72 45 L104 68 L122 68 L122 80 L88 80 L88 84 Z"
                    : ["cuadro-234"].includes(kind)
                      ? "M60 82 L60 28 L76 28 L76 46 L102 58 L124 58 L124 70 L96 70 L96 82 Z"
                      : "M56 80 L56 28 C72 18 84 24 88 38 C101 42 104 50 124 50 L124 64 L108 64 L108 76 L86 76 L86 84 L56 84 Z"
          }
          {...common}
        />
      )}
      {kind === "cuadro" && <path d="M56 80 L56 28 C72 18 84 24 88 38 C101 42 104 50 124 50 L124 64 L108 64 L108 76 L86 76 L86 84 L56 84 Z" {...common} />}
      <line x1="55" y1="92" x2="125" y2="92" stroke="#64748b" strokeWidth="1.5" />
      <line x1="55" y1="86" x2="55" y2="98" stroke="#64748b" strokeWidth="1.5" />
      <line x1="125" y1="86" x2="125" y2="98" stroke="#64748b" strokeWidth="1.5" />
      <text x="90" y="108" textAnchor="middle" fontSize="10" fill="#334155">{baseKind === "barrote" ? label : widthLabel}</text>
      {baseKind !== "barrote" && (
        <>
          <line x1="30" y1="18" x2="30" y2="84" stroke="#64748b" strokeWidth="1.5" />
          <line x1="23" y1="18" x2="37" y2="18" stroke="#64748b" strokeWidth="1.5" />
          <line x1="23" y1="84" x2="37" y2="84" stroke="#64748b" strokeWidth="1.5" />
          <text x="15" y="51" transform="rotate(-90 15 51)" textAnchor="middle" fontSize="10" fill="#334155">{heightLabel}</text>
        </>
      )}
    </svg>
  );
}

function FactoryOrderHeader({ session, grand }: { session: Session; grand: number }) {
  const totalPieces = session.items.reduce(
    (sum, item) => sum + item.pieces.reduce((pieceSum, piece) => pieceSum + piece.quantity, 0),
    0,
  );
  const totalHardware = session.items.reduce(
    (sum, item) => sum + item.hardware.reduce((hwSum, hw) => hwSum + hw.quantity, 0),
    0,
  );
  const orderAge = compactAge(session.order_created_at);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs uppercase text-muted-foreground">
          Orden de fabrica
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Nro. orden</div>
          <div className="font-semibold">{session.order_number}</div>
          {orderAge && (
            <div className="text-[10px] text-muted-foreground">{orderAge}</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Items</div>
          <div className="font-semibold">{session.items.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Piezas / herrajes</div>
          <div className="font-semibold">{totalPieces} / {totalHardware}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Total</div>
          <div className="font-semibold tabular-nums">UYU {fmtUYU(grand)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pedido progress
// ---------------------------------------------------------------------------

function moneyLabel(value: number | null | undefined) {
  if (!value || value <= 0) return "";
  return `UYU ${fmtUYU(value)}`;
}

function depositProgressLabel(deposit: number | null | undefined, total: number) {
  if (!deposit || deposit <= 0) return "";
  const pct = total > 0 ? ` (${Math.round((deposit / total) * 100)}%)` : "";
  const totalLabel = total > 0 ? ` / UYU ${fmtUYU(total)}` : "";
  return `UYU ${fmtUYU(deposit)}${totalLabel}${pct}`;
}

function OrderProgress({ session, grand }: { session: Session; grand: number }) {
  const steps = [
    { key: "requested", label: "Solicitada", done: true },
    {
      key: "approved",
      label: "Aprobada",
      done: session.approval_status === "approved",
    },
    {
      key: "sent",
      label: "Enviada",
      done: session.client_sent,
    },
    {
      key: "accepted",
      label: "Aceptada",
      done: session.client_accepted === "yes",
      rejected: session.client_accepted === "no",
    },
    {
      key: "deposit",
      label: "Seña",
      done: session.client_accepted === "yes" && !!session.deposit_amount,
      detail: depositProgressLabel(session.deposit_amount, grand),
    },
    {
      key: "order",
      label: "Orden",
      done: session.client_accepted === "yes" && !!session.deposit_amount && !!session.order_number,
      detail: session.order_number,
    },
    {
      key: "ready",
      label: "Lista",
      done: session.ready_to_deliver,
    },
    {
      key: "delivered",
      label: "Entregada",
      done: session.delivered,
    },
    {
      key: "paid",
      label: "Cobrada",
      done: session.delivered && !!session.final_payment_amount,
      detail: moneyLabel(session.final_payment_amount || grand),
    },
  ];
  const completedCount = steps.filter((step) => step.done).length;
  const progress =
    steps.length > 1 ? ((completedCount - 1) / (steps.length - 1)) * 100 : 0;
  const currentStep =
    [...steps].reverse().find((step) => step.done || step.rejected) ?? steps[0];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <CardTitle className="text-[11px] uppercase text-muted-foreground">
          Avance del pedido
        </CardTitle>
        <Badge
          variant="secondary"
          className={`rounded px-2 py-0.5 text-[10px] ${
            currentStep.rejected ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {currentStep.rejected ? "No aceptada" : currentStep.label}
        </Badge>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1">
        <div className="relative px-1">
          <div className="absolute left-4 right-4 top-3 h-0.5 rounded bg-muted" />
          <div
            className="absolute left-4 top-3 h-0.5 rounded bg-emerald-500 transition-all"
            style={{
              width: `calc((100% - 2rem) * ${Math.max(0, Math.min(progress, 100)) / 100})`,
            }}
          />
          <div className="relative grid grid-cols-9 gap-2">
            {steps.map((step, index) => {
              const state = step.rejected ? "rejected" : step.done ? "done" : "pending";
              return (
                <div key={step.key} className="flex min-w-0 flex-col items-center gap-1.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
                      state === "done"
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : state === "rejected"
                          ? "border-red-500 bg-red-500 text-white"
                          : "border-muted-foreground/30 bg-background text-muted-foreground"
                    }`}
                    title={step.label}
                  >
                    {state === "done" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  <div className="w-full truncate text-center text-[9px] font-medium leading-tight">
                    {step.label}
                  </div>
                  <div className="h-3 w-full truncate text-center text-[8px] text-muted-foreground">
                    {step.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {session.client_accepted === "no" && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            El cliente no acepto esta cotizacion.
          </div>
        )}
      </CardContent>
    </Card>
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
  const [services, setServices] = useState(session.additional_services);

  useEffect(() => {
    setColor(session.color_default);
    setPayment(session.payment_days != null ? String(session.payment_days) : "");
    setDestination(session.destination);
    setServices(session.additional_services);
  }, [
    session.id,
    session.color_default,
    session.payment_days,
    session.destination,
    session.additional_services,
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
  function toggleService(key: keyof Session["additional_services"]) {
    const next = { ...services, [key]: !services[key] };
    setServices(next);
    mutation.mutate({ additional_services: next });
  }

  const serviceOptions: Array<{
    key: keyof Session["additional_services"];
    label: string;
  }> = [
    { key: "rectification", label: "Rectificación de medidas" },
    { key: "installation", label: "Colocación" },
    { key: "painting", label: "Pintura" },
    { key: "varnishing", label: "Barniz" },
    { key: "polishing", label: "Lustre" },
  ];

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
        <div className="mt-4 space-y-2">
          <Label>Servicios adicionales</Label>
          <div className="grid grid-cols-2 gap-2">
            {serviceOptions.map((service) => {
              const active = !!services?.[service.key];
              return (
                <Button
                  key={service.key}
                  type="button"
                  variant={active ? "default" : "outline"}
                  className="justify-start gap-2"
                  onClick={() => toggleService(service.key)}
                >
                  {active && <Check className="h-4 w-4" />}
                  <span className="truncate">{service.label}</span>
                </Button>
              );
            })}
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
  const catalogErrors = session.items.filter((it) => {
    const total = it.last_quote?.total_with_hardware ?? 0;
    const notes = it.last_quote?.notes ?? "";
    return total === 0 && notes.includes("No pude acceder al listado de precios Activa");
  });
  const noColor =
    !session.color_default && session.items.some((it) => !it.color);

  if (missingHw.length === 0 && itemsNoBoard.length === 0 && catalogErrors.length === 0 && !noColor) {
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
        {catalogErrors.length > 0 && (
          <div className="text-sm text-amber-900">
            No pude acceder al listado Activa para {catalogErrors.length} item
            {catalogErrors.length === 1 ? "" : "s"}. Si el Google Sheet falla,
            el sistema usa la última copia local disponible.
          </div>
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
        className="h-8 w-24 tabular-nums bg-card"
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
            className="bg-card border border-amber-200 rounded p-2 space-y-1.5"
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
              <SelectTrigger className="bg-card">
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
  defaultOpen = false,
}: {
  items: QuotationItem[];
  sessionId: string;
  defaultOpen?: boolean;
}) {
  return (
    <section>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Items ({items.length})
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <ItemCard key={it.code} item={it} sessionId={sessionId} defaultOpen={defaultOpen} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer({ grand, session }: { grand: number; session: Session }) {
  const hasItems = session.items.length > 0;
  const hasMolduras = (session.moldura_quotes?.length ?? 0) > 0;
  const allOk =
    hasItems &&
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
      const exportKind = kind === "excel" && !hasItems && hasMolduras ? "molduras-excel" : kind;
      const res = await fetch(`/api/sessions/${session.id}/export/${exportKind}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error exportando: ${data.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const prefix = exportKind === "molduras-excel" ? "molduras" : "cotizacion";
      a.download = `${prefix}-${session.id.slice(0, 8)}.${kind === "excel" ? "xlsx" : "docx"}`;
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
          {!allOk && hasItems && (
            <div className="text-xs text-amber-700 mt-1">
              Resolvé los pendientes para exportar limpio.
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant={allOk ? "default" : "outline"}
            onClick={() => downloadExport("excel")}
            disabled={busy !== null || (!hasItems && !hasMolduras)}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            {busy === "excel" ? "Generando…" : "Excel"}
          </Button>
          <Button
            variant={allOk ? "default" : "outline"}
            onClick={() => downloadExport("docx")}
            disabled={busy !== null || !hasItems}
          >
            <FileText className="h-4 w-4 mr-1" />
            {busy === "docx" ? "Generando…" : "Word"}
          </Button>
        </div>
      </section>
    </>
  );
}
