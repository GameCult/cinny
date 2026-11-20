import { describe, expect, it, vi } from 'vitest';
import {
  decodeNormal,
  DEFAULT_LOOK,
  PHYSICAL_LOOK,
  celShade,
  celLevels,
  FRAGMENT,
  lightCards,
  lightingOf,
  skyLut,
  SKY_LUT,
  sunColumns,
  sunInColumn,
  WALL_RT2,
} from './lightCards';
import type { RidgeLook } from './lightCards';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { PhysicalSky } from './physicalSky';
import { ACES_FIT, ACES_IN, ACES_OUT, LIFT_ONLY } from './toneMap';

const manifest = parseManifest(wireManifest(), '/d/');
const RAD = Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("the sun in a column's frame", () => {
  it.each([5, 30, 60, 89])(
    'at elevation %i it lights an up-facing normal by sin e and a normal facing it by 1',
    (e) => {
      const s = sunInColumn({ azimuth: 130, elevation: e }, 130);
      expect(dot([0, 0, 1], s)).toBeCloseTo(Math.sin(e * RAD), 12);
      expect(dot([Math.cos(e * RAD), 0, Math.sin(e * RAD)], s)).toBeCloseTo(1, 12);
      expect(Math.hypot(...s)).toBeCloseTo(1, 12);
    }
  );

  it('turns with the column: a sun 90 degrees clockwise of the ray lights the across axis, one behind lights the back', () => {
    const across = sunInColumn({ azimuth: 100, elevation: 0 }, 10);
    expect(across[0]).toBeCloseTo(0, 12);
    expect(across[1]).toBeCloseTo(1, 12);
    expect(sunInColumn({ azimuth: 190, elevation: 0 }, 10)[0]).toBeCloseTo(-1, 12);
    expect(sunInColumn({ azimuth: 10, elevation: 0 }, 100)[1]).toBeCloseTo(-1, 12);
  });

  it('is computed for every column of the window, from its own azimuth', () => {
    const view = manifest.view;
    const cols = sunColumns(view, { azimuth: 214, elevation: 20 });
    expect(cols).toHaveLength(view.planeW * 4);
    const at = (x: number) => Array.from(cols.slice(x * 4, x * 4 + 3));
    const mid = at(view.planeW / 2);
    expect(mid[0]).toBeCloseTo(Math.cos(20 * RAD), 3); // the middle column looks near the sun's azimuth
    expect(at(0)[1]).toBeGreaterThan(0.1); // the left edge has the sun to its right
    expect(at(view.planeW - 1)[1]).toBeLessThan(-0.1);
  });
});

describe('the wall code', () => {
  it('reads R = G = 255 as a wall and a real normal as a normal', () => {
    expect(decodeNormal(255, 255)).toEqual({ wall: true });
    const flat = decodeNormal(128, 128);
    expect(flat.wall).toBe(false);
    if (!flat.wall) expect(flat.n[2]).toBeGreaterThan(0.99);
    // The steepest real normal of the Vienna bake (r2 + t2 = 0.998) still decodes as terrain.
    const r8 = Math.round(((Math.sqrt(0.998) + 1) / 2) * 255);
    const steep = decodeNormal(r8, 128);
    expect(steep.wall).toBe(false);
    if (!steep.wall) expect(Math.hypot(...steep.n)).toBeCloseTo(1, 1);
    expect(0.998).toBeLessThan(WALL_RT2);
    expect(2).toBeGreaterThan(WALL_RT2);
  });

  it('the shader carries the same threshold', () => {
    expect(FRAGMENT).toContain(`const float WALL_RT2 = ${WALL_RT2};`);
  });
});

