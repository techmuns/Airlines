# Airline Demand Monitor

A clean, research-style dashboard for **airline passenger demand** and
**regional aviation traffic**. It is built to update itself automatically — no
manual work once it is connected.

## What you see

Three tabs:

1. **Global Demand Map** — the landing page. A premium dark-navy world map that
   shows IATA regional demand as soft glowing gold bubbles (bubble size = RPK
   market share, glow = traffic/momentum strength, soft red ring = negative or
   weak). It has metric / view / period filters, a hover tooltip per region,
   click-to-drill into a region, a regional trend chart, a snapshot heatmap,
   and a regional comparison table. Uses IATA regional data only.
2. **TSA Overview** — daily U.S. airport security (TSA) checkpoint passenger
   numbers: headline figures, four charts, a daily table, a calendar heatmap,
   and short takeaways.
3. **Airline Traffic & Regional** — global airline traffic (IATA): two big
   charts, a regional performance snapshot, a detailed matrix, and insights.

The TSA and IATA sections are kept completely separate, as requested: the
Global Demand Map and the Airline Traffic tab use IATA regional data only, and
the TSA tab uses TSA data only.

## How it stays up to date

The dashboard reads two small data files:

- `data/tsa.json` — daily TSA passenger numbers
- `data/data.json` — monthly global airline traffic (IATA)

When the automatic data pipeline is connected, it will refresh these two files
and the dashboard updates on its own. **Right now the dashboard shows realistic
sample data** so you can see the full design; the numbers swap to live data with
no further changes.

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
- Regenerate the sample data: `python3 tools/generate_sample_data.py`.
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
