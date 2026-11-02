import { describe, expect, it } from 'vitest';
import common from './shaders/common.glsl?raw';
import terrain from './shaders/terrain.frag.glsl?raw';
import atmosphere from './shaders/atmosphere.frag.glsl?raw';
import resolve from './shaders/resolve.frag.glsl?raw';
import composite from './shaders/composite.frag.glsl?raw';
import { terrainBounds, WORLD, worldDefines } from './world';

describe('world defines', () => {
  it('define every W_ name any scene shader uses', () => {
    const defined = new Set([...worldDefines().matchAll(/#define (W_\w+)/g)].map((m) => m[1]));
    [common, terrain, atmosphere, resolve, composite]
      .flatMap((src) => [...src.matchAll(/\bW_[A-Z0-9_]+\b/g)])
      .forEach((m) => expect(defined, m[0]).toContain(m[0]));
  });

  it('emit only valid GLSL numbers', () => {
    expect(worldDefines()).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('terrain step bound', () => {
  it('is more conservative with erosion than without, and without erosion carries no phacelle term', () => {
    const b = terrainBounds();
    expect(b.slopeFull).toBeGreaterThan(b.slopeEnvelope);
    const off = terrainBounds({ ...WORLD, phacelleGradBound: 0 });
    expect(off.slopeFull).toBe(off.slopeEnvelope);
  });

  it('puts every surface under the height the tracer skips to', () => {
    const maxHeight = Number(/#define W_MAX_HEIGHT (\S+)/.exec(worldDefines())![1]);
    expect(maxHeight).toBeGreaterThanOrEqual(terrainBounds().maxHeight);
    expect(maxHeight).toBeGreaterThanOrEqual(WORLD.tree.canopyY + WORLD.tree.canopyRadius[1]);
  });

  it('leaves the erosion bound turned on only when a bound exists', () => {
    expect(worldDefines()).toContain('#define W_ERODE_ENABLED 1');
    expect(worldDefines({ ...WORLD, phacelleGradBound: 0 })).toContain('#define W_ERODE_ENABLED 0');
  });
});
