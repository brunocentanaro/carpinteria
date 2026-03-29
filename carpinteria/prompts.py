IMAGE_ANALYSIS = """\
Analiza esta imagen de un plano de optimización de corte de placas.

Extrae TODA la información visible:

1. **Piezas**: Cada rectángulo representa una pieza cortada. Extrae:
   - width_mm y height_mm (las dimensiones están en metros, convertí a milímetros multiplicando por 1000)
   - quantity: contá cuántas piezas idénticas (mismo ancho x alto) hay en TODOS los planos de la imagen
   - label: si la pieza tiene algún nombre/etiqueta
   - edge_sides: si dice "encintada" o similar, poné ["top", "bottom", "left", "right"]

2. **Info del material**: Busca texto diagonal o en los márgenes que indique:
   - board_material: SOLO escribí lo que dice explícitamente en la imagen.
     Si dice "melamina" o menciona colores específicos (gris humo, blanco, roble, etc.) → "melamínico"
     Si dice "MDF" o "fibrofácil" sin color → "MDF"
     Si no dice nada claro → "melamínico" (es lo más común en planos de corte)
   - board_thickness_mm: espesor en mm (ej: "espesor 18 mm")
   - board_color: el color tal cual aparece en la imagen (ej: "gris humo y blanco")

3. **Cantidad de placas**: El número entre paréntesis junto al espesor indica cuántas placas se necesitan.
   Ejemplo: "espesor 18 mm (4)" = 4 placas de ese tipo.

4. **Sobra/desperdicio**: Si hay una zona marcada como "sobra", describila.

IMPORTANTE:
- Las dimensiones en la imagen están en METROS (ej: 0.60 = 600mm, 0.45 = 450mm)
- El ancho del plano completo suele ser 1.83m (1830mm) y el alto 2.60m (2600mm)
- Agrupa piezas idénticas sumando sus cantidades
- Si hay múltiples planos (distintos espesores/materiales), reportá las piezas de CADA plano por separado
- NO inventes información que no esté en la imagen

Devolvé un JSON con esta estructura:
{
  "plans": [
    {
      "board_material": "melamínico",
      "board_thickness_mm": 18,
      "board_color": "gris humo y blanco",
      "boards_needed": 4,
      "pieces": [
        {"width_mm": 600, "height_mm": 450, "quantity": 24, "label": "", "edge_sides": ["top", "bottom", "left", "right"]},
        ...
      ],
      "waste_description": "sobra de 0.20m en el último panel"
    }
  ]
}
"""

