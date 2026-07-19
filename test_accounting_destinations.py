import unittest
import sys
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

from carpinteria import accounting
from carpinteria.accounting import _account_balances, _destination_account


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = rows or []

    def create_index(self, *_args, **_kwargs):
        return None

    def find_one(self, *_args, **_kwargs):
        return None

    def insert_one(self, *_args, **_kwargs):
        return None

    def find(self, *_args, **_kwargs):
        return list(self.rows)


class AccountingDestinationTests(unittest.TestCase):
    def test_sale_payment_method_selects_the_expected_account(self) -> None:
        self.assertEqual(_destination_account("facturas", "efectivo"), "caja")
        self.assertEqual(_destination_account("facturas", "transferencia"), "banco")
        self.assertEqual(_destination_account("facturas", "deposito"), "banco")
        self.assertEqual(_destination_account("facturas", "tarjeta"), "financiera")
        self.assertEqual(_destination_account("facturas", "visa"), "financiera")
        self.assertEqual(_destination_account("factura_credito", "efectivo"), "cuentas_por_cobrar")

    def test_balances_keep_cash_bank_and_card_receivables_separate(self) -> None:
        movements = [
            {"direction": "transfer", "category": "saldo_inicial", "payment_method": "efectivo", "amount": 2977, "currency": "UYU"},
            {"direction": "income", "category": "facturas", "payment_method": "efectivo", "amount": 1000, "currency": "UYU"},
            {"direction": "expense", "category": "proveedores", "payment_method": "efectivo", "amount": 500, "currency": "UYU"},
            {"direction": "income", "category": "facturas", "payment_method": "transferencia", "amount": 800, "currency": "UYU"},
            {"direction": "income", "category": "facturas", "payment_method": "master", "amount": 600, "currency": "UYU"},
            {"direction": "transfer", "category": "acreditacion_tarjeta", "payment_method": "master", "amount": 400, "currency": "UYU"},
            {"direction": "income", "category": "factura_credito", "payment_method": "credito", "amount": 400, "currency": "UYU"},
            {"direction": "income", "category": "facturas", "payment_method": "efectivo", "amount": 99, "currency": "USD"},
        ]

        self.assertEqual(_account_balances(movements), {
            "cash": 3477.0,
            "bank": 1200.0,
            "card_receivables": 200.0,
            "accounts_receivable": 400.0,
        })

    def test_sales_invoice_requires_payment_method_and_stores_destination(self) -> None:
        movement = {
            "direction": "income",
            "category": "facturas",
            "amount": 1200,
            "currency": "UYU",
            "invoice_number": "A104",
            "issue_date": "2026-07-01",
            "due_date": "2026-07-01",
            "date": "2026-07-01",
            "year": 2026,
            "month": 7,
            "workday_number": 1,
        }
        with patch.object(accounting, "collection", return_value=FakeCollection()):
            with self.assertRaisesRegex(ValueError, "Falta medio de cobro"):
                accounting.register_movement(movement, "Juan Pirone")

            result = accounting.register_movement({**movement, "payment_method": "transferencia"}, "Juan Pirone")

        self.assertEqual(result["movement"]["destination_account"], "banco")
        self.assertNotIn("source_key", result["movement"])

    def test_monthly_sales_breakdown_does_not_count_non_sales_income(self) -> None:
        movements = FakeCollection([
            {"direction": "income", "category": "facturas", "payment_method": "efectivo", "amount": 100},
            {"direction": "income", "category": "facturas", "payment_method": "transferencia", "amount": 200},
            {"direction": "income", "category": "aportes", "payment_method": "efectivo", "amount": 500},
            {"direction": "expense", "category": "otros", "payment_method": "efectivo", "amount": 50},
        ])

        with patch.object(accounting, "collection", side_effect=lambda name: movements if name == "accounting_movements" else FakeCollection()):
            july = accounting.monthly_results(2026)[6]

        self.assertEqual(july["gross_sales"], 300)
        self.assertEqual(july["cash_sales"], 100)
        self.assertEqual(july["bank_sales"], 200)
        self.assertEqual(july["operating_result"], 250)

    def test_card_settlement_moves_pending_amount_to_bank(self) -> None:
        existing = FakeCollection([
            {"direction": "income", "category": "facturas", "payment_method": "master", "amount": 600, "currency": "UYU"},
        ])
        settlement = {
            "direction": "transfer",
            "category": "acreditacion_tarjeta",
            "payment_method": "master",
            "amount": 400,
            "currency": "UYU",
            "date": "2026-07-03",
            "year": 2026,
            "month": 7,
            "workday_number": 3,
        }

        with patch.object(accounting, "collection", side_effect=lambda name: existing if name == "accounting_movements" else FakeCollection()):
            result = accounting.register_movement(settlement, "Juan Pirone")
            with self.assertRaisesRegex(ValueError, "no puede superar"):
                accounting.register_movement({**settlement, "amount": 700}, "Juan Pirone")

        self.assertEqual(result["movement"]["origin_account"], "financiera")
        self.assertEqual(result["movement"]["destination_account"], "banco")

    def test_card_sale_requires_debit_or_credit_installments(self) -> None:
        sale = {
            "direction": "income",
            "category": "facturas",
            "payment_method": "master",
            "amount": 2400,
            "currency": "UYU",
            "invoice_number": "A105",
            "issue_date": "2026-07-04",
            "due_date": "2026-07-04",
            "date": "2026-07-04",
            "year": 2026,
            "month": 7,
            "workday_number": 4,
        }

        with patch.object(accounting, "collection", return_value=FakeCollection()):
            with self.assertRaisesRegex(ValueError, "debito o credito"):
                accounting.register_movement(sale, "Juan Pirone")
            result = accounting.register_movement({**sale, "card_plan": "credito_3"}, "Juan Pirone")

        self.assertEqual(result["movement"]["card_payment_type"], "credito")
        self.assertEqual(result["movement"]["card_installments"], 3)


if __name__ == "__main__":
    unittest.main()
