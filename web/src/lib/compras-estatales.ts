const BASE = "https://www.comprasestatales.gub.uy";

export const PURCHASE_SEARCHES = [
  { family: "4", subfamily: "8", classCode: "1", category: "Mobiliario de madera", group: "wood" },
  { family: "4", subfamily: "8", classCode: "3", category: "Mobiliario de madera y metal", group: "wood" },
  { family: "2", subfamily: "7", classCode: "5", category: "Productos de madera", group: "wood" },
  { family: "2", subfamily: "8", classCode: "3", category: "Herrajes y accesorios", group: "supplies", keywords: ["herraje", "bisagra", "cerradura", "corredera", "tirador", "tornill", "clavo", "escuadra", "fijacion", "grampa", "remache", "riel", "carpint", "madera"] },
  { family: "2", subfamily: "8", classCode: "6", category: "Herramientas de carpintería", group: "supplies", keywords: ["carpint", "madera", "sierra", "taladro", "atornillador", "fresadora", "lijadora", "cepillo", "formon", "mecha", "caladora", "router", "ingletadora", "amoladora"] },
  { family: "4", subfamily: "1", classCode: "1", category: "Maquinaria de carpintería", group: "supplies", keywords: ["carpint", "madera", "sierra", "fresadora", "lijadora", "cepilladora", "escuadradora", "tupi", "canteadora", "seccionadora", "aspirador"] },
  { family: "3", subfamily: "7", classCode: "1", category: "Servicios de carpintería", group: "wood", keywords: ["carpint", "madera", "mueble", "puerta", "placard", "estanter"] },
  { family: "6", subfamily: "8", classCode: "1", category: "Reparaciones de carpintería", group: "wood", keywords: ["carpint", "madera", "mueble", "puerta", "placard", "estanter"] },
];

export interface PublicCall {
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

const entities: Record<string, string> = {
  amp: "&", nbsp: " ", sol: "/", quot: '"', apos: "'",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Ntilde: "Ñ", ntilde: "ñ", Uuml: "Ü", uuml: "ü",
};

export function cleanHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => entities[name] ?? match)
    .replace(/\s+/g, " ").trim();
}

function parseCalls(html: string, category: string, group: PublicCall["group"]): PublicCall[] {
  const pattern = /<h3><a href="([^"]*\/id\/(\d+))">([\s\S]*?)<span class="sr-only">([\s\S]*?)<\/span><\/a><\/h3>[\s\S]*?<p class="buy-object">([\s\S]*?)<\/p>[\s\S]*?Recepci&oacute;n de ofertas hasta:<\/span>&nbsp;<strong>([\s\S]*?)<\/strong>[\s\S]*?<span class="text-muted">Publicado:&nbsp;([\s\S]*?)<\/span>/g;
  return [...html.matchAll(pattern)].map((match) => ({
    href: `${BASE}${match[1]}`, id: match[2], title: cleanHtml(match[3]),
    organization: cleanHtml(match[4]), description: cleanHtml(match[5]),
    deadline: cleanHtml(match[6]), published: cleanHtml(match[7]).split("|", 1)[0].trim(), category, group,
  }));
}

function relevant(call: PublicCall, keywords?: string[]) {
  if (!keywords?.length) return true;
  const text = `${call.title} ${call.description} ${call.organization}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return keywords.some((word) => text.includes(word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
}

export async function getPublicCalls(): Promise<PublicCall[]> {
  const groups = await Promise.all(PURCHASE_SEARCHES.map(async ({ family, subfamily, classCode, category, group, keywords }) => {
    const path = `/consultas/buscar/tipo-pub/VIG/filtro-cat/CAT/familia/${family}/sub-familia/${subfamily}/clase/${classCode}/orden/ORD_ROF/tipo-orden/ASC`;
    const response = await fetch(`${BASE}${path}`, { headers: { "User-Agent": "Carpinteria-Juan-Pirone/1.0 (+consulta-publica)" }, cache: "no-store" });
    if (!response.ok) throw new Error(`ARCE respondió ${response.status}`);
    return parseCalls(await response.text(), category, group as PublicCall["group"]).filter((call) => relevant(call, keywords));
  }));
  const unique = new Map<string, PublicCall>();
  for (const call of groups.flat()) unique.set(call.id, call);
  return [...unique.values()];
}

export async function getCallAttachments(call: PublicCall) {
  const response = await fetch(call.href, { headers: { "User-Agent": "Carpinteria-Juan-Pirone/1.0 (+consulta-publica)" }, cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo abrir el llamado ${call.id}: ${response.status}`);
  const html = await response.text();
  const links = [...html.matchAll(/href=["']([^"'?#]*\/Pliegos\/[^"'?#]+)["']/gi)].map((match) => new URL(match[1], BASE).toString());
  return [...new Set(links)].filter((url) => /\.(pdf|xlsx?|csv|txt)$/i.test(new URL(url).pathname));
}
