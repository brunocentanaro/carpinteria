"""Curated hardware catalog for the cotizador agent.

The agent picks items from this list (no free-form names) so the front-end
can show stable rows that Pelca prices manually. Prices live in the user's
input, never here.

Add or edit items as needed — `code` is the stable identifier used everywhere
(persisted in localStorage on the front, sent in quote payloads).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HardwareSpec:
    code: str
    name: str
    category: str  # high-level bucket: BISAGRA / GUIA / CORREDERA / TIRADOR / CERRADURA / RUEDA / REGATON / PASADOR / VAIVEN / FERRETERIA
    unit: str = "unidad"
    notes: str = ""


CURATED_HARDWARE: list[HardwareSpec] = [
    # Bisagras
    HardwareSpec("BISAGRA_FRENO",          "Bisagra con freno",                            "BISAGRA"),
    HardwareSpec("BISAGRA_RECTA",          "Bisagra recta",                                "BISAGRA"),
    HardwareSpec("BISAGRA_SEMI_RECTA",     "Bisagra semi recta (codo medio)",              "BISAGRA"),
    HardwareSpec("BISAGRA_SUPER_RECTA",    "Bisagra super recta (codo grande)",            "BISAGRA"),
    HardwareSpec("BISAGRA_PISTON_PUSH",    "Bisagra a presión (push to open)",             "BISAGRA"),

    # Guías de cajón
    HardwareSpec("GUIA_TELESC_300",        "Guía telescópica con freno 300mm (par)",       "GUIA"),
    HardwareSpec("GUIA_TELESC_350",        "Guía telescópica con freno 350mm (par)",       "GUIA"),
    HardwareSpec("GUIA_TELESC_400",        "Guía telescópica con freno 400mm (par)",       "GUIA"),
    HardwareSpec("GUIA_TELESC_450",        "Guía telescópica con freno 450mm (par)",       "GUIA"),
    HardwareSpec("GUIA_TELESC_500",        "Guía telescópica con freno 500mm (par)",       "GUIA"),
    HardwareSpec("GUIA_TELESC_550",        "Guía telescópica con freno 550mm (par)",       "GUIA"),
    HardwareSpec("GUIA_RIEL_SIMPLE",       "Riel/guía simple para cajón (par)",            "GUIA"),

    # Correderas para puertas / vaivén
    HardwareSpec("CORREDERA_PUERTA_COLG",  "Corredera para puerta colgante (kit)",         "CORREDERA"),
    HardwareSpec("CORREDERA_PUERTA_PLEG",  "Herraje plegable para puerta (kit)",           "CORREDERA"),
    HardwareSpec("VAIVEN_PUERTA",          "Vaivén / pivote para puerta",                  "VAIVEN"),

    # Tiradores y manijas
    HardwareSpec("TIRADOR_METAL_PEQ",      "Tirador metálico chico (≤100mm)",              "TIRADOR"),
    HardwareSpec("TIRADOR_METAL_MED",      "Tirador metálico mediano (100–200mm)",         "TIRADOR"),
    HardwareSpec("TIRADOR_METAL_GDE",      "Tirador metálico grande (>200mm)",             "TIRADOR"),
    HardwareSpec("PERILLA",                "Perilla / pomo",                                "TIRADOR"),

    # Cerraduras
    HardwareSpec("CERR_TAMBOR",            "Cerradura tambor",                             "CERRADURA"),
    HardwareSpec("CERR_CAJONERA_3",        "Cerradura para cajonera 3 cajones",            "CERRADURA"),
    HardwareSpec("CERR_PUERTA_MUEBLE",     "Cerradura para puerta de mueble",              "CERRADURA"),

    # Ruedas y bases
    HardwareSpec("RUEDA_GIR_FRENO",        "Rueda giratoria con freno",                    "RUEDA"),
    HardwareSpec("RUEDA_GIR_SIN_FRENO",    "Rueda giratoria sin freno",                    "RUEDA"),
    HardwareSpec("REGATON_REGULABLE",      "Regatón regulable / pata regulable",           "REGATON"),
    HardwareSpec("REGATON_FIJO",           "Regatón fijo",                                 "REGATON"),

    # Estantes y unión
    HardwareSpec("PORTA_ESTANTE",          "Soporte / clip porta-estante",                 "FERRETERIA"),
    HardwareSpec("MINIFIX",                "Minifix / unión excéntrica (kit)",             "FERRETERIA"),
    HardwareSpec("TARUGO_MADERA",          "Tarugo de madera (unidad)",                    "FERRETERIA"),
    HardwareSpec("TORNILLO_AGLOMERADO",    "Tornillo aglomerado (unidad)",                 "FERRETERIA"),

    # Pasadores y otros
    HardwareSpec("PASADOR",                "Pasador / cierre simple",                      "PASADOR"),
    HardwareSpec("PORTA_LLAVE",            "Porta llave / gancho",                         "FERRETERIA"),
]


_BY_CODE: dict[str, HardwareSpec] = {h.code: h for h in CURATED_HARDWARE}


def get_by_code(code: str) -> HardwareSpec | None:
    return _BY_CODE.get(code)


def codes() -> list[str]:
    return [h.code for h in CURATED_HARDWARE]


def catalog_prompt_block() -> str:
    """Plain-text block of the catalog to inject into the agent prompt."""
    lines = ["Catálogo de herrajes disponibles (elegí solo de acá, usá el `code`):"]
    by_cat: dict[str, list[HardwareSpec]] = {}
    for h in CURATED_HARDWARE:
        by_cat.setdefault(h.category, []).append(h)
    for cat in sorted(by_cat):
        lines.append(f"\n[{cat}]")
        for h in by_cat[cat]:
            lines.append(f"  {h.code}: {h.name}")
    return "\n".join(lines)
