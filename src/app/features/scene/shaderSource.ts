import cultmath from './shaders/CultMath.glsl?raw';
import phacelle from './shaders/CultMath.Phacelle.glsl?raw';
import common from './shaders/common.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import terrainFrag from './shaders/terrain.frag.glsl?raw';
import atmosphereFrag from './shaders/atmosphere.frag.glsl?raw';
import resolveFrag from './shaders/resolve.frag.glsl?raw';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import { WORLD, worldDefines } from './world';

export type Stage = 'terrain' | 'atmosphere' | 'resolve' | 'composite';

const HEADER =
  '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

export const vertexSource = HEADER + fullscreenVert;

const stages: Record<Stage, string> = {
  terrain: terrainFrag,
  atmosphere: atmosphereFrag,
  resolve: resolveFrag,
  composite: compositeFrag,
};

/** Fragment source for a stage: header, world defines, CultMath, the shared block, the stage. */
export function fragmentSource(stage: Stage): string {
  const erosion = stage === 'terrain' && WORLD.phacelleGradBound > 0 ? phacelle : '';
  return `${HEADER}${worldDefines()}\n${cultmath}\n${erosion}\n${common}\n${stages[stage]}`;
}
