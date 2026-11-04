// The voxel terrain scene: a wrapping ring of cell heights around the camera, drawn painter's order
// as vertical strips over a baked sky. Same createScene contract as the ray-march scene,
// but WebGL2 core only: no extensions, no float targets. Heights are 16 bits in an RG8 ring that the
// strips' vertex shader reads; the sky is baked once into RGBA8; the drawing buffer is a fixed pixel
// budget (320x180 at the top of the ladder) in the canvas's aspect, and CSS scales it up.
import type { FrameStats, Scene, SceneOptions } from '../Scene';
import { BudgetLadder } from '../budget';
import { pullProgress } from '../camera';
import { FRAME_INTERVAL_MS, startFrameLoop } from '../frameLoop';
import { linkStage, ShaderCompileError } from '../link';
import { PALETTE } from '../palette';
import { Cell, ringRects, windowOrigin } from './ring';
import { voxelPose } from './rails';
import {
  firstStep,
  liveStrips,
  LOOKUPS_PER_STRIP,
  STEPS,
  VERTICES_PER_STRIP,
  VOXEL,
  voxelDefines,
} from './voxelWorld';

const SKY_W = 512;
const SKY_H = 128;
/** Measurement readback of fragment counts, every this many frames. */
const READBACK_EVERY = 8;
/** Median cadence above this, over a window, drops one level: the 30 fps cap with some grace. */
const SLOW_MS = FRAME_INTERVAL_MS * 1.2;

export interface ScaleLevel {
  /** Drawing-buffer side as a fraction of the default's: pixels = VOXEL.pixels * scale^2, in the canvas's aspect. */
  scale: number;
}

/** Cheapest last. The ladder only descends. */
export const SCALE_LEVELS: readonly ScaleLevel[] = [
  { scale: 1 },
  { scale: 0.8 },
  { scale: 0.64 },
  { scale: 0.5 },
];
const LOW_START_LEVEL = 1;

