import type { Scene, SceneOptions } from '../Scene';
import { FrameSampler, FrameStats } from '../ridge/probe';
import { skyColours } from '../ridge/skyColour';
import { SkyName } from './skyData';
import {
  ambientColour,
  hazeColour,
  HAZE_K,
  hexToLinear,
  isSkyName,
  skyData,
  skyNameFor,
  sunColour,
  sunDirection,
} from './terrainSky';
import { buildGrid, CAMERA, GRID, seedOffset, TERRAIN, triangleCount, view } from './terrainWorld';
import {
  FULLSCREEN_VERT,
  GRID_FRAG,
  GRID_VERT,
  heightFragmentSource,
  SKY_FRAG,
} from './terrainShaders';

export type TerrainOptions = Pick<
  SceneOptions,
  'canvas' | 'tier' | 'onCompileFail' | 'onContextLost'
> & {
  /** Which baked sky lights and hazes the terrain. Default: `?sky=` in the page URL, else the night notion of `skyColours()`. */
  sky?: SkyName;
  /** Terrain seed: the height map is sampled at an offset taken from it. Default 0. */
  seed?: number;
  /** Show the rAF median/p95 readout (plus triangle count). Default: the page URL has `?probe=1`. */
  probe?: boolean;
  onProbe?: (s: FrameStats & { still: boolean; triangles: number }) => void;
};

/** Same shape as Scene.ts's ShaderCompileError, redeclared so this chunk does not import the ray-march scene. */
class ShaderCompileError extends Error {
  constructor(readonly stage: 'vertex', readonly log: string) {
    super(`${stage} shader failed to compile:\n${log}`);
  }
}

function program(gl: WebGL2RenderingContext, name: string, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string, which: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? '';
      gl.deleteShader(s);
      throw new ShaderCompileError('vertex', `terrain ${name} ${which} shader: ${log}`);
    }
    return s;
  };
  const v = make(gl.VERTEX_SHADER, vs, 'vertex');
  const f = make(gl.FRAGMENT_SHADER, fs, 'fragment');
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '';
    gl.deleteProgram(p);
    throw new ShaderCompileError('vertex', `terrain ${name} link: ${log}`);
  }
  return p;
}

/** The sky to use: the option, then `?sky=midnight|noonday`, then the night notion of `skyColours()`. */
function chooseSky(opt: SkyName | undefined): SkyName {
  if (opt) return opt;
  const q = new URLSearchParams(window.location.search).get('sky');
  return isSkyName(q) ? q : skyNameFor(skyColours());
}

/**
 * The terrain scene: same contract as `createRidgeScene`/`createScene` ({ login, dispose }, null for "keep the
 * CSS ground"). WebGL2 only. The height map is baked once on the GPU (Phacelle, see terrainShaders.ts) into an
 * RGBA8 texture; each frame is two draws: the baked gradient sky, then a displaced grid lit by the baked sun and
 * ambient and hazed toward the baked horizon colour. Cadence guard, pauses and the `?probe=1` readout match the
 * ridge scene.
 */
