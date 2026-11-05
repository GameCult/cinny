# Vendored CultMath GLSL

`CultMath.glsl` and `CultMath.Phacelle.glsl` are CultLib's generated WebGL2
lowering of `packages/cultmath/shaders/CultMath.hlsl` and
`CultMath.Phacelle.hlsl`, copied unedited from CultLib branch
`eureka/cultmath-tapes-interval-ops-r5` at `658c09e` (the branch that carries
the interval ops and `CULTMATH_SNOISE2_LIPSCHITZ`; the repo default branch
does not carry the GLSL yet). Never edit them here: regenerate in CultLib and
re-copy. `CultMath.glsl` is MIT; `CultMath.Phacelle.glsl` is MPL-2.0 (Rune
Skovbo Johansen's Phacelle noise, see its header), so that file keeps its
header and any change to it is published under MPL-2.0.

The other `*.glsl` files here are the scene's own stages. They are
concatenated by `../shaderSource.ts` after a prelude; they use no colour
literal (the palette is uniforms) and define no noise.

`../shaderSource.ts` compiles each stage with only the part of `CultMath.glsl` that stage reaches
(`../cultmathTrim.ts`); the vendored file itself stays whole. Phacelle is added to the terrain stage
alone.
