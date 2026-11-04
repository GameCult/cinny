# Background scene

A two-pass WebGL2 scene for the client's background canvas: an infinite terrain of CultMath
noise with a world tree at its centre, dusk atmosphere and clouds, and a camera that pulls back
from the tree on login. It is a self-contained module; nothing in the client imports it yet.
Integration (a canvas under the app, `startBackgroundScene`, `login()` when the session starts,
`dispose()`) is Void's cut `terrain-background`; the personas (`orbiting-personas`) and the squirrel
are later cuts. This PR is the render core plus the contract the host needs: flag, tier, failure
callbacks and the creature sizing rule. Nothing has drawn a creature.

## Entry points

- `index.ts` `startBackgroundScene(config.backgroundScene, capabilities, options)` is the host's
  door. The client config's `backgroundScene.tier` (`off` default, `still`, `low`, `full`) is the
  feature flag and the ceiling; `tier.ts` lowers it for `saveData`, low memory or few cores. At
  `off` nothing is imported and no canvas context is requested; otherwise `Scene.ts` loads on
  demand, so it stays out of the main chunk; if that chunk fails to load the error goes to
  `onCompileFail` and the door returns null, it does not throw.
- `Scene.ts` `createScene({ canvas, tier, onCompileFail, onContextLost, ... })` returns
  `{ login, dispose }`, or `null` (keep the CSS ground then) when the tier is `off`, WebGL2 is missing, neither
  `EXT_color_buffer_float` nor `EXT_color_buffer_half_float` exists (`onUnavailable` says which; with
  only the half extension the prepass start target is RGBA16F, written rounded down), or a shader fails to compile (`onCompileFail` gets the
  `ShaderCompileError`; programs already linked are freed). `still` is a live rendered frame, not a
  baked image: it runs the full pipeline once at the top level and stops; `low` starts the ladder at level 2; `full` at level 0. A lost WebGL context
  stops the scene for good and calls `onContextLost`; nothing rebuilds it, the host decides what to
  show. It caps at 30 fps, pauses when
  the tab is hidden, renders 32 frames and stops under `prefers-reduced-motion` (a change of the
  preference while it runs freezes or thaws it), and steps down a
  quality ladder (`budget.ts`) against a 4 ms GPU budget when timer queries exist.
- `creatures.ts` the creature record and `creatureScale`: a neutral creature is one fixed size and
  overrides `sizeBucket`. The bucket names and scales are placeholders until the persona cut owns them.
- `camera.ts` the pull-back path as pure functions (`pullProgress`, `cameraPose`).
- `world.ts` every world number, and the Lipschitz bounds the sphere trace steps by. The GLSL
  `#define`s are generated from it; no number is written twice.
- `shaders/` `sdf.glsl` (the distance bound pass 0 and pass 1 share), pass 0 `prepass.frag.glsl`, pass 1 `terrain.frag.glsl`, pass 2 `atmosphere.frag.glsl`, `resolve.frag.glsl` (TAA),
  `composite.frag.glsl`, plus CultLib's vendored GLSL (`shaders/README.md`).

## How it renders

0. **Cone prepass** (`prepass.frag.glsl`, one texel per 8x8 tile of pass 1): marches one ray per
   tile, shrinking each step by the widest any ray of the tile strays from it, so every step is
   free for the whole tile. It stores the distance no ray of the tile can have hit before, or
   `W_FAR` when the whole tile climbs out above the highest geometry. Pass 1 starts its rays
   there. `createScene({ prepass: false })` skips it (the measurement baseline).
1. **Solid pass** (`terrain.frag.glsl`, 0.4-0.75 of canvas resolution): sphere trace of
   `min(terrain, tree)`. Terrain height is `mask(r) * (A * fbm + E * phacelle)`, with
   `cultmath_fbm_grad(...).w` and `cultmath_phacelle(...).cos.w`. It writes lit colour with
   coverage and the hit distance (second render target).
2. **Atmosphere pass** (0.25-0.5 of canvas): closed-form exponential height fog plus a cloud
   slab marched with a few jittered steps, both only up to the hit distance from pass 1.
3. **Resolve**: TAA on the atmosphere (Halton jitter, history reprojected by the pass-1 depth,
   3x3 neighbourhood clamp, 1/8 blend; reset on resize, level change and wake).
4. **Composite** at canvas resolution: solid over analytic sky, then the atmosphere, ACES
   tonemap, dither.

`createScene({ onTraceStats })` measures the trace: pass 1 gets a step-count output and an extra
render target, read back every 8th frame through a pixel-pack buffer and a fence (never waited
on), and reports mean steps per pixel. Unset, neither the output nor the target exists.

## The step bound, and what is not proven

The trace steps by `(y - h(x, z)) / sqrt(1 + G^2)`, `G` the Lipschitz bound of the height field,
computed from `SNOISE_LIPSCHITZ` (CultMath's constant for `snoise`) in `world.ts`. Above the
envelope (fbm plus the erosion amplitude) the step uses the envelope's bound alone and Phacelle is
not evaluated.

- The Phacelle gradient bound `phacelleGradBound` (7.0) is Libby's measured sup (6.63 at
  |side| = 1.5, n = 0, CultLib PR #1 head 990521b3) plus margin: a measurement, not a proof.
  The shader fixes roughness n = 0; a nonzero n needs the bound divided by (1 - n).
- The bound makes grazing rays crawl. A ray that exhausts its steps while still below the highest
  terrain is ended as a distant surface (fog hides it). That is a visible approximation, not a
  hit proven by the march.
- The low-resolution atmosphere samples pass-1 depth nearest, so silhouettes of near objects
  carry a thin fog halo.

## Measured and not measured

See the pull request or `harness/scene/README.md` for the numbers and how they were taken. They
come from a software rasterizer, not a GPU, and nothing has been run on a phone.
