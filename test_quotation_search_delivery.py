import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from carpinteria import quotation_session as sessions
from carpinteria.cli_api import _session_delivery_terms, _append_delivery_sheet, handle_session_list


class QuotationSearchDeliveryTests(unittest.TestCase):
    def test_search_products_material_accents_and_combined_terms(self):
        doc = {"items": [{"name": "Molduras", "material": "Eucaliptus", "description": "Zócalo"}]}
        for search in ["EUCALIPTUS", "molduras eucaliptus", "zocalo", "eucalyptus", "eucalipto"]:
            self.assertTrue(sessions._session_matches_search(doc, search))
        self.assertFalse(sessions._session_matches_search(doc, "molduras pino"))
        self.assertFalse(sessions._session_matches_search(doc, ".*"))

    def test_moldura_category_and_client_identifiers(self):
        doc = {"moldura_quotes": [{"description": "Perfil 10", "material": "Pino"}], "client_name": "José", "title": "Cotizacion 2026-07-042"}
        for search in ["molduras", "jose", "2026-07-042", "perfil pino"]:
            self.assertTrue(sessions._session_matches_search(doc, search))

    def test_search_filters_before_limit_and_keeps_access_scope(self):
        coll = MagicMock()
        base = {"created_at": datetime(2025, 1, 1, tzinfo=timezone.utc)}
        coll.find.return_value.sort.return_value = [dict(base, id="new", title="Pino"), dict(base, id="old", title="Eucaliptus")]
        with patch.object(sessions, "_coll", return_value=coll):
            rows = sessions.list_sessions(user_id="felipe", brand_id="casa", area="personal", search="eucaliptus", limit=1)
        self.assertEqual([row["id"] for row in rows], ["old"])
        query = coll.find.call_args.args[0]
        self.assertEqual(query["user_id"], "felipe")
        self.assertIn({"brand_id": "casa"}, query["$or"])

    def test_search_ignores_default_current_month_and_reports_more(self):
        with patch.object(sessions, "list_sessions", return_value=[{"id":"1"},{"id":"2"}]) as listing:
            result = handle_session_list({"search":"pino", "current_month":True, "limit":1})
        self.assertIsNone(listing.call_args.kwargs["year"])
        self.assertIsNone(listing.call_args.kwargs["month"])
        self.assertTrue(result["has_more"])
        self.assertEqual(len(result["sessions"]), 1)

    def test_delivery_persist_clear_and_legacy_default(self):
        self.assertEqual(sessions.QuotationSession(id="old").approved_quote_delivery_terms, {})
        coll = MagicMock()
        coll.find_one.return_value = {"id":"test"}
        with patch.object(sessions, "_coll", return_value=coll), patch.object(sessions, "get_session"):
            sessions.update_commercial_status("test", {"approved_quote_delivery_terms":{"item:M1":" 15 días desde la seña "}})
            self.assertEqual(coll.update_one.call_args.args[1]["$set"]["approved_quote_delivery_terms"], {"item:M1":"15 días desde la seña"})
            sessions.update_commercial_status("test", {"approved_quote_delivery_terms":{"item:M1":""}})
            self.assertEqual(coll.update_one.call_args.args[1]["$set"]["approved_quote_delivery_terms"], {"item:M1":""})
            with self.assertRaises(ValueError):
                sessions.update_commercial_status("test", {"approved_quote_delivery_terms":"15 días"})

    def test_delivery_export_and_excel_literal_text(self):
        from openpyxl import Workbook
        session = sessions.QuotationSession(id="test", items=[{"code":"M1","name":"Mesa"}], approved_quote_delivery_terms={"item:M1":"15 días hábiles"})
        self.assertEqual(_session_delivery_terms(session), ["Mesa: 15 días hábiles"])
        workbook = Workbook()
        _append_delivery_sheet(workbook, ["=texto literal"])
        self.assertEqual(workbook["Plazos de entrega"]["A2"].data_type, "s")


if __name__ == "__main__":
    unittest.main()
