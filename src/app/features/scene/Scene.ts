import { fragmentSource, vertexSource, Stage } from './shaderSource';
import { cameraPose, pullProgress, CameraPose } from './camera';
import { BudgetLadder, Level, LEVELS } from './budget';
import type { SceneTier } from './tier';
import { PALETTE } from './palette';

/** Phone GPU budget for the whole scene, from the ground-cut doc's budget table. */
export const GPU_BUDGET_MS = 4.0;
const FRAME_INTERVAL_MS = 1000 / 30;
const REDUCED_MOTION_FRAMES = 32;
const MAX_DPR = 1.5;

export type PassName = 'terrain' | 'atmosphere' | 'resolve' | 'composite';
const PASSES: PassName[] = ['terrain', 'atmosphere', 'resolve', 'composite'];

export interface SceneStats {
  /** GPU milliseconds per pass for one finished frame (timer queries; absent without the extension). */
  passMs: Record<PassName, number>;
  level: number;
  solidSize: [number, number];
  atmosphereSize: [number, number];
}

/** Measurement seam: the harness rewrites a stage's source to time a variant. Never set in the client. */
export type SourcePatch = (stage: Stage, source: string) => string;

export class ShaderCompileError extends Error {
  constructor(readonly stage: Stage | 'vertex', readonly log: string) {
    super(`${stage} shader failed to compile:\n${log}`);
  }
}

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
  /** A shader failed to compile or link. createScene frees what it built and returns null. */
  onCompileFail?: (e: ShaderCompileError) => void;
  /** The WebGL context was lost. The scene stops for good; the host keeps its ground. */
  onContextLost?: () => void;
  /** Called per finished frame when timer queries exist. */
  onStats?: (s: SceneStats) => void;
  /** Weather knob, 0 clear .. 1 overcast. */
  coverage?: number;
  /** Fixed level instead of the adaptive ladder (measurement). */
  fixedLevel?: Level;
  /** Ignore the 30 fps cap and the visibility pause (measurement). */
  unthrottled?: boolean;
  patchSource?: SourcePatch;
}

export interface Scene {
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
  patch?: SourcePatch
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, 'vertex');
  const fs = compile(
    gl,
    gl.FRAGMENT_SHADER,
    patch ? patch(stage, fragmentSource(stage)) : fragmentSource(stage),
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

/** Null when WebGL2 or float colour buffers are missing; the host keeps its CSS ground. */
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
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  gl.getExtension('OES_texture_float_linear');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;

  const programs = {} as Record<PassName, WebGLProgram>;
  try {
    PASSES.forEach((p) => {
      programs[p] = linkStage(gl, p, opts.patchSource);
    });
  } catch (e) {
    PASSES.forEach((p) => {
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
    atm: gl.createFramebuffer()!,
    hist: [gl.createFramebuffer()!, gl.createFramebuffer()!],
  };
  let solid: Target;
  let depth: Target;
  let atm: Target;
  let hist: [Target, Target];
  const freeTargets = () => {
    [solid, depth, atm, hist?.[0], hist?.[1]].forEach((t) => {
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
    atm = makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR);
    hist = [makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR), makeTarget(aw, ah, gl.RGBA16F, gl.LINEAR)];
    attach(fbos.solid, [solid, depth]);
    attach(fbos.atm, [atm]);
    attach(fbos.hist[0], [hist[0]]);
    attach(fbos.hist[1], [hist[1]]);
    resetHistory = true;
  };

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  let loginAt: number | undefined;
  let frame = 0;
  let histIndex = 0;
  let prev: CameraPose | undefined;
  let raf = 0;
  let lastRendered = -Infinity;
  let framesLeft = still ? 1 : Infinity; // a still frame, or reduced motion, bounds this
  let disposed = false;

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
      if (Object.keys(row).length === PASSES.length) {
        finished.delete(f);
        const passMs = row as Record<PassName, number>;
        const total = PASSES.reduce((s, p) => s + passMs[p], 0);
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
    const frozen = reducedMotion?.matches ?? false;
    const time = frozen ? 0 : (now - start) / 1000;
    let elapsed: number | undefined;
    if (loginAt !== undefined) elapsed = frozen ? 1e9 : (now - loginAt) / 1000;
    const pose = cameraPose(pullProgress(elapsed), time);
    const f = frame;
    frame += 1;
    const jx = halton((f % 16) + 1, 2) - 0.5;
    const jy = halton((f % 16) + 1, 3) - 0.5;

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
      draw();
    });

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
  };

  const tick = (now: number) => {
    raf = 0;
    if (disposed) return;
    const due = opts.unthrottled || now - lastRendered >= FRAME_INTERVAL_MS - 2;
    if (due) {
      if (
        !opts.fixedLevel &&
        !timer &&
        lastRendered > 0 &&
        now - lastRendered > FRAME_INTERVAL_MS * 1.5
      ) {
        // no timer: a missed cap counts as over budget
        if (ladder.push(GPU_BUDGET_MS * 2)) sizedFor = undefined;
      }
      lastRendered = now;
      render(now);
      framesLeft -= 1;
    }
    if (framesLeft > 0 && (opts.unthrottled || document.visibilityState === 'visible'))
      raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (disposed || raf) return;
    if (reducedMotion?.matches && framesLeft <= 0) return;
    resetHistory = true; // the first frame after a pause has a real elapsed dt
    raf = requestAnimationFrame(tick);
  };
  const undo: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: (e: Event) => void) => {
    target.addEventListener(type, handler);
    undo.push(() => target.removeEventListener(type, handler));
  };
  const stop = () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    undo.forEach((f) => f());
  };
  if (!opts.unthrottled) {
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
  }
  listen(window, 'resize', () => wake());
  // A lost context takes every texture and program with it and nothing here rebuilds them, so the
  // scene ends and the host decides what to show. preventDefault: otherwise the browser never
  // restores the context, which is what we want, and a restore would find a dead scene.
  listen(canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    opts.onContextLost?.();
  });
  if (reducedMotion?.matches && !still) framesLeft = REDUCED_MOTION_FRAMES;
  // The preference can flip while the scene lives: freeze to a bounded run, or thaw to a free one.
  if (reducedMotion && !still) {
    listen(reducedMotion, 'change', () => {
      framesLeft = reducedMotion.matches ? REDUCED_MOTION_FRAMES : Infinity;
      wake();
    });
  }
  wake();

  return {
    login() {
      if (still || disposed) return; // a still has no pull-back
      loginAt = performance.now();
      if (reducedMotion?.matches) framesLeft = REDUCED_MOTION_FRAMES;
      wake();
    },
    dispose() {
      if (disposed) return;
      stop();
      freeTargets();
      PASSES.forEach((p) => gl.deleteProgram(programs[p]));
      gl.deleteVertexArray(vao);
      [fbos.solid, fbos.atm, ...fbos.hist].forEach((fb) => gl.deleteFramebuffer(fb));
    },
  };
}
