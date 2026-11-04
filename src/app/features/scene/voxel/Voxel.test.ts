import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCanvas, fakeGl } from '../fakeGl';
import heightStage from '../shaders/voxelHeight.frag.glsl?raw';
import { fragmentSource } from '../shaderSource';
import { startBackgroundScene } from '../index';
import { createVoxelScene, SCALE_LEVELS } from './Voxel';
import { VOXEL, voxelDefines } from './voxelWorld';

const N = VOXEL.ring;
let rafQueue: Array<(t: number) => void>;
let win: EventTarget;
let motion: EventTarget & { matches: boolean };

beforeEach(() => {
  rafQueue = [];
  motion = Object.assign(new EventTarget(), { matches: false });
  win = Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => motion });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

const runFrame = (now: number) => {
  const cb = rafQueue.shift();
  if (!cb) throw new Error('no frame was scheduled');
  cb(now);
};
const asCanvas = (c: ReturnType<typeof fakeCanvas>) => c as unknown as HTMLCanvasElement;

/** A voxel scene on a fake GL whose camera follows `time.t`, seconds. */
function build(extra: Partial<Parameters<typeof createVoxelScene>[0]> = {}) {
  const { gl, calls } = fakeGl();
  const canvas = fakeCanvas(gl);
  const time = { t: 0 };
  const scene = createVoxelScene({
    canvas: asCanvas(canvas),
    clock: () => time.t,
    ...extra,
  });
  return { scene, calls, canvas, time };
}