export function createTerrainScene(opts: TerrainOptions): Scene | null {
  const tier = opts.tier ?? 'full';
  if (tier === 'off') return null;
  const { canvas } = opts;
  const probe = opts.probe ?? new URLSearchParams(window.location.search).get('probe') === '1';
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const units = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
  if (typeof units === 'number' && units < 1) return null;

  const sky = skyData(chooseSky(opts.sky));
  const spec = GRID[tier];

  let skyProg: WebGLProgram;
  let gridProg: WebGLProgram;
  let bakeProg: WebGLProgram;
  try {
    bakeProg = program(gl, 'height', FULLSCREEN_VERT, heightFragmentSource());
    skyProg = program(gl, 'sky', FULLSCREEN_VERT, SKY_FRAG);
    gridProg = program(gl, 'grid', GRID_VERT, GRID_FRAG);
  } catch (e) {
    opts.onCompileFail?.(e as ShaderCompileError);
    return null;
  }

  // The height map, baked once.
  const heightTex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, spec.tex, spec.tex, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, heightTex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  const free: Array<() => void> = [];
  const release = () => {
    free.forEach((f) => f());
    gl.deleteTexture(heightTex);
    gl.deleteFramebuffer(fbo);
    gl.deleteProgram(bakeProg);
    gl.deleteProgram(skyProg);
    gl.deleteProgram(gridProg);
  };
  if (!complete) {
    release();
    return null;
  }
  gl.viewport(0, 0, spec.tex, spec.tex);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(bakeProg);
  gl.uniform1f(gl.getUniformLocation(bakeProg, 'uSpan'), TERRAIN.span);
  gl.uniform1f(gl.getUniformLocation(bakeProg, 'uTexels'), spec.tex);
  gl.uniform2fv(gl.getUniformLocation(bakeProg, 'uSeed'), seedOffset(opts.seed ?? 0));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // The displaced grid.
  const g = buildGrid(spec.grid);
  const vao = gl.createVertexArray();
  const vbuf = gl.createBuffer();
  const ibuf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, g.uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  free.push(
    () => gl.deleteVertexArray(vao),
    () => gl.deleteBuffer(vbuf),
    () => gl.deleteBuffer(ibuf)
  );

  const gradient = new Float32Array(sky.gradient.flatMap((h) => [...hexToLinear(h)]));
  const sun = [...sunDirection(sky)];
  const sunLight = [...sunColour(sky)];
  const ambient = [...ambientColour(sky)];
  const haze = [...hazeColour(sky)];
  const triangles = triangleCount(spec.grid);

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const sampler = new FrameSampler();
  let still = tier === 'still';
  let disposed = false;
  let lost = false;
  let raf = 0;
  let readout: HTMLElement | undefined;
  let resizeTimer = 0;
  let turnsAtPause = 0;
  let playedFrom: number | undefined;

  /** Size the canvas: low renders at 0.75 of the CSS size; full at device pixel ratio capped to 2. */
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (tier === 'low' ? 0.75 : 1);
    canvas.width = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * dpr));
    canvas.height = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * dpr));
  };

  const draw = (turns: number) => {
    if (lost) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const v = view(canvas.width / canvas.height, turns % 1);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProg);
    const us = (n: string) => gl.getUniformLocation(skyProg, n);
    gl.uniform3fv(us('uGrad'), gradient);
    gl.uniform3fv(us('uRight'), v.right);
    gl.uniform3fv(us('uUp'), v.up);
    gl.uniform3fv(us('uForward'), v.forward);
    gl.uniform2f(us('uSize'), canvas.width, canvas.height);
    gl.uniform1f(us('uTanHalf'), Math.tan(CAMERA.fov / 2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(gridProg);
    const u = (n: string) => gl.getUniformLocation(gridProg, n);
    gl.uniformMatrix4fv(u('uViewProj'), false, v.viewProj);
    gl.uniform3fv(u('uCamera'), v.eye);
    gl.uniform1f(u('uSpan'), TERRAIN.span);
    gl.uniform1i(u('uTex'), spec.tex);
    gl.uniform3fv(u('uSun'), sun);
    gl.uniform3fv(u('uSunColour'), sunLight);
    gl.uniform3fv(u('uAmbient'), ambient);
    gl.uniform3fv(u('uHaze'), haze);
    gl.uniform1f(u('uHazeK'), HAZE_K);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.uniform1i(u('uHeight'), 0);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, g.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  };

  const moving = () =>
    !still &&
    !disposed &&
    !lost &&
    !(reducedMotion?.matches ?? false) &&
    document.visibilityState === 'visible';

  const turnsNow = (now: number) =>
    turnsAtPause + (playedFrom === undefined ? 0 : (now - playedFrom) / (CAMERA.seconds * 1000));

  const report = (stillNow: boolean) => {
    const s = { ...sampler.stats(), still: stillNow, triangles };
    opts.onProbe?.(s);
    if (readout) {
      readout.textContent = `terrain · ${s.triangles} tris · n ${s.n} · median ${s.medianMs.toFixed(
        1
      )} ms · p95 ${s.p95Ms.toFixed(1)} ms${stillNow ? ' · STILL' : ''}`;
    }
  };

  const settleToStill = () => {
    if (playedFrom !== undefined) turnsAtPause = turnsNow(performance.now());
    playedFrom = undefined;
    still = true;
    cancelAnimationFrame(raf);
    raf = 0;
    draw(turnsAtPause);
    report(true);
  };

  let sinceReport = 0;
  // The first window is measured (guard against a slow device); after it the loop only draws.
  let measuring = true;
  const frame = (now: number) => {
    raf = 0;
    if (!moving()) return;
    draw(turnsNow(now));
    if (!measuring) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const full = sampler.push(now);
    if (full) {
      measuring = false;
      if (sampler.slow()) {
        settleToStill();
        return;
      }
      if (probe) report(false);
    } else if (probe && now - sinceReport > 500) {
      sinceReport = now;
      report(false);
    }
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (!moving()) {
      if (playedFrom !== undefined) turnsAtPause = turnsNow(performance.now());
      playedFrom = undefined;
      return;
    }
    if (raf) return;
    playedFrom = performance.now();
    if (measuring) sampler.reset();
    raf = requestAnimationFrame(frame);
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    opts.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  size();
  if (probe && canvas.parentElement) {
    readout = document.createElement('div');
    Object.assign(readout.style, {
      position: 'absolute',
      left: '8px',
      top: '8px',
      font: '12px monospace',
      color: '#fff',
      background: 'rgba(0,0,0,.55)',
      padding: '2px 6px',
      borderRadius: '3px',
      pointerEvents: 'none',
    });
    canvas.parentElement.appendChild(readout);
  }
  if (still) settleToStill();
  else wake();
  if (!still && !moving()) draw(0);

  const onVisibility = () => {
    sampler.reset();
    wake();
  };
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed || lost) return;
      size();
      draw(turnsNow(performance.now()));
      sampler.reset();
    }, 250);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  reducedMotion?.addEventListener?.('change', onVisibility);

  return {
    login() {
      // The camera is the same before and after.
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      reducedMotion?.removeEventListener?.('change', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      readout?.remove();
      release();
    },
  };
}
