/* eslint-disable no-param-reassign, no-plusplus, no-bitwise -- numeric kernels over typed arrays */
// Earth's atmosphere as three small look-up tables, baked once on the CPU: transmittance, multiple scattering and
// the sky-view LUT. Per sky texel the scene then does one bilinear lookup. No ray march after the bake.
//
// The method is Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR):
// the transmittance LUT in Bruneton and Neyret's (2008, 2017) parameterisation, the multiple-scattering LUT of his
// section 5.5 (a geometric series over an isotropic second order), and the sky-view LUT of 5.3 with the
// squared elevation distribution. The kernels follow his reference code (sebh/UnrealEngineSkyAtmosphere,
// Resources/RenderSkyRayMarching.hlsl `IntegrateScatteredLuminance`, `NewMultiScattCS`, `SkyViewLutPS`; MIT).
//
// Earth's coefficients are the ones that code takes from Bruneton's 2017 reference implementation
// (ebruneton/precomputed_atmospheric_scattering, `atmosphere/demo/demo.cc`), in 1/km, at sea level:
//   Rayleigh scattering (5.802, 13.558, 33.1) e-3 at (R, G, B) wavelengths, scale height 8 km. No Rayleigh absorption.
//   Mie scattering 3.996e-3 and extinction 4.44e-3 (single scattering albedo 0.9), grey, scale height 1.2 km,
//     Cornette-Shanks phase, asymmetry g 0.8.
//   Ozone absorption (0.650, 1.881, 0.085) e-3, a tent layer 15 km either side of 25 km (it makes the zenith blue at twilight).
// Planet 6360 km, top of the atmosphere 6460 km (100 km: the Karman line, 99.99% of the air).
// Rayleigh phase 3/(16 pi) (1 + cos^2). The sun is a point of unit irradiance; the consumer scales it (`toneMap.ts`).
//
// Single value the references do not give: ground albedo. 0.25 here, a grass, roofs and bare ground figure for a
// city and its wood; it only feeds the multiple-scattering term (and so the dusk and the shadow side of the sky).
//
// Simplifications against the paper, all on the cheap side: no ground bounce inside the sky-view LUT itself (its rays
// leave to space), fixed observer height, a spherical Earth with no terrain, the sun a point (the disc is the
// consumer's), no refraction, no clouds (`weather.ts`: haze is a multiplier on the Mie coefficients).

export const PLANET_KM = 6360;
export const TOP_KM = 6460;
const RAYLEIGH_SCATTER: Vec3 = [5.802e-3, 13.558e-3, 33.1e-3];
const RAYLEIGH_SCALE_KM = 8;
const MIE_SCATTER = 3.996e-3;
const MIE_EXTINCT = 4.44e-3;
const MIE_SCALE_KM = 1.2;
export const MIE_G = 0.8;
const OZONE_ABSORB: Vec3 = [0.65e-3, 1.881e-3, 0.085e-3];
const OZONE_PEAK_KM = 25;
const OZONE_HALF_WIDTH_KM = 15;
export const GROUND_ALBEDO = 0.25;
const RADIUS_OFFSET_KM = 0.01;

export type Vec3 = readonly [number, number, number];

const PI = Math.PI;
const FOUR_PI = 4 * PI;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export interface AtmosphereOptions {
  /** Sun elevation above the horizon in degrees (Vienna's, `vienna.ts`). */
  sunElevationDeg: number;
  /** Multiplier on both Mie coefficients: haze. 1 is the reference air. */
  mieScale?: number;
  /** Observer height above the ground in km. Vienna's lowest point is 0.151. */
  observerKm?: number;
}

/** Sizes of the three tables and the march step counts. The sum is the bake's cost, see `bakeCostSteps`. */
export const LUT = {
  transmittance: { w: 64, h: 24, steps: 32 },
  multiScatter: { w: 16, h: 16, dirs: 6, steps: 14 },
  skyView: { w: 72, h: 40, steps: 24 },
} as const;

const NO_WEATHER = 1;

