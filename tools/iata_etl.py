#!/usr/bin/env python3
"""IATA Air Passenger Market — ETL for the Airline Demand Monitor.

Turns IATA's monthly "Air Passenger Market Analysis" PDF into the dashboard's
data/data.json. One PDF = one month of real, regional figures (RPK / ASK / PLF
year-on-year, plus PLF level and market share) for the six IATA regions, the
industry total, and the domestic / international split.

Modes
-----
  --pdf  PATH        parse a local PDF (e.g. an uploaded report) and update
  --pdf-url URL      download a PDF from a URL and update
  --fetch            try to discover & download the latest report from IATA
  --dry-run          parse and print, but do not write data/data.json

The parser reads the "Air passenger market in detail" table, which is stable
across IATA's monthly reports. Facts/figures (not the PDF itself) are stored.

It also keeps data/iata_detail.json (the Monthly Detail tab's System view)
current: that view is the same regional data, so each run extends it forward.

Designed to run unattended in CI (see .github/workflows/update-iata-data.yml):
fetch -> parse -> update data/data.json (+ iata_detail.json) -> commit ->
Cloudflare redeploys.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "data.json")
DETAIL_PATH = os.path.join(ROOT, "data", "iata_detail.json")

# IATA report region label (regex) -> dashboard region key. Reports vary: some
# use "Latin America and Caribbean", others "Latin America".
REGION_PATTERNS = [
    (r"TOTAL MARKET", "Industry"),
    (r"Africa", "Africa"),
    (r"Asia Pacific", "Asia/Pacific"),
    (r"Europe", "Europe"),
    (r"Latin America(?:\s+and\s+Caribbean)?", "Latin America"),
    (r"Middle East", "Middle East"),
    (r"North America", "North America"),
]
# Domestic-market label (regex) -> iata_detail country key. Reports prefix some
# months with "Dom." and write "China P.R." / "United States".
DOMESTIC_PATTERNS = [
    (r"(?:Dom\.\s*)?Australia", "Australia"),
    (r"(?:Dom\.\s*)?Brazil", "Brazil"),
    (r"(?:Dom\.\s*)?China(?:\s+P\.?R\.?)?", "China"),
    (r"(?:Dom\.\s*)?India", "India"),
    (r"(?:Dom\.\s*)?Japan", "Japan"),
    (r"(?:Dom\.\s*)?United States", "US"),
]
MONTHNUM = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"])}

_BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# A single number, optionally %-suffixed. Handles both report styles:
#   "100.0 -3.4 -2.9"      (space-separated, no %)
#   "100.0%2.6%3.4%"       (%-suffixed, no spaces)
NUM = r"(-?\d+(?:\.\d+)?)%?"


# ---------------------------------------------------------------------------
# PDF text extraction
# ---------------------------------------------------------------------------
def extract_text(pdf_path: str) -> str:
    from pdfminer.high_level import extract_text as _ext
    return _ext(pdf_path)


# ---------------------------------------------------------------------------
# Parse the "Air passenger market in detail" table
# ---------------------------------------------------------------------------
WORLD_ORDER = ["Africa", "Asia/Pacific", "Europe", "Latin America", "Middle East", "North America"]


def _row(text: str, label_pat: str):
    """Find `label_pat` immediately followed by 5 numbers (share, RPK, ASK,
    PLF pp, PLF level). The numbers must directly follow the label."""
    pat = label_pat + r"\s*" + r"\s*".join([NUM] * 5)
    m = re.search(pat, text)
    return [float(x) for x in m.groups()] if m else None


def _floats(text: str):
    return [float(x) for x in re.findall(r"-?\d+\.\d+", text)]


def _finalise(rec: dict) -> dict:
    """Sanity + a strong correctness check: the industry RPK must equal the
    share-weighted average of the six regional RPKs. A mis-read layout scrambles
    the region<->value mapping and fails this, so we never publish wrong data.

    The band stays wide (-100..100%): IATA genuinely reports large swings (e.g.
    Middle East -46.6% in Apr 2026 from airspace disruption), so correctness is
    enforced by the reconciliation check below, not by a tight value band."""
    for v in rec["regions"].values():
        if not (0 < v["share"] <= 100 and 40 < v["plf"] < 100
                and -100 < v["rpk"] < 100 and -100 < v["ask"] < 100):
            raise ValueError("%s: figures out of sane range." % rec["month"])
    ws = sum(rec["regions"][k]["share"] for k in WORLD_ORDER)
    wr = sum(rec["regions"][k]["share"] * rec["regions"][k]["rpk"] for k in WORLD_ORDER) / ws
    if abs(wr - rec["industry"]["rpk"]) > 1.0:
        raise ValueError("%s: regional RPKs (wtd %.2f) don't reconcile with industry %.2f."
                         % (rec["month"], wr, rec["industry"]["rpk"]))
    return rec


def _parse_row_major(block: str, month: str) -> dict:
    """Newer/older row layout: each region label is followed by its numbers."""
    t0 = block.find("TOTAL MARKET")
    t_intl = block.find("International", t0)
    if t0 == -1 or t_intl == -1:
        raise ValueError("row-major markers not found")
    world = block[t0:t_intl]
    industry, regions = None, {}
    for pat, key in REGION_PATTERNS:
        row = _row(world, pat)
        if row is None:
            continue
        share, rpk, ask, plf_pp, plf = row
        r = {"share": share, "rpk": rpk, "ask": ask, "plf": plf, "plf_pp": plf_pp}
        if key == "Industry":
            industry = r
        else:
            regions[key] = r
    if industry is None or len(regions) != 6:
        raise ValueError("row-major parsed %d/6 regions" % len(regions))
    intl = _row(block[t_intl:], "International")
    dom_idx = block.find("Domestic", t_intl)
    dom = _row(block[dom_idx:], "Domestic") if dom_idx != -1 else None
    return _finalise({"month": month, "industry": industry, "regions": regions,
                      "international_rpk": intl[1] if intl else None,
                      "domestic_rpk": dom[1] if dom else None})


def _parse_column_major(block: str, month: str) -> dict:
    """Other layout: all row labels first, then a column of share values, then
    RPK, ASK, PLF(pp) and PLF(level) columns. The value columns include the
    industry total (one more entry than the share column, where the total's
    100.0 is inline). World regions are always Africa, Asia Pacific, Europe,
    Latin America, Middle East, North America — so values map by position."""
    i_note = block.find("Note 1")
    if i_note == -1:
        raise ValueError("column-major: 'Note 1' not found")
    # The note itself reads "% of industry RPK in <year>", so start the column
    # scan only after that line to avoid matching its embedded "RPK".
    nm = re.match(r"Note 1[^\n]*?20\d{2}", block[i_note:])
    start = i_note + (nm.end() if nm else len("Note 1"))
    i_rpk = block.find("RPK", start)
    i_ask = block.find("ASK", i_rpk) if i_rpk != -1 else -1
    i_pp = block.find("PLF (%-pt)", i_ask) if i_ask != -1 else -1
    i_lvl = block.find("PLF (level)", i_ask) if i_ask != -1 else -1
    if min(i_rpk, i_ask, i_pp, i_lvl) < 0:
        raise ValueError("column-major markers not found")
    share = _floats(block[start:i_rpk])
    rpk = _floats(block[i_rpk:i_ask])
    ask = _floats(block[i_ask:i_pp])
    after_lvl = block[i_lvl + len("PLF (level)"):]
    n2 = after_lvl.find("Note 2")
    plf_all = _floats(after_lvl[:n2] if n2 != -1 else after_lvl)
    if len(share) < 6 or len(rpk) < 7 or len(ask) < 7 or len(plf_all) < 14 or len(plf_all) % 2:
        raise ValueError("column-major: unexpected value counts")
    plf_lvl = plf_all[len(plf_all) // 2:]                 # 2nd half = PLF level
    if any(not (40 < x < 100) for x in plf_lvl[:7]):
        raise ValueError("column-major: PLF split looks wrong")
    industry = {"share": 100.0, "rpk": rpk[0], "ask": ask[0], "plf": plf_lvl[0], "plf_pp": plf_all[0]}
    regions = {key: {"share": share[k], "rpk": rpk[k + 1], "ask": ask[k + 1],
                     "plf": plf_lvl[k + 1], "plf_pp": plf_all[k + 1]}
               for k, key in enumerate(WORLD_ORDER)}
    intl_rpk = rpk[7] if len(share) > 6 and 55 < share[6] < 68 and len(rpk) > 7 else None
    dom_rpk = rpk[14] if len(share) > 13 and 30 < share[13] < 45 and len(rpk) > 14 else None
    return _finalise({"month": month, "industry": industry, "regions": regions,
                      "international_rpk": intl_rpk, "domestic_rpk": dom_rpk})


def _parse_column_blocks(block: str, month: str) -> dict:
    """Modern column layout (e.g. mid-2025 reports): region labels and the world
    share column come *before* 'Note 1', then the year-on-year RPK, ASK,
    PLF(%-pt) and PLF(level) each appear as a clean block of 21 values
    (7 world + 7 international + 7 domestic). We read the world block; the
    reconciliation check in _finalise rejects any mis-aligned read."""
    i_note = block.find("Note 1")
    if i_note == -1:
        raise ValueError("column-blocks: 'Note 1' not found")
    ws = _floats(block[:i_note])[:7]
    nums = _floats(block[i_note:])
    if len(ws) < 7:
        raise ValueError("column-blocks: shares not found")
    # Two extraction variants occur in practice; try each and let _finalise's
    # reconciliation pick the right one (a mis-aligned read never reconciles).
    # (industry rpk/ask/plf idx), (region rpk/ask/plf start), intl idx, dom idx
    variants = [
        ((0, 21, 63), (1, 22, 64), 7, 14),     # clean 21-value blocks, total first   (e.g. Jul 2025)
        ((1, 2, 4),   (5, 25, 65), 11, 18),    # stray share + grouped totals, then 20 (e.g. Aug 2025)
    ]
    for (ii, rs, intl_i, dom_i) in variants:
        if max(ii[0], ii[1], ii[2], rs[0] + 5, rs[1] + 5, rs[2] + 5, intl_i, dom_i) >= len(nums):
            continue
        industry = {"share": 100.0, "rpk": nums[ii[0]], "ask": nums[ii[1]], "plf": nums[ii[2]], "plf_pp": 0.0}
        regions = {key: {"share": ws[k + 1], "rpk": nums[rs[0] + k], "ask": nums[rs[1] + k],
                         "plf": nums[rs[2] + k], "plf_pp": 0.0}
                   for k, key in enumerate(WORLD_ORDER)}
        try:
            return _finalise({"month": month, "industry": industry, "regions": regions,
                              "international_rpk": nums[intl_i], "domestic_rpk": nums[dom_i]})
        except ValueError:
            continue
    raise ValueError("column-blocks: no variant reconciled")


def _parse_row_major_pct(block: str, month: str) -> dict:
    """Older compact layout (e.g. early-2024 reports): each row is the label
    glued to eight percentages with no separators — share, RPK, ASK, PLF(%-pt)
    [year-on-year], the same three vs-2019, then PLF(level)."""
    t0 = block.find("TOTAL MARKET")
    if t0 == -1:
        raise ValueError("row-major-%: no TOTAL MARKET")
    t_intl = block.find("International", t0)
    world = block[t0:t_intl] if t_intl != -1 else block[t0:]
    pct8 = r"\s*" + "".join([r"(-?\d+\.\d+)%"] * 8)
    industry, regions = None, {}
    for pat, key in REGION_PATTERNS:
        m = re.search(pat + pct8, world)
        if not m:
            continue
        g = [float(x) for x in m.groups()]
        r = {"share": g[0], "rpk": g[1], "ask": g[2], "plf": g[7], "plf_pp": g[3]}
        if key == "Industry":
            industry = r
        else:
            regions[key] = r
    if industry is None or len(regions) != 6:
        raise ValueError("row-major-%: parsed %d/6 regions" % len(regions))

    def _row_rpk(lbl):
        m = re.search(lbl + pct8, block)
        return float(m.group(2)) if m else None
    return _finalise({"month": month, "industry": industry, "regions": regions,
                      "international_rpk": _row_rpk("International"),
                      "domestic_rpk": _row_rpk("Domestic")})


def parse_intl_dom(block: str) -> dict:
    """Extract the International and Domestic sections of the detail table —
    per-region (International) and per-country (Domestic) share / RPK / ASK / PLF
    level. Reuses _row, which reads the first five numbers after a label and
    ignores the year-to-date columns. Best-effort: returns whatever it finds.
    Keys are the dashboard's group names (so they merge straight into
    data/iata_detail.json's 'international' and 'domestic' views)."""
    out = {"international": {}, "domestic": {}}
    i_intl = block.find("International")
    i_dom = block.find("Domestic", i_intl) if i_intl != -1 else block.find("Domestic")
    i_note = block.find("Note 1")
    if i_note == -1:
        i_note = len(block)

    if i_intl != -1 and i_dom != -1:
        sec = block[i_intl:i_dom]
        hdr = _row(sec, "International")               # section total = "Industry" row
        if hdr:
            out["international"]["Industry"] = {"share": hdr[0], "rpk": hdr[1], "ask": hdr[2], "plf": hdr[4]}
        for pat, key in REGION_PATTERNS:
            if key == "Industry":
                continue
            row = _row(sec, pat)
            if row:
                out["international"][key] = {"share": row[0], "rpk": row[1], "ask": row[2], "plf": row[4]}

    if i_dom != -1:
        sec = block[i_dom:i_note]
        hdr = _row(sec, "Domestic")
        if hdr:
            out["domestic"]["Industry"] = {"share": hdr[0], "rpk": hdr[1], "ask": hdr[2], "plf": hdr[4]}
        for pat, key in DOMESTIC_PATTERNS:
            row = _row(sec, pat)
            if row:
                out["domestic"][key] = {"share": row[0], "rpk": row[1], "ask": row[2], "plf": row[4]}
    return out


