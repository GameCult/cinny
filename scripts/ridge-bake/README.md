# ridge-bake

Offline baker for the ridge backdrop: it turns a Copernicus DEM into six sun frames of three transparent WebP planes (far, mid, near) per place, plus a `manifest.json` and an `index.json` that the runtime reads. The baker is not shipped; `public/ridge/` holds its output.

## Run

```sh
python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
```

Needs Python 3 with `numpy`, `tifffile` and `imagecodecs`. `--tiles` is a directory of Copernicus GLO-30 tiles (never committed); `--work` caches the mosaic and rays (default `$TMPDIR/ridge-bake-work`); `--sheet` writes the six frames over one flat sky. `python3 -I scripts/ridge-bake/export.py --write-schema` rewrites `ridge-bake.schema.json`; `export.py` holds the one dict it comes from.

Tests: `RIDGE_PY=<python> RIDGE_TILES=DIR scripts/ridge-bake/tests/run.sh [test_ridge.py|mutate.py|mutate_export.py]` (the full file takes about 9 minutes; `mutate.py` runs the mutants of taper, chains and sweep and `mutate_export.py` those of the planes path and export, each failing if one survives).

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

`relight_planes` renders every layer twice, with haze colour 0 and 1; the relight is affine in the haze colour, so the difference is each pixel's haze share. That share becomes transparency and the sky behind supplies the haze. Far is slot 0 plus the floor, near is the last slot, mid is every slot between (a place needs at least 3). Colour is exact over the frame's own haze colour; over another sky it drifts by the difference between the two. Stacked planes would leak: each plane's haze is alpha over whatever is behind it, so a nearer plane's haze would veil the farther ridge instead of the sky, and the farther ridge would show through it (a slanted seam through Vienna's near plane). `relight_planes` therefore scales a farther plane's alpha, near to far, to what the nearer layers leave open in the opaque frame (their transmittance over the stack's), looked up as the most open pixel within `OCCLUDE_MARGIN_PX` columns and eased by a Gaussian, because the runtime slides the planes against each other and a hidden pixel must stay hidden after the slide. The nearest layer is the ground in front of the eye: `bake_layer(near=True)` keeps its body opaque down to the horizon (its dissolve starts there), where the farther layers keep theirs (the haze arches). `export.check_near_cover` refuses, at `write_bake`, a near plane with a fully transparent column or a hole between a column's crest and the horizon row, in every frame; the farther planes may have empty columns. Over a flat sky the stack differs from the opaque frame by 1.8/255 over the whole frame (Vienna noon; 4.9 before the knock-out), but that is 11.2/255 mean over the 16.4% of pixels where two planes overlap and 0.005/255 everywhere else; the tests bound the frame at 3/255 and the overlap at 12.5/255. The spec's 2/255 pin is met on the frame; the overlap keeps the margin's soft blob.

Manifest `luma` is the min and max relative luminance (WCAG, linear 0..1) of the three planes composited far, mid, near over a flat mid-grey sky, over the pixels whose composite coverage `1 - prod(1 - alpha)` is at least 0.5. No plane pixel is opaque (haze is alpha), so no per-plane solid set exists; the composite is what the runtime shows.

## Licence

Elevation: Copernicus DEM GLO-30. The credit line is written into every manifest (`attribution`) and must be shown with any rendering:

> Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Licence: free, full and open access, with the credit line shown (https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model).
