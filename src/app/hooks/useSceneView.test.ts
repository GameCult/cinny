import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneViewOffered } from './useSceneView';

const held = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock('./useClientConfig', () => ({ useClientConfig: () => ({ backgroundScene: held.config }) }));

const device = (nav: Record<string, unknown>) => vi.stubGlobal('navigator', nav);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whether the scene view is offered', () => {
  it('is not with the tier off or absent, and is with any tier on', () => {
    device({});
    held.config = undefined;
    expect(useSceneViewOffered()).toBe(false);
    held.config = { tier: 'off' };
    expect(useSceneViewOffered()).toBe(false);
    for (const tier of ['still', 'low', 'full']) {
      held.config = { tier };
      expect(useSceneViewOffered()).toBe(true);
    }
  });

  it('follows the tier the device allows, not the one configured: no device ceiling turns a configured tier off', () => {
    device({ connection: { saveData: true } });
    held.config = { tier: 'full' };
    expect(useSceneViewOffered()).toBe(true); // lowered to still, still a scene
  });
});
