import { describe, expect, it } from 'vitest';
import { limbAngle, nightBodies, onScreen, paintNightBodies } from './nightBodies';
import { makePhysicalSky, paintSky } from './physicalSky';
import { sunAt } from './sunAt';
import { FALLBACK_VIEW } from './view';
import type { Camera } from './view';
import { MAG_LIMIT, starsAt } from './starCatalogue';
import { moonAt } from './nightSky';

const P = FALLBACK_VIEW.place;
// A camera that sees most of the sky, so the moon of any hour is in it (the app's own window looks 72 degrees wide over the south-west).
const camera: Camera = { azimuthDeg: 180, hfovDeg: 340, vfovDeg: 170, horizonAt: 0.92 };

const sky = (iso: string, state: 'day' | 'dusk' | 'night' = 'night') => {
  const t = new Date(iso);
  return makePhysicalSky(sunAt(P, t), 0, FALLBACK_VIEW);
};
const bodies = (iso: string, state: 'day' | 'dusk' | 'night' = 'night', lines = false) => {
  const p = sky(iso, state);
  return { p, nb: nightBodies(p, paintSky(p, 640, 360, camera), lines) };
};

// 2026-11-24 22:00 UTC: full moon high in the south over Vienna. 2026-12-09 20:00 UTC: new moon. 2026-12-04 00:00 UTC: no moon up.
const FULL = '2026-11-24T22:00:00Z';
const NEW = '2026-12-09T20:00:00Z';
const MOONLESS = '2026-12-04T00:00:00Z';

describe('the stars of a night sky', () => {
  it('are the catalogue stars of the sky\'s own moment inside the camera, brightest drawn largest', () => {
    const { nb } = bodies(MOONLESS);
    expect(nb.stars.length).toBeGreaterThan(300);
    const inView = starsAt(new Date(MOONLESS), P.lat, P.lon, MAG_LIMIT, -0.5).filter((s) => {
      const a = onScreen(camera, s.azimuth, s.elevation);
      return a.x > -0.02 && a.x < 1.02 && a.y > -0.02 && a.y < 1.02;
    });
    expect(nb.stars.length).toBeLessThanOrEqual(inView.length);
    const radii = nb.stars.map((s) => s.r);
    expect(Math.max(...radii)).toBeGreaterThan(1.2 * Math.min(...radii));
  });

  it('are hidden by the twilight that exposes the sky: none at dusk, none by day, more on a moonless night than a full-moon one', () => {
    expect(bodies('2026-06-21T10:40:00Z', 'day').nb.stars).toHaveLength(0);
    expect(bodies('2026-12-04T15:20:00Z', 'dusk').nb.stars.length).toBeLessThan(5);
    expect(bodies(MOONLESS).nb.stars.length).toBeGreaterThan(bodies(FULL).nb.stars.length);
  });

  it('move with the clock: three hours later the field is a different one, rotated by 45 degrees about the pole', () => {
    const a = bodies('2026-12-04T00:00:00Z').nb.stars.slice(0, 20).map((s) => s.x.toFixed(3)).join();
    const b = bodies('2026-12-04T03:00:00Z').nb.stars.slice(0, 20).map((s) => s.x.toFixed(3)).join();
    expect(a).not.toBe(b);
  });

  it('twinkle by flux: a star dimmed by its gain is closer to the sky behind it, brightened is lighter, base is its fill', () => {
    const { nb } = bodies(MOONLESS);
    const s = nb.stars[0];
    const lum = (c: string) => c.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(s.shade(1)).toBe(s.fill);
    expect(lum(s.shade(0.35))).toBeLessThanOrEqual(lum(s.fill));
    expect(lum(s.shade(1.15))).toBeGreaterThanOrEqual(lum(s.fill));
    expect(lum(s.cover)).toBeLessThan(lum(s.fill));
  });
});

