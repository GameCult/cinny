import type { Scene, SceneOptions } from '../Scene';
import { FrameSampler, FrameStats } from './probe';
import { skyColours, SkyColours, Srgb } from './skyColour';
import { hazeColour } from './ridgeWorld';
import { buildMesh, HAZE, MESH, periodWidth, triangleCount, viewProjection } from './meshWorld';
import { MESH_FRAG, MESH_VERT, SKY_FRAG, SKY_VERT } from './meshShaders';

export type MeshOptions = Pick<
  SceneOptions,
  'canvas' | 'tier' | 'onCompileFail' | 'onContextLost'
> & {
  /** Show the rAF median/p95 readout (plus triangle count). Default: the page URL has `?probe=1`. */
  probe?: boolean;
  onProbe?: (s: FrameStats & { still: boolean; triangles: number }) => void;
  /** The sky's colours; default `skyColours()`, the one function to replace with Void's sun.js. */
  sky?: SkyColours;
};

const rgb = (c: Srgb): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];

/**
 * Same shape as Scene.ts's ShaderCompileError, which the host's `onCompileFail` already takes (stage 'vertex' for
 * every mesh failure, the log says which shader). Redeclared because importing the class would pull the
 * ray-march scene and its GLSL into this chunk.
 */
class ShaderCompileError extends Error {
  constructor(readonly stage: 'vertex', readonly log: string) {
    super(`${stage} shader failed to compile:\n${log}`);
  }
}

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? '';
      gl.deleteShader(s);
      throw new ShaderCompileError(
        'vertex',
        `mesh ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`
      );
    }
    return s;
  };
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
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
    throw new ShaderCompileError('vertex', `mesh link: ${log}`);
  }
  return p;
}

/**
 * The mesh scene: same contract as `createRidgeScene`/`createScene` ({ login, dispose }, null for "keep
 * the CSS ground"). One low-poly heightfield far from the camera ({@link triangleCount} triangles), drawn over
 * a gradient sky in one WebGL pass. The fragment shader hazes by view-space depth, exp(-k d), toward the sky
 * colour behind that pixel, with a slight desaturation; there is no march and no light besides the sky.
 * Cadence guard, pauses and the `?probe=1` readout match the ridge scene.
 */
export function createMeshScene(opts: MeshOptions): Scene | null {
  const tier = opts.tier ?? 'full';
  if (tier === 'off') return null;
  const canvas = opts.canvas;
  const sky = opts.sky ?? skyColours();
  const probe = opts.probe ?? new URLSearchParams(window.location.search).get('probe') === '1';
  const gl = (canvas.getContext('webgl', { antialias: false, alpha: false }) ??
    canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) return null;

  let skyProg: WebGLProgram;
  let meshProg: WebGLProgram;
  try {
    skyProg = program(gl, SKY_VERT, SKY_FRAG);
    meshProg = program(gl, MESH_VERT, MESH_FRAG);
  } catch (e) {
    opts.onCompileFail?.(e as ShaderCompileError);
    return null;
  }

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
  let width = 1;
  let indexCount = 0;

  const tri = gl.createBuffer();
  const vbuf = gl.createBuffer();
  const nbuf = gl.createBuffer();
  const ibuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const skyUniforms = (p: WebGLProgram) => {
    gl.uniform3fv(gl.getUniformLocation(p, 'uTop'), rgb(sky.top));
    gl.uniform3fv(gl.getUniformLocation(p, 'uMid'), rgb(sky.mid));
    gl.uniform3fv(gl.getUniformLocation(p, 'uHorizon'), rgb(sky.horizon));
  };

  /** Rebuild the grid and the buffers for the canvas's aspect and size. */
  const build = () => {
    // low tier renders at 0.75 of the CSS size; full at device pixel ratio capped to 2.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (tier === 'low' ? 0.75 : 1);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const aspect = canvas.width / canvas.height;
    const m = buildMesh(aspect);
    width = periodWidth(aspect);
    indexCount = m.indices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
  };

  const draw = (turns: number) => {
    if (lost) return;
    const aspect = canvas.width / canvas.height;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProg);
    skyUniforms(skyProg);
    gl.uniform2f(gl.getUniformLocation(skyProg, 'uSize'), canvas.width, canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    const sa = gl.getAttribLocation(skyProg, 'aPos');
    gl.enableVertexAttribArray(sa);
    gl.vertexAttribPointer(sa, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(sa);

    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(meshProg);
    const u = (n: string) => gl.getUniformLocation(meshProg, n);
    gl.uniformMatrix4fv(u('uViewProj'), false, viewProjection(aspect));
    gl.uniform1f(u('uShift'), (turns % 1) * width);
    gl.uniform3fv(u('uGround'), rgb(sky.ground));
    gl.uniform3fv(u('uHaze'), rgb(hazeColour(sky)));
    gl.uniform3fv(u('uMid'), rgb(sky.mid));
    gl.uniform1f(u('uFar'), MESH.far);
    gl.uniform1f(u('uExtinction'), HAZE.extinction);
    gl.uniform1f(u('uDesaturate'), HAZE.desaturate);
    gl.uniform1f(u('uRelief'), MESH.relief);
    const bind = (buf: WebGLBuffer | null, name: string) => {
      const a = gl.getAttribLocation(meshProg, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      return a;
    };
    const a0 = bind(vbuf, 'aPos');
    const a1 = bind(nbuf, 'aNormal');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(a0);
    gl.disableVertexAttribArray(a1);
  };

  const moving = () =>
    !still &&
    !disposed &&
    !lost &&
    !(reducedMotion?.matches ?? false) &&
    document.visibilityState === 'visible';

  const turnsNow = (now: number) =>
    turnsAtPause + (playedFrom === undefined ? 0 : (now - playedFrom) / (MESH.seconds * 1000));

  const report = (stillNow: boolean) => {
    const s = { ...sampler.stats(), still: stillNow, triangles: triangleCount() };
    opts.onProbe?.(s);
    if (readout) {
      readout.textContent = `mesh · ${s.triangles} tris · n ${s.n} · median ${s.medianMs.toFixed(
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

  build();
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
      build();
      draw(turnsNow(performance.now()));
      sampler.reset();
    }, 250);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  reducedMotion?.addEventListener?.('change', onVisibility);

  return {
    login() {
      // The camera is fixed; the field is the same before and after.
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
      gl.deleteBuffer(tri);
      gl.deleteBuffer(vbuf);
      gl.deleteBuffer(nbuf);
      gl.deleteBuffer(ibuf);
      gl.deleteProgram(skyProg);
      gl.deleteProgram(meshProg);
    },
  };
}
