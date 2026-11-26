import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHeld, resetCamera } from '../cameraState';
import { poseAt, resetHeading } from '../ridge/heading';
import { FALLBACK_VIEW } from '../ridge/view';
import { createTurner, dragHeading, keyTurn, pxPerDegreeOf } from './turning';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  resetCamera();
  resetHeading();
});

const PX = FALLBACK_VIEW.pxPerDegH * 1.65; // 17.78 px per degree of plane at the scale 1.65

describe('manual turning', () => {
  it('a drag turns the view against the finger, one for one with the far sky: 100 px at plane scale 1.65', () => {
    expect(dragHeading(100, 100, PX)).toBeCloseTo(100 - 100 / (17.7777778 * 1.65), 6);
    expect(dragHeading(100, -100, PX)).toBeGreaterThan(100);
  });

  it('pxPerDegreeOf is the plane pixels per degree at the viewport scale (windowFor)', () => {
    // 1280 x 720 on the fallback plane: scale max(0.6 x 720 / 600, 1280 / (65.45 x 17.78)) = 1.1
    expect(pxPerDegreeOf(FALLBACK_VIEW, 1280, 720)).toBeCloseTo(FALLBACK_VIEW.pxPerDegH * 1.1, 1);
  });

  it('the heading owner holds the view where the drag leaves it, on every move, and not before a move', () => {
    let t = 0;
    const turner = createTurner(
      () => PX,
      () => t
    );
    poseAt(0); // a fresh page: the owner is anchored at heading 0
    turner.down(500);
    expect(isHeld()).toBe(false); // a tap that does not move holds nothing
    t = 16;
    turner.move(400);
    expect(isHeld()).toBe(true);
    expect(poseAt(16).h).toBeCloseTo(100 / PX, 6);
    t = 32;
    turner.move(300);
    expect(poseAt(32).h).toBeCloseTo(200 / PX, 6);
    turner.up();
    t = 48;
    turner.move(0); // no finger down: nothing moves
    expect(poseAt(48).h).toBeCloseTo(200 / PX, 6);
  });

  it('arrows turn 5 degrees and with Shift 15; other keys are not turns', () => {
    expect(keyTurn('ArrowRight', false)).toBe(5);
    expect(keyTurn('ArrowLeft', false)).toBe(-5);
    expect(keyTurn('ArrowLeft', true)).toBe(-15);
    expect(keyTurn('ArrowUp', false)).toBeUndefined();
    const turner = createTurner(
      () => PX,
      () => 0
    );
    poseAt(0);
    expect(turner.key('ArrowRight', false)).toBe(true);
    expect(poseAt(0).h).toBeCloseTo(5, 9);
    expect(turner.key('ArrowLeft', true)).toBe(true);
    expect(poseAt(0).h).toBeCloseTo(-10, 9);
    expect(turner.key('Enter', false)).toBe(false);
  });

  it('a horizontal wheel or swipe turns one for one the other way from a drag', () => {
    const turner = createTurner(
      () => PX,
      () => 0
    );
    poseAt(0);
    turner.wheel(PX * 3);
    expect(poseAt(0).h).toBeCloseTo(3, 9);
    turner.wheel(0);
    expect(poseAt(0).h).toBeCloseTo(3, 9);
  });
});
