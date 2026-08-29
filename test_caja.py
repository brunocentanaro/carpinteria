import sys
import unittest
from types import ModuleType
from unittest.mock import patch

try:
    import pymongo  # noqa: F401
except ModuleNotFoundError:
    pymongo_module = ModuleType("pymongo")
    pymongo_module.ReturnDocument = object()
    pymongo_module.MongoClient = type("MongoClient", (), {})
    pymongo_database_module = ModuleType("pymongo.database")
    pymongo_database_module.Database = type("Database", (), {})
    sys.modules["pymongo"] = pymongo_module
    sys.modules["pymongo.database"] = pymongo_database_module

try:
    import certifi  # noqa: F401
except ModuleNotFoundError:
    certifi_module = ModuleType("certifi")
    certifi_module.where = lambda: ""
    sys.modules["certifi"] = certifi_module

from carpinteria import accounting


def _match(row: dict, query: dict | None) -> bool:
    if not query:
        return True
    for key, condition in query.items():
        value = row.get(key)
        if isinstance(condition, dict):
            for op, operand in condition.items():
                if op == "$lte" and not (value is not None and value <= operand):
                    return False
                if op == "$gte" and not (value is not None and value >= operand):
                    return False
                if op == "$lt" and not (value is not None and value < operand):
                    return False
                if op == "$gt" and not (value is not None and value > operand):
                    return False
                if op == "$in" and value not in operand:
                    return False
        elif value != condition:
            return False
    return True


class _Cursor(list):
    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self


class MemCollection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    def create_index(self, *_args, **_kwargs):
        return None

    def find(self, query=None, _projection=None, **_kwargs):
        return _Cursor(dict(row) for row in self.rows if _match(row, query))

    def find_one(self, query=None, _projection=None, **_kwargs):
        for row in self.rows:
            if _match(row, query):
                return dict(row)
        return None

    def insert_one(self, doc):
        self.rows.append(dict(doc))

    def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _match(row, query):
                row.update(update.get("$set", {}))
                return
        if upsert:
            merged = {}
            merged.update(update.get("$setOnInsert", {}))
            merged.update(update.get("$set", {}))
            self.rows.append(merged)


def make_db(**collections) -> dict:
    return {name: MemCollection(rows) for name, rows in collections.items()}


def patched_collection(db):
    return patch.object(accounting, "collection", side_effect=lambda name: db.setdefault(name, MemCollection()))


class ArqueoTests(unittest.TestCase):
    def _cash_day(self):
        return [
            {"brand_id": "casa", "source": "opening_balance", "direction": "transfer", "category": "saldo_inicial", "payment_method": "efectivo", "amount": 1000, "currency": "UYU", "date": "2026-08-20"},
            {"brand_id": "casa", "direction": "income", "category": "facturas", "payment_method": "efectivo", "amount": 500, "currency": "UYU", "date": "2026-08-20"},
            {"brand_id": "casa", "direction": "expense", "category": "proveedores", "payment_method": "efectivo", "amount": 200, "currency": "UYU", "date": "2026-08-20"},
        ]

    def test_faltante_is_negative_difference(self):
        db = make_db(accounting_movements=self._cash_day())
        with patched_collection(db):
            result = accounting.register_till_handover({"date": "2026-08-20", "counted_cash": 1250}, "Cajero")
        handover = result["handover"]
        self.assertEqual(handover["theoretical_cash"], 1300.0)
        self.assertEqual(handover["difference"], -50.0)
        self.assertEqual(handover["cashier"], "Cajero")
        self.assertFalse(handover["overridden"])

    def test_sobrante_is_positive_difference(self):
        db = make_db(accounting_movements=self._cash_day())
        with patched_collection(db):
            result = accounting.register_till_handover({"date": "2026-08-20", "counted_cash": 1350}, "Cajero")
        self.assertEqual(result["handover"]["difference"], 50.0)

    def test_counted_cash_is_mandatory_and_non_negative(self):
        db = make_db(accounting_movements=self._cash_day())
        with patched_collection(db):
            with self.assertRaisesRegex(ValueError, "efectivo contado"):
                accounting.register_till_handover({"date": "2026-08-20"}, "Cajero")
            with self.assertRaisesRegex(ValueError, "no puede ser negativo"):
                accounting.register_till_handover({"date": "2026-08-20", "counted_cash": -10}, "Cajero")

    def test_re_registration_requires_override(self):
        db = make_db(accounting_movements=self._cash_day())
        with patched_collection(db):
            accounting.register_till_handover({"date": "2026-08-20", "counted_cash": 1300}, "Cajero")
            with self.assertRaisesRegex(ValueError, "ya fue entregada"):
                accounting.register_till_handover({"date": "2026-08-20", "counted_cash": 1300}, "Cajero")
            overridden = accounting.register_till_handover({"date": "2026-08-20", "counted_cash": 1290, "override": True}, "Cajero")
        self.assertTrue(overridden["handover"]["overridden"])
        self.assertEqual(overridden["handover"]["override_count"], 1)