def parse_detail(text: str) -> dict:
    # Use the most complete table (the full regional one near the end).
    idx = text.rfind("Air passenger market in detail")
    if idx == -1:
        raise ValueError("Could not find the 'Air passenger market in detail' table.")
    block = text[idx:]
    mm = re.search(r"Air passenger market in detail\s*-\s*([A-Za-z]+)\s+(\d{4})", block)
    if not mm or mm.group(1) not in MONTHNUM:
        raise ValueError("Could not read the report month from the table header.")
    month = "%04d-%02d" % (int(mm.group(2)), MONTHNUM[mm.group(1)])
    rec = None
    for parser in (_parse_row_major, _parse_column_major,
                   _parse_column_blocks, _parse_row_major_pct):
        try:
            rec = parser(block, month)
            break
        except ValueError:
            continue
    if rec is None:
        raise ValueError("no parser matched the detail-table layout for %s" % month)
    try:                                                # additive: International/Domestic detail
        extra = parse_intl_dom(block)
        rec["international_detail"] = extra["international"]
        rec["domestic_detail"] = extra["domestic"]
    except Exception:                                   # never let this break the core parse
        rec["international_detail"], rec["domestic_detail"] = {}, {}
    return rec


# ---------------------------------------------------------------------------
# Merge a parsed month into data/data.json
# ---------------------------------------------------------------------------
def _next_month(mk: str) -> str:
    y, m = int(mk[:4]), int(mk[5:7])
    m += 1
    if m > 12:
        m, y = 1, y + 1
    return "%04d-%02d" % (y, m)


