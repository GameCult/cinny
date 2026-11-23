import { describe, expect, it } from 'vitest';
import { distanceAt, norm, residentTiles, runTiles, tileAzimuth } from './ring';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

const ring32 = { tiles: 32 };

describe('norm', () => {
  it('brings any angle into [0, 360)', () => {
    expect(norm(0)).toBe(0);
    expect(norm(360)).toBe(0);
    expect(norm(-10)).toBe(350);
    expect(norm(725)).toBe(5);
  });
});

describe('residentTiles', () => {
  it('names the tiles an arc overlaps across north, with turns 0 and 1 and monotone unwrapped azimuths', () => {
    // Centre 355, half 40: [315, 395] overlaps tiles 28..31 of the first turn and 0..3 of the next.
    const refs = residentTiles(ring32, 355, 40);
    expect(refs.map((r) => r.tile)).toEqual([28, 29, 30, 31, 0, 1, 2, 3]);
    expect(refs.map((r) => r.turn)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    const az = refs.map((r) => tileAzimuth(ring32, r));
    az.slice(1).forEach((a, i) => expect(a).toBeGreaterThan(az[i]));
    expect(az[0]).toBe(315);
    expect(az[4]).toBe(360);
  });

  it('picks the same tiles for a heading and the heading a revolution on, in another turn', () => {
    const a = residentTiles(ring32, 40, 30);
    const b = residentTiles(ring32, 400, 30);
    expect(b.map((r) => r.tile)).toEqual(a.map((r) => r.tile));
    expect(b.every((r, i) => r.turn === a[i].turn + 1)).toBe(true);
    // And a heading turned backwards across north.
    const c = residentTiles(ring32, -20, 30);
    expect(c.map((r) => r.tile)).toEqual([27, 28, 29, 30, 31, 0]);
    expect(c.map((r) => r.turn)).toEqual([-1, -1, -1, -1, -1, 0]);
  });

  it('names a tile once at most, even for an arc of a whole ring or more', () => {
    const all = residentTiles(ring32, 100, 400);
    expect(all).toHaveLength(32);
    expect(new Set(all.map((r) => r.tile)).size).toBe(32);
  });

  it('is one tile for an arc inside a tile, and includes a tile an arc only touches at its edge', () => {
    expect(residentTiles(ring32, 5, 1).map((r) => r.tile)).toEqual([0]);
    expect(residentTiles(ring32, 11.25, 0).map((r) => r.tile)).toEqual([1]);
  });
});

describe('distanceAt', () => {
  const m = parseManifest(wireManifest(), '/d/'); // four tiles of 90 degrees, centres at 45, 135, 225, 315
  it('is the tile distance at a tile centre and interpolates linearly between centres', () => {
    expect(distanceAt(m, 0, 45)).toBeCloseTo(1000, 9);
    expect(distanceAt(m, 0, 135)).toBeCloseTo(1200, 9);
    expect(distanceAt(m, 0, 90)).toBeCloseTo(1100, 9);
  });

  it('interpolates across the wrap at north and takes any unwrapped heading the same as its wrapped one', () => {
    // between tile 3 (315 degrees, 1100 m) and tile 0 (45, 1000 m): north is halfway.
    expect(distanceAt(m, 0, 0)).toBeCloseTo(1050, 9);
    expect(distanceAt(m, 0, 360)).toBeCloseTo(1050, 9);
    expect(distanceAt(m, 0, -360)).toBeCloseTo(1050, 9);
    expect(distanceAt(m, 0, 400)).toBeCloseTo(distanceAt(m, 0, 40), 9);
    expect(distanceAt(m, 0, -20)).toBeCloseTo(distanceAt(m, 0, 340), 9);
  });

  it('skips a tile where the card is absent: the line runs on to the next tile that holds it', () => {
    // card 2 is absent in tile 2 (centre 225): between tile 1 (41000 m at 135) and tile 3 (39000 m at 315), 225 is halfway.
    expect(distanceAt(m, 2, 225)).toBeCloseTo(40000, 9);
    expect(distanceAt(m, 2, 135)).toBeCloseTo(41000, 9);
    expect(distanceAt(m, 2, 180)).toBeCloseTo(40500, 9);
    expect(distanceAt(m, 2, 270)).toBeCloseTo(39500, 9);
  });

  it('is the one distance all round for a card that is in one tile only', () => {
    const one = wireManifest({}, 3) as { tiles: (unknown | null)[][] };
    const only = { ...one, tiles: one.tiles.map((row, t) => [row[0], row[1], t === 1 ? row[2] : null]) };
    const mo = parseManifest(only, '/d/');
    [0, 77, 135, 200, 359].forEach((az) => expect(distanceAt(mo, 2, az)).toBeCloseTo(41000, 9));
  });
});

describe('runTiles', () => {
  it('is export.py run_tiles: the arc at the smallest slide rate plus the offset swing, a straddled tile and two tiles of margin each side', () => {
    // Vienna's numbers: r_max 98.2, nearest card 603 m. s_min = 603 / 701.2; arc = 65.45 / s_min + 2 (98.2 / 603) 57.3.
    const sMin = 603 / (603 + 98.2);
    const arc = 65.4545 / sMin + 2 * (98.2 / 603) * 57.3;
    expect(runTiles(ring32, 72 / 1.1, 98.2, 603)).toBe(Math.ceil(arc / 11.25) + 1 + 4);
    expect(runTiles(ring32, 72 / 1.1, 100000, 603)).toBe(32);
  });
});
