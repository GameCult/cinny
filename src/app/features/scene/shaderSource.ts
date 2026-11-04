import cultmath from './shaders/CultMath.glsl?raw';
import phacelle from './shaders/CultMath.Phacelle.glsl?raw';
import common from './shaders/common.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import sdf from './shaders/sdf.glsl?raw';
import prepassFrag from './shaders/prepass.frag.glsl?raw';
import terrainFrag from './shaders/terrain.frag.glsl?raw';
import atmosphereFrag from './shaders/atmosphere.frag.glsl?raw';
import resolveFrag from './shaders/resolve.frag.glsl?raw';
import compositeFrag from './shaders/composite.frag.glsl?raw';
import voxelHeightFrag from './shaders/voxelHeight.frag.glsl?raw';
import voxelSkyFrag from './shaders/voxelSky.frag.glsl?raw';
import voxelBackdropFrag from './shaders/voxelBackdrop.frag.glsl?raw';
import voxelStripsVert from './shaders/voxelStrips.vert.glsl?raw';
import voxelFrag from './shaders/voxel.frag.glsl?raw';
import { WORLD, worldDefines } from './world';
import { trimGlsl } from './cultmathTrim';

export type Stage =
  | 'prepass'
  | 'terrain'
  | 'atmosphere'
  | 'resolve'
  | 'composite'
  | 'voxelHeight'
  | 'voxelSky'
  | 'voxelBackdrop'
  | 'voxel';

const HEADER =
  '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

export const vertexSource = HEADER + fullscreenVert;

/**
 * Vertex source for a stage: the fullscreen triangle, except the voxel strips, which have a vertex
 * shader of their own (it reads the height ring and the shared block).
 */
export function vertexSourceFor(stage: Stage, defines = ''): string {
  return stage === 'voxel'
    ? `${HEADER}${defines}\n${common}\n${voxelStripsVert}`
    : vertexSource;
}

const stages: Record<Stage, string> = {
  prepass: prepassFrag,
  terrain: terrainFrag,
  atmosphere: atmosphereFrag,
  resolve: resolveFrag,
  composite: compositeFrag,
  voxelHeight: voxelHeightFrag,
  voxelSky: voxelSkyFrag,
  voxelBackdrop: voxelBackdropFrag,
  voxel: voxelFrag,
};

/**
 * Fragment source for a stage: header, world defines, the part of CultMath the stage reaches, the
 * shared block, the distance bound (stages that trace), the stage. `defines` is whole `#define`
 * lines (measurement flags) ahead of the world's. Phacelle stays a separate file, added only where
 * it is called.
 */
export function fragmentSource(stage: Stage, defines = ''): string {
  const solid = stage === 'terrain' || stage === 'prepass' || stage === 'voxelHeight';
  const erosion = solid && WORLD.phacelleGradBound > 0 ? phacelle : '';
  const world = solid ? sdf : '';
  const math = trimGlsl(cultmath, [erosion, common, world, stages[stage]]);
  return `${HEADER}${defines}${worldDefines()}\n${math}\n${erosion}\n${common}\n${world}\n${
    stages[stage]
  }`;
}
