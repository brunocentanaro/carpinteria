"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  AlertCircle,
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Files,
  Megaphone,
  Newspaper,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

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

const stateProjects = [
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

const privateProjects = [
  {
    title: "Reconversión del ex Enjoy Punta del Este",
    meta: "Punta del Este · Hotel, shopping y residencias",
    stage: "Proyecto anunciado",
    copy: "Complejo de usos mixtos con hotel Fasano, residencias, locales comerciales, gastronomía y entretenimiento. Alto potencial para mobiliario, revestimientos, puertas, herrajes y equipamiento a medida.",
    source: "Punta News · 14 abr 2026",
    href: "https://www.puntanews.com.uy/punta-este-jhsf-proyecta",
    contacts: [
      { organization: "JHSF / Fasano Las Piedras", role: "Desarrollador y canal inmobiliario", name: "Equipo comercial", phone: "+598 91 048 801", email: "vendaslaspiedras@jhsf.com.br", location: "Cno. Cerro Egusquiza y Paso del Barranco, Punta del Este", website: "https://laspiedrasfasano.com/en/contact/" },
    ],
  },
  {
    title: "Durazno Shopping Terminal",
    meta: "Durazno · Shopping y nueva terminal",
    stage: "Proyecto anunciado",
    copy: "Inversión estimada en USD 22 millones con más de 50 locales, plaza de comidas, cines y espacios públicos. Oportunidad para equipamiento comercial, mostradores, mobiliario y terminaciones.",
    source: "Quatro · 29 may 2026",
    href: "https://quatroges.com.uy/durazno-tendra-shopping-y-nueva-terminal/",
    contacts: [
      { organization: "Taranto Desarrollo Inmobiliario", role: "Desarrollador", name: "Ing. Marcos Taranto", phone: "+598 2706 6468", email: "info@taranto.com.uy", location: "José Benito Lamas 2922, Montevideo", website: "https://www.taranto.com.uy/" },
      { organization: "Durazno Shopping Terminal", role: "Administración del proyecto", email: "gestionhumana@duraznoshopping.com.uy", location: "Brig. Gral. Manuel Oribe esq. Gallinal, Durazno", website: "https://www.duraznoshopping.com.uy/contacto/" },
    ],
  },
  {
    title: "EVE Tower",
    meta: "Punta del Este · Torre residencial",
    stage: "En construcción",
    copy: "Edificio con espacios comunes, cowork, gimnasio, salas de juegos, parrilleros y áreas de servicio. Buen encaje para mobiliario de unidades y amenities, placares, cocinas y puertas.",
    source: "Norte Construcciones · 9 jun 2026",
    href: "https://www.norteconstrucciones.com.uy/noticias/avanza-la-construccion-de-eve-tower",
    contacts: [
      { organization: "Norte Construcciones", role: "Constructora · Gerencia comercial y de obras", name: "Damián Boix Barriola", phone: "+598 4244 0110", email: "info@norteconstrucciones.com.uy", location: "Calle 14 esq. 11, Punta del Este", website: "https://www.norteconstrucciones.com.uy/sobre-norte" },
      { organization: "Norte Construcciones", role: "Oficina Montevideo", phone: "+598 2908 1613", email: "infomontevideo@norteconstrucciones.com.uy", location: "Río Branco 1377/803, Montevideo", website: "https://www.norteconstrucciones.com.uy/sobre-norte" },
    ],
  },
  {
    title: "Nuevo mall en Camino de los Horneros",
    meta: "Canelones · Centro comercial de cercanía",
    stage: "En desarrollo",
    copy: "Proyecto comercial orientado al corredor de barrios privados. Potencial para equipamiento de locales, gastronomía, exhibidores, mobiliario y obras de adecuación interior.",
    source: "Forbes Uruguay · 4 mar 2026",
    href: "https://www.forbesuruguay.com/negocios/nuevo-mall-camino-horneros-como-proyecto-realizara-inversion-us-15-millones-foco-barrios-privados-n87184",
    contacts: [
      { organization: "Proyecto comercial Camino de los Horneros", role: "Desarrollo", name: "José María Pérez Noble", location: "Olivos y Paso Escobar, Canelones", website: "https://www.forbesuruguay.com/negocios/nuevo-mall-camino-horneros-como-proyecto-realizara-inversion-us-15-millones-foco-barrios-privados-n87184" },
    ],
  },
  {
    title: "Desarrollo urbano El Águila",
    meta: "Atlántida · Desarrollo de usos mixtos",
    stage: "Etapa inicial",
    copy: "Proyecto de largo plazo sobre 238 hectáreas con futura vivienda, comercio y servicios. Conviene seguirlo desde ahora para identificar desarrolladores, constructoras y primeras etapas de obra.",
    source: "Forbes Uruguay · 10 feb 2026",
    href: "https://www.forbesuruguay.com/negocios/kopel-sanchez-estudio-lecueder-unen-desarrollar-mega-proyecto-atlantida-inversion-total-estimada-us-500-millones-n86074",
    contacts: [
      { organization: "Kopel Sánchez", role: "Desarrollador principal", name: "Kopel Sánchez", location: "Atlántida, Canelones", website: "https://www.forbesuruguay.com/negocios/kopel-sanchez-estudio-lecueder-unen-desarrollar-mega-proyecto-atlantida-inversion-total-estimada-us-500-millones-n86074" },
      { organization: "Estudio Luis E. Lecueder", role: "Socio para componentes comerciales y terciarios", phone: "+598 2622 1333", email: "estudio@estudioluislecueder.com", location: "Cr. Luis E. Lecueder 3536, Torre 1 piso 12, Montevideo", website: "https://www.estudioluislecueder.com/" },
    ],
  },
];

interface StatePurchase {
  id: string;
  title: string;
  organization: string;
  description: string;
  deadline: string;
  published: string;
  href: string;
  category: string;
  group: "wood" | "supplies";
}

interface StatePurchasesResponse {
  calls: StatePurchase[];
  fetchedAt: string;
  source: string;
  filters: string[];
}

const toneClasses: Record<string, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  green: "border-emerald-200 bg-emerald-50 text-emerald-950",
  slate: "border-slate-200 bg-slate-50 text-slate-950",
};

