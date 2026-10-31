# Scene harness

Compiles, renders and times the background scene (`src/app/features/scene/`) in headless
Chromium. Not shipped, not run by CI.

    node bundle.cjs <outdir>                  # esbuild bundle of entry.ts plus an index.html
    node drive.cjs <outdir> compile           # compile and link each stage, JSON report
    node drive.cjs <outdir> shots <pngdir>    # rest, mid pull-back and pulled-back screenshots
    node drive.cjs <outdir> measure           # GPU time per pass by timer query, two viewports, two levels
    node drive.cjs <outdir> variants          # the same with source patches (no erosion, no tree, value-only fbm)
    node drive.cjs <outdir> phacelle          # the Phacelle gradient probe behind world.ts `phacelleGradBound`

Needs `esbuild` and `playwright@1.48.2` on `NODE_PATH` and a Chromium. The first run was done on a
host with no GPU, so `drive.cjs` launches with `--use-angle=swiftshader` (software Vulkan). On a
machine with a GPU, remove those flags to measure the real device. `bundle.cjs` must run from a
directory whose ancestors hold no empty `package.json` (esbuild reads them).

Timings from SwiftShader are CPU time: use them for the split between passes and for before and
after of one change, never as a phone frame time.
