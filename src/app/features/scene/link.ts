// Compiling and linking a stage: the one place a shader failure becomes a ShaderCompileError.
import { fragmentSource, vertexSourceFor, Stage } from './shaderSource';

/** Measurement seam: the harness rewrites a stage's source to time a variant. Never set in the client. */
export type SourcePatch = (stage: Stage, source: string) => string;

export class ShaderCompileError extends Error {
  constructor(readonly stage: Stage | 'vertex', readonly log: string) {
    super(`${stage} shader failed to compile:\n${log}`);
  }
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
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSourceFor(stage, defines), 'vertex');
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