PLIEGO_ANALYSIS = """\
Analizá el siguiente texto extraído de un pliego de licitación / especificación de mobiliario.

Extraé TODOS los muebles/ítems que se piden, con la mayor cantidad de detalle posible.

Para cada mueble devolvé:
- code: código del mueble (ej: "A13", "C1", "B4")
- name: nombre descriptivo (ej: "armario aéreo", "cajonera con ruedas")
- quantity: cantidad total pedida
- description: descripción completa incluyendo dimensiones, materiales, puertas, cajones, etc.
- dimensions: objeto con width_mm, height_mm, depth_mm si se mencionan (convertir metros a mm)
- material: material principal (melamínico, MDF, metal, etc.)
- thickness_mm: espesor de las placas si se menciona
- hardware: lista de herrajes mencionados (bisagras, guías, cerraduras, ruedas, etc.)
- edge_banding: tipo de canto si se menciona (ej: "ABS 2mm")
- group: grupo al que pertenece (G1, G2, G3)
- delivery_location: lugar de entrega si se menciona
- delivery_days: plazo de entrega máximo en días si se menciona
- wood_only: clasificá si el mueble se puede fabricar en un taller de carpintería con placas de melamínico/MDF.
  SIEMPRE true para: armarios, cajoneras, lockers, estantes de melamínico, muebles de guardado, alacenas, bajo mesadas. Estos muebles usan herrajes comprados (bisagras, guías telescópicas, cerraduras, tiradores metálicos, ruedas) y eso está perfecto, son wood_only=true.
  SIEMPRE false para: mesas con patas de caño/hierro, escritorios con estructura metálica soldada, sillas, sillones, tarimas con estructura de caño, estanterías metálicas, lockers metálicos, cualquier cosa que necesite soldadura o fabricación de estructura de hierro.

IMPORTANTE:
- Extraé SOLO la información que está explícita en el texto
- Las dimensiones pueden estar en metros (0.80 = 800mm) o centímetros (80 = 800mm)
- Si un mueble tiene variantes (A, B, C), reportá cada variante por separado
- Incluí información sobre colores, terminaciones y especificaciones técnicas

Devolvé un JSON:
{
  "items": [
    {
      "code": "A13",
      "name": "armario aéreo",
      "quantity": 3,
      "description": "armario sobre mesada para suspender en muro, 1.50x0.40m, 2 puertas",
      "dimensions": {"width_mm": 1500, "height_mm": 730, "depth_mm": 400},
      "material": "melamínico",
      "thickness_mm": 18,
      "hardware": ["bisagras con freno", "cerradura tambor", "tirador acero"],
      "edge_banding": "ABS 2mm",
      "group": "G1",
      "delivery_location": "",
      "delivery_days": 45,
      "wood_only": true
    }
  ],
  "general_specs": {
    "materials": "MDF enchapado melamínico 18mm mínimo",
    "colors": ["gris claro", "gris oscuro", "rojo", "naranja", "blanco"],
    "edge_banding": "ABS 2mm",
    "delivery_location": "Guido Machado Brum 2390, Rivera",
    "delivery_days": 45,
    "payment_terms": "100% contra recepción y conformidad, 45 días desde factura",
    "offer_maintenance_days": 60,
    "samples_required": "no se requieren muestras",
    "required_forms": ["Anexo I - Formulario de identificación del oferente", "antecedentes últimos 5 años"],
    "bid_guarantee": "no se exige garantía de oferta",
    "performance_guarantee": "garantía de fiel cumplimiento según monto adjudicado (art. 64 TOCAF)",
    "product_warranty": "5 años mínimo para Grupo 1, 2 puntos extra por cada año adicional (máx 10 puntos)",
    "other_conditions": "cotizar en UYU, precios unitarios con impuestos incluidos si no se desglosan"
  }
}
"""

FURNITURE_DECOMPOSE = """\
Sos un carpintero experto. Dado un mueble de melamínico/MDF, descomponelo en todas las piezas de placa que se necesitan para fabricarlo.

Para cada pieza indicá:
- width_mm: ancho en mm
- height_mm: alto en mm
- quantity: cantidad de piezas iguales
- label: nombre de la pieza (ej: "tapa", "lateral", "puerta", "base", "trasera", "estante", "frente cajón", "lateral cajón", "fondo cajón")
- edge_sides: qué lados llevan canto. Los cantos van en los lados VISIBLES.
  Reglas: las tapas llevan canto en frente y costados. Los laterales llevan canto en frente. Las puertas llevan canto en los 4 lados. Las traseras y fondos de cajón NO llevan canto. Los estantes llevan canto solo en el frente.

También listá los herrajes necesarios:
- hardware: lista de objetos con "name" (nombre del herraje), "quantity" (cantidad), "unit_price_usd" (precio estimado en USD)
  Precios de referencia en USD:
  - Bisagra con freno: 3
  - Guía telescópica con freno (par): 8
  - Cerradura tambor: 4
  - Tirador metálico: 2
  - Rueda giratoria con freno: 3
  - Regatón regulable: 1

IMPORTANTE:
- Las dimensiones del mueble están en mm
- El espesor de la placa se resta de las dimensiones internas (ej: si el mueble mide 800mm de ancho y la placa es 18mm, el estante interno mide 800 - 2*18 = 764mm)
- Contá bien las bisagras: hasta 100cm de puerta = 3 bisagras, más de 100cm = 4 bisagras

Devolvé JSON:
{
  "pieces": [
    {"width_mm": 800, "height_mm": 400, "quantity": 1, "label": "tapa", "edge_sides": ["top", "left", "right"]},
    {"width_mm": 800, "height_mm": 400, "quantity": 1, "label": "base", "edge_sides": ["bottom"]}
  ],
  "hardware": [
    {"name": "bisagra con freno", "quantity": 6, "unit_price_usd": 3}
  ]
}
"""
