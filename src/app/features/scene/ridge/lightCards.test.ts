import { describe, expect, it, vi } from 'vitest';
import {
  decodeNormal,
  DEFAULT_LOOK,
  PHYSICAL_LOOK,
  celShade,
  celLevels,
  FRAGMENT,
  createLighter,
  lightingOf,
  ringAzimuth,
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
import { ACES_FIT, ACES_IN, ACES_OUT, BLACK_LIFT, makeCurve } from './toneMap';

const manifest = parseManifest(wireManifest(), '/d/');
const RAD = Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A display curve that is the straight line from the black lift to white: a fixture, the cards only need some curve to carry. */
const FLAT_CURVE = makeCurve(
  [0, 0.25, 0.5, 0.75, 1],
  [0, 0.25, 0.5, 0.75, 1].map((v) => BLACK_LIFT + (1 - BLACK_LIFT) * v)
);

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

  it('is computed for every column of the ring, from its own absolute azimuth', () => {
    const view = manifest.view;
    const cols = sunColumns(view, { azimuth: 214, elevation: 20 });
    expect(cols).toHaveLength(view.ringW * 4);
    const at = (x: number) => Array.from(cols.slice(x * 4, x * 4 + 3));
    const sunCol = Math.floor((214 / 360) * view.ringW);
    expect(ringAzimuth(sunCol, view.ringW)).toBeCloseTo(214, 1);
    expect(at(sunCol)[0]).toBeCloseTo(Math.cos(20 * RAD), 3); // the column that looks at the sun's azimuth
    expect(at(sunCol - 1000)[1]).toBeGreaterThan(0.1); // the sun is to the right of columns before it, and to the left of those after
    expect(at(sunCol + 1000)[1]).toBeLessThan(-0.1);
    // Every column is a unit vector, the first column of the ring looks north and the last looks just west of it.
    for (let x = 0; x < view.ringW; x += 400) expect(Math.hypot(...at(x))).toBeCloseTo(1, 5);
    expect(ringAzimuth(0, view.ringW)).toBeCloseTo(0.028125, 6);
    expect(ringAzimuth(view.ringW - 1, view.ringW)).toBeCloseTo(360 - 0.028125, 6);
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
      fit: { display: { exposure: 12, curve: FLAT_CURVE } },
      view: manifest.view,
    } as unknown as PhysicalSky);

  it("takes the display of the sky's own fit, so terrain and sky share one exposure", () => {
    const l = lightingOf(manifest, sky(30));
    expect([l.exposure, l.curve]).toEqual([12, FLAT_CURVE]);
    [0.1, 0.2, 0.3].forEach((a, i) => expect(l.key.ambient[i]).toBeCloseTo(a, 6)); // plus the airglow's
    expect(l.logDMin).toBe(4.6);
    expect(l.logDSpan).toBeCloseTo(11.5 - 4.6, 12);
  });

  it("gives the ground the sun's transmittance at its elevation, and none with the sun below the atmosphere's cut-off", () => {
    const l = lightingOf(manifest, sky(30));
    expect(l.key.direct[0]).toBeCloseTo(0.9 * Math.sin(30 * RAD), 12);
    expect(l.key.direct[2]).toBeCloseTo(0.7 * Math.sin(30 * RAD), 12);
    expect(lightingOf(manifest, sky(DEFAULT_LOOK.sunCutoffDeg - 1)).key.direct).toEqual([0, 0, 0]);
    expect(
      lightingOf(manifest, sky(DEFAULT_LOOK.sunCutoffDeg + 0.5)).key.direct[0]
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
      7 // the airglow floor adds a few 1e-9
    );
    expect(texel(0, SKY_LUT.h - 1)[0]).toBeCloseTo(0, 7);
    // The sun lies at 214 degrees: the cosine from the sun is 1 at its column and falls round the ring. The table spans the ring, so 320 columns.
    expect(SKY_LUT.w).toBe(320);
    const sunI = Math.floor((214 / 360) * SKY_LUT.w);
    const mid = texel(sunI, above)[1];
    expect(mid).toBeGreaterThan(0.999);
    expect(texel(0, above)[1]).toBeLessThan(mid);
    expect(texel(sunI + 160, above)[1]).toBeLessThan(-0.9);
  });
});

