# Background scene

**Default: the ridge scene** (`ridge/`): no per-frame WebGL (the baked cards are lit once per scene build, in a WebGL2 context that is released after). `startBackgroundScene` runs it unless the client
config says `backgroundScene.style: 'raymarch'`; the tier flag still defaults to `off`, and null still
means "keep the CSS ground". Everything below this section describes the opt-in ray-march scene.

- `ridge/Ridge.ts` `createRidgeScene({ canvas, tier, probe?, onProbe?, sky?, backdrop? })` returns `{ login, dispose }` or
  null (tier `off`, no 2D context). It paints the sky (`ridge/physicalSky.ts`, from the `SkyColours` the host passes) into a sky plate (`ridge/skyTurn.ts`): one element over the host
  canvas, the viewport's width plus its slack of sky each side (20 degrees, more as the turn speeds up: the margin of the speed in force over a tick and 2 s of lateness, and 14 degrees of travel), centred on the heading `heading.ts` owns, holding the sky with the real stars, the moon and the lines baked into it and a
  twinkle canvas for the swinging stars (`ridge/stars.ts`) over it. The sky is at infinity, so one animation slides the plate by the heading's turn at the cards' px per degree, on the
  same keyframes as the cards; a residency tick or a reissue paints a new plate about the heading once it is within that margin of the plate's edge (or the speed asks for more slack) and swaps it in the same tick,
  keyed from the clock after the paint (the same sky at the same screen place, so nothing moves; the twinkle schedule runs over the catalogue, so a swap keeps which stars swing; the plate's backing store is capped at 3 Mpx, the pixel ratio lowering before the plate shrinks). Then come the lit ridge
  cards (below) and, when it rains, tiled rain streaks slid down on the compositor (`ridge/rain.ts`). A sky with no physical model is a gradient in the host canvas.
  With no cards (the load failed) the scene shows the sky, stars and weather only, the plate facing the place's rest azimuth and staying. No script runs per frame except the twinkle, at most every 50 ms, and, only inside the scene view while a pointer is down, the pointer events that turn the heading (below).
  The host canvas and its parent must be positioned and the parent must clip (the plate is wider than the viewport); the canvas should fill the parent. A resize rebuilds it; so does a sky change
  (`index.ts`).
- Paused when the tab is hidden; under `prefers-reduced-motion` the rain is paused and the stars stay at base brightness.
  `tier: 'still'` paints the sky (facing the heading its pose froze at) and stars into the host canvas and adds no plate, no rain and no loop.
- Cadence guard: for the first 2 s after start (after 5 warm-up frames) rAF intervals are sampled; if their p95 is over
  33 ms the scene settles to a still image (`ridge/probe.ts`) and stops. `?probe=1` (or `probe: true`) keeps sampling
  and shows `n / median / p95` in a corner readout.
- `ridge/skyColour.ts` `skyColours()` is the fallback three-stop palette (top, mid, horizon) a scene gets with no `sky` option; the host
  passes `ridgeSkyFor` (skyForState.ts) instead.
- Ridge cards: `ridge/manifest.ts` `loadManifest` reads `${BASE_URL}public/ridge/index.json` (config `backgroundScene.place` picks the entry,
  unknown or absent: the index default), then the place's `manifest.json` (schema 3, written by `scripts/ridge-bake/export.py`; it is the one JSON
  the backdrop reads): the whole 360 degree ring, K G-buffer cards nearest first, each cut into azimuth tiles (32 of 11.25 degrees) of a colour WebP (albedo,
  straight alpha) and a geometry WebP (the normal as 'rt8', the log-distance, and the wall code R = G = 255 for the extruded face under a ridge), each tile
  with the card's distance there; `camera.r_max_m` bounds the parallax offset over every angle of the camera on its circle and `camera.r_max_forward_m` with the camera on its heading alone. Schema 2 is refused with a message naming the stale deploy. `index.ts`
  `prepare()` loads the manifest, anchors the heading (`ridge/heading.ts`) and, with the scene chunk, `ridge/Backdrop.ts` `createBackdrop`: `ensure(arc)`
  asks for the files of the tiles of an arc of azimuth it does not hold a few at a time (6 requests, each with a timeout) and decodes them one tile at a time (no premultiply, no colour management), and `ridge/lightCards.ts`
  `createLighter` lights each card of a tile in WebGL2 for the sky of this build (sun and ambient from the atmosphere in absolute azimuth, aerial perspective from the
  geometry's distance, ink on occluding edges and creases, the sky's own display so terrain and sky share an exposure) into a 2D canvas of the tile's interior and one
  overlap column each side. The backdrop holds the arc ahead and two tiles beyond and lets go of the rest; a tile that fails is absent and asked for again by the backdrop itself after a pause that doubles to a minute, for as long as the arc last asked for wants it (a still has no timer of its own), and a file the server answers 404 is not asked for again (the tile is drawn with the cards that came). A sky change is a
  rebuild, so it makes a new lighter; nothing is lit per frame, and the host canvas is only ever asked for 2d.
  `createRidgeScene({ backdrop })` stays synchronous (`prepare()` awaits the first arc), and a rebuild keeps the old scene up until the new one holds tiles, then swaps (a build a newer one supersedes is given up at once, its requests aborted; a rebuild has no failure end: with no tile it stays pending beside the scene that is up, its loader asking again, and replaces it the moment it holds one; only a build with no ridge up behind it, a first load or a rebuild over the sky alone, that ends with no tile is the sky alone). The page theme and ink follow the sky of the scene that is up (`sceneDrawn.ts` holds it, set by the door's `onActive`), never the band announced; the
  pose survives it. The rig is one div of K boxes, one per card (farthest first; DOM order is paint order; no z-index, no fixed position, nothing outside the scene's
  parent), each holding that card's resident tiles at their unwrapped azimuth. A card's pose (scale and shift) is derived by `view.ts` `cardPose` from its distance at
  the heading (`ring.ts`), the viewer's offset and the camera's angle on its circle, as a camera on a circle round the bake centre sees it (ruling ridge-camera-on-circle;
  the offset is signed and clamped by `offsetRange`, the one clamp, by the mode: the forward bound with the camera on its heading, the worst-case bound where it circles; the speed by `maxSpeed`,
  what the baked resident count sustains, applied to the stored choice). `cameraState.ts` is the one owner of the viewer's mode, speed and offset in `ratatoskr.camera`; `heading.ts` owns the view's pose, the direction, the camera's angle over it and its offset, as one segment (module
  state: the pose at a clock, the mode and speed in force and the ease to the pose the choices owe; any change of a choice, a hold, a bound or reduced motion starts a new segment from the pose it has at that clock, `poseAt(t)` is a pure function of it, and a mode pick eases the angle and the offset one after the other, 300 ms each, in the order that keeps every pose inside the bound; `cameraState.ts` hands it each change synchronously before its listeners and keeps no log; `view.ts` `offsetRange`, given to it by the scene, is the one clamp; angles are normalized into [0, 360) before each stretch so nothing grows with uptime; a manual `hold` sets the mode to still, so a rebuild or a reload keeps it). The motion is one `Element.animate` per card (transform only, a
  keyframe each second for 30 s and every 50 ms while an ease runs, reissued at 80% and on any change; paused when the tab is hidden or motion is reduced, then constant); a 500 ms timer asks the backdrop for
  the arc every pose of the next 30 s passes over (`view.ts` `sweepArc`, sampled four times a second, not its two ends) and mounts the tiles it has made. A still draws the sky and the tiles of the arc into the host canvas at the heading now. A failure
  anywhere (404, a manifest that is not schema 3, no tile that will decode, no WebGL2, a lighting pass that throws) is the sky-only scene on `FALLBACK_VIEW`,
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
today's at the place (Night tonight's: the solar midnight nearest, before the day's noon the one just passed or coming, after it the one coming), from the sun's elevation crossings of the place-local day (`SKY_MOMENTS`, one row each: dawn and dusk at -3 degrees, golden hour at
+4, morning at the lesser of 15 degrees and half the noon elevation, noon the day's maximum, night solar midnight). Place-local time comes only from
`place.tz`, the IANA zone the baker writes into the manifest (`scripts/ridge-bake/places.json`); the viewer's own zone decides nothing. Auto and the
named moments draw today's weather; a free moment draws a clear sky.

`skyState.ts` holds the stores (choice, place, constellation lines) and tells listeners; the choice persists in `ratatoskr.skyChoice`. The key
of the old four-state menu is read once by `skyState.ts` (Day became Noon) and removed. `skyPlace.ts` is the one writer of the place: a scene start loads the manifest of the configured place (nothing else fetches it, so a page with no scene fetches nothing) and the build
settles what it draws, the manifest's place when the cards load, `FALLBACK_VIEW`'s when they do not (a failed manifest, no tile that will decode), so the sky, the weather, the ink and the Auto
timer read the place that is drawn. Until a scene has settled it no sky is drawn for ink and the theme's own ink stands. The one timer (Auto, a named moment) tells listeners when the band
changes or a named moment's place-local day rolls over.

The weather is one number (`ridge/weather.ts`), from the page URL's `?weather=`, else `weather.json` beside `config.json`, else clear.
The browser never calls a weather service. `weather.json` is written by Eureka's refresher (gamecult-ops `docs/weather-feed.md`, a 5-minute timer; the only writer) from GeoSphere Austria's TAWES station 11035 (Wien Hohe Warte), credit
"Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at". Shape: `{fetched_at, observed_at, station, precip_mm_10min, humidity_pct,
glow_wm2, sunshine_s_10min, attribution}`, null for a missing measurement. A file fetched more than 30 minutes ago, or holding an observation more than 40 minutes old, or from another station, is a clear
sky. Rain is the gauge; cloud is an estimate from the global radiation against Haurwitz's clear-sky value, cross-checked by the sunshine
duration, with the humidity as the fallback when the sun is low (`ridge/weatherFeed.ts`). The weather draws a cloud deck in the sky
(`ridge/clouds.ts`) and lays tiled rain streaks over the sky (`ridge/rain.ts`, compositor-driven, none in a still).

## The scene view

`sceneView.ts` owns whether the fullscreen view is open and which submenu is up (main-chunk safe). The entry is `SceneViewEntry` (`SceneViewEntry.tsx`), the icon button in the navigator and sign-in headers; it preloads the view's chunk on hover or focus. Opening pushes one history entry (so the browser Back button, Escape and Return are the same close), sets `html[data-scene-view]` and makes `#root` inert and hidden while it stays mounted, so the chat keeps its scroll and composer. `SceneViewHost.tsx` (mounted by `BackgroundScene.tsx`) loads `view/SceneView.tsx` as a chunk of its own and mounts it in `#portalContainer`; until it has loaded it stands Return and Escape there, a failed load closes the view, and once the view is gone it gives the focus back to the entry (`restoreEntryFocus`).

The view is a full-viewport turning surface and, top left, a toolbar rail (Return, View, Time, Sky, Place; every icon `PhoneHit`) beside one panel at a time. View (`view/ViewSubmenu.tsx`): rotation mode, speed (bounded by `view.ts` `maxSpeed` for the mode) and the signed parallax offset (`offsetRange`), each written to `cameraState.ts` on release. Time (`view/TimeSubmenu.tsx`): the sky menu's moments and free moment, unchanged, to `skyState.ts` `setSkyChoice`. Sky (`view/SkySubmenu.tsx`): the constellation lines (`setConstellationLines`, the one setter). Place (`view/PlaceSubmenu.tsx`): the place shown and every data credit (terrain, stars, lines, and the weather only where the feed serves the place; ruling ridge-view-credits-home); the carousel is cut ridge-places. Return calls `setCamera` with the chosen mode, which ends a hold.

Manual turning (`view/turning.ts`) happens only inside the view: a one-finger or mouse horizontal drag turns the heading one for one with the far sky (`dh = -dx / (pxPerDegH x plane.scale)`), the arrows 5 degrees (Shift 15), a horizontal wheel or swipe one for one; each event calls `heading.hold`, which re-issues the rig, and the rotation stays held until a mode is picked or Return is pressed. Pitch is never turned. While a pointer is down the panel and rail fade.

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
