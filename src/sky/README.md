# Baked sky

`npm run bake:sky` (`scripts/bake-sky.mjs`) lights two fixed moments with `sun.js`, the single source of
the sun and the air, and writes `baked.ts`. `baked.midnight`, `baked.noonday` and `baked.scatter` are its
three keys. Everything here is linear RGB unless a name says `hex`.

## Per sky: `baked.midnight`, `baked.noonday`

| field                    | meaning                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `moment`                 | `{ time, lat, lon }` fed to `sun.js` (equinox, 45N, prime meridian; 00:00 and 12:00 UTC)                                                     |
| `elevation`              | sun elevation in degrees at that moment: -44.6 midnight, +45.2 noonday                                                                       |
| `sun.elevation_deg`      | the same, for scene code; fade stars by this (and see below for twilight)                                                                    |
| `sun.azimuth_deg`        | degrees clockwise from north, 0..360                                                                                                         |
| `sun.color_linear`       | direct sun colour at normal incidence, clear zenith ~ 1; multiply by `max(0, dot(n, toSun))`                                                 |
| `ambient_linear`         | sky ambient on an upward surface, with a night floor of `AMBIENT_FLOOR` (a moonlit skyglow, not black); daylight is `sun.js`'s own `diffuse` |
| `horizon_hex`            | colour of the last gradient stop, the horizon                                                                                                |
| `gradient`               | 7 sRGB hex stops, zenith to horizon                                                                                                          |
| `tokens`, `bubbles`, ... | theme colours (see `skyTokens.js`)                                                                                                           |

The two skies are single moments. To fade stars through twilight, take the elevation from `sun.js` at the
viewer's real time (`sunPosition(time, lat, lon).elevation`) rather than from `baked.<sky>.sun`, which only
ever says -44.6 or +45.2. The scattering table below goes dark at -12 degrees and below (the planet's shadow
covers every sunlit air path), so a star fade between about -6 and -12 degrees follows it.

## `baked.scatter`: atmospheric scattering for a WebGL2 shader

A Hillaire-style (2020) single-scattering atmosphere, reduced to two small tables. The air is `sun.js`'s:
`TAU` (its zenith optical depth per channel) is the vertical optical depth here, split into a grey aerosol
part (0.02) and a Rayleigh part, so the transmittance table equals `exp(-TAU)` at the zenith. Planet radius
6360 km, atmosphere 100 km, scale heights 8 km (Rayleigh) and 1.2 km (Mie, g = 0.8, albedo 0.9), observer
100 m above the ground. Single scattering only: no ground bounce, no multiple scattering, no sun disc
(the consumer draws it from `sun.color_linear`). That makes dusk a little darker than the real thing.

Constants: `planet_radius_km`, `atmosphere_height_km`, `observer_altitude_km`, `extinction_per_km` (RGB at the
observer, for aerial perspective: `exp(-k * distance_km)`).

### Encoding (both tables)

IEEE 754 half floats (16 bit), little-endian, base64 of the raw bytes, no header. The stored value is
`value * store_scale` (`store_scale` = 64; it lifts the dark end of twilight clear of the half-float
subnormals). Exact decode: for a 16-bit word `h`, `e = (h >> 10) & 31`, `m = h & 1023`,
`half = e == 0 ? m * 2^-24 : (1 + m / 1024) * 2^(e - 15)` (no infinities or NaNs are stored), and
`value = half / store_scale`. In WebGL2 upload as `RGB16F` / `HALF_FLOAT` from a `Uint16Array` over the
decoded bytes, and the GPU does the decode: sample, then divide by `store_scale`. Precision is 11 bits
(about 0.05%): the horizon glow does not step.

### `transmittance`: `width` 32, `height` 1, 3 channels

Transmittance from the observer to space along a view elevation, per channel. Texel `i` is the elevation
`-4 + 94 * (i / 31)^2` degrees (`viewElevation(i)` in `scatter.js`; the inverse is `viewIndex(deg)`):
finest at the horizon. Elevations that look at the ground (-4 to about -0.3) are 0. Sample it for the sun's
direct colour: at the sun's elevation, `sun.color_linear`-like attenuation, redder as it sets.

