Serves: Ratatoskr background sky and real-weather idea (ratatoskr:ruling:yggdrasil-scene-orbiting-personas; operator 2026-10-31). Eyes facts pass; facts, not recommendations.

# Eyes facts: atmospheric scattering and real weather for the Ratatoskr background

Serves the Ratatoskr background (operator 2026-10-31). Facts with evidence pointers; no conclusions.
Date of pass: 2026-10-31. Tool budget ~45 calls. "Unverified" marks anything not read in a primary source this pass.

NOTE (infrastructure detail): the server location in section B7 is infrastructure detail. Keep it out of public pages unless the operator rules otherwise.

---------------------------------------------------------------
## PART A

### A1. Bruneton and Neyret 2008; Bruneton 2017 reimplementation
- Paper: Bruneton, Neyret, "Precomputed Atmospheric Scattering", Eurographics Symposium on Rendering 2008 (CGF 27(4), pp.1079-1086, as cited in the Hillaire 2020 reference list).
- Repo: https://github.com/ebruneton/precomputed_atmospheric_scattering. README: "released under the BSD license"; source header of model.cc: BSD-3-Clause, Copyright 2017. README links an online demo; the docs page says a WebGL2 version of the demo exists online and in the `webgl` subdirectory (https://ebruneton.github.io/precomputed_atmospheric_scattering/).
- Sizes, atmosphere/constants.h (master): TRANSMITTANCE 256 x 64; SCATTERING R=32, MU=128, MU_S=32, NU=8 (stored as 3D texture 256 x 128 x 32, width = NU*MU_S); IRRADIANCE 64 x 16.
- Formats, atmosphere/model.cc: transmittance and irradiance 2D textures always RGBA32F (comment: "16F precision for the transmittance gives artifacts"). 3D scattering textures RGBA16F or RGBA32F by `half_precision` flag (RGB variants used if renderable). Optional single-Mie 3D texture; `combine_scattering_textures` packs Mie into alpha. 3D textures are filled layer by layer through a geometry shader setting gl_Layer. Desktop GL 3.3 core (`#version 330`, GLAD); file does not reference EXT_color_buffer_float or OES_texture_float_linear.
- Precompute: iterative scattering orders (`Model::Init(num_scattering_orders)`, loop from order 2). Hillaire 2020 section 6 states updating all Bruneton LUTs with the provided code costs 250 ms, 99% of it in the multiple-scattering iterations; also states 32-bit float LUTs were used for Bruneton in its comparison.
- Hillaire 2020 slide 22 / text: Bruneton render with LUTs already updated = 0.22 ms (720p, GTX 1080).

### A2. Hillaire 2020, EGSR (CGF 39(4), pp.13-22, doi 10.1111/cgf.14050)
Primary read: https://sebh.github.io/publications/egsr2020.pdf (Table 2, section 5, section 6); slides https://blog.selfshadow.com/publications/s2020-shading-course/hillaire/s2020_pbs_hillaire_slides.pdf
- LUTs: Transmittance, Multiple-scattering (isotropic, 2D), Sky-View (latitude/longitude around the camera-up vector, nonlinear mapping with detail at the horizon), Aerial-perspective (camera-frustum froxel volume; in-scattering RGB, transmittance in A as mean of RGB). Default AP: 32x32 over screen, 32 depth slices over 32 km (section 5.4).
- Table 2 (column layout garbled in text extraction; row order = Transmittance, Multi-scattering(?), Sky-View, AP as extracted; check against the PDF):
  - PC (GTX 1080): 256x64, 40 steps, 0.01 ms; 200x100, 30 steps, 0.05 ms; 32^3, 30 steps, 0.04 ms; 32^2, 20 steps, 0.07 ms.
  - Mobile (iPhone 6s): 256x64, 40 steps, 0.53 ms; 96x50, 8 steps, 0.27 ms; 32^2 x16, 8 steps, 0.11 ms; 32^2, 20 steps, 0.12 ms.
  - Text: PC final on-screen sky + AP = 0.14 ms; total 0.31 ms at 1280x720. "We do maintain a similar transmittance LUT on both platforms." Fortnite total sky cost "roughly 1 ms on iPhone 6s". 32-sample march with volumetric shadows: 1.0 ms.
