#!/usr/bin/env python3
"""Bake the 360 degree horizon seen from the ridge viewpoint (src/app/features/scene/ridge/vienna.ts: VIENNA) into
src/app/features/scene/ridge/viennaHorizon.json: per azimuth, the highest elevation angle the terrain subtends, the distance and
height of the point that sets it, and the surface slope there (the normal). The source is Copernicus DEM GLO-30, a DSM (it
includes buildings and trees, which is what a horizon is made of). Source, licence and attribution go beside the bake, in its
`source` block, so the file cannot travel without them.

  python3 scripts/bake-horizon.py <dir with the nine Copernicus_DSM_COG_10_N{47..49}_00_E{015..017}_00_DEM.tif> [out.json]

Needs numpy, tifffile, imagecodecs (pip, in a venv: this is a build-time tool, the bake is committed).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import tifffile

LAT, LON = 48.1929826, 16.3534237  # the server location Meta gave, 2026-11-11; keep equal to VIENNA in vienna.ts
STEP_DEG = 0.5
RADIUS_KM = 60.0
EARTH_R = 6_371_000.0
REFRACTION_K = 0.13  # standard terrestrial refraction: effective radius R / (1 - k)
EYE_ABOVE_GROUND = 0.0  # the viewpoint is the DSM surface at the point (a roof, in a city); the page lifts it with VIENNA.altitudeKm
MIN_KM = 1.0  # the DSM at 30 m cannot resolve neighbouring buildings as a horizon; nearer than this is not ridge


class Mosaic:
    def __init__(self, folder: Path):
        self.tiles = {}
        for p in sorted(folder.glob("Copernicus_DSM_COG_10_N*_E*_DEM.tif")):
            lat0 = int(p.name.split("_N")[1][:2])
            lon0 = int(p.name.split("_E")[1][:3])
            with tifffile.TiffFile(p) as t:
                self.tiles[(lat0, lon0)] = t.pages[0].asarray()

    def height(self, lat: float, lon: float) -> float:
        key = (math.floor(lat), math.floor(lon))
        a = self.tiles.get(key)
        if a is None:
            return float("nan")
        n = a.shape[0]
        # Tile origin is the north-west corner; pixels are 1/n degree, pixel-is-area (centre at +0.5).
        y = (key[0] + 1 - lat) * n - 0.5
        x = (lon - key[1]) * n - 0.5
        y0, x0 = int(math.floor(y)), int(math.floor(x))
        y0 = min(max(y0, 0), n - 2)
        x0 = min(max(x0, 0), n - 2)
        fy, fx = min(max(y - y0, 0), 1), min(max(x - x0, 0), 1)
        top = a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx
        bot = a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx
        return float(top * (1 - fy) + bot * fy)


def offset(lat: float, lon: float, az_deg: float, d_m: float):
    az = math.radians(az_deg)
    dlat = d_m * math.cos(az) / 111_320.0
    dlon = d_m * math.sin(az) / (111_320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def main() -> None:
    folder = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("src/app/features/scene/ridge/viennaHorizon.json")
    m = Mosaic(folder)
    h0 = m.height(LAT, LON) + EYE_ABOVE_GROUND
    az_count = int(360 / STEP_DEG)
    elev, dist, peak, east, north = [], [], [], [], []
    for i in range(az_count):
        az = i * STEP_DEG
        best, best_d, best_h, best_pt = -90.0, 0.0, h0, (LAT, LON)
        d = MIN_KM * 1000
        while d <= RADIUS_KM * 1000:
            lat, lon = offset(LAT, LON, az, d)
            h = m.height(lat, lon)
            if not math.isnan(h):
                drop = d * d / (2 * EARTH_R) * (1 - REFRACTION_K)
                ang = math.degrees(math.atan2(h - h0 - drop, d))
                if ang > best:
                    best, best_d, best_h, best_pt = ang, d, h, (lat, lon)
            d += 30.0 if d < 5000 else 60.0 if d < 20000 else 120.0
        # Surface slope at the peak (rise per metre, east and north), central difference over 60 m.
        la, lo = best_pt
        dl, dn = 60.0 / 111_320.0, 60.0 / (111_320.0 * math.cos(math.radians(la)))
        ge = (m.height(la, lo + dn) - m.height(la, lo - dn)) / 120.0
        gn = (m.height(la + dl, lo) - m.height(la - dl, lo)) / 120.0
        elev.append(round(best, 3))
        dist.append(round(best_d / 1000, 2))
        peak.append(round(best_h, 1))
        east.append(round(ge, 3))
        north.append(round(gn, 3))
    doc = {
        "viewpoint": {"lat": LAT, "lon": LON, "groundM": round(h0, 1)},
        "stepDeg": STEP_DEG,
        "radiusKm": RADIUS_KM,
        "minKm": MIN_KM,
        "curvature": f"drop d^2/2R*(1-{REFRACTION_K}), R={int(EARTH_R)} m",
        "source": {
            "dataset": "Copernicus DEM GLO-30 (COP-DEM_GLO-30-DGED), a DSM, EGM2008 heights, 1 arc-second grid",
            "tiles": sorted(f"N{a:02d}_00_E{b:03d}_00" for a, b in m.tiles),
            "tileBytesEach": "about 42-44 MB (Cloud Optimized GeoTIFF); nine tiles, about 380 MB, read once, not committed",
            "url": "https://copernicus-dem-30m.s3.amazonaws.com/ (AWS Open Data, eu-central-1, no account)",
            "licence": "Copernicus DEM licence: free of charge for any use incl. commercial, attribution required, no warranty "
            "(https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model, Licencing)",
            "attribution": "Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
            "provided under COPERNICUS by the European Union and ESA; all rights reserved.",
            "bakedBy": "scripts/bake-horizon.py",
        },
        "elevationDeg": elev,
        "distanceKm": dist,
        "peakHeightM": peak,
        "slopeEast": east,
        "slopeNorth": north,
    }
    out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    top = int(np.argmax(elev))
    print(f"ground {h0:.1f} m; {az_count} azimuths; highest {elev[top]:.2f} deg at az {top * STEP_DEG}, {dist[top]} km, {peak[top]} m")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
