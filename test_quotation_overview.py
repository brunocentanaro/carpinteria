import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from carpinteria.quotation_overview import request_label, needs_pricing, pricing_status
from carpinteria import quotation_session as sessions
from carpinteria.cli_api import handle_session_list


class QuotationOverviewTests(unittest.TestCase):
    def test_september_cutoff_includes_future_months_and_preserves_history(self):
        for date, expected in [('2026-09-01T02:59:59Z', False), ('2026-09-01T03:00:00Z', True), ('2027-01-01T12:00:00Z', True)]:
            doc = {'order_summary': 'Puerta', 'created_at': date}
            self.assertEqual(needs_pricing(doc), expected)
            self.assertEqual(pricing_status(doc), 'pending' if expected else 'historical')
        old = {'id': 'august', 'year': 2026, 'month': 8, 'order_summary': 'Puerta', 'updated_at': datetime(2026, 10, 5, tzinfo=timezone.utc)}
        self.assertFalse(needs_pricing(old))
        coll = MagicMock()
        coll.find.return_value.sort.return_value = [old]
        with patch.object(sessions, '_coll', return_value=coll):
            self.assertEqual(len(sessions.list_sessions()), 1)
            self.assertEqual(sessions.list_sessions(pending_only=True), [])

    def test_tenders_are_excluded_but_remain_in_history(self):
        for source in ['compras_estatales', 'manual_pliego']:
            doc = {'id': source, 'source_type': source, 'items': [{'code': 'p', 'name': 'Puerta'}]}
            with self.subTest(source=source):
                self.assertFalse(needs_pricing(doc))
                self.assertEqual(pricing_status(doc), 'tender')
                coll = MagicMock()
                coll.find.return_value.sort.return_value = [doc]
                with patch.object(sessions, '_coll', return_value=coll):
                    self.assertEqual(len(sessions.list_sessions()), 1)
                    self.assertEqual(sessions.list_sessions(pending_only=True), [])

    def test_distinct_price_and_lifecycle_labels(self):
        examples = [({}, 'draft'), ({'order_summary': 'Puerta'}, 'pending'),
                    ({'order_summary': 'Puerta', 'final_quote_amount': 500}, 'priced'),
                    ({'client_sent': True}, 'sent'), ({'client_accepted': 'no'}, 'rejected'),
                    ({'order_number': '22'}, 'accepted'), ({'delivered': True}, 'delivered')]
        for doc, expected in examples:
            with self.subTest(expected=expected):
                self.assertEqual(pricing_status(doc), expected)
                self.assertEqual(needs_pricing(doc), expected == 'pending')

    def test_short_labels_from_products_and_existing_written_requests(self):
        examples = [
            ({'items': [{'name': 'Puerta de entrada', 'material': 'Eucalyptus'}]}, 'puerta eucaliptus'),
            ({'order_summary': 'Necesito cotizar un mueble melamínico de 2 metros'}, 'mueble melamina'),
            ({'moldura_quotes': [{'material': 'Pino', 'description': 'Perfil 10x45'}]}, 'molduras pino'),
            ({'items': [{'name': 'Mesa'}, {'name': 'Sillas'}]}, 'mesa y sillas'),
            ({}, 'Sin detalle aún'),
        ]
        for doc, expected in examples:
            with self.subTest(doc=doc):
                self.assertEqual(request_label(doc), expected)
                self.assertLessEqual(len(request_label(doc).split()), 3)

    def test_only_manual_prices_resolve_pending_and_every_product_is_required(self):
        doc = {'items': [{'code': 'P1', 'last_quote': {'total': 2000}}], 'moldura_quotes': [{'total': 500}]}
        self.assertTrue(needs_pricing(doc))
        doc['approved_quote_amounts'] = {'item:P1': 1000}
        self.assertTrue(needs_pricing(doc))
        doc['approved_quote_amounts']['moldura:0'] = 500
        self.assertFalse(needs_pricing(doc))
        doc['approved_quote_amounts']['moldura:0'] = 0
        self.assertTrue(needs_pricing(doc))

    def test_closed_and_empty_requests_do_not_count(self):
        self.assertFalse(needs_pricing({}))
        for field, value in [('client_sent', True), ('client_accepted', 'no'), ('client_accepted', 'yes'), ('order_number', '23'), ('ready_to_deliver', True), ('delivered', True)]:
            self.assertFalse(needs_pricing({'order_summary': 'Puerta', field: value}))
        self.assertTrue(needs_pricing({'order_summary': 'Puerta'}))
        self.assertFalse(needs_pricing({'order_summary': 'Puerta', 'final_quote_amount': 500}))

    def test_pending_counts_since_september_without_changing_access_scope(self):
        coll = MagicMock()
        coll.find.return_value.sort.return_value = [
            {'id': 'empty'},
            {'id': 'old', 'order_summary': 'Puerta', 'created_at': datetime(2025, 1, 1, tzinfo=timezone.utc)},
            {'id': 'new', 'order_summary': 'Mesa'},
        ]
        with patch.object(sessions, '_coll', return_value=coll):
            result = handle_session_list({'pending_only': True, 'current_month': True, 'limit': 1, 'user_id': 'felipe', 'brand_id': 'casa', 'area': 'personal'})
        self.assertEqual(result['pending_count'], 1)
        self.assertEqual(result['sessions'][0]['id'], 'new')
        self.assertFalse(result['has_more'])
        self.assertEqual(coll.find.call_args.args[0]['user_id'], 'felipe')
        self.assertIn({'brand_id': 'casa'}, coll.find.call_args.args[0]['$or'])

    def test_summary_is_also_present_in_normal_history(self):
        row = sessions._session_row({'id': 'old', 'items': [{'code': 'p', 'name': 'Puerta', 'material': 'Pino'}]})
        self.assertEqual(row['request_label'], 'puerta pino')
        self.assertTrue(row['needs_pricing'])


if __name__ == '__main__':
    unittest.main()
