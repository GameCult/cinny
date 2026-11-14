// The sky as a camera sees it: for each texel of a small grid, the view ray, its radiance out of the atmosphere's sky-view
// LUT (`earthAtmosphere.ts`), and nothing else; one lookup per texel, no march. The result is linear HDR
// radiance per unit of sun irradiance (a `Float32Array`); `toneMap.ts` makes it pixels.
import type { Atmosphere } from './earthAtmosphere';
import type { SunSample } from './sunAt';
import type { Camera } from './view';
import { cloudAmount, cloudRadiance } from './clouds';

const RAD = Math.PI / 180;
/** The sun's angular radius in radians (Hillaire's/Bruneton's `sun_angular_radius`). */
export const SUN_RADIUS = 0.004675;
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
  camera: Camera,
  w: number,
  h: number,
  cover = 0
): Dome {
  const hdr = new Float32Array(w * h * 3);
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
    const el = (camera.horizonAt - (j + 0.5) / h) * camera.vfovDeg * RAD;
    const vz = Math.sin(el);
    const ground = Math.cos(el);
    for (let i = 0; i < w; i += 1) {
      const az = (camera.azimuthDeg + ((i + 0.5) / w - 0.5) * camera.hfovDeg) * RAD;
      const cosFromSun = Math.cos(az - sunAz);
      atm.radiance(vz, cosFromSun, rgb);
      let r = rgb[0];
      let g = rgb[1];
      let b = rgb[2];
      let lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (cover > 0) {
        const c = cloudAmount(ground * Math.sin(az), ground * Math.cos(az), vz, cover);
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

/** Where the sun is on the image (the camera's angle-linear mapping, `view.ts`), as fractions of its width and height (y down), or null when it is behind the camera or below the horizon. */
export function sunOnScreen(sun: SunSample, camera: Camera): { x: number; y: number } | null {
  if (sun.elevation < -0.3) return null;
  const dAz = ((sun.azimuth - camera.azimuthDeg + 540) % 360) - 180;
  const x = 0.5 + dAz / camera.hfovDeg;
  const y = camera.horizonAt - sun.elevation / camera.vfovDeg;
  return x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05 ? null : { x, y };
}
