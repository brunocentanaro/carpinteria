"""Nightly Fiserv sync for La Casa del Carpintero, run as a separate Railway
service (see railway.fiserv-cron.toml). Pulls the closed batch, settlements and
the payment calendar so the day is complete even if nobody handed over the till.

Overlaps the last few days to catch late-posted settlements; the unique keys per
transaction and per settlement make repeated runs idempotent. Closes Mongo and
exits so Railway can schedule the next run.

Needs FISERV_USER, FISERV_PASS, FISERV_TOTP_SECRET, MONGO_URL (reference them
from the `carpinteria` web service).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from .db import close_db
from .fiserv import sync_range


def main() -> int:
    load_dotenv()
    lookback_days = max(1, int(os.getenv("FISERV_SYNC_LOOKBACK_DAYS", "10")))
    today = datetime.now(ZoneInfo("America/Montevideo")).date()
    start = today - timedelta(days=lookback_days - 1)
    try:
        result = sync_range(start, today, user="railway:fiserv-cron")
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
        return 0
    finally:
        close_db()


if __name__ == "__main__":
    raise SystemExit(main())
