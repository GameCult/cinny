// The voxel terrain scene: a wrapping ring of cell heights around the camera, drawn by one fullscreen
// pass. Same createScene contract as the ray-march scene, but WebGL2 core only: no extensions, no
// float targets. Heights are 16 bits in an RG8 ring; the sky is baked once into RGBA8; the drawing
// buffer is the internal resolution, and CSS scales it up.
import type { FrameStats, Scene, SceneOptions } from '../Scene';
import { BudgetLadder } from '../budget';
import { pullProgress } from '../camera';
import { FRAME_INTERVAL_MS, startFrameLoop } from '../frameLoop';
import { linkStage, ShaderCompileError } from '../link';
import { PALETTE } from '../palette';
import { Cell, ringRects, windowOrigin } from './ring';
import { voxelPose } from './rails';
import { VOXEL, voxelDefines } from './voxelWorld';

const MAX_DPR = 1.5;
const SKY_W = 512;
const SKY_H = 128;
/** Measurement readback of lookups per pixel, every this many frames. */
const READBACK_EVERY = 8;
/** Median cadence above this, over a window, drops one level: the 30 fps cap with some grace. */
const SLOW_MS = FRAME_INTERVAL_MS * 1.2;

export interface ScaleLevel {
  /** Drawing-buffer size as a fraction of the canvas's CSS size times device pixel ratio. */
  scale: number;
}

/** Cheapest last. The ladder only descends. */
export const SCALE_LEVELS: readonly ScaleLevel[] = [
  { scale: 0.75 },
  { scale: 0.6 },
  { scale: 0.5 },
  { scale: 0.4 },
];
const LOW_START_LEVEL = 2;

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

  // `counted` is the terrain pass with its lookup count written to alpha; it exists only for a
  // measuring scene, which draws it to an offscreen target (the canvas has no alpha to spare).
  type Name = 'height' | 'sky' | 'voxel' | 'counted';
  const programs = {} as Record<Name, WebGLProgram>;
  const sources: Array<[Name, 'voxelHeight' | 'voxelSky' | 'voxel', string]> = [
    ['height', 'voxelHeight', ''],
    ['sky', 'voxelSky', ''],
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

  let canvasW = 0;
  let canvasH = 0;
  let sizedFor = 0;
  const ensureSize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const s = scale();
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr * s));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr * s));
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

    const timed = measuring && frame % READBACK_EVERY === 0;
    const t0 = timed ? performance.now() : 0;
    const drawTerrain = (p: WebGLProgram) => {
      gl.viewport(0, 0, canvasW, canvasH);
      gl.useProgram(p);
      palette(p);
      vec3(p, 'u_grass', PALETTE.grass);
      vec3(p, 'u_rock', PALETTE.rock);
      gl.uniform3f(loc(p, 'u_camPos'), px, py, pz);
      gl.uniform2f(loc(p, 'u_fwd'), Math.cos(pose.yaw), Math.sin(pose.yaw));
      gl.uniform2f(loc(p, 'u_right'), Math.sin(pose.yaw), -Math.cos(pose.yaw));
      const tanY = Math.tan(pose.fov / 2);
      gl.uniform2f(loc(p, 'u_tanHalf'), tanY * (canvasW / canvasH), tanY);
      // The shear: the horizon sits above the centre by the amount the camera looks down.
      gl.uniform1f(loc(p, 'u_horizon'), -Math.tan(pose.pitch) / tanY);
      gl.uniform1f(loc(p, 'u_frame'), frame);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ringTex);
      gl.uniform1i(loc(p, 'u_height'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, skyTex);
      gl.uniform1i(loc(p, 'u_sky'), 1);
      draw();
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    drawTerrain(programs.voxel);

    let renderMs: number | undefined;
    if (timed) {
      // One-texel synchronous read: it waits for the draw, so the time is the draw's, which a
      // queued GPU (SwiftShader and phones alike) would otherwise not report.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      renderMs = performance.now() - t0;
      // Then the same frame again with its lookup counts in alpha, off screen, and read back.
      if (counted.w !== canvasW || counted.h !== canvasH) resizeCounted();
      gl.bindFramebuffer(gl.FRAMEBUFFER, counted.fbo);
      drawTerrain(programs.counted);
      const px4 = new Uint8Array(canvasW * canvasH * 4);
      gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, px4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let sum = 0;
      for (let i = 3; i < px4.length; i += 4) sum += px4[i];
      const mean = sum / (canvasW * canvasH);
      opts.onTraceStats?.({ traceSteps: mean, prepassSteps: 0, stepsPerPixel: mean });
    }
    if (prevNow !== undefined) {
      const frameMs = now - prevNow;
      opts.onFrameStats?.({ frameMs, renderMs, scale: sizedFor, size: [canvasW, canvasH] });
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
      gl.deleteProgram(programs.voxel);
      gl.deleteVertexArray(vao);
    },
  };
}