describe('the lighting inputs', () => {
  const atm = (sinLog: number[] = []) => ({
    observerKm: 0.183,
    mieScale: 1,
    transmittanceToSpace: (mu: number, out: number[]) => {
      sinLog.push(mu);
      out[0] = 0.9 * mu;
      out[1] = 0.8 * mu;
      out[2] = 0.7 * mu;
    },
    irradiance: { direct: [0, 0, 0], ambient: [0.1, 0.2, 0.3] },
    radiance: vi.fn((vz: number, cosSun: number, out: number[]) => {
      out[0] = vz;
      out[1] = cosSun;
      out[2] = 1;
    }),
  });
  const sky = (elevation: number, a = atm()): PhysicalSky =>
    ({
      sun: { azimuth: 214, elevation },
      atm: a,
      fit: { display: { exposure: 12, curve: LIFT_ONLY } },
      view: manifest.view,
    } as unknown as PhysicalSky);

  it("takes the display of the sky's own fit, so terrain and sky share one exposure", () => {
    const l = lightingOf(manifest, sky(30));
    expect([l.exposure, l.curve]).toEqual([12, LIFT_ONLY]);
    expect(l.ambient).toEqual([0.1, 0.2, 0.3]);
    expect(l.logDMin).toBe(4.6);
    expect(l.logDSpan).toBeCloseTo(11.5 - 4.6, 12);
  });

  it("gives the ground the sun's transmittance at its elevation, and none with the sun below the atmosphere's cut-off", () => {
    const l = lightingOf(manifest, sky(30));
    expect(l.sunTransmittance[0]).toBeCloseTo(0.9 * Math.sin(30 * RAD), 12);
    expect(l.sunTransmittance[2]).toBeCloseTo(0.7 * Math.sin(30 * RAD), 12);
    expect(lightingOf(manifest, sky(DEFAULT_LOOK.sunCutoffDeg - 1)).sunTransmittance).toEqual([0, 0, 0]);
    expect(
      lightingOf(manifest, sky(DEFAULT_LOOK.sunCutoffDeg + 0.5)).sunTransmittance[0]
    ).toBeGreaterThanOrEqual(0);
  });

  it("takes the haze's extinction from the atmosphere at the observer: more aerosol, more extinction", () => {
    const clear = lightingOf(manifest, sky(30, { ...atm(), mieScale: 1 }));
    const hazy = lightingOf(manifest, sky(30, { ...atm(), mieScale: 4 }));
    expect(clear.extinction.every((e) => e > 0)).toBe(true);
    hazy.extinction.forEach((e, k) => expect(e).toBeGreaterThan(clear.extinction[k]));
  });

  it("builds the haze lookup from the view direction of each texel, the horizon's below it", () => {
    const a = atm();
    const lut = skyLut(sky(30, a), manifest.view, SKY_LUT.w, SKY_LUT.h);
    expect(lut).toHaveLength(SKY_LUT.w * SKY_LUT.h * 4);
    const texel = (i: number, j: number) =>
      Array.from(lut.slice((j * SKY_LUT.w + i) * 4, (j * SKY_LUT.w + i) * 4 + 3));
    const { horizonRow, planeH, pxPerDegV } = manifest.view;
    const rowAt = (j: number) => ((j + 0.5) / SKY_LUT.h) * planeH;
    // A row above the horizon asks the sky for the sine of its elevation; a row below it asks for the horizon.
    const above = Math.floor((horizonRow / planeH) * SKY_LUT.h) - 6;
    expect(texel(0, above)[0]).toBeCloseTo(
      Math.sin(((horizonRow - rowAt(above)) / pxPerDegV) * RAD),
      9
    );
    expect(texel(0, SKY_LUT.h - 1)[0]).toBe(0);
    // The sun lies at 214 degrees, the middle of the window: the cosine from the sun is 1 there and falls to the sides.
    const mid = texel(SKY_LUT.w / 2, above)[1];
    expect(mid).toBeGreaterThan(0.999);
    expect(texel(0, above)[1]).toBeLessThan(mid);
  });
});

describe('the display of the shader', () => {
  const g = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
  it("writes toneMap.ts's ACES matrices and fit into the source", () => {
    ACES_IN.forEach((row, i) =>
      expect(FRAGMENT).toContain(`const vec3 IN_R${i} = vec3(${row.map(g).join(', ')});`)
    );
    ACES_OUT.forEach((row, i) =>
      expect(FRAGMENT).toContain(`const vec3 OUT_R${i} = vec3(${row.map(g).join(', ')});`)
    );
    expect(FRAGMENT).toContain(`vec3(${g(ACES_FIT[0])}, ${g(ACES_FIT[1])}, 0.0)`);
    expect(FRAGMENT).toContain(`vec3(${g(ACES_FIT[2])}, ${g(ACES_FIT[3])}, ${g(ACES_FIT[4])})`);
  });
});

