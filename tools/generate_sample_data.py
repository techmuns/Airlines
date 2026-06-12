#!/usr/bin/env python3
"""
Generate SAMPLE (synthetic) data for the Airline Demand Monitor dashboard.

Stand-in for the real ETL output so the static dashboard is fully alive before
the data backend exists. Writes two files in the exact contract the backend
will fulfil:

    data/tsa.json   -> TSA daily checkpoint throughput + published YoY series
    data/data.json  -> IATA monthly global & regional traffic

The chart series mirror the client's reference exhibits (IATA Air Passenger
Market Analysis + TSA throughput), so the preview looks like the real product.
Deterministic (seeded) so the committed JSON is stable.

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

DATA_AS_OF = date(2026, 6, 10)          # latest TSA day
DISPLAY_START = date(2024, 1, 1)        # first day shown on the dashboard
MODEL_START = date(2022, 12, 20)        # hidden history for 7DMA + YoY baselines
GENERATED_AT = datetime(2026, 6, 11, 8, 30).isoformat() + "Z"

REGIONS = [
    "Industry", "Africa", "Asia/Pacific", "Europe",
    "Latin America", "Middle East", "North America",
]

# ===========================================================================
# 1) TSA daily checkpoint throughput
# ===========================================================================

# Weekday multipliers (0=Mon ... 6=Sun): Sun/Thu/Fri busy, Tue/Sat lighter.
_WEEKDAY = {0: 1.00, 1: 0.93, 2: 0.95, 3: 1.05, 4: 1.07, 5: 0.88, 6: 1.12}


def _holiday_factor(d: date) -> float:
    """Multiplicative holiday adjustments -> spikes/dips in charts + heatmap."""
    if (d.month, d.day) == (12, 25): return 0.62
    if (d.month, d.day) == (12, 24): return 0.78
    if (d.month, d.day) == (12, 23): return 1.10
    if (d.month, d.day) == (1, 1):   return 0.80
    if (d.month, d.day) == (7, 4):   return 0.82
    if (d.month, d.day) == (7, 3):   return 1.12
    if (d.month, d.day) == (7, 5):   return 1.08
    if d.month == 11:  # Thanksgiving (4th Thursday)
        nov1 = date(d.year, 11, 1)
        thanksgiving = nov1 + timedelta(days=(3 - nov1.weekday()) % 7) + timedelta(weeks=3)
        delta = (d - thanksgiving).days
        if delta == -1: return 1.14
        if delta == 0:  return 0.72
        if delta == 3:  return 1.16
    if d.month == 5:   # Memorial Day (last Monday)
        may31 = date(d.year, 5, 31)
        memorial = may31 - timedelta(days=may31.weekday())
        if (d - memorial).days == 0:  return 0.93
        if (d - memorial).days == -3: return 1.10
    if d.month == 9:   # Labor Day (first Monday)
        sep1 = date(d.year, 9, 1)
        labor = sep1 + timedelta(days=(0 - sep1.weekday()) % 7)
        if (d - labor).days == 0: return 0.94
    return 1.0


def _seasonal(d: date) -> float:
    """Annual seasonality: early-July peak, February trough."""
    return math.cos((d.timetuple().tm_yday - 190) / 365.0 * 2 * math.pi)


def _trend(d: date) -> float:
    """Saturating post-pandemic recovery: fast growth that plateaus near 2.39M,
    so derived year-over-year naturally decays from ~8% (2024) toward ~1% (2026),
    matching the client's TSA YoY exhibits."""
    days_from = (d - date(2023, 1, 1)).days
    return 2.39e6 - 0.42e6 * math.exp(-days_from / (1.5 * 365.0))


def _baseline_2019(d: date) -> float:
    return 2.30e6 * (1.0 + 0.135 * _seasonal(d)) * _WEEKDAY[d.weekday()]