interface Medium {
  scatter: Vec3;
  extinction: Vec3;
  /** Mie scattering and Rayleigh scattering separately, for the phase functions. */
  mie: number;
  ray: Vec3;
}

function sampleMedium(altKm: number, mieScale: number): Medium {
  const dRay = Math.exp(-altKm / RAYLEIGH_SCALE_KM);
  const dMie = Math.exp(-altKm / MIE_SCALE_KM) * mieScale;
  const tent =
    altKm < OZONE_PEAK_KM
      ? altKm / OZONE_HALF_WIDTH_KM - OZONE_PEAK_KM / OZONE_HALF_WIDTH_KM + 1
      : -altKm / OZONE_HALF_WIDTH_KM + OZONE_PEAK_KM / OZONE_HALF_WIDTH_KM + 1;
  const dOzone = clamp(tent, 0, 1);
  const ray: Vec3 = [
    dRay * RAYLEIGH_SCATTER[0],
    dRay * RAYLEIGH_SCATTER[1],
    dRay * RAYLEIGH_SCATTER[2],
  ];
  const mie = dMie * MIE_SCATTER;
  const ext = dMie * MIE_EXTINCT;
  return {
    ray,
    mie,
    scatter: [ray[0] + mie, ray[1] + mie, ray[2] + mie],
    extinction: [
      ray[0] + ext + dOzone * OZONE_ABSORB[0],
      ray[1] + ext + dOzone * OZONE_ABSORB[1],
      ray[2] + ext + dOzone * OZONE_ABSORB[2],
    ],
  };
}

/** Nearest positive hit of a unit-direction ray with a sphere at the origin: its distance, or -1. */
function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  r: number
): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  return t0 > 0 ? t0 : -b + s > 0 ? -b + s : -1;
}

const rayleighPhase = (cosT: number): number => (3 / (16 * PI)) * (1 + cosT * cosT);
/** Henyey-Greenstein, Hillaire's `hgPhase` with the view direction flipped (his WorldDir is an "in" direction). */
const hgPhase = (g: number, cosT: number): number => {
  const denom = 1 + g * g + 2 * g * cosT;
  return (1 - g * g) / (FOUR_PI * denom * Math.sqrt(denom));
};

/** A 2D table with `c` channels, sampled bilinearly with clamped edges. */
export interface Lut2 {
  w: number;
  h: number;
  c: number;
  data: Float32Array;
}
const makeLut = (w: number, h: number, c: number): Lut2 => ({
  w,
  h,
  c,
  data: new Float32Array(w * h * c),
});

/** Bilinear at texel-space coordinates (0..w-1, 0..h-1), written into `out`. */
function sampleTexel(l: Lut2, x: number, y: number, out: number[] | Float32Array): void {
  const fx = clamp(x, 0, l.w - 1);
  const fy = clamp(y, 0, l.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(l.w - 1, x0 + 1);
  const y1 = Math.min(l.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let k = 0; k < l.c; k++) {
    const a = l.data[(y0 * l.w + x0) * l.c + k];
    const b = l.data[(y0 * l.w + x1) * l.c + k];
    const c = l.data[(y1 * l.w + x0) * l.c + k];
    const d = l.data[(y1 * l.w + x1) * l.c + k];
    out[k] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}

// Transmittance LUT, Bruneton's parameterisation (r, mu) -> (x_mu, x_r) over rho = horizon distance of height r.
const H_TOP = Math.sqrt(TOP_KM * TOP_KM - PLANET_KM * PLANET_KM);

function transmittanceUv(r: number, mu: number): [number, number] {
  const rho = Math.sqrt(Math.max(0, r * r - PLANET_KM * PLANET_KM));
  const disc = r * r * (mu * mu - 1) + TOP_KM * TOP_KM;
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, disc)));
  const dMin = TOP_KM - r;
  const dMax = rho + H_TOP;
  return [(d - dMin) / (dMax - dMin), rho / H_TOP];
}
function transmittanceParams(xMu: number, xR: number): [number, number] {
  const rho = H_TOP * xR;
  const r = Math.sqrt(rho * rho + PLANET_KM * PLANET_KM);
  const dMin = TOP_KM - r;
  const dMax = rho + H_TOP;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d === 0 ? 1 : (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d);
  return [r, clamp(mu, -1, 1)];
}

