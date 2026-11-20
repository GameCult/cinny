// The night's bodies on the sky canvas: the real stars (`starCatalogue.ts`, for the place and the moment the sky state draws, `sun.time`),
// the moon with its phase, and the constellation lines. Each body's radiance (`nightSky.ts`) is added to the sky's own radiance behind it
// (the dome's grid, `skyDome.ts`) and goes through the sky's display (exposure, scotopic grade, ACES, curve), so the twilight that brightens the sky
// hides them, as a camera's exposure would, and the cards share the display. A body's contrast is compressed (`NIGHT_LOOK`): see there.
import { display8 } from './toneMap';
import { blackbodyRgb, compressed, extinguished, NIGHT_LOOK, moonSurface, starRadiance, temperatureOfBV } from './nightSky';
import type { Dome } from './skyDome';
import type { PhysicalSky, SkyPixels } from './physicalSky';
import { linesAt, MAG_LIMIT, starsAt } from './starCatalogue';
import type { Star } from './stars';

const RAD = Math.PI / 180;
const luma = (c: ArrayLike<number>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const css = (c: ArrayLike<number>): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where a direction is on the image (the camera's angle-linear mapping, `view.ts`), as fractions of its width and height (y down). */
export function onScreen(
  camera: SkyPixels['camera'],
  azimuth: number,
  elevation: number
): { x: number; y: number } {
  return {
    x: 0.5 + wrap180(azimuth - camera.azimuthDeg) / camera.hfovDeg,
    y: camera.horizonAt - elevation / camera.vfovDeg,
  };
}

/** The dome's radiance behind a point of the image (fractions), bilinear between texel centres. */
export function domeAt(dome: Dome, x: number, y: number, out: number[]): void {
  const fx = Math.min(dome.w - 1, Math.max(0, x * dome.w - 0.5));
  const fy = Math.min(dome.h - 1, Math.max(0, y * dome.h - 0.5));
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = Math.min(dome.w - 1, i0 + 1);
  const j1 = Math.min(dome.h - 1, j0 + 1);
  const tx = fx - i0;
  const ty = fy - j0;
  for (let k = 0; k < 3; k += 1) {
    const at = (i: number, j: number) => dome.hdr[(j * dome.w + i) * 3 + k];
    out[k] =
      (at(i0, j0) * (1 - tx) + at(i1, j0) * tx) * (1 - ty) + (at(i0, j1) * (1 - tx) + at(i1, j1) * tx) * ty;
  }
}

/** `bg` plus a body of radiance `add` on it, the contrast compressed to the power `exp` (1 physical), as linear rgb into `out`. */
function composite(bg: number[], add: number[], exp: number, out: number[]): void {
  const total = luma(bg) + luma(add);
  const k = total > 0 ? compressed(luma(bg), luma(add), exp) / total : 1;
  for (let i = 0; i < 3; i += 1) out[i] = (bg[i] + add[i]) * k;
}

export interface MoonDraw {
  x: number;
  y: number;
  /** Radius as a fraction of the image height. */
  radius: number;
  /** Lit fraction of the disc and the phase angle (0 full) in radians. */
  illuminated: number;
  phaseAngle: number;
  /** Direction of the bright limb on the image, radians counter-clockwise from the right. */
  limb: number;
  lit: string;
  dark: string;
}

export interface LineDraw {
  /** Polyline in image fractions. */
  points: { x: number; y: number }[];
}

export interface NightBodies {
  stars: Star[];
  moon?: MoonDraw;
  lines: LineDraw[];
}

/** Unit vector (east, north, up) of a direction. */
const vec = (az: number, el: number): [number, number, number] => [
  Math.cos(el * RAD) * Math.sin(az * RAD),
  Math.cos(el * RAD) * Math.cos(az * RAD),
  Math.sin(el * RAD),
];

/** The screen direction (radians, counter-clockwise from the right) from the moon toward `toward`, by the tangent of the great circle at the moon. */
export function limbAngle(moon: { azimuth: number; elevation: number }, toward: { azimuth: number; elevation: number }): number {
  const m = vec(moon.azimuth, moon.elevation);
  const s = vec(toward.azimuth, toward.elevation);
  const d = m[0] * s[0] + m[1] * s[1] + m[2] * s[2];
  const t = [s[0] - d * m[0], s[1] - d * m[1], s[2] - d * m[2]];
  const az = moon.azimuth * RAD;
  const el = moon.elevation * RAD;
  const east = [Math.cos(az), -Math.sin(az), 0];
  const up = [-Math.sin(el) * Math.sin(az), -Math.sin(el) * Math.cos(az), Math.cos(el)];
  return Math.atan2(t[0] * up[0] + t[1] * up[1] + t[2] * up[2], t[0] * east[0] + t[1] * east[1] + t[2] * east[2]);
}

/** Great-circle subdivision of a chain's legs, as az/el. */
function slerp(a: { azimuth: number; elevation: number }, b: { azimuth: number; elevation: number }, n: number) {
  const u = vec(a.azimuth, a.elevation);
  const v = vec(b.azimuth, b.elevation);
  const w = Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
  if (w < 1e-6) return [a];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const s0 = Math.sin((1 - t) * w) / Math.sin(w);
    const s1 = Math.sin(t * w) / Math.sin(w);
    const p = [0, 1, 2].map((k) => s0 * u[k] + s1 * v[k]);
    return {
      azimuth: ((Math.atan2(p[0], p[1]) / RAD) % 360 + 360) % 360,
      elevation: Math.asin(Math.min(1, Math.max(-1, p[2]))) / RAD,
    };
  });
}

