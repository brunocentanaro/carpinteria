from datetime import datetime, timezone
import unittest
from unittest.mock import patch
from carpinteria import quotation_session as sessions


def matches(doc, query):
    for key, value in query.items():
        if key == "$and":
            if not all(matches(doc, clause) for clause in value):
                return False
        elif key == "$or":
            if not any(matches(doc, clause) for clause in value):
                return False
        elif isinstance(value, dict):
            if "$exists" in value and (key in doc) != value["$exists"]:
                return False
            if "$nin" in value and doc.get(key) in value["$nin"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class Cursor(list):
    def sort(self, *_args):
        return self


class Collection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query, *_args):
        return Cursor(doc for doc in self.docs if matches(doc, query))

    def insert_one(self, doc):
        self.docs.append(doc)


class PironeOriginTests(unittest.TestCase):
    def setUp(self):
        common = {"created_at": datetime(2026, 7, 5, tzinfo=timezone.utc), "user_id":"juan", "client_name":"Cliente compartido", "client_phone":"123", "items":[{"name":"Mesa", "material":"Eucaliptus"}]}
        self.docs = [dict(common, id="casa", brand_id="casa"), dict(common, id="legacy"), dict(common, id="pirone", brand_id="pirone")]
        self.collection = Collection(self.docs)
        self.mock = patch.object(sessions, "_coll", return_value=self.collection)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def test_pirone_tabs_separate_legacy_and_own_quotes(self):
        for origin, ids in [("casa", ["casa", "legacy"]), ("pirone", ["pirone"])]:
            with self.subTest(origin=origin):
                rows = sessions.list_sessions(brand_id="pirone", origin_brand=origin, search="eucaliptus")
                self.assertEqual([row["id"] for row in rows], ids)

    def test_origin_cannot_expand_casa_access(self):
        self.assertEqual(sessions.list_sessions(brand_id="casa", origin_brand="pirone"), [])

    def test_archive_respects_origin(self):
        months = sessions.list_session_archive(brand_id="pirone", origin_brand="pirone", year=2026)
        self.assertEqual(months[0]["count"], 1)
        self.assertEqual(months[0]["sessions"][0]["id"], "pirone")

    def test_crm_keeps_same_client_separate_between_companies(self):
        for brand, count, ids in [("casa", 2, ["casa", "legacy"]), ("pirone", 1, ["pirone"])]:
            with self.subTest(brand=brand):
                customers = sessions.list_crm_customers(brand)
                self.assertEqual(len(customers), 1)
                self.assertEqual(customers[0]["quotes_count"], count)
                self.assertEqual([order["session_id"] for order in customers[0]["orders"]], ids)

    def test_new_pirone_quote_enters_only_own_history(self):
        with patch.object(sessions, "_next_sequence", return_value=1):
            created = sessions.create_session(user_id="juan", brand_id="pirone")
        self.assertEqual(created.brand_id, "pirone")
        self.assertIn(created.id, [row["id"] for row in sessions.list_sessions(brand_id="pirone", origin_brand="pirone")])
        self.assertNotIn(created.id, [row["id"] for row in sessions.list_sessions(brand_id="pirone", origin_brand="casa")])


if __name__ == "__main__":
    unittest.main()