describe('the ring in the shader', () => {
  it('reads the sun and the sky by the column of the ring, not of the file, and wraps at the ends', () => {
    expect(FRAGMENT).toContain('int col = ((uCol0 + int(floor(u.x))) % uRingW + uRingW) % uRingW;');
    expect(FRAGMENT).toContain('texelFetch(uSun, ivec2(col, 0), 0)');
    expect(FRAGMENT).toContain('float ringX = float(uCol0) + u.x;');
    expect(FRAGMENT).toContain('(int(b.x) % w + w) % w'); // the sky table wraps in azimuth
  });
  it('gives the ground noise the ground point, so it is the same at ring column 0 and column 6400', () => {
    // The noise coordinate is dist x (sin psi, cos psi) with psi from the wrapped column: sin and cos of 0 and of a whole turn are one point.
    expect(FRAGMENT).toContain('vec2 world = vec2(sin(psi), cos(psi)) * dist;');
    expect(FRAGMENT).toContain('float psi = ringX / float(uRingW) * 2.0 * PI;');
    expect(FRAGMENT).not.toContain("uRadPerPx");
    const at = (col: number, w: number) => {
      const psi = (col + 0.5) / w * 2 * Math.PI; // the shader takes psi from the unwrapped ring position, sin and cos wrap by themselves
      return [Math.sin(psi), Math.cos(psi)];
    };
    expect(at(6400, 6400)[0]).toBeCloseTo(at(0, 6400)[0], 12);
    expect(at(6400, 6400)[1]).toBeCloseTo(at(0, 6400)[1], 12);
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
  const run = (look?: Partial<RidgeLook>, tile = 0, scale = 1) => {
    const uniforms: Record<string, number[]> = {};
    const crops: number[][] = [];
    const gl = new Proxy(
      {
        getUniformLocation: (_p: unknown, name: string) => name,
        drawImage: (...a: unknown[]) => crops.push(a.slice(1) as number[]),
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
    const bmp = { width: 1604, height: 7, close: () => undefined } as unknown as ImageBitmap;
    const sky = {
      sun: { azimuth: 214, elevation: 30 },
      atm: {
        observerKm: 0.183,
        mieScale: 1,
        transmittanceToSpace: (_m: number, o: number[]) => o.fill(1),
        irradiance: { direct: [0, 0, 0], ambient: [0.1, 0.2, 0.3] },
        radiance: (_a: number, _b: number, o: number[]) => o.fill(0),
      },
      fit: { display: { exposure: 1, curve: FLAT_CURVE } },
      view: manifest.view,
    } as unknown as PhysicalSky;
    const one = { ...manifest, cards: manifest.cards.slice(0, 1) };
    let canvas: { width: number; height: number } | undefined;
    let lighterOut: ReturnType<typeof createLighter> | undefined;
    try {
      const lighter = createLighter(one, sky, look && { ...DEFAULT_LOOK, ...look }, scale);
      lighterOut = lighter;
      canvas = lighter.light({ colour: bmp, geometry: bmp }, tile, 0) as unknown as typeof canvas;
    } finally {
      vi.unstubAllGlobals();
    }
    return Object.assign(uniforms, { crops, canvas, lighter: lighterOut as ReturnType<typeof createLighter> });
  };

  it('lights a tile from its own columns: the ring column of the file, the band, and the interior with one overlap column each side', () => {
    const u = run(undefined, 3);
    const { view } = manifest;
    expect(u.uCol0).toEqual([3 * view.tileW - view.apron]); // tile 3 of 4: the file starts two columns before its first
    expect(u.uRingW).toEqual([view.ringW]);
    expect(u.uTop).toEqual([manifest.tiles[3][0]!.top]);
    expect(u.uSkySize).toEqual([320, 64]);
    // The file holds tileW + 2 apron columns; the canvas keeps columns apron - 1 .. apron + tileW: the interior and one column each side.
    expect(u.crops).toEqual([[view.apron - 1, 0, view.tileW + 2, 7, 0, 0, view.tileW + 2, 7]]);
    expect(u.canvas).toMatchObject({ width: view.tileW + 2, height: 7 });
    expect(u.uScale).toEqual([1]);
  });

  it.each([1, 1.5, 2.5])('lights at scale %s: the GL canvas and the lit canvas are the file and the tile at that many pixels a texel, uScale is set', (S) => {
    const u = run(undefined, 0, S);
    const { view } = manifest;
    const litW = Math.round((view.tileW + 2) * S);
    const h = Math.round(7 * S);
    expect(u.uScale).toEqual([S]);
    expect(u.canvas).toMatchObject({ width: litW, height: h });
    // The crop starts at file column apron - 1, at whole output pixels, and is the canvas 1:1.
    expect(u.crops).toEqual([[Math.round((view.apron - 1) * S), 0, litW, h, 0, 0, litW, h]]);
  });

  it('keeps the light times of the cards it lit, for the probe, and the renderer it lit on', () => {
    const { lighter } = run(undefined, 0, 2);
    expect(lighter.scale).toBe(2);
    expect(lighter.lightMs).toHaveLength(1);
    expect(lighter.lightMs[0]).toBeGreaterThanOrEqual(0);
    expect(lighter.renderer).toBe('unknown'); // the recording context exposes no WEBGL_debug_renderer_info
  });

  it('throws without WebGL2: the caller makes the sky alone', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(() => createLighter(manifest, {} as PhysicalSky)).toThrow(/WebGL2/);
    vi.unstubAllGlobals();
  });

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
    expect(look.uAmbient[2]).toBeCloseTo(0.15, 6); // plus the airglow's ambient
    expect(
      lightingOf(manifest, sky30(), { ...DEFAULT_LOOK, sunCutoffDeg: 45 }).key.direct
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
    fit: { display: { exposure: 1, curve: FLAT_CURVE } },
  } as unknown as PhysicalSky;
}

describe('night key light', () => {
  const atmOf = (ambient: [number, number, number]) => ({
    observerKm: 0.183,
    mieScale: 1,
    transmittanceToSpace: (_m: number, o: number[]) => o.fill(1),
    irradiance: { direct: [0, 0, 0], ambient },
    radiance: (_a: number, _b: number, o: number[]) => o.fill(0),
  });
  const night = (moonEl: number | undefined, state = 'night') =>
    lightingOf(manifest, {
      state,
      sun: { azimuth: 0, elevation: -30 },
      moon: { azimuth: 150, elevation: moonEl ?? -20 },
      night:
        moonEl === undefined
          ? {}
          : { moon: { azimuth: 150, elevation: moonEl, ratio: 2.5e-6, atm: atmOf([0.4, 0.5, 0.8]) } },
      atm: atmOf([0.001, 0.001, 0.002]),
      fit: { display: { exposure: 1, curve: FLAT_CURVE } },
      view: manifest.view,
    } as unknown as PhysicalSky);

  it('is the moon at night: its direction, its irradiance ratio times the transmittance, its ambient scaled by the ratio', () => {
    const l = night(40);
    expect([l.key.azimuth, l.key.elevation]).toEqual([150, 40]);
    expect(l.key.direct[0]).toBeCloseTo(2.5e-6, 12);
    expect(l.key.ambient[2]).toBeGreaterThan(0.002);
    expect(l.key.ambient[2]).toBeCloseTo(0.002 + 0.8 * 2.5e-6, 4);
  });
  it('has no direct light with the moon down, and keeps the ambient (twilight and airglow)', () => {
    const l = night(undefined);
    expect(l.key.direct).toEqual([0, 0, 0]);
    expect(l.key.ambient.every((a) => a > 0)).toBe(true);
  });
  it('fades the moon out over the horizon', () => {
    expect(night(-0.5).key.direct[0]).toBe(0);
    expect(night(0.5).key.direct[0]).toBeGreaterThan(0);
    expect(night(0.5).key.direct[0]).toBeLessThan(night(5).key.direct[0]);
  });
  it('the sun lights the other states', () => {
    const l = lightingOf(manifest, sky30());
    expect(l.key.elevation).toBe(30);
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
  it('widens every band edge, and the ambient step, to at least one output pixel by the screen derivative', () => {
    expect(FRAGMENT).toContain('float w = max(uCel.y * 0.5, 0.5 * fwidth(x));');
    expect(FRAGMENT).toContain('float w = max(uCel.y * 0.5, 0.5 * fwidth(n.z));');
    expect(FRAGMENT).toContain('smoothstep(uCel.w - w, uCel.w + w + 1e-4, n.z)');
  });
});

describe('the card sampled per output pixel', () => {
  it('addresses the card by the output pixel centre in file texels, y flipped, and lights nothing from the own texel of the fragment', () => {
    expect(FRAGMENT).toContain('uniform float uScale;');
    expect(FRAGMENT).toContain('vec2 u = vec2(gl_FragCoord.x / uScale, float(uSize.y) - gl_FragCoord.y / uScale);');
    expect(FRAGMENT).not.toContain('ivec2(int(gl_FragCoord.x)');
    expect(FRAGMENT).not.toContain('texelFetch(uColour, p, 0);\n  if (c.a');
  });
  it('filters the normal and the log-distance by cubic B-spline weights over the 4x4 taps of a class, and the albedo bilinear and alpha-weighted', () => {
    expect(FRAGMENT).toContain('vec4 bspline(float f)');
    expect(FRAGMENT).toContain('float w = gWx[i] * gWy[j];');
    expect(FRAGMENT).toContain('if (gA[k] <= 0.0 || frontTap(k) != front) continue;'); // alpha-0 and other-class taps weigh nothing
    expect(FRAGMENT).toContain('if (gWall[k] < 0.5) {'); // wall taps weigh nothing for the normal
    expect(FRAGMENT).toContain('normalize(nSum)'); // the normalised average of unit normals
    expect(FRAGMENT).toContain('alb += w * gA[k] * toLinear(gC[k]);');
    expect(FRAGMENT).toContain('float a = texture(uColour, u / vec2(uSize)).a;'); // alpha is the sampler's bilinear, never B-spline filtered
  });
  it('splits an occlusion edge into classes by the 2x2 footprint and cuts between them one output pixel wide', () => {
    expect(FRAGMENT).toContain('return gD[k] - gRef <= uInkGeometry.x;');
    expect(FRAGMENT).toContain('t = smoothstep(0.5 - fm, 0.5 + fm, m);');
    expect(FRAGMENT).toContain('float fm = max(0.5 * mFw, 1e-4);');
  });
  it('reads every screen derivative before the first branch that differs between pixels, the transparent return included', () => {
    const derivatives = FRAGMENT.indexOf('float mFw = fwidth(m);');
    expect(derivatives).toBeGreaterThan(0);
    expect(FRAGMENT.indexOf('if (a <= 0.0) {')).toBeGreaterThan(derivatives);
    const afterReturn = FRAGMENT.slice(FRAGMENT.indexOf('if (a <= 0.0) {'));
    expect(afterReturn).not.toMatch(/fwidth\(|dFdx\(|dFdy\(/);
  });
  it('draws ink from the filtered fields per output pixel: the edge of the alpha, the front side of the class split, the crease of the normal, none of them from a neighbour texel', () => {
    expect(FRAGMENT).toContain('float de = (a - 0.5) / max(length(dA), 1e-6);');
    expect(FRAGMENT).toContain('float dm = (m - 0.5) / max(length(dM), 1e-6);');
    expect(FRAGMENT).toContain('float thr = sqrt(2.0 * (1.0 - uInkGeometry.y));');
    expect(FRAGMENT).toContain('float band(float d, float px)');
    expect(FRAGMENT).not.toContain('for (int k = 0; k < 4; k++)');
    expect(FRAGMENT).not.toContain('ivec2 dirs');
    expect(FRAGMENT).not.toContain('Geo geoAt');
  });
});
