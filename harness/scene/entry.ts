// Browser entry for the harness: exposes the scene's seams to the driver. Not shipped.
import { createScene, linkStage, ShaderCompileError } from '../../src/app/features/scene/Scene';
import { LEVELS } from '../../src/app/features/scene/budget';
import { fragmentSource } from '../../src/app/features/scene/shaderSource';
import { WORLD } from '../../src/app/features/scene/world';

(window as unknown as Record<string, unknown>).__scene = {
  createScene,
  linkStage,
  ShaderCompileError,
  LEVELS,
  fragmentSource,
  WORLD,
};

// ---- Phacelle gradient probe -----------------------------------------------------------------
import cultmath from '../../src/app/features/scene/shaders/CultMath.glsl?raw';
import phacelle from '../../src/app/features/scene/shaders/CultMath.Phacelle.glsl?raw';
import { vertexSource } from '../../src/app/features/scene/shaderSource';

const PROBE_FRAG = `#version 300 es
precision highp float; precision highp int;
${cultmath}
${phacelle}
uniform float u_seed; uniform vec3 u_side; uniform float u_norm; uniform float u_span;
in vec2 v_uv; layout(location=0) out vec4 o;
void main() {
  // The scene samples the z = 0 slice: random points in a u_span square of it.
  vec3 h = vec3(cultmath_pcg3d(vec3(gl_FragCoord.xy, u_seed))) ;
  vec2 xy = vec2(float(uint(int(h.x)) >> 8), float(uint(int(h.y)) >> 8)) * (1.0 / 16777216.0) * u_span;
  CultPhasor ph = cultmath_phacelle(vec3(xy, 0.0), u_side, 0.0, u_norm);
  o = vec4(length(ph.cos.xyz), length(ph.sin.xyz), ph.cos.w, ph.sin.w);
}`;

/** Max |grad| of the phasor over `draws * 1024^2` random points; min/max of the cos component. */
(window as unknown as Record<string, unknown>).__probePhacelle = (
  side: number[],
  norm: number,
  draws: number
) => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2')!;
  gl.getExtension('EXT_color_buffer_float');
  const mk = (t: number, s: string) => {
    const x = gl.createShader(t)!;
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)!);
    return x;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, PROBE_FRAG));
  gl.linkProgram(p);
  gl.useProgram(p);
  const N = 1024;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, N, N);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, N, N);
  gl.bindVertexArray(gl.createVertexArray());
  gl.uniform3fv(gl.getUniformLocation(p, 'u_side'), side);
  gl.uniform1f(gl.getUniformLocation(p, 'u_norm'), norm);
  gl.uniform1f(gl.getUniformLocation(p, 'u_span'), 400);
  const buf = new Float32Array(N * N * 4);
  let gradCos = 0,
    gradSin = 0,
    vMin = 1e9,
    vMax = -1e9,
    n = 0;
  for (let d = 0; d < draws; d++) {
    gl.uniform1f(gl.getUniformLocation(p, 'u_seed'), d + 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] > gradCos) gradCos = buf[i];
      if (buf[i + 1] > gradSin) gradSin = buf[i + 1];
      if (buf[i + 2] < vMin) vMin = buf[i + 2];
      if (buf[i + 2] > vMax) vMax = buf[i + 2];
      n++;
    }
  }
  return { samples: n, maxGradCos: gradCos, maxGradSin: gradSin, minCos: vMin, maxCos: vMax };
};
