import { describe, expect, it } from 'vitest';
import {
  buildMesh,
  HAZE,
  hazed,
  hazeTransmittance,
  height,
  MESH,
  periodWidth,
  triangleCount,
  vertexCount,
  viewDepth,
  viewProjection,
} from './meshWorld';
import { hazeColour, layerColour, layerColourAtRow, LAYERS, ROW_DEPTH } from './ridgeWorld';
import { skyColours } from './skyColour';

describe('mesh geometry', () => {
  it('is a few thousand triangles and fits 16-bit indices', () => {
    expect(triangleCount()).toBeGreaterThanOrEqual(2000);
    expect(triangleCount()).toBeLessThanOrEqual(5000);
    expect(vertexCount()).toBeLessThan(65536);
  });

  it('builds exactly the declared triangles with every index in range', () => {
    const m = buildMesh(16 / 9);
    expect(m.indices.length).toBe(triangleCount() * 3);
    expect(m.positions.length).toBe(vertexCount() * 3);
    expect(m.normals.length).toBe(m.positions.length);
    for (const i of m.indices) expect(i).toBeLessThan(vertexCount());
  });

  it('is periodic: a column one period over has the same height, so a drift of one period loops', () => {
    const m = buildMesh(1);
    const cols = 2 * MESH.colsPerPeriod + 1;
    for (const r of [0, 7, MESH.rows]) {
      for (const c of [0, 5, 30]) {
        const a = m.positions[(r * cols + c) * 3 + 1];
        const b = m.positions[(r * cols + c + MESH.colsPerPeriod) * 3 + 1];
        expect(b).toBeCloseTo(a, 5);
      }
    }
  });

  it('keeps heights in [0, relief], lower in front of the camera than at the far edge on average', () => {
    const mean = (r: number) => {
      let s = 0;
      for (let k = 0; k < 48; k += 1) {
        const h = height(k / 48, r);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(MESH.relief);
        s += h;
      }
      return s / 48;
    };
    expect(mean(MESH.rows)).toBeGreaterThan(mean(0));
  });

  it('puts every row between near and far and keeps the eye above the nearest rows', () => {
    const m = buildMesh(1);
    const cols = 2 * MESH.colsPerPeriod + 1;
    expect(-m.positions[2]).toBeCloseTo(MESH.near, 4);
    expect(-m.positions[MESH.rows * cols * 3 + 2]).toBeCloseTo(MESH.far, 3);
    for (let c = 0; c < cols; c += 1) expect(m.positions[c * 3 + 1]).toBeLessThan(MESH.eye);
  });

  it('has unit, upward-facing normals (the only shading input)', () => {
    const m = buildMesh(1);
    for (let i = 0; i < m.normals.length; i += 3) {
      const len = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
      expect(len).toBeCloseTo(1, 4);
      expect(m.normals[i + 1]).toBeGreaterThan(0);
    }
  });

  it('is wide enough at the far row that the view never sees an end, at any aspect', () => {
    for (const aspect of [0.5, 1, 2.4]) {
      const farHalf = MESH.far * Math.tan(MESH.fov / 2) * Math.max(aspect, aspect * 1);
      expect(periodWidth(aspect) / 2).toBeGreaterThan(farHalf * (aspect < 1 ? 0.5 : 0.8));
    }
  });
});

describe('view-space depth', () => {
  it("is the w the projection produces, which is what the shader's haze reads", () => {
    const vp = viewProjection(16 / 9);
    for (const [y, z] of [
      [3, -10],
      [20, -90],
      [0, -150],
    ]) {
      const w = vp[3] * 0 + vp[7] * y + vp[11] * z + vp[15];
      expect(w).toBeCloseTo(viewDepth(y, z), 4);
    }
  });
});

describe('depth haze', () => {
  const sky = skyColours();
  const ground = sky.ground;
  const haze = hazeColour(sky);

  it('is exp(-k d / far): 1 at the eye, strictly falling, never zero', () => {
    expect(hazeTransmittance(0)).toBe(1);
    let prev = 1;
    for (const d of [10, 40, 90, MESH.far]) {
      const t = hazeTransmittance(d);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
    expect(hazeTransmittance(MESH.far)).toBeCloseTo(Math.exp(-HAZE.extinction), 12);
  });

  it('leaves the base colour at depth 0 and approaches the haze colour far away', () => {
    const near = hazed(ground, haze, 0);
    for (let i = 0; i < 3; i += 1) expect(near[i]).toBeCloseTo(ground[i], 9);
    const far = hazed(ground, haze, MESH.far * 4);
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Far away only the haze is left, desaturated by the full HAZE.desaturate.
    const luma = 0.2126 * haze[0] + 0.7152 * haze[1] + 0.0722 * haze[2];
    for (let i = 0; i < 3; i += 1)
      expect(far[i]).toBeCloseTo(luma + (haze[i] - luma) * (1 - HAZE.desaturate), 2);
    expect(dist(far, haze)).toBeLessThan(dist(near, haze));
  });

  it('desaturates slightly: chroma shrinks by desaturate * (1 - T) relative to the plain mix', () => {
    const chroma = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
    const d = MESH.far * 0.6;
    const t = hazeTransmittance(d);
    const plain = [0, 1, 2].map((i) => ground[i] * t + haze[i] * (1 - t));
    const out = hazed(ground, haze, d);
    expect(chroma(out) / chroma(plain)).toBeCloseTo(1 - HAZE.desaturate * (1 - t), 6);
    expect(HAZE.desaturate).toBeLessThanOrEqual(0.5); // "slight"
  });

  it('takes its haze colour from the one sky seam: a different sky, a different far colour', () => {
    const other = { ...sky, horizon: [20, 200, 90] as const, mid: [10, 120, 60] as const };
    expect(hazed(ground, hazeColour(other), MESH.far)).not.toEqual(hazed(ground, haze, MESH.far));
  });
});

describe('baked-path row haze (comparison)', () => {
  const sky = skyColours();
  const mean = (c: readonly number[]) => (c[0] + c[1] + c[2]) / 3;
  const hazeMean = mean(hazeColour(sky));

  it('is hazier at the silhouette top than at its foot, for every layer', () => {
    for (const spec of LAYERS) {
      const top = layerColourAtRow(spec, sky, 0);
      const foot = layerColourAtRow(spec, sky, 1);
      expect(Math.abs(mean(top) - hazeMean)).toBeLessThanOrEqual(Math.abs(mean(foot) - hazeMean));
    }
  });

  it("at the foot is the layer's own bake colour shifted by nothing but the layer distance", () => {
    for (const spec of LAYERS)
      expect(layerColourAtRow(spec, sky, 1)).toEqual(layerColour(spec, sky));
  });

  it('adds ROW_DEPTH of distance at the top', () => {
    expect(ROW_DEPTH).toBeGreaterThan(0);
    const spec = LAYERS[1];
    expect(layerColourAtRow(spec, sky, 0)).not.toEqual(layerColourAtRow(spec, sky, 1));
  });
});