describe('the look reaches the shader', () => {
  // A recording WebGL2: every uniform call is kept by the name of its location, nothing is drawn.
  const run = (look?: Partial<RidgeLook>) => {
    const uniforms: Record<string, number[]> = {};
    const gl = new Proxy(
      {
        getUniformLocation: (_p: unknown, name: string) => name,
        uniform1i: () => undefined,
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getExtension: () => null,
      } as Record<string, unknown>,
      {
        get: (t, k: string) =>
          k in t
            ? t[k]
            : k.startsWith('uniform')
            ? (name: string, ...v: number[]) => {
                uniforms[name] = v;
              }
            : () => ({}),
      }
    );
    const el = { width: 0, height: 0, getContext: () => gl };
    vi.stubGlobal('document', { createElement: () => el });
    const bmp = { width: 1, height: 1, close: () => undefined } as unknown as ImageBitmap;
    const sky = {
      sun: { azimuth: 214, elevation: 30 },
      atm: {
        observerKm: 0.183,
        mieScale: 1,
        transmittanceToSpace: (_m: number, o: number[]) => o.fill(1),
        irradiance: { direct: [0, 0, 0], ambient: [0.1, 0.2, 0.3] },
        radiance: (_a: number, _b: number, o: number[]) => o.fill(0),
      },
      fit: { display: { exposure: 1, curve: LIFT_ONLY } },
      view: manifest.view,
    } as unknown as PhysicalSky;
    const one = { ...manifest, cards: manifest.cards.slice(0, 1) };
    try {
      lightCards(one, [{ colour: bmp, geometry: bmp }], sky, look && { ...DEFAULT_LOOK, ...look });
    } finally {
      vi.unstubAllGlobals();
    }
    return uniforms;
  };

  it('defaults to DEFAULT_LOOK', () => {
    const u = run();
    expect(u.uInkKeep).toEqual([0.45, 0.55, 0.8]);
    expect(u.uInkGeometry).toEqual([0.35, 0.85]);
  });

  it('carries an ink override to the uniforms: edge keep 1 removes edge ink', () => {
    const u = run({ inkKeep: { edge: 1, occlude: 0.55, crease: 0.8 } });
    expect(u.uInkKeep[0]).toBe(1);
  });

  it('carries the art-pass axes: relief, fixed light, tint, tone, ink scale, noise', () => {
    const u = run({
      reliefWeight: 0.15,
      reliefLight: { mix: 1, azimuthDeg: 0, elevationDeg: 90 },
      hazeTint: [0, 0.1, 0.3],
      nearWarm: 0.5,
      contrastByDistance: 1.5,
      cardToneStep: 0.2,
      cardGradient: 0.3,
      inkScale: 0,
      groundNoise: 0.4,
      cloudShadows: 0.6,
    });
    expect(u.uRelief).toEqual([0.15, 1]);
    expect(u.uFixedLight[2]).toBeCloseTo(1, 12); // a light straight up
    expect(u.uHazeTint).toEqual([0, 0.1, 0.3]);
    expect(u.uDist).toEqual([0.5, 1.5]);
    expect(u.uCard).toEqual([1, 0.3]); // a single card sits at the centre of the tone steps
    expect(u.uInkScale).toEqual([0]);
    expect(u.uGround).toEqual([0.4, 0.6]);
  });

  it('scales the haze optical depth and the ambient light, and moves the sun cut-off', () => {
    const base = run();
    const look = run({ hazeScale: 2 * DEFAULT_LOOK.hazeScale, ambientScale: 0.5 });
    look.uExt.forEach((e, k) => expect(e).toBeCloseTo(2 * base.uExt[k], 12));
    expect(look.uAmbient[2]).toBeCloseTo(0.15, 12);
    expect(
      lightingOf(manifest, sky30(), { ...DEFAULT_LOOK, sunCutoffDeg: 45 }).sunTransmittance
    ).toEqual([0, 0, 0]);
  });
});

