import sys
import unittest
from types import ModuleType

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

from carpinteria import fiserv

SAMPLE_TX = {
    "isClosed": False,
    "id": "2093440770332823787",
    "authDateTime": "28/08/2026 17:48:00",
    "terminal": "55609547",
    "transactionType": "C",
    "state": "2",
    "responseCode": "00",
    "authorizationCode": "231900",
    "currency": "858",
    "totalAmountForReport": 584,
    "amountToCustomer": "584",
    "taxAmountForReport": 0,
    "taxableAmountForReport": 478.69,
    "merchant": "19931450",
    "quotas": "01",
    "billNumber": "76892",
    "ticket": "0690",
    "batch": "041",
    "taxRefund": "0#19210",
    "cardNumber": "455110******9110",
    "emvApplicationName": "VISA CREDITO",
    "issuer": "0024",
}

SAMPLE_SETTLEMENT = {
    "paymentDate": "26/08/2026",
    "presentationDate": "24/08/2026",
    "settlmentNumber": "1576153",
    "merchantNumber": "19931450",
    "currencyCode": "858",
    "productCode": "H",
    "productDesc": "Mastercard Debit",
    "saleType": "D",
    "grossAmount": 8289,
    "signGrossAmount": "+",
    "discountAmount": 1090.22,
    "signDiscountAmount": "+",
    "netAmount": 7198.78,
    "signNetAmount": "+",
    "discountAmountArg": 87.06,
    "settlementTaxRI": 19.15,
    "concepts": [
        {"name": "ARANCEL", "amount": 87.06},
        {"name": "IVA CRED. FISC.COMERCIOS", "amount": 19.15},
        {"name": "CREDITO FISCAL LEY 19.210", "amount": 119.51},
        {"name": "RETENCION FISCAL LEY 17.453", "amount": 163},
        {"name": "CARGO TERMINAL FISERV", "amount": 701.5},
        {"name": "SUBTOTAL NETO DE PAGOS", "amount": 7198.78},
    ],
}


class NormalizeTransactionTests(unittest.TestCase):
    def test_core_fields(self):
        doc = fiserv._normalize_transaction(SAMPLE_TX)
        self.assertEqual(doc["fiserv_id"], "2093440770332823787")
        self.assertEqual(doc["acquirer"], "fiserv")
        self.assertEqual(doc["sale_date"], "2026-08-28")
        self.assertEqual(doc["batch"], "041")
        self.assertEqual(doc["bill_number"], "76892")
        self.assertEqual(doc["card_last4"], "9110")
        self.assertEqual(doc["total_amount"], 584.0)
        self.assertEqual(doc["product_name"], "VISA CREDITO")

    def test_missing_card_leaves_last4_none(self):
        row = dict(SAMPLE_TX)
        row.pop("cardNumber")
        doc = fiserv._normalize_transaction(row)
        self.assertIsNone(doc["card_last4"])


class NormalizeSettlementTests(unittest.TestCase):
    def test_key_and_amounts(self):
        doc = fiserv._normalize_settlement(SAMPLE_SETTLEMENT)
        self.assertEqual(doc["source_key"], "1576153:H")
        self.assertEqual(doc["payment_date"], "2026-08-26")
        self.assertEqual(doc["presentation_date"], "2026-08-24")
        self.assertEqual(doc["net_amount"], 7198.78)

    def test_concepts_mapped(self):
        doc = fiserv._normalize_settlement(SAMPLE_SETTLEMENT)
        self.assertEqual(doc["concepts"]["tariff"], 87.06)
        self.assertEqual(doc["concepts"]["tax_credit_19210"], 119.51)
        self.assertEqual(doc["concepts"]["withholding_17453"], 163.0)
        self.assertEqual(doc["concepts"]["fiserv_charge"], 701.5)

    def test_negative_sign_applied(self):
        row = dict(SAMPLE_SETTLEMENT, signNetAmount="-")
        doc = fiserv._normalize_settlement(row)
        self.assertEqual(doc["net_amount"], -7198.78)


class HelperTests(unittest.TestCase):
    def test_parse_dt_formats(self):
        self.assertEqual(fiserv._parse_dt("28/08/2026 17:48:00").date().isoformat(), "2026-08-28")
        self.assertEqual(fiserv._parse_dt("26/08/2026").date().isoformat(), "2026-08-26")
        self.assertEqual(fiserv._parse_dt("2026-08-27T00:00:00").date().isoformat(), "2026-08-27")
        self.assertIsNone(fiserv._parse_dt(""))
        self.assertIsNone(fiserv._parse_dt(None))

    def test_concept_key_fallback(self):
        self.assertEqual(fiserv._concept_key("ARANCEL"), "tariff")
        self.assertEqual(fiserv._concept_key("Algo Nuevo"), "algo_nuevo")


if __name__ == "__main__":
    unittest.main()
