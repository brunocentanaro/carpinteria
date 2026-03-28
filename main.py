from __future__ import annotations

import argparse
import asyncio
import json
import sys

from dotenv import load_dotenv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cotizador de carpintería")
    sub = parser.add_subparsers(dest="command")

    quote_p = sub.add_parser("quote", help="Generar cotización")
    input_group = quote_p.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--image", help="Imagen del plano de corte")
    input_group.add_argument("--pieces", help="JSON file con lista de piezas")
    input_group.add_argument("--interactive", action="store_true", help="Modo interactivo con agente")
    quote_p.add_argument("--material", help="Material de la placa")
    quote_p.add_argument("--thickness", type=float, help="Espesor en mm")
    quote_p.add_argument("--color", help="Color de la placa")
    quote_p.add_argument("--margin", type=float, help="Porcentaje de margen")

    sub.add_parser("prices", help="Mostrar precios del sheet")

    return parser


async def handle_quote_image(args: argparse.Namespace) -> None:
    from agents import Runner

    from carpinteria.agents.quote import create_quote_agent

    agent = create_quote_agent()
    prompt = f"Analizá esta imagen de plano de corte y generá la cotización: {args.image}"
    if args.material:
        prompt += f"\nMaterial: {args.material}"
    if args.thickness:
        prompt += f"\nEspesor: {args.thickness}mm"
    if args.color:
        prompt += f"\nColor: {args.color}"
    if args.margin:
        prompt += f"\nMargen: {args.margin}%"

    result = await Runner.run(agent, prompt, max_turns=10)
    print(result.final_output)


async def handle_quote_pieces(args: argparse.Namespace) -> None:
    from carpinteria.calculator import calculate_quotation
    from carpinteria.agents.quote import _format_quotation
    from carpinteria.schemas import CutPiece
    from carpinteria.settings import MARGIN_PERCENT
    from carpinteria.sheets_reader import read_price_list

    with open(args.pieces) as f:
        pieces_data = json.load(f)

    pieces = [CutPiece(**p) for p in pieces_data]
    price_list = read_price_list()

    material = args.material or pieces_data[0].get("material", "")
    thickness = args.thickness or pieces_data[0].get("thickness_mm", 0)
    color = args.color or pieces_data[0].get("color", "")
    margin = args.margin or MARGIN_PERCENT

    quotation = calculate_quotation(
        pieces=pieces,
        price_list=price_list,
        material=material,
        thickness_mm=thickness,
        color=color,
        margin_percent=margin,
    )
    print(_format_quotation(quotation))


async def handle_quote_interactive(args: argparse.Namespace) -> None:
    from agents import Runner

    from carpinteria.agents.quote import create_quote_agent

    agent = create_quote_agent()
    prompt = "Hola, necesito una cotización."
    if args.material:
        prompt += f" Material: {args.material}."
    if args.thickness:
        prompt += f" Espesor: {args.thickness}mm."
    if args.color:
        prompt += f" Color: {args.color}."

    result = await Runner.run(agent, prompt, max_turns=15)
    print(result.final_output)


async def handle_prices() -> None:
    from carpinteria.sheets_reader import read_price_list

    price_list = read_price_list()

    print("## Placas")
    for b in price_list.boards:
        print(f"  {b.material} {b.thickness_mm}mm {b.color} ({b.width_mm}x{b.height_mm}mm): ${b.price}")

    print("\n## Cantos")
    for eb in price_list.edge_bandings:
        print(f"  {eb.type} {eb.color}: ${eb.price_per_meter}/m")

    print("\n## Cortes")
    for cs in price_list.cut_services:
        print(f"  {cs.description}: ${cs.price_per_cut}/corte")


async def main_async() -> None:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "prices":
        await handle_prices()
    elif args.command == "quote":
        if args.image:
            await handle_quote_image(args)
        elif args.pieces:
            await handle_quote_pieces(args)
        elif args.interactive:
            await handle_quote_interactive(args)
    else:
        parser.print_help()
        sys.exit(1)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
