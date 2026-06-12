#!/usr/bin/env python3
"""Build the dotted world-map geometry used by the Global Demand Map tab.

This is a one-time *build* step (like vendoring a library): it turns the
public-domain Natural Earth 110m land outline into a compact list of dot
coordinates plus a simplified land silhouette path, projected with a plain
equirectangular (plate carree) projection. The output is written as a small
self-contained JS file (assets/js/worldmap.js) so the website never needs a
network connection or a map library at runtime.

Source data: Natural Earth 1:110m physical "land" (public domain).
  https://github.com/martynafford/natural-earth-geojson  (110m/physical/ne_110m_land.json)

Run:  python3 tools/build_world_map.py
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "js", "worldmap.js")
CACHE = "/tmp/ne_110m_land.json"
URL = ("https://raw.githubusercontent.com/martynafford/natural-earth-geojson/"
       "master/110m/physical/ne_110m_land.json")

# ---- projection window (drop most of Antarctica; keep populated latitudes) ----
LAT_TOP = 84.0     # top edge of the map, degrees north
LAT_BOT = -56.0    # bottom edge, degrees south
WIDTH = 1000.0     # equirectangular: 360 deg of longitude -> WIDTH px
K = WIDTH / 360.0  # px per degree (equal scale on both axes => true plate carree)
HEIGHT = round((LAT_TOP - LAT_BOT) * K)

# ---- dot grid ----
STEP = 10.5        # spacing between dots in projected px
STAGGER = True     # offset alternate rows for a softer halftone pattern


def load_geojson():
    if not os.path.exists(CACHE):
        sys.stderr.write("downloading land outline ...\n")
        urllib.request.urlretrieve(URL, CACHE)
    with open(CACHE) as f:
        return json.load(f)


def polygons(geojson):
    """Yield each polygon as a list of rings; each ring a list of (lon, lat)."""
    for feat in geojson["features"]:
        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            yield geom["coordinates"]
        elif geom["type"] == "MultiPolygon":
            for poly in geom["coordinates"]:
                yield poly


def project(lon, lat):
    x = (lon + 180.0) * K
    y = (LAT_TOP - lat) * K
    return x, y


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside


def main():
    gj = load_geojson()

    # Pre-build polygons in lon/lat with bounding boxes for fast culling.
    polys = []
    for rings in polygons(gj):
        outer = rings[0]
        lons = [p[0] for p in outer]
        lats = [p[1] for p in outer]
        bbox = (min(lons), min(lats), max(lons), max(lats))
        polys.append((bbox, rings))

    def is_land(lon, lat):
        for (minx, miny, maxx, maxy), rings in polys:
            if lon < minx or lon > maxx or lat < miny or lat > maxy:
                continue
            inside = False
            for ring in rings:
                if point_in_ring(lon, lat, ring):
                    inside = not inside
            if inside:
                return True
        return False

    # Sample the dot grid in projected space.
    dots = []
    row = 0
    y = STEP / 2.0
    while y < HEIGHT:
        x0 = STEP / 2.0 + (STEP / 2.0 if (STAGGER and row % 2) else 0.0)
        x = x0
        while x < WIDTH:
            lon = x / K - 180.0
            lat = LAT_TOP - y / K
            if is_land(lon, lat):
                dots.append((round(x), round(y)))
            x += STEP
        y += STEP
        row += 1

    # Simplified land silhouette path (a faint fill under the dots for depth).
    # Decimate points and drop tiny islands so the path stays light.
    MIN_SEG = 4.0       # drop points closer than this to the last kept point
    MIN_SPAN = 11.0     # drop rings smaller than this (projected px, max dimension)
    parts = []
    for rings in polygons(gj):
        for ring in rings:
            if len(ring) < 8:
                continue
            proj = [project(lon, lat) for lon, lat in ring]
            xs = [p[0] for p in proj]
            ys = [p[1] for p in proj]
            if max(max(xs) - min(xs), max(ys) - min(ys)) < MIN_SPAN:
                continue
            pts = []
            lastkept = None
            for x, y in proj:
                if lastkept is None or (abs(x - lastkept[0]) + abs(y - lastkept[1])) >= MIN_SEG:
                    pts.append((round(x), round(y)))
                    lastkept = (x, y)
            if len(pts) < 6:
                continue
            seg = "M" + " ".join("%d,%d" % p for p in pts) + "Z"
            parts.append(seg)
    land_path = "".join(parts)

    payload = {
        "width": int(WIDTH),
        "height": int(HEIGHT),
        "latTop": LAT_TOP,
        "latBot": LAT_BOT,
        "k": round(K, 5),
        "dots": dots,
        "landPath": land_path,
    }

    js = (
        "/* Global Demand Map — dotted world-map geometry.\n"
        "   GENERATED by tools/build_world_map.py from Natural Earth 110m land\n"
        "   (public domain). Equirectangular projection. Do not edit by hand. */\n"
        "(function (global) {\n"
        "  'use strict';\n"
        "  global.ADM = global.ADM || {};\n"
        "  global.ADM.worldMap = " + json.dumps(payload, separators=(",", ":")) + ";\n"
        "})(window);\n"
    )

    with open(OUT, "w") as f:
        f.write(js)

    size = os.path.getsize(OUT)
    sys.stderr.write(
        "wrote %s\n  viewBox 0 0 %d %d | dots %d | path %d chars | file %.1f KB\n"
        % (os.path.relpath(OUT, ROOT), WIDTH, HEIGHT, len(dots), len(land_path), size / 1024.0)
    )


if __name__ == "__main__":
    main()
