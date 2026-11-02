// Which quality the background scene runs at. The client config's `backgroundScene.tier` is both
// the feature flag (absent or 'off' means the scene is not even imported) and the ceiling; the
// device can only lower it.

export type SceneTier = 'off' | 'still' | 'low' | 'full';

/** Cheapest first. */
export const TIERS: readonly SceneTier[] = ['off', 'still', 'low', 'full'];

export interface Capabilities {
  /** `navigator.connection.saveData`. */
  saveData?: boolean;
  /** `navigator.deviceMemory` in GiB (Chromium only). */
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export interface BackgroundSceneConfig {
  tier?: SceneTier;
}

export function readCapabilities(nav: Navigator): Capabilities {
  const n = nav as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    saveData: n.connection?.saveData,
    deviceMemory: n.deviceMemory,
    hardwareConcurrency: n.hardwareConcurrency,
  };
}

/** The most the device is allowed to run, before the configured ceiling is applied. */
function deviceCeiling(c: Capabilities): SceneTier {
  if (c.saveData) return 'still';
  if ((c.deviceMemory ?? Infinity) <= 2 || (c.hardwareConcurrency ?? Infinity) <= 4) return 'low';
  return 'full';
}

/** The tier to run: the configured one (default 'off'), lowered by what the device can carry. */
export function resolveTier(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities = {}
): SceneTier {
  const configured = config?.tier ?? 'off';
  const ceiling = deviceCeiling(capabilities);
  return TIERS.indexOf(configured) <= TIERS.indexOf(ceiling) ? configured : ceiling;
}