const toSub = (u: number, res: number): number => (u + 0.5 / res) * (res / (res + 1));
const fromSub = (u: number, res: number): number => (u - 0.5 / res) * (res / (res - 1));

export interface Atmosphere {
  readonly transmittance: Lut2;
  readonly multiScatter: Lut2;
  readonly skyView: Lut2;
  readonly sunElevationDeg: number;
  readonly mieScale: number;
  readonly observerKm: number;
  /** Cosine of the sun's zenith angle. */
  readonly sunCosZenith: number;
  /** Zenith angle (radians) of the astronomical horizon at the observer: a little past 90 degrees. */
  readonly horizonZenith: number;
  /** Transmittance from the observer along a direction `mu` (cos of its zenith angle), to space, per channel. */
  transmittanceToSpace(mu: number, out: number[]): void;
  /** Sky radiance per unit of sun irradiance for view zenith cos and cos of the azimuth from the sun; linear RGB. */
  radiance(viewCosZenith: number, cosFromSun: number, out: number[]): void;
  /** Light the sky and sun give a horizontal surface at the observer: direct (per unit sun irradiance) and ambient. */
  irradiance: { direct: Vec3; ambient: Vec3 };
}

interface March {
  L: [number, number, number];
  transmittance: [number, number, number];
  multiScatAs1: [number, number, number];
  opticalDepth: [number, number, number];
}

/**
 * Hillaire's `IntegrateScatteredLuminance`. Ray from (ox,oy,oz) along unit d, sun unit s; `miePhase` picks the real phase
 * functions (the sky) or the isotropic one (the multiple-scattering bake); `ms` the multiple-scattering LUT (absent while it is being built).
 */
