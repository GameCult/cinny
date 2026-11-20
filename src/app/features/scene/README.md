# Background scene

**Default: the ridge scene** (`ridge/`): no per-frame WebGL (the baked cards are lit once per scene build, in a WebGL2 context that is released after). `startBackgroundScene` runs it unless the client
config says `backgroundScene.style: 'raymarch'`; the tier flag still defaults to `off`, and null still
means "keep the CSS ground". Everything below this section describes the opt-in ray-march scene.

- `ridge/Ridge.ts` `createRidgeScene({ canvas, tier, probe?, onProbe?, sky?, backdrop? })` returns `{ login, dispose }` or
  null (tier `off`, no 2D context). It paints the sky (`ridge/physicalSky.ts`, from the `SkyColours` the host passes) on the host
  canvas at the viewport's size in canvas pixels, then the stars baked into it, a twinkle overlay canvas for the swinging ones
  (`ridge/stars.ts`), the lit ridge cards (below) and, when it rains, tiled rain streaks slid down on the compositor (`ridge/rain.ts`).
  With no cards (the load failed) the scene shows sky, stars and weather only. No script runs per frame except the twinkle, at most every 50 ms.
  The host canvas and its parent must be positioned and the canvas should fill the parent. A resize rebuilds it; so does a sky change
  (`index.ts`).
- Paused when the tab is hidden; under `prefers-reduced-motion` the rain is paused and the stars stay at base brightness.
  `tier: 'still'` paints the sky and stars and adds no overlay, no rain and no loop.
- Cadence guard: for the first 2 s after start (after 5 warm-up frames) rAF intervals are sampled; if their p95 is over
  33 ms the scene settles to a still image (`ridge/probe.ts`) and stops. `?probe=1` (or `probe: true`) keeps sampling
  and shows `n / median / p95` in a corner readout.
- `ridge/skyColour.ts` `skyColours()` is the fallback three-stop palette (top, mid, horizon) a scene gets with no `sky` option; the host
  passes `ridgeSkyFor` (skyForState.ts) instead.
- Ridge cards: `ridge/manifest.ts` `loadManifest` reads `${BASE_URL}public/ridge/index.json` (config `backgroundScene.place` picks the entry,
  unknown or absent: the index default), then the place's `manifest.json` (schema 2, written by `scripts/ridge-bake/export.py`; it is the one JSON
  the backdrop reads): K G-buffer cards, nearest first, each a colour WebP (albedo, straight alpha) and a geometry WebP (the normal as 'rt8', the
  log-distance, and the wall code R = G = 255 for the extruded face under a ridge). `index.ts` `prepare()` loads the manifest and, with the scene chunk,
  `ridge/Backdrop.ts` `loadBackdrop`: every card's two files fetched and decoded straight (no premultiply, no colour management), then
  `ridge/lightCards.ts` lights each card once in WebGL2 for the sky of this build (sun and ambient from the atmosphere, aerial perspective from the
  geometry's distance, ink on occluding edges and creases, the sky's own display so terrain and sky share an exposure) into a 2D canvas, and releases
  the context. A sky change is a rebuild, so it lights again; nothing is lit per frame, and the host canvas is only ever asked for 2d.
  `createRidgeScene({ backdrop })` stays synchronous, and a rebuild keeps the old scene up until the new one's cards are lit, then swaps. The rig
  is one div of K card elements (farthest first; DOM order is paint order; no z-index, no fixed position, nothing outside the scene's parent),
  each placed at its rows of the plane and moved by `view.ts` `cardMotion`: the camera turns through the baker's heading range (capped so every card still covers
  the viewport) and card i pans `scale_i` x heading and is drawn `scale_i` times its bake, about the horizon centre, as a camera pushed forward on a circle
  round the bake centre sees it (ruling ridge-camera-on-circle); the scales come from the manifest. It drifts on `Element.animate` (transform only, 150 s loop,
  paused when the tab is hidden, motion is reduced or the scene is still); a still draws the same cards at heading 0 into the host canvas. A failure
  anywhere (404, a manifest that is not schema 2, a card that will not decode, no WebGL2, a lighting pass that throws) is the sky-only scene on `FALLBACK_VIEW`,
  told to the host by the live scene alone, through `onPlanesFail` when the live scene has no cards and `onPlanesOk` when a later one has them (never from a stale
  or disposed build); it is never `onCompileFail`. `vite.config.js` copies `public/ridge` into `dist/public/`.