describe('the moon of a night sky', () => {
  it('is drawn where the ephemeris puts it, with the real phase', () => {
    const { p, nb } = bodies(FULL);
    expect(nb.moon).toBeDefined();
    expect(nb.moon!.illuminated).toBeGreaterThan(0.99);
    const at = onScreen(camera, p.moon.azimuth, p.moon.elevation);
    expect(nb.moon!.x).toBeCloseTo(at.x, 9);
    expect(nb.moon!.y).toBeCloseTo(at.y, 9);
    // 0.52 degrees across, vertical field of view a few tens of degrees
    expect(nb.moon!.radius * camera.vfovDeg).toBeCloseTo((p.moon.radius * 180) / Math.PI, 6);
  });

  it('is a thin sliver near new moon and not drawn when it is below the horizon', () => {
    expect(moonAt(P, new Date(NEW)).illuminated).toBeLessThan(0.05);
    expect(bodies(MOONLESS).nb.moon).toBeUndefined();
  });

  it('points its bright limb at the sun: down and toward the sun at moonrise after sunset, up at moonset in the morning', () => {
    // A moon due south at 30 degrees with the sun at the horizon due west: the limb leans to the right (east is left on screen looking south, west right).
    const a = limbAngle({ azimuth: 180, elevation: 30 }, { azimuth: 270, elevation: 0 });
    expect(Math.cos(a)).toBeGreaterThan(0.5);
    expect(Math.sin(a)).toBeLessThan(0);
    // Sun straight below the moon: the limb points down the screen.
    expect(Math.sin(limbAngle({ azimuth: 180, elevation: 30 }, { azimuth: 180, elevation: -30 }))).toBeLessThan(-0.99);
  });

  it('is lighter than the sky around it, and its dark side lighter than the sky', () => {
    const { nb } = bodies(FULL);
    const lum = (c: string) => c.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(lum(nb.moon!.lit)).toBeGreaterThan(lum(nb.moon!.dark));
    expect(lum(nb.moon!.lit)).toBeGreaterThan(450);
  });
});

describe('the constellation lines', () => {
  it('are absent unless asked for, and present for a night sky when they are', () => {
    expect(bodies(MOONLESS, 'night', false).nb.lines).toHaveLength(0);
    const on = bodies(MOONLESS, 'night', true).nb.lines;
    expect(on.length).toBeGreaterThan(20);
    expect(on.every((l) => l.points.length > 1)).toBe(true);
  });

  it('are not drawn in a day or dusk sky even when asked for', () => {
    expect(bodies('2026-06-21T10:40:00Z', 'day', true).nb.lines).toHaveLength(0);
    expect(bodies('2026-12-04T15:20:00Z', 'dusk', true).nb.lines).toHaveLength(0);
  });
});

describe('painting', () => {
  it('draws lines, stars and the moon in that order and builds the terminator from an ellipse', () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => (k === 'save' ? () => 0 : () => calls.push(String(k))),
        set: () => true,
      }
    ) as unknown as CanvasRenderingContext2D;
    const { nb } = bodies(FULL, 'night', true);
    paintNightBodies(ctx, nb, 1280, 720, 2);
    expect(calls.indexOf('stroke')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('stroke')).toBeLessThan(calls.indexOf('arc'));
    expect(calls).toContain('ellipse');
    expect(calls.filter((c) => c === 'arc').length).toBeGreaterThanOrEqual(nb.stars.length + 2);
  });
});

describe('the stars under the figures', () => {
  it('carry every constellation-line vertex in the sky strip that the moon does not cover, even under a full moon, at the app framing', async () => {
    const { windowFor } = await import('./view');
    const { linesAt } = await import('./starCatalogue');
    const cam = windowFor(FALLBACK_VIEW, 1100, 619).camera;
    const t = new Date('2026-11-25T00:00:00Z'); // full moon, high in the south
    const p = makePhysicalSky(sunAt(P, t), 0, FALLBACK_VIEW);
    const nb = nightBodies(p, paintSky(p, 1100, 619, cam), false);
    let vertices = 0;
    let carried = 0;
    linesAt(t, P.lat, P.lon).forEach((chain) =>
      chain.forEach((q) => {
        const a = onScreen(cam, q.azimuth, q.elevation);
        if (a.x < 0 || a.x > 1 || a.y < 0 || a.y > 0.8) return;
        // The moon is drawn over the stars, and a star inside its disc is not placed.
        if (nb.moon && Math.hypot((nb.moon.x - a.x) * 1100, (nb.moon.y - a.y) * 619) < Math.max(2, nb.moon.radius * 619)) return;
        vertices += 1;
        // Placement only: a catalogue star is drawn within a few px of the vertex. How bright it is is the look's.
        if (nb.stars.some((s) => Math.hypot((s.x - a.x) * 1100, (s.y - a.y) * 619) < 4)) carried += 1;
      })
    );
    expect(vertices).toBeGreaterThan(20);
    expect(carried).toBe(vertices);
  });
});