function march(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  sx: number,
  sy: number,
  sz: number,
  steps: number,
  ground: boolean,
  miePhase: boolean,
  variable: boolean,
  mieScale: number,
  trLut: Lut2,
  ms: Lut2 | undefined,
  out: March
): void {
  out.L = [0, 0, 0];
  out.transmittance = [1, 1, 1];
  out.multiScatAs1 = [0, 0, 0];
  out.opticalDepth = [0, 0, 0];
  const tBottom = raySphere(ox, oy, oz, dx, dy, dz, PLANET_KM);
  const tTop = raySphere(ox, oy, oz, dx, dy, dz, TOP_KM);
  let tMax: number;
  if (tBottom < 0) {
    if (tTop < 0) return;
    tMax = tTop;
  } else {
    tMax = tTop > 0 ? Math.min(tTop, tBottom) : tBottom;
  }
  const cosT = dx * sx + dy * sy + dz * sz;
  const phaseMie = miePhase ? hgPhase(MIE_G, -cosT) : 1 / FOUR_PI;
  const phaseRay = miePhase ? rayleighPhase(cosT) : 1 / FOUR_PI;
  const tmp = [0, 0];
  const msv = [0, 0, 0];
  const trv = [0, 0, 0];
  let tPrev = 0;
  for (let s = 0; s < steps; s++) {
    let t0;
    let t1;
    if (variable) {
      t0 = tMax * ((s / steps) * (s / steps));
      t1 = tMax * (((s + 1) / steps) * ((s + 1) / steps));
    } else {
      t0 = (tMax * s) / steps;
      t1 = (tMax * (s + 1)) / steps;
    }
    const t = t0 + (t1 - t0) * 0.3;
    const dt = t1 - t0;
    tPrev = t;
    const px = ox + t * dx;
    const py = oy + t * dy;
    const pz = oz + t * dz;
    const r = Math.sqrt(px * px + py * py + pz * pz);
    const med = sampleMedium(r - PLANET_KM, mieScale);
    const sunCos = (px * sx + py * sy + pz * sz) / r;
    const [u, v] = transmittanceUv(r, sunCos);
    sampleTexel(trLut, u * (trLut.w - 1), v * (trLut.h - 1), trv);
    // Planet shadow: the sun's ray from here must not meet the ground.
    const shadow = raySphere(px, py, pz, sx, sy, sz, PLANET_KM) >= 0 ? 0 : 1;
    if (ms) {
      const uu = toSub(sunCos * 0.5 + 0.5, ms.w);
      const vv = toSub(clamp((r - PLANET_KM) / (TOP_KM - PLANET_KM), 0, 1), ms.h);
      sampleTexel(ms, uu * ms.w - 0.5, vv * ms.h - 0.5, msv);
    } else {
      msv[0] = 0;
      msv[1] = 0;
      msv[2] = 0;
    }
    for (let k = 0; k < 3; k++) {
      const ext = med.extinction[k];
      const od = ext * dt;
      const sampleT = Math.exp(-od);
      out.opticalDepth[k] += od;
      const phaseScatter = med.mie * phaseMie + med.ray[k] * phaseRay;
      const S = shadow * trv[k] * phaseScatter + msv[k] * med.scatter[k];
      const inv = ext > 0 ? (1 - sampleT) / ext : dt;
      const th = out.transmittance[k];
      out.L[k] += th * S * inv;
      out.multiScatAs1[k] += th * med.scatter[k] * inv;
      out.transmittance[k] = th * sampleT;
    }
    // Isotropic second-order inputs for the multiple-scattering bake use the same quantities; they are
    // accumulated by the caller through `out.L` with `miePhase` false (uniform phase) so nothing more is kept here.
  }
  void tPrev;
  void tmp;
  if (ground && tBottom > 0 && tMax === tBottom) {
    const px = ox + tBottom * dx;
    const py = oy + tBottom * dy;
    const pz = oz + tBottom * dz;
    const r = Math.sqrt(px * px + py * py + pz * pz);
    const sunCos = (px * sx + py * sy + pz * sz) / r;
    const [u, v] = transmittanceUv(r, sunCos);
    sampleTexel(trLut, u * (trLut.w - 1), v * (trLut.h - 1), trv);
    const ndotl = Math.max(0, sunCos);
    for (let k = 0; k < 3; k++) {
      out.L[k] += (trv[k] * out.transmittance[k] * ndotl * GROUND_ALBEDO) / PI;
    }
  }
}

function bakeTransmittance(mieScale: number): Lut2 {
  const { w, h, steps } = LUT.transmittance;
  const lut = makeLut(w, h, 3);
  const noLut = makeLut(1, 1, 3); // not read: `ms` is absent and the sun terms are discarded below
  noLut.data.fill(1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [r, mu] = transmittanceParams(i / (w - 1), j / (h - 1));
      const sinT = Math.sqrt(1 - mu * mu);
      // Optical depth only: a straight integration of the extinction to space.
      const tTop = raySphere(0, 0, r, 0, sinT, mu, TOP_KM);
      const tBottom = raySphere(0, 0, r, 0, sinT, mu, PLANET_KM);
      const tMax = tBottom > 0 ? Math.min(tTop, tBottom) : tTop;
      const od = [0, 0, 0];
      for (let s = 0; s < steps; s++) {
        const t = (tMax * (s + 0.3)) / steps;
        const px = t * sinT;
        const pz = r + t * mu;
        const med = sampleMedium(Math.sqrt(px * px + pz * pz) - PLANET_KM, mieScale);
        const dt = tMax / steps;
        for (let k = 0; k < 3; k++) od[k] += med.extinction[k] * dt;
      }
      const o = (j * w + i) * 3;
      for (let k = 0; k < 3; k++) lut.data[o + k] = Math.exp(-od[k]);
    }
  }
  return lut;
}

