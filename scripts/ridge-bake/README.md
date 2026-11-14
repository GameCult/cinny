# ridge-bake

Offline baker for the ridge backdrop: it turns a Copernicus DEM into six sun frames of three transparent WebP planes (far, mid, near) per place, plus a `manifest.json` and an `index.json` that the runtime reads. The baker is not shipped; `public/ridge/` holds its output.

## Run

```sh
python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
```

Needs Python 3 with `numpy`, `tifffile` and `imagecodecs`. `--tiles` is a directory of Copernicus GLO-30 tiles (never committed); `--work` caches the mosaic and rays (default `$TMPDIR/ridge-bake-work`); `--sheet` writes the six frames over one flat sky. `python3 -I scripts/ridge-bake/export.py --write-schema` rewrites `ridge-bake.schema.json`; `export.py` holds the one dict it comes from.

Tests: `RIDGE_PY=<python> RIDGE_TILES=DIR scripts/ridge-bake/tests/run.sh [test_ridge.py|mutate.py]` (the full file takes about 9 minutes; `mutate.py` runs the mutants of taper, chains and sweep and fails if one survives).

## Tiles per preset (`places.json`, date 2026-09-23)

Files are `Copernicus_DSM_COG_10_<N|S>dd_00_<E|W>ddd_00_DEM.tif`; the list below is `<N|S>dd<E|W>ddd`.

| place id | tiles |
|---|---|
| vienna | N47E015 N47E016 N47E017 N48E015 N48E016 N48E017 N49E015 N49E016 |
| matterhorn | N45E007 N45E008 N46E007 N46E008 |
| fuji | N34E138 N34E139 N35E137 N35E138 N35E139 |
| halfdome | N37W121 N37W120 N38W120 |
| amadablam | N27E086 N27E087 N28E086 N28E087 |
| trecime | N46E011 N46E012 |

## Planes

`relight_planes` renders every layer twice, with haze colour 0 and 1; the relight is affine in the haze colour, so the difference is each pixel's haze share. That share becomes transparency and the sky behind supplies the haze. Far is slot 0 plus the floor, near is the last slot, mid is every slot between (a place needs at least 3). Colour is exact over the frame's own haze colour; over another sky it drifts by the difference between the two. Stacked planes over a flat sky stay within 6/255 mean of the opaque frame (4.9/255 measured on Vienna noon); the spec's 2/255 is not reachable with this trick.

## Licence

Elevation: Copernicus DEM GLO-30. The credit line is written into every manifest (`attribution`) and must be shown with any rendering:

> Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Licence: free, full and open access, with the credit line shown (https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model).
