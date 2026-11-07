# Scene harness

Compiles, renders and times the background scene (`src/app/features/scene/`) in headless
Chromium. Not shipped, not run by CI.

    node bundle.cjs <outdir>                  # esbuild bundle of entry.ts plus an index.html
    node drive.cjs <outdir> compile           # compile and link each stage, JSON report
    node drive.cjs <outdir> shots <pngdir>    # rest, mid pull-back and pulled-back screenshots
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

## Terrain-tier spike (not shipped, nothing imports it)

`terrainDemo.ts` is a standalone page for an optional third terrain tier: a height map rendered once into a
float render target, then a pre-subdivided grid displaced from it in the vertex shader (WebGL2 has no
tessellation). `node bundle.cjs <out> terrain` writes one `index.html` and one classic `bundle.js`;
`terrainDrive.cjs <bundledir> <outdir>` measures it. Query: `?tier=0|1|2` (grid 128/256/512 over a
512/1024/2048 map), `?bench=1`, `?force=half|rgba8|none` to take a fallback path.

The height pass uses the vendored `CultMath.Phacelle.glsl` (MPL-2.0, Rune Skovbo Johansen's Phacelle noise,
unedited) and the same per-stage `trimGlsl` the scene uses. The slope-directed gully composition on top of it
is ours, written from the description in his March 2026 erosion-filter post; it is not his filter and was not
compared against it. Format fallback: RGBA32F, then RGBA16F, then RGBA8 with the height packed in two bytes;
no vertex texture unit or no WebGL2 leaves the tier off. SwiftShader timings are a CPU rasteriser's, not a
phone's, and `--use-angle=swiftshader` CPU throttling does not slow it.
