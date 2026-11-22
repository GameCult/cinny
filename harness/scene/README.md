# Scene harness

Compiles, renders and times the background scene (`src/app/features/scene/`) in headless
Chromium. Not shipped, not run by CI.

    node bundle.cjs <outdir>                  # esbuild bundle of entry.ts plus an index.html
    node drive.cjs <outdir> compile           # compile and link each stage, JSON report
    node drive.cjs <outdir> shots <pngdir>    # rest, mid pull-back and pulled-back screenshots
    node gradAxis.cjs <shaders dir>           # numeric check that noise gradients are (d/dx, d/dz-as-.y, ...): terrainNormal axis
    node drive.cjs <outdir> measure           # GPU time per pass by timer query, two viewports, two levels
    node drive.cjs <outdir> variants          # the same with source patches (no erosion, no tree, value-only fbm)
    node drive.cjs <outdir> trace             # mean trace steps per pixel and pass ms at three camera poses, PREPASS=0,1 arms
    node drive.cjs <outdir> diff <pngdir>     # one frozen frame with and without the prepass, pixel diff and both PNGs
    node drive.cjs <outdir> phacelle          # the Phacelle gradient probe behind world.ts `phacelleGradBound`

Needs `esbuild` and `playwright@1.48.2` on `NODE_PATH` and a Chromium. The first run was done on a
host with no GPU, so `drive.cjs` launches with `--use-angle=swiftshader` (software Vulkan). On a
machine with a GPU, remove those flags to measure the real device. `bundle.cjs` must run from a
directory whose ancestors hold no empty `package.json` (esbuild reads them).

Timings from SwiftShader are CPU time: use them for the split between passes and for before and
after of one change, never as a phone frame time.

## Ridge look sheet

Renders a baked place (`?place=`, the index default otherwise) lit for six sky states (dawn 2, morning 15, noon 55, golden 6, dusk -3, night -30 degrees of sun)
by a set of looks (`RidgeLook`, `src/app/features/scene/ridge/lightCards.ts`, the one owner of look values), one 480x270 canvas per cell, drawn by the app's own still
path (`createRidgeScene` at tier 'still' over a `createBackdrop` of the tiles round the heading), at the rest azimuth unless `?views=` says otherwise. The sky
behind a cell is the app's own, without clouds. Not shipped.

    ...ridgeSheet.html?views=214:0:200,0:0:200,214:90:98.2&sky=2      # one column per view heading:phi:offset (degrees, degrees, metres) at one sky (an index of SKIES)

A heading of 0 or 360 is across north; a phi other than 0 is the offset-only rotation mode (the camera circling the centre, the view direction staying); the offset is
clamped to the place's range as the app does.

    npx vite --port 5199          # from the repo root; the app's vite config serves the page and public/
    http://localhost:5199/harness/scene/ridgeSheet.html                # four presets x six skies
    ...ridgeSheet.html?preset=swiss                                    # one preset (physical|swiss|poster|painterly)
    ...ridgeSheet.html?looks=%5B%7B%22label%22%3A%22no-ink%22%2C%22inkScale%22%3A0%7D%2C%7B%22label%22%3A%22hazy%22%2C%22hazeScale%22%3A8%7D%5D
    ...?w=640                                                          # cell width

`looks=` is a url-encoded or base64 JSON array of `{label, ...partial RidgeLook}` and replaces the preset rows (`inkKeep` and `reliefLight` merge by key).
A cell costs one WebGL2 context and a card decode, so the full sheet takes tens of seconds (much longer in a background tab).

Presets (`PRESETS` in `ridgeSheet.ts`; swiss and poster take every key not named from `PHYSICAL_LOOK`, the rest from `DEFAULT_LOOK`, the painterly cel look), chosen by reasoning, not by eye, for Self to tune:

| preset | values |
| --- | --- |
| physical | PHYSICAL_LOOK (Lambert, no noise, sky haze, full ink) |
| swiss | reliefLight {mix 0.7, azimuthDeg -45, elevationDeg 40}, contrastByDistance 0.9, hazeScale 6, hazeTint [0, 0.05, 0.25], nearWarm 0.5, inkScale 0.6 |
| poster | reliefWeight 0.15, cardToneStep 0.25, cardGradient 0.5, inkKeep {edge 0.25, occlude 0.9, crease 1}, hazeScale 4 |
| painterly | DEFAULT_LOOK: groundNoise 0.35, cloudShadows 0.5, nearWarm 0.6, hazeScale 2, inkScale 0.4, celBands 3, celSoftness 0.05, celAmbientAway 0.7 |
| painterly-cel-2 / -3 / -4 | painterly with celBands 2 / 3 / 4 |

Named moments (`ridgeSheet.html?named=1`): the six moments of the Sky menu (dawn, morning, noon, golden hour, dusk, night) at the baked place on the December and June solstices, drawn from `momentFor` as the app draws them (`SKY_MOMENTS` in `ridge/skyMoment.ts` is the table tuned by eye from this sheet). Night sets (`ridgeSheet.html`): `?moments=2026-11-24T22:00Z,2026-12-09T20:00Z` pins explicit UTC moments (the sun, moon and stars are those of the moment); `?night=1` renders the next new moon, first quarter and full moon from today (`&from=YYYY-MM-DD`) at four hours each (`&hours=18,21,0,4`, UTC) plus deep dusk of the full-moon evening; `&lines=1` draws the constellation lines (the Sky menu's hidden toggle). Use `&w=300` for the 13-column set. The night look's knobs: `NIGHT_LOOK` in `ridge/nightSky.ts` (star point spread, contrast exponents, moon size, earthshine, line opacity), `NIGHT_CEILING` and `SCOTOPIC` in `ridge/toneMap.ts`, the night `Budget` (key, targets, partial adaptation).