export function createVoxelScene(opts: SceneOptions): Scene | null {
  const { canvas } = opts;
  const tier = opts.tier ?? 'full';
  if (tier === 'off') return null;
  const measuring = !!opts.onTraceStats;
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    opts.onUnavailable?.('no-webgl2');
    return null;
  }

  // `counted` is the strip pass with each fragment writing one count; it exists only for a
  // measuring scene, which draws it blended to an offscreen target.
  type Name = 'height' | 'sky' | 'backdrop' | 'voxel' | 'counted';
  const programs = {} as Record<Name, WebGLProgram>;
  const sources: Array<[Name, 'voxelHeight' | 'voxelSky' | 'voxelBackdrop' | 'voxel', string]> = [
    ['height', 'voxelHeight', ''],
    ['sky', 'voxelSky', ''],
    ['backdrop', 'voxelBackdrop', ''],
    ['voxel', 'voxel', ''],
  ];
  if (measuring) sources.push(['counted', 'voxel', '#define TRACE_STATS 1\n']);
  try {
    sources.forEach(([name, stage, extra]) => {
      programs[name] = linkStage(gl, stage, opts.patchSource, voxelDefines() + extra);
    });
  } catch (e) {
    Object.values(programs).forEach((p) => gl.deleteProgram(p));
    if (!(e instanceof ShaderCompileError)) throw e;
    opts.onCompileFail?.(e);
    return null;
  }

  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const loc = (p: WebGLProgram, name: string) => {
    let m = uniforms.get(p);
    if (!m) uniforms.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, gl.getUniformLocation(p, name));
    return m.get(name) ?? null;
  };
  const vec3 = (p: WebGLProgram, name: string, v: readonly number[]) =>
    gl.uniform3fv(loc(p, name), v as number[]);
  const palette = (p: WebGLProgram) => {
    vec3(p, 'u_sunDir', PALETTE.sunDir);
    vec3(p, 'u_sunColor', PALETTE.sunColor);
    vec3(p, 'u_skyTop', PALETTE.skyTop);
    vec3(p, 'u_skyHorizon', PALETTE.skyHorizon);
    vec3(p, 'u_fogColor', PALETTE.fogColor);
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  const makeTexture = (w: number, h: number, format: number, filter: number, wrapS: number) => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const fboFor = (tex: WebGLTexture) => {
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  };

  // The sky is baked once: nothing in it moves.
  const skyTex = makeTexture(SKY_W, SKY_H, gl.RGBA8, gl.LINEAR, gl.REPEAT);
  {
    const fbo = fboFor(skyTex);
    gl.viewport(0, 0, SKY_W, SKY_H);
    gl.useProgram(programs.sky);
    palette(programs.sky);
    draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteProgram(programs.sky);
  }

  const ringTex = makeTexture(VOXEL.ring, VOXEL.ring, gl.RG8, gl.NEAREST, gl.REPEAT);
  const ringFbo = fboFor(ringTex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let ringCell: Cell | undefined;

  /** Fill the ring for a camera in `cell`: only the columns and rows it just admitted. */
  const generate = (cell: Cell) => {
    const rects = ringRects(ringCell, cell);
    ringCell = cell;
    if (!rects.length) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ringFbo);
    gl.viewport(0, 0, VOXEL.ring, VOXEL.ring);
    gl.useProgram(programs.height);
    const o = windowOrigin(cell);
    gl.uniform2i(loc(programs.height, 'u_origin'), o.x, o.z);
    gl.enable(gl.SCISSOR_TEST);
    for (const r of rects) {
      gl.scissor(r.x, r.y, r.w, r.h);
      draw();
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const still = tier === 'still';
  const ladder = new BudgetLadder<ScaleLevel>(
    SLOW_MS,
    45,
    tier === 'low' ? LOW_START_LEVEL : 0,
    SCALE_LEVELS
  );
  const scale = () => (opts.fixedLevel ? opts.fixedLevel.solidScale : ladder.current.scale);
  const FALLBACK_ASPECT = 16 / 9;

  let canvasW = 0;
  let canvasH = 0;
  let sizedFor = 0;
  const ensureSize = () => {
    const s = scale();
    const aspect =
      canvas.clientWidth > 0 && canvas.clientHeight > 0
        ? canvas.clientWidth / canvas.clientHeight
        : FALLBACK_ASPECT;
    const w = Math.max(2, Math.round(Math.sqrt(VOXEL.pixels * aspect) * s));
    const h = Math.max(2, Math.round(Math.sqrt(VOXEL.pixels / aspect) * s));
    if (w === canvasW && h === canvasH) return;
    canvasW = w;
    canvasH = h;
    sizedFor = s;
    canvas.width = w;
    canvas.height = h;
  };

  // The measuring scene's offscreen copy of the terrain pass, sized like the canvas.
  const counted: { tex?: WebGLTexture; fbo?: WebGLFramebuffer; w: number; h: number } = {
    w: 0,
    h: 0,
  };
  const resizeCounted = () => {
    if (counted.tex) gl.deleteTexture(counted.tex);
    if (counted.fbo) gl.deleteFramebuffer(counted.fbo);
    counted.tex = makeTexture(canvasW, canvasH, gl.RGBA8, gl.NEAREST, gl.CLAMP_TO_EDGE);
    counted.fbo = fboFor(counted.tex);
    counted.w = canvasW;
    counted.h = canvasH;
  };

  const start = performance.now();
  let loginAt: number | undefined;
  let frame = 0;
  let prevNow: number | undefined;
  const loop = startFrameLoop({
    canvas,
    still,
    unthrottled: opts.unthrottled,
    render,
    onContextLost: opts.onContextLost,
  });

  function render(now: number) {
    ensureSize();
    const frozen = loop.frozen;
    const time = opts.clock ? opts.clock() : frozen ? 0 : (now - start) / 1000;
    let elapsed: number | undefined;
    if (loginAt !== undefined) elapsed = frozen ? 1e9 : (now - loginAt) / 1000;
    const pose = voxelPose(opts.fixedPull ?? pullProgress(elapsed), time);
    const [px, py, pz] = pose.position;
    generate({ x: Math.floor(px / VOXEL.cell), z: Math.floor(pz / VOXEL.cell) });

    const tanY = Math.tan(pose.fov / 2);
    const tanX = tanY * (canvasW / canvasH);
    // The shear: the horizon sits above the centre by the amount the camera looks down.
    const horizon = -Math.tan(pose.pitch) / tanY;
    const first = firstStep(py, horizon, tanY);
    const strips = canvasW * (STEPS - first);
    const vertices = strips * VERTICES_PER_STRIP + 3;
    const lookups = liveStrips(canvasW, first, tanX) * LOOKUPS_PER_STRIP;

    const timed = measuring && frame % READBACK_EVERY === 0;
    const t0 = timed ? performance.now() : 0;
    const bindWorld = (p: WebGLProgram) => {
      gl.useProgram(p);
      palette(p);
      vec3(p, 'u_grass', PALETTE.grass);
      vec3(p, 'u_rock', PALETTE.rock);
      gl.uniform3f(loc(p, 'u_camPos'), px, py, pz);
      gl.uniform2f(loc(p, 'u_fwd'), Math.cos(pose.yaw), Math.sin(pose.yaw));
      gl.uniform2f(loc(p, 'u_right'), Math.sin(pose.yaw), -Math.cos(pose.yaw));
      gl.uniform2f(loc(p, 'u_tanHalf'), tanX, tanY);
      gl.uniform1f(loc(p, 'u_horizon'), horizon);
      gl.uniform1f(loc(p, 'u_frame'), frame);
      gl.uniform1i(loc(p, 'u_columns'), canvasW);
      gl.uniform1i(loc(p, 'u_firstStep'), first);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ringTex);
      gl.uniform1i(loc(p, 'u_height'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, skyTex);
      gl.uniform1i(loc(p, 'u_sky'), 1);
    };
    // Far to near, no depth test, no blending: the later strip is the nearer one and overwrites. One
    // plain draw: instancing multiplies per-draw cost by the instance count in software GL.
    const drawStrips = (p: WebGLProgram) => {
      bindWorld(p);
      gl.drawArrays(gl.TRIANGLES, 0, strips * VERTICES_PER_STRIP);
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    bindWorld(programs.backdrop);
    draw();
    drawStrips(programs.voxel);

    let renderMs: number | undefined;
    if (timed) {
      // One-texel synchronous read: it waits for the draw, so the time is the draw's, which a
      // queued GPU (SwiftShader and phones alike) would otherwise not report.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      renderMs = performance.now() - t0;
      // Then the strips again, off screen, each fragment adding one to red, and read back.
      if (counted.w !== canvasW || counted.h !== canvasH) resizeCounted();
      gl.bindFramebuffer(gl.FRAMEBUFFER, counted.fbo ?? null);
      gl.viewport(0, 0, canvasW, canvasH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      drawStrips(programs.counted);
      gl.disable(gl.BLEND);
      const px4 = new Uint8Array(canvasW * canvasH * 4);
      gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, px4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let sum = 0;
      for (let i = 0; i < px4.length; i += 4) sum += px4[i];
      const perPixel = lookups / (canvasW * canvasH);
      opts.onTraceStats?.({
        traceSteps: perPixel,
        prepassSteps: 0,
        stepsPerPixel: perPixel,
        overdraw: sum / (canvasW * canvasH),
      });
    }
    if (prevNow !== undefined) {
      const frameMs = now - prevNow;
      opts.onFrameStats?.({
        frameMs,
        renderMs,
        scale: sizedFor,
        size: [canvasW, canvasH],
        vertices,
        lookups,
      });
      if (!opts.fixedLevel && ladder.push(frameMs)) canvasW = 0; // resize on the next frame
    }
    prevNow = now;
    frame += 1;
  }

  return {
    login() {
      if (still || loop.disposed) return; // a still has no pull-back
      loginAt = performance.now();
      loop.restart();
    },
    dispose() {
      if (loop.disposed) return;
      loop.stop();
      gl.deleteTexture(ringTex);
      gl.deleteTexture(skyTex);
      gl.deleteFramebuffer(ringFbo);
      if (counted.tex) gl.deleteTexture(counted.tex);
      if (counted.fbo) gl.deleteFramebuffer(counted.fbo);
      if (measuring) gl.deleteProgram(programs.counted);
      gl.deleteProgram(programs.height);
      gl.deleteProgram(programs.backdrop);
      gl.deleteProgram(programs.voxel);
      gl.deleteVertexArray(vao);
    },
  };
}
