// The sky as a camera sees it: for each texel of a small grid, the view ray, its radiance out of the atmosphere's sky-view
// LUT (`earthAtmosphere.ts`), and nothing else; one lookup per texel, no march. The result is linear HDR
// radiance per unit of sun irradiance (a `Float32Array`); `toneMap.ts` makes it pixels.
import type { Atmosphere } from './earthAtmosphere';
import type { SunSample } from './vienna';
import { cloudAmount, cloudRadiance } from './clouds';

const RAD = Math.PI / 180;
/** The sun's angular radius in radians (Hillaire's/Bruneton's `sun_angular_radius`). */
export const SUN_RADIUS = 0.004675;
/** Vertical field of view of the camera, degrees, and where the horizon sits down the image: the ridge scene's sky stops. */
export const VFOV_DEG = 50;
export const HORIZON_AT = 0.78;

export interface DomeView {
  /** Compass azimuth the camera faces, degrees clockwise from north. */
  azimuthDeg: number;
  /** Width over height of the viewport. */
  aspect: number;
}

/** Where the camera looks: toward the sun's side while it is up, so the sun sits right of centre; south in the dark. */
export const viewFor = (sun: SunSample, aspect: number): DomeView => ({
  azimuthDeg: sun.elevation > -6 ? sun.azimuth - 24 : 180,
  aspect,
});

export interface Dome {
  w: number;
  h: number;
  /** Linear radiance, 3 floats per texel, row 0 at the top. */
  hdr: Float32Array;
  /** Mean over the grid of the log of the radiance luminance, exponentiated: what auto-exposure reads. */
  meanLuma: number;
}

/** Grid for a viewport: about 8 CSS px per texel, capped. */
export const domeSize = (cssW: number, cssH: number): { w: number; h: number } => ({
  w: Math.min(256, Math.max(8, Math.ceil(cssW / 8))),
  h: Math.min(160, Math.max(8, Math.ceil(cssH / 8))),
});

/**
 * Render the HDR sky. Rays below the horizon take the horizon's radiance (the ridges cover them). The sun's disc is not here: it is smaller than a texel, so the host draws it on the upscaled canvas (`sunOnScreen`). `cover` (0..1, `weather.ts`) lays the cloud deck (`clouds.ts`) over it.
 */
export function renderDome(
  atm: Atmosphere,
  sun: SunSample,
  view: DomeView,
  w: number,
  h: number,
  cover = 0
): Dome {
  const hdr = new Float32Array(w * h * 3);
  const tanHalf = Math.tan((VFOV_DEG * RAD) / 2);
  const fa = view.azimuthDeg * RAD;
  const fx = Math.sin(fa);
  const fy = Math.cos(fa);
  const rx = Math.cos(fa);
  const ry = -Math.sin(fa);
  const sunAz = sun.azimuth * RAD;
  const sunEl = sun.elevation * RAD;
  const sz = Math.sin(sunEl);
  const trans = [0, 0, 0];
  atm.transmittanceToSpace(Math.max(sz, 0), trans); // the cloud's sunlight
  const rgb = [0, 0, 0];
  const cloud = [0, 0, 0];
  if (cover > 0) {
    const zenith = [0, 0, 0];
    atm.radiance(1, 1, zenith);
    cloudRadiance(sz, trans, zenith, cover, cloud);
  }
  let logSum = 0;
  for (let j = 0; j < h; j += 1) {
    const v = (HORIZON_AT - (j + 0.5) / h) * 2 * tanHalf;
    for (let i = 0; i < w; i += 1) {
      const u = ((i + 0.5) / w - 0.5) * view.aspect * 2 * tanHalf;
      const dx = fx + rx * u;
      const dy = fy + ry * u;
      const dz = v;
      const n = Math.hypot(dx, dy, dz);
      const vz = dz / n;
      const cosFromSun = Math.cos(Math.atan2(dx, dy) - sunAz);
      atm.radiance(vz, cosFromSun, rgb);
      let r = rgb[0];
      let g = rgb[1];
      let b = rgb[2];
      let lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (cover > 0) {
        const c = cloudAmount(dx / n, dy / n, vz, cover);
        lum += (0.2126 * cloud[0] + 0.7152 * cloud[1] + 0.0722 * cloud[2] - lum) * c;
        r += (cloud[0] - r) * c;
        g += (cloud[1] - g) * c;
        b += (cloud[2] - b) * c;
      }
      const o = (j * w + i) * 3;
      hdr[o] = r;
      hdr[o + 1] = g;
      hdr[o + 2] = b;
      logSum += Math.log(Math.max(1e-9, lum));
    }
  }
  return { w, h, hdr, meanLuma: Math.exp(logSum / (w * h)) };
}

/** Where the sun is on the image, as fractions of its width and height (y down), or null when it is behind the camera or below the horizon. */
export function sunOnScreen(sun: SunSample, view: DomeView): { x: number; y: number } | null {
  if (sun.elevation < -0.3) return null;
  const tanHalf = Math.tan((VFOV_DEG * RAD) / 2);
  const fa = view.azimuthDeg * RAD;
  const az = sun.azimuth * RAD;
  const el = sun.elevation * RAD;
  const sx = Math.cos(el) * Math.sin(az);
  const sy = Math.cos(el) * Math.cos(az);
  const along = sx * Math.sin(fa) + sy * Math.cos(fa);
  if (along <= 0.05) return null;
  const u = (sx * Math.cos(fa) - sy * Math.sin(fa)) / along;
  const v = Math.sin(el) / along;
  const x = u / (view.aspect * 2 * tanHalf) + 0.5;
  const y = HORIZON_AT - v / (2 * tanHalf);
  return x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05 ? null : { x, y };
}