- LUTs are re-evaluated per frame (paper: "LUT-based ... decouples from screen resolution"); slide 22 shows PC vs mobile; slide 11: scalable by LUT resolution and sample count; slide 696-698: "Only cloud rendering is not reasonably achievable on mobile" (Fortnite runs mobile ES3.1).
- Density model (section 4): Rayleigh e^(-h/8km), Mie e^(-h/1.2km), ozone tent 30 km wide at 25 km; ground 6360 km, top 6460 km.
- Dynamic atmosphere: abstract/slides state composition (weather, art) can change dynamically without a heavy LUT update; multiple-scattering caveats in slide 795-784 area (strong Mie lobe g=0.8 and strong Rayleigh differ from path-traced).
- Reference implementation: https://github.com/sebh/UnrealEngineSkyAtmosphere, MIT licence, DirectX 11, Windows only (README). LUT sizes not in README.
- WebGL2 ports: none found. Found WebGPU only: pmndrs/sky (three.js TSL), an npm package by jolifantobambla (WebGPU); C++/DX11 AirGuanZ/AtmosphereRenderer; C++ hoffstadt/pl-sky; GLSL files in a FlightGear fgdata mirror (https://git.nayala.duckdns.org/fly/fgdata ... Shaders/HDR/atmos-*.frag, which implement transmittance/sky-view/aerial perspective). Licences not read for any of these.
- Frostbite 2016 (Hillaire, SIGGRAPH Physically Based Shading course; https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf): XB1 720p: main view 0.42 ms, AP volume 32x32x16 0.05 ms, LUT update 3.50 ms on one frame or 0.22 ms/frame spread over 19 frames. Text lists Preetham [PSS99] turbidity-based analytic models as "limited to ground view".

### A3. Analytic sky models
- Preetham, Shirley, Smits 1999 (SIGGRAPH "A practical analytic model for daylight"): turbidity valid range 2 to 6 (Hosek-Wilkie preprint section 2.3.1). Zotti et al. 2007 (WSCG) review: negative zenith luminance at some inputs, unusable for very clean sky at low T, problems near sunrise/sunset (https://www.cg.tuwien.ac.at/research/publications/2007/zotti-2007-wscg/zotti-2007-wscg-paper.pdf; secondary snippets, not read in full).
- Hosek and Wilkie 2012 (ACM TOG 31(4), SIGGRAPH 2012; https://cgg.mff.cuni.cz/projects/SkylightModelling/HosekWilkie_SkylightModel_SIGGRAPH2012_Preprint.pdf): drop-in Preetham replacement; accounts for ground albedo; fitted to brute-force path-traced data; improves sunsets and high turbidity. Turbidity mapping text: T=2 clear ... T=6 warm moist day, T=10 slightly hazy (line 130-132 of extracted text). Max turbidity 10 (clamped; OctaneRender forum, secondary). Cannot simulate overcast (same secondary source). Ground-level observer only (Hillaire 2016 and 2020 state analytic models are limited to ground view).
- Prague sky model: Wilkie et al. 2021, ACM TOG "A fitted radiance and attenuation model for realistic atmospheres"; Vevoda et al. 2022 CGF (doi 10.1111/cgf.14677) extension. Third-party wrapper skymodelr documents: sun elevation -4.2 to 90 deg, visibility 20 to 131.8 km (default 50), observer altitude 0 to 15000 m, below-horizon support needs an extra coefficient file. Not read from the paper; unverified. Aerial perspective for Prague: no source found this pass.
- Per-pixel cost of analytic evaluations: not measured in any source read.

### A4. Weather knobs
- Hillaire 2020 / Bruneton: Rayleigh and Mie extinction/scattering coefficients and scale heights, Mie phase g (Hillaire slides: g=0.8 strong lobe), ozone absorption are input parameters; Hillaire states weather and time of day are dynamic (slide 681). Frostbite 2016 text: Mie particle concentration "depends a lot on weather conditions, or pollution"; turbidity = fraction of scattering from haze versus molecules.
- Hosek-Wilkie / Preetham: single weather knob is turbidity; ground albedo second.
- Clouds: Schneider and Vos, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn", SIGGRAPH 2015 Advances in Real-Time Rendering (https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf): weather map with coverage and cloud type controls (secondary description; slides not parsed this pass). Hillaire 2016 Frostbite: clouds evolve with weather; atmosphere LUT dynamic. Rain/precipitation: neither source read carries a precipitation section; a Chalmers thesis on Frostbite clouds lists "Precipitation" (publications.lib.chalmers.se/records/fulltext/241770/241770.pdf, unread).
- Field-to-knob pairing that sources state: Open-Meteo/MET cloud_cover low/mid/high = Schneider coverage per layer height band; visibility "influenced by low clouds, humidity and aerosols" (Open-Meteo docs) = extinction for the Mie/haze term; weather_code = WMO class. No source read gives a numeric mapping from visibility to Mie coefficient.
- Local existing precedent: CultLib docs/research/ground-motion-law.md:13-20 summarises Schneider 2015 (curl texture 128^2, wind offset `sample_position - wind_direction * scroll_offset`).

### A5. WebGL2 constraints
- EXT_color_buffer_float (render to R/RG/RGBA 16F and 32F): web3dsurvey WebGL2 stats: Android 99.82%, Chrome/Chromium 99.63% (https://web3dsurvey.com/webgl2/extensions/EXT_color_buffer_float).
- OES_texture_float_linear (linear filtering of 32F): WebGL2 stats Android 74.19%, Chrome/Chromium 94.23% (https://web3dsurvey.com/webgl2/extensions/OES_texture_float_linear). Figures are all-Android, not Chrome-on-Android alone.
- From WebGL2/ES3 spec knowledge, not fetched this pass: 16F textures are filterable with no extension; 32F filtering needs OES_texture_float_linear; 3D textures (texImage3D, sampler3D) are core in WebGL2; rendering into a 3D texture layer uses framebufferTextureLayer, one slice per draw (no geometry shader, no layered rendering).
- Bruneton's own use of 32F (transmittance, irradiance) and its comment on 16F artifacts is in A1; Hillaire states 16F suffices for his LUTs (section 6).
- Measured mobile timings found: Hillaire Table 2 iPhone 6s (A2), Fortnite ~1 ms on iPhone 6s. No Android WebGL2 timing found.

### A6. What GameCult already has (read-only)
CultLib origin/main (git grep on docs, packages/cultmath):
- No Rayleigh, Mie or sky model hit in packages/cultmath. Only atmospheric-adjacent hits: docs/research/ground-motion-law.md:13,20,51 (Schneider/RDR2 references).
- Transmittance for the cloud/nebula volume march: docs/cultmath-interval-ground-cut.md:46, 315 (maps CloudShader.shader:83-104), 366 (`if transmittance < 0.02: break`), 392 (TAA alpha), 420-424, 499 (sun self-shadow sample named, not taken), 2190-2197 (additive-blend footprint idea for exact transmittance in WebGL2, no compute). docs/cultmath-interval-ground-cut-site-ground.r3.spec.json:23 (WebGL2 main pass, R16F history, 3x3 clamp TAA).
- packages/cultmath/shaders/CultMath.Phacelle.glsl:1-12 (GlslLowering output of the HLSL, MPL-2.0 file, Phacelle copyright Rune Skovbo Johansen 2025, 3D cells, caller-supplied stripe vector, gradient). GLSL mirror tests: GlslMirrorTests.
Aetheria (F:\Projects\Aetheria):
- Assets/Plugins/Celestial Body/Scripts/Shaders/PostProcessing/Atmosphere.shader: per-pixel in-scatter march with `numInScatteringPoints` (:70,:127-141), scattering coefficients float4 (:73), baked optical-depth lookup `opticalDepthBaked` (:99), `opticalDepthBaked2` (:107-116), transmittance = exp(-(sun + view optical depth) * coefficients) (:136).
- Assets/Plugins/Celestial Body/Scripts/Shaders/Compute/Atmosphere/AtmosphereTexture.compute: compute kernel `CSMain`, [numthreads(8,8,1)] (:66), `RWTexture2D<float4> Result` (:4), writes a 2D optical-depth table indexed by (cos angle, height) (:71-90); Rayleigh/Mie split absent (single density).
- Assets/Shaders/Raymarching/CloudShader.shader: cloud march, transmittance (cited as :83-104, :116 in the CultLib doc). Assets/Shaders/Volumetric.cginc has no scattering/Rayleigh text (only `_DynamicSkyBoost`, line 43 and 232, nebula tint).
- No Hillaire LUT set, no Mie, no multiple scattering exist in either repo. Aetheria compute shader cannot run in WebGL2.

---------------------------------------------------------------
## PART B

### B7. Where Yggdrasil is
Location facts are held privately (infrastructure detail), not in this public repo.

### B8. Weather data sources
- Open-Meteo (https://open-meteo.com/en/terms, /en/docs): data CC BY 4.0; free tier non-commercial only (no ads, no subscriptions); limits 600/min, 5000/h, 10000/day, 300000/month per IP; no key for free; commercial use needs paid key. Fields checked live: current (15-minutely): temperature_2m, relative_humidity_2m, precipitation, rain, weather_code (WMO), cloud_cover, wind_speed_10m, is_day; hourly: cloud_cover_low (<3 km), cloud_cover_mid (3-8 km), cloud_cover_high (>8 km), visibility (m, instantaneous), dew_point_2m, wind 10/80/120/180 m, gusts. A live test of `current=cloud_cover_low` returned a value in `current` (15 min interval). Model refresh: ICON 3 h, GFS/HRRR 1 h, ARPEGE/AROME 1 h, IFS 6 h. Response carried `access-control-allow-origin: *` (browser fetch permitted). Attribution wording not on the terms page.
(host location line removed: infrastructure detail)
- MET Norway Locationforecast 2.0 (https://api.met.no/doc/TermsOfService, /weatherapi/locationforecast/2.0/documentation): free, no key; unique User-Agent mandatory (403 otherwise; Origin/Referer allowed if a browser cannot set UA); respect `Expires`; use If-Modified-Since; coordinates truncated to 4 decimals; over 20 req/s needs agreement; throttled on 429; mobile apps poll no more than every 10 minutes; CC BY 4.0, credit + link licence + mark changes, do not use "Yr" naming or logo. Live `complete` response fields (instant): air_temperature, cloud_area_fraction, cloud_area_fraction_high/medium/low, fog_area_fraction, relative_humidity, dew_point_temperature, air_pressure_at_sea_level, wind speed/direction, uv; next_1_hours/6/12 carry precipitation_amount and symbol_code. Model run `updated_at` 13:17Z observed with Expires ~30 min after fetch. CORS header present.

### B9. Client versus server fetch
- A browser fetch to Open-Meteo, Bright Sky or MET sends the viewer's IP, User-Agent and Origin/Referer to that third party. Open-Meteo, Bright Sky and MET all returned `Access-Control-Allow-Origin` in tests, so a browser fetch is technically possible. Open-Meteo free limits are per IP, so each viewer counts against their own IP; MET requires an identifying UA/Origin and Expires-respecting caching.
- Alternative (facts of shape, not a recommendation): a server-side fetch on Yggdrasil at the sources' polling cadence (Open-Meteo `current` updates every 15 min; MET asks no faster than the Expires header, 10 min minimum for polling apps), cached, exposed as one small JSON value (e.g. cloud_cover_low/mid/high, precipitation, visibility, weather_code, is_day, observed_at). Then only Yggdrasil's IP reaches the provider; the server's coordinates stay on the server. One request per cadence is far below any quoted limit.
- Non-commercial status: Open-Meteo free tier is non-commercial; GameCult project status (ads/subscriptions) was not assessed.

### Not verified / gaps
Hillaire Table 2 row-to-LUT mapping; Prague model primary paper; Schneider slides and Chalmers thesis contents on precipitation; Android Chrome measured shader timings; WebGL2 3D-texture details (spec knowledge only); DWD attribution wording; licences of the WebGPU/FlightGear ports.