/**
 * The stars, moon and (when asked, and only in the night state) constellation lines of a physical sky as seen through the camera of `px`
 * (`paintSky`'s grid and the dome behind it). The moment is the sky's own, `p.sun.time`, so the bodies agree with the light.
 */
export function nightBodies(p: PhysicalSky, px: SkyPixels, withLines: boolean): NightBodies {
  const { place } = p.view;
  const { camera, dome } = px;
  const display = p.fit.display;
  const bg = [0, 0, 0];
  const add = [0, 0, 0];
  const tot = [0, 0, 0];
  const out = [0, 0, 0];
  let moon: MoonDraw | undefined;
  const mo = p.moon;
  const mAt = onScreen(camera, mo.azimuth, mo.elevation);
  if (mo.elevation > -1 && mAt.x > -0.05 && mAt.x < 1.05 && mAt.y > -0.05 && mAt.y < 1.05) {
    domeAt(dome, mAt.x, mAt.y, bg);
    const trans = [0, 0, 0];
    p.atm.transmittanceToSpace(Math.max(Math.sin(mo.elevation * RAD), 0), trans);
    const top = Math.max(...trans, 1e-9);
    const tint = [1, 0.96, 0.88];
    const surface = moonSurface(mo);
    for (let i = 0; i < 3; i += 1) add[i] = surface * tint[i] * (trans[i] / top) ** 0.6;
    composite(bg, add, NIGHT_LOOK.moonContrastExp, tot);
    display8(tot[0], tot[1], tot[2], display, out);
    const lit = css(out);
    // Earthshine: a fraction of the full moon's surface, the more the thinner the crescent.
    const full = moonSurface({ ...mo, ratio: mo.ratio / Math.max(mo.illuminated, 0.02), illuminated: 1 });
    for (let i = 0; i < 3; i += 1) add[i] = NIGHT_LOOK.earthshine * full * (1.1 - mo.illuminated) * [0.9, 1, 1.15][i];
    composite(bg, add, NIGHT_LOOK.moonContrastExp, tot);
    display8(tot[0], tot[1], tot[2], display, out);
    moon = {
      x: mAt.x,
      y: mAt.y,
      radius: ((mo.radius / RAD) * NIGHT_LOOK.moonScale) / camera.vfovDeg,
      illuminated: mo.illuminated,
      phaseAngle: mo.phaseAngleDeg * RAD,
      limb: limbAngle(mo, p.sun),
      lit,
      dark: css(out),
    };
  }

  const stars: Star[] = [];
  for (const s of starsAt(p.sun.time, place.lat, place.lon, MAG_LIMIT, -0.5)) {
    const at = onScreen(camera, s.azimuth, s.elevation);
    if (at.x < -0.02 || at.x > 1.02 || at.y < -0.02 || at.y > 1.02) continue;
    // The moon is painted over the stars: one inside its disc is never seen, and its twinkle would be painted over the moon.
    if (moon && Math.hypot((at.x - moon.x) * px.w, (at.y - moon.y) * px.h) < Math.max(2, moon.radius * px.h)) continue;
    const back = [0, 0, 0];
    domeAt(dome, at.x, at.y, back);
    const m = extinguished(s.mag, s.elevation);
    const rgb = blackbodyRgb(temperatureOfBV(s.bv));
    const lum = starRadiance(m);
    // Each star owns its own scratch: `shade` outlives this loop.
    const hdr = (gain: number, o: number[]) => {
      const a = [rgb[0] * lum * gain, rgb[1] * lum * gain, rgb[2] * lum * gain];
      const t = [0, 0, 0];
      composite(back, a, NIGHT_LOOK.starContrastExp, t);
      display8(t[0], t[1], t[2], display, o);
    };
    const base = [0, 0, 0];
    hdr(1, base);
    display8(back[0], back[1], back[2], display, out);
    // A star the sky hides (within three 8-bit steps of it in every channel) is not drawn.
    if (Math.max(Math.abs(base[0] - out[0]), Math.abs(base[1] - out[1]), Math.abs(base[2] - out[2])) < 3) continue;
    const { base: r0, perMag } = NIGHT_LOOK.starRadius;
    stars.push({
      x: at.x,
      y: at.y,
      r: r0 + perMag * Math.max(0, MAG_LIMIT - m),
      fill: css(base),
      cover: css(out),
      shade: (gain) => {
        const o = [0, 0, 0];
        hdr(gain, o);
        return css(o);
      },
    });
  }

  const lines: LineDraw[] = [];
  if (withLines && p.state === 'night') {
    for (const chain of linesAt(p.sun.time, place.lat, place.lon)) {
      const points: { x: number; y: number }[] = [];
      const flush = () => {
        if (points.length > 1) lines.push({ points: points.slice() });
        points.length = 0;
      };
      chain.forEach((v, i) => {
        const legs = i === 0 ? [v] : slerp(chain[i - 1], v, 6).slice(1);
        legs.forEach((q) => {
          const a = onScreen(camera, q.azimuth, q.elevation);
          const prev = points[points.length - 1];
          if (prev && Math.abs(a.x - prev.x) > 0.5) flush();
          points.push(a);
        });
      });
      flush();
    }
  }
  return { stars, moon, lines };
}

