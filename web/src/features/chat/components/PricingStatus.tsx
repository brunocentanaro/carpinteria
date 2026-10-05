import type { SessionRow } from "../schemas";

const labels = {
  historical: "Anterior a septiembre · fuera de pendientes",
  tender: "Licitación · fuera de pendientes",
  pending: "Falta cotizar",
  priced: "Precio listo",
  sent: "Enviada al cliente",
  accepted: "Aceptada / en producción",
  rejected: "No aceptada",
  delivered: "Entregada",
  draft: "Solicitud sin detalle",
} as const;

export function PricingStatus({ session }: { session: SessionRow }) {
  const status = session.pricing_status;
  const tone = status === "pending" ? "bg-red-50 text-red-800 ring-red-200"
    : status === "priced" || status === "sent" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : "bg-muted text-muted-foreground ring-border";
  return <span className={`my-1 inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
    <span aria-hidden="true">{status === "pending" ? "●" : status === "priced" || status === "sent" ? "✓" : "–"}</span>
    {labels[status]}
  </span>;
}
