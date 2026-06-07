from carpinteria.quote_router import classify_quote_type, validate_quote_lines
from carpinteria.wood_calculator import quote_solid_wood_table
from carpinteria.catalog import ProductCatalog
from carpinteria.lista_precios_parser import Producto


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


def test_direct_board_request_routes_to_passthrough_plate():
    route = classify_quote_type("piden directamente una placa completa MDF crudo 18mm, sin cantear")
    assert route.quote_type == "placa_directa"
    assert route.subtype == "pasamano"
    ok, forbidden = validate_quote_lines(route, ["Canto ABS", "Mano de obra"])
    assert not ok
    assert "canto abs" in forbidden
    assert "mano de obra" in forbidden


def test_tablones_route_to_solid_wood_not_panels():
    route = classify_quote_type("cotizar tablones de euca clear de 1 pulgada")
    assert route.quote_type == "madera_maciza"
    assert route.allowed_sources == ("Datos Maderas",)


def test_non_white_melamine_prefers_color_texture_reference():
    def placa(sku: str, nombre: str, precio: float) -> Producto:
        return Producto(
            sku=sku,
            codigo_proveedor=sku,
            proveedor="TEST",
            tipo_producto="PLACA",
            familia="MELAMINICO",
            material="MDF",
            nombre=nombre,
            descripcion=nombre,
            descripcion_normalizada=nombre.lower(),
            search_key=nombre.lower(),
            espesor_mm=18,
            ancho_mm=2600,
            largo_mm=1830,
            unidad="HOJA",
            precio_usd_simp=precio,
            precio_usd_cimp=precio,
            moneda_origen="USD",
            precio_origen_simp=precio,
            precio_origen_cimp=precio,
            tc_aplicado=1,
        )

    catalog = ProductCatalog([
        placa("BLANCO", "MDF MELAMINICO LACA BLANCO 18mm 2.60x1.83", 83.95),
        placa("BASICOS", "MDF MELAMINICO BASICOS 18mm 2.60 x 1.83", 69.99),
    ])
    match = catalog.find_placa("melaminico", 18, "gris sombra")
    assert match is not None
    assert match.producto.sku == "BASICOS"