/** Paint the lines, the stars and the moon onto the canvas (`w` x `h` device px, `scale` device px per CSS px), in that order. */
export function paintNightBodies(
  ctx: CanvasRenderingContext2D,
  nb: NightBodies,
  w: number,
  h: number,
  scale: number
): void {
  if (nb.lines.length) {
    const [r, g, b] = NIGHT_LOOK.lines.rgb;
    ctx.save();
    ctx.strokeStyle = `rgba(${r},${g},${b},${NIGHT_LOOK.lines.alpha})`;
    ctx.lineWidth = NIGHT_LOOK.lines.widthPx * scale;
    ctx.lineJoin = 'round';
    nb.lines.forEach((l) => {
      ctx.beginPath();
      l.points.forEach((q, i) => (i ? ctx.lineTo(q.x * w, q.y * h) : ctx.moveTo(q.x * w, q.y * h)));
      ctx.stroke();
    });
    ctx.restore();
  }
  nb.stars.forEach((s) => {
    ctx.fillStyle = s.fill;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * scale, 0, 2 * Math.PI);
    ctx.fill();
  });
  const m = nb.moon;
  if (!m) return;
  const R = Math.max(2 * scale, m.radius * h);
  ctx.save();
  ctx.translate(m.x * w, m.y * h);
  ctx.rotate(-m.limb); // the bright limb to +x; canvas rotation is clockwise, `limb` counter-clockwise
  ctx.fillStyle = m.dark;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, 2 * Math.PI);
  ctx.fill();
  if (m.illuminated > 0.004) {
    // Lit: the half toward the sun, plus or minus the half-ellipse of the terminator, whose semi-axis along x is R |cos i|.
    const cosI = Math.cos(m.phaseAngle);
    ctx.fillStyle = m.lit;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.max(R * Math.abs(cosI), 1e-3), R, 0, Math.PI / 2, cosI > 0 ? (3 * Math.PI) / 2 : -Math.PI / 2, cosI <= 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
