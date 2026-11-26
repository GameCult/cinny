// Manual turning, inside the scene view only: the one place a pointer, a key or a wheel becomes a heading. The sky is at infinity and pans one for one with the
// view direction, so a drag of `dx` px is `dx / (pxPerDegH x plane.scale)` degrees (`view.ts` `windowFor`), against the finger: the sky follows it. Every turn goes to
// the heading owner (`ridge/heading.ts` `hold`), which holds the view where it was left until a rotation mode is picked or Return is pressed (ruling
// ridge-view-turn-handback). The rig is re-issued by the owner on each hold, so while a finger is down this is the one script that moves the ridge besides the
// twinkle. Pitch is never turned (ruling ridge-frame-more-sky-fixed-pitch).
import { hold, poseAt } from '../ridge/heading';
import { windowFor } from '../ridge/view';
import type { View } from '../ridge/view';

/** Degrees an arrow key turns the view, and with Shift. */
export const KEY_STEP_DEG = 5;
export const KEY_STEP_SHIFT_DEG = 15;

/** Screen pixels per degree of the far sky on a viewport `w` x `h`: the plane's pixels per degree at the scale the viewport gives it. */
export const pxPerDegreeOf = (view: View, w: number, h: number): number =>
  view.pxPerDegH * windowFor(view, w, h).plane.scale;

/** The heading after a drag of `dxPx` from where it began at `h0`: against the finger, one for one with the sky. */
export const dragHeading = (h0: number, dxPx: number, pxPerDeg: number): number =>
  h0 - dxPx / pxPerDeg;

/** The turn an arrow key asks, degrees (right positive), or undefined for any other key. */
export function keyTurn(key: string, shift: boolean): number | undefined {
  const step = shift ? KEY_STEP_SHIFT_DEG : KEY_STEP_DEG;
  if (key === 'ArrowRight') return step;
  return key === 'ArrowLeft' ? -step : undefined;
}

/** What the view's surface does with the events it is given: `pxPerDeg` is read at each event (a resize or a place changes it), `now` is the heading owner's clock. */
export function createTurner(pxPerDeg: () => number, now: () => number = () => performance.now()) {
  let drag: { x0: number; h0: number } | undefined;
  const turnBy = (deg: number) => {
    const t = now();
    hold(poseAt(t).h + deg, t);
  };
  return {
    /** A finger or the mouse went down at `x`. */
    down(x: number): void {
      drag = { x0: x, h0: poseAt(now()).h };
    },
    /** It moved to `x`: the view faces where the drag puts it. Nothing before `down`. */
    move(x: number): void {
      if (drag) hold(dragHeading(drag.h0, x - drag.x0, pxPerDeg()), now());
    },
    up(): void {
      drag = undefined;
    },
    isDown: (): boolean => drag !== undefined,
    /** A horizontal wheel or trackpad swipe of `deltaX` px: the sky follows the fingers, so the view turns the other way from a drag. */
    wheel(deltaX: number): void {
      if (deltaX !== 0) turnBy(deltaX / pxPerDeg());
    },
    /** An arrow key; true when it turned the view. */
    key(key: string, shift: boolean): boolean {
      const deg = keyTurn(key, shift);
      if (deg === undefined) return false;
      turnBy(deg);
      return true;
    },
  };
}
