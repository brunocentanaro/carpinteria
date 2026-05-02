"""MongoDB connection helper. Adapted from bonoxs-automation-backend/db.py.

`tz_aware=True` keeps datetimes UTC-aware after round-tripping through
the driver. Without that, datetimes come back naive and serialize to
JSON without the trailing "Z", which the front parses as local time.
"""
from __future__ import annotations

import os
from datetime import timezone

import certifi
from pymongo import MongoClient
from pymongo.database import Database

DB_NAME = os.getenv("MONGO_DB", "carpinteria")

_client: MongoClient | None = None


def get_db() -> Database:
    global _client
    if _client is None:
        uri = os.environ["MONGO_URL"]
        _client = MongoClient(
            uri,
            tz_aware=True,
            tzinfo=timezone.utc,
            tlsCAFile=certifi.where(),
        )
    return _client[DB_NAME]


def collection(name: str):
    return get_db()[name]