function bakeMultiScatter(mieScale: number, trLut: Lut2): Lut2 {
  const { w, h, dirs, steps } = LUT.multiScatter;
  const lut = makeLut(w, h, 3);
  const res: March = {
    L: [0, 0, 0],
    transmittance: [1, 1, 1],
    multiScatAs1: [0, 0, 0],
    opticalDepth: [0, 0, 0],
  };
  const count = dirs * dirs;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = fromSub((i + 0.5) / w, w);
      const v = fromSub((j + 0.5) / h, h);
      const cosSun = clamp(u * 2 - 1, -1, 1);
      const sx = Math.sqrt(Math.max(0, 1 - cosSun * cosSun));
      const sz = cosSun;
      // Hillaire's PLANET_RADIUS_OFFSET: a ray that starts exactly on the ground is degenerate.
      const height =
        PLANET_KM + RADIUS_OFFSET_KM + clamp(v, 0, 1) * (TOP_KM - PLANET_KM - RADIUS_OFFSET_KM);
      const sumMs = [0, 0, 0];
      const sumL = [0, 0, 0];
      for (let a = 0; a < dirs; a++) {
        for (let b = 0; b < dirs; b++) {
          const theta = (2 * PI * (a + 0.5)) / dirs;
          const cosPhi = 1 - (2 * (b + 0.5)) / dirs;
          const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
          march(
            0,
            0,
            height,
            Math.cos(theta) * sinPhi,
            Math.sin(theta) * sinPhi,
            cosPhi,
            sx,
            0,
            sz,
            steps,
            true,
            false,
            false,
            mieScale,
            trLut,
            undefined,
            res
          );
          for (let k = 0; k < 3; k++) {
            sumMs[k] += (res.multiScatAs1[k] * FOUR_PI) / count;
            sumL[k] += (res.L[k] * FOUR_PI) / count;
          }
        }
      }
      const o = (j * w + i) * 3;
      for (let k = 0; k < 3; k++) {
        const fms = sumMs[k] / FOUR_PI; // equation 7
        const l2 = sumL[k] / FOUR_PI; // equation 5
        lut.data[o + k] = l2 / (1 - fms); // equation 10: the geometric series of all orders
      }
    }
  }
  return lut;
}

/**
 * Sky-view LUT axes (Hillaire's non-linear mapping, upper hemisphere only: nothing below the horizon is drawn). y: view zenith angle
 * from 0 to the horizon's, squared toward it; x: the azimuth from the sun, the cosine mapped `-(2 c^2 - 1)`.
 */
function skyViewParamsToUv(
  viewCos: number,
  cosFromSun: number,
  horizonZenith: number
): [number, number] {
  const zen = Math.acos(clamp(viewCos, -1, 1));
  let coord = 1 - clamp(zen / horizonZenith, 0, 1);
  coord = Math.sqrt(coord);
  const y = 1 - coord; // 0 at the zenith, 1 at the horizon
  const x = Math.sqrt(clamp(-cosFromSun * 0.5 + 0.5, 0, 1));
  return [x, y];
}
function skyViewUvToParams(x: number, y: number, horizonZenith: number): [number, number] {
  let coord = 1 - y;
  coord *= coord;
  coord = 1 - coord;
  const viewCos = Math.cos(horizonZenith * coord);
  const c = x * x;
  return [viewCos, -(c * 2 - 1)];
}

function bakeSkyView(
  sunCos: number,
  observerKm: number,
  mieScale: number,
  trLut: Lut2,
  ms: Lut2,
  horizonZenith: number
): Lut2 {
  const { w, h, steps } = LUT.skyView;
  const lut = makeLut(w, h, 3);
  const res: March = {
    L: [0, 0, 0],
    transmittance: [1, 1, 1],
    multiScatAs1: [0, 0, 0],
    opticalDepth: [0, 0, 0],
  };
  const sx = Math.sqrt(Math.max(0, 1 - sunCos * sunCos));
  const height = PLANET_KM + observerKm;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [viewCos, lightViewCos] = skyViewUvToParams(i / (w - 1), j / (h - 1), horizonZenith);
      const sinZ = Math.sqrt(1 - viewCos * viewCos);
      march(
        0,
        0,
        height,
        sinZ * lightViewCos,
        sinZ * Math.sqrt(Math.max(0, 1 - lightViewCos * lightViewCos)),
        viewCos,
        sx,
        0,
        sunCos,
        steps,
        false,
        true,
        true,
        mieScale,
        trLut,
        ms,
        res
      );
      const o = (j * w + i) * 3;
      lut.data[o] = res.L[0];
      lut.data[o + 1] = res.L[1];
      lut.data[o + 2] = res.L[2];
    }
  }
  return lut;
}

