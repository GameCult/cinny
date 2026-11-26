import { describe, expect, it, vi } from 'vitest';
import { SceneViewEntry } from './SceneViewEntry';

const offered = vi.hoisted(() => ({ value: true }));
vi.mock('../../hooks/useSceneView', () => ({ useSceneViewOffered: () => offered.value }));

describe('the scene view entry', () => {
  it('is offered with the scene on', () => {
    offered.value = true;
    expect((SceneViewEntry() as { props: Record<string, unknown> }).props['aria-label']).toBe(
      'Scene view'
    );
  });
  it('is not offered when the scene tier is off', () => {
    offered.value = false;
    expect(SceneViewEntry()).toBeNull();
  });
});
