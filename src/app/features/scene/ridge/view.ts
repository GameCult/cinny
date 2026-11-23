// The one View: where the sky's camera stands and looks, and where the ridge cards sit against it. A baked place's manifest
// (`view` and `place`, manifest schema 3) is a View; a sky with no planes uses FALLBACK_VIEW. `windowFor` is the single owner of the
// registration between sky and ridge: one View and a viewport in, the sky Camera and the plane's placement out. `offsetRange` is the one
// clamp on the camera's offset and `cardPose` the one place a card's scale and shift are derived (ruling ridge-camera-on-circle). Nothing
// else chooses a field of view, a horizon row, an azimuth, a scale or a shift.
import { distanceAt, KEEP_MARGIN_TILES, norm, runTiles } from './ring';
import type { RidgeManifest } from './manifest';
import type { RotationMode } from './heading';

/** Where the observer stands. `id` names the baked place (it keys a rebuild); `altitudeKm` is the ground height, eye height excluded. */
export interface Place {
  id: string;
  lat: number;
  lon: number;
  altitudeKm: number;
  /** The place's IANA time zone (the baker writes it): the one owner of place-local time is skyMoment.ts. */
  tz: string;
}

/**
 * The manifest's `view`: the ring the planes cover, all 360 degrees, absolute compass (column 0 = north), cut into `tiles` azimuth tiles of `tileW` columns
 * (`apron` real neighbour columns each side in a tile's files). Angles are degrees, planes are in plane pixels.
 */
export interface ManifestView {
  /** The rest azimuth: the compass azimuth the view faces before anything turns it, degrees clockwise from north. */
  lookAzDeg: number;
  ringW: number;
  tileW: number;
  tiles: number;
  apron: number;
  planeH: number;
  pxPerDegH: number;
  /** Plane pixels per degree of elevation (the baker draws the vertical exaggerated: it is not `pxPerDegH`). */
  pxPerDegV: number;
  /** Row of the horizon in the plane, from its top. */
  horizonRow: number;
}

export interface View extends ManifestView {
  place: Place;
}

/**
 * The camera of the sky. Angle-linear, as the planes are (`pxPerDegH` is constant across a plane): a pixel's azimuth is
 * `azimuthDeg + (x - 0.5) * hfovDeg` and its elevation is `(horizonAt - y) * vfovDeg`, x and y as fractions of the viewport.
 */
export interface Camera {
  /** Compass azimuth at the centre column. */
  azimuthDeg: number;
  hfovDeg: number;
  vfovDeg: number;
  /** Where the horizon sits down the viewport, as a fraction of its height (0 top). */
  horizonAt: number;
}

/** The sky of a scene with no planes (a failed load): Vienna facing south-west, with the numbers of the Vienna ring bake. */
export const FALLBACK_VIEW: View = {
  place: { id: 'vienna', lat: 48.1929826, lon: 16.3534237, altitudeKm: 0.183, tz: 'Europe/Vienna' },
  lookAzDeg: 214,
  ringW: 6400,
  tileW: 200,
  tiles: 32,
  apron: 2,
  planeH: 600,
  pxPerDegH: 6400 / 360,
  pxPerDegV: 171.73831979090915,
  horizonRow: 357.01990847502145,
};

/** The share of the viewport height the plane's height is at least scaled to. Authored, tunable by eye. */
export const RIDGE_BAND_FRAC = 0.6;
/** The widest field of view a viewport may show: a 16:9 viewport with 1.1 widths of plane (72 / 1.1 degrees), as export.py HFOV_MAX_DEG. */
export const HFOV_MAX_DEG = 72 / 1.1;
/**
 * Where the horizon sits down the viewport, as a fraction of its height: one constant for every sky state and every viewport (ruling
 * ridge-frame-more-sky-fixed-pitch: the camera pitch never changes between day and night). The plane extends below the viewport bottom and
 * the near plain is cropped. 0.85 (operator, 2026-11-20) shows about 31 degrees of sky above the horizon in a 16:9 cell. Authored, tunable by eye.
 */
export const HORIZON_AT = 0.85;

export interface Window {
  camera: Camera;
  /** The planes in viewport pixels: the scale of a plane pixel, the plane's height, and `bottom`, the distance of its foot above the viewport's bottom edge (negative: the plane runs on below it). The horizon row lands at `HORIZON_AT`. */
  plane: { scale: number; h: number; bottom: number };
}

