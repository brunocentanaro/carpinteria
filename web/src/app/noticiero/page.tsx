"use client";

import {
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Megaphone,
  Newspaper,
  ShoppingCart,
} from "lucide-react";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";

const campaigns = [
  {
    date: "12 JUL",
    eyebrow: "En 2 semanas",
    title: "Día del Padre",
    copy: "Empujar herramientas, bancos de trabajo y kits para el taller con una campaña de regalo útil.",
    action: "Preparar piezas y pauta esta semana",
    tone: "amber",
  },
  {
    date: "16 AGO",
    eyebrow: "Próxima campaña",
    title: "Día de la Niñez",
    copy: "Proponer muebles infantiles, organizadores y proyectos de madera para hacer en familia.",
    action: "Definir productos antes del 19 de julio",
    tone: "green",
  },
  {
    date: "04 OCT",
    eyebrow: "Oportunidad de contenido",
    title: "Mes del Patrimonio",
    copy: "Mostrar restauración, oficios y maderas tradicionales. Ideal para contenido de marca y talleres.",
    action: "Armar una historia de oficio local",
    tone: "slate",
  },
];

const projects = [
  {
    title: "Plan de infraestructura educativa de ANEP",
    meta: "Uruguay · 44 obras PPP",
    copy: "Centros educativos, escuelas de tiempo completo, polideportivos y piscinas. Potencial para puertas, mobiliario, tableros, herrajes y herramientas.",
    source: "Presidencia · 3 jun 2026",
    href: "https://www.gub.uy/presidencia/comunicacion/noticias/anep-presupuesto-escuelas-liceos-infraestructura-caggiani-2026",
  },
  {
    title: "Transformación de la Biblioteca Nacional",
    meta: "Montevideo · Reforma y ampliación",
    copy: "Nuevos espacios de estudio, cafetería, sala multipropósito y reforma de depósitos. Buen encaje para mobiliario y terminaciones interiores.",
    source: "MTOP · 26 may 2026",
    href: "https://www.gub.uy/ministerio-transporte-obras-publicas/comunicacion/noticias/biblioteca-nacional-uruguay-iniciara-nueva-etapa-transformacion-edilicia",
  },
  {
    title: "Obras de saneamiento y agua en Maldonado",
    meta: "San Carlos y Aiguá · USD 60 millones",
    copy: "Proyecto en ejecución con infraestructura asociada. Conviene identificar contratistas y necesidades de obra, herramientas y equipamiento.",
    source: "Presidencia · 27 may 2026",
    href: "https://www.gub.uy/presidencia/comunicacion/noticias/ose-saneamiento-san-carlos-aigua-obras-anuncio",
  },
];

const purchases = [
  {
    urgency: "Revisar hoy",
    title: "Llamados vigentes de mobiliario y carpintería",
    copy: "Consulta filtrada en la fuente oficial. Revisar pliego, inscripción RUPE y fecha de recepción antes de cotizar.",
    href: "https://www.comprasestatales.gub.uy/consultas/",
  },
  {
    urgency: "Monitoreo diario",
    title: "Compras directas de ferretería y herramientas",
    copy: "Buscar por organismo y palabras clave: madera, herrajes, muebles, puertas, herramientas y reparación.",
    href: "https://www.comprasestatales.gub.uy/consultas/",
  },
];

const toneClasses: Record<string, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  green: "border-emerald-200 bg-emerald-50 text-emerald-950",
  slate: "border-slate-200 bg-slate-50 text-slate-950",
};

export default function NoticieroPage() {
  const { brandId, brand } = useBrandEnvironment();

  if (brandId !== "casa") {
    return <main className="p-8 text-muted-foreground">El Noticiero comercial es exclusivo de La Casa del Carpintero.</main>;
  }

  return (
    <main className="min-h-screen bg-muted/25">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header className="overflow-hidden rounded-2xl bg-[var(--brand-teal-deep)] text-white shadow-sm">
          <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:p-8">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">
                <Newspaper className="h-4 w-4" /> {brand.name}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Noticiero comercial</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                Campañas con tiempo, obras que pueden convertirse en clientes y compras públicas que no conviene dejar vencer.
              </p>
            </div>
            <div className="flex items-center gap-3 self-start rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-50" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" /></span>
              <div><div className="text-sm font-medium">Monitoreo activo</div><div className="text-xs text-white/60">Actualización diaria · 09:00</div></div>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric icon={BellRing} label="Acción hoy" value="1" detail="campaña para preparar" />
          <Metric icon={Building2} label="Radar de obras" value="3" detail="oportunidades destacadas" />
          <Metric icon={ShoppingCart} label="Compras estatales" value="2" detail="búsquedas para revisar" />
        </section>

        <section>
          <SectionTitle icon={Megaphone} title="Próximas campañas" subtitle="Avisos anticipados para planificar y llegar en fecha a cada campaña de marketing." />
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {campaigns.map((item) => <article key={item.title} className={`rounded-xl border p-5 ${toneClasses[item.tone]}`}>
              <div className="flex items-start justify-between gap-3"><div className="text-xs font-semibold uppercase tracking-wide opacity-65">{item.eyebrow}</div><div className="rounded-md bg-white/70 px-2 py-1 text-xs font-bold">{item.date}</div></div>
              <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 opacity-80">{item.copy}</p>
              <div className="mt-4 flex items-center gap-2 border-t border-current/10 pt-3 text-xs font-semibold"><CheckCircle2 className="h-4 w-4" />{item.action}</div>
            </article>)}
          </div>
        </section>

        <section>
          <SectionTitle icon={Building2} title="Radar de obras" subtitle="Proyectos recientes con posibilidades de venta o contacto comercial." />
          <div className="mt-3 overflow-hidden rounded-xl border bg-card">
            {projects.map((project) => <article key={project.title} className="grid gap-4 border-b p-5 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center">
              <div><div className="text-xs font-semibold uppercase tracking-wide text-primary">{project.meta}</div><h3 className="mt-1 text-lg font-semibold">{project.title}</h3><p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{project.copy}</p><div className="mt-2 text-xs text-muted-foreground">{project.source}</div></div>
              <a href={project.href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">Ver proyecto <ArrowUpRight className="h-4 w-4" /></a>
            </article>)}
          </div>
        </section>

        <section>
          <SectionTitle icon={ShoppingCart} title="Compras estatales" subtitle="RUPE registra al proveedor; los llamados se consultan en Compras Estatales/ARCE." />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {purchases.map((purchase) => <article key={purchase.title} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700"><Clock3 className="h-4 w-4" />{purchase.urgency}</div>
              <h3 className="mt-3 text-lg font-semibold">{purchase.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{purchase.copy}</p>
              <a href={purchase.href} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Abrir Compras Estatales <ArrowUpRight className="h-4 w-4" /></a>
            </article>)}
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Última edición: 28 de junio de 2026</span><span>Los vencimientos deben confirmarse siempre en el llamado oficial.</span></footer>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof CalendarDays; label: string; value: string; detail: string }) {
  return <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div><div><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-0.5 flex items-baseline gap-2"><span className="text-2xl font-semibold">{value}</span><span className="text-xs text-muted-foreground">{detail}</span></div></div></div>;
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof CalendarDays; title: string; subtitle: string }) {
  return <div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div><h2 className="text-xl font-semibold tracking-tight">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div></div>;
}
