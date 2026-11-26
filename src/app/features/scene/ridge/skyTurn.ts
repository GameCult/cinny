// The sky that turns with the view. The sky is at infinity: it pans one for one with the view direction and ignores the camera's offset (`view.ts`
// `cardPose` is where the near cards differ). So the live scene paints it once into a PLATE, a canvas wider than the viewport by its slack each side,
// centred on a heading, and the compositor slides the plate by `(heading - centre)` degrees of pixels on the same keyframes as the cards (`heading.ts`
// `poseAt`). The slack, sized to the speed of the turn (`slackFor`), lets the heading wander before the plate runs out; the scene paints a new plate about the heading it has reached, in the same
// tick it takes the old one away. Both plates are the same sky, so nothing moves. This file owns which arc of sky a plate holds and when it is replaced.
import { norm } from './ring';
import type { Camera, Window } from './view';

/** The least sky painted beyond the viewport on each side of it, degrees: what a slow turn gets. Authored. */
export const SLACK_MIN_DEG = 20;
/** Degrees the heading may wander from a fresh plate's centre before it is due a new one, however fast it turns: a plate is not repainted more often than this. Authored. */
export const TRAVEL_DEG = 14;
/**
 * How late a residency tick may run, seconds, beyond its own period, before the plate can run out: a tile mount, a paint, a collection or a busy phone each cost
 * a tick a few hundred milliseconds; this is a budget for several of them. Authored.
 */
export const LATENESS_S = 2;
/** The margin never takes more than this much of the slack, degrees, so a plate that has just been painted is not due again at once. */
export const MIN_TRAVEL_DEG = 1;
/** The most backing store a plate may have, pixels: the pixel ratio lowers before the plate shrinks. */
export const PLATE_MAX_PX = 3_000_000;

/**
 * Degrees a heading turning at `rateDegPerS` covers between a residency tick that finds the plate good and the next one: a tick's period (`periodMs`, the real
 * one, work included) and the lateness budget. A plate is replaced once the heading is nearer its edge than this, so the next tick, however late, finds it whole.
 */
export const marginFor = (rateDegPerS: number, periodMs: number): number => Math.abs(rateDegPerS) * (LATENESS_S + periodMs / 1000);

/** The slack a plate needs at `rateDegPerS`, the speed in force (`heading.ts` `turnRate`): its margin at the nominal tick `tickMs` and the travel between replacements. */
export const slackFor = (rateDegPerS: number, tickMs: number): number =>
  Math.max(SLACK_MIN_DEG, TRAVEL_DEG + marginFor(rateDegPerS, tickMs));

/** The camera of a plate: the viewport's, with `slackDeg` more field each side, centred on the compass azimuth `centreDeg` (any turn of it). Angles per pixel are the viewport's. */
export function plateCamera(win: Window, centreDeg: number, slackDeg: number): Camera {
  return { ...win.camera, azimuthDeg: norm(centreDeg), hfovDeg: win.camera.hfovDeg + 2 * slackDeg };
}

/** The plate for a viewport `w` x `h` CSS px at `dpr` device pixels per CSS px with `slackDeg` of slack: its CSS width (the viewport's px per degree is the plate's), and the pixel ratio of its backing store. */
export function plateSize(
  win: Window,
  w: number,
  h: number,
  dpr: number,
  slackDeg: number
): { cssW: number; ratio: number; pxPerDeg: number } {
  const pxPerDeg = w / win.camera.hfovDeg;
  const cssW = pxPerDeg * (win.camera.hfovDeg + 2 * slackDeg);
  const ratio = Math.min(dpr, Math.sqrt(PLATE_MAX_PX / (cssW * h)));
  return { cssW, ratio, pxPerDeg };
}

/** `centreDeg` shifted by whole turns to the one nearest `headingDeg` (the heading owner keeps its angles within a turn of zero, so the plate's centre follows). */
export const alignTurns = (centreDeg: number, headingDeg: number): number =>
  centreDeg + 360 * Math.round((headingDeg - centreDeg) / 360);

/**
 * Whether a plate with `slackDeg` of slack centred on `centreDeg` should be replaced now: the heading is nearer its edge than the margin, which the speed in
 * force and the tick's real period set (`marginFor`) and which never takes more than the slack less MIN_TRAVEL_DEG. A still heading never is.
 */
export function recentre(headingDeg: number, centreDeg: number, slackDeg: number, rateDegPerS: number, periodMs: number): boolean {
  const margin = Math.min(marginFor(rateDegPerS, periodMs), slackDeg - MIN_TRAVEL_DEG);
  return Math.abs(headingDeg - alignTurns(centreDeg, headingDeg)) > slackDeg - margin;
}

/** How far the plate is slid, px, when the view faces `headingDeg` and the plate is centred on `centreDeg` (both in the same turn, `alignTurns`): negative once the view has turned clockwise. */
export const panPx = (headingDeg: number, centreDeg: number, pxPerDeg: number): number => -(headingDeg - centreDeg) * pxPerDeg;