export function windowFor(view: View, viewportW: number, viewportH: number): Window {
  const scale = Math.max(
    (RIDGE_BAND_FRAC * viewportH) / view.planeH,
    viewportW / (HFOV_MAX_DEG * view.pxPerDegH)
  );
  const hfovDeg = viewportW / (scale * view.pxPerDegH);
  return {
    camera: {
      azimuthDeg: view.lookAzDeg,
      hfovDeg,
      vfovDeg: (hfovDeg * viewportH) / viewportW,
      horizonAt: HORIZON_AT,
    },
    plane: {
      scale,
      h: scale * view.planeH,
      bottom: (1 - HORIZON_AT) * viewportH - scale * (view.planeH - view.horizonRow),
    },
  };
}

/** Nearest card's nearest tile distance, metres: where the camera first meets a card. */
const nearestM = (manifest: RidgeManifest): number =>
  Math.min(...manifest.tiles.map((row) => row[0]?.distanceM ?? Infinity));

/** Whether the camera stands on its heading (phi 0, a whole turn off it included): a mode where the offset turns with the view puts it there. */
const onHeading = (mode: RotationMode, phiDeg: number): boolean =>
  mode !== 'offset' && Math.abs(norm(phiDeg + 180) - 180) < 1e-6;

/**
 * The offsets the camera may take on its circle, metres, forward positive: the one clamp (ruling ridge-offset-range-fit, "the slider stops where the linear
 * map holds"). How well a card's linear slide fits depends on the camera's angle `phiDeg` on its circle, so the bound depends on where the mode keeps it. With
 * the camera on its heading (modes 'still' and 'both', `phi` 0) a forward offset goes to the bake's `rMaxForwardM`, the largest every card fits at phi 0;
 * everywhere else (the offset-only mode swings the camera round the whole circle, and a backward offset at phi 0 is the camera at phi 180) the bound is
 * `rMaxM`, the worst over every phi. The nearest card, shrunk by R / (R + r) about the horizon, would lift its foot above the viewport bottom and show the
 * sky under it past the point where `1 / keep - 1` of its distance is the offset: the baker's nearest-card-off-the-bottom refusal as a clamp, applied to
 * every position the camera can reach at the offset's sign (backward always, forward too where the circle takes it round to phi 180).
 */
export function offsetRange(
  manifest: RidgeManifest,
  win: Window,
  mode: RotationMode,
  phiDeg = 0
): [number, number] {
  const { rMaxM, rMaxForwardM } = manifest.camera;
  const { planeH, horizonRow } = manifest.view;
  const below = win.plane.scale * (planeH - horizonRow);
  const keep = 1 + win.plane.bottom / below; // the smallest scale at which the foot stays under the viewport bottom
  const foot = keep >= 1 ? 0 : nearestM(manifest) * (1 / keep - 1);
  const back = Math.min(rMaxM, foot);
  return onHeading(mode, phiDeg) ? [-back, rMaxForwardM] : [-back, back];
}

/** The longest stretch of motion the rig issues at once, seconds: the loader holds the tiles it passes over, so it also bounds how far a turn may sweep. */
export const SEGMENT_S = 30;
/** The fastest the view or the camera may turn, degrees per second, whatever the loader holds: a keyframe a second must not skip a whole tile (11.25 degrees at 32 tiles). */
export const SPEED_CEILING_DEG_S = 12;

/**
 * The largest speed (degrees per second, either direction) the baked resident count sustains in `mode`: the loader holds the tiles of the arc a card shows
 * over the next SEGMENT_S seconds and two tiles beyond it each side, and the bake's gate (`ring.ts` `runTiles`, `export.py`) priced N of them. Turning the view
 * widens that arc by speed x SEGMENT_S, so in 'both' the speed is what N leaves after the widest card arc (the viewport over the smallest slide rate, at the
 * backward offset `rMaxM`) and the margin tiles. The offset-only mode sweeps the camera over a circle the gate already counts whatever the speed, and a still
 * view has none: those take the ceiling, as does a ring the gate priced whole.
 */
export function maxSpeed(manifest: RidgeManifest, mode: RotationMode): number {
  if (mode !== 'both') return SPEED_CEILING_DEG_S;
  const { view, camera } = manifest;
  const tileDeg = 360 / view.tiles;
  const rmin = nearestM(manifest);
  const n = runTiles(view, HFOV_MAX_DEG, camera.rMaxForwardM, rmin);
  if (n >= view.tiles) return SPEED_CEILING_DEG_S; // the gate counted the whole ring: nothing the loader holds can exceed it
  const sMin = rmin / (rmin + camera.rMaxM);
  const room = (n - 1 - 2 * KEEP_MARGIN_TILES) * tileDeg - HFOV_MAX_DEG / sMin;
  return Math.min(SPEED_CEILING_DEG_S, Math.max(0, room / SEGMENT_S));
}

