#!/usr/bin/env python3
"""
Generate SAMPLE (synthetic) data for the Airline Demand Monitor dashboard.

This is a stand-in for the real ETL output so the static dashboard is fully
alive before the data backend exists. It writes two files in the *exact*
source-agnostic contract the backend will fulfil:

    data/tsa.json   -> TSA daily checkpoint throughput  (date -> {throughput, 7dma, yoy, vs2019})
    data/data.json  -> IATA monthly traffic             (metric -> region -> month -> value)

When the live ETL is built it simply overwrites these two files with the same
shape and the dashboard updates with zero code changes.

Deterministic (seeded) so the committed JSON is stable across runs.

Usage:  python3 tools/generate_sample_data.py
"""

from __future__ import annotations

import json
import math
import os
import random
from datetime import date, datetime, timedelta

random.seed(20260610)  # deterministic output

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

DATA_AS_OF = date(2026, 6, 10)          # latest TSA day
TSA_START = date(2024, 1, 1)            # daily series start
GENERATED_AT = datetime(2026, 6, 11, 8, 30).isoformat() + "Z"

REGIONS = [
    "Industry",
    "Africa",
    "Asia/Pacific",
    "Europe",
    "Latin America",
    "Middle East",
    "North America",
]

# ===========================================================================
# 1) TSA daily checkpoint throughput
# ===========================================================================

# Weekday multipliers (0=Mon ... 6=Sun). TSA pattern: Sun/Thu/Fri busy,
# Tue/Sat lighter. Centred so the weekly mean is ~1.0.
_WEEKDAY = {0: 1.00, 1: 0.93, 2: 0.95, 3: 1.05, 4: 1.07, 5: 0.88, 6: 1.12}

# Day-specific holiday adjustments (multiplicative). Drives the visible
# spikes/dips in the daily + 7DMA charts and the calendar heatmap.
def _holiday_factor(d: date) -> float:
    y = d.year
    # fixed-date holidays
    if (d.month, d.day) == (12, 25):
        return 0.62
    if (d.month, d.day) == (12, 24):
        return 0.78
    if (d.month, d.day) == (12, 23):
        return 1.10
    if (d.month, d.day) == (1, 1):
        return 0.80
    if (d.month, d.day) == (7, 4):
        return 0.82
    if (d.month, d.day) == (7, 3):
        return 1.12
    if (d.month, d.day) == (7, 5):
        return 1.08
    # Thanksgiving: 4th Thursday of November
    if d.month == 11:
        nov1 = date(y, 11, 1)
        first_thu = nov1 + timedelta(days=(3 - nov1.weekday()) % 7)
        thanksgiving = first_thu + timedelta(weeks=3)
        delta = (d - thanksgiving).days
        if delta == -1:   # Wed before -> heavy
            return 1.14
        if delta == 0:    # Thursday -> light
            return 0.72
        if delta == 3:    # Sunday after -> heaviest rebound
            return 1.16
    # Memorial Day (last Monday of May) -> slightly light, Fri before heavy
    if d.month == 5:
        may31 = date(y, 5, 31)
        memorial = may31 - timedelta(days=(may31.weekday()))  # last Monday
        if (d - memorial).days == 0:
            return 0.93
        if (d - memorial).days == -3:
            return 1.10
    # Labor Day (first Monday of Sept)
    if d.month == 9:
        sep1 = date(y, 9, 1)
        labor = sep1 + timedelta(days=(0 - sep1.weekday()) % 7)
        if (d - labor).days == 0:
            return 0.94
    return 1.0


def _seasonal(d: date) -> float:
    """Annual seasonality: summer (early-July) peak, February trough."""
    doy = d.timetuple().tm_yday
    # peak near day 190 (early July)
    return math.cos((doy - 190) / 365.0 * 2 * math.pi)


