# ridge-bake

Offline baker for the ridge backdrop: it turns a Copernicus DEM into K+1 G-buffer cards per place, split by K authored seams, plus a `manifest.json` (schema 2) and an `index.json` that the runtime reads. Each card is a colour WebP (albedo and coverage) and a geometry WebP (normal and log-distance). The baker is not shipped; `public/ridge/` holds its output. The client owns lighting, haze and ink: no sun, haze or shadow is baked.

## Run

```sh
python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
```

Needs Python 3 with `numpy`, `tifffile` and `imagecodecs`. `--tiles` is a directory of Copernicus GLO-30 tiles (never committed); `--work` caches the mosaic and rays (default `$TMPDIR/ridge-bake-work`); `--sheet` writes the contact sheet (the composite, every card alone and the depth image with every seam, lit by one fixed light). `python3 -I scripts/ridge-bake/export.py --write-schema` rewrites `ridge-bake.schema.json`, which the tests pin.

Tests: `RIDGE_PY=<python> RIDGE_TILES=DIR scripts/ridge-bake/tests/run.sh [test_ridge.py|mutate.py]` (`mutate.py` re-introduces each rule's failure into a copy of the baker and fails if a test does not notice).

## Tiles per preset (`places.json`)

Files are `Copernicus_DSM_COG_10_<N|S>dd_00_<E|W>ddd_00_DEM.tif`; the list below is `<N|S>dd<E|W>ddd`.

| place id | tiles |
|---|---|
| vienna | N47E015 N47E016 N47E017 N48E015 N48E016 N48E017 N49E015 N49E016 |
| matterhorn | N45E007 N45E008 N46E007 N46E008 |
| fuji | N34E138 N34E139 N35E137 N35E138 N35E139 |
| halfdome | N37W121 N37W120 N38W120 |
| amadablam | N27E086 N27E087 N28E086 N28E087 |
| trecime | N46E011 N46E012 |

## Cards

`places.json` gives each preset `card_split_km`, an ordered list of 1 to 5 seam depths in km, and optionally `prefilter_m`. A preset without `card_split_km` is refused, and so is a split that leaves a card empty (the message names the splits); K splits make K+1 cards, at most `MAX_CARDS` = 6 per place. New places get a seam probe look before their first bake.

1. **March.** `stage0` marches 6400 azimuth columns of rays over the DEM with Earth curvature and refraction (`ridge.elev`), cached by a key of its inputs.
2. **Low-pass.** `prefilter` blurs the sampled heights with a Gaussian of `prefilter_m` metres along each ray and across rays at equal distance (sigma = `prefilter_m` / (distance x column width) columns), then recomputes the angles. Roofs go, hills stay.
3. **View.** `set_view` maps angle to row linearly: the highest skyline angle in the window sits at 4% of the frame height, the lowest at 66%, clamped to 1x to 10x vertical exaggeration.
4. **Seams.** `coverage` counts the visible rows of the opaque view per log-distance bin and column. `seams` finds one seam per authored split per column by dynamic programming (seam carving, forward energy): it sits in a gap between depths, moving it costs 2 per bin plus the visible rows it sweeps (so it never hops across a ridge between two columns and splits it side by side), a seam inside visible terrain is cheap to cross-fade, the authored depth only breaks ties. Seam k stays 0.4 nat beyond seam k-1.
5. **Cards.** `cards` makes card i from the first visible hit at or beyond seam i-1 (layered depth: a farther card keeps the terrain a nearer ridge hides), alpha 1 minus a smoothstep over seam i in log-distance (the cross-fade), crest rows with fractional coverage, distance and normal interpolated between samples by angle, albedo from a small height and slope material, reveal-bounded (below), cropped to the rows where alpha is not zero. The alpha-over composite of the cards equals the opaque view; `check_cover` refuses a bake that differs by more than 0.02.
6. **Reveal bound.** The runtime slides each card against the others by at most `MAX_SLIDE_PX` = ceil(5% of the card width) (64 at 1280, the runtime's `DRIFT_FRAC`; the manifest's `max_slide_px`). A card therefore loses every pixel that the nearer cards' opaque pixels hide at every offset within that slide, also when any single card slides alone; the composite at rest is unchanged and no slide within the bound shows a cut pixel. A column whose slide window leaves the frame keeps its pixels. The crop is a rectangle of rows, so the edge strips keep a card's rows even where its interior is cut, and the decode total is the rows that still hold a pixel anywhere.
7. **Normals.** `normals` takes the along-ray slope and the across-ray slope at equal distance (neighbouring columns, same sample), both times the vertical exaggeration.

Files per card `i`: `card-<i>-colour.webp` (lossy RGB albedo, lossless straight alpha) and `card-<i>-geometry.webp` (lossless: R, G = (n + 1) / 2 for the normal's along and across components, B = log-distance normalised between `encoding.log_d_min` and `log_d_max`). The manifest lists the cards nearest first with their row band (`top`, `h`), median seam depths and files; the runtime paints the list last to first. `check_budget` refuses more than `MAX_CARDS` cards, more than 1.5 MB of card files, or more than 20 MB decoded (2 textures x width x band rows x 4 bytes per card); a cap is never raised to fit a bake.

## Licence

Elevation: Copernicus DEM GLO-30. The credit line is written into every manifest (`attribution`) and must be shown with any rendering:

> Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Licence: free, full and open access, with the credit line shown (https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model).
