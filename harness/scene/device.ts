// What a standalone page tells the reader about the browser, so a phone that cannot run the scene
// says why on screen. Not shipped.
import type { SceneUnavailable } from '../../src/app/features/scene/Scene';

export const WHY: Record<SceneUnavailable, string> = {
  'no-webgl2': 'this browser gave no WebGL2 context',
  'no-float-or-half-float-colour-buffer':
    'WebGL2 is there, but neither EXT_color_buffer_float nor EXT_color_buffer_half_float is',
};

// What the browser says about itself, read from a scratch context so it shows even when the scene
// could not start. A canvas that never got a WebGL2 context is asked for WebGL1 to name the GPU.
export function describeDevice(): string {
  const c = document.createElement('canvas');
  const gl2 = c.getContext('webgl2');
  const gl = gl2 ?? (document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null);
  const lines = [`webgl2 context: ${gl2 ? 'yes' : 'NO'}`];
  if (!gl) return [...lines, 'webgl1 context: NO'].join('\n');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  lines.push(
    `renderer: ${gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)}`,
    `vendor: ${gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)}`,
    `version: ${gl.getParameter(gl.VERSION)}`,
    `user agent: ${navigator.userAgent}`
  );
  const ext = gl.getSupportedExtensions() ?? [];
  for (const n of ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_disjoint_timer_query_webgl2'])
    lines.push(`${n}: ${ext.includes(n) ? 'yes' : 'NO'}`);
  lines.push(`extensions (${ext.length}): ${ext.join(' ')}`);
  return lines.join('\n');
}
