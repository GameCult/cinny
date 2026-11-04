import { fragmentSource, vertexSource, Stage } from './shaderSource';
import { cameraPose, pullProgress, CameraPose } from './camera';
import { BudgetLadder, Level, LEVELS } from './budget';
import { startFrameLoop } from './frameLoop';
import type { SceneTier } from './tier';
import { PALETTE } from './palette';

/** Phone GPU budget for the whole scene, from the ground-cut doc's budget table. */
export const GPU_BUDGET_MS = 4.0;
const MAX_DPR = 1.5;

export type PassName = 'terrain' | 'atmosphere' | 'resolve' | 'composite' | 'prepass';
const PASSES: PassName[] = ['terrain', 'atmosphere', 'resolve', 'composite', 'prepass'];
/** Pass 1 pixels per prepass tile edge. */
const TILE = 8;

export interface SceneStats {
  /** GPU milliseconds per pass for one finished frame (timer queries; absent without the extension). */
  passMs: Record<PassName, number>;
  level: number;
  solidSize: [number, number];
  atmosphereSize: [number, number];
}

/** Trace cost over one finished readback: mean distance evaluations per pass-1 pixel. */
export interface TraceStats {
  /** Mean pass-1 steps per pixel. */
  traceSteps: number;
  /** Mean prepass steps per tile; 0 without the prepass. */
  prepassSteps: number;
  /** traceSteps plus the prepass's steps spread over the pixels of each tile. */
  stepsPerPixel: number;
}

/** Measurement seam: the harness rewrites a stage's source to time a variant. Never set in the client. */
export type SourcePatch = (stage: Stage, source: string) => string;

export class ShaderCompileError extends Error {
  constructor(readonly stage: Stage | 'vertex', readonly log: string) {
    super(`${stage} shader failed to compile:\n${log}`);
  }
}

/**
 * Why createScene returned null for want of a device feature. Rendering to half floats needs
 * EXT_color_buffer_float or EXT_color_buffer_half_float; the prepass start target is RGBA32F with
 * the first and RGBA16F with only the second.
 */
export type SceneUnavailable = 'no-webgl2' | 'no-float-or-half-float-colour-buffer';

/**
 * The RGBA16F prepass start is written as `t * HALF_START_SCALE - HALF_START_BIAS`. A half rounds
 * to nearest with relative error at most 2^-11, so shaving 2^-10 of t leaves the stored value
 * below t, and the bias covers the absolute error where halves go subnormal. The shader reads both
 * through #defines, so this is the one copy.
 */
export const HALF_START_SCALE = 1 - 1 / 1024;
export const HALF_START_BIAS = 1 / 32768;
const HALF_START_DEFINES = `#define START_HALF 1\n#define START_HALF_SCALE ${HALF_START_SCALE}\n#define START_HALF_BIAS ${HALF_START_BIAS}\n`;

/** Ladder level a 'low' scene starts at: the cost of a weak device's first 45 frames is never paid at full. */
const LOW_START_LEVEL = 2;
/** The 'still' tier draws one frame at this level and stops. */
const STILL_LEVEL = LEVELS[0];

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /**
   * 'off' returns null without touching the canvas. 'still' draws one frame and stops. 'low' starts
   * the adaptive ladder low. 'full' starts it at the top. Default 'full'.
   */
  tier?: SceneTier;
  /** createScene is about to return null because the device lacks a feature, and which one. */
  onUnavailable?: (reason: SceneUnavailable) => void;
  /** Force the RGBA16F prepass start target even where RGBA32F is renderable (measurement, tests). */
  halfStart?: boolean;
  /** A shader failed to compile or link. createScene frees what it built and returns null. */
  onCompileFail?: (e: ShaderCompileError) => void;
  /** The WebGL context was lost. The scene stops for good; the host keeps its ground. */
  onContextLost?: () => void;
  /** Called per finished frame when timer queries exist. */
  onStats?: (s: SceneStats) => void;
  /**
   * Measurement: mean sphere-trace steps per pass-1 pixel, read back every few frames. Setting it
   * compiles pass 1 with a step-count output and an extra render target; unset, neither exists.
   */
  onTraceStats?: (s: TraceStats) => void;
  /** Weather knob, 0 clear .. 1 overcast. */
  coverage?: number;
  /** Fixed level instead of the adaptive ladder (measurement). */
  fixedLevel?: Level;
  /** Cone prepass that starts pass-1 rays past empty space. Default true; false is the measurement baseline. */
  prepass?: boolean;
  /** Hold the camera at this pull-back progress, 0..1, instead of following login (measurement). */
  fixedPull?: number;
  /** Ignore the 30 fps cap and the visibility pause (measurement). */
  unthrottled?: boolean;
  patchSource?: SourcePatch;
}