/** Number of ray-march steps the three bakes take: the CPU cost in the unit the tests budget. */
export const bakeCostSteps = (): number => {
  const t = LUT.transmittance;
  const m = LUT.multiScatter;
  const s = LUT.skyView;
  return t.w * t.h * t.steps + m.w * m.h * m.dirs * m.dirs * m.steps + s.w * s.h * s.steps;
};

export function bakeAtmosphere(opts: AtmosphereOptions): Atmosphere {
  const mieScale = opts.mieScale ?? NO_WEATHER;
  const observerKm = opts.observerKm ?? 0.151;
  const sunCos = Math.cos(((90 - opts.sunElevationDeg) * PI) / 180);
  const height = PLANET_KM + observerKm;
  const beta = Math.acos(Math.sqrt(height * height - PLANET_KM * PLANET_KM) / height);
  const horizonZenith = PI - beta;
  const transmittance = bakeTransmittance(mieScale);
  const multiScatter = bakeMultiScatter(mieScale, transmittance);
  const skyView = bakeSkyView(
    sunCos,
    observerKm,
    mieScale,
    transmittance,
    multiScatter,
    horizonZenith
  );
  const tmp = [0, 0, 0];
  const trv = [0, 0, 0];
  const atm: Atmosphere = {
    transmittance,
    multiScatter,
    skyView,
    sunElevationDeg: opts.sunElevationDeg,
    mieScale,
    observerKm,
    sunCosZenith: sunCos,
    horizonZenith,
    transmittanceToSpace(mu, out) {
      const [u, v] = transmittanceUv(height, mu);
      sampleTexel(transmittance, u * (transmittance.w - 1), v * (transmittance.h - 1), trv);
      out[0] = trv[0];
      out[1] = trv[1];
      out[2] = trv[2];
    },
    radiance(viewCos, cosFromSun, out) {
      const [x, y] = skyViewParamsToUv(
        Math.max(viewCos, Math.cos(horizonZenith)),
        cosFromSun,
        horizonZenith
      );
      sampleTexel(skyView, x * (skyView.w - 1), y * (skyView.h - 1), tmp);
      out[0] = tmp[0];
      out[1] = tmp[1];
      out[2] = tmp[2];
    },
    irradiance: { direct: [0, 0, 0], ambient: [0, 0, 0] },
  };
  // Direct: the sun's transmittance times the cosine; ambient: the sky's radiance averaged over the upper hemisphere (cosine weighted).
  const direct: number[] = [0, 0, 0];
  if (opts.sunElevationDeg > -1) {
    atm.transmittanceToSpace(Math.max(sunCos, 0), direct);
    const c = Math.max(0, sunCos);
    direct[0] *= c;
    direct[1] *= c;
    direct[2] *= c;
  }
  const amb = [0, 0, 0];
  const out = [0, 0, 0];
  const N = 12;
  const M = 6;
  let wsum = 0;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < M; b++) {
      const az = (PI * (a + 0.5)) / N; // 0..pi from the sun: the sky is symmetric
      const zen = (0.5 * PI * (b + 0.5)) / M;
      const wgt = Math.cos(zen) * Math.sin(zen);
      atm.radiance(Math.cos(zen), Math.cos(az), out);
      for (let k = 0; k < 3; k++) amb[k] += out[k] * wgt;
      wsum += wgt;
    }
  }
  atm.irradiance.direct = [direct[0], direct[1], direct[2]];
  atm.irradiance.ambient = [(amb[0] / wsum) * PI, (amb[1] / wsum) * PI, (amb[2] / wsum) * PI];
  return atm;
}