def build_tsa_series():
    # raw daily model values across the full (incl. hidden) range
    raw = {}
    d = MODEL_START
    while d <= DATA_AS_OF:
        v = _trend(d) * (1.0 + 0.135 * _seasonal(d)) * _WEEKDAY[d.weekday()] \
            * _holiday_factor(d) * random.gauss(1.0, 0.013)
        raw[d] = int(round(v))
        d += timedelta(days=1)

    def sma7(dd):
        win = [raw[dd - timedelta(days=k)] for k in range(7) if (dd - timedelta(days=k)) in raw]
        return sum(win) / len(win)

    def pct(a, b):
        return None if (a is None or b is None or b == 0) else round((a / b - 1) * 100, 2)

    days, yoy_7dma = [], []
    d = DISPLAY_START
    while d <= DATA_AS_OF:
        p1, p7, p364 = d - timedelta(days=1), d - timedelta(days=7), d - timedelta(days=364)
        days.append({
            "date": d.isoformat(),
            "throughput": raw[d],
            "sevenDMA": int(round(sma7(d))),
            "dod": pct(raw[d], raw.get(p1)),
            "wow": pct(raw[d], raw.get(p7)),
            "yoy": pct(raw[d], raw.get(p364)),
            "vs2019": pct(raw[d], _baseline_2019(d)),
        })
        yoy_7dma.append({"date": d.isoformat(), "value": pct(sma7(d), sma7(p364))})
        d += timedelta(days=1)

    # Published monthly YoY % (client Exhibit: TSA Passenger Throughput, YoY %),
    # Jan 2024 .. Apr 2026 (1H Apr). Exact values from the reference.
    tsa_yoy_monthly_vals = [
        6.1, 6.2, 7.6, 5.4, 8.0, 6.4, 5.4, 5.5, 2.0, 0.8, 0.2, 6.6,
        1.7, 1.0, 0.2, -0.2, -1.7, 1.1, 1.0, 0.5, 4.0, -0.7, -0.5, 0.2,
        2.7, 1.7, 1.2, 1.2,
    ]
    ym = []
    y, m = 2024, 1
    for _ in range(len(tsa_yoy_monthly_vals)):
        ym.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1

    return {
        "_meta": {
            "source": "SAMPLE (synthetic) — replace with live TSA checkpoint ETL output",
            "description": "TSA checkpoint passenger throughput, daily, plus published monthly YoY.",
            "fields": {
                "throughput": "daily checkpoint passenger count",
                "sevenDMA": "trailing 7-day moving average",
                "dod": "day-over-day % vs previous day",
                "wow": "week-over-week % vs same weekday prior week",
                "yoy": "year-over-year % vs same weekday prior year",
                "vs2019": "% vs 2019 baseline",
            },
            "generated": GENERATED_AT,
            "latest_date": DATA_AS_OF.isoformat(),
        },
        "days": days,
        "yoy_monthly": {"months": ym, "values": tsa_yoy_monthly_vals},
        "yoy_7dma_daily": yoy_7dma,
    }


# ===========================================================================
# 2) IATA monthly traffic
# ===========================================================================

def month_keys(start=(2024, 1), n=26):
    keys, (y, m) = [], start
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return keys


MONTHS = month_keys()
N = len(MONTHS)

MARKET_SHARE = {
    "Industry": 100.0, "Asia/Pacific": 32.0, "Europe": 27.0, "North America": 24.0,
    "Middle East": 9.0, "Latin America": 5.0, "Africa": 3.0,
}
REGION6 = [r for r in REGIONS if r != "Industry"]

# Region trajectories — realistic post-pandemic normalisation with shape.
# Strong Asia/Pacific & Middle East, moderate Europe, mature North America, a
# volatile Africa, with a soft patch in late 2025 and an early-2026 rebound.
# Anchors are (month_index, value); smoothly interpolated below. RPK = demand,
# ASK = capacity, PLF = load-factor level (%).
RPK_ANCHORS = {
    "Asia/Pacific":  [(0, 15.5), (5, 12.0), (10, 9.6), (15, 8.2), (19, 7.4), (21, 6.6), (22, 4.0), (23, 2.4), (24, 5.6), (25, 7.4)],
    "Middle East":   [(0, 7.6), (6, 8.6), (12, 9.5), (18, 10.3), (21, 10.6), (23, 8.4), (25, 10.2)],
    "Europe":        [(0, 8.2), (4, 6.6), (8, 5.4), (12, 4.6), (16, 4.0), (19, 3.1), (21, 4.0), (23, 2.6), (25, 4.3)],
    "North America": [(0, 3.5), (6, 3.0), (12, 2.6), (18, 2.2), (22, 1.7), (23, 1.5), (25, 2.6)],
    "Latin America": [(0, 5.6), (5, 4.4), (9, 5.2), (12, 3.6), (15, 2.4), (18, 3.4), (21, 4.2), (23, 1.6), (25, 2.4)],
    "Africa":        [(0, 2.6), (4, 0.8), (7, -1.8), (10, 1.4), (13, -0.8), (16, 1.8), (19, -2.6), (22, -0.4), (24, -1.6), (25, -1.0)],
}
ASK_ANCHORS = {
    "Asia/Pacific":  [(0, 11.0), (6, 9.4), (12, 8.0), (18, 7.0), (22, 6.4), (23, 5.0), (25, 6.6)],
    "Middle East":   [(0, 7.0), (12, 8.4), (18, 9.0), (23, 8.6), (25, 8.8)],
    "Europe":        [(0, 6.2), (8, 4.8), (16, 3.6), (21, 3.4), (25, 3.6)],
    "North America": [(0, 3.3), (12, 2.9), (20, 2.7), (25, 2.9)],
    "Latin America": [(0, 3.4), (9, 2.6), (15, 2.0), (21, 3.0), (25, 2.6)],
    "Africa":        [(0, 1.4), (8, -1.0), (14, 0.6), (19, -1.6), (25, 0.6)],
}
PLF_ANCHORS = {
    "Asia/Pacific":  [(0, 80.4), (8, 82.0), (14, 83.2), (20, 84.1), (23, 82.6), (25, 83.9)],
    "Middle East":   [(0, 79.6), (12, 81.0), (20, 82.1), (25, 82.5)],
    "Europe":        [(0, 82.0), (10, 82.9), (18, 83.5), (25, 83.9)],
    "North America": [(0, 83.6), (12, 84.4), (20, 85.0), (25, 85.2)],
    "Latin America": [(0, 80.5), (12, 81.8), (20, 82.5), (25, 82.6)],
    "Africa":        [(0, 71.2), (7, 72.6), (13, 70.9), (19, 73.0), (25, 72.1)],
}
DOMESTIC_ANCHORS = [(0, 6.4), (6, 4.6), (12, 3.4), (18, 3.0), (23, 2.2), (25, 3.0)]
INTERNATIONAL_ANCHORS = [(0, 14.5), (6, 11.2), (12, 8.4), (17, 7.0), (20, 7.4), (23, 5.4), (25, 7.2)]


