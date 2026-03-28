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
