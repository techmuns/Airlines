# Airline Demand Monitor

A clean, research-style dashboard for **airline passenger demand** and
**regional aviation traffic**. It is built to update itself automatically — no
manual work once it is connected.

## What you see

The whole dashboard uses one premium dark aviation theme (near-black navy with
muted gold accents) inside a single gold-edged panel that fills the screen.
There is also an **Export** button in the header that downloads the regional
airline figures as a spreadsheet (CSV) file.

Three tabs:

1. **Global Demand Map** — the landing page. A short, wide dark world map that
   shows IATA regional demand as glowing gold bubbles (bubble size = RPK
   market share, glow = traffic/momentum strength, soft red ring = negative or
   weak), each labelled with the region name and its current value. It has
   metric / view / period filters, a hover tooltip per region, click-to-drill
   into a region, a regional trend chart with a time-range picker, an
   all-regions snapshot heatmap, and a regional comparison table. Uses IATA
   regional data only.
2. **TSA Overview** — daily U.S. airport security (TSA) checkpoint passenger
   numbers: headline figures, four charts, a daily table, a calendar heatmap,
   and short takeaways.
3. **Airline Traffic & Regional** — global airline traffic (IATA): two big
   charts, a regional performance snapshot, a detailed matrix, and insights.
   At the bottom is the **Monthly Detail** section — a simplified version of the
   client's Goldman Sachs / IATA monthly workbook. Pick a **view** (System,
   International or Domestic), a **measure** (passenger traffic RPK, capacity
   ASK, or load factor PLF) and a **basis** (each month, or a 3-month average),
   and read every month down the page as one clean colour-coded grid
   (green = growth, red = decline), region by region. Below it is a
   market-share strip and a **Download CSV** button for the month-by-month
   numbers. All three views stay in step with the automatic monthly update.

The TSA and IATA sections are kept completely separate, as requested: the
Global Demand Map and the Airline Traffic tab use IATA regional data only, and
the TSA tab uses TSA data only.

## How it stays up to date

The dashboard reads these small data files:

- `data/tsa.json` — daily TSA passenger numbers
- `data/data.json` — monthly global airline traffic (IATA)
- `data/iata_detail.json` — the Monthly Detail section (System / International /
  Domestic, by region/country, 2011→now). The long pre-2026 history is seeded
  once from the client's Goldman Sachs / IATA Excel by `tools/iata_excel_etl.py`;
  from then on **all three views** are extended automatically every month by the
  IATA pipeline, which reads the report's System, International and Domestic
  sections — so no spreadsheet is needed to keep it current.

### Real IATA data (automatic, monthly)

Each month IATA publishes an **Air Passenger Market Analysis** PDF with a
"detail" table of regional RPK / ASK / PLF and market share. The pipeline reads
that table and fills `data/data.json` — no spreadsheets, no copy-paste:

- `tools/iata_etl.py` parses an IATA report PDF and updates `data/data.json`.
  - `python3 tools/iata_etl.py --pdf <file>` — a downloaded report
  - `python3 tools/iata_etl.py --pdf-url <url>` — a report by URL
  - `python3 tools/iata_etl.py --fetch` — find & download the latest from IATA
- `.github/workflows/update-iata-data.yml` runs that automatically a few times a
  month, and commits any change — Cloudflare Pages then redeploys on its own.

`data/data.json` carries a `_meta.real_months` list of the months filled with
**real** IATA figures; any month not listed is still synthetic sample data and
is replaced as soon as that month's report is processed. The figures (not the
PDF) are stored.

### Real TSA data (automatic, daily)

TSA publishes daily checkpoint passenger volumes on `tsa.gov/travel/passenger-volumes`.

- `tools/tsa_etl.py` reads that table into `data/tsa.json`.
  - `python3 tools/tsa_etl.py` — fetch & merge the latest days
  - `python3 tools/tsa_etl.py --diagnose` — print the page structure
  - `python3 tools/tsa_etl.py --backfill "YYYYMMDD ..."` — seed history from
    Internet-Archive snapshots of the same table
- `.github/workflows/update-tsa-data.yml` runs daily and commits any change.

`data/tsa.json` carries `_meta.real_days` (and `_meta.real_from`) marking the
real days; the rest stay synthetic sample. The two pipelines are independent —
IATA fills the regional tabs, TSA fills the TSA tab.

### What's real vs sample

Both tabs **label their data**: the Global Demand Map shows a "real IATA data"
badge and dotted-vs-dashed trend lines; the TSA tab shows a "real TSA data"
badge and a dot per row. So every figure's source is visible at a glance.

## Built to be reliable

- It is a plain website (no complicated build step), so there is nothing that
  can "fail to build."
- The chart library is bundled in (`assets/js/lib/chart.umd.js`), so the site
  does not depend on any outside service to load.

## Going live (one-time, done once)

The site is ready to be hosted on **Cloudflare Pages**, which will publish a new
version automatically every time data lands on `main`. The one-time connection
(GitHub → Cloudflare Pages) settings are:

- **Framework preset:** None
- **Build command:** *(leave empty)*
- **Build output directory:** `/`

After that one connection, everything is automatic forever.

## For developers

- Preview locally: `python3 -m http.server` then open `http://localhost:8000`.
- Update from a real IATA report: `python3 tools/iata_etl.py --pdf <file>`
  (needs `pip install pdfminer.six`). This is the normal way to add data.
- Refresh the Monthly Detail tab from the client workbook:
  `python3 tools/iata_excel_etl.py <workbook.xlsx>` (needs `pip install openpyxl`).
  It reads the System / International / Domestic sheets and writes
  `data/iata_detail.json`.
- Regenerate the synthetic sample data: `python3 tools/generate_sample_data.py`
  — run deliberately only; it rewrites the *whole* `data/data.json`, so it would
  overwrite any real months. Used once to seed the realistic-looking preview.
- Rebuild the world-map geometry: `python3 tools/build_world_map.py` — projects
  the public-domain Natural Earth 1:110m land outline into
  `assets/js/worldmap.js` (the dotted map). Only needed if you change the map
  projection or dot density; the generated file is committed so the site has no
  build step.

## Folder layout

```
index.html                 the dashboard page
assets/css/                colours, theme, components
assets/js/                 dashboard code (charts, tables, heatmaps, tabs)
assets/js/lib/             bundled Chart.js
data/                      the two data files the dashboard reads
tools/                     sample-data generator
```