def _months_between(after: str, upto: str):
    out, cur = [], _next_month(after)
    while True:
        out.append(cur)
        if cur == upto or len(out) > 600:
            break
        cur = _next_month(cur)
    return out


def _payload_blob(data: dict) -> str:
    """Stable snapshot of the meaningful data (ignores _meta timestamp)."""
    return json.dumps({k: data[k] for k in ("months", "series", "global", "market_share")},
                      sort_keys=True)


def update_data(rec: dict, path: str = DATA_PATH):
    """Merge a parsed month; write only if the data actually changed.

    Returns (data, changed: bool) so callers / CI can skip empty commits.
    """
    with open(path) as f:
        data = json.load(f)
    before = _payload_blob(data)

    months = data["months"]
    series = data["series"]
    target = rec["month"]

    if target not in months:
        if target < months[0]:
            # back-fill a month before the current start: prepend it.
            months.insert(0, target)
            for r in data["regions"]:
                series["rpk_yoy"][r].insert(0, None)
                series["ask_yoy"][r].insert(0, None)
                series["plf"][r].insert(0, None)
            data["global"]["domestic_rpk_yoy"].insert(0, None)
            data["global"]["international_rpk_yoy"].insert(0, None)
        elif target > months[-1]:
            for mk in _months_between(months[-1], target):
                months.append(mk)
                for r in data["regions"]:
                    series["rpk_yoy"][r].append(None)
                    series["ask_yoy"][r].append(None)
                    series["plf"][r].append(None)
                data["global"]["domestic_rpk_yoy"].append(None)
                data["global"]["international_rpk_yoy"].append(None)
        else:
            # interior gap (back-filling a month between existing ones): insert
            # the slot in chronological order so every series stays aligned.
            idx = next(j for j, mk in enumerate(months) if mk > target)
            months.insert(idx, target)
            for r in data["regions"]:
                series["rpk_yoy"][r].insert(idx, None)
                series["ask_yoy"][r].insert(idx, None)
                series["plf"][r].insert(idx, None)
            data["global"]["domestic_rpk_yoy"].insert(idx, None)
            data["global"]["international_rpk_yoy"].insert(idx, None)

    i = months.index(target)

    def put(metric, key, value):
        series[metric][key][i] = value

    for key, v in rec["regions"].items():
        put("rpk_yoy", key, v["rpk"])
        put("ask_yoy", key, v["ask"])
        put("plf", key, v["plf"])
    ind = rec["industry"]
    put("rpk_yoy", "Industry", ind["rpk"])
    put("ask_yoy", "Industry", ind["ask"])
    put("plf", "Industry", ind["plf"])

    data["global"]["domestic_rpk_yoy"][i] = rec["domestic_rpk"]
    data["global"]["international_rpk_yoy"][i] = rec["international_rpk"]

    # market shares change year to year; only adopt them from the newest month
    # so back-filling older months never overwrites the current shares.
    if target == months[-1]:
        data["market_share"] = {"Industry": 100.0}
        for key, v in rec["regions"].items():
            data["market_share"][key] = v["share"]

    meta = data["_meta"]
    real = set(meta.get("real_months", []))
    real.add(target)
    meta["real_months"] = sorted(real)
    meta["source"] = ("IATA Economics — Air Passenger Market Analysis (iata.org), monthly. "
                      "Every month shown is a reported IATA figure.")

    changed = _payload_blob(data) != before
    if changed:
        meta["latest_month"] = months[-1]
        meta["generated"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    return data, changed


# ---------------------------------------------------------------------------
# Keep the Monthly Detail dataset (data/iata_detail.json) current. All three
# views come from this same report: the System view from data.json (below), and
# the International / Domestic views straight from the report's own sections, so
# every monthly run extends all of them forward — no manual spreadsheet. The
# workbook only seeds the long pre-2026 history.
# ---------------------------------------------------------------------------
# data.json region key -> iata_detail share key (the workbook drops the slash)
_SHARE_KEY = {"Asia/Pacific": "Asia Pacific"}
_DJ_METRIC = {"rpk": "rpk_yoy", "ask": "ask_yoy", "plf": "plf"}


def sync_detail_from_data(data_path: str = DATA_PATH, detail_path: str = DETAIL_PATH) -> bool:
    """Append REAL months newer than the detail file's System view, copying them
    from data.json. Existing months (the workbook's fuller history) are never
    overwritten. Months in data.json are already validated at parse time
    (reconciliation in _finalise), so they are trusted here. Best-effort:
    returns False (and writes nothing) if the detail file is absent or current."""
    if not os.path.exists(detail_path):
        return False
    with open(data_path) as f:
        dj = json.load(f)
    with open(detail_path) as f:
        det = json.load(f)

    sv = det.get("views", {}).get("system")
    if not sv:
        return False
    months, groups, order, share = sv["months"], sv["groups"], sv["order"], sv["share_rpk"]
    real = set(dj.get("_meta", {}).get("real_months", []))
    dj_months, series, ms = dj["months"], dj["series"], dj.get("market_share", {})

    add = [m for m in dj_months if m > months[-1] and m in real]
    if not add:
        return False

    def pad(arr, n):
        while len(arr) < n:
            arr.append(None)

    for m in add:
        di = dj_months.index(m)
        months.append(m)
        n = len(months)
        for g in order:
            for met, dk in _DJ_METRIC.items():
                col = groups.setdefault(g, {}).setdefault(met, [])
                pad(col, n - 1)
                arr = series.get(dk, {}).get(g)
                col.append(arr[di] if arr and di < len(arr) else None)
        for k in share:
            pad(share[k], n - 1)
            share[k].append(None)

    newest = len(months) - 1                      # set newest-month shares
    for djk, val in ms.items():
        if djk == "Industry":
            continue
        sk = _SHARE_KEY.get(djk, djk)
        if sk in share:
            share[sk][newest] = val
    if "Total" in share:
        share["Total"][newest] = 100.0

    det["_meta"]["latest"] = months[-1]
    det["_meta"]["generated"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(detail_path, "w") as f:
        json.dump(det, f, separators=(",", ":"))
    return True


def update_detail_intl_dom(month: str, intl: dict, dom: dict, detail_path: str = DETAIL_PATH) -> bool:
    """Write a report's International and Domestic sections into the matching
    views of data/iata_detail.json for `month` (appending the month if it is
    newer than that view's last). Best-effort and additive; never overwrites the
    workbook history before the seed range."""
    if not os.path.exists(detail_path) or (not intl and not dom):
        return False
    with open(detail_path) as f:
        det = json.load(f)

    def pad(arr, n):
        while len(arr) < n:
            arr.append(None)

    changed = False
    for view_name, rows in (("international", intl), ("domestic", dom)):
        v = det.get("views", {}).get(view_name)
        if not v or not rows:
            continue
        months, groups, order, share = v["months"], v["groups"], v["order"], v.get("share_rpk", {})
        if month in months:
            i = months.index(month)
        elif month > months[-1]:
            for mk in _months_between(months[-1], month):
                months.append(mk)
                n = len(months)
                for g in order:
                    for met in ("rpk", "ask", "plf"):
                        col = groups.setdefault(g, {}).setdefault(met, [])
                        pad(col, n - 1)
                        col.append(None)
                for k in share:
                    pad(share[k], n - 1)
                    share[k].append(None)
            i = len(months) - 1
        else:
            continue                                   # predates the seeded history

        for key, vals in rows.items():
            if key in groups:
                for met in ("rpk", "ask", "plf"):
                    col = groups[key].setdefault(met, [])
                    pad(col, len(months))
                    col[i] = vals.get(met)
                changed = True
            # market share: regions/countries by name, Total from the section header
            if key == "Industry":
                if "Total" in share and vals.get("share") is not None:
                    pad(share["Total"], len(months))
                    share["Total"][i] = vals["share"]
            else:
                sk = _SHARE_KEY.get(key, key)
                if sk in share and vals.get("share") is not None:
                    pad(share[sk], len(months))
                    share[sk][i] = vals["share"]
        det["_meta"]["latest"] = max(det["_meta"].get("latest", month), months[-1])

    if changed:
        det["_meta"]["generated"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(detail_path, "w") as f:
            json.dump(det, f, separators=(",", ":"))
    return changed


# ---------------------------------------------------------------------------
# Fetch the latest report from IATA (best-effort; runs from CI, not the sandbox)
# ---------------------------------------------------------------------------
def _get(url: str, timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers=_BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _download_pdf(url: str) -> str:
    print("  downloading PDF:", url)
    data = _get(url)
    if not data[:4] == b"%PDF":
        raise ValueError("URL did not return a PDF (got %d bytes, header %r)." % (len(data), data[:8]))
    fd, tmp = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return tmp


def discover_latest_pdf() -> str:
    """Locate the newest 'Air Passenger Market Analysis' PDF on iata.org.

    Strategy: try the predictable economic-report repository page for recent
    months, scrape it for a .pdf link, and download. Falls back to scanning the
    economics library index. Logs each attempt so CI output is diagnosable.
    """
    today = _dt.date.today()
    months_back = [today.replace(day=1) - _dt.timedelta(days=1) * 0]
    # last 4 months (reports lag ~1 month)
    d = today.replace(day=15)
    cands = []
    for _ in range(5):
        cands.append(d)
        d = (d.replace(day=1) - _dt.timedelta(days=1)).replace(day=15)
    month_names = [c.strftime("%B").lower() + "-" + c.strftime("%Y") for c in cands]

    base = "https://www.iata.org/en/iata-repository/publications/economic-reports/"
    pages = ["air-passenger-market-analysis---%s/" % mn for mn in month_names]
    pages.append("../economics-library/")
    pages.insert(0, "")  # the economics library index

    index_urls = [
        "https://www.iata.org/en/publications/economics/economics-library/",
    ] + [base + p for p in pages if p]

    pdf_re = re.compile(r'href="([^"]+\.pdf[^"]*)"', re.I)
    seen = []
    for url in index_urls:
        try:
            print("  scanning:", url)
            html = _get(url).decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print("    ! unreachable:", str(e).split("\n")[0])
            continue
        for href in pdf_re.findall(html):
            if "passenger" in href.lower() or "air-passenger" in href.lower():
                full = href if href.startswith("http") else urllib.request.urljoin(url, href)
                seen.append(full)
        if seen:
            break

    if not seen:
        raise RuntimeError("No Air Passenger PDF link found on IATA (site layout/access may have changed).")
    print("  candidate PDFs:", *seen, sep="\n    ")
    return _download_pdf(seen[0])


# ---------------------------------------------------------------------------
def run(pdf_path: str, dry_run: bool, dump: bool = False) -> int:
    text = extract_text(pdf_path)
    if dump:
        print("=== DUMP: extracted %d chars ===" % len(text))
        idx = text.rfind("Air passenger market in detail")
        if idx == -1:
            print("[marker 'Air passenger market in detail' NOT found]")
            j = text.find("TOTAL MARKET")
            print("[TOTAL MARKET at %d]" % j)
            print(repr(text[max(0, j - 150):j + 1600]))
        else:
            print("[detail table at %d]" % idx)
            print(repr(text[idx:idx + 2400]))
        return 0
    rec = parse_detail(text)
    print("Parsed %s — industry RPK %.1f%% ASK %.1f%% PLF %.1f%%"
          % (rec["month"], rec["industry"]["rpk"], rec["industry"]["ask"], rec["industry"]["plf"]))
    for k in ["North America", "Europe", "Asia/Pacific", "Middle East", "Latin America", "Africa"]:
        v = rec["regions"][k]
        print("  %-14s share %4.1f%%  RPK %+6.1f  ASK %+6.1f  PLF %5.1f" %
              (k, v["share"], v["rpk"], v["ask"], v["plf"]))
    print("  Domestic RPK %s  International RPK %s" % (rec["domestic_rpk"], rec["international_rpk"]))
    if dry_run:
        print("(dry run — data/data.json not modified)")
        return 0
    data, changed = update_data(rec, DATA_PATH)
    if changed:
        print("Updated data/data.json — %d months, latest %s, real months: %s"
              % (len(data["months"]), data["_meta"]["latest_month"],
                 ", ".join(data["_meta"]["real_months"])))
    else:
        print("No change — %s already present with identical figures." % rec["month"])
    try:
        if sync_detail_from_data():
            print("Also extended data/iata_detail.json (Monthly Detail, System view) to the latest month.")
    except Exception as e:  # noqa: BLE001
        print("  (iata_detail system sync skipped: %s)" % e)
    try:
        if update_detail_intl_dom(rec["month"], rec.get("international_detail", {}),
                                  rec.get("domestic_detail", {})):
            print("Also updated International/Domestic detail for %s." % rec["month"])
    except Exception as e:  # noqa: BLE001
        print("  (iata_detail International/Domestic update skipped: %s)" % e)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="IATA Air Passenger ETL")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--pdf", help="path to a local IATA report PDF")
    g.add_argument("--pdf-url", help="URL of an IATA report PDF")
    g.add_argument("--fetch", action="store_true", help="discover & download the latest report from IATA")
    ap.add_argument("--dry-run", action="store_true", help="parse and print only; do not write")
    ap.add_argument("--dump", action="store_true", help="print the report's detail-table text and exit")
    args = ap.parse_args(argv)

    tmp = None
    try:
        if args.pdf:
            pdf = args.pdf
        elif args.pdf_url:
            pdf = tmp = _download_pdf(args.pdf_url)
        else:
            pdf = tmp = discover_latest_pdf()
        return run(pdf, args.dry_run, args.dump)
    except Exception as e:  # noqa: BLE001
        print("ERROR:", e, file=sys.stderr)
        return 1
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


if __name__ == "__main__":
    raise SystemExit(main())