class ConciliationTests(unittest.TestCase):
    def _coupons(self):
        return [
            {"fiserv_id": "1", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA DEBITO", "total_amount": 100, "bill_number": "101"},
            {"fiserv_id": "2", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA CREDITO", "total_amount": 200, "bill_number": "102"},
            {"fiserv_id": "3", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "Debit Mastercard", "total_amount": 50, "bill_number": "103"},
            {"fiserv_id": "4", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "Mastercard prepago", "total_amount": 30, "bill_number": "104"},
            {"fiserv_id": "5", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "Mastercard Credito", "total_amount": 300, "bill_number": "105"},
            {"fiserv_id": "6", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "Maestro", "total_amount": 40, "bill_number": "106"},
        ]

    def test_grouping_and_faltante_sobrante(self):
        handover = {
            "brand_id": "casa", "date": "2026-08-20",
            "card_totals": {"visa_debito": 100, "visa_credito": 150, "master_debito": 80, "master_credito": 400, "maestro": 40},
        }
        db = make_db(fiserv_transactions=self._coupons(), accounting_till_handovers=[handover], accounting_movements=[])
        with patched_collection(db):
            result = accounting.conciliate_cards("2026-08-20")
        self.assertEqual(result["caja_source"], "handover")
        per = {item["medio"]: item for item in result["per_medio"]}
        # Debit Mastercard (50) + Mastercard prepago (30) fold into master_debito.
        self.assertEqual(per["master_debito"]["pos_total"], 80.0)
        self.assertEqual(per["visa_debito"]["flag"], "")
        self.assertEqual(per["visa_credito"]["flag"], "faltante")   # pos 200 > caja 150
        self.assertEqual(per["master_credito"]["flag"], "sobrante")  # caja 400 > pos 300
        self.assertTrue(result["has_faltante"])
        self.assertTrue(result["has_sobrante"])

    def test_falls_back_to_registered_card_income_when_no_handover(self):
        movements = [
            {"brand_id": "casa", "date": "2026-08-20", "direction": "income", "payment_method": "visa", "card_payment_type": "debito", "amount": 100},
            {"brand_id": "casa", "date": "2026-08-20", "direction": "income", "payment_method": "master", "card_payment_type": "credito", "amount": 300},
        ]
        db = make_db(fiserv_transactions=self._coupons(), accounting_till_handovers=[], accounting_movements=movements)
        with patched_collection(db):
            result = accounting.conciliate_cards("2026-08-20")
        self.assertEqual(result["caja_source"], "movements")
        per = {item["medio"]: item for item in result["per_medio"]}
        self.assertEqual(per["visa_debito"]["caja_total"], 100.0)
        self.assertEqual(per["visa_debito"]["flag"], "")
        self.assertEqual(per["master_credito"]["caja_total"], 300.0)

    def test_pending_when_no_coupons(self):
        db = make_db(fiserv_transactions=[], accounting_till_handovers=[], accounting_movements=[])
        with patched_collection(db):
            result = accounting.conciliate_cards("2026-08-20")
        self.assertTrue(result["pending_sync"])
        self.assertFalse(result["has_coupons"])
        self.assertFalse(result["has_faltante"])


class CouponIntegrityTests(unittest.TestCase):
    def test_flags_empty_duplicate_and_out_of_range(self):
        coupons = [
            {"fiserv_id": "1", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA DEBITO", "total_amount": 10, "bill_number": "105"},
            {"fiserv_id": "2", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA DEBITO", "total_amount": 10, "bill_number": "105"},
            {"fiserv_id": "3", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA DEBITO", "total_amount": 10, "bill_number": ""},
            {"fiserv_id": "4", "sale_date": "2026-08-20", "transaction_type": "C", "state": "2", "product_name": "VISA DEBITO", "total_amount": 10, "bill_number": "900"},
        ]
        sales = [
            {"brand_id": "casa", "date": "2026-08-20", "direction": "income", "category": "facturas", "invoice_number": "100"},
            {"brand_id": "casa", "date": "2026-08-20", "direction": "income", "category": "facturas", "invoice_number": "110"},
        ]
        db = make_db(fiserv_transactions=coupons, accounting_till_handovers=[], accounting_movements=sales)
        with patched_collection(db):
            result = accounting.conciliate_cards("2026-08-20")
        integrity = result["coupon_integrity"]
        self.assertEqual(integrity["registered_bill_range"], {"min": 100, "max": 110})
        issues = {row["fiserv_id"]: row["issues"] for row in integrity["coupons"]}
        self.assertIn("duplicated", issues["1"])
        self.assertIn("duplicated", issues["2"])
        self.assertIn("empty", issues["3"])
        self.assertIn("out_of_range", issues["4"])
        self.assertEqual(len(integrity["flagged"]), 4)


class ProposedSettlementTests(unittest.TestCase):
    def test_dedupe_excludes_registered_and_zero_net(self):
        settlements = [
            {"acquirer": "fiserv", "settlement_number": "1000", "product_code": "H", "product_desc": "Mastercard Debit", "payment_date": "2026-08-25", "net_amount": 500},
            {"acquirer": "fiserv", "settlement_number": "1001", "product_code": "V", "product_desc": "Visa", "payment_date": "2026-08-26", "net_amount": 700},
            {"acquirer": "fiserv", "settlement_number": "1002", "product_code": "V", "product_desc": "Visa", "payment_date": "2026-08-27", "net_amount": 0},
        ]
        movements = [
            {"brand_id": "casa", "category": "acreditacion_tarjeta", "source_key": "fiserv-settlement:1000"},
        ]
        db = make_db(fiserv_settlements=settlements, accounting_movements=movements)
        with patched_collection(db):
            proposed = accounting.list_proposed_card_settlements()["proposed"]
        numbers = {item["settlement_number"] for item in proposed}
        self.assertEqual(numbers, {"1001"})
        self.assertEqual(proposed[0]["net_amount"], 700.0)
        self.assertFalse(proposed[0]["already_registered"])

    def test_confirm_creates_idempotent_movement(self):
        settlements = [
            {"acquirer": "fiserv", "settlement_number": "1001", "product_code": "V", "product_desc": "Visa", "payment_date": "2026-08-26", "net_amount": 700},
        ]
        card_income = [
            {"brand_id": "casa", "direction": "income", "category": "facturas", "payment_method": "visa", "amount": 700, "currency": "UYU"},
        ]
        db = make_db(fiserv_settlements=settlements, accounting_movements=card_income, accounting_day_closures=[])
        with patched_collection(db):
            result = accounting.confirm_card_settlement("1001", "Juan Pirone")
            again = accounting.confirm_card_settlement("1001", "Juan Pirone")
        self.assertEqual(result["net_amount"], 700.0)
        self.assertEqual(result["movement"]["category"], "acreditacion_tarjeta")
        self.assertEqual(result["movement"]["destination_account"], "banco")
        self.assertEqual(result["movement"]["source_key"], "fiserv-settlement:1001")
        self.assertTrue(again["already_registered"])


if __name__ == "__main__":
    unittest.main()
