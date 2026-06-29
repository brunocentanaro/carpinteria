import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.comprasestatales.gub.uy";
const SEARCHES = [
  { family: "4", subfamily: "8", classCode: "1", category: "Mobiliario de madera" },
  { family: "4", subfamily: "8", classCode: "3", category: "Mobiliario de madera y metal" },
  { family: "2", subfamily: "7", classCode: "5", category: "Productos de madera" },
  {
    family: "2", subfamily: "8", classCode: "3", category: "Herrajes y accesorios",
    keywords: ["herraje", "bisagra", "cerradura", "corredera", "tirador", "tornill", "clavo", "escuadra", "fijacion", "fijación", "carpint", "madera"],
  },
  {
    family: "2", subfamily: "8", classCode: "6", category: "Herramientas para madera",
    keywords: ["carpint", "madera", "sierra", "taladro", "fresadora", "lijadora", "cepillo", "formon", "formón", "mecha", "caladora", "router"],
  },
  {
    family: "4", subfamily: "1", classCode: "1", category: "Maquinaria para madera",
    keywords: ["carpint", "madera", "sierra", "fresadora", "lijadora", "cepilladora", "escuadradora", "tupí", "tupi"],
  },
  {
    family: "3", subfamily: "7", classCode: "1", category: "Servicios de carpintería",
    keywords: ["carpint", "madera", "mueble", "puerta", "ventana", "placard", "estanter"],
  },
  {
    family: "6", subfamily: "8", classCode: "1", category: "Reparaciones de carpintería",
    keywords: ["carpint", "madera", "mueble", "puerta", "ventana", "placard", "estanter"],
  },
];

interface PublicCall {
  id: string;
  title: string;
  organization: string;
  description: string;
  deadline: string;
  published: string;
  href: string;
  category: string;
}

const entities: Record<string, string> = {
  amp: "&", nbsp: " ", sol: "/", quot: '"', apos: "'",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Ntilde: "Ñ", ntilde: "ñ", Uuml: "Ü", uuml: "ü",
};

function clean(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => entities[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function parseCalls(html: string, category: string): PublicCall[] {
  const pattern = /<h3><a href="([^"]*\/id\/(\d+))">([\s\S]*?)<span class="sr-only">([\s\S]*?)<\/span><\/a><\/h3>[\s\S]*?<p class="buy-object">([\s\S]*?)<\/p>[\s\S]*?Recepci&oacute;n de ofertas hasta:<\/span>&nbsp;<strong>([\s\S]*?)<\/strong>[\s\S]*?<span class="text-muted">Publicado:&nbsp;([\s\S]*?)<\/span>/g;
  const rows: PublicCall[] = [];
  for (const match of html.matchAll(pattern)) {
    rows.push({
      href: `${BASE}${match[1]}`,
      id: match[2],
      title: clean(match[3]),
      organization: clean(match[4]),
      description: clean(match[5]),
      deadline: clean(match[6]),
      published: clean(match[7]).split("|", 1)[0].trim(),
      category,
    });
  }
  return rows;
}

function relevant(call: PublicCall, keywords?: string[]) {
  if (!keywords?.length) return true;
  const text = `${call.title} ${call.description} ${call.organization}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
}

export async function GET() {
  try {
    const groups = await Promise.all(SEARCHES.map(async ({ family, subfamily, classCode, category, keywords }) => {
      const path = `/consultas/buscar/tipo-pub/VIG/filtro-cat/CAT/familia/${family}/sub-familia/${subfamily}/clase/${classCode}/orden/ORD_ROF/tipo-orden/ASC`;
      const response = await fetch(`${BASE}${path}`, {
        headers: { "User-Agent": "Carpinteria-Juan-Pirone/1.0 (+consulta-publica)" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`ARCE respondió ${response.status}`);
      return parseCalls(await response.text(), category).filter((call) => relevant(call, keywords));
    }));
    const unique = new Map<string, PublicCall>();
    for (const call of groups.flat()) unique.set(call.id, call);
    return NextResponse.json({
      calls: [...unique.values()],
      fetchedAt: new Date().toISOString(),
      source: `${BASE}/consultas/`,
      filters: SEARCHES.map((item) => item.category),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo consultar Compras Estatales" },
      { status: 502 },
    );
  }
}