### `sky_view`: `width` 7, `height` 32, `depth` 12, 3 channels

Sky radiance per steradian for a sun of unit irradiance (multiply by your own sun colour and exposure).
One 3D texture, `x` fastest:

- `x`: azimuth of the view away from the sun, 0, 30, ... 180 degrees (`azimuth_step_deg`). The sky is
  symmetric about the sun's vertical plane, so use `abs` of the relative azimuth.
- `y`: view elevation, same axis as the transmittance table (`viewElevation(i)`).
- `z`: sun elevation, `sun_elevations_deg` = -18, -12, -8, -5, -2, 0, 3, 8, 15, 25, 45, 90. Between them
  interpolate linearly; `sunIndex(deg)` in `scatter.js` gives the fractional index.

Element `((z * 32 + y) * 7 + x) * 3 + c` of the decoded array. Texel centres, for linear filtering:

```glsl
uniform highp sampler3D uSky;   // RGB16F, 7 x 32 x 12, LINEAR, CLAMP_TO_EDGE
uniform float uSunIndex;        // sunIndex(sunElevationDeg), 0..11, from the CPU
vec3 skyRadiance(float viewElDeg, float azFromSunDeg) {
  float y = sqrt(clamp((viewElDeg + 4.0) / 94.0, 0.0, 1.0)) * 31.0;
  float x = clamp(abs(azFromSunDeg) / 180.0, 0.0, 1.0) * 6.0;
  return texture(uSky, vec3((x + 0.5) / 7.0, (y + 0.5) / 32.0, (uSunIndex + 0.5) / 12.0)).rgb / 64.0;
}
```

Row width is 21 bytes, so set `gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)` before `texImage3D`.

Size: 16,128 bytes for `sky_view` (21.5 KB as base64) and 192 bytes for `transmittance`; about
twice the "few KB" of an 8-bit table, the price of not quantising the glow. `scatter.test.ts` pins the
layout, the encoding, the checksums and a set of physical anchors (blue noon sky, red sunset toward the sun,
black below the planet's shadow limit).

### `aerial_perspective`: the camera volume for ground seen through the air

After Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020, section 5.4, and its
reference code (sebh/UnrealEngineSkyAtmosphere, `RenderCameraVolumePS` in `RenderSkyRayMarching.hlsl`). RGBA half floats
(same encoding, `store_scale` 64), `width` 7, `height` 96, `depth` 12, 4 channels; one 3D texture, `x` fastest:

- `x`: azimuth of the view ray from the light, 0, 30, ... 180 degrees (as `sky_view`).
- `y`: `slice * 8 + elevation`: 12 slices, each a block of 8 view elevations, `-50 * (1 - i / 7)^2` degrees (finest at 0,
  rays at or above the horizon are clamped to 0). Keep the filter inside a block: sample at `(slice * 8 + e + 0.5) / 96`, `e` in 0..7.
- `z`: light elevation, `sun_elevations_deg`, as `sky_view`. The same volume serves the moon: look up at the moon's elevation.
- Slice `k` is the far side of `max_km * ((k + 1) / 12)^2` km (the paper's squared distribution; `max_km` 20). Between slices interpolate
  linearly; below slice 0 fade to zero at the observer, as the reference does for `Slice < 0.5`.
- RGB: in-scatter luminance per steradian for a light of unit irradiance. A: opacity `1 - mean(rgb transmittance)`, the paper's grey
  transmittance. Apply as `surface * (1 - A) + L * exposure`.

Follows the paper: the squared slice distribution, the in-scatter integral with each step's extinction integrated analytically
(`S (1 - exp(-e dt)) / e`), single scattering with Rayleigh and Mie (g 0.8) phase, and the grey opacity in alpha.
Shortcuts: sun-relative azimuth and elevation instead of screen position; 12 x 8 x 7 texels, not 32 x 32 x 32; path lengths are the
scene's metres times `distance_scale` (8), because a real atmosphere is nearly clear across a 3 km patch; the ray ignores the ground
(density held at its ground value, sun visibility tested from the ground sphere); no multi-scattering LUT (the paper's dusk fix);
observer at 100 m. Units: distances in km, radiance per unit sun irradiance, as `sky_view`. 86 KB as base64.