export default function NoticieroPage() {
  const { brandId, brand } = useBrandEnvironment();
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState("");
  const purchasesQuery = useQuery<StatePurchasesResponse>({
    queryKey: ["noticiero", "compras-estatales", "carpinteria-v2"],
    queryFn: async () => {
      const response = await fetch("/api/noticiero/compras");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudieron consultar los llamados");
      return body;
    },
    staleTime: 15 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  async function processCall(id: string) {
    setProcessingId(id);
    setProcessingError("");
    try {
      const response = await fetch("/api/pliegos/radar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo procesar el llamado");
      const result = data.results?.find((item: { id?: string }) => item.id === id);
      if (!result) throw new Error("El radar no devolvió un resultado para este llamado");
      if (result.status === "failed") throw new Error(result.error || "No se pudo procesar el llamado");
      if (result.status === "without_files") throw new Error("El llamado no tiene pliegos adjuntos para procesar");
      const sessionId = result.session?.id;
      router.push(sessionId ? `/pliegos/${encodeURIComponent(sessionId)}` : "/pliegos");
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "No se pudo procesar el llamado");
    } finally {
      setProcessingId(null);
    }
  }

  if (brandId !== "casa") {
    return <main className="p-8 text-muted-foreground">El Noticiero comercial es exclusivo de La Casa del Carpintero.</main>;
  }

  const purchaseGroups = [
    { key: "wood", title: "Madera, mobiliario y servicios", description: "Muebles, productos de madera, carpintería y reparaciones." },
    { key: "supplies", title: "Herrajes, herramientas, maquinaria e insumos", description: "Ferretería vinculada al oficio y equipamiento para carpintería." },
  ] as const;

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
          <Metric icon={Building2} label="Radar de obras" value={String(stateProjects.length + privateProjects.length)} detail="oportunidades públicas y privadas" />
          <Metric icon={ShoppingCart} label="Compras estatales" value={purchasesQuery.data ? String(purchasesQuery.data.calls.length) : "—"} detail="oportunidades vigentes" />
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
          <SectionTitle icon={Building2} title="Radar de obras" subtitle="Obras públicas y privadas con posibilidades de venta, contacto comercial o seguimiento temprano." />
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            <ProjectRadar title="Obras estatales" description="Infraestructura y reformas promovidas por organismos públicos." projects={stateProjects} />
            <ProjectRadar title="Obras privadas" description="Edificios, shoppings, hoteles, barrios privados, reformas y desarrollos comerciales." projects={privateProjects} />
          </div>
        </section>

        <section>
          <SectionTitle icon={ShoppingCart} title="Compras estatales" subtitle="RUPE registra al proveedor; los llamados se consultan en Compras Estatales/ARCE." />
          <div className="mt-3 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="text-sm font-semibold">Radar automático de oportunidades para carpintería</div><div className="text-xs text-muted-foreground">Separa madera y mobiliario de la ferretería, herramientas, maquinaria e insumos vinculados al oficio.</div></div>
              <button type="button" onClick={() => purchasesQuery.refetch()} disabled={purchasesQuery.isFetching} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${purchasesQuery.isFetching ? "animate-spin" : ""}`} />Actualizar</button>
            </div>
            {purchasesQuery.isLoading && <div className="p-10 text-center text-sm text-muted-foreground">Consultando llamados vigentes en ARCE…</div>}
            {purchasesQuery.isError && <div className="flex items-start gap-3 p-5 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">No pudimos actualizar Compras Estatales</div><div>{purchasesQuery.error.message}</div></div></div>}
            {processingError && <div className="flex items-start gap-3 border-b p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">No se pudo enviar el pliego</div><div>{processingError}</div></div></div>}
            {purchasesQuery.data?.calls.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Hoy no hay llamados vigentes en estas categorías.</div>}
            <div>{purchaseGroups.map((group) => {
              const calls = purchasesQuery.data?.calls.filter((purchase) => purchase.group === group.key) || [];
              if (!calls.length) return null;
              return <section key={group.key} className="border-t first:border-t-0">
                <div className="bg-muted/20 px-5 py-3"><h3 className="text-sm font-semibold">{group.title}</h3><p className="text-xs text-muted-foreground">{group.description}</p></div>
                <div className="divide-y">{calls.map((purchase) => <article key={purchase.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{purchase.category}</span><span className="flex items-center gap-1 text-xs font-semibold text-amber-700"><Clock3 className="h-3.5 w-3.5" />Cierra {purchase.deadline}</span></div>
                <h3 className="mt-2 text-lg font-semibold">{purchase.title}</h3>
                <div className="mt-1 text-sm font-medium text-muted-foreground">{purchase.organization}</div>
                <p className="mt-2 text-sm leading-6">{purchase.description}</p>
                <div className="mt-2 text-xs text-muted-foreground">Publicado: {purchase.published}</div>
              </div>
              <div className="grid gap-2"><button type="button" onClick={() => processCall(purchase.id)} disabled={processingId === purchase.id} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><Files className="h-4 w-4" />{processingId === purchase.id ? "Procesando..." : "Procesar y ver pliego"}</button><a href={purchase.href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">Ver llamado oficial <ArrowUpRight className="h-4 w-4" /></a></div>
                </article>)}</div>
              </section>;
            })}</div>
            {purchasesQuery.data && <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">Última consulta: {new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(purchasesQuery.data.fetchedAt))}. Verificá siempre el pliego y vencimiento en ARCE.</div>}
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

type ProjectContact = { organization: string; role: string; name?: string; phone?: string; email?: string; location?: string; website?: string };

function ProjectRadar({ title, description, projects }: { title: string; description: string; projects: Array<{ title: string; meta: string; copy: string; source: string; href: string; stage?: string; contacts?: ProjectContact[] }> }) {
  return <section className="overflow-hidden rounded-xl border bg-card">
    <div className="border-b bg-muted/30 px-5 py-4"><h3 className="font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{description}</p></div>
    <div className="divide-y">{projects.map((project) => <article key={project.title} className="p-5">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-primary">{project.meta}</span>{project.stage && <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{project.stage}</span>}</div>
      <h4 className="mt-2 text-lg font-semibold">{project.title}</h4>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{project.copy}</p>
      {project.contacts?.length ? <details className="mt-4 rounded-lg border bg-muted/15">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Ver desarrolladores, constructores y contactos</summary>
        <div className="grid gap-3 border-t p-4">{project.contacts.map((contact) => <div key={`${contact.organization}-${contact.role}`} className="rounded-md bg-background p-3 text-sm">
          <div className="font-semibold">{contact.organization}</div><div className="text-xs text-primary">{contact.role}</div>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">{contact.name && <span>Contacto: {contact.name}</span>}{contact.phone && <a className="hover:text-foreground" href={`tel:${contact.phone.replace(/\s/g, "")}`}>Teléfono: {contact.phone}</a>}{contact.email && <a className="hover:text-foreground" href={`mailto:${contact.email}`}>Correo: {contact.email}</a>}{contact.location && <span>Ubicación: {contact.location}</span>}{contact.website && <a className="font-medium text-primary" href={contact.website} target="_blank" rel="noreferrer">Web o canal oficial <ArrowUpRight className="ml-1 inline h-3 w-3" /></a>}</div>
        </div>)}</div>
        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">Datos públicos para contacto comercial. Conviene verificar el responsable de compras antes de escribir.</div>
      </details> : <div className="mt-4 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Todavía no hay desarrollador, constructora o canal comercial identificado públicamente.</div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{project.source}</span><a href={project.href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-muted">Leer noticia original <ArrowUpRight className="h-3.5 w-3.5" /></a></div>
    </article>)}</div>
  </section>;
}
