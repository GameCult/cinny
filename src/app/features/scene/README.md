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
  demand, so it stays out of the main chunk; `backgroundScene.style` picks which scene loads:
  `voxel` (default, below) or `raymarch` (the rest of this file); if that chunk fails to load the error goes to
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

## The voxel scene (default style)

`voxel/Voxel.ts` `createVoxelScene` takes the same options and returns the same `{ login, dispose }`
as `createScene`, so the door swaps one for the other. It is the cheap background: WebGL2 core
only (no extension is requested, no float target is allocated). It draws the terrain painter's order,
as instanced vertical strips, instead of marching a ray per pixel.

- A wrapping ring of 256 x 256 world cells (8 units each) around the camera, in an RG8 texture
  holding a 16-bit height per cell. Cell (x, z) lives at texel (x mod 256, z mod 256). When the
  camera crosses into another cell, `ring.ts` `ringRects` names the columns and rows it admitted
  and `shaders/voxelHeight.frag.glsl` rewrites exactly those, scissored: one `terrainFbm` plus one
  Phacelle per texel, the ray-march scene's terrain without its plateau mask. A cell's height is a
  pure function of the cell, so the order of writes cannot change the ring. A move of a whole ring
  or more, or the first frame, rewrites all of it.
- `shaders/voxelStrips.vert.glsl` draws the terrain: one instance is a screen column (one buffer
  pixel wide) at one depth step, and the host draws the steps far to near with no depth buffer
  and no blending, so a nearer strip overwrites what it hides. A strip's vertices fetch its height
  and its nearer neighbour's from the ring (vertex texture fetch, core WebGL2) and project them
  with the shear `y = horizon + (h - camY) / (z * tanHalf.y)`; the quad runs from its own top
  down to the nearer neighbour's top (the screen bottom for the first strip drawn), and collapses
  when the neighbour is higher. Colour is chosen once per strip, by height, slope along the view
  ray and fog, and leaves as a flat varying (the last vertex of each strip triangle is a top
  vertex); `shaders/voxel.frag.glsl` writes it with a dither. Depths follow `voxelWorld.ts`
  `stepDepth` (about a cell up close, 2% of the depth far away; the same closed form in GLSL and
  TypeScript), strips nearer than any terrain could reach the screen are not drawn, and strips
  past a column's far plane (120 cells) are clipped in the vertex shader.
- `shaders/voxelBackdrop.frag.glsl` is the sky behind the strips, one fullscreen triangle.
- The drawing buffer is a fixed pixel budget in the canvas's aspect, 320 x 180 at the top of the
  ladder; CSS scales it up. One column per buffer pixel, so the strip count follows the width.
- The sky is baked once into RGBA8 (`voxelSky.frag.glsl`, gradient plus cloud bands) and sampled
  by azimuth and elevation (the strips' vertex shader samples the horizon row for fog). The CSS ground stays the fallback: `createVoxelScene` returns null
  where `createScene` would, and says why through `onUnavailable`.
- Resolution adapts through the drawing-buffer size, not extra targets: `BudgetLadder` over
  `SCALE_LEVELS` (1, 0.8, 0.64, 0.5 of the side of the 320 x 180 budget) steps down when the median frame time misses the 30 fps cap, using only
  `requestAnimationFrame` cadence, since timer queries are an extension.
- `rails.ts` is the camera: a straight rail with the yaw wandering either side and sway, constant
  altitude above the terrain; `login()` lifts and tips it down.
- Measurement without extensions: `onFrameStats` gives the cadence, the buffer size, the vertices
  submitted and the ring lookups the frame costs (two per shaded strip vertex, counted on the host
  from the same schedule the shader runs). Setting `onTraceStats` makes one frame in eight time
  the draw with a one-texel synchronous read, then draw the strips again off screen, each fragment
  adding one count, and read that back: lookups per pixel, and fragment overdraw per pixel.
  `harness/scene` has `drive.cjs voxel`, `voxelshots` and a standalone page.

## Measured and not measured

See the pull request or `harness/scene/README.md` for the numbers and how they were taken. They
come from a software rasterizer, not a GPU, and nothing has been run on a phone.
