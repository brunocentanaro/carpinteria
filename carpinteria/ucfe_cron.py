from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from .db import close_db
from .ucfe import sync_received


def main() -> int:
    load_dotenv()
    lookback_days = max(1, int(os.getenv("UCFE_SYNC_LOOKBACK_DAYS", "7")))
    now = datetime.now(ZoneInfo("America/Montevideo"))
    start = (now.date() - timedelta(days=lookback_days - 1)).strftime("%d/%m/%Y")
    end = now.date().strftime("%d/%m/%Y")
    try:
        result = sync_received(
            start=start,
            end=end,
            company_id=os.getenv("UCFE_ID_EMPRESA", "478"),
            user="railway:ucfe-cron",
        )
        print(json.dumps({"ok": True, "start": start, "end": end, **result}, ensure_ascii=False, default=str))
        return 0
    finally:
        close_db()


if __name__ == "__main__":
    raise SystemExit(main())
