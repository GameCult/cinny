// A GL context for tests: every call a spy, so a scene can be driven without a GPU.
import { Mock, vi } from 'vitest';

type Fn = Mock;

/** A GL context where every call is a spy and every constant is 1. Compiles succeed until `failFrom`. */
export function fakeGl(failFrom = Infinity, missing: string[] = []) {
  let compiles = 0;
  const calls: Record<string, Fn> = {};
  const spy = (name: string, impl: (...a: any[]) => unknown = () => ({})): Fn => {
    if (!calls[name]) calls[name] = vi.fn(impl);
    return calls[name];
  };
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      // texture formats must be told apart; every other constant is 1
      if (prop === 'RGBA32F') return 32;
      if (prop === 'RGBA16F') return 16;
      if (prop === 'RG8') return 208;
      if (prop === 'RGBA8') return 209;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return 1;
      if (prop === 'getExtension')
        return spy(prop, (n: string) => (missing.includes(n) ? null : {}));
      if (prop === 'compileShader') {
        return spy(prop, () => {
          compiles += 1;
        });
      }
      if (prop === 'getShaderParameter') return spy(prop, () => compiles < failFrom);
      if (prop === 'getShaderInfoLog') return spy(prop, () => 'ERROR: 0:1: bad');
      if (prop === 'getProgramParameter') return spy(prop, () => true);
      return spy(prop);
    },
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

export function fakeCanvas(gl: WebGL2RenderingContext | null) {
  const canvas = new EventTarget() as EventTarget & {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    getContext: Fn;
  };
  canvas.clientWidth = 400;
  canvas.clientHeight = 300;
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext = vi.fn(() => gl);
  return canvas;
}