describe('voxel scene contract', () => {
  it("'off' returns null without a context; no WebGL2 says so", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    expect(createVoxelScene({ canvas: asCanvas(canvas), tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
    const onUnavailable = vi.fn();
    expect(createVoxelScene({ canvas: asCanvas(fakeCanvas(null)), onUnavailable })).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith('no-webgl2');
  });

  it('needs no extension and allocates no float target: only RG8 and RGBA8 textures', () => {
    const { calls } = build();
    runFrame(1000);
    expect(calls.getExtension).toBeUndefined();
    const formats = calls.texStorage2D.mock.calls.map((c) => c[2]);
    expect(formats.sort()).toEqual([208, 209]); // RG8 ring, RGBA8 sky
  });

  it('reports a compile failure through onCompileFail and returns null', () => {
    const { gl } = fakeGl(2);
    const onCompileFail = vi.fn();
    expect(createVoxelScene({ canvas: asCanvas(fakeCanvas(gl)), onCompileFail })).toBeNull();
    expect(onCompileFail).toHaveBeenCalledTimes(1);
  });

  it("'still' draws one frame and schedules no more; 'full' keeps going", () => {
    const still = build({ tier: 'still' });
    runFrame(1000);
    expect(rafQueue).toHaveLength(0);
    expect(still.scene).not.toBeNull();
    rafQueue.length = 0;
    build({ tier: 'full' });
    runFrame(1000);
    expect(rafQueue).toHaveLength(1);
  });

  it('login() starts a pull-back and a lost context ends the scene', () => {
    const lost = vi.fn();
    const { scene, canvas } = build({ onContextLost: lost });
    runFrame(1000);
    scene?.login();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(lost).toHaveBeenCalledTimes(1);
    rafQueue.length = 0;
    scene?.login();
    expect(rafQueue).toHaveLength(0);
  });
});

describe('voxel ring generation', () => {
  it('the first frame bakes the sky, fills the whole ring once, and draws the terrain', () => {
    const { calls } = build();
    runFrame(1000);
    expect(calls.drawArrays).toHaveBeenCalledTimes(3);
    expect(calls.scissor.mock.calls).toEqual([[0, 0, N, N]]);
  });

  it('a frame in the same cell generates nothing', () => {
    const { calls } = build();
    runFrame(1000);
    runFrame(1034);
    expect(calls.drawArrays).toHaveBeenCalledTimes(4); // one more draw: the terrain
    expect(calls.scissor).toHaveBeenCalledTimes(1);
  });

  it('crossing a cell writes strips, never the whole ring again', () => {
    const { calls, time } = build();
    runFrame(1000);
    time.t = 1; // 14 units along the rail: a cell or two
    runFrame(1034);
    const strips = calls.scissor.mock.calls.slice(1);
    expect(strips.length).toBeGreaterThan(0);
    for (const [, , w, h] of strips) {
      expect((w === N) !== (h === N)).toBe(true); // one side the whole ring, the other a few cells
      expect(Math.min(w, h)).toBeLessThanOrEqual(3);
    }
  });

  it('a long pause jumps the camera past the ring and regenerates it whole', () => {
    const { calls, time } = build();
    runFrame(1000);
    time.t = 3600; // an hour on the rail
    runFrame(1034);
    expect(calls.scissor.mock.calls.at(-1)).toEqual([0, 0, N, N]);
  });
});

describe('voxel measurement and adaptation', () => {
  it('reads lookups per pixel back from alpha and times the draw, only when asked', () => {
    const plain = build();
    runFrame(1000);
    expect(plain.calls.readPixels).toBeUndefined();
    rafQueue.length = 0;
    const onTraceStats = vi.fn();
    const onFrameStats = vi.fn();
    const m = build({ onTraceStats, onFrameStats });
    runFrame(1000);
    runFrame(1034);
    expect(m.calls.readPixels).toHaveBeenCalledTimes(2); // frame 0 of every 8: a one-texel sync, then the counted frame
    expect(onTraceStats).toHaveBeenCalledTimes(1);
    expect(m.canvas.getContext.mock.calls[0][1].alpha).toBe(false); // the canvas is opaque; the count is drawn off screen
    expect(onFrameStats).toHaveBeenCalledTimes(1); // the first frame has no predecessor
    expect(onFrameStats.mock.calls[0][0].frameMs).toBe(34);
  });

  it('steps the drawing buffer down when frames keep missing the cap, and never back up', () => {
    const { canvas } = build({ unthrottled: true });
    let now = 1000;
    runFrame(now);
    expect(canvas.width).toBe(Math.round(400 * SCALE_LEVELS[0].scale));
    for (let i = 0; i < 60; i++) runFrame((now += 100));
    expect(canvas.width).toBe(Math.round(400 * SCALE_LEVELS[1].scale));
    for (let i = 0; i < 200; i++) runFrame((now += 10));
    expect(canvas.width).toBe(Math.round(400 * SCALE_LEVELS[1].scale));
  });

  it("'low' starts below the top of the ladder", () => {
    const { canvas } = build({ tier: 'low' });
    runFrame(1000);
    expect(canvas.width).toBe(Math.round(400 * SCALE_LEVELS[2].scale));
  });
});

describe('voxel shaders', () => {
  it('the march is capped at the lookup budget and the pass uses no extension', () => {
    const src = fragmentSource('voxel', voxelDefines());
    expect(src).toContain(`#define VOX_MAX_LOOKUPS ${VOXEL.maxLookups}`);
    expect(src).not.toContain('#extension');
    expect(src).toContain('texelFetch(u_height');
  });

  it('ring generation is a pure function of the cell and uses the shipped terrain', () => {
    const src = fragmentSource('voxelHeight', voxelDefines());
    expect(src).toContain('terrainFbm(xz)');
    expect(src).toContain('terrainPhacelle(xz)');
    expect(heightStage).not.toContain('u_time'); // nothing in the height depends on the clock
    expect(src).toContain(`#define VOX_RING ${N}`);
  });
});

describe('the door picks the style', () => {
  it('voxel by default: one frame is sky, ring and terrain, three draws', async () => {
    const { gl, calls } = fakeGl();
    const scene = await startBackgroundScene(
      { tier: 'still' },
      {},
      { canvas: asCanvas(fakeCanvas(gl)) }
    );
    expect(scene).not.toBeNull();
    runFrame(1000);
    expect(calls.drawArrays).toHaveBeenCalledTimes(3);
  });

  it("'raymarch' keeps the sphere-traced scene", async () => {
    const { gl, calls } = fakeGl();
    await startBackgroundScene(
      { tier: 'still', style: 'raymarch' },
      {},
      { canvas: asCanvas(fakeCanvas(gl)) }
    );
    runFrame(1000);
    expect(calls.drawArrays).toHaveBeenCalledTimes(5);
  });
});