- `harness/scene/bundle.cjs <out> ridge` builds a standalone page (`?tier=`, `?probe=1`).
- Not yet measured on a phone: see the PR description.

## Ray-march scene

A two-pass WebGL2 scene for the client's background canvas: an infinite terrain of CultMath
noise with a world tree at its centre, dusk atmosphere and clouds, and a camera that pulls back
from the tree on login. It is a self-contained module; nothing in the client imports it yet.
Integration (a canvas under the app, `startBackgroundScene`, `login()` when the session starts,
`dispose()`) is Void's cut `terrain-background`; the personas (`orbiting-personas`) and the squirrel
are later cuts. This PR is the render core plus the contract the host needs: flag, tier, failure
callbacks and the creature sizing rule. Nothing has drawn a creature.

## Ridge scene: Vienna and the weather

The ridge sky is the physical atmosphere (`ridge/earthAtmosphere.ts`) lit by the sun over the viewpoint (Vienna's is 48.1929826 N, 16.3534237 E, from the manifest).

### The sky choice

The viewer's choice is Auto, one of six named moments (Dawn, Morning, Noon, Golden hour, Dusk, Night) or a free moment (a place-local date and
minute of the day). `ridge/skyMoment.ts` is the one owner of what it draws: `momentFor(choice, place, now)` returns the instant and `skyBand(elevation)`
turns the sun at that instant into day, dusk or night (day from 6 degrees up, night from 6 down), which the ink theme (`skyTheme.ts`, `skyInk.ts`), the
display budget (`ridge/toneMap.ts`) and the rebuild key (`skyForState.ts`) all read. Auto is the real sun over the loaded place now. A named moment is
today's at the place, from the sun's elevation crossings of the place-local day (`SKY_MOMENTS`, one row each: dawn and dusk at -3 degrees, golden hour at
+4, morning at the lesser of 15 degrees and half the noon elevation, noon the day's maximum, night solar midnight). Place-local time comes only from
`place.tz`, the IANA zone the baker writes into the manifest (`scripts/ridge-bake/places.json`); the viewer's own zone decides nothing. Auto and the
named moments draw today's weather; a free moment draws a clear sky.

`skyState.ts` holds the stores (choice, place, constellation lines) and tells listeners; the choice persists in `ratatoskr.skyChoice`. The key
of the old four-state menu is read once by `skyState.ts` (Day became Noon) and removed. `skyPlace.ts` loads the manifest of the configured place and makes its place the
sky's, so the ink and the scene read one place; until it is known no sky is drawn for ink and the theme's own ink stands.

The weather is one number (`ridge/weather.ts`), from the page URL's `?weather=`, else `weather.json` beside `config.json`, else clear.
The browser never calls a weather service. `weather.json` is written by Eureka's refresher (gamecult-ops `docs/weather-feed.md`, a 5-minute timer; the only writer) from GeoSphere Austria's TAWES station 11035 (Wien Hohe Warte), credit
"Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at". Shape: `{fetched_at, observed_at, station, precip_mm_10min, humidity_pct,
glow_wm2, sunshine_s_10min, attribution}`, null for a missing measurement. A file fetched more than 30 minutes ago, or holding an observation more than 40 minutes old, or from another station, is a clear
sky. Rain is the gauge; cloud is an estimate from the global radiation against Haurwitz's clear-sky value, cross-checked by the sunshine
duration, with the humidity as the fallback when the sun is low (`ridge/weatherFeed.ts`). The weather draws a cloud deck in the sky
(`ridge/clouds.ts`) and lays tiled rain streaks over the sky (`ridge/rain.ts`, compositor-driven, none in a still).

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
  stops the scene for good and calls `onContextLost`; the scene never rebuilds itself. `host.ts` disposes it, drops
  `data-scene` so the CSS ground shows, and starts a fresh scene on `webglcontextrestored`. It caps at 30 fps, pauses when
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
