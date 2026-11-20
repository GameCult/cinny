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

Renders the Vienna cards (`public/ridge/vienna-6815bb9dca99`) lit for six sky states (dawn 2, morning 15, noon 55, golden 6, dusk -3, night -30 degrees of sun)
by a set of looks (`RidgeLook`, `src/app/features/scene/ridge/lightCards.ts`, the one owner of look values), one 480x270 canvas per cell at heading 0. The sky
behind a cell is the app's own (`makePhysicalSky` + `paintSky`, upscaled), without the sun disc, stars or clouds. Not shipped.

    npx vite --port 5199          # from the repo root; the app's vite config serves the page and public/
    http://localhost:5199/harness/scene/ridgeSheet.html                # four presets x six skies
    ...ridgeSheet.html?preset=swiss                                    # one preset (physical|swiss|poster|painterly)
    ...ridgeSheet.html?looks=%5B%7B%22label%22%3A%22no-ink%22%2C%22inkScale%22%3A0%7D%2C%7B%22label%22%3A%22hazy%22%2C%22hazeScale%22%3A8%7D%5D
    ...?w=640                                                          # cell width

`looks=` is a url-encoded or base64 JSON array of `{label, ...partial RidgeLook}` and replaces the preset rows (`inkKeep` and `reliefLight` merge by key).
A cell costs one WebGL2 context and a card decode, so the full sheet takes tens of seconds (much longer in a background tab).

Presets (`PRESETS` in `ridgeSheet.ts`; every key not named is `DEFAULT_LOOK`), chosen by reasoning, not by eye, for Self to tune:

| preset | values |
| --- | --- |
| physical | DEFAULT_LOOK |
| swiss | reliefLight {mix 0.7, azimuthDeg -45, elevationDeg 40}, contrastByDistance 0.9, hazeScale 6, hazeTint [0, 0.05, 0.25], nearWarm 0.5, inkScale 0.6 |
| poster | reliefWeight 0.15, cardToneStep 0.25, cardGradient 0.5, inkKeep {edge 0.25, occlude 0.9, crease 1}, hazeScale 4 |
| painterly | groundNoise 0.35, cloudShadows 0.5, nearWarm 0.6, hazeScale 2, inkScale 0.4 |