def _smooth_interp(anchors, n):
    """Smoothstep interpolation between anchor points -> organic curves."""
    xs = [a[0] for a in anchors]
    ys = [a[1] for a in anchors]
    out = []
    for i in range(n):
        if i <= xs[0]:
            out.append(ys[0]); continue
        if i >= xs[-1]:
            out.append(ys[-1]); continue
        for k in range(len(xs) - 1):
            if xs[k] <= i <= xs[k + 1]:
                t = (i - xs[k]) / (xs[k + 1] - xs[k])
                t = t * t * (3 - 2 * t)
                out.append(ys[k] + (ys[k + 1] - ys[k]) * t)
                break
    return out


def _shape(anchors, n, seasonal=0.0, noise=0.0, dp=1):
    base = _smooth_interp(anchors, n)
    out = []
    for i in range(n):
        s = seasonal * math.sin((i / 12.0) * 2 * math.pi)
        out.append(round(base[i] + s + random.uniform(-noise, noise), dp))
    return out


def build_iata():
    random.seed(20260612)  # stable IATA output independent of the TSA draws
    rpk, ask, plf = {}, {}, {}
    for r in REGION6:
        rpk[r] = _shape(RPK_ANCHORS[r], N, seasonal=0.3, noise=0.4)
        ask[r] = _shape(ASK_ANCHORS[r], N, seasonal=0.25, noise=0.35)
        plf[r] = _shape(PLF_ANCHORS[r], N, seasonal=0.5, noise=0.3)

    # Industry aggregate = market-share-weighted blend of the six regions.
    w = {r: MARKET_SHARE[r] / 100.0 for r in REGION6}

    def blend(series):
        return [round(sum(w[r] * series[r][i] for r in REGION6), 1) for i in range(N)]

    rpk["Industry"] = blend(rpk)
    ask["Industry"] = blend(ask)
    plf["Industry"] = blend(plf)

    domestic = _shape(DOMESTIC_ANCHORS, N, seasonal=0.3, noise=0.4)
    international = _shape(INTERNATIONAL_ANCHORS, N, seasonal=0.4, noise=0.4)

    return {
        "_meta": {
            "source": "SAMPLE (synthetic) — replace with live IATA Air Passenger Market Analysis ETL output",
            "description": "IATA global & regional airline traffic, monthly.",
            "metrics": {
                "rpk_yoy": "Revenue Passenger Kilometres, year-over-year %",
                "ask_yoy": "Available Seat Kilometres, year-over-year %",
                "plf": "Passenger Load Factor, level %",
            },
            "generated": GENERATED_AT,
            "latest_month": MONTHS[-1],
        },
        "months": MONTHS,
        "regions": REGIONS,
        "series": {"rpk_yoy": rpk, "ask_yoy": ask, "plf": plf},
        "global": {
            "domestic_rpk_yoy": domestic,
            "international_rpk_yoy": international,
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

    last = tsa["days"][-1]
    # quick YoY sanity: derived monthly averages year over year
    def mavg(year, month):
        vals = [x["throughput"] for x in tsa["days"] if x["date"][:7] == f"{year}-{month:02d}"]
        return sum(vals) / len(vals) if vals else None
    j24, j25, j26 = mavg(2024, 6), mavg(2025, 6), mavg(2026, 6)
    print(f"tsa.json : {len(tsa['days'])} days, {tsa['days'][0]['date']} .. {last['date']}")
    print(f"           latest {last['throughput']:,} | 7DMA {last['sevenDMA']:,} | "
          f"DoD {last['dod']}% WoW {last['wow']}% YoY {last['yoy']}%")
    print(f"           derived Jun YoY: 25v24 {round((j25/j24-1)*100,1)}% | 26v25 {round((j26/j25-1)*100,1)}%")
    print(f"           yoy_monthly: {len(tsa['yoy_monthly']['values'])} months "
          f"{tsa['yoy_monthly']['months'][0]}..{tsa['yoy_monthly']['months'][-1]}")
    print(f"data.json: {N} months {MONTHS[0]}..{MONTHS[-1]} | regions {len(REGIONS)}")
    print(f"           Industry RPK latest {iata['series']['rpk_yoy']['Industry'][-1]}% | "
          f"Dom {iata['global']['domestic_rpk_yoy'][-1]}% Intl {iata['global']['international_rpk_yoy'][-1]}%")


if __name__ == "__main__":
    main()
