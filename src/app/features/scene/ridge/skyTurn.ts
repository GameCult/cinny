// The sky that turns with the view. The sky is at infinity: it pans one for one with the view direction and ignores the camera's offset (`view.ts`
// `cardPose` is where the near cards differ). So the live scene paints it once into a PLATE, a canvas wider than the viewport by SLACK_DEG each side,
// centred on a heading, and the compositor slides the plate by `(heading - centre)` degrees of pixels on the same keyframes as the cards (`heading.ts`
// `poseAt`). The slack lets the heading wander before the plate runs out; the scene paints a new plate about the heading it has reached, in the same
// tick it takes the old one away. Both plates are the same sky, so nothing moves. This file owns which arc of sky a plate holds and when it is replaced.
import { norm } from './ring';
import type { Camera, Window } from './view';

/** Degrees of sky painted beyond the viewport on each side of it. Authored: a tick of the fastest turn (`SPEED_CEILING_DEG_S`) is 6 degrees. */
export const SLACK_DEG = 20;
/** A plate is replaced once the heading is within this many degrees of its edge: one residency tick (500 ms) of the fastest turn, so it is never run out between two ticks. */
export const RECENTRE_MARGIN_DEG = 6;
/** The most backing store a plate may have, pixels: the pixel ratio lowers before the plate shrinks. */
export const PLATE_MAX_PX = 3_000_000;

/** The camera of a plate: the viewport's, with `slackDeg` more field each side, centred on the compass azimuth `centreDeg` (any turn of it). Angles per pixel are the viewport's. */
export function plateCamera(win: Window, centreDeg: number, slackDeg: number = SLACK_DEG): Camera {
  return { ...win.camera, azimuthDeg: norm(centreDeg), hfovDeg: win.camera.hfovDeg + 2 * slackDeg };
}

/** The plate for a viewport `w` x `h` CSS px at `dpr` device pixels per CSS px: its CSS width (the viewport's px per degree is the plate's), and the pixel ratio of its backing store. */
export function plateSize(
  win: Window,
  w: number,
  h: number,
  dpr: number,
  slackDeg: number = SLACK_DEG
): { cssW: number; ratio: number; pxPerDeg: number } {
  const pxPerDeg = w / win.camera.hfovDeg;
  const cssW = pxPerDeg * (win.camera.hfovDeg + 2 * slackDeg);
  const ratio = Math.min(dpr, Math.sqrt(PLATE_MAX_PX / (cssW * h)));
  return { cssW, ratio, pxPerDeg };
}

/** `centreDeg` shifted by whole turns to the one nearest `headingDeg` (the heading owner keeps its angles within a turn of zero, so the plate's centre follows). */
export const alignTurns = (centreDeg: number, headingDeg: number): number =>
  centreDeg + 360 * Math.round((headingDeg - centreDeg) / 360);

/** Whether a plate centred on `centreDeg` should be replaced now: the heading is nearer its edge than the margin. A still heading never is. */
export function recentre(
  headingDeg: number,
  centreDeg: number,
  slackDeg: number = SLACK_DEG,
  marginDeg: number = RECENTRE_MARGIN_DEG
): boolean {
  return Math.abs(headingDeg - alignTurns(centreDeg, headingDeg)) > slackDeg - marginDeg;
}

/** How far the plate is slid, px, when the view faces `headingDeg` and the plate is centred on `centreDeg` (both in the same turn, `alignTurns`): negative once the view has turned clockwise. */
export const panPx = (headingDeg: number, centreDeg: number, pxPerDeg: number): number => -(headingDeg - centreDeg) * pxPerDeg;
