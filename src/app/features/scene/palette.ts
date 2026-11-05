// The scene's colours, as linear RGB uniforms. The sky tints are GameCult's three nebula inputs
// (orange 255 138 42, violet 109 96 255, sky 89 183 255) over the brand base #07111a, so the
// background reads as the same dusk as gamecult.org. The shaders hold no colour literal.

export type Rgb = readonly [number, number, number];

const srgb = (r: number, g: number, b: number): Rgb => [
  (r / 255) ** 2.2,
  (g / 255) ** 2.2,
  (b / 255) ** 2.2,
];

export const PALETTE = {
  sunColor: srgb(255, 150, 70).map((c) => c * 3.2) as unknown as Rgb,
  skyTop: srgb(30, 36, 92),
  skyHorizon: srgb(255, 138, 42).map((c) => c * 0.55) as unknown as Rgb,
  fogColor: srgb(109, 96, 255).map((c) => c * 0.12) as unknown as Rgb,
  grass: srgb(72, 112, 86),
  rock: srgb(112, 104, 122),
  bark: srgb(62, 46, 40),
  leaf: srgb(89, 183, 255).map((c) => c * 0.7) as unknown as Rgb,
  sunDir: (() => {
    const v = [0.55, 0.16, -0.82];
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l] as Rgb;
  })(),
} as const;
