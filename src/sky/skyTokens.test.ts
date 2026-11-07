import { describe, expect, it } from 'vitest';
import { AA, AMBIENT_FLOOR, bakeSky, contrast } from './skyTokens.js';
import { light } from './sun.js';
import { baked } from './baked';

const names = ['midnight', 'noonday'] as const;
const roles = ['Primary', 'Secondary', 'Success', 'Warning', 'Critical'] as const;
const states = ['', 'Hover', 'Active'];

describe.each(names)('%s sky', (name) => {
  const sky = baked[name] as any;
  const t = sky.tokens;

  it('is what scripts/bake-sky.mjs would write now (run npm run bake:sky if not)', () => {
    expect(JSON.parse(JSON.stringify(bakeSky(name)))).toEqual(JSON.parse(JSON.stringify(sky)));
  });

  it('is lit by the sun on the side of the horizon its name says', () => {
    expect(name === 'noonday' ? sky.elevation : -sky.elevation).toBeGreaterThan(40);
  });

  it('carries the sun, an ambient light and a horizon colour for consumers that light a scene', () => {
    const { sun } = sky;
    expect(Object.keys(sun).sort()).toEqual(['azimuth_deg', 'color_linear', 'elevation_deg']);
    expect(sun.elevation_deg).toBe(sky.elevation);
    expect(sun.color_linear).toHaveLength(3);
    sun.color_linear.forEach((v: number) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    });
    expect(sky.ambient_linear).toHaveLength(3);
    expect(sky.horizon_hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(sky.horizon_hex).toBe(sky.gradient[sky.gradient.length - 1]);
  });

  it('puts the sun where Nibu expects it, azimuth clockwise from north', () => {
    const azimuth: number = sky.sun.azimuth_deg;
    expect(azimuth).toBeGreaterThanOrEqual(0);
    expect(azimuth).toBeLessThan(360);
    expect(Math.abs(azimuth - (name === 'noonday' ? 182.6 : 2.5))).toBeLessThan(1);
  });

  it('keeps ambient above the night floor and leaves daylight alone', () => {
    sky.ambient_linear.forEach((v: number, i: number) =>
      expect(v).toBeGreaterThanOrEqual(AMBIENT_FLOOR[i])
    );
    if (name === 'noonday') {
      sky.ambient_linear.forEach((v: number) => expect(v).toBeGreaterThan(0.05));
      expect(sky.ambient_linear).toEqual(light(sky.moment).diffuse);
    }
  });

  it('clears WCAG AA for text on every panel state', () => {
    ['Background', 'Surface', 'SurfaceVariant'].forEach((p) =>
      states.forEach((s) =>
        expect(contrast(t[p][`Container${  s}`], t[p].OnContainer)).toBeGreaterThanOrEqual(AA)
      )
    );
  });

  it('clears AA for button labels and tinted-container text in every state', () => {
    roles.forEach((r) =>
      states.forEach((s) => {
        expect(contrast(t[r][`Main${  s}`], t[r].OnMain)).toBeGreaterThanOrEqual(AA);
        expect(contrast(t[r][`Container${  s}`], t[r].OnContainer)).toBeGreaterThanOrEqual(AA);
      })
    );
  });

  it('clears AA for message text in both bubbles, links and names', () => {
    expect(contrast(sky.bubbles.Other, sky.bubbles.OtherText)).toBeGreaterThanOrEqual(AA);
    expect(contrast(sky.bubbles.Own, sky.bubbles.OwnText)).toBeGreaterThanOrEqual(AA);
    const grounds = [
      t.Background.Container,
      t.Surface.Container,
      t.SurfaceVariant.Container,
      sky.bubbles.Other,
      sky.bubbles.Own,
    ];
    grounds.forEach((g) => {
      expect(contrast(sky.link, g)).toBeGreaterThanOrEqual(AA);
      sky.userColors.forEach((c: string) => expect(contrast(c, g)).toBeGreaterThanOrEqual(AA));
    });
  });

  it('clears AA for body text straight over the fallback sky gradient', () => {
    sky.gradient.forEach((g: string) =>
      expect(contrast(t.Surface.OnContainer, g)).toBeGreaterThanOrEqual(AA)
    );
  });
});
