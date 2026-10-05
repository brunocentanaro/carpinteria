"""Short descriptions and outstanding pricing, derived for existing and new requests."""
import re
import unicodedata
from datetime import datetime, timedelta, timezone


def _normalized(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def request_label(doc: dict) -> str:
    products = list(doc.get('items') or [])
    molduras = list(doc.get('moldura_quotes') or [])
    summary = str(doc.get('order_summary') or '')
    descriptions = ' '.join(str(p.get(k) or '') for p in products + molduras for k in ('name', 'description', 'family', 'material'))
    text = _normalized(descriptions + ' ' + summary)
    kinds = re.findall(r'\b(?:puertas?|muebles?|molduras?|mesas?|sillas?|placares?|placards?|armarios?|escritorios?|estantes?|estanterias?|repisas?|mostradores?|contramarcos?|ventanas?|zocalos?|listones?|barrotes?|varillas?|contravidrios?|cocinas?|bibliotecas?|portones?|escaleras?|cajoneras?|tableros?|marcos?)\b', text)
    kinds = list(dict.fromkeys(kinds))
    if not kinds and molduras:
        kinds = ['molduras']
    if len(kinds) > 1:
        # A mixed request should not look as if it contains only the first item.
        return f'{kinds[0]} y {kinds[1]}'
    material = re.search(r'\b(?:eucaliptus|eucalyptus|eucalipto|pino|roble|cedro|lapacho|mdf|melamin\w*|compensado|fenolico|hierro)\b', text)
    if kinds:
        label = kinds[0]
        if material:
            wood = material.group()
            if wood.startswith('melamin'):
                wood = 'melamina'
            if wood in {'eucalyptus', 'eucalipto'}:
                wood = 'eucaliptus'
            label += ' ' + wood
        return label
    fallback = next((str(p.get('name') or '').strip() for p in products if p.get('name')), summary.strip())
    return ' '.join(fallback.split()[:3]) or 'Sin detalle aún'


def _before_pricing_cutoff(doc: dict) -> bool:
    if doc.get('year') and doc.get('month'):
        return (int(doc['year']), int(doc['month'])) < (2026, 9)
    created = doc.get('created_at')
    if isinstance(created, str):
        created = datetime.fromisoformat(created.replace('Z', '+00:00'))
    if isinstance(created, datetime):
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        local = created.astimezone(timezone(timedelta(hours=-3)))
        return (local.year, local.month) < (2026, 9)
    return False


def needs_pricing(doc: dict) -> bool:
    return not _before_pricing_cutoff(doc) and _needs_pricing(doc)


def _needs_pricing(doc: dict) -> bool:
    if doc.get('source_type') in {'compras_estatales', 'manual_pliego'}:
        return False
    if (doc.get('order_number') or doc.get('delivered') or doc.get('ready_to_deliver')
            or doc.get('client_sent') or doc.get('client_accepted') in {'yes', 'no'}):
        return False
    keys = [f"item:{item.get('code')}" for item in doc.get('items') or []]
    keys += [f'moldura:{i}' for i, _ in enumerate(doc.get('moldura_quotes') or [])]
    amounts = doc.get('approved_quote_amounts') or {}
    if keys:
        return any((amounts.get(key) or 0) <= 0 for key in keys)
    # Old requests may only contain a written description and a single final price.
    return bool(str(doc.get('order_summary') or '').strip()) and not (doc.get('final_quote_amount') or 0) > 0


def pricing_status(doc: dict) -> str:
    if doc.get('client_accepted') == 'no':
        return 'rejected'
    if doc.get('delivered'):
        return 'delivered'
    if doc.get('order_number') or doc.get('ready_to_deliver') or doc.get('client_accepted') == 'yes':
        return 'accepted'
    if doc.get('client_sent'):
        return 'sent'
    if doc.get('source_type') in {'compras_estatales', 'manual_pliego'}:
        return 'tender'
    if _needs_pricing(doc):
        return 'historical' if _before_pricing_cutoff(doc) else 'pending'
    if doc.get('items') or doc.get('moldura_quotes') or (doc.get('final_quote_amount') or 0) > 0:
        return 'priced'
    return 'draft'