function sky30(): PhysicalSky {
  return {
    sun: { azimuth: 214, elevation: 30 },
    atm: {
      observerKm: 0.183,
      mieScale: 1,
      transmittanceToSpace: (_m: number, o: number[]) => o.fill(1),
      irradiance: { direct: [0, 0, 0], ambient: [0, 0, 0] },
    },
    fit: { display: { exposure: 1, curve: LIFT_ONLY } },
  } as unknown as PhysicalSky;
}

describe('night ambient', () => {
  const nightAtm = {
    observerKm: 0.183,
    mieScale: 1,
    transmittanceToSpace: (_m: number, o: number[]) => o.fill(1),
    irradiance: { direct: [0, 0, 0], ambient: [0.001, 0.001, 0.002] },
    radiance: (_a: number, _b: number, o: number[]) => o.fill(0),
  };
  const night = (state: string, nightAmbient?: [number, number, number]) =>
    lightingOf(
      manifest,
      {
        state,
        sun: { azimuth: 0, elevation: -30 },
        atm: nightAtm,
        fit: { display: { exposure: 1, curve: LIFT_ONLY } },
        view: manifest.view,
      } as unknown as PhysicalSky,
      nightAmbient ? { ...DEFAULT_LOOK, nightAmbient } : DEFAULT_LOOK
    );
  it('lights the ground at night, cool, and only at night', () => {
    const n = night('night');
    const base = nightAtm.irradiance.ambient;
    n.ambient.forEach((a, i) => expect(a).toBeGreaterThan(base[i]));
    expect(n.ambient[2] - base[2]).toBeGreaterThan(n.ambient[0] - base[0]);
    expect(night('dusk').ambient).toEqual(base);
    expect(DEFAULT_LOOK.nightAmbient.every((c) => c > 0)).toBe(true);
  });
});

describe('cel shading', () => {
  const sweep = (bands: number, softness: number, levels?: number[]) => {
    const out = new Set<number>();
    for (let i = -20; i <= 100; i += 1) {
      const x = i / 100;
      // away from the band edges (i / bands), where a softened edge is between two levels
      if (Array.from({ length: bands }, (_, k) => k / bands).some((e) => e > 0 && Math.abs(x - e) <= softness / 2 + 1e-9)) continue;
      out.add(Math.round(celShade(x, bands, softness, levels) * 1e9));
    }
    return out;
  };
  it.each([1, 2, 3, 4, 6])('quantizes a normal sweep to exactly %i levels away from the edges', (n) => {
    expect(sweep(n, 0.05).size).toBe(n);
    expect(sweep(n, 0).size).toBe(n);
  });
  it('is monotone in n.s, from the lowest level to the highest, and softens an edge without a jump', () => {
    let prev = -1;
    let maxStep = 0;
    for (let i = -20; i <= 100; i += 1) {
      const v = celShade(i / 100, 3, 0.1);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      if (prev >= 0) maxStep = Math.max(maxStep, v - prev);
      prev = v;
    }
    expect(maxStep).toBeLessThan(0.3);
    expect(celShade(-0.5, 3, 0)).toBe(0);
    expect(celShade(1, 3, 0)).toBe(1);
  });
  it('takes the band levels it is given', () => {
    expect(celLevels(3, [0.2, 0.5, 0.9]).slice(0, 3)).toEqual([0.2, 0.5, 0.9]);
    expect(celShade(0.9, 3, 0, [0.2, 0.5, 0.9])).toBe(0.9);
    expect(celShade(-1, 3, 0, [0.2, 0.5, 0.9])).toBe(0.2);
  });
  it('is on in the default look and off in the physical one; the shader carries the ramp', () => {
    expect(DEFAULT_LOOK.celBands).toBeGreaterThan(0);
    expect(PHYSICAL_LOOK.celBands).toBe(0);
    expect(FRAGMENT).toContain('float cel(float x)');
    expect(FRAGMENT).toContain('uBandLevels[6]');
  });
});