def build_tsa_series():
    days = []
    raw = {}
    d = TSA_START
    n_total = (DATA_AS_OF - TSA_START).days
    i = 0
    while d <= DATA_AS_OF:
        # Long-term recovery/growth trend: ~2.00M -> ~2.40M (Jan24 -> Jun26)
        trend = 2.00e6 + (2.40e6 - 2.00e6) * (i / n_total)
        seasonal = 1.0 + 0.135 * _seasonal(d)
        weekday = _WEEKDAY[d.weekday()]
        holiday = _holiday_factor(d)
        noise = random.gauss(1.0, 0.013)
        value = trend * seasonal * weekday * holiday * noise
        raw[d] = int(round(value))
        d += timedelta(days=1)
        i += 1

    # Synthetic 2019 baseline (pre-pandemic reference for vs-2019), ~ 2.30M avg.
    # Uses the day's seasonal + weekday shape as a comparable-2019 reference.
    def baseline_2019(dd: date) -> int:
        seasonal = 1.0 + 0.135 * _seasonal(dd)
        weekday = _WEEKDAY[dd.weekday()]
        return int(round(2.30e6 * seasonal * weekday))

    ordered = sorted(raw)
    for d in ordered:
        window = [raw[d - timedelta(days=k)] for k in range(7) if (d - timedelta(days=k)) in raw]
        sevendma = int(round(sum(window) / len(window)))
        prior = d - timedelta(days=364)  # same weekday, prior year
        yoy = None
        if prior in raw:
            yoy = round((raw[d] / raw[prior] - 1) * 100, 2)
        b19 = baseline_2019(d)
        vs2019 = round((raw[d] / b19 - 1) * 100, 2)
        days.append({
            "date": d.isoformat(),
            "throughput": raw[d],
            "sevenDMA": sevendma,
            "yoy": yoy,
            "vs2019": vs2019,
        })

    return {
        "_meta": {
            "source": "SAMPLE (synthetic) — replace with live TSA checkpoint ETL output",
            "description": "TSA checkpoint passenger throughput, daily.",
            "unit": "passengers",
            "fields": {
                "throughput": "daily checkpoint passenger count",
                "sevenDMA": "trailing 7-day moving average",
                "yoy": "year-over-year % vs same weekday prior year (null if no baseline)",
                "vs2019": "% vs 2019 baseline",
            },
            "generated": GENERATED_AT,
            "latest_date": DATA_AS_OF.isoformat(),
        },
        "days": days,
    }


# ===========================================================================
# 2) IATA monthly traffic
# ===========================================================================

# 26 months: Jan 2024 .. Feb 2026
def month_keys(start=(2024, 1), n=26):
    keys = []
    y, m = start
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return keys


MONTHS = month_keys()
N = len(MONTHS)

# Industry Global System RPK YoY % — drives hero chart 1 (matches mockup).
INDUSTRY_RPK_YOY = [
    16.6, 21.5, 13.8, 11.0, 10.7, 9.1, 8.6, 8.0, 7.1, 7.1, 7.1, 8.1,
    8.6, 10.0, 2.6, 3.3, 5.0, 2.6, 4.0, 4.6, 3.6, 5.0, 6.6, 5.6, 3.8, 6.1,
]
assert len(INDUSTRY_RPK_YOY) == N

# Domestic vs International RPK YoY % — drives hero chart 2.
DOMESTIC_RPK_YOY = [
    10, 7, 5, 4, 5, 5, 5, 4, 4, 3, 9, 6,
    5, 3, 1, 2, 2, 3, 4, 3, 3, 2, 3, 2, 2, 2,
]
INTERNATIONAL_RPK_YOY = [
    21, 26, 19, 16, 15, 12, 11, 11, 10, 9, 12, 11,
    11, 9, 5, 7, 5, 7, 9, 8, 8, 7, 7, 6, 6, 6,
]
assert len(DOMESTIC_RPK_YOY) == N and len(INTERNATIONAL_RPK_YOY) == N

# Per-region snapshot targets (from the design reference). The dashboard
# DERIVES latest / 3M-rolling / 12M from the monthly series, so we build each
# series to reproduce these targets in its tail. Region series are not charted,
# only the derived figures are shown — so only the tail values matter.
#   rpk: (latest, 3m)   ask: (latest, 3m)   plf: (latest, 3m, 12m)
SNAPSHOT = {
    "Africa":        {"rpk": (-1.8, -3.9),  "ask": (-1.8, -2.8),  "plf": (69.9, 70.7, 71.4)},
    "Asia/Pacific":  {"rpk": (-3.9, -10.6), "ask": (-3.9, -8.5),  "plf": (77.3, 81.2, 81.6)},
    "Europe":        {"rpk": (-2.1, -3.0),  "ask": (-1.9, -2.1),  "plf": (81.4, 81.7, 82.1)},
    "Latin America": {"rpk": (-3.0, 2.6),   "ask": (-3.0, -2.1),  "plf": (81.4, 81.3, 81.7)},
    "Middle East":   {"rpk": (1.9, 6.0),    "ask": (3.5, 6.0),    "plf": (81.2, 80.8, 81.4)},
    "North America": {"rpk": (1.7, 2.7),    "ask": (2.6, 3.2),    "plf": (83.1, 83.4, 83.6)},
    # Industry ASK / PLF tuned to reference; Industry RPK comes from the chart series.
    "Industry":      {"ask": (6.1, 5.0),    "plf": (81.3, 80.6, 81.8)},
}