export interface Scene {
  /** Texture format of the prepass start target. */
  readonly startFormat: 'RGBA32F' | 'RGBA16F';
  /** Start the camera pull-back from the tree. */
  login(): void;
  dispose(): void;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  stage: Stage | 'vertex'
): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new ShaderCompileError(stage, log);
  }
  return sh;
}

export function linkStage(
  gl: WebGL2RenderingContext,
  stage: Stage,
  patch?: SourcePatch,
  defines?: string
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, 'vertex');
  const fs = compile(
    gl,
    gl.FRAGMENT_SHADER,
    patch ? patch(stage, fragmentSource(stage, defines)) : fragmentSource(stage, defines),
    stage
  );
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog);
    throw new ShaderCompileError(stage, log);
  }
  return prog;
}

interface Target {
  tex: WebGLTexture;
  w: number;
  h: number;
}

function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= base;
    r += f * (n % base);
    n = Math.floor(n / base);
  }
  return r;
}

/** Null when WebGL2 or a float colour buffer is missing (`onUnavailable` says which); the host keeps its CSS ground. */
export function createScene(opts: SceneOptions): Scene | null {
  const { canvas } = opts;
  const tier = opts.tier ?? 'full';
  if (tier === 'off') return null;
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    opts.onUnavailable?.('no-webgl2');
    return null;
  }
  const wide = !!gl.getExtension('EXT_color_buffer_float');
  if (!wide && !gl.getExtension('EXT_color_buffer_half_float')) {
    opts.onUnavailable?.('no-float-or-half-float-colour-buffer');
    return null;
  }
  // Every other target is a half; only the prepass start can ask for 32 bits.
  const halfStart = opts.halfStart || !wide;
  gl.getExtension('OES_texture_float_linear');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;

  const usePrepass = opts.prepass ?? true;
  const passes = usePrepass ? PASSES : PASSES.filter((p) => p !== 'prepass');
  const programs = {} as Record<PassName, WebGLProgram>;
  try {
    passes.forEach((p) => {
      const defines =
        p === 'terrain' && opts.onTraceStats
          ? '#define TRACE_STATS 1\n'
          : p === 'prepass' && halfStart
          ? HALF_START_DEFINES
          : undefined;
      programs[p] = linkStage(gl, p, opts.patchSource, defines);
    });
  } catch (e) {
    passes.forEach((p) => {
      if (programs[p]) gl.deleteProgram(programs[p]);
    });
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

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const startFormat = halfStart ? gl.RGBA16F : gl.RGBA32F;

  const makeTarget = (w: number, h: number, format: number, filter: number): Target => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w, h };
  };

  const fbos = {
    solid: gl.createFramebuffer()!,
    pre: gl.createFramebuffer()!,
    atm: gl.createFramebuffer()!,
    hist: [gl.createFramebuffer()!, gl.createFramebuffer()!],
  };
  let solid: Target;
  let depth: Target;
  let steps: Target | undefined;
  let startTex: Target;
  let atm: Target;
  let hist: [Target, Target];
  const freeTargets = () => {
    [solid, depth, steps, startTex, atm, hist?.[0], hist?.[1]].forEach((t) => {
      if (t) gl.deleteTexture(t.tex);
    });
  };

  const attach = (fbo: WebGLFramebuffer, targets: Target[]) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    targets.forEach((t, i) =>
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.tex, 0)
    );
    gl.drawBuffers(targets.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  };

  const still = tier === 'still';
  const ladder = new BudgetLadder(GPU_BUDGET_MS, 45, tier === 'low' ? LOW_START_LEVEL : 0);
  const level = (): Level => opts.fixedLevel ?? (still ? STILL_LEVEL : ladder.current);

  // Trace-step readback: one pixel-pack read in flight at a time, polled by fence, never waited on.
  // Pass 1's step bytes and the prepass's RGBA floats (g: steps) come back together.
  const READBACK_EVERY = 8;
  interface Readback {
    fence: WebGLSync;
    pixels: number;
    tiles: number;
  }
  let readback: Readback | undefined;
  const packSteps = opts.onTraceStats ? gl.createBuffer() : null;
  const packStart = opts.onTraceStats && usePrepass ? gl.createBuffer() : null;
  const discardReadback = () => {
    if (readback) gl.deleteSync(readback.fence);
    readback = undefined;
  };
  const startReadback = () => {
    if (!steps || readback) return;
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1); // R8 rows are not 4-byte multiples at every width
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packSteps);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, steps.w * steps.h, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.solid);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + 2);
    gl.readPixels(0, 0, steps.w, steps.h, gl.RED, gl.UNSIGNED_BYTE, 0);
    let tiles = 0;
    if (packStart) {
      tiles = startTex.w * startTex.h;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packStart);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, tiles * 16, gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.pre);
      gl.readPixels(0, 0, startTex.w, startTex.h, gl.RGBA, gl.FLOAT, 0);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    readback = {
      fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!,
      pixels: steps.w * steps.h,
      tiles,
    };
  };
  const pollReadback = () => {
    if (!readback) return;
    const status = gl.clientWaitSync(readback.fence, 0, 0);
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return;
    const { pixels, tiles } = readback;
    const bytes = new Uint8Array(pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packSteps);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
    let preSum = 0;
    if (packStart) {
      const floats = new Float32Array(tiles * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packStart);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, floats);
      for (let i = 1; i < floats.length; i += 4) preSum += floats[i];
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 1) sum += bytes[i];
    discardReadback();
    const traceSteps = sum / pixels;
    const prepassSteps = tiles ? preSum / tiles : 0;
    opts.onTraceStats?.({
      traceSteps,
      prepassSteps,
      stepsPerPixel: traceSteps + (prepassSteps * tiles) / pixels,
    });
  };

  let canvasW = 0;
  let canvasH = 0;
  let sizedFor: Level | undefined;
  let resetHistory = true;

  const ensureSize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    const lv = level();
    if (w === canvasW && h === canvasH && lv === sizedFor) return;
    canvasW = w;
    canvasH = h;
    sizedFor = lv;
    canvas.width = w;
    canvas.height = h;
    freeTargets();
    const sw = Math.max(2, Math.round(w * lv.solidScale));
    const sh = Math.max(2, Math.round(h * lv.solidScale));
    const aw = Math.max(2, Math.round(w * lv.atmosphereScale));
    const ah = Math.max(2, Math.round(h * lv.atmosphereScale));
    solid = makeTarget(sw, sh, gl.RGBA16F, gl.LINEAR);
    depth = makeTarget(sw, sh, gl.R16F, gl.NEAREST);
    // Without the prepass pass 1 reads a 1x1 zero start: every ray from the camera, as before.
    startTex = usePrepass
      ? makeTarget(Math.ceil(sw / TILE), Math.ceil(sh / TILE), startFormat, gl.NEAREST)
      : makeTarget(1, 1, startFormat, gl.NEAREST);
    steps = opts.onTraceStats ? makeTarget(sw, sh, gl.R8, gl.NEAREST) : undefined;
    atm = makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR);
    hist = [makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR), makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR)];
    attach(fbos.solid, steps ? [solid, depth, steps] : [solid, depth]);
    discardReadback();
    attach(fbos.pre, [startTex]);
    attach(fbos.atm, [atm]);
    attach(fbos.hist[0], [hist[0]]);
    attach(fbos.hist[1], [hist[1]]);
    resetHistory = true;
  };

  const start = performance.now();
  let loginAt: number | undefined;
  let frame = 0;
  let histIndex = 0;
  let prev: CameraPose | undefined;

  // Timer queries in flight: each holds one pass's query.
  const pending: Array<{ q: WebGLQuery; pass: PassName; frame: number }> = [];
  const finished = new Map<number, Partial<Record<PassName, number>>>();

  const timed = (pass: PassName, f: number, body: () => void) => {
    if (!timer || !opts.onStats) {
      body();
      return;
    }
    const q = gl.createQuery()!;
    gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    body();
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    pending.push({ q, pass, frame: f });
  };

  const collect = () => {
    if (!timer) return;
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, pass, frame: f } = pending.shift()!;
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      const row = finished.get(f) ?? {};
      if (!disjoint) row[pass] = ns / 1e6;
      finished.set(f, row);
      if (Object.keys(row).length === passes.length) {
        finished.delete(f);
        const passMs = { prepass: 0, ...row } as Record<PassName, number>;
        const total = passes.reduce((s, p) => s + passMs[p], 0);
        if (!opts.fixedLevel && ladder.push(total)) sizedFor = undefined;
        opts.onStats?.({
          passMs,
          level: ladder.index,
          solidSize: [solid.w, solid.h],
          atmosphereSize: [atm.w, atm.h],
        });
      }
    }
  };

  const setCommon = (p: WebGLProgram, pose: CameraPose, time: number) => {
    const aspect = canvasW / canvasH;
    const th = Math.tan(pose.fov / 2);
    gl.uniform3fv(loc(p, 'u_camPos'), pose.position as unknown as number[]);
    gl.uniformMatrix3fv(loc(p, 'u_camBasis'), false, pose.basis as unknown as number[]);
    gl.uniform2f(loc(p, 'u_tanHalf'), th * aspect, th);
    gl.uniform1f(loc(p, 'u_time'), time);
    gl.uniform3fv(loc(p, 'u_sunDir'), PALETTE.sunDir as unknown as number[]);
    gl.uniform3fv(loc(p, 'u_sunColor'), PALETTE.sunColor as unknown as number[]);
    gl.uniform3fv(loc(p, 'u_skyTop'), PALETTE.skyTop as unknown as number[]);
    gl.uniform3fv(loc(p, 'u_skyHorizon'), PALETTE.skyHorizon as unknown as number[]);
    gl.uniform3fv(loc(p, 'u_fogColor'), PALETTE.fogColor as unknown as number[]);
  };

  const bindTex = (unit: number, t: Target, p: WebGLProgram, name: string) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(loc(p, name), unit);
  };

  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  const render = (now: number) => {
    ensureSize();
    const lv = level();
    const frozen = loop.frozen;
    const time = frozen ? 0 : (now - start) / 1000;
    let elapsed: number | undefined;
    if (loginAt !== undefined) elapsed = frozen ? 1e9 : (now - loginAt) / 1000;
    const pose = cameraPose(opts.fixedPull ?? pullProgress(elapsed), time);
    const f = frame;
    frame += 1;
    const jx = halton((f % 16) + 1, 2) - 0.5;
    const jy = halton((f % 16) + 1, 3) - 0.5;

    // Pass 0: cone march at one ray per 8x8 tile of pass 1, the start distance for its rays.
    if (usePrepass) {
      timed('prepass', f, () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.pre);
        gl.viewport(0, 0, startTex.w, startTex.h);
        const p = programs.prepass;
        gl.useProgram(p);
        setCommon(p, pose, time);
        gl.uniform1i(loc(p, 'u_maxSteps'), lv.traceSteps);
        gl.uniform2f(loc(p, 'u_tileHalf'), 0.5 / startTex.w, 0.5 / startTex.h);
        draw();
      });
    }

    // Pass 1: solid surfaces, writes colour and depth.
    timed('terrain', f, () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.solid);
      gl.viewport(0, 0, solid.w, solid.h);
      const p = programs.terrain;
      gl.useProgram(p);
      setCommon(p, pose, time);
      gl.uniform3fv(loc(p, 'u_grass'), PALETTE.grass as unknown as number[]);
      gl.uniform3fv(loc(p, 'u_rock'), PALETTE.rock as unknown as number[]);
      gl.uniform3fv(loc(p, 'u_bark'), PALETTE.bark as unknown as number[]);
      gl.uniform3fv(loc(p, 'u_leaf'), PALETTE.leaf as unknown as number[]);
      gl.uniform1i(loc(p, 'u_maxSteps'), lv.traceSteps);
      bindTex(0, startTex, p, 'u_start');
      draw();
    });
    if (f % READBACK_EVERY === 0) startReadback(); // outside the timed span: not pass 1's cost

    // Pass 2: atmosphere up to pass 1's depth, low-res.
    timed('atmosphere', f, () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.atm);
      gl.viewport(0, 0, atm.w, atm.h);
      const p = programs.atmosphere;
      gl.useProgram(p);
      setCommon(p, pose, time);
      bindTex(0, depth, p, 'u_depth');
      gl.uniform1i(loc(p, 'u_steps'), lv.cloudSteps);
      gl.uniform1f(loc(p, 'u_frame'), f);
      gl.uniform2f(loc(p, 'u_jitter'), jx, jy);
      gl.uniform2f(loc(p, 'u_size'), atm.w, atm.h);
      gl.uniform1f(loc(p, 'u_coverage'), opts.coverage ?? 0.45);
      draw();
    });

    // TAA resolve into the history that is not being read.
    const write = histIndex === 0 ? 1 : 0;
    timed('resolve', f, () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos.hist[write]);
      gl.viewport(0, 0, atm.w, atm.h);
      const p = programs.resolve;
      gl.useProgram(p);
      setCommon(p, pose, time);
      bindTex(0, atm, p, 'u_cur');
      bindTex(1, hist[histIndex], p, 'u_history');
      bindTex(2, depth, p, 'u_depth');
      const pp = prev ?? pose;
      const th = Math.tan(pp.fov / 2);
      gl.uniform3fv(loc(p, 'u_prevPos'), pp.position as unknown as number[]);
      gl.uniformMatrix3fv(loc(p, 'u_prevBasis'), false, pp.basis as unknown as number[]);
      gl.uniform2f(loc(p, 'u_prevTanHalf'), th * (canvasW / canvasH), th);
      gl.uniform1f(loc(p, 'u_blend'), resetHistory ? 1 : 0.125);
      gl.uniform2f(loc(p, 'u_curSize'), atm.w, atm.h);
      draw();
    });

    // Full-resolution composite to the canvas.
    timed('composite', f, () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvasW, canvasH);
      const p = programs.composite;
      gl.useProgram(p);
      setCommon(p, pose, time);
      bindTex(0, solid, p, 'u_solid');
      bindTex(1, hist[write], p, 'u_atm');
      gl.uniform1f(loc(p, 'u_frame'), f);
      draw();
    });

    histIndex = write;
    prev = pose;
    resetHistory = false;
    collect();
    pollReadback();
  };

  const loop = startFrameLoop({
    canvas,
    still,
    unthrottled: opts.unthrottled,
    render,
    onSlow: () => {
      // no timer: a missed cap counts as over budget
      if (!opts.fixedLevel && !timer && ladder.push(GPU_BUDGET_MS * 2)) sizedFor = undefined;
    },
    onResume: () => {
      resetHistory = true; // the first frame after a pause has a real elapsed dt
    },
    onContextLost: opts.onContextLost,
  });

  return {
    startFormat: halfStart ? 'RGBA16F' : 'RGBA32F',
    login() {
      if (still || loop.disposed) return; // a still has no pull-back
      loginAt = performance.now();
      loop.restart();
    },
    dispose() {
      if (loop.disposed) return;
      loop.stop();
      freeTargets();
      passes.forEach((p) => gl.deleteProgram(programs[p]));
      discardReadback();
      [packSteps, packStart].forEach((b) => b && gl.deleteBuffer(b));
      gl.deleteVertexArray(vao);
      [fbos.solid, fbos.pre, fbos.atm, ...fbos.hist].forEach((fb) => gl.deleteFramebuffer(fb));
    },
  };
}