/** What a card does on screen: its scale about the horizon and how far it is shifted sideways, viewport px, at a heading and camera angle. */
export interface CardPose {
  scale: number;
  shiftPx: number;
}

const RAD = Math.PI / 180;
const FIT_SAMPLES = 9;

/**
 * Where a card goes on a viewport: the camera stands on its circle of radius `offsetM` (signed, forward positive) at angle `phiDeg` against the heading
 * `headingDeg`; a card at distance R (`ring.ts` `distanceAt` at the heading) seen from there is at angle `atan2(R sin b - r sin phi, R cos b - r cos phi)`
 * from the heading for a point `b` degrees off it. A card is one flat sheet (ruling ridge-cards-per-card-slide), so that curve is fitted by the line
 * `a + s b` over the viewport's arc, and the card is scaled by `s` about the horizon and shifted so the column at azimuth `az` lands at `a + s (az - heading)`.
 * `shiftPx` is the translate of a container whose tiles sit at `(az - rest) x px per degree`, rest being the View's rest azimuth.
 */
export function cardPose(
  manifest: RidgeManifest,
  card: number,
  headingDeg: number,
  phiDeg: number,
  offsetM: number,
  win: Window
): CardPose {
  const R = distanceAt(manifest, card, headingDeg);
  const half = win.camera.hfovDeg / 2;
  const phi = phiDeg * RAD;
  let sb = 0;
  let sa = 0;
  let sbb = 0;
  let sba = 0;
  for (let i = 0; i < FIT_SAMPLES; i += 1) {
    const b = (-half + (2 * half * i) / (FIT_SAMPLES - 1)) * RAD;
    const a = Math.atan2(R * Math.sin(b) - offsetM * Math.sin(phi), R * Math.cos(b) - offsetM * Math.cos(phi)) / RAD;
    const bd = b / RAD;
    sb += bd;
    sa += a;
    sbb += bd * bd;
    sba += bd * a;
  }
  const n = FIT_SAMPLES;
  const s = (n * sba - sb * sa) / (n * sbb - sb * sb);
  const a0 = (sa - s * sb) / n;
  const { view } = manifest;
  return {
    scale: s,
    shiftPx: win.plane.scale * view.pxPerDegH * (a0 - s * (headingDeg - view.lookAzDeg)),
  };
}

/**
 * The compass azimuths, unwrapped, of the card columns a pose puts on a viewport `viewportW` px wide: a column at `az` lands at `shiftPx + scale x (az - rest)
 * x px per degree` from the centre. This is the arc the loader must hold for that card.
 */
export function cardArc(
  view: View,
  win: Window,
  viewportW: number,
  pose: CardPose
): { fromDeg: number; toDeg: number } {
  const per = pose.scale * win.plane.scale * view.pxPerDegH;
  return {
    fromDeg: view.lookAzDeg + (-viewportW / 2 - pose.shiftPx) / per,
    toDeg: view.lookAzDeg + (viewportW / 2 - pose.shiftPx) / per,
  };
}

/** How often the pose is sampled to find the arc a stretch of motion passes over, seconds: finer than the rig's keyframe a second, so no swing between two keyframes is missed. */
const SWEEP_STEP_S = 0.25;

/**
 * The arc of azimuth any of `cards` cards shows at any instant of the `seconds` after `t0` (ms), by `poseAt(card, ms)`: the union of `cardArc` over the whole
 * stretch, not its ends. A pose is not monotone in time (offset-only rotation carries the nearest card out and back as the camera circles), so a card's reach
 * peaks mid-stretch, and the tiles it needs there are the ones to mount and to ask the loader for.
 */
export function sweepArc(
  view: View,
  win: Window,
  viewportW: number,
  cards: number,
  poseAt: (card: number, ms: number) => CardPose,
  t0: number,
  seconds: number = SEGMENT_S
): { fromDeg: number; toDeg: number } {
  let fromDeg = Infinity;
  let toDeg = -Infinity;
  const steps = Math.ceil(seconds / SWEEP_STEP_S);
  for (let n = 0; n <= steps; n += 1) {
    const t = t0 + Math.min(seconds, n * SWEEP_STEP_S) * 1000;
    for (let i = 0; i < cards; i += 1) {
      const a = cardArc(view, win, viewportW, poseAt(i, t));
      fromDeg = Math.min(fromDeg, a.fromDeg);
      toDeg = Math.max(toDeg, a.toDeg);
    }
  }
  return { fromDeg, toDeg };
}