# RPK market share by region (% of industry RPK). Plausible IATA-style split.
MARKET_SHARE = {
    "Industry": 100.0,
    "Asia/Pacific": 32.0,
    "Europe": 27.0,
    "North America": 24.0,
    "Middle East": 9.0,
    "Latin America": 5.0,
    "Africa": 3.0,
}


def yoy_series_with_tail(latest, three_m, base=None):
    """26-month YoY% series whose last value == latest and trailing-3 mean == three_m."""
    if base is None:
        base = three_m
    head = [round(base + random.uniform(-1.2, 1.2), 1) for _ in range(N - 3)]
    # last 3: [2*R - L, R, L] -> mean R, last L (smooth progression into latest)
    tail = [round(2 * three_m - latest, 1), round(three_m, 1), round(latest, 1)]
    return head + tail


def plf_series_with_tail(latest, three_m, twelve_m):
    """26-month PLF level series matching latest, trailing-3 mean and trailing-12 mean."""
    s = [round(twelve_m + random.uniform(-1.0, 1.0), 1) for _ in range(N)]
    # last 3 -> mean three_m, last == latest
    s[N - 3] = round(2 * three_m - latest, 1)
    s[N - 2] = round(three_m, 1)
    s[N - 1] = round(latest, 1)
    # positions N-12 .. N-4 (9 values) so that trailing-12 mean == twelve_m
    fill = (12 * twelve_m - (s[N - 3] + s[N - 2] + s[N - 1])) / 9.0
    for k in range(N - 12, N - 3):
        s[k] = round(fill, 1)
    return s


def build_iata():
    rpk = {}
    ask = {}
    plf = {}

    # Industry RPK from the explicit chart series
    rpk["Industry"] = list(INDUSTRY_RPK_YOY)

    for region in REGIONS:
        snap = SNAPSHOT[region]
        if region != "Industry":
            rpk[region] = yoy_series_with_tail(*snap["rpk"])
        ask[region] = yoy_series_with_tail(*snap["ask"])
        plf[region] = plf_series_with_tail(*snap["plf"])

    return {
        "_meta": {
            "source": "SAMPLE (synthetic) — replace with live IATA Air Passenger Market Analysis ETL output",
            "description": "IATA global & regional airline traffic, monthly.",
            "metrics": {
                "rpk_yoy": "Revenue Passenger Kilometres, year-over-year %",
                "ask_yoy": "Available Seat Kilometres, year-over-year %",
                "plf": "Passenger Load Factor, level %",
            },
            "derived": {
                "latest": "last month in series",
                "3m_rolling": "trailing 3-month average",
                "plf_12m": "trailing 12-month average of PLF",
            },
            "generated": GENERATED_AT,
            "latest_month": MONTHS[-1],
        },
        "months": MONTHS,
        "regions": REGIONS,
        "series": {
            "rpk_yoy": rpk,
            "ask_yoy": ask,
            "plf": plf,
        },
        "global": {
            "domestic_rpk_yoy": list(DOMESTIC_RPK_YOY),
            "international_rpk_yoy": list(INTERNATIONAL_RPK_YOY),
        },
        "market_share": MARKET_SHARE,
    }


# ===========================================================================

def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    tsa = build_tsa_series()
    with open(os.path.join(DATA_DIR, "tsa.json"), "w") as f:
        json.dump(tsa, f, separators=(",", ":"))

    iata = build_iata()
    with open(os.path.join(DATA_DIR, "data.json"), "w") as f:
        json.dump(iata, f, indent=2)

    # console summary
    latest = tsa["days"][-1]
    print(f"tsa.json : {len(tsa['days'])} days, {tsa['days'][0]['date']} .. {latest['date']}")
    print(f"           latest throughput {latest['throughput']:,} | 7DMA {latest['sevenDMA']:,} | YoY {latest['yoy']}%")
    print(f"data.json: {N} months, {MONTHS[0]} .. {MONTHS[-1]} | regions {len(REGIONS)}")
    print(f"           Industry RPK YoY latest {iata['series']['rpk_yoy']['Industry'][-1]}%")


if __name__ == "__main__":
    main()
