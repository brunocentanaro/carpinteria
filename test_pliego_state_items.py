from carpinteria.pliego import _extract_state_purchase_items


def test_extracts_carpentry_items_from_item_first_sice_table():
    text = """
    ITEM Codigo SICE Cantidad Unidad de medida Objeto del gasto Detalle
    1 68518 30 unidad SILLA APILABLE Silla fija anatomica en plastico.
    2 3755 4 unidad SILLA GIRATORIA DE OFICINA Ergonomica y tapizada.
    3 4166 2 unidad MESA DE MADERA CON CABALLETE Tabla de madera de 200 x 80 cm y 2 caballetes.
    4 5520 2 unidad SILLA DE MADERA Sillon flexible en madera terciada y tapizado.
    5 5632 1 unidad MESA RATONA DE MADERA Mesa ratona circular en madera natural. Diametro 80 cm. Alto 40,5 cm.
    6 1140 2 unidad ARMARIO DE METAL Armario metalico con 2 puertas.
    7 5592 1 unidad ARMARIO DE MADERA Armario bajo en MDP de 25 mm, terminacion en melaminico. 2 puertas batientes. Dimensiones 80x45x73,5 cm.
    8 5602 3 unidad ESTANTERIA DE METAL Estanteria en chapa galvanizada.
    9 5527 10 unidad SILLA DE PLASTICO Silla de plastico reforzada.
    """

    items = _extract_state_purchase_items(text)

    assert [item["code"] for item in items] == ["I3", "I5", "I7"]
    assert [item["sice_code"] for item in items] == ["4166", "5632", "5592"]
    assert [item["quantity"] for item in items] == [2, 1, 1]
    assert items[0]["dimensions"]["width_mm"] == 2000
    assert items[0]["dimensions"]["depth_mm"] == 800
    assert items[1]["dimensions"] == {"width_mm": 800, "depth_mm": 800, "height_mm": 405}
    assert items[2]["dimensions"] == {"width_mm": 800, "depth_mm": 450, "height_mm": 735}
    assert items[2]["thickness_mm"] == 25
