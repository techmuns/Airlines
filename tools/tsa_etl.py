#!/usr/bin/env python3
"""TSA checkpoint passenger volumes — ETL for the Airline Demand Monitor.

Reads TSA.gov's public daily passenger-volume table and fills data/tsa.json with
REAL daily throughput. The dashboard derives DoD / WoW / YoY / 7-day average in
the browser, so we only need {date, throughput} per day plus the two YoY exhibit
series (computed here). Real days are tracked in _meta so the UI can label them.

Modes:
  --diagnose   fetch the page and print the table structure (no write)
  (default)    fetch, parse, merge real days into data/tsa.json

Runs unattended in CI (see .github/workflows/update-tsa-data.yml).
Source: https://www.tsa.gov/travel/passenger-volumes  (public US-government data).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TSA_PATH = os.path.join(ROOT, "data", "tsa.json")
URL = "https://www.tsa.gov/travel/passenger-volumes"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


class _Table(HTMLParser):
    """Collect every table row as a list of plain-text cells."""
    def __init__(self):
        super().__init__()
        self.rows, self._row, self._cell, self._depth = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._depth += 1
        elif tag == "tr" and self._depth:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "table" and self._depth:
            self._depth -= 1
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row); self._row = None
        elif tag in ("td", "th") and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip()); self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def fetch_html(url: str = URL, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def extract_rows(html: str):
    p = _Table(); p.feed(html)
    return [r for r in p.rows if any(c for c in r)]


def parse_daily(html: str) -> dict:
    """Return {YYYY-MM-DD: throughput}. The current TSA table is simply
    'Date | Numbers' with rows like '6/11/2026 | 2,809,243'. A multi-year
    layout (a year-header row with per-year columns) is handled as a fallback."""
    rows = extract_rows(html)
    daily = {}
    for row in rows:
        if not row:
            continue
        m = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*", row[0])
        if not m:
            continue
        for cell in row[1:]:
            digits = re.sub(r"[^\d]", "", cell)
            if digits:
                try:
                    daily[_dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()] = int(digits)
                except ValueError:
                    pass
                break
    if daily:
        return daily

    # fallback: year-header row + date rows with one column per year
    year_cols = None
    for row in rows:
        years = [(i, int(c)) for i, c in enumerate(row) if re.fullmatch(r"20\d{2}", c.strip())]
        if len(years) >= 2:
            year_cols = years
            continue
        if not year_cols:
            continue
        m = re.search(r"(\d{1,2})/(\d{1,2})", row[0])
        if not m:
            continue
        mon, day = int(m.group(1)), int(m.group(2))
        for ci, yr in year_cols:
            if ci < len(row):
                digits = re.sub(r"[^\d]", "", row[ci])
                if digits:
                    try:
                        daily[_dt.date(yr, mon, day).isoformat()] = int(digits)
                    except ValueError:
                        pass
    return daily


def fetch_archive(date_yyyymmdd: str) -> str:
    """Fetch the TSA page as archived by the Internet Archive on/near a date.
    The 'id_' modifier returns the original page (no Wayback toolbar)."""
    url = "https://web.archive.org/web/%sid_/%s" % (date_yyyymmdd, URL)
    return fetch_html(url, timeout=60)


# ---------------------------------------------------------------------------
# Derived exhibit series (computed from the daily throughput)
# ---------------------------------------------------------------------------
def _monthly_yoy(days):
    groups = {}
    for d in days:
        groups.setdefault(d["date"][:7], []).append(d["throughput"])
    avg = {k: sum(v) / len(v) for k, v in groups.items()}
    months, values = [], []
    for k in sorted(avg):
        y, m = k.split("-")
        pk = "%d-%s" % (int(y) - 1, m)
        if pk in avg:
            months.append(k)
            values.append(round((avg[k] / avg[pk] - 1) * 100, 1))
    return {"months": months, "values": values}


def _sevendma_yoy(days):
    dma = {}
    for i, d in enumerate(days):
        win = [days[j]["throughput"] for j in range(max(0, i - 6), i + 1)]
        dma[d["date"]] = sum(win) / len(win)
    out = []
    for d in days:
        dt = _dt.date.fromisoformat(d["date"])
        try:
            prior = dt.replace(year=dt.year - 1).isoformat()
        except ValueError:                      # Feb 29
            prior = dt.replace(year=dt.year - 1, day=28).isoformat()
        pv = dma.get(prior)
        out.append({"date": d["date"],
                    "value": round((dma[d["date"]] / pv - 1) * 100, 2) if pv else None})
    return out


def update_tsa(daily: dict, path: str = TSA_PATH):
    with open(path) as f:
        data = json.load(f)

    merged = {d["date"]: d["throughput"] for d in data["days"]}     # sample baseline
    real = set()
    for date, val in daily.items():
        merged[date] = val
        real.add(date)

    days = [{"date": d, "throughput": int(round(merged[d]))} for d in sorted(merged)]
    before = json.dumps([data["days"], data.get("yoy_monthly"), data.get("yoy_7dma_daily")], sort_keys=True)

    data["days"] = days
    data["yoy_monthly"] = _monthly_yoy(days)
    data["yoy_7dma_daily"] = _sevendma_yoy(days)

    meta = data["_meta"]
    prev_real = set(meta.get("real_days", []))
    allreal = sorted(prev_real | real)
    meta["real_days"] = allreal
    if allreal:
        meta["real_from"] = allreal[0]
    meta["latest_date"] = days[-1]["date"]
    meta["source"] = ("TSA.gov checkpoint travel numbers (real for dates in real_days; "
                      "earlier dates are synthetic sample data).")

    changed = json.dumps([data["days"], data["yoy_monthly"], data["yoy_7dma_daily"]], sort_keys=True) != before
    if changed:
        meta["generated"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(path, "w") as f:
            json.dump(data, f, separators=(",", ":"))
    return data, changed, len(real)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="TSA passenger-volume ETL")
    ap.add_argument("--diagnose", action="store_true", help="print the page table structure and exit")
    ap.add_argument("--backfill", default="",
                    help="space-separated YYYYMMDD Internet-Archive snapshot dates to seed history")
    ap.add_argument("--url", default=URL)
    args = ap.parse_args(argv)

    if args.backfill:
        combined = {}
        for ts in args.backfill.split():
            try:
                dd = parse_daily(fetch_archive(ts))
                print("  archive %s -> %d days" % (ts, len(dd)))
                combined.update(dd)
            except Exception as e:  # noqa: BLE001
                print("  archive %s failed: %s" % (ts, str(e).splitlines()[0]))
        try:
            live = parse_daily(fetch_html())
            print("  live -> %d days" % len(live))
            combined.update(live)
        except Exception as e:  # noqa: BLE001
            print("  live fetch failed:", e)
        if not combined:
            print("ERROR: backfill produced no data.", file=sys.stderr)
            return 1
        data, changed, _ = update_tsa(combined)
        ds = sorted(combined)
        print("backfill parsed %d days (%s .. %s)" % (len(combined), ds[0], ds[-1]))
        print(("Updated data/tsa.json — %d days, real days total %d"
               % (len(data["days"]), len(data["_meta"]["real_days"]))) if changed else "No change.")
        return 0

    try:
        html = fetch_html(args.url)
    except Exception as e:  # noqa: BLE001
        print("ERROR fetching TSA page:", e, file=sys.stderr)
        return 1
    print("fetched %d bytes" % len(html))

    if args.diagnose:
        rows = extract_rows(html)
        print("tables/rows found:", len(rows))
        for r in rows[:8]:
            print("  ROW:", r[:8])
        daily = parse_daily(html)
        ds = sorted(daily)
        print("parsed daily points:", len(daily))
        if ds:
            print("  range:", ds[0], "->", ds[-1])
            for d in ds[-4:]:
                print("   ", d, daily[d])
        return 0

    daily = parse_daily(html)
    if not daily:
        print("ERROR: no daily rows parsed (TSA page layout may have changed).", file=sys.stderr)
        return 1
    data, changed, n = update_tsa(daily)
    ds = sorted(daily)
    print("parsed %d real days (%s .. %s)" % (n, ds[0], ds[-1]))
    if changed:
        print("Updated data/tsa.json — %d days, latest %s, real days total %d"
              % (len(data["days"]), data["_meta"]["latest_date"], len(data["_meta"]["real_days"])))
    else:
        print("No change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
