from carpinteria.quote_router import classify_quote_type, validate_quote_lines
from carpinteria.wood_calculator import quote_solid_wood_table


def test_solid_wood_request_routes_to_glued_boards():
    route = classify_quote_type(
        "quiero una mesa en madera maciza, 1,2mts de largo, 0,6mts de ancho y "
        "0,65mts de altura, la madera es en pino de una pulgada, con patas de 3x3pulgadas"
    )
    assert route.quote_type == "madera_maciza"
    assert route.subtype == "tablas_encoladas"
    assert route.allowed_sources == ("Datos Maderas",)


def test_solid_wood_quote_uses_boards_not_panels():
    route = classify_quote_type("mesa en madera maciza de pino de una pulgada con patas 3x3")
    quote = quote_solid_wood_table(
        description=(
            "quiero una mesa en madera maciza, 1,2mts de largo, 0,6mts de ancho y "
            "0,65mts de altura, la madera es en pino de una pulgada, con patas de 3x3pulgadas"
        ),
        name="mesa",
        quantity=1,
        width_mm=1200,
        depth_mm=600,
        height_mm=650,
        material="pino",
        thickness_mm=25.4,
    )
    concepts = [line.concept for line in quote.lines]
    assert any("tablas para tapa encolada" in concept for concept in concepts)
    assert any("patas 3x3 pulgadas" in concept for concept in concepts)
    ok, forbidden = validate_quote_lines(route, concepts)
    assert ok, forbidden


def test_solid_wood_validator_rejects_panel_concepts():
    route = classify_quote_type("mesa en madera maciza de pino")
    ok, forbidden = validate_quote_lines(
        route,
        ["Placa MELAMINICO 25mm MDF MELAMINICO BLANCO", "Canto CANTO ABS BLANCO"],
    )
    assert not ok
    assert "mdf" in forbidden
    assert "canto abs" in forbidden
