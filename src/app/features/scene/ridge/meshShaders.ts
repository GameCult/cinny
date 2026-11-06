// GLSL ES 1.00 so one source runs on WebGL1 and WebGL2. Colours are sRGB 0..1 and mixed as they are, like the
// baked ridge path, so the two tiers fade into the same haze colour (ridgeWorld.hazeColour of the sky). The numbers come in as uniforms from meshWorld.ts.

/** The sky gradient the 2D path paints (stops 0 / 0.5 / 0.78 / 1 from the top), by `v` = 0 top .. 1 bottom. */
const SKY_FN = `
uniform vec3 uTop, uMid, uHorizon;
vec3 skyAt(float v) {
  vec3 c = mix(uTop, uMid, smoothstep(0.0, 0.5, v));
  return mix(c, uHorizon, smoothstep(0.5, 0.78, v));
}`;

export const SKY_VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.999, 1.0); }`;

export const SKY_FRAG = `
precision mediump float;
uniform vec2 uSize;${SKY_FN}
void main() { gl_FragColor = vec4(skyAt(1.0 - gl_FragCoord.y / uSize.y), 1.0); }`;

export const MESH_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uViewProj;
uniform float uShift; // drift along x, world units
varying float vDepth;
varying float vUp;
varying float vHeight;
void main() {
  vec3 p = aPos - vec3(uShift, 0.0, 0.0);
  gl_Position = uViewProj * vec4(p, 1.0);
  // View-space depth along the view axis is what the projection puts in w.
  vDepth = gl_Position.w;
  vUp = aNormal.y;
  vHeight = aPos.y;
}`;

export const MESH_FRAG = `
precision mediump float;
uniform vec3 uGround, uHaze, uMid;
uniform float uFar, uExtinction, uDesaturate, uRelief;
varying float vDepth;
varying float vUp;
varying float vHeight;
void main() {
  // Unlit by any sun: slopes and crests pick up the sky's own mid colour.
  float rim = clamp(0.35 * (1.0 - vUp) * 4.0 + 0.5 * vHeight / uRelief, 0.0, 1.0);
  vec3 base = mix(uGround, uMid, 0.10 + 0.45 * rim);
  float t = exp(-uExtinction * vDepth / uFar);
  vec3 seen = mix(uHaze, base, t);
  float luma = dot(seen, vec3(0.2126, 0.7152, 0.0722));
  seen = mix(vec3(luma), seen, 1.0 - uDesaturate * (1.0 - t));
  gl_FragColor = vec4(seen, 1.0);
}`;
