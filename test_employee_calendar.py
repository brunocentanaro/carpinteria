import unittest
from copy import deepcopy
from unittest.mock import patch
from carpinteria import employee_calendar as calendar


class Cursor(list):
    def sort(self, *_args):
        return self


class Collection:
    def __init__(self):
        self.docs = []

    @staticmethod
    def matches(doc, query):
        for key, value in query.items():
            if isinstance(value, dict):
                if "$gte" in value and doc[key] < value["$gte"]:
                    return False
                if "$lte" in value and doc[key] > value["$lte"]:
                    return False
            elif doc.get(key) != value:
                return False
        return True

    def find(self, query, *_args):
        return Cursor(deepcopy(doc) for doc in self.docs if self.matches(doc, query))

    def find_one(self, query, *_args):
        return next(iter(self.find(query)), None)

    def create_index(self, *_args):
        pass

    def insert_one(self, doc):
        self.docs.append(deepcopy(doc))

    def update_one(self, query, update):
        for doc in self.docs:
            if self.matches(doc, query):
                doc.update(deepcopy(update["$set"]))
                return


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.coll = Collection()
        patcher = patch.object(calendar, "collection", return_value=self.coll)
        patcher.start()
        self.addCleanup(patcher.stop)

    def create(self, brand="casa", employee="daniel", date="2026-09-22", **values):
        return calendar.save_task(brand, "juan", {"employee_id": employee, "date": date, "title": "Preparar pedido", **values})

    def test_employee_rosters(self):
        self.assertEqual([e["name"] for e in calendar.list_calendar("casa", "2026-09")["employees"]], ["Daniel", "Marcelo", "Cristopher"])
        self.assertEqual([e["name"] for e in calendar.list_calendar("pirone", "2026-09")["employees"]], ["Richard", "Leo", "Freddy", "José", "Alvan"])

    def test_save_reload_edit_cancel_restore(self):
        created = self.create(start_time="08:00", end_time="09:00", notes="Entrega al cliente")
        self.assertEqual(calendar.list_calendar("casa", "2026-09")["tasks"][0]["id"], created["id"])
        edited = calendar.save_task("casa", "marcelo", {"employee_id":"marcelo", "date":"2026-10-02", "status":"completed"}, created["id"])
        self.assertEqual(edited["notes"], "Entrega al cliente")
        self.assertEqual(edited["created_by"], "juan")
        self.assertEqual(edited["updated_by"], "marcelo")
        self.assertEqual(calendar.list_calendar("casa", "2026-09")["tasks"], [])
        for state in ["cancelled", "pending"]:
            calendar.save_task("casa", "juan", {"status":state}, created["id"])
            self.assertEqual(calendar.list_calendar("casa", "2026-10", "marcelo")["tasks"][0]["status"], state)

    def test_brand_and_employee_isolation(self):
        casa = self.create()
        pirone = self.create("pirone", "jose")
        self.assertEqual([t["id"] for t in calendar.list_calendar("pirone", "2026-09")["tasks"]], [pirone["id"]])
        self.assertIsNone(calendar.save_task("pirone", "juan", {"status":"completed"}, casa["id"]))
        self.assertEqual(calendar.list_calendar("casa", "2026-09", "marcelo")["tasks"], [])
        with self.assertRaises(ValueError):
            self.create("casa", "richard")
        with self.assertRaises(ValueError):
            calendar.list_calendar("casa", "2026-09", "richard")

    def test_date_boundaries_and_leap_day(self):
        self.create(date="2028-02-29")
        self.create(date="2028-03-01")
        self.assertEqual(len(calendar.list_calendar("casa", "2028-02")["tasks"]), 1)
        for bad in ["2026-02-29", "2026-13-01", "22/09/2026"]:
            with self.subTest(date=bad), self.assertRaises(ValueError):
                self.create(date=bad)

    def test_invalid_times_text_and_status_are_rejected(self):
        for values in [{"title":"  "}, {"title":"a" * 201}, {"start_time":"24:00"}, {"start_time":"9:00"}, {"end_time":"09:00"}, {"start_time":"10:00", "end_time":"09:00"}, {"status":"unknown"}, {"brand_id":"pirone"}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.create(**values)
        self.assertEqual(self.coll.docs, [])

    def test_missing_task_and_validation_report_status(self):
        result = calendar.handle_calendar({"action":"employee_calendar_save", "brand_id":"casa", "actor":"admin", "actor_area":"administracion", "all_access":True, "task_id":"missing", "values":{"status":"completed"}})
        self.assertEqual(result["status"], 404)
        result = calendar.handle_calendar({"action":"employee_calendar_list", "brand_id":"casa", "actor":"admin", "actor_area":"administracion", "all_access":True, "month":"2026-99"})
        self.assertEqual(result["status"], 400)


if __name__ == "__main__":
    unittest.main()
