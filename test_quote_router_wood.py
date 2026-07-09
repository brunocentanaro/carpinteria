from carpinteria.quote_router import classify_quote_type, validate_quote_lines
from carpinteria.wood_calculator import quote_solid_wood_table
from carpinteria.catalog import ProductCatalog
from carpinteria.lista_precios_parser import Producto
from carpinteria.agents.cotizador_chat import (
    _door_face_line,
    _door_face_thickness_mm,
    _is_wood_door_item,
    _needs_door_core_confirmation,
)
from carpinteria.quotation_session import QuotationItem


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


def test_round_pine_cuts_quote_without_height():
    route = classify_quote_type(
        "me das 20 cortes de tablas redonda de madera de 33x33cm en pino nacional, espesor una pulgada y media"
    )
    quote = quote_solid_wood_table(
        description=(
            "me das 20 cortes de tablas redonda de madera de 33x33cm en pino nacional, "
            "espesor una pulgada y media"
        ),
        name="cortes redondos",
        quantity=1,
        material="pino nacional",
        thickness_mm=38.1,
    )
    concepts = [line.concept for line in quote.lines]
    assert route.quote_type == "madera_maciza"
    assert quote.metadata["subtype"] == "cortes_redondos"
    assert quote.metadata["diameter_mm"] == 330
    assert any("20 cortes redondos" in concept for concept in concepts)
    ok, forbidden = validate_quote_lines(route, concepts)
    assert ok, forbidden


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


def test_furniture_doors_do_not_use_honeycomb_core():
    item = QuotationItem(
        code="I6",
        name="placard 4 estantes",
        description="2 puertas en MDF enchapado en melaminico con cerradura",
        material="MDF melaminico",
    )
    assert not _is_wood_door_item(item)
    assert not _needs_door_core_confirmation(item)


def test_structural_door_uses_honeycomb_core_only_when_explicit():
    item = QuotationItem(
        code="P1",
        name="puerta placa de paso",
        description="hoja de puerta enchapada en eucaliptus con marco y tapajuntas",
        material="madera",
    )
    assert _is_wood_door_item(item)
    assert not _needs_door_core_confirmation(item)


def test_ambiguous_wood_door_waits_for_core_confirmation():
    item = QuotationItem(
        code="P2",
        name="puerta de madera",
        description="puerta de madera 800 x 2100 mm",
        material="madera",
    )
    assert not _is_wood_door_item(item)
    assert _needs_door_core_confirmation(item)


def test_explicit_mdf_honeycomb_door_routes_to_core_quote():
    item = QuotationItem(
        code="P3",
        name="puertas banos soporte",
        description="puertas con nido de abeja, dos caras de MDF 5.5mm",
        material="MDF",
    )
    assert _is_wood_door_item(item)
    assert not _needs_door_core_confirmation(item)


def test_mdf_honeycomb_door_faces_use_mdf_55mm():
    product = Producto(
        sku="MDF55",
        codigo_proveedor="MDF55",
        proveedor="TEST",
        tipo_producto="PLACA",
        familia="MDF",
        material="MDF",
        nombre="MDF CRUDO 5.5mm 2.60x1.83",
        descripcion="MDF CRUDO 5.5mm 2.60x1.83",
        descripcion_normalizada="mdf crudo 5.5mm 2.60x1.83",
        search_key="mdf crudo 5.5mm",
        espesor_mm=5.5,
        ancho_mm=2600,
        largo_mm=1830,
        unidad="HOJA",
        precio_usd_simp=20,
        precio_usd_cimp=20,
        moneda_origen="USD",
        precio_origen_simp=20,
        precio_origen_cimp=20,
        tc_aplicado=1,
    )
    item = QuotationItem(
        code="P4",
        name="puerta con nido",
        description="puerta con nido de abeja, 2 caras de MDF 5.5mm",
        material="MDF",
    )
    line, note = _door_face_line(ProductCatalog([product]), 40, item, 2.0)
    assert note is None
    assert "MDF 5.5mm para 2 caras" in line.concept
    assert line.subtotal > 0


def test_mdf_face_thickness_ignores_door_dimensions_in_mm():
    item = QuotationItem(
        code="P5",
        name="puertas banos soporte",
        description=(
            "puertas con nido de abeja MDF 2055x667mm, 2050x666mm, "
            "van 2 caras de MDF 5.5mm en cada puerta"
        ),
        material="MDF",
    )
    assert _door_face_thickness_mm(item) == 5.5
